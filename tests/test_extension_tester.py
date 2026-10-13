"""Runs the extension's in-page tester (extension/content/tester.js) against the mock checkout."""
import http.server
import threading
from functools import partial
from pathlib import Path

import pytest
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
EXT = ROOT / "extension"


@pytest.fixture(scope="module")
def page():
    handler = partial(http.server.SimpleHTTPRequestHandler, directory=str(ROOT / "tests"))
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page()
        pg.goto(f"http://127.0.0.1:{srv.server_address[1]}/mock_checkout.html")
        for f in ("lib/config.js", "lib/extract.js", "content/tester.js"):
            pg.add_script_tag(path=str(EXT / f))
        yield pg
        b.close()
    srv.shutdown()


def try_code(pg, code):
    return pg.evaluate("c => SnackTester.tryCode(c, SnackConfig.defaults, {}, 4)", code)


def test_rejects_bad_and_expired_codes(page):
    r = try_code(page, "BADCODE1")
    assert r["status"] == "rejected" and "isn't valid" in r["message"]
    r = try_code(page, "OLDCODE")
    assert r["status"] == "rejected" and "expired" in r["message"]


def test_works_measures_saving_and_removes(page):
    r = try_code(page, "SAVE5")
    assert r == {"status": "works", "message": "Total dropped by £5.00", "saving": 5}
    assert page.inner_text("#total") == "£15.99"
    assert page.evaluate("SnackTester.removeCode('SAVE5', SnackConfig.defaults)") is True
    assert page.inner_text("#total") == "£20.99"
    r = try_code(page, "TENOFF")
    assert r["status"] == "works" and r["saving"] == 2.1


def test_reports_missing_promo_box(page):
    page.set_content("<h1>Menu</h1><p>No checkout here</p>")
    page.add_script_tag(path=str(EXT / "lib/config.js"))
    page.add_script_tag(path=str(EXT / "lib/extract.js"))
    page.add_script_tag(path=str(EXT / "content/tester.js"))
    assert try_code(page, "SAVE5")["status"] == "error"
