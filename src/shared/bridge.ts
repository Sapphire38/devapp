/**
 * Protocolo del bridge local: lo que habla el servidor MCP con la app por el
 * socket, y lo que el main le pregunta al renderer para las pestañas.
 */

/** Métodos que el main resuelve solo, sin molestar al renderer. */
export type MainMethod =
  | 'app.info'
  | 'workspace.get'
  | 'workspace.addFolder'
  | 'project.inspect'
  | 'terminal.output'
  | 'terminal.input'
  | 'terminal.kill'

/** Métodos que necesitan el estado de pestañas, que vive en el renderer. */
export type RendererMethod =
  | 'tabs.list'
  | 'tabs.open'
  | 'tabs.close'
  | 'tabs.restart'
  | 'task.run'
  | 'task.stop'

export type BridgeMethod = MainMethod | RendererMethod

export const RENDERER_METHODS: readonly RendererMethod[] = [
  'tabs.list',
  'tabs.open',
  'tabs.close',
  'tabs.restart',
  'task.run',
  'task.stop'
]

export interface BridgeRequest {
  id: number
  method: BridgeMethod
  params?: Record<string, unknown>
}

export interface BridgeResponse {
  id: number
  ok: boolean
  result?: unknown
  error?: string
}

/** Una pestaña como la ve el bridge: sin los campos internos del renderer. */
export interface BridgeTab {
  id: string
  title: string
  folderId: string
  folderName: string
  cwd: string
  command?: string
  taskId?: string
  sessionId: string | null
  /** `null` mientras corre; el código de salida cuando terminó. */
  exitCode: number | null
  running: boolean
}
