"""Browser automation. All Playwright calls run on one worker thread."""
import os
import queue
import random
import re
import threading
import time
import traceback
from urllib.parse import quote

from . import extract, page_js
from .store import load_config, profile_dir

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36")


class Cancelled(Exception):
    pass


class Engine:
    def __init__(self, wallet, emit):
        self.wallet = wallet
        self.emit = emit
        self.jobs = queue.Queue()
        self.busy = None          # name of the job running, or None
        self.cancel = threading.Event()
        self.pw = None
        self.ctx = None
        self.thread = threading.Thread(target=self._run, daemon=True)
        self.thread.start()

    # ---------- job plumbing ----------
    def submit(self, name, fn, *args):
        if self.busy:
            return False
        self.busy = name
        self.cancel.clear()
        self.jobs.put((name, fn, args))
        self.emit("status", self.status())
        return True

    def status(self):
        return {"busy": self.busy, "browser": self.ctx is not None}

    def _run(self):
        while True:
            name, fn, args = self.jobs.get()
            if fn is None:
                break
            try:
                fn(*args)
            except Cancelled:
                self.log("Stopped.")
            except Exception as e:  # report and keep the worker alive
                self.log(f"Error: {e}", level="error")
                traceback.print_exc()
            finally:
                self.busy = None
                self.emit("status", self.status())

    def shutdown(self):
        self.jobs.put((None, None, ()))
        self.thread.join(timeout=5)

    def log(self, msg, level="info"):
        self.emit("log", {"msg": msg, "level": level, "t": time.time()})

    def _check(self):
        if self.cancel.is_set():
            raise Cancelled()

    def _sleep(self, seconds):
        end = time.time() + seconds
        while time.time() < end:
            self._check()
            time.sleep(0.2)

    # ---------- browser ----------
    def _ensure_browser(self):
        if self.ctx is not None:
            try:
                self.ctx.pages  # raises if the window was closed
                return
            except Exception:
                self.ctx = None
        from playwright.sync_api import sync_playwright
        if self.pw is None:
            self.pw = sync_playwright().start()
        forced = os.environ.get("TCF_BROWSER")
        channels = [forced] if forced else ["msedge", "chrome", None]
        headless = os.environ.get("TCF_HEADLESS") == "1"
        last = None
        for ch in channels:
            ch = None if ch in (None, "", "chromium") else ch
            try:
                self.ctx = self.pw.chromium.launch_persistent_context(
                    str(profile_dir()), channel=ch, headless=headless, no_viewport=True,
                    ignore_default_args=["--enable-automation"],
                    args=["--disable-blink-features=AutomationControlled",
                          # keep the user's synced extensions (coupon/cashback add-ons) out of this profile
                          "--disable-sync", "--disable-features=msImplicitSignin,msEdgeSyncConsent"])
                self.ctx.on("close", lambda *_: self._on_closed())
                self.log(f"Opened {ch or 'Chromium'} with your saved profile.")
                self.emit("status", self.status())
                return
            except Exception as e:
                last = e
        raise RuntimeError("Couldn't start a browser. Install Microsoft Edge or Google Chrome. "
                           f"Details: {last}")

    def _on_closed(self):
        self.ctx = None
        self.emit("status", self.status())

    def _site_page(self, site):
        if self.ctx is None:
            return None
        dom = self.cfg["sites"][site]["domain"]
        pages = [p for p in self.ctx.pages if dom in (p.url or "")]
        return pages[-1] if pages else None

    # ---------- jobs ----------
    def open_site(self, site):
        self.cfg = load_config()
        self._ensure_browser()
        s = self.cfg["sites"][site]
        page = self._site_page(site)
        if page is None:
            blank = [p for p in self.ctx.pages if p.url in ("about:blank", "")]
            page = blank[0] if blank else self.ctx.new_page()
            page.goto(s["start_url"], wait_until="domcontentloaded", timeout=45000)
        page.bring_to_front()
        self.log(f"{s['name']} is open. Log in, fill your basket and go to checkout, then come back and test codes.")

    def find_codes(self, site, extra_query=""):
        self.cfg = load_config()
        self._ensure_browser()
        s = self.cfg["sites"][site]
        query = " ".join(x for x in [s["query"], extra_query.strip()] if x)
        name_re = re.compile(re.sub(r"\s+", r"\\s*", re.escape(s["query"]).replace(r"\ ", " ")), re.I)
        results = []
        for src in self.cfg["sources"]:
            self._check()
            url = src["url"].replace("{q}", quote(query))
            self.log(f"Searching {src['name']}…")
            try:
                text = self._fetch_reddit(url, name_re) if src["kind"] == "reddit_json" else self._fetch_page(url)
            except Cancelled:
                raise
            except Exception as e:
                self.log(f"{src['name']} didn't load ({str(e).splitlines()[0][:100]}). Skipping.", level="warn")
                continue
            codes = extract.find_codes(text)
            self.log(f"{src['name']}: {len(codes)} possible code{'s' if len(codes) != 1 else ''}.")
            results.append((src["name"], codes))
        ranked = extract.merge_candidates(results)[:30]
        for c in ranked:
            existing = self.wallet.find(site, c["code"])
            self.wallet.upsert(site, c["code"], sources=c["sources"],
                               context=c["context"], expired_hint=c["expired_hint"],
                               **({} if existing else {"status": "untested"}))
        self.emit("codes", self.wallet.all())
        self.log(f"Found {len(ranked)} codes to try for {s['name']}." if ranked else
                 f"No codes found for {s['name']} right now. You can add your own.")

    def _fetch_page(self, url):
        page = self.ctx.new_page()
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=30000)
            self._sleep(2.5)  # let client-rendered results appear
            return page.evaluate(page_js.PAGE_TEXT)
        finally:
            page.close()

    def _fetch_reddit(self, url, name_re):
        r = self.ctx.request.get(url, headers={"User-Agent": UA}, timeout=20000)
        if not r.ok:
            raise RuntimeError(f"HTTP {r.status}")
        posts = r.json().get("data", {}).get("children", [])
        chunks = []
        for p in posts:
            d = p.get("data", {})
            blob = f"{d.get('title', '')}\n{d.get('selftext', '')}"
            if name_re.search(blob):
                chunks.append(blob)
        return "\n\n".join(chunks)

    def test_codes(self, site, codes=None):
        self.cfg = load_config()
        s, d, t = self.cfg["sites"][site], self.cfg["defaults"], self.cfg["testing"]
        page = self._site_page(site)
        if page is None:
            self.log(f"Open {s['name']} and go to the checkout page first.", level="error")
            return
        page.bring_to_front()
        if not codes:
            pool = [c for c in self.wallet.all() if c["site"] == site and c["status"] in ("untested", "unknown")]
            pool.sort(key=lambda c: (c.get("expired_hint", False), -len(c.get("sources", []))))
            codes = [c["code"] for c in pool]
        codes = codes[: int(t["max_codes_per_run"])]
        if not codes:
            self.log("Nothing to test. Find codes or add one first.", level="warn")
            return
        self.log(f"Testing {len(codes)} code{'s' if len(codes) != 1 else ''} on {s['name']}. Leave the browser alone while it runs.")
        working, applied = [], None
        for i, code in enumerate(codes, 1):
            self._check()
            self.emit("progress", {"site": site, "code": code, "i": i, "n": len(codes)})
            status, msg, saving = self._try_code(page, s, d, t, code)
            self.wallet.upsert(site, code, status=status, message=msg, saving=saving, tested_at=time.time())
            self.emit("codes", self.wallet.all())
            self.log(f"{code}: {status.upper()} — {msg}", level={"works": "good", "rejected": "info"}.get(status, "warn"))
            if status == "error":
                break
            if status == "works":
                working.append((saving or 0, code))
                applied = code
                if self._remove(page, d, code):
                    applied = None
                elif i < len(codes):
                    self.log("Couldn't remove it to try the rest, so stopping here with this code applied.", level="warn")
                    break
            if i < len(codes):
                self._sleep(random.uniform(t["min_delay_seconds"], t["max_delay_seconds"]))
        if working:
            best = max(working)[1]
            if applied != best:
                if applied:
                    self._remove(page, d, applied)
                self._sleep(1.5)
                self._try_code(page, s, d, t, best)
            self.log(f"Best code: {best}. It's applied in your basket now.", level="good")
        else:
            self.log("None of those worked. Try a different restaurant search, or check the app's own Offers page.")
        self.emit("progress", None)

    def apply_code(self, site, code):
        self.cfg = load_config()
        s, d, t = self.cfg["sites"][site], self.cfg["defaults"], self.cfg["testing"]
        page = self._site_page(site)
        if page is None:
            self.log(f"Open {s['name']} checkout first.", level="error")
            return
        page.bring_to_front()
        status, msg, saving = self._try_code(page, s, d, t, code)
        self.wallet.upsert(site, code, status=status, message=msg, saving=saving, tested_at=time.time())
        self.emit("codes", self.wallet.all())
        self.log(f"{code}: {status.upper()} — {msg}", level="good" if status == "works" else "info")

    # ---------- the actual coupon-box work ----------
    def _locate_input(self, page, s, d):
        if page.evaluate(page_js.FIND_INPUT, [d["input_hint"], s.get("input_selector", "")]):
            return True
        if page.evaluate(page_js.FIND_OPENER, [d["open_text"], s.get("open_selector", "")]):
            page.locator('[data-tcf="open"]').first.click(timeout=5000)
            for _ in range(8):
                self._sleep(0.5)
                if page.evaluate(page_js.FIND_INPUT, [d["input_hint"], s.get("input_selector", "")]):
                    return True
        return False

    def _try_code(self, page, s, d, t, code):
        if not self._locate_input(page, s, d):
            return ("error", "Couldn't find the promo code box on this page. Go to the checkout "
                             "(or open the promo/voucher section) and try again.", None)
        before = page.evaluate(page_js.PAGE_TEXT)
        box = page.locator('[data-tcf="input"]').first
        box.click(timeout=5000)
        box.fill("")
        box.press_sequentially(code, delay=random.randint(60, 140))
        self._sleep(random.uniform(0.3, 0.8))
        if page.evaluate(page_js.FIND_APPLY, [d["apply_text"], s.get("apply_selector", "")]):
            page.locator('[data-tcf="apply"]').first.click(timeout=5000)
        else:
            box.press("Enter")
        result = ("unknown", "No visible response from the site", None)
        deadline = time.time() + float(t["result_wait_seconds"])
        while time.time() < deadline:
            self._sleep(0.5)
            try:
                after = page.evaluate(page_js.PAGE_TEXT)
            except Exception:
                continue  # page mid-navigation
            result = extract.classify(before, after, d)
            if result[0] != "unknown":
                # give the total a moment to update, then re-read for the saving
                self._sleep(1.0)
                after = page.evaluate(page_js.PAGE_TEXT)
                again = extract.classify(before, after, d)
                return again if again[0] == result[0] else result
        return result

    def _remove(self, page, d, code):
        if not page.evaluate(page_js.FIND_REMOVE, [d["remove_text"], code.upper()]):
            return False
        try:
            page.locator('[data-tcf="remove"]').first.click(timeout=5000)
        except Exception:
            return False
        self._sleep(1.5)
        return code.upper() not in page.evaluate(page_js.PAGE_TEXT).upper()
