"""Loads the real extension in Chromium and runs find -> try -> best applied through the side panel.

deliveroo.co.uk is served from tests/mock_checkout.html and the deal sites from canned pages,
so nothing here touches the real sites.
"""
import json
import time
from pathlib import Path

import pytest
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
EXT = ROOT / "extension"
MOCK = (ROOT / "tests" / "mock_checkout.html").read_text()
MENU = "<html><body><h1>Pizza Place</h1><button>Add to basket</button><p>Margherita £14.00</p></body></html>"
HUKD = """<html><body><article><h2>£5 off Deliveroo with code SAVE5</h2><p>Worked for me tonight</p></article>
<article><h2>Deliveroo code BADCODE1 for 20% off</h2></article>
<article><h2>Deliveroo Plus members: use code TENOFF</h2></article></body></html>"""


@pytest.fixture()
def ext(tmp_path):
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            str(tmp_path / "profile"), channel="chromium", headless=True,
            args=[f"--disable-extensions-except={EXT}", f"--load-extension={EXT}"])
        # Anything not set up below (the other voucher sites) answers 404 straight away.
        ctx.route("https://**/*", lambda r: r.fulfill(status=404, body="not here"))
        ctx.route("https://deliveroo.co.uk/menu**", lambda r: r.fulfill(body=MENU, content_type="text/html"))
        ctx.route("https://deliveroo.co.uk/checkout**", lambda r: r.fulfill(body=MOCK, content_type="text/html"))
        ctx.route("https://www.hotukdeals.com/**", lambda r: r.fulfill(body=HUKD, content_type="text/html"))
        ctx.route("https://www.latestdeals.co.uk/**", lambda r: r.fulfill(status=503, body="down"))
        ctx.route("https://www.reddit.com/**", lambda r: r.fulfill(body=json.dumps({"data": {"children": []}}),
                                                                  content_type="application/json"))
        sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event("serviceworker")
        ext_id = sw.url.split("/")[2]
        yield ctx, ext_id
        ctx.close()


def open_panel(ctx, ext_id, shop):
    panel = ctx.new_page()
    panel.goto(f"chrome-extension://{ext_id}/panel.html")
    tab_id = panel.evaluate("""async () => (await chrome.tabs.query({url: "https://deliveroo.co.uk/*"}))[0].id""")
    panel.goto(f"chrome-extension://{ext_id}/panel.html?tab={tab_id}")
    panel.evaluate("SnackConfig.testing.min_delay_seconds = 0.1; SnackConfig.testing.max_delay_seconds = 0.2; SnackConfig.testing.result_wait_seconds = 4")
    return panel


def test_try_codes_locked_until_promo_step_then_one_tap(ext):
    ctx, ext_id = ext
    shop = ctx.new_page()
    shop.goto("https://deliveroo.co.uk/menu")
    panel = open_panel(ctx, ext_id, shop)
    errors = []
    panel.on("pageerror", lambda e: errors.append(str(e)))
    panel.wait_for_selector("text=Try codes unlocks when Snackhack sees it")
    assert panel.is_disabled("#btnTest")
    assert panel.query_selector("#query") is None  # restaurant box is gone

    # Go to checkout: the page watcher reports the promo option and Try unlocks by itself
    shop.goto("https://deliveroo.co.uk/checkout")
    panel.wait_for_selector("text=You're at the Deliveroo checkout", timeout=15000)
    panel.wait_for_function("() => !document.querySelector('#btnTest').disabled", timeout=10000)
    assert panel.inner_text("#btnTest") == "Find & try codes"

    # One tap: searches, then tries everything it found, and leaves the best one applied
    panel.click("#btnTest")
    panel.wait_for_function("() => !S.busy && S.history.length === 1", timeout=90000)
    log = panel.evaluate("S.log.map(l => l.msg).join('\\n')")
    assert "Checked" in log and "sources" in log
    assert "£5.00" in panel.inner_text("#hero")
    assert shop.inner_text("#total") == "£15.99"  # SAVE5 left applied
    codes = {c["code"]: c for c in panel.evaluate("async () => (await chrome.storage.local.get('codes')).codes")}
    assert codes["BADCODE1"]["status"] == "rejected" and codes["BADCODE1"]["tries"] == 1
    assert codes["SAVE5"]["status"] == "works" and codes["SAVE5"]["best_saving"] == 5 and codes["SAVE5"]["wins"] == 1
    assert codes["TENOFF"]["status"] == "untested"  # Plus-only, and we're not a member
    run = panel.evaluate("S.history[0]")
    assert run["best"] == "SAVE5" and run["saving"] == 5
    assert "£5.00" in panel.inner_text("#stats") and "1/2" in panel.inner_text("#stats")
    assert not errors, errors


def test_panel_renders_off_site(ext):
    ctx, ext_id = ext
    panel = ctx.new_page()
    errors = []
    panel.on("pageerror", lambda e: errors.append(str(e)))
    panel.goto(f"chrome-extension://{ext_id}/panel.html")
    panel.wait_for_selector("text=Open Deliveroo to try codes")
    assert panel.is_disabled("#btnTest")
    panel.fill("#addCode", "mycode9")
    panel.click("text=Add")
    panel.wait_for_selector(".coupon >> text=MYCODE9")
    assert not errors, errors


def test_window_mode_follows_main_browser_tab(ext):
    """What Opera users get: Snackhack in its own window, working on the tab in the main window."""
    ctx, ext_id = ext
    shop = ctx.new_page()
    shop.goto("https://deliveroo.co.uk/checkout")
    sw = ctx.service_workers[0]
    with ctx.expect_page() as new_page:
        sw.evaluate("openWindow()")
    panel = new_page.value
    panel.wait_for_load_state()
    assert "window=1" in panel.url
    panel.wait_for_selector("text=You're at the Deliveroo checkout", timeout=10000)
    panel.wait_for_function("() => !document.querySelector('#btnTest').disabled", timeout=10000)
    # A second click focuses the same window instead of opening another
    before = len(ctx.pages)
    sw.evaluate("openWindow()")
    time.sleep(1)
    assert len(ctx.pages) == before
