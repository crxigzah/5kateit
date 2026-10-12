# Takeaway Code Finder

Windows desktop app that finds promo codes for **Deliveroo**, **Just Eat** and **Uber Eats** on UK deal sites and tests them in the checkout's promo box, then leaves the best one applied.

## How it works

1. **Open** – launches your installed Edge (or Chrome) through Playwright with a dedicated, saved profile. You log in and fill your basket yourself.
2. **Find codes** – loads HotUKDeals, Latest Deals and Reddit search results, extracts code-like strings (`tcf/extract.py`) and ranks them by how many sources mention them.
3. **Test** – on the checkout page it finds the promo box (opening "Add promo/voucher" if needed), types each code with human-like delays, reads the page for success/error text and the change in the total, removes working codes so the rest can be tried, then re-applies the best one.

Limits per run (max codes, delays, wait time) live in `sites.json`. The app never clicks pay.

## Run from source

```
python -m venv .venv && .venv\Scripts\activate      # or: source .venv/bin/activate
pip install -r requirements-dev.txt
python -m tcf
```

Useful environment variables: `TCF_BROWSER` (`msedge`, `chrome`, `chromium`), `TCF_HEADLESS=1`, `TCF_NO_WINDOW=1`, `TCF_PORT`, `TCF_DATA_DIR`.

## When a site changes

The user's copy of the config is at `%APPDATA%\TakeawayCodeFinder\sites.json`. If the promo box isn't found, set `input_selector`, `apply_selector` or `open_selector` for that site to a CSS selector (right-click the box in the browser → Inspect). Success/failure wording is matched with the regexes under `defaults`.

## Tests

```
python -m pytest -q
```

`tests/test_e2e_mock.py` runs the real engine in headless Chromium against `tests/mock_checkout.html`.

## Releases and website

`.github/workflows/build.yml`:

- runs the tests,
- builds the app with PyInstaller on Windows and makes `TakeawayCodeFinder-Setup.exe` (Inno Setup, per-user install) plus a portable zip,
- on every push to `main`, publishes them as the GitHub Release `v<version>` using the version in `tcf/__init__.py` (bump it to cut a new release),
- publishes `site/` to GitHub Pages (enable Pages → Source: GitHub Actions in repo settings).

The download buttons on the site point to `releases/latest`, so each new release updates them automatically.

## Caveats

Automated use is against the delivery apps' terms. The app keeps runs small and slow, but use it on your own account at your own risk. The builds aren't code-signed, so Windows SmartScreen will warn on first run.
