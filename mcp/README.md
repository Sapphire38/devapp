# Servidor MCP de Selene

Expone la app corriendo como herramientas MCP: un agente puede ver el
workspace, abrir terminales, correr scripts, leer su salida y frenarlos — lo
mismo que hacés vos desde la ventana, por la misma vía.

## Cómo está armado

```
cliente MCP  ──stdio (JSON-RPC)──▶  mcp/selene-mcp.mjs
                                            │
                                   socket Unix, NDJSON
                                            ▼
                                   src/main/bridge.ts  (proceso main)
                                            │
                        workspace y terminales  │  pestañas (IPC al renderer)
```

El socket vive en la carpeta de datos de la app (`bridge.sock`, permisos
`0600`), así que solo el usuario que corre Selene puede hablarle. No hay puertos
abiertos ni nada escuchando en la red.

El servidor no tiene dependencias: corre con el node del sistema. Busca primero
la app instalada y después la de desarrollo (`selene-dev`); `SELENE_BRIDGE_SOCKET`
fuerza una ruta.

**La app tiene que estar abierta.** Sin ella, cada herramienta devuelve un error
que lo dice.

## Registrarlo

En este repo ya está `.mcp.json`. Para usarlo desde cualquier proyecto:

```bash
claude mcp add selene --scope user -- node /Users/juanignaciogarcia/Documents/GitHub/devapp/mcp/selene-mcp.mjs
```

## Herramientas

| Herramienta | Qué hace |
| --- | --- |
| `selene_status` | Versión, plataforma, node-pty y cuántas carpetas/proyectos/pestañas hay |
| `selene_workspace` | Carpetas, proyectos, conjuntos y pestañas, con sus ids |
| `selene_inspect` | Scripts, rama, gestor de paquetes y subpaquetes de una carpeta |
| `selene_add_folder` | Agrega una carpeta al workspace |
| `selene_open_terminal` | Abre una pestaña y opcionalmente corre un comando |
| `selene_read_output` | Lee la salida de una pestaña, sin códigos de color |
| `selene_send_input` | Escribe en el stdin de una terminal (prompts, Ctrl-C) |
| `selene_stop_terminal` | Mata el proceso y su árbol de hijos |
| `selene_close_tab` / `selene_restart_tab` | Cierra o reinicia una pestaña |
| `selene_run_task` / `selene_stop_task` | Lanza o frena un conjunto de scripts |

Una pestaña abierta desde el MCP no le mueve la vista al usuario: queda activa
en el scope de su propia carpeta. `focus: true` en `selene_open_terminal` sí
cambia la selección.

## Límites conocidos

- La salida guardada por sesión son los últimos 256 KB; `truncado: true` avisa
  cuando se descartó algo. Se conservan las últimas 20 sesiones terminadas.
- La salida viene de un PTY real: si tu prompt se redibuja (zsh con
  autosuggestions), quedan artefactos del redibujado entre los comandos. La
  salida de los comandos en sí se lee bien.
- `selene_open_terminal` necesita que la ventana esté abierta. En macOS, con la
  ventana cerrada y la app en el Dock, las herramientas de pestañas fallan con
  un error claro; las de workspace siguen andando.
