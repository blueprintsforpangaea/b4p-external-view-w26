#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "output" / "pdf"
OUT_PATH = OUT_DIR / "app-summary-one-page.pdf"


TITLE = "Blueprints Supply Desk"
SUBTITLE = "One-page repo summary"

WHAT_IT_IS = (
    "External-facing supply request portal for partner organizations. "
    "The repo shows a FastAPI backend, a React frontend, Google Sheets-backed "
    "inventory and requests, and email notifications for request events."
)

WHO_ITS_FOR = (
    "Partner organizations or clinics that need to browse available supplies, "
    "submit requests, and track request status."
)

FEATURES = [
    "Browse consolidated supply inventory from `/api/supplies`.",
    "Search and filter items by category and subcategory in the React UI.",
    "Show live availability tags from `/inventory/availability`.",
    "Store an org session in `sessionStorage` for repeat visits.",
    "Build a cart and submit org requests through `POST /requests`.",
    "View past requests and per-line statuses in the My Requests tab.",
    "Send org confirmations, HQ alerts, and status update emails.",
]

ARCHITECTURE = [
    "Frontend: Create React App app in `my-dashboard/` calls backend endpoints with `fetch`.",
    "Backend: FastAPI app in `main.py` exposes inventory, request, and availability APIs.",
    "Data store: `gspread` reads Sheet 1 for inventory and writes request rows to a `Requests` worksheet.",
    "Email service: `app/services/email.py` sends Gmail SMTP emails for confirmations, HQ alerts, and status updates.",
    "Dev mode: `USE_SAMPLE_DATA=1` serves `sample_inventory.json` and skips sheet writes and emails.",
    "Prod path: after `make build`, FastAPI serves the built React app from `my-dashboard/build/`.",
]

RUN_STEPS = [
    "Copy `.env.example` to `.env` and fill in Google and Gmail values.",
    "Run `make install`.",
    "Run `make dev`.",
    "Open `http://127.0.0.1:8000` for the API and `http://localhost:3000` for the frontend.",
]

SOURCES = (
    "Repo evidence: README.md, main.py, app/services/email.py, "
    "my-dashboard/src/App.js, Makefile, .env.example"
)


def draw_wrapped_text(c: canvas.Canvas, text: str, x: float, y: float, width: float,
                      font_name: str = "Helvetica", font_size: int = 10,
                      color=colors.HexColor("#24323d"), leading: float = 13) -> float:
    c.setFont(font_name, font_size)
    c.setFillColor(color)
    words = text.split()
    line = ""
    for word in words:
        trial = word if not line else f"{line} {word}"
        if stringWidth(trial, font_name, font_size) <= width:
            line = trial
        else:
            c.drawString(x, y, line)
            y -= leading
            line = word
    if line:
        c.drawString(x, y, line)
        y -= leading
    return y


def draw_bullets(c: canvas.Canvas, items: list[str], x: float, y: float, width: float,
                 bullet_gap: float = 12, font_size: int = 9.3, leading: float = 11.5) -> float:
    for item in items:
        c.setFillColor(colors.HexColor("#0f5e8c"))
        c.setFont("Helvetica-Bold", font_size)
        c.drawString(x, y, "-")
        y = draw_wrapped_text(
            c,
            item,
            x + bullet_gap,
            y,
            width - bullet_gap,
            font_name="Helvetica",
            font_size=font_size,
            leading=leading,
        )
        y -= 1.5
    return y


def draw_section_title(c: canvas.Canvas, title: str, x: float, y: float) -> float:
    c.setFillColor(colors.HexColor("#0f5e8c"))
    c.setFont("Helvetica-Bold", 11)
    c.drawString(x, y, title.upper())
    return y - 16


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    c = canvas.Canvas(str(OUT_PATH), pagesize=letter)
    width, height = letter
    margin = 38
    gutter = 20
    left_w = 286
    right_w = width - (margin * 2) - gutter - left_w
    left_x = margin
    right_x = margin + left_w + gutter

    c.setTitle("Blueprints Supply Desk - One Page Summary")

    c.setFillColor(colors.HexColor("#f4f7f9"))
    c.rect(0, 0, width, height, fill=1, stroke=0)
    c.setFillColor(colors.HexColor("#114b73"))
    c.rect(0, height - 84, width, 84, fill=1, stroke=0)

    c.setFillColor(colors.white)
    c.setFont("Helvetica-Bold", 20)
    c.drawString(margin, height - 38, TITLE)
    c.setFont("Helvetica", 10.5)
    c.drawString(margin, height - 56, SUBTITLE)

    c.setFillColor(colors.white)
    c.roundRect(width - 178, height - 64, 140, 28, 10, fill=1, stroke=0)
    c.setFillColor(colors.HexColor("#114b73"))
    c.setFont("Helvetica-Bold", 9)
    c.drawCentredString(width - 108, height - 47, "Repo-grounded summary")

    y_left = height - 108
    y_right = height - 108

    y_left = draw_section_title(c, "What It Is", left_x, y_left)
    y_left = draw_wrapped_text(c, WHAT_IT_IS, left_x, y_left, left_w, font_size=9.5, leading=12)
    y_left -= 6

    y_left = draw_section_title(c, "Who It's For", left_x, y_left)
    y_left = draw_wrapped_text(c, WHO_ITS_FOR, left_x, y_left, left_w, font_size=9.5, leading=12)
    y_left -= 6

    y_left = draw_section_title(c, "What It Does", left_x, y_left)
    y_left = draw_bullets(c, FEATURES, left_x, y_left, left_w, font_size=8.9, leading=10.7)

    y_right = draw_section_title(c, "How It Works", right_x, y_right)
    y_right = draw_bullets(c, ARCHITECTURE, right_x, y_right, right_w, font_size=8.9, leading=10.7)
    y_right -= 4

    y_right = draw_section_title(c, "How To Run", right_x, y_right)
    y_right = draw_bullets(c, RUN_STEPS, right_x, y_right, right_w, font_size=8.9, leading=10.7)
    y_right -= 6

    c.setStrokeColor(colors.HexColor("#cad7df"))
    c.line(right_x, y_right, right_x + right_w, y_right)
    y_right -= 14

    c.setFillColor(colors.HexColor("#5a6973"))
    c.setFont("Helvetica-Oblique", 7.7)
    y_right = draw_wrapped_text(
        c,
        SOURCES,
        right_x,
        y_right,
        right_w,
        font_name="Helvetica-Oblique",
        font_size=7.7,
        color=colors.HexColor("#5a6973"),
        leading=9.2,
    )

    footer_y = 22
    c.setStrokeColor(colors.HexColor("#cad7df"))
    c.line(margin, footer_y + 12, width - margin, footer_y + 12)
    c.setFillColor(colors.HexColor("#5a6973"))
    c.setFont("Helvetica", 8)
    c.drawString(margin, footer_y, "If a detail is absent from this page, it was not treated as proven unless supported by repo evidence.")

    c.showPage()
    c.save()
    print(OUT_PATH)


if __name__ == "__main__":
    main()
