"""Local web server behind the app window. Only listens on 127.0.0.1."""
import json
import queue
import threading
import time

from flask import Flask, Response, jsonify, request, send_from_directory

from . import browsers
from .engine import Engine
from .store import Settings, Wallet, config_path, load_config, resource_dir


def create_app():
    app = Flask(__name__, static_folder=None)
    subscribers, sub_lock = [], threading.Lock()
    history = []  # recent log lines so a reloaded window can catch up

    def emit(kind, data):
        msg = {"kind": kind, "data": data}
        if kind == "log":
            history.append(msg)
            del history[:-200]
        with sub_lock:
            for q in subscribers:
                q.put(msg)

    wallet = Wallet()
    settings = Settings()
    engine = Engine(wallet, emit, settings)
    app.engine = engine
    # The app window keeps /api/events open; __main__ exits once it has been gone a while.
    app.ui_state = {"clients": 0, "ever": False, "last_change": time.time()}

    def ui_connected(delta):
        with sub_lock:
            app.ui_state["clients"] += delta
            app.ui_state["ever"] = True
            app.ui_state["last_change"] = time.time()
    static = resource_dir() / "static"

    def site_ok(site):
        return site in load_config()["sites"]

    @app.get("/")
    def index():
        return send_from_directory(static, "index.html")

    @app.get("/static/<path:name>")
    def assets(name):
        return send_from_directory(static, name)

    @app.get("/api/state")
    def state():
        cfg = load_config()
        return jsonify({
            "sites": {k: {"name": v["name"], "member_name": v.get("member_name", "")} for k, v in cfg["sites"].items()},
            "accounts": settings.all_accounts(cfg["sites"]),
            "browsers": [{"id": b["id"], "name": b["name"]} for b in browsers.installed()],
            "browser": (browsers.pick(settings.browser()) or {}).get("id"),
            "codes": wallet.all(),
            "status": engine.status(),
            "log": [m["data"] for m in history],
            "config_path": str(config_path()),
            "max_codes": cfg["testing"]["max_codes_per_run"],
        })

    def start(name, fn, *args):
        if not engine.submit(name, fn, *args):
            return jsonify({"ok": False, "error": f"Busy: {engine.busy}. Wait or press Stop."}), 409
        return jsonify({"ok": True})

    @app.post("/api/open")
    def open_site():
        site = request.json.get("site")
        if not site_ok(site):
            return jsonify({"ok": False, "error": "Unknown app"}), 400
        return start("Opening site", engine.open_site, site)

    @app.post("/api/find")
    def find():
        site = request.json.get("site")
        if not site_ok(site):
            return jsonify({"ok": False, "error": "Unknown app"}), 400
        return start("Finding codes", engine.find_codes, site, request.json.get("query", "")[:60])

    @app.post("/api/test")
    def test():
        site = request.json.get("site")
        if not site_ok(site):
            return jsonify({"ok": False, "error": "Unknown app"}), 400
        codes = [str(c).strip().upper()[:24] for c in request.json.get("codes") or [] if str(c).strip()]
        return start("Testing codes", engine.test_codes, site, codes or None)

    @app.post("/api/apply")
    def apply():
        site, code = request.json.get("site"), str(request.json.get("code", "")).strip().upper()
        if not site_ok(site) or not code:
            return jsonify({"ok": False, "error": "Pick an app and a code"}), 400
        return start("Applying code", engine.apply_code, site, code)

    @app.post("/api/account")
    def account():
        site = request.json.get("site")
        if not site_ok(site):
            return jsonify({"ok": False, "error": "Unknown app"}), 400
        acct = settings.set_account(site, **{k: request.json[k] for k in ("member", "new") if k in request.json})
        return jsonify({"ok": True, "account": acct})

    @app.post("/api/browser")
    def set_browser():
        bid = request.json.get("id")
        if bid not in {b["id"] for b in browsers.installed()}:
            return jsonify({"ok": False, "error": "That browser isn't installed"}), 400
        settings.set_browser(bid)
        emit("status", engine.status())
        return jsonify({"ok": True, "browser": bid})

    @app.post("/api/stop")
    def stop():
        engine.cancel.set()
        return jsonify({"ok": True})

    @app.post("/api/codes")
    def add_code():
        site, code = request.json.get("site"), str(request.json.get("code", "")).strip().upper()
        if not site_ok(site) or not code or len(code) > 24:
            return jsonify({"ok": False, "error": "Enter a code (up to 24 characters)"}), 400
        wallet.upsert(site, code, sources=["Added by you"])
        emit("codes", wallet.all())
        return jsonify({"ok": True})

    @app.delete("/api/codes")
    def delete_code():
        wallet.delete(request.json.get("site"), str(request.json.get("code", "")))
        emit("codes", wallet.all())
        return jsonify({"ok": True})

    @app.get("/api/events")
    def events():
        q = queue.Queue()
        with sub_lock:
            subscribers.append(q)

        def stream():
            ui_connected(+1)  # inside the generator so it always pairs with the finally below
            try:
                yield "retry: 2000\n\n"
                while True:
                    try:
                        msg = q.get(timeout=4)  # short ping so a closed window is noticed quickly
                        yield f"data: {json.dumps(msg)}\n\n"
                    except queue.Empty:
                        yield ": ping\n\n"
            finally:
                with sub_lock:
                    if q in subscribers:
                        subscribers.remove(q)
                ui_connected(-1)

        return Response(stream(), mimetype="text/event-stream",
                        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    return app
