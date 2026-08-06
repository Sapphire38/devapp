import type { ProjectInfo } from './types'

/** Comando concreto para correr un script de package.json con el PM detectado. */
export function runScriptCommand(pm: ProjectInfo['packageManager'], script: string): string {
  switch (pm) {
    case 'pnpm':
      return `pnpm run ${script}`
    case 'yarn':
      return `yarn ${script}`
    case 'bun':
      return `bun run ${script}`
    default:
      return `npm run ${script}`
  }
}

/** Comando para ejecutar un archivo con node, citando la ruta por si tiene espacios. */
export function runNodeFileCommand(file: string): string {
  const quoted = /[\s'"()]/.test(file) ? `"${file}"` : file
  return file.endsWith('.ts') || file.endsWith('.mts')
    ? `node --experimental-strip-types ${quoted}`
    : `node ${quoted}`
}
