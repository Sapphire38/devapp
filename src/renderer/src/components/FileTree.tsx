import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  DirEntry,
  FileSearchHit,
  FileSearchResult,
  Folder,
  SearchMode
} from '../../../shared/types'

interface Props {
  folders: Folder[]
  /** Abre una terminal parada en una subcarpeta del árbol. */
  onOpenTerminal: (folder: Folder, cwd: string, title: string) => void
  /** Se incrementa desde el menú (⌘F) para traer el foco al buscador. */
  focusToken: number
}

const MIN_QUERY = 2

function Chevron({ open }: { open: boolean }): React.JSX.Element {
  return (
    <svg
      className={`fs-chevron${open ? ' open' : ''}`}
      viewBox="0 0 12 12"
      width="10"
      height="10"
      aria-hidden="true"
    >
      <path
        d="M4.5 2.5 L8.5 6 L4.5 9.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** Resalta el tramo que coincidió dentro del recorte de la línea. */
function Highlighted({ hit }: { hit: FileSearchHit }): React.JSX.Element {
  const text = hit.preview ?? ''
  const start = hit.matchStart ?? -1
  const end = start + (hit.matchLength ?? 0)
  if (start < 0 || start >= text.length) return <>{text}</>
  return (
    <>
      {text.slice(0, start)}
      <mark>{text.slice(start, end)}</mark>
      {text.slice(end)}
    </>
  )
}

export default function FileTree({
  folders,
  onOpenTerminal,
  focusToken
}: Props): React.JSX.Element {
  const [children, setChildren] = useState<Record<string, DirEntry[]>>({})
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [failed, setFailed] = useState<Record<string, string>>({})
  const [selected, setSelected] = useState<string | null>(null)

  const [query, setQuery] = useState('')
  const [mode, setMode] = useState<SearchMode>('name')
  const [result, setResult] = useState<FileSearchResult | null>(null)
  const [searching, setSearching] = useState(false)

  const searchRef = useRef<HTMLInputElement>(null)
  const rootKey = folders.map((folder) => folder.path).join('|')

  const load = useCallback(async (path: string) => {
    try {
      const entries = await window.api.files.read(path)
      setChildren((prev) => ({ ...prev, [path]: entries }))
      setFailed((prev) => {
        if (!(path in prev)) return prev
        const next = { ...prev }
        delete next[path]
        return next
      })
    } catch (error) {
      setFailed((prev) => ({ ...prev, [path]: (error as Error).message }))
    }
  }, [])

  // Las raíces del scope arrancan abiertas: es lo primero que uno quiere ver.
  useEffect(() => {
    for (const folder of folders) {
      setExpanded((prev) => (folder.path in prev ? prev : { ...prev, [folder.path]: true }))
      void load(folder.path)
    }
    // rootKey evita recargar en cada render por la identidad del array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootKey, load])

  useEffect(() => {
    if (focusToken > 0) searchRef.current?.select()
  }, [focusToken])

  /* ---------- búsqueda ---------- */

  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length < MIN_QUERY) {
      setResult(null)
      setSearching(false)
      return
    }
    setSearching(true)
    let cancelled = false
    const timer = setTimeout(() => {
      const roots = folders.map((folder) => ({
        id: folder.id,
        name: folder.name,
        path: folder.path
      }))
      window.api.files
        .search({ roots, query: trimmed, mode })
        .then((value) => {
          if (cancelled) return
          setResult(value)
          setSearching(false)
        })
        .catch(() => {
          if (cancelled) return
          setResult({ hits: [], truncated: false, scanned: 0 })
          setSearching(false)
        })
    }, 260)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, mode, rootKey])

  const searchActive = query.trim().length >= MIN_QUERY

  /* ---------- acciones ---------- */

  const toggle = (entry: DirEntry): void => {
    const open = expanded[entry.path] === true
    setExpanded((prev) => ({ ...prev, [entry.path]: !open }))
    if (!open && !children[entry.path]) void load(entry.path)
  }

  const refresh = (): void => {
    for (const path of Object.keys(expanded)) {
      if (expanded[path]) void load(path)
    }
  }

  /** Abre el archivo en el editor asociado del sistema. */
  const open = (path: string): void => {
    void window.api.openPath(path)
  }

  const folderOf = (rootId: string): Folder | undefined => folders.find((f) => f.id === rootId)

  /* ---------- árbol ---------- */

  const rows = (dir: string, folder: Folder, depth: number): React.JSX.Element[] => {
    const entries = children[dir]

    if (failed[dir]) {
      return [
        <div key={`${dir}:error`} className="fs-note" style={{ paddingLeft: 10 + depth * 13 }}>
          No se pudo leer
        </div>
      ]
    }
    if (!entries) {
      return [
        <div key={`${dir}:loading`} className="fs-note" style={{ paddingLeft: 10 + depth * 13 }}>
          Cargando…
        </div>
      ]
    }
    if (entries.length === 0) {
      return [
        <div key={`${dir}:empty`} className="fs-note" style={{ paddingLeft: 10 + depth * 13 }}>
          Vacía
        </div>
      ]
    }

    return entries.flatMap((entry) => {
      const open_ = entry.isDirectory && expanded[entry.path] === true
      const row = (
        <div
          key={entry.path}
          className={`fs-row${entry.isDirectory ? ' dir' : ''}${
            selected === entry.path ? ' active' : ''
          }${entry.skipped ? ' muted' : ''}`}
          style={{ paddingLeft: 10 + depth * 13 }}
          role="button"
          tabIndex={0}
          title={entry.path}
          onClick={() => {
            setSelected(entry.path)
            if (entry.isDirectory) toggle(entry)
          }}
          onDoubleClick={() => {
            if (!entry.isDirectory) open(entry.path)
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return
            setSelected(entry.path)
            if (entry.isDirectory) toggle(entry)
            else open(entry.path)
          }}
        >
          <span className="fs-caret">{entry.isDirectory && <Chevron open={open_} />}</span>
          <span className="fs-name">{entry.name}</span>
          {entry.isDirectory && (
            <button
              className="fs-action"
              title={`Terminal en ${entry.name}`}
              onClick={(event) => {
                event.stopPropagation()
                onOpenTerminal(folder, entry.path, entry.name)
              }}
            >
              ▸_
            </button>
          )}
          <button
            className="fs-action"
            title="Mostrar en el explorador del sistema"
            onClick={(event) => {
              event.stopPropagation()
              void window.api.revealItem(entry.path)
            }}
          >
            ⤴
          </button>
        </div>
      )
      return open_ ? [row, ...rows(entry.path, folder, depth + 1)] : [row]
    })
  }

  const tree = folders.map((folder) => {
    const open_ = expanded[folder.path] === true
    return (
      <div key={folder.id} className="fs-root">
        <div
          className="fs-row root"
          role="button"
          tabIndex={0}
          title={folder.path}
          onClick={() => {
            setExpanded((prev) => ({ ...prev, [folder.path]: !open_ }))
            if (!open_ && !children[folder.path]) void load(folder.path)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') setExpanded((prev) => ({ ...prev, [folder.path]: !open_ }))
          }}
        >
          <span className="fs-caret">
            <Chevron open={open_} />
          </span>
          <span className="fs-name">{folder.name}</span>
          <button
            className="fs-action"
            title={`Terminal en ${folder.name}`}
            onClick={(event) => {
              event.stopPropagation()
              onOpenTerminal(folder, folder.path, folder.name)
            }}
          >
            ▸_
          </button>
        </div>
        {open_ && rows(folder.path, folder, 1)}
      </div>
    )
  })

  /* ---------- resultados ---------- */

  const results = (): React.JSX.Element => {
    if (searching && !result) return <div className="fs-note pad">Buscando…</div>
    if (!result) return <div className="fs-note pad">Escribí al menos {MIN_QUERY} caracteres.</div>
    if (result.hits.length === 0) {
      return (
        <div className="fs-note pad">
          Sin resultados para <b>{query.trim()}</b>
          {mode === 'content' && <> en el contenido de {result.scanned} archivos</>}.
        </div>
      )
    }

    return (
      <div className="fs-results">
        {result.hits.map((hit, index) => {
          const folder = folderOf(hit.rootId)
          const parts = hit.relPath.split(/[\\/]/)
          const name = parts.pop() ?? hit.relPath
          const dir = parts.join('/')
          return (
            <div
              key={`${hit.path}:${hit.line ?? 0}:${index}`}
              className={`fs-hit${selected === hit.path ? ' active' : ''}`}
              role="button"
              tabIndex={0}
              title={hit.path}
              onClick={() => setSelected(hit.path)}
              onDoubleClick={() => open(hit.path)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') open(hit.path)
              }}
            >
              <div className="fs-hit-head">
                <span className="fs-hit-name">{name}</span>
                {hit.line !== undefined && <span className="fs-hit-line">:{hit.line}</span>}
                <button
                  className="fs-action"
                  title="Mostrar en el explorador del sistema"
                  onClick={(event) => {
                    event.stopPropagation()
                    void window.api.revealItem(hit.path)
                  }}
                >
                  ⤴
                </button>
              </div>
              <div className="fs-hit-path">
                {folders.length > 1 && <span className="fs-hit-root">{folder?.name ?? hit.rootName}</span>}
                {dir || '.'}
              </div>
              {hit.preview !== undefined && (
                <div className="fs-hit-preview">
                  <Highlighted hit={hit} />
                </div>
              )}
            </div>
          )
        })}
        {result.truncated && (
          <div className="fs-note pad">
            Se cortó la búsqueda en {result.hits.length} resultados. Afiná el texto.
          </div>
        )}
      </div>
    )
  }

  return (
    <aside className="file-tree">
      <div className="fs-search">
        <div className="fs-search-field">
          <span className="fs-search-icon" aria-hidden="true">
            ⌕
          </span>
          <input
            ref={searchRef}
            className="fs-input"
            value={query}
            placeholder={mode === 'name' ? 'Buscar archivo…' : 'Buscar en el contenido…'}
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setQuery('')
            }}
          />
          {query && (
            <button className="fs-clear" title="Limpiar" onClick={() => setQuery('')}>
              ×
            </button>
          )}
        </div>
        <div className="fs-modes">
          <button
            className={`fs-mode${mode === 'name' ? ' on' : ''}`}
            onClick={() => setMode('name')}
          >
            Nombre
          </button>
          <button
            className={`fs-mode${mode === 'content' ? ' on' : ''}`}
            onClick={() => setMode('content')}
          >
            Contenido
          </button>
          {!searchActive && (
            <button className="fs-refresh" title="Releer las carpetas" onClick={refresh}>
              ↻
            </button>
          )}
          {searchActive && searching && <span className="fs-spinner" aria-label="Buscando" />}
          {searchActive && !searching && result && (
            <span className="fs-count">
              {result.hits.length}
              {result.truncated ? '+' : ''}
            </span>
          )}
        </div>
      </div>

      <div className="fs-body">{searchActive ? results() : tree}</div>

      {selected && (
        <div className="fs-foot" title={selected}>
          {selected}
        </div>
      )}
    </aside>
  )
}
