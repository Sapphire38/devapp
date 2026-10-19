import type { Dirent } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { readGitMetadata } from './git'
import { isDirectoryAsync } from './paths'
import type { PackageManager, ProjectInfo, Subpackage } from '../shared/types'

const SCRIPT_EXTENSIONS = ['.js', '.mjs', '.cjs', '.ts', '.mts']
const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'out', 'build', '.next', 'coverage'])
/** Alcanza para `packages/core/docs/manual/pdf` sin recorrer árboles de fuentes enteros. */
const MAX_SUBPACKAGE_DEPTH = 5
/** Tope de carpetas leídas por inspección: se corre cada vez que se abre una carpeta. */
const MAX_SCANNED_DIRS = 2000
const MAX_SUBPACKAGES = 50

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function detectLockfileManager(dir: string): Promise<PackageManager | null> {
  if (await exists(join(dir, 'pnpm-lock.yaml'))) return 'pnpm'
  if (await exists(join(dir, 'yarn.lock'))) return 'yarn'
  if ((await exists(join(dir, 'bun.lockb'))) || (await exists(join(dir, 'bun.lock')))) return 'bun'
  if (await exists(join(dir, 'package-lock.json'))) return 'npm'
  return null
}

async function detectPackageManager(dir: string): Promise<PackageManager | null> {
  const lockfile = await detectLockfileManager(dir)
  if (lockfile) return lockfile
  return (await exists(join(dir, 'package.json'))) ? 'npm' : null
}

async function readScripts(dir: string): Promise<Record<string, string>> {
  try {
    const raw = await readFile(join(dir, 'package.json'), 'utf8')
    const pkg = JSON.parse(raw) as { scripts?: Record<string, string> }
    if (!pkg.scripts || typeof pkg.scripts !== 'object') return {}
    const scripts: Record<string, string> = {}
    for (const [name, cmd] of Object.entries(pkg.scripts)) {
      if (typeof cmd === 'string') scripts[name] = cmd
    }
    return scripts
  } catch {
    // Sin package.json, sin permisos o con JSON roto: el panel se ve sin scripts.
    return {}
  }
}

/** Archivos ejecutables con node en la raíz y en `scripts/`. */
async function findNodeFiles(dir: string): Promise<string[]> {
  const found: string[] = []

  const scan = async (base: string, prefix: string): Promise<void> => {
    let entries: string[]
    try {
      entries = await readdir(base)
    } catch {
      return // no existe, no es carpeta o no hay permisos
    }
    for (const entry of entries) {
      if (found.length >= 50) return
      if (entry.startsWith('.') || IGNORED_DIRS.has(entry)) continue
      if (!SCRIPT_EXTENSIONS.some((ext) => entry.endsWith(ext))) continue
      if (entry.endsWith('.d.ts')) continue
      found.push(prefix ? `${prefix}/${entry}` : entry)
    }
  }

  await scan(dir, '')
  await scan(join(dir, 'scripts'), 'scripts')

  return found.sort()
}

/**
 * Lo que costó armar los subpaquetes de una carpeta, con el mtime de todo lo
 * que determinó el resultado: las carpetas miradas (su mtime cambia si
 * aparece o desaparece un `package.json`, un lockfile o una subcarpeta) y los
 * `package.json` leídos (su mtime cambia si le agregan un script).
 */
interface SubpackageScan {
  rootManager: PackageManager
  subpackages: Subpackage[]
  stamps: Map<string, number>
}

/**
 * El escaneo es lo más caro de `inspectProject` y la ventana la reinspecciona
 * entera cada vez que recupera el foco. Guardarlo por carpeta deja ese camino
 * en un puñado de `stat`, mientras que la rama de git y los scripts de la raíz
 * —que es lo que el foco viene a actualizar— se siguen releyendo siempre.
 */
const scanCache = new Map<string, SubpackageScan>()

/** Basta con que un mtime no coincida para rescanear: no hay invalidación parcial. */
async function stampsMatch(stamps: Map<string, number>): Promise<boolean> {
  const checks = await Promise.all(
    [...stamps].map(async ([path, mtimeMs]) => {
      try {
        return (await stat(path)).mtimeMs === mtimeMs
      } catch {
        return false
      }
    })
  )
  return checks.every(Boolean)
}

async function scanSubpackages(root: string, rootManager: PackageManager): Promise<SubpackageScan> {
  const found: Subpackage[] = []
  const stamps = new Map<string, number>()
  let scannedDirs = 0

  /**
   * Devuelve `false` si la ruta no existe. El mtime se toma *antes* de leer:
   * si algo cambia entremedio, el sello queda viejo y la próxima inspección
   * rescanea de más, que es el lado seguro del error.
   */
  const stamp = async (path: string): Promise<boolean> => {
    try {
      stamps.set(path, (await stat(path)).mtimeMs)
      return true
    } catch {
      return false
    }
  }

  const walk = async (dir: string, relDir: string, depth: number): Promise<void> => {
    if (depth > MAX_SUBPACKAGE_DEPTH) return
    let entries: Dirent[]
    try {
      // Ordenadas para que el tope deje afuera siempre los mismos paquetes.
      entries = (await readdir(dir, { withFileTypes: true })).sort((a, b) =>
        a.name.localeCompare(b.name)
      )
    } catch {
      return
    }
    for (const entry of entries) {
      if (found.length >= MAX_SUBPACKAGES || scannedDirs >= MAX_SCANNED_DIRS) return
      if (!entry.isDirectory() || entry.name.startsWith('.') || IGNORED_DIRS.has(entry.name)) continue
      scannedDirs++
      const childDir = join(dir, entry.name)
      const childRelDir = relDir ? `${relDir}/${entry.name}` : entry.name
      await stamp(childDir)
      const scripts = (await stamp(join(childDir, 'package.json'))) ? await readScripts(childDir) : {}
      if (Object.keys(scripts).length > 0) {
        // `findNodeFiles` también lee `scripts/`, que no está en el recorrido.
        await stamp(join(childDir, 'scripts'))
        found.push({
          relDir: childRelDir,
          path: childDir,
          packageManager: (await detectLockfileManager(childDir)) ?? rootManager,
          scripts,
          nodeFiles: await findNodeFiles(childDir)
        })
      }
      await walk(childDir, childRelDir, depth + 1)
    }
  }

  await stamp(root)
  await walk(root, '', 1)
  return {
    rootManager,
    subpackages: found.sort((a, b) => a.relDir.localeCompare(b.relDir)),
    stamps
  }
}

/**
 * package.json con scripts en subcarpetas. En un workspace el lockfile vive en
 * la raíz, así que sin lockfile propio el paquete usa el gestor de la raíz.
 */
async function findSubpackages(root: string, rootManager: PackageManager): Promise<Subpackage[]> {
  const cached = scanCache.get(root)
  // El gestor de la raíz es parte del resultado: si cambió, lo cacheado no sirve.
  if (cached && cached.rootManager === rootManager && (await stampsMatch(cached.stamps))) {
    return cached.subpackages
  }
  const scan = await scanSubpackages(root, rootManager)
  scanCache.set(root, scan)
  return scan.subpackages
}

/**
 * Es async a propósito: el proceso principal también bombea la salida de las
 * terminales, y recorrer un monorepo sincrónicamente las congelaría mientras
 * dura (la ventana reinspecciona todas sus carpetas en cada foco).
 */
export async function inspectProject(dir: string): Promise<ProjectInfo> {
  if (!(await isDirectoryAsync(dir))) {
    return {
      exists: false,
      isGitRepo: false,
      branch: null,
      packageManager: null,
      scripts: {},
      subpackages: [],
      nodeFiles: []
    }
  }

  const git = readGitMetadata(dir)
  const packageManager = await detectPackageManager(dir)
  return {
    exists: true,
    isGitRepo: git !== null,
    branch: git?.branch ?? null,
    packageManager,
    scripts: await readScripts(dir),
    subpackages: await findSubpackages(dir, packageManager ?? 'npm'),
    nodeFiles: await findNodeFiles(dir)
  }
}
