export interface Folder {
  id: string
  path: string
  name: string
  addedAt: number
  /** Proyecto al que pertenece; `null` si es una carpeta suelta. */
  projectId: string | null
}

export interface Project {
  id: string
  name: string
  createdAt: number
  collapsed?: boolean
}

/** Un comando concreto a correr en una carpeta puntual. */
export interface TaskStep {
  folderId: string
  command: string
  /** Nombre corto para la pestaña; por defecto, el comando. */
  label?: string
}

/**
 * Conjunto de comandos de un proyecto que se lanzan juntos, cada uno en su
 * carpeta y en su propia terminal. Ej: `npm run dev` en la API + en el cliente.
 */
export interface Task {
  id: string
  projectId: string
  name: string
  steps: TaskStep[]
  createdAt: number
}

export interface Workspace {
  projects: Project[]
  folders: Folder[]
  tasks: Task[]
}

export interface ProjectInfo {
  exists: boolean
  isGitRepo: boolean
  branch: string | null
  packageManager: 'npm' | 'yarn' | 'pnpm' | 'bun' | null
  scripts: Record<string, string>
  nodeFiles: string[]
}

export interface SessionOptions {
  cwd: string
  /** Comando a ejecutar en vez de abrir una shell interactiva. */
  command?: string
  cols?: number
  rows?: number
}

export interface SessionCreated {
  id: string
  /** `false` cuando node-pty no está disponible y se usó el fallback por pipes. */
  pty: boolean
}

export interface SessionExit {
  id: string
  exitCode: number
  signal?: number
}

/** Qué está seleccionado en el sidebar. */
export type Selection = { type: 'project'; id: string } | { type: 'folder'; id: string }
