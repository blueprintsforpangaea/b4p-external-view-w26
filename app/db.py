"""Optional Postgres data source. Active only when the DATABASE_URL env var is set.

Reads the `dash_supplies` / `dash_requests` views and calls the
`create_request` / `set_request_status` functions defined in the B4P database.
"""
import os

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb


def preview_sandboxed() -> bool:
    """Vercel preview deploys use demo data, never the real database or sheet, unless explicitly allowed."""
    return (os.environ.get("VERCEL_ENV", "").strip().lower() == "preview"
            and os.environ.get("PREVIEW_ALLOW_REAL_DATA", "").strip().lower() != "true")


def enabled() -> bool:
    return bool(os.environ.get("DATABASE_URL", "").strip()) and not preview_sandboxed()


def _connect():
    # prepare_threshold=None: Supabase's transaction pooler rejects prepared statements.
    return psycopg.connect(
        os.environ["DATABASE_URL"].strip(),
        connect_timeout=5,
        prepare_threshold=None,
        row_factory=dict_row,
    )


def _query(sql: str, params=None) -> list[dict]:
    with _connect() as conn:
        return conn.execute(sql, params).fetchall()


def get_supplies() -> list[dict]:
    return _query("SELECT * FROM dash_supplies")


def get_requests() -> list[dict]:
    return _query("SELECT * FROM dash_requests")


def request_exists(request_id: str) -> bool:
    return bool(_query("SELECT 1 FROM dash_requests WHERE \"Request ID\" = %s LIMIT 1", (request_id,)))


def item_ids_for_rows(sheet_rows: list[int]) -> dict[int, dict]:
    """sheet_row -> {"id", "names", "maker", "lot", "box", "pallet", "same_name"} for rows that exist.

    The id survives syncs. The rest lets the caller check the row is still the item the requester picked
    (sheet rows shift on insert/delete): names (item and general name), maker, lot/box/pallet, and how
    many active rows share the item name (more than one means a bare name is ambiguous)."""
    if not sheet_rows:
        return {}
    rows = _query(
        "SELECT d.sheet_row, d.id, d.name, d.gen_name, d.manufacturer, d.lot_number, d.box_number, d.pallet_number,"
        " (SELECT count(*) FROM dash_items o WHERE lower(btrim(o.name)) = lower(btrim(d.name))) AS same_name"
        " FROM dash_items d WHERE d.sheet_row = ANY(%s)", (list(set(sheet_rows)),))
    return {int(r["sheet_row"]): {
        "id": r["id"], "names": [r["name"] or "", r["gen_name"] or ""], "maker": r["manufacturer"] or "",
        "lot": r["lot_number"] or "", "box": str(r["box_number"] or ""), "pallet": str(r["pallet_number"] or ""),
        "same_name": int(r["same_name"])} for r in rows}


def request_lines(request_id: str) -> list[dict]:
    return _query('SELECT "Org Name", "Org Email", "Item Name", "Quantity Requested" FROM dash_requests '
                  'WHERE "Request ID" = %s', (request_id,))


def create_request(org_name: str, org_email: str, items: list[dict], request_id: str | None = None) -> str:
    """items: [{"item_name", "category", "quantity", "review_flag"}] -> 'REQ-<epoch>-<nnn>'.

    With request_id the database keeps that id and ignores a repeat (ON CONFLICT), so retries are safe."""
    with _connect() as conn:
        return conn.execute(
            "SELECT create_request(%s, %s, %s, %s)", (org_name, org_email, Jsonb(items), request_id)
        ).fetchone()["create_request"]


def set_request_status(request_id: str, status: str) -> bool:
    """status is the display text ('Approved', 'Shipped', ...). False if the id is unknown."""
    with _connect() as conn:
        return conn.execute(
            "SELECT set_request_status(%s, %s)", (request_id, status)
        ).fetchone()["set_request_status"]


def ping() -> bool:
    try:
        _query("SELECT 1")
        return True
    except Exception:
        return False


# --- accounts (docs/AUTH_PLAN.md; app/accounts.py picks this or a local file) -------------------
# Thin wrappers over the account functions of the B4P database (Blueprints_DB, sql/schema.sql).
# Password hashes and token digests come from app/auth.py; nothing here sees a password or a token.

def _value(sql: str, params=None):
    """First column of the first row (None if there is no row)."""
    with _connect() as conn:
        row = conn.execute(sql, params).fetchone()
    return next(iter(row.values())) if row else None


def accounts_ready() -> bool:
    """True if this database has the account tables (the schema proposal may not be applied yet)."""
    try:
        return _value("SELECT to_regclass('account') IS NOT NULL") is True
    except Exception:
        return False


def create_account(email: str, org_name: str, password_hash: str) -> "int | None":
    """The new account id, or None if that email already has an account."""
    try:
        return _value("SELECT create_account(%s, %s, %s)", (email, org_name, password_hash))
    except psycopg.errors.UniqueViolation:
        return None


def account_login(email: str) -> "dict | None":
    """{"account_id", "password_hash", "verified", "locked", "disabled"} or None."""
    rows = _query("SELECT * FROM account_login(%s)", (email,))
    return rows[0] if rows else None


def record_failed_login(account_id: int) -> None:
    _value("SELECT record_login(%s, false)", (account_id,))


def start_session(account_id: int, token_hash: bytes, days: int) -> None:
    """A correct password was given: clear the failed count and open a session."""
    with _connect() as conn:
        conn.execute("SELECT record_login(%s, true)", (account_id,))
        conn.execute("SELECT create_session(%s, %s, make_interval(days => %s))", (account_id, token_hash, days))


def session_account(token_hash: bytes) -> "dict | None":
    """{"account_id", "email", "org_name", "role"} for a live session, else None."""
    rows = _query("SELECT * FROM session_account(%s)", (token_hash,))
    return rows[0] if rows else None


def account_created_at(account_id: int):
    return _value("SELECT created_at FROM account WHERE account_id = %s", (account_id,))


def end_session(token_hash: bytes) -> bool:
    return bool(_value("SELECT end_session(%s)", (token_hash,)))


def create_reset_token(email: str, token_hash: bytes, hours: int) -> bool:
    """A reset link made by the Blueprints team. False if no usable account has that email."""
    return bool(_value("SELECT create_account_token(%s, 'reset_password', %s, make_interval(hours => %s))",
                       (email, token_hash, hours)))


def reset_password_account(token_hash: bytes, password_hash: str) -> "int | None":
    """Redeem a reset link and set the new password, in one transaction. The account id, or None."""
    with _connect() as conn:
        account_id = conn.execute(
            "SELECT use_account_token('reset_password', %s) AS id", (token_hash,)).fetchone()["id"]
        if account_id is None:
            return None
        conn.execute("SELECT set_password(%s, %s)", (account_id, password_hash))
        return account_id


def set_password(account_id: int, password_hash: str) -> bool:
    """Also signs the account out everywhere."""
    return bool(_value("SELECT set_password(%s, %s)", (account_id, password_hash)))


def list_accounts() -> list[dict]:
    """Every usable account, for the team dashboard. No hashes."""
    return _query("""
        SELECT a.email::TEXT AS email, r.org_name::TEXT AS org_name, a.role, a.created_at, a.last_login_at,
               COALESCE(a.locked_until > now(), false) AS locked
          FROM account a JOIN requester r ON r.requester_id = a.requester_id
         WHERE a.disabled_at IS NULL
         ORDER BY r.org_name, a.email""")


def set_account_role(email: str, role: str) -> bool:
    with _connect() as conn:
        return conn.execute("UPDATE account SET role = %s WHERE email = %s::CITEXT", (role, email.strip())).rowcount > 0
