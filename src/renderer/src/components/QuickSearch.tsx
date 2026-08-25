import { useEffect, useRef, useState } from 'react'
import type { FileSearchHit, FileSearchResult, Folder, SearchMode } from '../../../shared/types'

interface Props {
  folders: Folder[]
  onClose: () => void
}

const MIN_QUERY = 2
const MAX_ROWS = 60

/** Lo último que se buscó, para que reabrir el buscador no arranque de cero. */
let lastQuery = ''
let lastMode: SearchMode = 'name'

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

export default function QuickSearch({ folders, onClose }: Props): React.JSX.Element {
  const [query, setQuery] = useState(lastQuery)
  const [mode, setMode] = useState<SearchMode>(lastMode)
  const [result, setResult] = useState<FileSearchResult | null>(null)
  const [searching, setSearching] = useState(false)
  const [cursor, setCursor] = useState(0)

  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const rootKey = folders.map((folder) => folder.path).join('|')

  useEffect(() => {
    inputRef.current?.select()
  }, [])

  useEffect(() => {
    lastQuery = query
    lastMode = mode
  }, [query, mode])

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
          setCursor(0)
          setSearching(false)
        })
        .catch(() => {
          if (cancelled) return
          setResult({ hits: [], truncated: false, scanned: 0 })
          setSearching(false)
        })
    }, 220)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, mode, rootKey])

  const hits = (result?.hits ?? []).slice(0, MAX_ROWS)

  // La fila activa tiene que seguir visible cuando se navega con las flechas.
  useEffect(() => {
    listRef.current?.querySelector('.qs-hit.active')?.scrollIntoView({ block: 'nearest' })
  }, [cursor, result])

  const move = (delta: number): void => {
    if (hits.length === 0) return
    setCursor((current) => (current + delta + hits.length) % hits.length)
  }

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'Tab') {
      // Tab alterna nombre ↔ contenido sin sacar el foco del input.
      event.preventDefault()
      setMode((current) => (current === 'name' ? 'content' : 'name'))
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key === 'ArrowDown' || (event.key === 'n' && event.ctrlKey)) {
      event.preventDefault()
      move(1)
      return
    }
    if (event.key === 'ArrowUp' || (event.key === 'p' && event.ctrlKey)) {
      event.preventDefault()
      move(-1)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      const hit = hits[cursor]
      if (!hit) return
      if (event.shiftKey) void window.api.revealItem(hit.path)
      else void window.api.openPath(hit.path)
      onClose()
    }
  }

  const body = (): React.JSX.Element => {
    if (query.trim().length < MIN_QUERY) {
      return (
        <div className="qs-note">
          Escribí al menos {MIN_QUERY} caracteres. <b>⇥</b> cambia entre nombre y contenido.
        </div>
      )
    }
    if (!result) return <div className="qs-note">Buscando…</div>
    if (hits.length === 0) {
      return (
        <div className="qs-note">
          Sin resultados en {folders.length === 1 ? folders[0].name : `${folders.length} carpetas`}.
        </div>
      )
    }

    return (
      <div className="qs-list" ref={listRef}>
        {hits.map((hit, index) => {
          const parts = hit.relPath.split(/[\\/]/)
          const name = parts.pop() ?? hit.relPath
          const dir = parts.join('/')
          return (
            <div
              key={`${hit.path}:${hit.line ?? 0}:${index}`}
              className={`qs-hit${index === cursor ? ' active' : ''}`}
              role="button"
              tabIndex={-1}
              title={hit.path}
              onMouseMove={() => setCursor(index)}
              onClick={() => {
                void window.api.openPath(hit.path)
                onClose()
              }}
            >
              <div className="qs-hit-head">
                <span className="qs-hit-name">{name}</span>
                {hit.line !== undefined && <span className="qs-hit-line">:{hit.line}</span>}
                <span className="qs-hit-path">
                  {folders.length > 1 && <span className="qs-hit-root">{hit.rootName}</span>}
                  {dir || '.'}
                </span>
              </div>
              {hit.preview !== undefined && (
                <div className="qs-hit-preview">
                  <Highlighted hit={hit} />
                </div>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div className="qs-backdrop" onMouseDown={onClose}>
      <div
        className="qs-panel"
        role="dialog"
        aria-label="Buscar en el proyecto"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="qs-head">
          <span className="qs-icon" aria-hidden="true">
            ⌕
          </span>
          <input
            ref={inputRef}
            className="qs-input"
            value={query}
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            placeholder={
              mode === 'name' ? 'Buscar archivo por nombre…' : 'Buscar texto en los archivos…'
            }
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
          />
          <span className={`qs-mode${mode === 'content' ? ' alt' : ''}`}>
            {mode === 'name' ? 'nombre' : 'contenido'}
            <b>⇥</b>
          </span>
          {searching && <span className="qs-spinner" aria-label="Buscando" />}
        </div>

        {body()}

        <div className="qs-foot">
          <span>
            <b>↑↓</b> navegar
          </span>
          <span>
            <b>⇥</b> nombre / contenido
          </span>
          <span>
            <b>⏎</b> abrir
          </span>
          <span>
            <b>⇧⏎</b> mostrar en carpeta
          </span>
          <span>
            <b>esc</b> cerrar
          </span>
          {result && (
            <span className="qs-count">
              {result.hits.length}
              {result.truncated ? '+' : ''} resultados
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
