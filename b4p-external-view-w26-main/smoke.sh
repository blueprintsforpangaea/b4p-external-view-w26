#!/usr/bin/env bash
# Run API smoke test (starts server on random port, checks, stops).
#   bash /full/path/to/b4p-external-view-w26-main/smoke.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"
USE_SAMPLE_DATA=1 python3 scripts/smoke_test.py
