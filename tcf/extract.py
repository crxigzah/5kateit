"""Pull likely promo codes out of scraped page text and read checkout results.

Everything here is pure text processing so it can be unit tested without a browser.
"""
import re

# Words that look like codes in shouty deal titles but aren't.
STOPWORDS = {
    "CODE", "CODES", "VOUCHER", "VOUCHERS", "PROMO", "PROMOTION", "DISCOUNT", "COUPON",
    "FREE", "DELIVERY", "UBER", "EATS", "UBEREATS", "DELIVEROO", "JUST", "JUSTEAT", "EAT",
    "NEW", "OFFER", "OFFERS", "DEAL", "DEALS", "LINK", "APP", "ORDER", "ORDERS", "NONE",
    "NEEDED", "REQUIRED", "EXPIRED", "HTTPS", "HTTP", "WWW", "THE", "THIS", "THAT", "AND",
    "FOR", "WITH", "YOUR", "WORKS", "WORKING", "VALID", "ONLY", "USERS", "USER", "CUSTOMERS",
    "EXISTING", "SELECTED", "ACCOUNTS", "OFF", "SAVE", "GBP", "MINIMUM", "SPEND", "HERE",
    "BELOW", "ABOVE", "TODAY", "TOMORROW", "WEEKEND", "CHECKOUT", "BASKET", "REFERRAL",
    "PLUS", "UBERONE", "ONE", "EDIT", "DELETED", "REMOVED", "UPDATE", "AMEX", "NHS", "UNIDAYS",
    "STUDENT", "STUDENTS", "BEANS", "HUKD", "LOL", "TIL", "PSA", "YMMV", "EDIT", "MCDONALDS",
}

_KEY = r"(?i:code|voucher|promo(?:\s?code)?|coupon)"
_SEP = r"\s*(?:is|was|:|-|–|=|of)?\s*[\"'“‘(\[]?"
_CODE = r"([A-Z0-9][A-Z0-9_-]{2,19}[A-Z0-9])"
PATTERNS = [
    re.compile(_KEY + _SEP + _CODE + r"(?![A-Za-z0-9])"),
    re.compile(r"(?i:\b(?:use|enter|apply|try))\s+(?i:the\s+)?(?:" + _KEY + r"\s+)?[\"'“‘]?" + _CODE + r"(?![A-Za-z0-9])"),
    re.compile(_CODE + r"[\"'”’]?\s+(?i:at checkout|in the app|for £|gives|gets you)"),
]
_NEAR_EXPIRED = re.compile(r"(?i)expired|no longer works|doesn'?t work|not working|dead")


def looks_like_code(tok: str) -> bool:
    if len(tok) < 4 or len(tok) > 20:
        return False
    if tok.upper() in STOPWORDS:
        return False
    if not re.search(r"[A-Z]", tok):
        return False  # all digits: prices, years, phone numbers
    if re.fullmatch(r"[A-Z]+", tok) and len(tok) < 5:
        return False  # short plain words like "SAVE", "WEEK" are rarely real codes
    if re.fullmatch(r"\d+(GB|MB|PM|AM|ML|KG|TH|ST|ND|RD)", tok):
        return False
    return True


def find_codes(text: str):
    """Return {CODE: {"hits": n, "context": str, "expired_hint": bool}} found in text."""
    found = {}
    for pat in PATTERNS:
        for m in pat.finditer(text):
            code = m.group(1).strip("-_")
            if not looks_like_code(code):
                continue
            start, end = max(0, m.start() - 90), min(len(text), m.end() + 90)
            ctx = " ".join(text[start:end].split())
            entry = found.setdefault(code, {"hits": 0, "context": ctx, "expired_hint": False})
            entry["hits"] += 1
            if _NEAR_EXPIRED.search(text[start:end]):
                entry["expired_hint"] = True
    return found


def merge_candidates(results):
    """results: list of (source_name, find_codes() dict). Rank by sources, hits, not-expired."""
    merged = {}
    for source, codes in results:
        for code, info in codes.items():
            m = merged.setdefault(code, {"code": code, "sources": [], "hits": 0,
                                         "context": info["context"], "expired_hint": False})
            if source not in m["sources"]:
                m["sources"].append(source)
            m["hits"] += info["hits"]
            m["expired_hint"] = m["expired_hint"] or info["expired_hint"]
    ranked = sorted(merged.values(),
                    key=lambda m: (m["expired_hint"], -len(m["sources"]), -m["hits"]))
    return ranked


def new_lines(before: str, after: str):
    """Lines present in the page text after applying a code that weren't there before."""
    seen = {ln.strip() for ln in before.splitlines()}
    return [ln.strip() for ln in after.splitlines() if ln.strip() and ln.strip() not in seen]


def read_total(text: str, total_re: str):
    m = None
    for m in re.finditer(total_re, text, re.I):
        pass  # the last "Total" on a checkout page is normally the amount to pay
    return float(m.group(1)) if m else None


def classify(before: str, after: str, cfg: dict):
    """Decide whether a code worked. Returns (status, message, saving)."""
    added = new_lines(before, after)
    blob = "\n".join(added)
    t0, t1 = read_total(before, cfg["total_text"]), read_total(after, cfg["total_text"])
    saving = round(t0 - t1, 2) if (t0 is not None and t1 is not None and t1 < t0) else None

    fail = re.search(cfg["failure_text"], blob, re.I)
    if fail:
        line = next((ln for ln in added if re.search(cfg["failure_text"], ln, re.I)), fail.group(0))
        return "rejected", line[:160], None
    if saving:
        return "works", f"Total dropped by £{saving:.2f}", saving
    ok = re.search(cfg["success_text"], blob, re.I)
    if ok:
        line = next((ln for ln in added if re.search(cfg["success_text"], ln, re.I)), ok.group(0))
        return "works", line[:160], None
    return "unknown", (added[0][:160] if added else "No visible response from the site"), None
