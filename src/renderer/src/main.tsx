import { createRoot } from 'react-dom/client'
import App from './App'
import '@xterm/xterm/css/xterm.css'
import './styles.css'

const container = document.getElementById('root')
if (!container) throw new Error('No se encontró #root')

// Sin StrictMode a propósito: el doble montaje de efectos en desarrollo
// spawnearía dos shells por cada pestaña de terminal.
createRoot(container).render(<App />)
