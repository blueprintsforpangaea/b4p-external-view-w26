# Blueprints supply desk — run from this folder (project root).
ROOT := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))

.PHONY: help install setup set-up dev build start smoke test \
        backend backend-live frontend sheet-test email-test

help:
	@echo "Blueprints supply desk — available targets:"
	@echo ""
	@echo "  make install      Install Python + Node dependencies"
	@echo "  make dev          Run backend (:8000) + frontend (:3000) concurrently"
	@echo "  make build        Build React frontend for production"
	@echo "  make start        Production: built frontend served via FastAPI on :8000"
	@echo ""
	@echo "  make sheet-test   Test Google Sheets connection (prints first 3 rows)"
	@echo "  make email-test   Send a test email to HQ_EMAIL via Resend"
	@echo "  make smoke        End-to-end API test with sample data"
	@echo ""
	@echo "  make backend      Sample inventory API on http://127.0.0.1:8000"
	@echo "  make backend-live Real Google Sheet API on http://127.0.0.1:8000"
	@echo "  make frontend     React dev server on http://localhost:3000"

# ── Aliases ────────────────────────────────────────────────────────────────────
setup: install
set-up: install

# ── Install ────────────────────────────────────────────────────────────────────
install:
	cd "$(ROOT)" && python3 -m pip install -r requirements.txt
	cd "$(ROOT)/my-dashboard" && npm install

# ── Dev (concurrent backend + frontend) ───────────────────────────────────────
dev:
	@echo "Starting backend (:8000) + frontend (:3000) — press Ctrl+C to stop both."
	@trap 'kill 0' SIGINT SIGTERM; \
	  (cd "$(ROOT)" && USE_SAMPLE_DATA=1 python3 -m uvicorn main:app --host 127.0.0.1 --port 8000) & \
	  (cd "$(ROOT)/my-dashboard" && HOST=127.0.0.1 PORT=3000 DANGEROUSLY_DISABLE_HOST_CHECK=true npm start) & \
	  wait

# ── Build (production React bundle) ───────────────────────────────────────────
build:
	@echo "Building React frontend…"
	cd "$(ROOT)/my-dashboard" && npm run build

# ── Start (production: FastAPI serves built frontend) ─────────────────────────
start:
	@echo "Production mode — API + frontend on http://127.0.0.1:8000"
	@echo "Run 'make build' first if the build/ folder is missing or stale."
	cd "$(ROOT)" && python3 -m uvicorn main:app --host 127.0.0.1 --port 8000

# ── Sheet test ────────────────────────────────────────────────────────────────
sheet-test:
	@echo "Testing Google Sheets connection…"
	cd "$(ROOT)" && python3 scripts/test_sheets.py

# ── Email test ────────────────────────────────────────────────────────────────
email-test:
	@echo "Sending test email via Resend…"
	cd "$(ROOT)" && python3 scripts/test_email.py

# ── Test suite ────────────────────────────────────────────────────────────────
test:
	@echo "Running full test suite (sample data — no Sheets or Resend required)…"
	cd "$(ROOT)" && python3 scripts/test_all.py

# ── Smoke test ────────────────────────────────────────────────────────────────
smoke:
	cd "$(ROOT)" && USE_SAMPLE_DATA=1 python3 scripts/smoke_test.py

# ── Individual dev servers ─────────────────────────────────────────────────────
backend:
	@echo "Sample inventory — http://127.0.0.1:8000  (Ctrl+C to stop)"
	cd "$(ROOT)" && USE_SAMPLE_DATA=1 python3 -m uvicorn main:app --host 127.0.0.1 --port 8000

backend-live:
	@echo "Live Sheets — needs .env + credentials — http://127.0.0.1:8000  (Ctrl+C to stop)"
	cd "$(ROOT)" && python3 -m uvicorn main:app --host 127.0.0.1 --port 8000

frontend:
	@echo "React — http://localhost:3000  (Ctrl+C to stop)"
	cd "$(ROOT)/my-dashboard" && HOST=127.0.0.1 PORT=3000 DANGEROUSLY_DISABLE_HOST_CHECK=true npm start
