# DevApp

App de escritorio (macOS y Windows) para tener tus carpetas de proyectos a mano,
abrir una terminal real en cualquiera de ellas y correr scripts de node con un click.

## Qué hace

- **Carpetas**: agregalas con el diálogo nativo o arrastrándolas a la ventana. Quedan guardadas entre sesiones.
- **Proyectos**: agrupá dos o más carpetas (API + cliente + workers) y abrí **una terminal en cada una** con un solo botón.
- **Conjuntos de scripts**: dentro de un proyecto, definí una combinación de comandos — `npm run dev` en la API, `npm start` en el cliente, lo que sea — y lanzalos todos de un click, cada uno en su carpeta y su propia terminal. Se guardan con el proyecto.
- **Terminal real**: shell interactiva con TTY (`node-pty` + `xterm.js`), no un log de salida. Colores, `top`, `vim`, autocompletado, todo.
- **Scripts**: lee `package.json` y muestra cada script como un chip; detecta el gestor de paquetes (npm/yarn/pnpm/bun) por el lockfile.
- **Archivos node**: lista los `.js`/`.mjs`/`.ts` de la raíz y de `scripts/` para ejecutarlos directo.
- **Comando libre**: un input por carpeta para correr cualquier cosa en su directorio.
- **Pestañas**: varias terminales por carpeta, con su scrollback intacto al cambiar de proyecto.
- Detecta la rama de git y la refresca cuando volvés a la ventana.
- **Al cerrar la app se matan sus terminales**, incluidos los procesos hijos: un `npm run dev` no queda dando vueltas ocupando el puerto.

## Desarrollo

```bash
npm install
npm run dev
```

Otros comandos:

```bash
npm run typecheck
npm run build
```

## Actualizar la copia instalada

```bash
npm run update:mac
```

Compila, respalda `workspace.json`, cierra la app si está abierta y reemplaza la de
`/Applications`. Las carpetas, proyectos y conjuntos se conservan: viven en
`~/Library/Application Support/devapp/`, fuera del `.app`.

Esa ruta la determina el campo `name` de `package.json` (`devapp`), **no**
`productName`. Si se cambia `name`, la app arranca sin datos.

## Empaquetado

```bash
npm run dist:mac
```

```bash
npm run dist:win
```

Los instaladores quedan en `release/`. En macOS se generan DMG y ZIP (arm64 + x64);
en Windows, un instalador NSIS.

Notas:

- La app **no está firmada**. En macOS, la primera vez hay que abrirla con click
  derecho → *Abrir*. Para distribuirla hace falta configurar `identity` y notarización
  en `electron-builder.yml`.
- Compilar el instalador de Windows **desde macOS** requiere Wine. Lo natural es
  correr `npm run dist:win` en una máquina Windows o en CI.

## Arquitectura

```
src/
  main/        proceso principal: ventana, menú, IPC, store y sesiones de terminal
    terminals.ts   node-pty, con fallback por pipes si el módulo nativo no carga
    projects.ts    inspección de una carpeta (scripts, lockfile, rama de git)
    store.ts       persistencia de carpetas y proyectos en workspace.json
  preload/     bridge con contextIsolation; expone window.api
  renderer/    UI en React
  shared/      tipos y contrato de la API, compartidos por los tres lados
```

El renderer no tiene acceso a Node: todo pasa por IPC tipado a través del preload.

### Sobre node-pty

Es un módulo nativo, pero desde la versión 1.1 usa N-API y trae binarios precompilados
para macOS, Windows y Linux, así que **no hace falta recompilarlo**. Si en alguna
máquina no cargara, la app no se rompe: cae a un modo sin TTY (salida por pipes) y lo
avisa en la interfaz. Para arreglarlo ahí:

```bash
npm run rebuild
```

Ese comando usa node-gyp, que **falla si la ruta del proyecto tiene espacios**.

## Atajos

| Atajo | Acción |
| --- | --- |
| `Cmd/Ctrl + O` | Agregar carpeta |
| `Cmd/Ctrl + Shift + N` | Nuevo proyecto |
| `Cmd/Ctrl + T` | Nueva terminal |
| `Cmd/Ctrl + Shift + T` | Terminal en todas las carpetas del proyecto |
| `Cmd/Ctrl + W` | Cerrar pestaña |
| `Cmd/Ctrl + B` | Mostrar/ocultar el panel de scripts |
| `Cmd/Ctrl + K` | Limpiar la terminal |
