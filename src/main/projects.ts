import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { ProjectInfo } from '../shared/types'

const SCRIPT_EXTENSIONS = ['.js', '.mjs', '.cjs', '.ts', '.mts']
const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'out', 'build', '.next', 'coverage'])

function detectPackageManager(dir: string): ProjectInfo['packageManager'] {
  if (existsSync(join(dir, 'pnpm-lock.yaml'))) return 'pnpm'
  if (existsSync(join(dir, 'yarn.lock'))) return 'yarn'
  if (existsSync(join(dir, 'bun.lockb')) || existsSync(join(dir, 'bun.lock'))) return 'bun'
  if (existsSync(join(dir, 'package-lock.json'))) return 'npm'
  return existsSync(join(dir, 'package.json')) ? 'npm' : null
}

function readScripts(dir: string): Record<string, string> {
  const pkgPath = join(dir, 'package.json')
  if (!existsSync(pkgPath)) return {}
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { scripts?: Record<string, string> }
    if (!pkg.scripts || typeof pkg.scripts !== 'object') return {}
    const scripts: Record<string, string> = {}
    for (const [name, cmd] of Object.entries(pkg.scripts)) {
      if (typeof cmd === 'string') scripts[name] = cmd
    }
    return scripts
  } catch {
    return {}
  }
}

function readBranch(dir: string): string | null {
  const headPath = join(dir, '.git', 'HEAD')
  if (!existsSync(headPath)) return null
  try {
    const head = readFileSync(headPath, 'utf8').trim()
    const match = head.match(/^ref:\s*refs\/heads\/(.+)$/)
    return match ? match[1] : head.slice(0, 7)
  } catch {
    return null
  }
}

/** Archivos ejecutables con node en la raíz y en `scripts/`. */
function findNodeFiles(dir: string): string[] {
  const found: string[] = []

  const scan = (base: string, prefix: string): void => {
    let entries: string[]
    try {
      entries = readdirSync(base)
    } catch {
      return
    }
    for (const entry of entries) {
      if (found.length >= 50) return
      if (entry.startsWith('.') || IGNORED_DIRS.has(entry)) continue
      if (!SCRIPT_EXTENSIONS.some((ext) => entry.endsWith(ext))) continue
      if (entry.endsWith('.d.ts')) continue
      found.push(prefix ? `${prefix}/${entry}` : entry)
    }
  }

  scan(dir, '')
  const scriptsDir = join(dir, 'scripts')
  if (existsSync(scriptsDir)) {
    try {
      if (statSync(scriptsDir).isDirectory()) scan(scriptsDir, 'scripts')
    } catch {
      /* sin permisos */
    }
  }

  return found.sort()
}

export function inspectProject(dir: string): ProjectInfo {
  if (!existsSync(dir)) {
    return {
      exists: false,
      isGitRepo: false,
      branch: null,
      packageManager: null,
      scripts: {},
      nodeFiles: []
    }
  }

  return {
    exists: true,
    isGitRepo: existsSync(join(dir, '.git')),
    branch: readBranch(dir),
    packageManager: detectPackageManager(dir),
    scripts: readScripts(dir),
    nodeFiles: findNodeFiles(dir)
  }
}
