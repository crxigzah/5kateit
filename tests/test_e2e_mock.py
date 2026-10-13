"""Runs the real engine against tests/mock_checkout.html in headless Chromium."""
import http.server
import json
import os
import threading
import time
from functools import partial
from pathlib import Path

import pytest

HERE = Path(__file__).parent


@pytest.fixture()
def env(tmp_path, monkeypatch):
    handler = partial(http.server.SimpleHTTPRequestHandler, directory=str(HERE))
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    port = srv.server_address[1]
    (tmp_path / "sites.json").write_text(json.dumps({
        "sites": {"mock": {"name": "Mock", "domain": f"127.0.0.1:{port}", "query": "Mock",
                           "start_url": f"http://127.0.0.1:{port}/mock_checkout.html"}},
        "sources": [],
        "testing": {"min_delay_seconds": 0.1, "max_delay_seconds": 0.2, "result_wait_seconds": 4},
    }))
    monkeypatch.setenv("TCF_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("TCF_HEADLESS", "1")
    monkeypatch.setenv("TCF_BROWSER", "chromium")
    yield
    srv.shutdown()


def run(engine, fn, *args):
    assert engine.submit("job", fn, *args)
    deadline = time.time() + 90
    while engine.busy and time.time() < deadline:
        time.sleep(0.2)
    assert not engine.busy


def test_tests_codes_and_leaves_best_applied(env):
    from tcf.engine import Engine
    from tcf.store import Wallet

    logs = []
    wallet = Wallet()
    engine = Engine(wallet, lambda k, d: logs.append(d["msg"]) if k == "log" else None)
    for c in ["BADCODE1", "TENOFF", "OLDCODE", "SAVE5"]:
        wallet.upsert("mock", c, sources=["test"])

    run(engine, engine.open_site, "mock")
    run(engine, engine.test_codes, "mock")
    print("\n".join(logs))

    by = {c["code"]: c for c in wallet.all()}
    assert by["BADCODE1"]["status"] == "rejected"
    assert by["OLDCODE"]["status"] == "rejected" and "expired" in by["OLDCODE"]["message"]
    assert by["TENOFF"]["status"] == "works" and by["TENOFF"]["saving"] == 2.10
    assert by["SAVE5"]["status"] == "works" and by["SAVE5"]["saving"] == 5.0

    page = engine._site_page("mock")
    total = {}
    engine.submit("read", lambda: total.setdefault("t", page.inner_text("#total")))
    while engine.busy:
        time.sleep(0.1)
    assert total["t"] == "£15.99"  # best code (SAVE5) re-applied at the end
    assert any("Best code: SAVE5" in m for m in logs)
    engine.submit("close", lambda: engine.ctx.close())
    while engine.busy:
        time.sleep(0.1)


def test_member_and_new_customer_codes_follow_account_settings(env):
    from tcf.engine import Engine
    from tcf.store import Settings, Wallet

    logs, order = [], []
    wallet, settings = Wallet(), Settings()
    engine = Engine(wallet, lambda k, d: (logs.append(d["msg"]) if k == "log" else
                                          order.append(d["code"]) if k == "progress" and d else None), settings)
    wallet.upsert("mock", "BADCODE1", sources=["a", "b"])
    wallet.upsert("mock", "SAVE5", sources=["a"], member_only=True)
    wallet.upsert("mock", "TENOFF", sources=["a"], new_only=True)

    run(engine, engine.open_site, "mock")
    run(engine, engine.test_codes, "mock")
    assert order == ["BADCODE1"]  # member and new-customer codes skipped
    assert any("Skipping 2 codes" in m for m in logs)

    settings.set_account("mock", member=True)
    wallet.upsert("mock", "BADCODE2", sources=["a", "b", "c"])
    order.clear()
    run(engine, engine.test_codes, "mock")
    assert order == ["SAVE5", "BADCODE2"]  # member deal tried first, new-customer code still skipped
    assert {c["code"]: c["status"] for c in wallet.all()}["SAVE5"] == "works"
    engine.submit("close", lambda: engine.ctx.close())
    while engine.busy:
        time.sleep(0.1)
