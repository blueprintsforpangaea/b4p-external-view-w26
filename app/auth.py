"""Accounts: password hashing and random tokens (see docs/AUTH_PLAN.md).

No web framework and no database here: main.py has the endpoints, app/db.py the SQL.
The database only ever receives what these functions return: an Argon2id hash of a password,
or the SHA-256 digest of a token. The password and the token themselves are never stored.
"""
import hashlib
import secrets

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

MIN_PASSWORD = 10
MAX_PASSWORD = 128  # hashing cost grows with length, so cap what one request can make us hash

_hasher = PasswordHasher()  # Argon2id with the library's defaults
_dummy_hash = ""


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, stored_hash: str) -> bool:
    try:
        return _hasher.verify(stored_hash, password)
    except (VerificationError, InvalidHashError):
        return False


def burn(password: str) -> None:
    """Spend the time a real check takes. Called when there is no account to check against,
    so how long a sign-in takes does not tell anyone which emails have accounts."""
    global _dummy_hash
    if not _dummy_hash:
        _dummy_hash = _hasher.hash(secrets.token_urlsafe(16))
    verify_password(password, _dummy_hash)


def token_hash(token: str) -> bytes:
    """What the database stores for a session cookie or an emailed link."""
    return hashlib.sha256(token.encode("utf-8", "replace")).digest()


def new_token() -> "tuple[str, bytes]":
    """(token to hand to the user, digest to store). 256 random bits."""
    token = secrets.token_urlsafe(32)
    return token, token_hash(token)
