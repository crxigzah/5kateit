"""Where the app keeps its config, saved codes and browser profile."""
import json
import os
import shutil
import sys
import threading
import time
from pathlib import Path

APP_NAME = "5kateit"


def resource_dir() -> Path:
    # PyInstaller unpacks bundled files to sys._MEIPASS
    base = getattr(sys, "_MEIPASS", None)
    return Path(base) / "tcf" if base else Path(__file__).parent


def data_dir() -> Path:
    override = os.environ.get("TCF_DATA_DIR")
    if override:
        d = Path(override)
    elif os.name == "nt":
        d = Path(os.environ.get("APPDATA", Path.home())) / APP_NAME
    else:
        d = Path.home() / f".{APP_NAME.lower()}"
    d.mkdir(parents=True, exist_ok=True)
    return d


def config_path() -> Path:
    p = data_dir() / "sites.json"
    if not p.exists():
        shutil.copy(resource_dir() / "sites.json", p)
    return p


def load_config() -> dict:
    """User copy of sites.json, with any keys missing from it filled from the bundled default."""
    default = json.loads((resource_dir() / "sites.json").read_text(encoding="utf-8"))
    try:
        user = json.loads(config_path().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default
    cfg = {**default, **user}
    cfg["defaults"] = {**default["defaults"], **user.get("defaults", {})}
    cfg["testing"] = {**default["testing"], **user.get("testing", {})}
    cfg["sites"] = {k: {**default["sites"].get(k, {}), **v} for k, v in user.get("sites", default["sites"]).items()}
    return cfg


def profile_dir() -> Path:
    p = data_dir() / "browser-profile"
    p.mkdir(exist_ok=True)
    return p


class Wallet:
    """Saved codes per app, with their last test result."""

    def __init__(self):
        self.path = data_dir() / "codes.json"
        self.lock = threading.Lock()
        try:
            self.codes = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            self.codes = []

    def _save(self):
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.codes, indent=2), encoding="utf-8")
        tmp.replace(self.path)

    def all(self):
        with self.lock:
            return [dict(c) for c in self.codes]

    def find(self, site, code):
        for c in self.codes:
            if c["site"] == site and c["code"].upper() == code.upper():
                return c
        return None

    def upsert(self, site, code, **fields):
        with self.lock:
            c = self.find(site, code)
            if not c:
                c = {"site": site, "code": code.upper(), "status": "untested", "sources": [],
                     "message": "", "saving": None, "tested_at": None, "added_at": time.time()}
                self.codes.append(c)
            for k, v in fields.items():
                if k == "sources":
                    c["sources"] = sorted(set(c.get("sources", [])) | set(v))
                elif v is not None or k in ("saving",):
                    c[k] = v
            self._save()
            return dict(c)

    def delete(self, site, code):
        with self.lock:
            self.codes = [c for c in self.codes
                          if not (c["site"] == site and c["code"].upper() == code.upper())]
            self._save()
