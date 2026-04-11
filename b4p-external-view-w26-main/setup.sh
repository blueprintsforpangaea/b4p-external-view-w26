#!/usr/bin/env bash
# Install Python + Node dependencies. Safe to run from any directory:
#   bash /full/path/to/b4p-external-view-w26-main/setup.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"
echo "==> Project root: $ROOT"
echo "==> pip install…"
python3 -m pip install -r requirements.txt
echo "==> npm install…"
(cd my-dashboard && npm install)
echo ""
echo "Done. Next:"
echo "  Terminal 1:  cd \"$ROOT\" && make backend"
echo "  Terminal 2:  cd \"$ROOT\" && make frontend"
echo "Or one-shot test:  cd \"$ROOT\" && make smoke"
