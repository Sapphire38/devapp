import { spawn as spawnProcess, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createRequire } from 'node:module'
import os from 'node:os'
import type { WebContents } from 'electron'
import type { SessionCreated, SessionOptions } from '../shared/types'

const require_ = createRequire(import.meta.url)

type NodePty = typeof import('node-pty')

let ptyModule: NodePty | null = null
let ptyLoadError: string | null = null

/**
 * node-pty es un módulo nativo: si no fue recompilado contra el ABI de Electron
 * el require falla. En ese caso degradamos a pipes en vez de romper la app.
 */
function loadPty(): NodePty | null {
  if (ptyModule || ptyLoadError) return ptyModule
  try {
    ptyModule = require_('node-pty') as NodePty
  } catch (err) {
    ptyLoadError = err instanceof Error ? err.message : String(err)
    console.error('[terminals] node-pty no disponible, usando fallback por pipes:', ptyLoadError)
  }
  return ptyModule
}

export function ptyStatus(): { available: boolean; error: string | null } {
  loadPty()
  return { available: ptyModule !== null, error: ptyLoadError }
}

interface Session {
  id: string
  usesPty: boolean
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
}

/**
 * Mata el grupo de procesos entero, no sólo la shell: si la pestaña estaba
 * corriendo `npm run dev`, matar el shell dejaría el server de node huérfano.
 * Tanto node-pty como el fallback arrancan el hijo como líder de sesión, así
 * que su pgid es su propio pid y el `-pid` nunca alcanza a la app.
 */
function killProcessTree(pid: number, fallback: () => void): void {
  if (process.platform === 'win32' || !pid) {
    // En Windows no hay grupos de procesos POSIX; node-pty ya mata el árbol.
    fallback()
    return
  }
  try {
    process.kill(-pid, 'SIGHUP')
    // Al que ignore el SIGHUP lo bajamos por las malas un instante después.
    setTimeout(() => {
      try {
        process.kill(-pid, 'SIGKILL')
      } catch {
        /* ya no existe: es el caso feliz */
      }
    }, 150).unref?.()
  } catch {
    fallback()
  }
}

const sessions = new Map<string, Session>()
let counter = 0

/**
 * Copia de la salida de cada sesión para que el bridge local pueda leerla: el
 * scrollback real vive en xterm, dentro del renderer, y desde afuera no se ve.
 */
const MAX_OUTPUT_BYTES = 256 * 1024
/** Sesiones terminadas cuya salida se conserva, para poder leer por qué murieron. */
const MAX_RETAINED_SESSIONS = 20

interface OutputBuffer {
  chunks: string[]
  bytes: number
  /** Si ya se descartó salida vieja: lo que se lee no es todo lo que hubo. */
  dropped: boolean
  running: boolean
  exitCode: number | null
  endedAt: number
}

const outputs = new Map<string, OutputBuffer>()

function record(id: string, data: string): void {
  const buffer = outputs.get(id)
  if (!buffer) return
  buffer.chunks.push(data)
  buffer.bytes += data.length
  while (buffer.bytes > MAX_OUTPUT_BYTES && buffer.chunks.length > 1) {
    buffer.bytes -= buffer.chunks.shift()?.length ?? 0
    buffer.dropped = true
  }
  // Un volcado de una sola pieza más grande que el tope no se puede descartar
  // entero sin perder lo último, que es lo que interesa: se recorta por el final.
  const only = buffer.chunks[0]
  if (buffer.chunks.length === 1 && only.length > MAX_OUTPUT_BYTES) {
    buffer.chunks[0] = only.slice(-MAX_OUTPUT_BYTES)
    buffer.bytes = buffer.chunks[0].length
    buffer.dropped = true
  }
}

/** Deja morir las salidas viejas: sin esto una sesión corta por minuto crece sin techo. */
function pruneRetained(): void {
  const ended = [...outputs.entries()].filter(([, buffer]) => !buffer.running)
  if (ended.length <= MAX_RETAINED_SESSIONS) return
  ended
    .sort((a, b) => a[1].endedAt - b[1].endedAt)
    .slice(0, ended.length - MAX_RETAINED_SESSIONS)
    .forEach(([id]) => outputs.delete(id))
}

function markEnded(id: string, exitCode: number | null): void {
  const buffer = outputs.get(id)
  if (!buffer) return
  buffer.running = false
  buffer.exitCode = exitCode
  buffer.endedAt = Date.now()
  pruneRetained()
}

export interface SessionOutput {
  text: string
  running: boolean
  exitCode: number | null
  /** `true` si el buffer ya descartó salida vieja por el tope de tamaño. */
  truncated: boolean
}

export function readOutput(id: string): SessionOutput | null {
  const buffer = outputs.get(id)
  if (!buffer) return null
  return {
    text: buffer.chunks.join(''),
    running: buffer.running,
    exitCode: buffer.exitCode,
    truncated: buffer.dropped
  }
}

function nextId(): string {
  counter += 1
  return `t${counter}_${Date.now().toString(36)}`
}

/** Shell por defecto de la plataforma, con los flags para que sea login shell. */
function defaultShell(): { file: string; args: string[] } {
  if (process.platform === 'win32') {
    return { file: process.env.COMSPEC?.endsWith('cmd.exe') ? 'powershell.exe' : 'powershell.exe', args: [] }
  }
  const shell = process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash')
  // `-l` carga el perfil del usuario: sin esto una app de GUI en macOS arranca
  // con un PATH mínimo y no encuentra node, nvm, homebrew, etc.
  return { file: shell, args: ['-l'] }
}

function buildEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') env[key] = value
  }
  // Estas las inyecta Electron y confunden a los procesos hijos.
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_NO_ATTACH_CONSOLE
  env.TERM = 'xterm-256color'
  env.COLORTERM = 'truecolor'
  if (!env.LANG && process.platform !== 'win32') env.LANG = 'en_US.UTF-8'
  return env
}

/** Escapa el salto de línea final: la shell ejecuta al recibir `\r`. */
function commandLine(command: string): string {
  return `${command.replace(/[\r\n]+$/, '')}\r`
}

export function createSession(
  sender: WebContents,
  options: SessionOptions
): SessionCreated {
  const id = nextId()
  const cwd = options.cwd || os.homedir()
  const cols = options.cols ?? 80
  const rows = options.rows ?? 24
  const env = buildEnv()
  const { file, args } = defaultShell()

  outputs.set(id, {
    chunks: [],
    bytes: 0,
    dropped: false,
    running: true,
    exitCode: null,
    endedAt: 0
  })

  // Único punto por el que sale todo: engancharse acá evita que un camino
  // (pty o fallback) quede sin registrar.
  const send = (channel: string, payload: unknown): void => {
    if (channel === 'session:data') record(id, (payload as { data: string }).data)
    if (channel === 'session:exit') markEnded(id, (payload as { exitCode: number }).exitCode)
    if (!sender.isDestroyed()) sender.send(channel, payload)
  }

  const pty = loadPty()

  if (pty) {
    const proc = pty.spawn(file, args, { name: 'xterm-256color', cwd, env, cols, rows })
    proc.onData((data) => send('session:data', { id, data }))
    proc.onExit(({ exitCode, signal }) => {
      sessions.delete(id)
      send('session:exit', { id, exitCode, signal })
    })

    const session: Session = {
      id,
      usesPty: true,
      write: (data) => proc.write(data),
      resize: (c, r) => {
        try {
          proc.resize(Math.max(c, 1), Math.max(r, 1))
        } catch {
          /* la sesión pudo haber muerto entre el resize y el render */
        }
      },
      kill: () =>
        killProcessTree(proc.pid, () => {
          try {
            proc.kill()
          } catch {
            /* ya terminó */
          }
        })
    }
    sessions.set(id, session)

    // La shell interactiva queda viva después del comando, así el usuario
    // puede seguir trabajando en la misma pestaña.
    if (options.command) proc.write(commandLine(options.command))

    return { id, pty: true }
  }

  // --- Fallback sin TTY -----------------------------------------------------
  const child: ChildProcessWithoutNullStreams = spawnProcess(file, args, {
    cwd,
    env,
    windowsHide: true,
    // Grupo de procesos propio, para poder matar el árbol sin tocar la app.
    detached: process.platform !== 'win32'
  }) as ChildProcessWithoutNullStreams

  // Sin TTY los saltos de línea vienen como `\n` y xterm necesita `\r\n`.
  const forward = (chunk: Buffer): void =>
    send('session:data', { id, data: chunk.toString('utf8').replace(/(?<!\r)\n/g, '\r\n') })

  child.stdout.on('data', forward)
  child.stderr.on('data', forward)
  child.on('error', (err) => send('session:data', { id, data: `\r\n[devapp] ${err.message}\r\n` }))
  child.on('exit', (code, signal) => {
    sessions.delete(id)
    send('session:exit', { id, exitCode: code ?? 0, signal: signal ? 1 : undefined })
  })

  const session: Session = {
    id,
    usesPty: false,
    write: (data) => {
      if (child.stdin.writable) child.stdin.write(data)
    },
    resize: () => {
      /* sin TTY no hay resize */
    },
    kill: () => killProcessTree(child.pid ?? 0, () => child.kill('SIGKILL'))
  }
  sessions.set(id, session)

  if (options.command) session.write(commandLine(options.command))

  return { id, pty: false }
}

export function writeSession(id: string, data: string): void {
  sessions.get(id)?.write(data)
}

export function resizeSession(id: string, cols: number, rows: number): void {
  sessions.get(id)?.resize(cols, rows)
}

export function killSession(id: string): void {
  const session = sessions.get(id)
  if (!session) return
  session.kill()
  sessions.delete(id)
  markEnded(id, null)
}

export function killAllSessions(): void {
  for (const session of sessions.values()) session.kill()
  sessions.clear()
  outputs.clear()
}
