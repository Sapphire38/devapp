import type { ProjectInfo, SessionCreated, SessionOptions, TaskStep, Workspace } from './types'

export interface AppInfo {
  platform: NodeJS.Platform
  version: string
  pty: { available: boolean; error: string | null }
}

export type MenuAction =
  | 'add-folder'
  | 'new-project'
  | 'new-terminal'
  | 'open-all-terminals'
  | 'close-tab'
  | 'toggle-panel'

/** Contrato del bridge expuesto por el preload en `window.api`. */
export interface DevAppApi {
  getInfo(): Promise<AppInfo>

  workspace: {
    get(): Promise<Workspace>
    /** Abre el diálogo nativo; si se pasa `projectId`, las agrega a ese proyecto. */
    pickFolders(projectId?: string | null): Promise<Workspace>
    addPaths(paths: string[], projectId?: string | null): Promise<Workspace>
    removeFolder(folderId: string): Promise<Workspace>
    renameFolder(folderId: string, name: string): Promise<Workspace>
    assignFolder(folderId: string, projectId: string | null): Promise<Workspace>
    createProject(name: string, folderIds?: string[]): Promise<Workspace>
    renameProject(projectId: string, name: string): Promise<Workspace>
    removeProject(projectId: string): Promise<Workspace>
    setProjectCollapsed(projectId: string, collapsed: boolean): Promise<Workspace>
    createTask(projectId: string, name: string, steps: TaskStep[]): Promise<Workspace>
    updateTask(taskId: string, name: string, steps: TaskStep[]): Promise<Workspace>
    removeTask(taskId: string): Promise<Workspace>
  }

  project: {
    inspect(path: string): Promise<ProjectInfo>
  }

  reveal(path: string): Promise<void>

  /** Resuelve rutas reales de archivos soltados sobre la ventana (drag & drop). */
  pathsFromDrop(files: File[]): string[]

  onMenuAction(listener: (action: MenuAction) => void): () => void

  session: {
    create(options: SessionOptions): Promise<SessionCreated>
    write(id: string, data: string): void
    resize(id: string, cols: number, rows: number): void
    kill(id: string): void
    onData(listener: (id: string, data: string) => void): () => void
    onExit(listener: (id: string, exitCode: number) => void): () => void
  }
}
