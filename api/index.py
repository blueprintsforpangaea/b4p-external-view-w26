"""Vercel entry point: serves the FastAPI app from main.py under /api.

vercel.json rewrites /api/* to this function. The frontend already calls /api/supplies, so its
URL becomes /api/api/supplies; /requests becomes /api/requests, /health becomes /api/health.
"""
import sys
from pathlib import Path

from fastapi import FastAPI

# main.py lives in the repo root (bundled via vercel.json "includeFiles").
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from main import app as main_app  # noqa: E402

app = FastAPI()
app.mount("/api", main_app)
