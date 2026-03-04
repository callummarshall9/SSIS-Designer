#!/usr/bin/env bash
set -e

cd "$(dirname "$0")"

echo "=== Compiling TypeScript ==="
npm run compile

echo "=== Building webview ==="
npm run build:webview

echo "=== Packaging VSIX ==="
mkdir -p publish
npx @vscode/vsce package --allow-missing-repository --out publish/

echo ""
echo "Done! VSIX written to:"
ls -lh publish/*.vsix
