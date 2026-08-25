import type { Folder, Task } from '../../../shared/types'

interface Props {
  tasks: Task[]
  folders: Folder[]
  /** Terminales vivas por conjunto, para poder frenarlas. */
  runningByTask: Record<string, number>
  onRun: (task: Task) => void
  onStop: (taskId: string) => void
  onEdit: (task: Task) => void
  onRemove: (taskId: string) => void
  onCreate: () => void
}

export default function TaskBar({
  tasks,
  folders,
  runningByTask,
  onRun,
  onStop,
  onEdit,
  onRemove,
  onCreate
}: Props): React.JSX.Element {
  const folderName = (id: string): string => folders.find((f) => f.id === id)?.name ?? '?'

  return (
    <section className="taskbar">
      <div className="panel-label">Conjuntos</div>
      <div className="chips">
        {tasks.map((task) => {
          const running = runningByTask[task.id] ?? 0
          return (
            <div key={task.id} className={`task-chip${running > 0 ? ' running' : ''}`}>
              <button
                className="task-run"
                onClick={() => onRun(task)}
                title={task.steps
                  .map((s) => `${folderName(s.folderId)}: ${s.command}`)
                  .join('\n')}
              >
                <span className="play">▶</span>
                <span className="task-name">{task.name}</span>
                <span className="task-count">{running > 0 ? running : task.steps.length}</span>
              </button>
              {running > 0 && (
                <button
                  className="task-action stop"
                  title={`Detener las ${running} terminales de ${task.name}`}
                  onClick={() => onStop(task.id)}
                >
                  ■
                </button>
              )}
              <button className="task-action" title="Editar" onClick={() => onEdit(task)}>
                ✎
              </button>
              <button className="task-action" title="Eliminar" onClick={() => onRemove(task.id)}>
                ×
              </button>
            </div>
          )
        })}

        <button className="chip dashed" onClick={onCreate}>
          + Nuevo conjunto
        </button>
      </div>
    </section>
  )
}
