import { app, type BrowserWindow } from 'electron'
import { chmodSync, existsSync, unlinkSync } from 'node:fs'
import { createServer, type Server, type Socket } from 'node:net'
import { join } from 'node:path'
import { inspectProject } from './projects'
import { addExternalFolder, getWorkspace } from './store'
import { killSession, ptyStatus, readOutput, writeSession } from './terminals'
import { RENDERER_METHODS, type BridgeRequest, type BridgeResponse } from '../shared/bridge'
import type { BridgeMethod, RendererMethod } from '../shared/bridge'
import type { ExternalFolderOpened } from '../shared/types'

/** Nombre del socket dentro de userData: el cliente lo arma igual del otro lado. */
const SOCKET_NAME = 'bridge.sock'
/** Si el renderer no contesta en este plazo, el cliente recibe un error en vez de colgarse. */
const RENDERER_TIMEOUT_MS = 10_000
const MAX_LINE_BYTES = 1024 * 1024

export function bridgeSocketPath(): string {
  if (process.platform === 'win32') {
    // Los named pipes no viven en el filesystem: el nombre se deriva de userData.
    return `\\\\.\\pipe\\selene-${Buffer.from(app.getPath('userData')).toString('hex').slice(-16)}`
  }
  return join(app.getPath('userData'), SOCKET_NAME)
}

let server: Server | null = null
let getWindow: () => BrowserWindow | null = () => null

/* ---------- consultas al renderer ---------- */

let nextRendererRequestId = 0
const pendingRendererRequests = new Map<
  number,
  { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
>()

/** El estado de las pestañas vive en React: estos métodos se contestan allá. */
function askRenderer(method: RendererMethod, params: Record<string, unknown>): Promise<unknown> {
  const window = getWindow()
  if (!window) {
    return Promise.reject(new Error('La ventana de Selene está cerrada: no hay pestañas que manejar'))
  }
  const id = (nextRendererRequestId += 1)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingRendererRequests.delete(id)
      reject(new Error(`La ventana no respondió a ${method} en ${RENDERER_TIMEOUT_MS} ms`))
    }, RENDERER_TIMEOUT_MS)
    pendingRendererRequests.set(id, { resolve, reject, timer })
    window.webContents.send('bridge:request', { id, method, params })
  })
}

/** Respuesta del renderer a una consulta pendiente (la llama el IPC de index.ts). */
export function resolveRendererResponse(response: BridgeResponse): void {
  const pending = pendingRendererRequests.get(response.id)
  if (!pending) return
  clearTimeout(pending.timer)
  pendingRendererRequests.delete(response.id)
  if (response.ok) pending.resolve(response.result)
  else pending.reject(new Error(response.error ?? 'Error sin detalle en la ventana'))
}

/** Al recargarse el renderer se pierden sus promesas: mejor fallar que colgar al cliente. */
export function abortRendererRequests(reason: string): void {
  for (const [, pending] of pendingRendererRequests) {
    clearTimeout(pending.timer)
    pending.reject(new Error(reason))
  }
  pendingRendererRequests.clear()
}

/* ---------- métodos que resuelve el main ---------- */

function requireString(params: Record<string, unknown>, key: string): string {
  const value = params[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Falta el parámetro "${key}"`)
  }
  return value
}

function addFolder(path: string): ExternalFolderOpened {
  const opened = addExternalFolder(path)
  // Mismo aviso que usa la apertura desde afuera, para que el sidebar se entere.
  getWindow()?.webContents.send('external:folder-opened', opened)
  return opened
}

async function handle(method: BridgeMethod, params: Record<string, unknown>): Promise<unknown> {
  if (RENDERER_METHODS.includes(method as RendererMethod)) {
    return askRenderer(method as RendererMethod, params)
  }

  switch (method) {
    case 'app.info':
      return { version: app.getVersion(), platform: process.platform, pty: ptyStatus() }
    case 'workspace.get':
      return getWorkspace()
    case 'workspace.addFolder':
      return addFolder(requireString(params, 'path'))
    case 'project.inspect':
      return inspectProject(requireString(params, 'path'))
    case 'terminal.output': {
      const sessionId = requireString(params, 'sessionId')
      const output = readOutput(sessionId)
      if (!output) throw new Error(`No hay salida registrada para la sesión ${sessionId}`)
      return output
    }
    case 'terminal.input':
      writeSession(requireString(params, 'sessionId'), requireString(params, 'data'))
      return { ok: true }
    case 'terminal.kill':
      killSession(requireString(params, 'sessionId'))
      return { ok: true }
    default:
      throw new Error(`Método desconocido: ${method}`)
  }
}

/* ---------- servidor ---------- */

function reply(socket: Socket, response: BridgeResponse): void {
  if (socket.writable) socket.write(`${JSON.stringify(response)}\n`)
}

function onConnection(socket: Socket): void {
  let buffer = ''
  socket.setEncoding('utf8')
  socket.on('data', (chunk: string) => {
    buffer += chunk
    if (buffer.length > MAX_LINE_BYTES) {
      reply(socket, { id: 0, ok: false, error: 'Pedido demasiado largo' })
      socket.destroy()
      return
    }
    let newline = buffer.indexOf('\n')
    while (newline !== -1) {
      const line = buffer.slice(0, newline)
      buffer = buffer.slice(newline + 1)
      if (line.trim()) void dispatch(socket, line)
      newline = buffer.indexOf('\n')
    }
  })
  // Un cliente que se corta no es un error de la app.
  socket.on('error', () => socket.destroy())
}

async function dispatch(socket: Socket, line: string): Promise<void> {
  let request: BridgeRequest
  try {
    request = JSON.parse(line) as BridgeRequest
  } catch {
    reply(socket, { id: 0, ok: false, error: 'JSON inválido' })
    return
  }
  try {
    const result = await handle(request.method, request.params ?? {})
    reply(socket, { id: request.id, ok: true, result })
  } catch (error) {
    reply(socket, {
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    })
  }
}

export function startBridge(windowGetter: () => BrowserWindow | null): void {
  getWindow = windowGetter
  const path = bridgeSocketPath()

  // Un socket que quedó de un cierre sucio impide el bind; en Windows no existe archivo.
  if (process.platform !== 'win32' && existsSync(path)) {
    try {
      unlinkSync(path)
    } catch {
      /* si no se puede borrar, el listen falla abajo y queda logueado */
    }
  }

  const created = createServer(onConnection)
  created.on('error', (error) => {
    console.error('[bridge] no se pudo abrir el socket local:', error.message)
    server = null
  })
  created.listen(path, () => {
    // Solo el usuario que corre la app puede hablarle al bridge.
    if (process.platform !== 'win32') {
      try {
        chmodSync(path, 0o600)
      } catch {
        /* en algunos filesystems no aplica; el socket vive en userData igual */
      }
    }
    console.log(`[bridge] escuchando en ${path}`)
  })
  server = created
}

export function stopBridge(): void {
  abortRendererRequests('La app se está cerrando')
  // Una segunda instancia (`open -a Selene <ruta>`) se cierra sola y pasa por
  // acá sin haber abierto nada: sin esto borraría el socket de la que sí corre.
  if (!server) return
  server.close()
  server = null
  const path = bridgeSocketPath()
  if (process.platform !== 'win32' && existsSync(path)) {
    try {
      unlinkSync(path)
    } catch {
      /* el próximo arranque lo limpia */
    }
  }
}
