"""One-off: import an existing org_requests.json into Postgres.

Usage (from the repo root):
    DATABASE_URL=postgresql://... python scripts/migrate_org_requests_to_db.py path/to/org_requests.json [--dry-run]

Idempotent: request ids already present in dash_requests are skipped, so it is
safe to run twice.

Each request goes through the contract function create_request() with its
original Request ID and Timestamp (orgs have these ids in their confirmation
emails); the status is then set with set_request_status().
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv  # noqa: E402

load_dotenv()

from app import db  # noqa: E402


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    dry_run = "--dry-run" in sys.argv
    if len(args) != 1 or not db.enabled():
        sys.exit(__doc__)
    rows = json.loads(Path(args[0]).read_text(encoding="utf-8"))

    groups: dict[str, list[dict]] = {}
    for r in rows:
        groups.setdefault(r["Request ID"].strip(), []).append(r)

    existing = {r["Request ID"] for r in db.get_requests()}
    imported = skipped = 0
    for req_id, lines in groups.items():
        if req_id in existing:
            skipped += 1
            continue
        first = lines[0]
        print(f"{'would import' if dry_run else 'import'} {req_id} ({len(lines)} lines, {first['Status']})")
        imported += 1
        if dry_run:
            continue
        items = [{"item_name": line["Item Name"], "category": line.get("Category", ""),
                  "quantity": int(line["Quantity Requested"]),
                  "review_flag": line.get("Review Flag", "").upper() == "TRUE"} for line in lines]
        with db._connect() as conn:
            conn.execute("SELECT create_request(%s, %s, %s::jsonb, %s, %s)",
                         (first["Org Name"], first.get("Org Email", ""), json.dumps(items),
                          req_id, first["Timestamp"]))
        if first["Status"] != "Under Review":
            db.set_request_status(req_id, first["Status"])
    print(f"done: {imported} {'would be ' if dry_run else ''}imported, {skipped} already present")


if __name__ == "__main__":
    main()
