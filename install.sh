#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Installing backend Python dependencies..."
python3 -m pip install -r "$ROOT/backend/requirements.txt"

echo "Installing frontend npm dependencies..."
cd "$ROOT/frontend_new"
npm install

echo
echo "Install complete."
echo "Run the project with:"
echo "bash ./run.sh"
