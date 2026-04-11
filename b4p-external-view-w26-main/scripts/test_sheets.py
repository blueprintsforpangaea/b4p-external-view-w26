#!/usr/bin/env python3
"""make sheet-test — verify Google Sheets connection and print the first 3 rows."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dotenv import load_dotenv
load_dotenv()

try:
    from main import get_inventory_records
    records = get_inventory_records()
except Exception as exc:
    print(f"ERROR: {exc}")
    sys.exit(1)

print(f"Connected! Sheet returned {len(records)} inventory row(s).")
print()
for i, rec in enumerate(records[:3], start=1):
    row = {k: v for k, v in rec.items() if k != "_sheet_row"}
    print(f"Row {i}: {row}")
