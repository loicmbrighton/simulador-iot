#!/usr/bin/env bash
# Baixa o atlas Z-Anatomy (CC-BY-SA 4.0) e o ambiente Python com o Blender (bpy).
# Tudo vai para tools/anatomia/.cache/ (ignorado pelo git).
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
CACHE="$DIR/.cache"
mkdir -p "$CACHE"

if [ ! -f "$CACHE/Z-Anatomy/Startup.blend" ]; then
  echo "> Baixando Z-Anatomy (~87 MB)..."
  rm -rf "$CACHE/repo"
  git clone -q --depth 1 --filter=blob:none --no-checkout https://github.com/Z-Anatomy/The-blend "$CACHE/repo"
  git -C "$CACHE/repo" checkout -q HEAD -- Z-Anatomy.zip
  unzip -q -o "$CACHE/repo/Z-Anatomy.zip" Z-Anatomy/Startup.blend -d "$CACHE"
  rm -rf "$CACHE/repo"
fi

if [ ! -x "$CACHE/venv/bin/python" ]; then
  echo "> Criando venv com bpy (Blender como módulo Python, ~430 MB)..."
  python3 -m venv "$CACHE/venv"
  "$CACHE/venv/bin/pip" install --quiet bpy pillow
fi
echo "OK: $CACHE/Z-Anatomy/Startup.blend"
