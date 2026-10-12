"""Start the app: local server + an Edge/Chrome app-mode window (falls back to the default browser)."""
import os
import shutil
import socket
import subprocess
import sys
import threading
import webbrowser
from pathlib import Path

from werkzeug.serving import make_server

from .server import create_app
from .store import data_dir

TITLE = "Takeaway Code Finder"


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


def main():
    if sys.stdout is None:  # windowed build has no console
        log = open(data_dir() / "app.log", "a", encoding="utf-8", buffering=1)
        sys.stdout = sys.stderr = log

    app = create_app()
    port = int(os.environ.get("TCF_PORT") or free_port())
    srv = make_server("127.0.0.1", port, app, threaded=True)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{port}/"
    print(f"{TITLE} running at {url}", flush=True)

    browser = None if os.environ.get("TCF_NO_WINDOW") == "1" else find_app_browser()
    try:
        if browser:
            # Own profile folder = own process, so wait() returns when the window is closed.
            subprocess.Popen([browser, f"--app={url}", f"--user-data-dir={data_dir() / 'ui-window'}",
                              "--no-first-run", "--no-default-browser-check",
                              "--window-size=1180,860"]).wait()
        else:
            if os.environ.get("TCF_NO_WINDOW") != "1":
                webbrowser.open(url)
            threading.Event().wait()
    except KeyboardInterrupt:
        pass
    finally:
        app.engine.cancel.set()
        srv.shutdown()
        os._exit(0)  # Playwright's worker thread would otherwise keep the process alive


if __name__ == "__main__":
    main()
