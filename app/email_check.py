"""Does an email's domain look able to receive mail? Standard library only, no outside service.

Only the domain is looked up (never the address), through the DNS server this machine already
uses: first its mail servers (MX), then, as mail allows, a plain address (A/AAAA). Answers:

  "ok"         the domain has mail servers or an address
  "no-domain"  DNS says the domain doesn't exist (likely a typo)
  "no-mail"    the domain exists but has no way to receive mail
  "disposable" a throwaway inbox service
  "unknown"    couldn't tell (timeout, no DNS server, odd reply); never a reason to stop someone

Results are cached for an hour, so repeated checks don't repeat lookups.
"""
import os
import random
import socket
import struct
import time
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeout

TIMEOUT = 2.0
CACHE_SECONDS = 3600
_CACHE: dict[str, tuple[float, str]] = {}
_CACHE_MAX = 2000
_pool = ThreadPoolExecutor(max_workers=4)

DISPOSABLE = frozenset("""
10minutemail.com 20minutemail.com burnermail.io discard.email dispostable.com emailondeck.com
fakeinbox.com getairmail.com getnada.com guerrillamail.com guerrillamail.net guerrillamailblock.com
mailcatch.com maildrop.cc mailinator.com mailnesia.com mintemail.com moakt.com mohmal.com
sharklasers.com spamgourmet.com temp-mail.org tempail.com tempmail.com tempmailo.com
throwawaymail.com trashmail.com yopmail.com yopmail.net
""".split())


def _nameserver() -> str | None:
    """The first nameserver in /etc/resolv.conf (Linux, macOS and Vercel all have one)."""
    try:
        with open(os.environ.get("RESOLV_CONF", "/etc/resolv.conf"), encoding="utf-8") as f:
            for line in f:
                parts = line.split()
                if len(parts) >= 2 and parts[0] == "nameserver":
                    return parts[1]
    except OSError:
        return None
    return None


def _query(domain: str, qtype: int = 15) -> tuple[int, int] | None:
    """One DNS question over UDP. Returns (rcode, answer count), or None when there's no usable
    reply. The answers themselves aren't needed: only whether there are any."""
    server = _nameserver()
    if not server:
        return None
    qid = random.randrange(1 << 16)
    labels = b"".join(bytes([len(p)]) + p.encode("idna") for p in domain.split(".") if p)
    packet = struct.pack(">HHHHHH", qid, 0x0100, 1, 0, 0, 0) + labels + b"\x00" + struct.pack(">HH", qtype, 1)
    family = socket.AF_INET6 if ":" in server else socket.AF_INET
    with socket.socket(family, socket.SOCK_DGRAM) as s:
        s.settimeout(TIMEOUT)
        s.sendto(packet, (server, 53))
        for _ in range(3):  # ignore stray packets that aren't the reply to this question
            data, _ = s.recvfrom(4096)
            if len(data) >= 12 and struct.unpack(">H", data[:2])[0] == qid:
                flags, _, ancount = struct.unpack(">HHH", data[2:8])
                if flags & 0x0200:  # truncated: there were answers, too many for UDP
                    return (flags & 0x000F, max(ancount, 1))
                return (flags & 0x000F, ancount)
    return None


def _has_address(domain: str) -> bool:
    try:
        return bool(socket.getaddrinfo(domain, None))
    except (socket.gaierror, UnicodeError):
        return False


def _lookup(domain: str) -> str:
    mx = _query(domain)
    if mx is None:
        return "unknown"
    rcode, answers = mx
    if rcode == 3:  # NXDOMAIN: no such domain
        return "no-domain"
    if rcode != 0:
        return "unknown"
    if answers:
        return "ok"
    # No mail servers listed: mail falls back to the domain's own address.
    return "ok" if _has_address(domain) else "no-mail"


def check_domain(domain: str) -> str:
    domain = domain.strip().strip(".").lower()
    if not domain or "." not in domain or len(domain) > 253:
        return "no-domain"
    if domain in DISPOSABLE:
        return "disposable"
    now = time.time()
    hit = _CACHE.get(domain)
    if hit and now - hit[0] < CACHE_SECONDS:
        return hit[1]
    try:
        result = _pool.submit(_lookup, domain).result(timeout=TIMEOUT + 0.5)
    except (FutureTimeout, OSError, ValueError, UnicodeError):
        result = "unknown"
    if result != "unknown":  # don't remember a network hiccup
        if len(_CACHE) >= _CACHE_MAX:
            _CACHE.clear()
        _CACHE[domain] = (now, result)
    return result
