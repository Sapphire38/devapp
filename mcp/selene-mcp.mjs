#!/usr/bin/env node
/**
 * Servidor MCP de Selene: expone la app corriendo como herramientas.
 *
 * Habla JSON-RPC 2.0 por stdio con el cliente MCP, y NDJSON por el socket local
 * que abre la app (`src/main/bridge.ts`). Sin dependencias a propósito: se
 * ejecuta con el node del sistema, fuera de Electron.
 */
import { connect } from 'node:net'
import { homedir, platform } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

const PROTOCOL_VERSION = '2025-06-18'
const SERVER_INFO = { name: 'selene', version: '0.1.0' }
const REQUEST_TIMEOUT_MS = 15_000
/** Tope de salida devuelta por lectura: más que esto no entra en una respuesta útil. */
const MAX_OUTPUT_CHARS = 40_000

/* ---------- socket de la app ---------- */

function userDataDirs() {
  const home = homedir()
  if (platform() === 'darwin') {
    const base = join(home, 'Library', 'Application Support')
    return [join(base, 'selene'), join(base, 'selene-dev')]
  }
  if (platform() === 'win32') {
    const base = process.env.APPDATA ?? join(home, 'AppData', 'Roaming')
    return [join(base, 'selene'), join(base, 'selene-dev')]
  }
  const base = process.env.XDG_CONFIG_HOME ?? join(home, '.config')
  return [join(base, 'selene'), join(base, 'selene-dev')]
}

/** Mismo nombre que arma el main: en Windows es un named pipe, no un archivo. */
function socketPathFor(userData) {
  if (platform() === 'win32') {
    return `\\\\.\\pipe\\selene-${Buffer.from(userData).toString('hex').slice(-16)}`
  }
  return join(userData, 'bridge.sock')
}

function candidateSockets() {
  const forced = process.env.SELENE_BRIDGE_SOCKET
  return forced ? [forced] : userDataDirs().map(socketPathFor)
}

let nextRequestId = 0

/** Una conexión por pedido: el bridge no guarda estado entre llamadas. */
function callOnce(socketPath, method, params) {
  return new Promise((resolve, reject) => {
    const socket = connect(socketPath)
    const id = (nextRequestId += 1)
    let buffer = ''
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error(`La app no respondió a ${method} en ${REQUEST_TIMEOUT_MS} ms`))
    }, REQUEST_TIMEOUT_MS)

    const finish = (fn, value) => {
      clearTimeout(timer)
      socket.destroy()
      fn(value)
    }

    socket.setEncoding('utf8')
    socket.on('connect', () => socket.write(`${JSON.stringify({ id, method, params })}\n`))
    socket.on('data', (chunk) => {
      buffer += chunk
      const newline = buffer.indexOf('\n')
      if (newline === -1) return
      let response
      try {
        response = JSON.parse(buffer.slice(0, newline))
      } catch (error) {
        finish(reject, new Error(`Respuesta ilegible de la app: ${error.message}`))
        return
      }
      if (response.ok) finish(resolve, response.result)
      else finish(reject, new Error(response.error ?? 'Error sin detalle'))
    })
    socket.on('error', (error) => finish(reject, error))
  })
}

let knownSocket = null

/** Prueba la app instalada y la de desarrollo; recuerda la que contestó. */
async function call(method, params = {}) {
  const candidates = knownSocket ? [knownSocket, ...candidateSockets()] : candidateSockets()
  let lastError = null
  for (const candidate of candidates) {
    try {
      const result = await callOnce(candidate, method, params)
      knownSocket = candidate
      return result
    } catch (error) {
      // Solo seguimos probando si el problema es que ahí no hay nadie escuchando.
      if (error.code !== 'ENOENT' && error.code !== 'ECONNREFUSED') throw error
      lastError = error
    }
  }
  knownSocket = null
  throw new Error(
    `No encontré a Selene escuchando. ¿Está abierta la app? ` +
      `Probé: ${candidates.join(', ')}${lastError ? ` (${lastError.code})` : ''}`
  )
}

/* ---------- utilidades de salida ---------- */

// eslint-disable-next-line no-control-regex
const ANSI = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-PR-TZcf-ny=><~]/g

function cleanOutput(text) {
  const plain = text
    .replace(ANSI, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    // El PTY redibuja el prompt con caracteres de control sueltos.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
  return plain.length > MAX_OUTPUT_CHARS
    ? `… (recortado)\n${plain.slice(-MAX_OUTPUT_CHARS)}`
    : plain
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/* ---------- herramientas ---------- */

const tools = [
  {
    name: 'selene_status',
    description:
      'Estado de la app Selene: versión, plataforma, si node-pty está disponible, y cuántas carpetas, proyectos, conjuntos y pestañas hay. Úsalo primero para confirmar que la app está abierta.',
    inputSchema: { type: 'object', properties: {} },
    run: async () => {
      const [info, workspace, tabs] = await Promise.all([
        call('app.info'),
        call('workspace.get'),
        call('tabs.list').catch(() => [])
      ])
      return {
        ...info,
        folders: workspace.folders.length,
        projects: workspace.projects.length,
        tasks: workspace.tasks.length,
        tabs: tabs.length,
        tabsCorriendo: tabs.filter((t) => t.running).length
      }
    }
  },
  {
    name: 'selene_workspace',
    description:
      'Carpetas, proyectos, conjuntos de scripts y pestañas abiertas de Selene, con sus ids. De acá salen los folderId, tabId y nombres de conjunto que piden las demás herramientas.',
    inputSchema: { type: 'object', properties: {} },
    run: async () => {
      const [workspace, tabs] = await Promise.all([
        call('workspace.get'),
        call('tabs.list').catch((error) => ({ error: error.message }))
      ])
      return {
        folders: workspace.folders.map((f) => ({
          id: f.id,
          name: f.name,
          path: f.path,
          projectId: f.projectId,
          origin: f.origin
        })),
        projects: workspace.projects,
        tasks: workspace.tasks,
        tabs
      }
    }
  },
  {
    name: 'selene_inspect',
    description:
      'Scripts de package.json, rama de git, gestor de paquetes y subpaquetes (monorepos) de una carpeta. Sirve para saber qué se puede correr antes de abrir una terminal.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Ruta absoluta de la carpeta' } },
      required: ['path']
    },
    run: (args) => call('project.inspect', { path: args.path })
  },
  {
    name: 'selene_add_folder',
    description:
      'Agrega una carpeta al workspace de Selene y la muestra en el sidebar. Si es un worktree de un repo ya agrupado, entra en ese proyecto.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Ruta absoluta de la carpeta' } },
      required: ['path']
    },
    run: async (args) => {
      const opened = await call('workspace.addFolder', { path: args.path })
      const folder = opened.workspace.folders.find((f) => f.id === opened.folderId)
      return { folderId: opened.folderId, name: folder?.name, path: folder?.path }
    }
  },
  {
    name: 'selene_open_terminal',
    description:
      'Abre una pestaña de terminal en una carpeta del workspace y, si le pasás un comando, lo ejecuta. La shell queda viva después del comando. Devuelve el tabId para leer la salida después. No le roba la vista al usuario salvo que pidas focus.',
    inputSchema: {
      type: 'object',
      properties: {
        folderId: { type: 'string', description: 'Id de la carpeta (de selene_workspace)' },
        path: { type: 'string', description: 'Alternativa al folderId: ruta exacta de la carpeta' },
        command: { type: 'string', description: 'Comando a ejecutar, p. ej. "npm run dev"' },
        cwd: { type: 'string', description: 'Subcarpeta donde correr, si no es la raíz' },
        title: { type: 'string', description: 'Título de la pestaña' },
        focus: { type: 'boolean', description: 'Seleccionar esa carpeta en la app (default false)' }
      }
    },
    run: (args) => call('tabs.open', args)
  },
  {
    name: 'selene_read_output',
    description:
      'Lee lo que imprimió una pestaña de terminal, sin códigos de color. Incluye si sigue corriendo y su código de salida. Usá wait_ms para esperar a que un comando recién lanzado produzca salida.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: { type: 'string', description: 'Id de la pestaña (de selene_open_terminal)' },
        wait_ms: {
          type: 'number',
          description: 'Esperar hasta este tiempo a que aparezca salida (default 0, máx 20000)'
        },
        raw: { type: 'boolean', description: 'Devolver la salida con sus códigos ANSI' }
      },
      required: ['tabId']
    },
    run: async (args) => {
      const deadline = Date.now() + Math.min(Math.max(args.wait_ms ?? 0, 0), 20_000)
      let output = null
      let sessionId = null
      do {
        const tabs = await call('tabs.list')
        const tab = tabs.find((t) => t.id === args.tabId)
        if (!tab) throw new Error(`No hay ninguna pestaña con id ${args.tabId}`)
        sessionId = tab.sessionId
        if (sessionId) {
          output = await call('terminal.output', { sessionId }).catch(() => null)
          if (output && output.text.length > 0) break
        }
        if (Date.now() >= deadline) break
        await sleep(250)
      } while (Date.now() <= deadline)

      if (!sessionId) {
        return { running: false, text: '', nota: 'La pestaña todavía no arrancó su sesión.' }
      }
      if (!output) return { running: false, text: '', nota: 'Sin salida registrada.' }
      return {
        running: output.running,
        exitCode: output.exitCode,
        truncado: output.truncated,
        text: args.raw ? output.text : cleanOutput(output.text)
      }
    }
  },
  {
    name: 'selene_send_input',
    description:
      'Escribe en el stdin de una terminal de Selene: responder un prompt, mandar Ctrl-C ("\\u0003") o Enter ("\\r"). El texto va tal cual, sin agregar salto de línea.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: { type: 'string' },
        data: { type: 'string', description: 'Texto o secuencia de control a enviar' }
      },
      required: ['tabId', 'data']
    },
    run: async (args) => {
      const tabs = await call('tabs.list')
      const tab = tabs.find((t) => t.id === args.tabId)
      if (!tab) throw new Error(`No hay ninguna pestaña con id ${args.tabId}`)
      if (!tab.sessionId) throw new Error('Esa pestaña no tiene una sesión viva')
      await call('terminal.input', { sessionId: tab.sessionId, data: args.data })
      return { ok: true }
    }
  },
  {
    name: 'selene_stop_terminal',
    description:
      'Mata el proceso de una pestaña y todo su árbol de hijos (un npm run dev no queda ocupando el puerto). La pestaña queda abierta con su salida.',
    inputSchema: { type: 'object', properties: { tabId: { type: 'string' } }, required: ['tabId'] },
    run: async (args) => {
      const tabs = await call('tabs.list')
      const tab = tabs.find((t) => t.id === args.tabId)
      if (!tab) throw new Error(`No hay ninguna pestaña con id ${args.tabId}`)
      if (!tab.sessionId) return { ok: true, nota: 'Ya estaba terminada' }
      await call('terminal.kill', { sessionId: tab.sessionId })
      return { ok: true }
    }
  },
  {
    name: 'selene_close_tab',
    description: 'Cierra una pestaña de Selene. Matar su proceso primero es cosa de la app.',
    inputSchema: { type: 'object', properties: { tabId: { type: 'string' } }, required: ['tabId'] },
    run: (args) => call('tabs.close', { tabId: args.tabId })
  },
  {
    name: 'selene_restart_tab',
    description: 'Reinicia la terminal de una pestaña: vuelve a correr su comando desde cero.',
    inputSchema: { type: 'object', properties: { tabId: { type: 'string' } }, required: ['tabId'] },
    run: (args) => call('tabs.restart', { tabId: args.tabId })
  },
  {
    name: 'selene_run_task',
    description:
      'Lanza un conjunto de scripts de Selene: cada paso en su carpeta, cada uno en su terminal. Aceptá el id o el nombre del conjunto.',
    inputSchema: {
      type: 'object',
      properties: { task: { type: 'string', description: 'Id o nombre del conjunto' } },
      required: ['task']
    },
    run: (args) => call('task.run', { task: args.task })
  },
  {
    name: 'selene_stop_task',
    description: 'Frena todas las terminales vivas de un conjunto de scripts.',
    inputSchema: {
      type: 'object',
      properties: { task: { type: 'string', description: 'Id o nombre del conjunto' } },
      required: ['task']
    },
    run: (args) => call('task.stop', { task: args.task })
  }
]

/* ---------- JSON-RPC por stdio ---------- */

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function result(id, value) {
  send({ jsonrpc: '2.0', id, result: value })
}

function failure(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } })
}

async function handle(message) {
  const { id, method, params } = message

  if (method === 'initialize') {
    result(id, {
      protocolVersion: params?.protocolVersion ?? PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: SERVER_INFO
    })
    return
  }
  if (method === 'notifications/initialized' || method === 'notifications/cancelled') return
  if (method === 'ping') {
    result(id, {})
    return
  }
  if (method === 'tools/list') {
    result(id, {
      tools: tools.map(({ name, description, inputSchema }) => ({
        name,
        description,
        inputSchema
      }))
    })
    return
  }
  if (method === 'tools/call') {
    const tool = tools.find((candidate) => candidate.name === params?.name)
    if (!tool) {
      failure(id, -32602, `Herramienta desconocida: ${params?.name}`)
      return
    }
    try {
      const value = await tool.run(params.arguments ?? {})
      const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
      result(id, { content: [{ type: 'text', text }] })
    } catch (error) {
      result(id, { content: [{ type: 'text', text: error.message }], isError: true })
    }
    return
  }
  // Las notificaciones (sin id) no llevan respuesta.
  if (id !== undefined) failure(id, -32601, `Método no soportado: ${method}`)
}

const input = createInterface({ input: process.stdin })
input.on('line', (line) => {
  if (!line.trim()) return
  let message
  try {
    message = JSON.parse(line)
  } catch {
    failure(null, -32700, 'JSON inválido')
    return
  }
  handle(message).catch((error) => {
    if (message.id !== undefined) failure(message.id, -32603, error.message)
  })
})
input.on('close', () => process.exit(0))
