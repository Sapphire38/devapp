import type { Dirent } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { extname, join, relative, sep } from 'node:path'
import type {
  DirEntry,
  FileSearchHit,
  FileSearchOptions,
  FileSearchResult
} from '../shared/types'

/** Carpetas en las que el buscador no entra: son ruido y pesan muchísimo. */
const SKIPPED_DIRS = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  'dist',
  'out',
  'build',
  'release',
  '.next',
  '.nuxt',
  '.output',
  '.turbo',
  '.cache',
  '.parcel-cache',
  'coverage',
  '.venv',
  'venv',
  '__pycache__',
  '.gradle',
  '.idea',
  'DerivedData',
  'Pods',
  'target',
  'vendor'
])

/** Extensiones binarias: ni las abrimos en la búsqueda por contenido. */
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.bmp', '.ico', '.icns', '.tiff',
  '.pdf', '.psd', '.sketch', '.fig', '.ai',
  '.zip', '.gz', '.tgz', '.tar', '.rar', '.7z', '.bz2', '.xz',
  '.mp3', '.wav', '.flac', '.ogg', '.mp4', '.mov', '.avi', '.mkv', '.webm',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.dmg', '.pkg', '.exe', '.dll', '.dylib', '.so', '.node', '.wasm', '.class', '.jar',
  '.bin', '.dat', '.db', '.sqlite', '.lock', '.map', '.blockmap', '.tsbuildinfo'
])

const MAX_HITS = 300
const MAX_FILES = 30_000
const MAX_MS = 8_000
/** Archivos más grandes que esto no se leen: son datos, no código. */
const MAX_FILE_BYTES = 1_500_000
const HITS_PER_FILE = 4

/** Contenido de una carpeta, con las carpetas primero. */
export async function readDirectory(dir: string): Promise<DirEntry[]> {
  const dirents = await readdir(dir, { withFileTypes: true })
  const entries: DirEntry[] = []

  for (const dirent of dirents) {
    const path = join(dir, dirent.name)
    let isDirectory = dirent.isDirectory()
    // Un symlink no dice qué apunta: hay que resolverlo para saber si se expande.
    if (dirent.isSymbolicLink()) {
      try {
        isDirectory = (await stat(path)).isDirectory()
      } catch {
        continue
      }
    } else if (!isDirectory && !dirent.isFile()) {
      continue
    }
    entries.push({
      name: dirent.name,
      path,
      isDirectory,
      skipped: isDirectory && SKIPPED_DIRS.has(dirent.name)
    })
  }

  return entries.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
    return a.name.localeCompare(b.name, 'es', { numeric: true, sensitivity: 'base' })
  })
}

/** Recorte de la línea alrededor del match, sin la indentación de adelante. */
function buildPreview(
  line: string,
  index: number,
  length: number
): Pick<FileSearchHit, 'preview' | 'matchStart' | 'matchLength'> {
  const CONTEXT = 48
  const MAX = 260
  const indent = line.length - line.trimStart().length
  const start = index > indent + CONTEXT ? index - CONTEXT : indent
  const cut = start > indent
  const text = (cut ? '…' : '') + line.slice(start, start + MAX).trimEnd()
  return {
    preview: text,
    matchStart: index - start + (cut ? 1 : 0),
    matchLength: length
  }
}

function matchesName(hay: string, needle: string, caseSensitive: boolean): boolean {
  return (caseSensitive ? hay : hay.toLowerCase()).includes(needle)
}

/**
 * Busca por nombre de archivo o por contenido en todas las carpetas del scope.
 * Es async a propósito: el proceso principal también bombea la salida de las
 * terminales, y un recorrido sincrónico las congelaría mientras dura.
 */
export async function searchFiles(options: FileSearchOptions): Promise<FileSearchResult> {
  const query = options.query.trim()
  if (query.length < 2) return { hits: [], truncated: false, scanned: 0 }

  const caseSensitive = options.caseSensitive === true
  const needle = caseSensitive ? query : query.toLowerCase()
  // Si la consulta trae una barra, el usuario está buscando una ruta, no un nombre.
  const byPath = options.mode === 'name' && (query.includes('/') || query.includes(sep))

  const hits: FileSearchHit[] = []
  const startedAt = Date.now()
  let scanned = 0
  let truncated = false

  const overBudget = (): boolean =>
    hits.length >= MAX_HITS || scanned >= MAX_FILES || Date.now() - startedAt > MAX_MS

  for (const root of options.roots) {
    if (truncated) break
    const pending: string[] = [root.path]

    while (pending.length > 0) {
      if (overBudget()) {
        truncated = true
        break
      }
      const dir = pending.pop() as string

      let dirents: Dirent[]
      try {
        dirents = await readdir(dir, { withFileTypes: true })
      } catch {
        continue // sin permisos o borrada mientras buscábamos
      }

      for (const dirent of dirents) {
        if (overBudget()) {
          truncated = true
          break
        }
        const path = join(dir, dirent.name)

        if (dirent.isDirectory()) {
          if (!SKIPPED_DIRS.has(dirent.name)) pending.push(path)
          continue
        }
        // Los symlinks no se siguen: pueden formar ciclos.
        if (!dirent.isFile()) continue
        scanned += 1

        const relPath = relative(root.path, path)
        const base = { rootId: root.id, rootName: root.name, path, relPath }

        if (options.mode === 'name') {
          if (matchesName(byPath ? relPath : dirent.name, needle, caseSensitive)) hits.push(base)
          continue
        }

        if (BINARY_EXTENSIONS.has(extname(dirent.name).toLowerCase())) continue

        let content: Buffer
        try {
          const info = await stat(path)
          if (info.size === 0 || info.size > MAX_FILE_BYTES) continue
          content = await readFile(path)
        } catch {
          continue
        }
        // Un byte nulo al principio es la señal más confiable de binario.
        if (content.subarray(0, 8192).includes(0)) continue

        const text = content.toString('utf8')
        if (!matchesName(text, needle, caseSensitive)) continue

        const lines = text.split('\n')
        let found = 0
        for (let i = 0; i < lines.length && found < HITS_PER_FILE; i += 1) {
          const line = lines[i]
          const index = (caseSensitive ? line : line.toLowerCase()).indexOf(needle)
          if (index < 0) continue
          found += 1
          hits.push({ ...base, line: i + 1, ...buildPreview(line, index, query.length) })
          if (hits.length >= MAX_HITS) break
        }
      }
    }
  }

  return { hits, truncated, scanned }
}
