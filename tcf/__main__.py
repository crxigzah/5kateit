"""Start the app: local server + an Edge/Chrome app-mode window (falls back to the default browser)."""
import os
import shutil
import socket
import subprocess
import sys
import threading
import time
import traceback
import webbrowser
from pathlib import Path

from werkzeug.serving import make_server

from .server import create_app
from .store import data_dir

TITLE = "5kateit"
# Flags for the UI window's own profile. Without these, Edge signs the new profile into the
# Windows account and syncs bookmarks and extensions (e.g. coupon/cashback add-ons) into it,
# and the first-run sync makes Edge relaunch itself.
UI_FLAGS = [
    "--no-first-run", "--no-default-browser-check", "--disable-sync", "--disable-extensions",
    "--disable-component-extensions-with-background-pages", "--disable-background-networking",
    "--disable-features=msImplicitSignin,msEdgeSyncConsent,msWelcomePage,msUndersideButton,EdgeCollections",
    "--window-size=1180,860",
]
STARTUP_GRACE = 25    # seconds to wait for the window to connect before opening the default browser
CLOSE_GRACE = 12      # seconds with no window connected before the app exits


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def find_app_browser():
    cands = []
    if os.name == "nt":
        for base in (os.environ.get("PROGRAMFILES(X86)"), os.environ.get("PROGRAMFILES"), os.environ.get("LOCALAPPDATA")):
            if base:
                cands += [Path(base) / "Microsoft/Edge/Application/msedge.exe",
                          Path(base) / "Google/Chrome/Application/chrome.exe"]
    else:
        cands += [shutil.which(n) for n in ("microsoft-edge", "google-chrome", "chromium", "chromium-browser")]
    return next((str(c) for c in cands if c and Path(c).exists()), None)


def open_window(url):
    browser = find_app_browser()
    if browser:
        try:
            # Not waited on: Edge can hand off to another process and exit straight away.
            # 1.0.x used "ui-window", which Edge may already have signed in and filled with synced add-ons.
            shutil.rmtree(data_dir() / "ui-window", ignore_errors=True)
            subprocess.Popen([browser, f"--app={url}", f"--user-data-dir={data_dir() / 'app-window'}", *UI_FLAGS])
            return
        except OSError:
            traceback.print_exc()
    webbrowser.open(url)


def wait_until_closed(app, url):
    """Keep running while the app window is open (it holds a live /api/events connection)."""
    ui = app.ui_state
    started, fallback_done = time.time(), False
    while True:
        time.sleep(1)
        if ui["clients"] > 0:
            continue
        if ui["ever"]:
            if time.time() - ui["last_change"] > CLOSE_GRACE:
                return
        elif time.time() - started > STARTUP_GRACE and not fallback_done:
            print("App window didn't connect; opening the default browser instead.", flush=True)
            webbrowser.open(url)
            fallback_done = True
        elif fallback_done and time.time() - started > STARTUP_GRACE * 8:
            return  # nobody ever opened the UI


def main():
    if sys.stdout is None:  # windowed build has no console
        log = open(data_dir() / "app.log", "a", encoding="utf-8", buffering=1)
        sys.stdout = sys.stderr = log
    print(f"--- {TITLE} starting {time.strftime('%Y-%m-%d %H:%M:%S')}", flush=True)

    app = create_app()
    port = int(os.environ.get("TCF_PORT") or free_port())
    srv = make_server("127.0.0.1", port, app, threaded=True)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{port}/"
    print(f"{TITLE} running at {url}", flush=True)

    try:
        if os.environ.get("TCF_NO_WINDOW") == "1":
            threading.Event().wait()
        open_window(url)
        wait_until_closed(app, url)
    except KeyboardInterrupt:
        pass
    except Exception:
        traceback.print_exc()
    finally:
        print(f"{TITLE} closing", flush=True)
        app.engine.cancel.set()
        srv.shutdown()
        os._exit(0)  # Playwright's worker thread would otherwise keep the process alive


if __name__ == "__main__":
    main()
