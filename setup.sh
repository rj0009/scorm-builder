#!/usr/bin/env bash
# One-command setup for SCORM Builder.
# Run: ./setup.sh
# Then: bun run dev
set -euo pipefail

if ! command -v bun >/dev/null 2>&1; then
  echo "Bun is required: https://bun.sh" >&2
  exit 1
fi

echo "Installing dependencies..."
bun install

if [ ! -f zosite.json ]; then
  echo "Run this script from the project root." >&2
  exit 1
fi

# Auto-pick a free local dev port if the default is taken
PORT=$(node -e "
const fs = require('fs');
const c = JSON.parse(fs.readFileSync('zosite.json','utf8'));
const net = require('net');
const s = net.createServer(); s.listen(0); s.on('listening',()=>{ console.log(s.address().port); s.close(); });
" 2>/dev/null || echo 56401)

echo ""
echo "✓ Ready. Start the app with:"
echo "    PORT=$PORT bun run dev"
echo ""
echo "Or build a production bundle and run it:"
echo "    bun run prod"
