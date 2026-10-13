# Snackhack

*Hack your takeaway bill.*

Windows desktop app that finds promo codes for **Deliveroo**, **Just Eat** and **Uber Eats** on UK deal sites and tests them in the checkout's promo box, then leaves the best one applied.

## Browser extension (main version)

`extension/` is a Manifest V3 extension for Chrome, Edge, Brave, Opera and Vivaldi. Click the toolbar icon to open the Snackhack side panel (a popup in browsers without side panels).

- **Finding codes** – fetches 13 sources in parallel (HotUKDeals search, vouchers and merchant page, Latest Deals, Reddit site-wide and the app's subreddit, VoucherCodes, MyVoucherCodes, Groupon, CouponFollow, Wethrift, Discoup, Savoo, DealHack; list in `lib/config.js`). No cookies are sent. `lib/extract.js` reads codes from page text plus ones hidden in reveal buttons and page data.
- **Unlocking** – `content/watch.js` runs on Deliveroo, Just Eat and Uber Eats and tells the panel when the promo box (or a checkout's "add promo code" link) is showing. Try codes stays greyed out until then.
- **Try codes** – one tap: searches first if the last search is over 30 minutes old, then tries up to 20 codes (previous winners first; failures get retried after 14 days), leaves the best applied, and records each code's tries, wins and saving plus a history of runs for the savings totals.
- Codes, membership switches, history and the log live in `chrome.storage.local`. Nothing is sent anywhere else.

Try it locally: `chrome://extensions` → Developer mode → Load unpacked → pick `extension/`.

Tests: `node --test extension/test/*.test.js` (extraction) and `python -m pytest tests/test_extension_*.py` (the in-page tester and the full side panel, run with the real extension loaded in Chromium against a mock checkout).

Publishing: upload `Snackhack-extension.zip` from the latest release to the Chrome Web Store / Edge Add-ons. The privacy policy is `site/privacy.html`. Keep `extension/manifest.json` and `tcf/__init__.py` on the same version (CI checks this).

## Windows app (classic)

The original desktop app (`tcf/`) still builds as `Snackhack-Setup.exe`. It does the same thing but drives a separate browser window.

## How it works

1. **Open** – launches your installed Edge (or Chrome) through Playwright with a dedicated, saved profile. You log in and fill your basket yourself.
2. **Find codes** – loads HotUKDeals, Latest Deals and Reddit search results, extracts code-like strings (`tcf/extract.py`) and ranks them by how many sources mention them. Codes are tagged members-only (Deliveroo Plus, Just Eat+, Uber One) or new-customers-only from the surrounding text. With the membership toggle on, a second search runs for member deals.
3. **Test** – on the checkout page it finds the promo box (opening "Add promo/voucher" if needed), types each code with human-like delays, reads the page for success/error text and the change in the total, removes working codes so the rest can be tried, then re-applies the best one. Codes the account can't use (members-only without a membership, new-customer codes on an existing account) are skipped; members' deals are tried first.

Limits per run (max codes, delays, wait time) live in `sites.json`. The app never clicks pay.

## Run from source

```
python -m venv .venv && .venv\Scripts\activate      # or: source .venv/bin/activate
pip install -r requirements-dev.txt
python -m tcf
```

Useful environment variables: `TCF_CHROMIUM_PATH` (use a specific Chromium build, e.g. in tests), `TCF_HEADLESS=1`, `TCF_NO_WINDOW=1`, `TCF_PORT`, `TCF_DATA_DIR`.

## When a site changes

The user's copy of the config is at `%APPDATA%\Snackhack\sites.json`. If the promo box isn't found, set `input_selector`, `apply_selector` or `open_selector` for that site to a CSS selector (right-click the box in the browser → Inspect). Success/failure wording is matched with the regexes under `defaults`.

## Tests

```
python -m pytest -q
```

`tests/test_e2e_mock.py` runs the real engine in headless Chromium against `tests/mock_checkout.html`.

## Releases and website

`.github/workflows/build.yml`:

- runs the tests,
- builds the app with PyInstaller on Windows and makes `Snackhack-Setup.exe` (Inno Setup, per-user install) plus a portable zip,
- on every push to `main`, publishes them as the GitHub Release `v<version>` using the version in `tcf/__init__.py` (bump it to cut a new release),
- publishes `site/` to GitHub Pages (enable Pages → Source: GitHub Actions in repo settings).

The download buttons on the site point to `releases/latest`, so each new release updates them automatically.

## Caveats

Automated use is against the delivery apps' terms. The app keeps runs small and slow, but use it on your own account at your own risk. The builds aren't code-signed, so Windows SmartScreen will warn on first run.

## Credits

Bundled fonts: Plus Jakarta Sans and JetBrains Mono, both under the SIL Open Font License.
