import type { Folder, Task } from '../../../shared/types'

interface Props {
  tasks: Task[]
  folders: Folder[]
  onRun: (task: Task) => void
  onEdit: (task: Task) => void
  onRemove: (taskId: string) => void
  onCreate: () => void
}

export default function TaskBar({
  tasks,
  folders,
  onRun,
  onEdit,
  onRemove,
  onCreate
}: Props): React.JSX.Element {
  const folderName = (id: string): string => folders.find((f) => f.id === id)?.name ?? '?'

  return (
    <section className="taskbar">
      <div className="panel-label">Conjuntos</div>
      <div className="chips">
        {tasks.map((task) => (
          <div key={task.id} className="task-chip">
            <button
              className="task-run"
              onClick={() => onRun(task)}
              title={task.steps
                .map((s) => `${folderName(s.folderId)}: ${s.command}`)
                .join('\n')}
            >
              <span className="play">▶</span>
              <span className="task-name">{task.name}</span>
              <span className="task-count">{task.steps.length}</span>
            </button>
            <button className="task-action" title="Editar" onClick={() => onEdit(task)}>
              ✎
            </button>
            <button className="task-action" title="Eliminar" onClick={() => onRemove(task.id)}>
              ×
            </button>
          </div>
        ))}

        <button className="chip dashed" onClick={onCreate}>
          + Nuevo conjunto
        </button>
      </div>
    </section>
  )
}
