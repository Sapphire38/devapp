import { useEffect, useRef, useState } from 'react'
import { runNodeFileCommand, runScriptCommand } from '../../../shared/commands'
import {
  ROOT_REL_DIR,
  type ScriptSource,
  scriptSources,
  subpackageLabel
} from '../../../shared/scriptSources'
import type { Folder, ProjectInfo, Task, TaskStep } from '../../../shared/types'

interface Props {
  /** `null` cuando se está creando uno nuevo. */
  task: Task | null
  folders: Folder[]
  infos: Record<string, ProjectInfo>
  onCancel: () => void
  onSave: (name: string, steps: TaskStep[]) => void
}

/** El mismo comando en la raíz y en un subpaquete son dos pasos distintos. */
const sameStep = (a: TaskStep, b: TaskStep): boolean =>
  a.folderId === b.folderId && a.command === b.command && (a.relDir ?? '') === (b.relDir ?? '')

/** Título de la terminal del paso: en un subpaquete, con el paquete adelante. */
function stepLabel(source: ScriptSource | undefined, text: string): string {
  return source && source.relDir !== ROOT_REL_DIR ? `${source.label} · ${text}` : text
}

/** Pestañas para los subpaquetes que usan los pasos y ya no se detectan. */
function orphanSources(
  folder: Folder,
  steps: TaskStep[],
  detected: ScriptSource[]
): ScriptSource[] {
  const known = new Set(detected.map((source) => source.relDir))
  const used = steps.map((step) => step.relDir ?? ROOT_REL_DIR)
  const missing = [...new Set(used.filter((relDir) => relDir && !known.has(relDir)))]
  return missing.sort().map((relDir) => ({
    relDir,
    label: subpackageLabel(relDir),
    location: `${folder.name}/${relDir}`,
    cwd: `${folder.path}/${relDir}`,
    packageManager: null,
    scripts: [],
    nodeFiles: []
  }))
}

function FolderBlock({
  folder,
  info,
  steps,
  onToggle
}: {
  folder: Folder
  info: ProjectInfo | undefined
  steps: TaskStep[]
  onToggle: (step: TaskStep) => void
}): React.JSX.Element {
  const [draft, setDraft] = useState('')
  const [selectedRelDir, setSelectedRelDir] = useState(ROOT_REL_DIR)

  const stepsHere = steps.filter((s) => s.folderId === folder.id)
  // La raíz siempre está, aunque no tenga scripts: ahí se escriben comandos a mano.
  const detected = scriptSources(folder, info ?? null, { keepEmptyRoot: true })
  // Un paso puede apuntar a un subpaquete que hoy no está (otra rama, sin
  // instalar): sin su pestaña quedaría invisible y no se podría sacar.
  const sources = [...detected, ...orphanSources(folder, stepsHere, detected)]
  // Si la pestaña elegida desaparece al re-inspeccionar, se vuelve a la primera.
  const source = sources.find((candidate) => candidate.relDir === selectedRelDir) ?? sources[0]
  const relDir = source?.relDir || undefined
  const scripts = source?.scripts ?? []
  const files = source?.nodeFiles ?? []

  const isOn = (step: TaskStep): boolean => stepsHere.some((s) => sameStep(s, step))
  // Comandos elegidos a mano en esta pestaña, para poder mostrarlos.
  const customs = stepsHere.filter(
    (s) =>
      (s.relDir ?? '') === (source?.relDir ?? '') &&
      !scripts.some(([n]) => runScriptCommand(source?.packageManager ?? null, n) === s.command) &&
      !files.some((f) => runNodeFileCommand(f) === s.command)
  )

  const addCustom = (): void => {
    const command = draft.trim()
    if (!command) return
    const step: TaskStep = { folderId: folder.id, command, relDir }
    if (!isOn(step)) onToggle(step)
    setDraft('')
  }

  return (
    <div className="editor-block">
      <div className="block-head">
        <span className="block-name">{folder.name}</span>
        {info?.branch && <span className="chip-branch">⎇ {info.branch}</span>}
      </div>

      {sources.length > 1 && (
        <div className="pkg-tabs" role="group" aria-label="Carpetas con scripts">
          {sources.map((tab) => {
            const chosen = stepsHere.filter((s) => (s.relDir ?? '') === tab.relDir).length
            return (
              <button
                key={tab.relDir}
                type="button"
                className={`pkg-tab${tab === source ? ' active' : ''}`}
                aria-pressed={tab === source}
                title={tab.location}
                onClick={() => setSelectedRelDir(tab.relDir)}
              >
                {tab.label}
                {chosen > 0 && <span className="pkg-tab-count">{chosen}</span>}
              </button>
            )
          })}
        </div>
      )}

      {scripts.length + files.length === 0 && (
        <div className="panel-empty">
          Sin scripts detectados en {source?.location ?? folder.name}.
        </div>
      )}

      <div className="chips">
        {scripts.map(([scriptName, script]) => {
          const step: TaskStep = {
            folderId: folder.id,
            command: runScriptCommand(source?.packageManager ?? null, scriptName),
            label: stepLabel(source, scriptName),
            relDir
          }
          return (
            <button
              key={scriptName}
              className={`chip selectable${isOn(step) ? ' on' : ''}`}
              title={script}
              onClick={() => onToggle(step)}
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
            label: stepLabel(source, file),
            relDir
          }
          return (
            <button
              key={file}
              className={`chip selectable${isOn(step) ? ' on' : ''}`}
              onClick={() => onToggle(step)}
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
            onClick={() => onToggle(step)}
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
          addCustom()
        }}
      >
        <input
          className="cmd-input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={`Otro comando en ${source?.location ?? folder.name}…`}
          spellCheck={false}
        />
        <button className="btn sm" type="submit" disabled={!draft.trim()}>
          Agregar
        </button>
      </form>
    </div>
  )
}

export default function TaskEditor({
  task,
  folders,
  infos,
  onCancel,
  onSave
}: Props): React.JSX.Element {
  const [name, setName] = useState(task?.name ?? '')
  const [steps, setSteps] = useState<TaskStep[]>(task?.steps ?? [])
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

          {folders.map((folder) => (
            <FolderBlock
              key={folder.id}
              folder={folder}
              info={infos[folder.id]}
              steps={steps}
              onToggle={toggle}
            />
          ))}
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
