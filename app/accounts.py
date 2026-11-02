"""Where clinic and team accounts live (see docs/AUTH_PLAN.md and DEPLOY_ACCOUNTS.md).

  * DATABASE_URL set: the B4P Postgres database (Supabase), through the account functions of
    Blueprints_DB (create_account, account_login, session_account, ...). The live site uses this.
  * Not set, on a computer: a small SQLite file (.local-accounts.sqlite3, never committed), so
    accounts can be tried at localhost without touching Supabase.
  * Not set, deployed (Vercel/Render): no store. A serverless disk doesn't keep files, so accounts
    there need the database; the endpoints answer 503 instead of losing accounts.

Both stores take only Argon2id password hashes and SHA-256 token digests from app/auth.py:
neither ever sees a password, a session token or a reset link.
"""
import os
import sqlite3
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

from app import db

LOCK_AFTER = 5                      # wrong passwords in a row ...
LOCK_FOR = timedelta(minutes=15)    # ... lock the account this long (as in the database)


def _deployed() -> bool:
    return bool(os.environ.get("VERCEL") or os.environ.get("RENDER"))


class Unavailable(Exception):
    """No account store here (deployed without the database, or its account tables are missing)."""


class PostgresStore:
    """The database's account functions, plus a few direct reads they don't cover."""

    def create_account(self, email: str, org_name: str, password_hash: str) -> Optional[int]:
        return db.create_account(email, org_name, password_hash)

    def login_row(self, email: str) -> Optional[dict]:
        return db.account_login(email)

    def record_failed_login(self, account_id: int) -> None:
        db.record_failed_login(account_id)

    def start_session(self, account_id: int, digest: bytes, days: int) -> None:
        db.start_session(account_id, digest, days)

    def session_account(self, digest: bytes) -> Optional[dict]:
        row = db.session_account(digest)
        if row:
            row = {**row, "created_at": db.account_created_at(row["account_id"])}
        return row

    def end_session(self, digest: bytes) -> None:
        db.end_session(digest)

    def create_reset_token(self, email: str, digest: bytes, hours: int) -> bool:
        return db.create_reset_token(email, digest, hours)

    def reset_password(self, digest: bytes, password_hash: str) -> Optional[int]:
        return db.reset_password_account(digest, password_hash)

    def set_password(self, account_id: int, password_hash: str) -> bool:
        return db.set_password(account_id, password_hash)

    def list_accounts(self) -> list[dict]:
        return db.list_accounts()

    def set_role(self, email: str, role: str) -> bool:
        return db.set_account_role(email, role)


class SQLiteStore:
    """The same rules in a local file: one account per email (any case), sessions and reset
    links stored as digests, 5 wrong passwords lock for 15 minutes, a reset ends every session."""

    def __init__(self, path: str):
        self.path = path
        self._lock = threading.Lock()
        with self._db() as c:
            c.executescript("""
                CREATE TABLE IF NOT EXISTS account (
                    account_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
                    org_name TEXT NOT NULL,
                    role TEXT NOT NULL DEFAULT 'clinic' CHECK (role IN ('clinic', 'hq')),
                    password_hash TEXT NOT NULL CHECK (password_hash LIKE '$argon2id$%'),
                    failed_logins INTEGER NOT NULL DEFAULT 0,
                    locked_until TEXT,
                    disabled_at TEXT,
                    created_at TEXT NOT NULL,
                    last_login_at TEXT
                );
                CREATE TABLE IF NOT EXISTS account_session (
                    token_hash BLOB PRIMARY KEY,
                    account_id INTEGER NOT NULL REFERENCES account(account_id) ON DELETE CASCADE,
                    expires_at TEXT NOT NULL,
                    revoked_at TEXT
                );
                CREATE TABLE IF NOT EXISTS account_token (
                    token_hash BLOB PRIMARY KEY,
                    account_id INTEGER NOT NULL REFERENCES account(account_id) ON DELETE CASCADE,
                    expires_at TEXT NOT NULL,
                    used_at TEXT
                );
            """)
        try:
            os.chmod(path, 0o600)  # password hashes: readable by this user only
        except OSError:
            pass

    def _db(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path, timeout=5)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        return conn

    @staticmethod
    def _now() -> datetime:
        return datetime.now(timezone.utc)

    def _run(self, fn):
        with self._lock, self._db() as conn:
            return fn(conn)

    def create_account(self, email, org_name, password_hash):
        if not password_hash.startswith("$argon2id$"):
            raise ValueError("password hash must be an Argon2id hash")

        def go(c):
            try:
                cur = c.execute("INSERT INTO account (email, org_name, password_hash, created_at) VALUES (?, ?, ?, ?)",
                                (email.strip(), org_name.strip(), password_hash, self._now().isoformat()))
            except sqlite3.IntegrityError:
                return None
            return cur.lastrowid
        return self._run(go)

    def login_row(self, email):
        def go(c):
            r = c.execute("SELECT * FROM account WHERE email = ?", (email.strip(),)).fetchone()
            if not r:
                return None
            locked = bool(r["locked_until"]) and datetime.fromisoformat(r["locked_until"]) > self._now()
            return {"account_id": r["account_id"], "password_hash": r["password_hash"], "verified": True,
                    "locked": locked, "disabled": bool(r["disabled_at"])}
        return self._run(go)

    def record_failed_login(self, account_id):
        def go(c):
            c.execute("UPDATE account SET failed_logins = failed_logins + 1 WHERE account_id = ?", (account_id,))
            n = c.execute("SELECT failed_logins FROM account WHERE account_id = ?", (account_id,)).fetchone()
            if n and n[0] >= LOCK_AFTER:
                c.execute("UPDATE account SET locked_until = ? WHERE account_id = ?",
                          ((self._now() + LOCK_FOR).isoformat(), account_id))
        self._run(go)

    def start_session(self, account_id, digest, days):
        def go(c):
            now = self._now().isoformat()
            c.execute("UPDATE account SET failed_logins = 0, locked_until = NULL, last_login_at = ? WHERE account_id = ?",
                      (now, account_id))
            c.execute("INSERT INTO account_session (token_hash, account_id, expires_at) VALUES (?, ?, ?)",
                      (digest, account_id, (self._now() + timedelta(days=days)).isoformat()))
        self._run(go)

    def session_account(self, digest):
        def go(c):
            r = c.execute("""SELECT a.account_id, a.email, a.org_name, a.role, a.created_at
                               FROM account_session s JOIN account a ON a.account_id = s.account_id
                              WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?
                                AND a.disabled_at IS NULL""", (digest, self._now().isoformat())).fetchone()
            if not r:
                return None
            return {**dict(r), "created_at": datetime.fromisoformat(r["created_at"])}
        return self._run(go)

    def end_session(self, digest):
        self._run(lambda c: c.execute("UPDATE account_session SET revoked_at = ? WHERE token_hash = ?",
                                      (self._now().isoformat(), digest)))

    def create_reset_token(self, email, digest, hours):
        def go(c):
            r = c.execute("SELECT account_id FROM account WHERE email = ? AND disabled_at IS NULL", (email.strip(),)).fetchone()
            if not r:
                return False
            now = self._now()
            c.execute("UPDATE account_token SET used_at = ? WHERE account_id = ? AND used_at IS NULL",
                      (now.isoformat(), r[0]))  # an earlier link stops working
            c.execute("INSERT INTO account_token (token_hash, account_id, expires_at) VALUES (?, ?, ?)",
                      (digest, r[0], (now + timedelta(hours=hours)).isoformat()))
            return True
        return self._run(go)

    def reset_password(self, digest, password_hash):
        def go(c):
            now = self._now().isoformat()
            r = c.execute("""SELECT t.account_id FROM account_token t JOIN account a ON a.account_id = t.account_id
                              WHERE t.token_hash = ? AND t.used_at IS NULL AND t.expires_at > ? AND a.disabled_at IS NULL""",
                          (digest, now)).fetchone()
            if not r:
                return None
            c.execute("UPDATE account_token SET used_at = ? WHERE token_hash = ?", (now, digest))
            self._set_password(c, r[0], password_hash)
            return r[0]
        return self._run(go)

    def _set_password(self, c, account_id, password_hash):
        if not password_hash.startswith("$argon2id$"):
            raise ValueError("password hash must be an Argon2id hash")
        now = self._now().isoformat()
        c.execute("UPDATE account SET password_hash = ?, failed_logins = 0, locked_until = NULL WHERE account_id = ?",
                  (password_hash, account_id))
        c.execute("UPDATE account_session SET revoked_at = ? WHERE account_id = ? AND revoked_at IS NULL", (now, account_id))
        c.execute("UPDATE account_token SET used_at = ? WHERE account_id = ? AND used_at IS NULL", (now, account_id))

    def set_password(self, account_id, password_hash):
        return self._run(lambda c: self._set_password(c, account_id, password_hash) or True)

    def list_accounts(self):
        def go(c):
            now = self._now().isoformat()
            rows = c.execute("""SELECT email, org_name, role, created_at, last_login_at,
                                       (locked_until IS NOT NULL AND locked_until > ?) AS locked
                                  FROM account WHERE disabled_at IS NULL ORDER BY org_name COLLATE NOCASE, email""",
                             (now,)).fetchall()
            return [{**dict(r), "locked": bool(r["locked"])} for r in rows]
        return self._run(go)

    def set_role(self, email, role):
        return bool(self._run(lambda c: c.execute("UPDATE account SET role = ? WHERE email = ?",
                                                  (role, email.strip())).rowcount))


_sqlite: dict[str, SQLiteStore] = {}
_pg_ready = False


def local_path() -> str:
    return os.environ.get("ACCOUNTS_SQLITE_PATH") or str(Path(__file__).resolve().parent.parent / ".local-accounts.sqlite3")


def store():
    """The account store for this server, or raises Unavailable."""
    global _pg_ready
    if db.enabled():
        if not _pg_ready:
            _pg_ready = db.accounts_ready()  # asked until the tables exist, then remembered
            if not _pg_ready:
                raise Unavailable("the database has no account tables yet")
        return PostgresStore()
    if _deployed():
        raise Unavailable("accounts need DATABASE_URL when deployed")
    path = local_path()
    if path not in _sqlite:
        _sqlite[path] = SQLiteStore(path)
    return _sqlite[path]
