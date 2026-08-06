import { useState } from 'react'
import { runNodeFileCommand, runScriptCommand } from '../../../shared/commands'
import type { Folder, ProjectInfo } from '../../../shared/types'

export interface PanelEntry {
  folder: Folder
  info: ProjectInfo | null
}

interface Props {
  entries: PanelEntry[]
  /** En un proyecto mostramos de qué carpeta es cada bloque. */
  showFolderNames: boolean
  onRun: (folder: Folder, command: string, title: string) => void
  onOpenTerminal: (folder: Folder) => void
}

function FolderBlock({
  folder,
  info,
  showName,
  onRun,
  onOpenTerminal
}: PanelEntry & {
  showName: boolean
  onRun: Props['onRun']
  onOpenTerminal: Props['onOpenTerminal']
}): React.JSX.Element {
  const [command, setCommand] = useState('')

  const scripts = info ? Object.entries(info.scripts) : []
  const nodeFiles = info?.nodeFiles ?? []

  const submit = (event: React.FormEvent): void => {
    event.preventDefault()
    const trimmed = command.trim()
    if (!trimmed) return
    onRun(folder, trimmed, trimmed.length > 28 ? `${trimmed.slice(0, 28)}…` : trimmed)
    setCommand('')
  }

  return (
    <div className="panel-block">
      {showName && (
        <div className="block-head">
          <span className="block-name">{folder.name}</span>
          {info?.branch && <span className="chip-branch">⎇ {info.branch}</span>}
          {info?.packageManager && <span className="block-meta">{info.packageManager}</span>}
          {info && !info.exists && <span className="block-missing">no encontrada</span>}
          <button className="btn ghost sm" onClick={() => onOpenTerminal(folder)}>
            Terminal acá
          </button>
        </div>
      )}

      {scripts.length > 0 && (
        <div className="panel-row">
          {!showName && (
            <div className="panel-label">
              Scripts de package.json {info?.packageManager && `· ${info.packageManager}`}
            </div>
          )}
          <div className="chips">
            {scripts.map(([name, script]) => {
              const cmd = runScriptCommand(info?.packageManager ?? null, name)
              return (
                <button
                  key={name}
                  className="chip"
                  title={script}
                  onClick={() => onRun(folder, cmd, cmd)}
                >
                  <span className="play">▶</span>
                  {name}
                  <code>{script}</code>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {nodeFiles.length > 0 && (
        <div className="panel-row">
          {!showName && <div className="panel-label">Archivos ejecutables con node</div>}
          <div className="chips">
            {nodeFiles.map((file) => {
              const cmd = runNodeFileCommand(file)
              return (
                <button
                  key={file}
                  className="chip"
                  title={cmd}
                  onClick={() => onRun(folder, cmd, file)}
                >
                  <span className="play">▶</span>
                  {file}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {scripts.length === 0 && nodeFiles.length === 0 && (
        <div className="panel-row panel-empty">
          Sin <code>package.json</code> ni archivos <code>.js</code> en la raíz.
        </div>
      )}

      <div className="panel-row">
        <form className="cmd-form" onSubmit={submit}>
          <input
            className="cmd-input"
            value={command}
            onChange={(event) => setCommand(event.target.value)}
            placeholder={`Ejecutar un comando en ${folder.name}…`}
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
          />
          <button className="btn primary sm" type="submit" disabled={!command.trim()}>
            Ejecutar
          </button>
        </form>
      </div>
    </div>
  )
}

export default function ProjectPanel({
  entries,
  showFolderNames,
  onRun,
  onOpenTerminal
}: Props): React.JSX.Element {
  return (
    <section className="panel">
      {entries.map((entry) => (
        <FolderBlock
          key={entry.folder.id}
          folder={entry.folder}
          info={entry.info}
          showName={showFolderNames}
          onRun={onRun}
          onOpenTerminal={onOpenTerminal}
        />
      ))}
    </section>
  )
}
