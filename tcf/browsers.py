"""Find the user's browsers and open them normally, with a debugging port Snackhack can attach to.

The browser is started as a plain process (no automation flags) so sites see an ordinary
browser while the user logs in and shops. Snackhack only connects for the few seconds it
needs to find or try codes, then disconnects again.
"""
import os
import shutil
import socket
import subprocess
import time
from pathlib import Path

from .store import data_dir

# id, display name, path under one of the Windows install roots
WINDOWS = [
    ("msedge", "Microsoft Edge", ["Microsoft/Edge/Application/msedge.exe"]),
    ("chrome", "Google Chrome", ["Google/Chrome/Application/chrome.exe"]),
    ("brave", "Brave", ["BraveSoftware/Brave-Browser/Application/brave.exe"]),
    ("opera-gx", "Opera GX", ["Programs/Opera GX/opera.exe"]),
    ("opera", "Opera", ["Programs/Opera/opera.exe"]),
    ("vivaldi", "Vivaldi", ["Vivaldi/Application/vivaldi.exe"]),
]
POSIX = [
    ("msedge", "Microsoft Edge", ["microsoft-edge", "microsoft-edge-stable"]),
    ("chrome", "Google Chrome", ["google-chrome", "google-chrome-stable"]),
    ("brave", "Brave", ["brave-browser", "brave"]),
    ("chromium", "Chromium", ["chromium", "chromium-browser"]),
    ("opera", "Opera", ["opera"]),
    ("vivaldi", "Vivaldi", ["vivaldi"]),
]


def installed():
    """Browsers Snackhack can drive, in order of preference."""
    found = []
    if os.name == "nt":
        roots = [os.environ.get(k) for k in ("PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA")]
        for bid, name, rels in WINDOWS:
            for root in filter(None, roots):
                p = next((Path(root) / r for r in rels if (Path(root) / r).exists()), None)
                if p:
                    found.append({"id": bid, "name": name, "path": str(p)})
                    break
    else:
        for bid, name, cmds in POSIX:
            p = next((shutil.which(c) for c in cmds if shutil.which(c)), None)
            if p:
                found.append({"id": bid, "name": name, "path": p})
    test_path = os.environ.get("TCF_CHROMIUM_PATH")
    if test_path:  # tests and development: Playwright's own Chromium
        found.insert(0, {"id": "chromium", "name": "Chromium (test)", "path": test_path})
    return found


def pick(browser_id):
    """The chosen browser, or the first installed one."""
    all_ = installed()
    return next((b for b in all_ if b["id"] == browser_id), all_[0] if all_ else None)


def profile_dir(browser):
    # Edge keeps the folder name earlier versions used, so existing logins carry over.
    name = "browser-profile" if browser["id"] == "msedge" else f"profile-{browser['id']}"
    p = data_dir() / name
    p.mkdir(parents=True, exist_ok=True)
    return p


def debug_port(profile):
    """Port of a running browser using this profile, or None."""
    f = Path(profile) / "DevToolsActivePort"
    try:
        port = int(f.read_text().splitlines()[0])
    except (OSError, ValueError, IndexError):
        return None
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.5):
            return port
    except OSError:
        return None


def launch(browser, url, wait=25):
    """Open url in the browser (a new tab if it's already running). Returns the debug port."""
    profile = profile_dir(browser)
    running = debug_port(profile)
    if not running:
        (profile / "DevToolsActivePort").unlink(missing_ok=True)
    args = [browser["path"], "--remote-debugging-port=0", f"--user-data-dir={profile}",
            "--no-first-run", "--no-default-browser-check",
            # Keep coupon/cashback add-ons (which pop up over checkouts) out of this profile.
            "--disable-extensions", "--disable-sync"]
    if browser["id"] == "msedge":
        args.append("--disable-features=msImplicitSignin,msEdgeSyncConsent")
    if os.environ.get("TCF_HEADLESS") == "1":
        args.append("--headless=new")
    if browser["id"] == "chromium" and os.name != "nt":
        # Test-only Chromium on Linux CI: Ubuntu blocks its sandbox for plain (non-Playwright) launches.
        args.append("--no-sandbox")
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0
    subprocess.Popen(args + [url], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                     stdin=subprocess.DEVNULL, creationflags=flags)
    end = time.time() + wait
    while time.time() < end:
        port = debug_port(profile)
        if port:
            return port
        time.sleep(0.25)
    return None
