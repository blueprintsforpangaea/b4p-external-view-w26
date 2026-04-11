#!/usr/bin/env python3
"""
End-to-end API smoke test: starts uvicorn on a free port, hits endpoints, shuts down.

Usage:
  cd <project root>
  python3 -m pip install -r requirements.txt
  python3 scripts/smoke_test.py

Or: make smoke

Options:
  --port 8123       Use this port instead of an ephemeral one.
  --keep-running    After tests, keep serving until you press Ctrl+C here.
"""

from __future__ import annotations

import argparse
import json
import os
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def pick_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


def http_json(method: str, url: str, data: dict | None = None, timeout: float = 10.0):
    """Return (status_code, parsed_json_or_dict). HTTP 4xx/5xx do not raise."""
    payload = None
    headers = {"Accept": "application/json"}
    if data is not None:
        payload = json.dumps(data).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=payload, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8")
            return resp.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8")
        try:
            parsed = json.loads(raw) if raw else None
        except json.JSONDecodeError:
            parsed = {"detail": raw}
        return e.code, parsed


def wait_for_server(base: str, timeout: float = 20.0) -> None:
    deadline = time.time() + timeout
    last_err = None
    while time.time() < deadline:
        try:
            status, _ = http_json("GET", f"{base}/api/supplies")
            if status == 200:
                return
        except (urllib.error.URLError, TimeoutError, ConnectionResetError) as e:
            last_err = e
        time.sleep(0.15)
    raise RuntimeError(f"Server did not become ready in {timeout}s. Last error: {last_err!r}")


def terminate(proc: subprocess.Popen) -> None:
    if proc.poll() is not None:
        return
    proc.send_signal(signal.SIGTERM)
    try:
        proc.wait(timeout=8)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait(timeout=3)


def main() -> int:
    parser = argparse.ArgumentParser(description="Smoke-test the FastAPI supply API.")
    parser.add_argument("--port", type=int, default=0, help="Fixed port (default: ephemeral)")
    parser.add_argument(
        "--keep-running",
        action="store_true",
        help="After tests, keep the API running until Ctrl+C in this terminal.",
    )
    args = parser.parse_args()

    os.chdir(ROOT)
    port = args.port or pick_free_port()
    base = f"http://127.0.0.1:{port}"

    env = os.environ.copy()
    env["USE_SAMPLE_DATA"] = "1"

    cmd = [
        sys.executable,
        "-m",
        "uvicorn",
        "main:app",
        "--host",
        "127.0.0.1",
        "--port",
        str(port),
    ]

    print(f"Starting API on {base} (USE_SAMPLE_DATA=1)…")
    proc = subprocess.Popen(
        cmd,
        cwd=str(ROOT),
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    try:
        wait_for_server(base)

        status, supplies = http_json("GET", f"{base}/api/supplies")
        assert status == 200, supplies
        assert isinstance(supplies, list) and len(supplies) >= 1, "expected non-empty inventory"
        first = supplies[0]
        assert "_sheet_row" in first and first["_sheet_row"] >= 2, "missing stable _sheet_row"

        status, requests_rows = http_json("GET", f"{base}/api/requests")
        assert status == 200 and requests_rows == [], requests_rows

        row = int(first["_sheet_row"])
        cid = f"smoke-{int(time.time() * 1000)}"
        payload = {
            "nametag": "Smoke Test Clinic",
            "request_notes": "automated smoke test",
            "client_request_id": cid,
            "items": [{"sheet_row": row, "quantity": 1}],
        }
        status, submitted = http_json("POST", f"{base}/api/requests", data=payload)
        assert status == 200, submitted
        assert submitted.get("ok") is True, submitted
        assert "request_group_id" in submitted, submitted
        assert submitted.get("lines") == 1, submitted

        dup_status, dup_body = http_json("POST", f"{base}/api/requests", data=payload)
        assert dup_status == 409, dup_body

        print("All smoke checks passed.")
        if args.keep_running:
            print(f"Server still running at {base} — press Ctrl+C in this window to stop it.")
            try:
                while True:
                    time.sleep(3600)
            except KeyboardInterrupt:
                print("\nStopping…")
        return 0

    except Exception:
        print("Smoke test failed.", file=sys.stderr)
        print(
            "Tip: run manually for logs:  cd",
            str(ROOT),
            "&& USE_SAMPLE_DATA=1 python3 -m uvicorn main:app --host 127.0.0.1 --port 8000",
            file=sys.stderr,
        )
        raise
    finally:
        terminate(proc)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("\nInterrupted.", file=sys.stderr)
        raise SystemExit(130)
