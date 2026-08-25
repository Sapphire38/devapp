import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Terminal } from '@xterm/xterm'
import { useEffect, useRef } from 'react'

interface Props {
  tabId: string
  cwd: string
  command?: string
  active: boolean
  onSession: (tabId: string, sessionId: string) => void
  onExit: (tabId: string, exitCode: number) => void
}

/** Paleta Selene: fondo Black, cursor y selección en Volt. */
const THEME = {
  background: '#0e0e0e',
  foreground: '#e5e5e5',
  cursor: '#e0e722',
  cursorAccent: '#0e0e0e',
  selectionBackground: 'rgba(224,231,34,0.28)',
  black: '#1c1c1c',
  red: '#ff5a4f',
  green: '#7be38d',
  yellow: '#e0e722',
  blue: '#6fb5ff',
  magenta: '#c792ea',
  cyan: '#4dd0e1',
  white: '#e5e5e5',
  brightBlack: '#767676',
  brightRed: '#ff8f8f',
  brightGreen: '#9aeaa8',
  brightYellow: '#eef255',
  brightBlue: '#9cccff',
  brightMagenta: '#dcb0ff',
  brightCyan: '#79e2f2',
  brightWhite: '#ffffff'
}

export default function TerminalView({
  tabId,
  cwd,
  command,
  active,
  onSession,
  onExit
}: Props): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const sessionRef = useRef<string | null>(null)
  /** Teclas tipeadas antes de que la sesión exista; se vuelcan al conectar. */
  const pendingInput = useRef<string[]>([])

  // Los callbacks viven en refs para que el efecto de montaje no se re-ejecute
  // (re-ejecutarlo mataría la shell y perdería el scrollback).
  const onSessionRef = useRef(onSession)
  const onExitRef = useRef(onExit)
  onSessionRef.current = onSession
  onExitRef.current = onExit

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const term = new Terminal({
      fontFamily:
        "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace",
      fontSize: 12.5,
      lineHeight: 1.25,
      cursorBlink: true,
      scrollback: 10000,
      theme: THEME,
      allowTransparency: false
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon())
    term.open(host)
    termRef.current = term
    fitRef.current = fit

    const safeFit = (): void => {
      if (host.clientWidth < 2 || host.clientHeight < 2) return
      try {
        fit.fit()
      } catch {
        /* el contenedor puede estar oculto durante un cambio de pestaña */
      }
    }
    safeFit()

    // Cmd/Ctrl+K limpia la pantalla, como en cualquier terminal.
    term.attachCustomKeyEventHandler((event) => {
      if (event.type === 'keydown' && event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
        term.clear()
        return false
      }
      return true
    })

    let disposed = false

    const offData = window.api.session.onData((id, data) => {
      if (id === sessionRef.current) term.write(data)
    })

    const offExit = window.api.session.onExit((id, exitCode) => {
      if (id !== sessionRef.current) return
      sessionRef.current = null
      term.write(`\r\n\x1b[90m[proceso finalizado · código ${exitCode}]\x1b[0m\r\n`)
      onExitRef.current(tabId, exitCode)
    })

    const inputSub = term.onData((data) => {
      if (sessionRef.current) window.api.session.write(sessionRef.current, data)
      else pendingInput.current.push(data)
    })

    const resizeSub = term.onResize(({ cols, rows }) => {
      if (sessionRef.current) window.api.session.resize(sessionRef.current, cols, rows)
    })

    window.api.session
      .create({ cwd, command, cols: term.cols, rows: term.rows })
      .then(({ id, pty }) => {
        // Si la pestaña se cerró mientras se creaba la sesión, matamos el huérfano.
        if (disposed) {
          window.api.session.kill(id)
          return
        }
        sessionRef.current = id
        onSessionRef.current(tabId, id)
        if (pendingInput.current.length > 0) {
          window.api.session.write(id, pendingInput.current.join(''))
          pendingInput.current = []
        }
        if (!pty) {
          term.write(
            '\x1b[33m[devapp] node-pty no está disponible: terminal en modo limitado (sin TTY).\r\n' +
              'Corré "npm run rebuild" para compilarlo.\x1b[0m\r\n\r\n'
          )
        }
      })
      .catch((err: Error) => {
        term.write(`\r\n\x1b[31m[devapp] ${err.message}\x1b[0m\r\n`)
      })

    const observer = new ResizeObserver(safeFit)
    observer.observe(host)

    return () => {
      disposed = true
      observer.disconnect()
      offData()
      offExit()
      inputSub.dispose()
      resizeSub.dispose()
      if (sessionRef.current) window.api.session.kill(sessionRef.current)
      sessionRef.current = null
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
  }, [tabId, cwd, command])

  useEffect(() => {
    if (!active) return
    const term = termRef.current
    const fit = fitRef.current
    const host = hostRef.current
    if (!term || !fit || !host) return
    // El fit tiene que correr después de que el nodo sea visible.
    const raf = requestAnimationFrame(() => {
      if (host.clientWidth < 2 || host.clientHeight < 2) return
      try {
        fit.fit()
      } catch {
        /* ignorado */
      }
      term.focus()
    })
    return () => cancelAnimationFrame(raf)
  }, [active])

  return <div ref={hostRef} className="term-host" hidden={!active} />
}
