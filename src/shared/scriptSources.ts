import type { Folder, PackageManager, ProjectInfo } from './types'

/** La raíz de la carpeta abierta, como `relDir`. */
export const ROOT_REL_DIR = ''

/** La raíz o una subcarpeta con package.json: lo que se ejecuta desde una pestaña. */
export interface ScriptSource {
  /** Ruta relativa a la carpeta abierta; `''` es la raíz. */
  relDir: string
  label: string
  /** Ruta desde la carpeta abierta hasta el package.json. */
  location: string
  cwd: string
  packageManager: PackageManager | null
  scripts: [string, string][]
  nodeFiles: string[]
}

/** Pestaña con la carpeta padre del package.json; si está más abajo, `…/carpeta`. */
export function subpackageLabel(relDir: string): string {
  const segments = relDir.split('/')
  const parentName = segments[segments.length - 1]
  return segments.length > 1 ? `…/${parentName}` : parentName
}

/** Dónde corre un paso: la raíz de su carpeta, o el subpaquete que eligió. */
export function subpackageCwd(folderPath: string, relDir: string | undefined): string {
  return relDir ? `${folderPath}/${relDir}` : folderPath
}

/**
 * Las carpetas con scripts de una carpeta abierta, la raíz primero.
 *
 * `keepEmptyRoot` conserva la raíz aunque no tenga nada que ofrecer: en el
 * editor de conjuntos siempre tiene que poder elegirse para escribir un
 * comando a mano, mientras que el panel no muestra una pestaña vacía.
 */
export function scriptSources(
  folder: Folder,
  info: ProjectInfo | null,
  { keepEmptyRoot = false }: { keepEmptyRoot?: boolean } = {}
): ScriptSource[] {
  if (!info) return []
  const sources: ScriptSource[] = info.subpackages.map((pkg) => ({
    relDir: pkg.relDir,
    label: subpackageLabel(pkg.relDir),
    location: `${folder.name}/${pkg.relDir}`,
    cwd: pkg.path,
    packageManager: pkg.packageManager,
    scripts: Object.entries(pkg.scripts),
    nodeFiles: pkg.nodeFiles
  }))
  const rootScripts = Object.entries(info.scripts)
  if (!keepEmptyRoot && rootScripts.length === 0 && info.nodeFiles.length === 0) return sources
  return [
    {
      relDir: ROOT_REL_DIR,
      label: folder.name,
      location: folder.name,
      cwd: folder.path,
      packageManager: info.packageManager,
      scripts: rootScripts,
      nodeFiles: info.nodeFiles
    },
    ...sources
  ]
}
