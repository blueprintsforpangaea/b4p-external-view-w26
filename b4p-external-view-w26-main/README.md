# Blueprints Supply Desk

External-facing supply request portal for partner organizations. Built on FastAPI + React, backed by Google Sheets.

## Quick Start

1. Copy `.env.example` and fill in your values:
   ```bash
   cp .env.example .env
   # then edit .env with your credentials
   ```

2. Install all dependencies:
   ```bash
   make install
   ```

3. Start development servers (backend + frontend):
   ```bash
   make dev
   ```
   - API: http://127.0.0.1:8000
   - Frontend: http://localhost:3000

## All Makefile Targets

| Command | Description |
|---|---|
| `make install` | Install Python + Node dependencies |
| `make dev` | Run backend + frontend concurrently (uses sample data) |
| `make build` | Build React frontend for production |
| `make start` | Production mode: FastAPI serves built frontend on :8000 |
| `make backend` | Backend only, sample data |
| `make backend-live` | Backend only, live Google Sheets |
| `make frontend` | Frontend only |
| `make sheet-test` | Test Google Sheets connection, print first 3 rows |
| `make email-test` | Send test email to HQ_EMAIL via Resend |
| `make smoke` | End-to-end API smoke test with sample data |

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/supplies` | Inventory items |
| `GET` | `/inventory/availability` | Per-item availability status (cross-refs Requests sheet) |
| `POST` | `/requests` | Submit org supply request |
| `GET` | `/requests?email=` | Org's past requests |
| `PATCH` | `/requests/{id}/status` | Update request status (Approved / Shipped) |

## Environment Variables

See `.env.example` for a full list with descriptions.

Required:
- `GOOGLE_APPLICATION_CREDENTIALS` — path to service account JSON
- `GOOGLE_SHEET_ID` — Google Sheet ID
- `RESEND_API_KEY` — Resend API key for emails
- `HQ_EMAIL` — HQ email address (sender + recipient of internal alerts)

## Google Sheets Structure

**Inventory sheet (Sheet 1):** Managed externally — do not rename columns.

**Requests worksheet** (name set by `ORG_REQUESTS_WORKSHEET_TITLE`, default `Requests`):
```
Request ID | Org Name | Org Email | Item Name | Category | Quantity Requested | Status | Timestamp | Review Flag
```

## Production Deploy

```bash
make build    # compile React to my-dashboard/build/
make start    # FastAPI serves API + static files on :8000
```
