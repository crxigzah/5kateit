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
HUKD = """<html><body><article><h2>£5 off Deliveroo with code SAVE5</h2><p>Worked for me tonight</p></article>
<article><h2>Deliveroo code BADCODE1 for 20% off</h2></article>
<article><h2>Deliveroo Plus members: use code TENOFF</h2></article></body></html>"""


@pytest.fixture()
def ext(tmp_path):
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            str(tmp_path / "profile"), channel="chromium", headless=True,
            args=[f"--disable-extensions-except={EXT}", f"--load-extension={EXT}"])
        ctx.route("https://deliveroo.co.uk/**", lambda r: r.fulfill(body=MOCK, content_type="text/html"))
        ctx.route("https://www.hotukdeals.com/**", lambda r: r.fulfill(body=HUKD, content_type="text/html"))
        ctx.route("https://www.latestdeals.co.uk/**", lambda r: r.fulfill(status=503, body="down"))
        ctx.route("https://www.reddit.com/**", lambda r: r.fulfill(body=json.dumps({"data": {"children": []}}),
                                                                  content_type="application/json"))
        sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event("serviceworker")
        ext_id = sw.url.split("/")[2]
        yield ctx, ext_id
        ctx.close()


def test_side_panel_finds_and_tries_codes(ext):
    ctx, ext_id = ext
    shop = ctx.new_page()
    shop.goto("https://deliveroo.co.uk/checkout")
    tab_id = shop.evaluate("1")  # placeholder, real id comes from the extension below

    panel = ctx.new_page()
    errors = []
    panel.on("pageerror", lambda e: errors.append(str(e)))
    panel.goto(f"chrome-extension://{ext_id}/panel.html")
    tab_id = panel.evaluate("""async () => (await chrome.tabs.query({url: "https://deliveroo.co.uk/*"}))[0].id""")
    # Faster test timings, then reload the panel pinned to the shop tab
    panel.evaluate("SnackConfig.testing.min_delay_seconds = 0.1; SnackConfig.testing.max_delay_seconds = 0.2")
    panel.goto(f"chrome-extension://{ext_id}/panel.html?tab={tab_id}")
    panel.evaluate("SnackConfig.testing.min_delay_seconds = 0.1; SnackConfig.testing.max_delay_seconds = 0.2; SnackConfig.testing.result_wait_seconds = 4")
    panel.wait_for_selector("text=You're on Deliveroo")

    panel.click("#btnFind")
    panel.wait_for_function("() => document.querySelectorAll('.coupon').length >= 3", timeout=30000)
    cards = panel.inner_text("#coupons")
    assert "SAVE5" in cards and "BADCODE1" in cards and "TENOFF" in cards
    assert "Deliveroo Plus only" in cards  # TENOFF tagged from "Plus members"

    # Not a member yet: TENOFF is skipped
    panel.click("#btnTest")
    panel.wait_for_function("() => document.querySelector('#hero').classList.contains('win') && !document.querySelector('#btnStop').offsetParent", timeout=60000)
    assert "£5.00" in panel.inner_text("#hero")
    assert shop.inner_text("#total") == "£15.99"  # SAVE5 left applied
    codes = {c["code"]: c for c in panel.evaluate("async () => (await chrome.storage.local.get('codes')).codes")}
    assert codes["BADCODE1"]["status"] == "rejected"
    assert codes["SAVE5"]["status"] == "works" and codes["SAVE5"]["saving"] == 5
    assert codes["TENOFF"]["status"] == "untested"
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
