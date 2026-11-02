"""The name people see before the app runs (tab, bookmark, shared link, home-screen icon) is the
same one the app sets: never the old internal "External Supply Request Dashboard"."""
import json
import re
from pathlib import Path

UI = Path(__file__).resolve().parent.parent / "my-dashboard"
NAME = "Blueprints Supply Requests"


def test_static_title_and_share_name_match_the_app():
    html = (UI / "public" / "index.html").read_text()
    assert re.search(r"<title>\s*" + NAME + r"\s*</title>", html)
    assert f'property="og:title" content="{NAME}"' in html
    assert json.loads((UI / "public" / "manifest.json").read_text())["name"] == NAME
    assert "External Supply Request Dashboard" not in html
