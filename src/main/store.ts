import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { Folder, Project, Task, TaskStep, Workspace } from '../shared/types'

function storePath(): string {
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'workspace.json')
}

function id(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function read(): Workspace {
  const file = storePath()
  if (!existsSync(file)) return { projects: [], folders: [], tasks: [] }
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<Workspace>
    return {
      projects: Array.isArray(parsed.projects) ? parsed.projects : [],
      // `projectId` puede faltar en datos guardados por versiones anteriores.
      folders: Array.isArray(parsed.folders)
        ? parsed.folders.map((f) => ({ ...f, projectId: f.projectId ?? null }))
        : [],
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : []
    }
  } catch {
    // Un archivo corrupto no debe impedir arrancar: lo apartamos y empezamos limpio.
    try {
      renameSync(file, `${file}.corrupt-${Date.now()}`)
    } catch {
      /* no-op */
    }
    return { projects: [], folders: [], tasks: [] }
  }
}

/**
 * Descarta pasos que apuntan a carpetas borradas o que ya no pertenecen al
 * proyecto del conjunto, y conjuntos que quedaron sin pasos o sin proyecto.
 */
function pruneTasks(data: Workspace): void {
  const folderById = new Map(data.folders.map((f) => [f.id, f]))
  const projectIds = new Set(data.projects.map((p) => p.id))

  data.tasks = data.tasks
    .filter((task) => projectIds.has(task.projectId))
    .map((task) => ({
      ...task,
      steps: task.steps.filter((step) => {
        const folder = folderById.get(step.folderId)
        return folder !== undefined && folder.projectId === task.projectId
      })
    }))
    .filter((task) => task.steps.length > 0)
}

function write(data: Workspace): Workspace {
  pruneTasks(data)
  writeFileSync(storePath(), JSON.stringify(data, null, 2), 'utf8')
  return data
}

export function getWorkspace(): Workspace {
  return read()
}

/* ---------- carpetas ---------- */

export function addFolders(paths: string[], projectId: string | null = null): Workspace {
  const data = read()
  const byPath = new Map(data.folders.map((f) => [f.path, f]))

  for (const path of paths) {
    const existing = byPath.get(path)
    if (existing) {
      // Ya estaba: si se está agregando a un proyecto, la movemos ahí.
      if (projectId) existing.projectId = projectId
      continue
    }
    const folder: Folder = {
      id: id('f'),
      path,
      name: basename(path) || path,
      addedAt: Date.now(),
      projectId
    }
    data.folders.push(folder)
    byPath.set(path, folder)
  }

  return write(data)
}

export function removeFolder(folderId: string): Workspace {
  const data = read()
  data.folders = data.folders.filter((f) => f.id !== folderId)
  return write(data)
}

export function renameFolder(folderId: string, name: string): Workspace {
  const data = read()
  const folder = data.folders.find((f) => f.id === folderId)
  if (folder) folder.name = name.trim() || basename(folder.path)
  return write(data)
}

export function assignFolder(folderId: string, projectId: string | null): Workspace {
  const data = read()
  const folder = data.folders.find((f) => f.id === folderId)
  if (!folder) return data
  const target = projectId && data.projects.some((p) => p.id === projectId) ? projectId : null
  folder.projectId = target
  return write(data)
}

/* ---------- proyectos ---------- */

export function createProject(name: string, folderIds: string[] = []): Workspace {
  const data = read()
  const project: Project = {
    id: id('p'),
    name: name.trim() || 'Proyecto',
    createdAt: Date.now()
  }
  data.projects.push(project)
  for (const folder of data.folders) {
    if (folderIds.includes(folder.id)) folder.projectId = project.id
  }
  return write(data)
}

export function renameProject(projectId: string, name: string): Workspace {
  const data = read()
  const project = data.projects.find((p) => p.id === projectId)
  if (project) project.name = name.trim() || project.name
  return write(data)
}

/** Borra el proyecto; sus carpetas quedan sueltas, nunca se pierden. */
export function removeProject(projectId: string): Workspace {
  const data = read()
  data.projects = data.projects.filter((p) => p.id !== projectId)
  for (const folder of data.folders) {
    if (folder.projectId === projectId) folder.projectId = null
  }
  return write(data)
}

export function setProjectCollapsed(projectId: string, collapsed: boolean): Workspace {
  const data = read()
  const project = data.projects.find((p) => p.id === projectId)
  if (project) project.collapsed = collapsed
  return write(data)
}

/* ---------- conjuntos de scripts ---------- */

function sanitizeSteps(steps: TaskStep[]): TaskStep[] {
  return (Array.isArray(steps) ? steps : [])
    .filter((step) => step && typeof step.folderId === 'string' && typeof step.command === 'string')
    .map((step) => ({
      folderId: step.folderId,
      command: step.command.trim(),
      label: step.label?.trim() || undefined
    }))
    .filter((step) => step.command.length > 0)
}

export function createTask(projectId: string, name: string, steps: TaskStep[]): Workspace {
  const data = read()
  if (!data.projects.some((p) => p.id === projectId)) return data
  data.tasks.push({
    id: id('t'),
    projectId,
    name: name.trim() || 'Conjunto',
    steps: sanitizeSteps(steps),
    createdAt: Date.now()
  })
  return write(data)
}

export function updateTask(taskId: string, name: string, steps: TaskStep[]): Workspace {
  const data = read()
  const task = data.tasks.find((t) => t.id === taskId)
  if (!task) return data
  task.name = name.trim() || task.name
  task.steps = sanitizeSteps(steps)
  return write(data)
}

export function removeTask(taskId: string): Workspace {
  const data = read()
  data.tasks = data.tasks.filter((t) => t.id !== taskId)
  return write(data)
}
