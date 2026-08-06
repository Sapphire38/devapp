import { useEffect, useRef, useState } from 'react'
import { runNodeFileCommand, runScriptCommand } from '../../../shared/commands'
import type { Folder, ProjectInfo, Task, TaskStep } from '../../../shared/types'

interface Props {
  /** `null` cuando se está creando uno nuevo. */
  task: Task | null
  folders: Folder[]
  infos: Record<string, ProjectInfo>
  onCancel: () => void
  onSave: (name: string, steps: TaskStep[]) => void
}

const sameStep = (a: TaskStep, b: TaskStep): boolean =>
  a.folderId === b.folderId && a.command === b.command

export default function TaskEditor({
  task,
  folders,
  infos,
  onCancel,
  onSave
}: Props): React.JSX.Element {
  const [name, setName] = useState(task?.name ?? '')
  const [steps, setSteps] = useState<TaskStep[]>(task?.steps ?? [])
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    nameRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const toggle = (step: TaskStep): void => {
    setSteps((prev) =>
      prev.some((s) => sameStep(s, step))
        ? prev.filter((s) => !sameStep(s, step))
        : [...prev, step]
    )
  }

  const isOn = (step: TaskStep): boolean => steps.some((s) => sameStep(s, step))

  const addCustom = (folderId: string): void => {
    const command = (drafts[folderId] ?? '').trim()
    if (!command) return
    const step: TaskStep = { folderId, command }
    if (!isOn(step)) setSteps((prev) => [...prev, step])
    setDrafts((prev) => ({ ...prev, [folderId]: '' }))
  }

  const canSave = name.trim().length > 0 && steps.length > 0

  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <div
        className="modal"
        role="dialog"
        aria-label="Editar conjunto de scripts"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal-head">
          <h2>{task ? 'Editar conjunto' : 'Nuevo conjunto'}</h2>
          <button className="btn ghost sm" onClick={onCancel}>
            Cerrar
          </button>
        </header>

        <div className="modal-body">
          <label className="field">
            <span className="panel-label">Nombre</span>
            <input
              ref={nameRef}
              className="cmd-input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Ej: Levantar todo"
              spellCheck={false}
            />
          </label>

          <div className="panel-label" style={{ marginTop: 16 }}>
            Elegí qué correr en cada carpeta
          </div>

          {folders.map((folder) => {
            const info = infos[folder.id]
            const scripts = info ? Object.entries(info.scripts) : []
            const files = info?.nodeFiles ?? []
            // Comandos elegidos a mano para esta carpeta, para poder mostrarlos.
            const customs = steps.filter(
              (s) =>
                s.folderId === folder.id &&
                !scripts.some(([n]) => runScriptCommand(info?.packageManager ?? null, n) === s.command) &&
                !files.some((f) => runNodeFileCommand(f) === s.command)
            )

            return (
              <div key={folder.id} className="editor-block">
                <div className="block-head">
                  <span className="block-name">{folder.name}</span>
                  {info?.branch && <span className="chip-branch">⎇ {info.branch}</span>}
                </div>

                {scripts.length + files.length === 0 && (
                  <div className="panel-empty">Sin scripts detectados en esta carpeta.</div>
                )}

                <div className="chips">
                  {scripts.map(([scriptName, script]) => {
                    const step: TaskStep = {
                      folderId: folder.id,
                      command: runScriptCommand(info?.packageManager ?? null, scriptName),
                      label: scriptName
                    }
                    return (
                      <button
                        key={scriptName}
                        className={`chip selectable${isOn(step) ? ' on' : ''}`}
                        title={script}
                        onClick={() => toggle(step)}
                      >
                        <span className="check">{isOn(step) ? '✓' : '+'}</span>
                        {scriptName}
                      </button>
                    )
                  })}

                  {files.map((file) => {
                    const step: TaskStep = {
                      folderId: folder.id,
                      command: runNodeFileCommand(file),
                      label: file
                    }
                    return (
                      <button
                        key={file}
                        className={`chip selectable${isOn(step) ? ' on' : ''}`}
                        onClick={() => toggle(step)}
                      >
                        <span className="check">{isOn(step) ? '✓' : '+'}</span>
                        {file}
                      </button>
                    )
                  })}

                  {customs.map((step) => (
                    <button
                      key={step.command}
                      className="chip selectable on"
                      title="Quitar del conjunto"
                      onClick={() => toggle(step)}
                    >
                      <span className="check">✓</span>
                      <code>{step.command}</code>
                    </button>
                  ))}
                </div>

                <form
                  className="cmd-form"
                  style={{ marginTop: 8 }}
                  onSubmit={(event) => {
                    event.preventDefault()
                    addCustom(folder.id)
                  }}
                >
                  <input
                    className="cmd-input"
                    value={drafts[folder.id] ?? ''}
                    onChange={(event) =>
                      setDrafts((prev) => ({ ...prev, [folder.id]: event.target.value }))
                    }
                    placeholder={`Otro comando en ${folder.name}…`}
                    spellCheck={false}
                  />
                  <button
                    className="btn sm"
                    type="submit"
                    disabled={!(drafts[folder.id] ?? '').trim()}
                  >
                    Agregar
                  </button>
                </form>
              </div>
            )
          })}
        </div>

        <footer className="modal-foot">
          <span className="modal-count">
            {steps.length === 0
              ? 'Ningún comando elegido'
              : `${steps.length} ${steps.length === 1 ? 'comando' : 'comandos'} · se abre una terminal por cada uno`}
          </span>
          <button className="btn ghost sm" onClick={onCancel}>
            Cancelar
          </button>
          <button
            className="btn primary sm"
            disabled={!canSave}
            onClick={() => onSave(name, steps)}
          >
            Guardar
          </button>
        </footer>
      </div>
    </div>
  )
}
