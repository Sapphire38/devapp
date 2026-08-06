import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron'
import type { MenuAction } from '../shared/api'

function send(action: MenuAction): void {
  BrowserWindow.getFocusedWindow()?.webContents.send('menu:action', action)
}

export function buildMenu(): void {
  const isMac = process.platform === 'darwin'

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? ([
          {
            label: app.name,
            submenu: [
              { role: 'about', label: `Acerca de ${app.name}` },
              { type: 'separator' },
              { role: 'hide', label: 'Ocultar' },
              { role: 'hideOthers', label: 'Ocultar otros' },
              { role: 'unhide', label: 'Mostrar todo' },
              { type: 'separator' },
              { role: 'quit', label: 'Salir' }
            ]
          }
        ] as MenuItemConstructorOptions[])
      : []),
    {
      label: 'Archivo',
      submenu: [
        {
          label: 'Agregar carpeta…',
          accelerator: 'CmdOrCtrl+O',
          click: () => send('add-folder')
        },
        {
          label: 'Nuevo proyecto…',
          accelerator: 'CmdOrCtrl+Shift+N',
          click: () => send('new-project')
        },
        { type: 'separator' },
        {
          label: 'Nueva terminal',
          accelerator: 'CmdOrCtrl+T',
          click: () => send('new-terminal')
        },
        {
          label: 'Terminal en todas las carpetas del proyecto',
          accelerator: 'CmdOrCtrl+Shift+T',
          click: () => send('open-all-terminals')
        },
        {
          label: 'Cerrar pestaña',
          accelerator: 'CmdOrCtrl+W',
          click: () => send('close-tab')
        },
        { type: 'separator' },
        isMac ? { role: 'close', label: 'Cerrar ventana', accelerator: 'CmdOrCtrl+Shift+W' } : { role: 'quit', label: 'Salir' }
      ]
    },
    {
      label: 'Edición',
      submenu: [
        { role: 'undo', label: 'Deshacer' },
        { role: 'redo', label: 'Rehacer' },
        { type: 'separator' },
        { role: 'cut', label: 'Cortar' },
        { role: 'copy', label: 'Copiar' },
        { role: 'paste', label: 'Pegar' },
        { role: 'selectAll', label: 'Seleccionar todo' }
      ]
    },
    {
      label: 'Ver',
      submenu: [
        {
          label: 'Panel de scripts',
          accelerator: 'CmdOrCtrl+B',
          click: () => send('toggle-panel')
        },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Zoom normal' },
        { role: 'zoomIn', label: 'Acercar' },
        { role: 'zoomOut', label: 'Alejar' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Pantalla completa' },
        { role: 'toggleDevTools', label: 'Herramientas de desarrollo' }
      ]
    },
    {
      label: 'Ventana',
      submenu: [
        { role: 'minimize', label: 'Minimizar' },
        ...(isMac
          ? ([{ role: 'zoom', label: 'Zoom' }, { type: 'separator' }, { role: 'front', label: 'Traer todo al frente' }] as MenuItemConstructorOptions[])
          : ([{ role: 'close', label: 'Cerrar' }] as MenuItemConstructorOptions[]))
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
