#!/usr/bin/env bash
# Recompila la app y reemplaza la copia instalada en /Applications.
# Los datos del usuario viven en ~/Library/Application Support/devapp y no se tocan.
set -euo pipefail

APP="/Applications/DevApp.app"
DATA="$HOME/Library/Application Support/devapp"

if [ "$(uname -m)" = "arm64" ]; then
  ARCH="--arm64"
  BUILT="release/mac-arm64/DevApp.app"
else
  ARCH="--x64"
  BUILT="release/mac/DevApp.app"
fi

echo "▸ Compilando…"
npm run build

echo "▸ Empaquetando ($ARCH)…"
npx electron-builder --mac dir "$ARCH"

if [ ! -d "$BUILT" ]; then
  echo "✗ No se generó $BUILT" >&2
  exit 1
fi

# Respaldo del workspace antes de tocar nada: si una versión nueva rompiera
# el formato, la lista de carpetas y proyectos se recupera desde acá.
if [ -f "$DATA/workspace.json" ]; then
  cp "$DATA/workspace.json" "$DATA/workspace.json.bak"
  echo "▸ Respaldo guardado en workspace.json.bak"
fi

echo "▸ Cerrando la app si está abierta…"
osascript -e 'tell application "DevApp" to quit' >/dev/null 2>&1 || true
sleep 1

echo "▸ Instalando en /Applications…"
rm -rf "$APP"
# ditto preserva permisos y firma del bundle; cp -R puede romperlos.
ditto "$BUILT" "$APP"

echo "✓ Listo. Tus carpetas y proyectos siguen intactos."
