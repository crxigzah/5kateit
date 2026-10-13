// Pull likely promo codes out of deal-site text, and read checkout results.
// Plain functions with no browser APIs, so the same file runs in the page, the panel and Node tests.
(function (root) {
  const STOPWORDS = new Set(("CODE CODES VOUCHER VOUCHERS PROMO PROMOTION DISCOUNT COUPON FREE DELIVERY UBER EATS " +
    "UBEREATS DELIVEROO JUST JUSTEAT EAT NEW OFFER OFFERS DEAL DEALS LINK APP ORDER ORDERS NONE NEEDED REQUIRED " +
    "EXPIRED HTTPS HTTP WWW THE THIS THAT AND FOR WITH YOUR WORKS WORKING VALID ONLY USERS USER CUSTOMERS EXISTING " +
    "SELECTED ACCOUNTS OFF SAVE GBP MINIMUM SPEND HERE BELOW ABOVE TODAY TOMORROW WEEKEND CHECKOUT BASKET REFERRAL " +
    "PLUS UBERONE ONE EDIT DELETED REMOVED UPDATE AMEX NHS UNIDAYS STUDENT STUDENTS BEANS HUKD LOL TIL PSA YMMV " +
    "MCDONALDS").split(" "));

  // Keywords match any case; the code itself must be upper case (as in the Python version).
  const ci = w => w.replace(/[a-z]/g, c => `[${c}${c.toUpperCase()}]`);
  const KEY = `(?:${ci("code")}|${ci("voucher")}|${ci("promo")}(?:\\s?${ci("code")})?|${ci("coupon")})`;
  const SEP = `\\s*(?:${ci("is")}|${ci("was")}|:|-|–|=|${ci("of")})?\\s*["'“‘(\\[]?`;
  const CODE = "([A-Z0-9][A-Z0-9_-]{2,19}[A-Z0-9])";
  const PATTERNS = [
    new RegExp(KEY + SEP + CODE + "(?![A-Za-z0-9])", "g"),
    new RegExp(`\\b(?:${ci("use")}|${ci("enter")}|${ci("apply")}|${ci("try")})\\s+(?:${ci("the")}\\s+)?(?:${KEY}\\s+)?["'“‘]?` + CODE + "(?![A-Za-z0-9])", "g"),
    new RegExp(CODE + `["'”’]?\\s+(?:${ci("at checkout")}|${ci("in the app")}|${ci("for")} £|${ci("gives")}|${ci("gets you")})`, "g"),
    // Codes voucher sites hide behind "reveal" buttons but still ship in the page
    /"(?:voucherCode|voucher_code|couponCode|coupon_code|promoCode|promo_code|discountCode|code)"\s*:\s*"([A-Z0-9][A-Z0-9_-]{2,19}[A-Z0-9])"/g,
    /\bdata-(?:code|coupon|coupon-code|voucher|voucher-code|promo|promo-code|clipboard-text)\s*=\s*["']([A-Z0-9][A-Z0-9_-]{2,19}[A-Z0-9])["']/g,
  ];
  const NEAR_EXPIRED = /expired|no longer works|doesn'?t work|not working|dead/i;
  const NEAR_MEMBER = /deliveroo\s*plus|\bplus\s+(members?|subscribers?|customers?)|uber\s*one|just\s*eat\s*(\+|plus)|members?[\s-]*(only|exclusive)|exclusive (to|for) members|for (all )?members|subscribers? only/i;
  const NEAR_NEW = /new (customers?|users?|accounts?|members only)|first[\s-]*(time )?order|1st order|first[\s-]*time (customers?|users?)/i;

  function looksLikeCode(tok) {
    if (tok.length < 4 || tok.length > 20) return false;
    if (STOPWORDS.has(tok.toUpperCase())) return false;
    if (!/[A-Z]/.test(tok)) return false;                   // all digits: prices, years
    if (/^[A-Z]+$/.test(tok) && tok.length < 5) return false; // short plain words
    if (/^\d+(GB|MB|PM|AM|ML|KG|TH|ST|ND|RD)$/.test(tok)) return false;
    return true;
  }

  function findCodes(text) {
    const found = {};
    for (const pat of PATTERNS) {
      pat.lastIndex = 0;
      let m;
      while ((m = pat.exec(text))) {
        const code = m[1].replace(/^[-_]+|[-_]+$/g, "");
        if (!looksLikeCode(code)) continue;
        // Look up to 90 characters either side, but not past the edge of this post/paragraph.
        const para0 = text.lastIndexOf("\n\n", m.index), para1 = text.indexOf("\n\n", m.index + m[0].length);
        const start = Math.max(0, m.index - 90, para0 === -1 ? 0 : para0 + 2);
        const end = Math.min(text.length, m.index + m[0].length + 90, para1 === -1 ? text.length : para1);
        const near = text.slice(start, end);
        const e = found[code] || (found[code] = {hits: 0, context: near.split(/\s+/).join(" ").trim(),
                                                 expired_hint: false, member_only: false, new_only: false});
        e.hits += 1;
        if (NEAR_EXPIRED.test(near)) e.expired_hint = true;
        if (NEAR_MEMBER.test(near)) e.member_only = true;
        if (NEAR_NEW.test(near)) e.new_only = true;
      }
    }
    return found;
  }

  function mergeCandidates(results) {
    const merged = {};
    for (const [source, codes] of results) {
      for (const [code, info] of Object.entries(codes)) {
        const m = merged[code] || (merged[code] = {code, sources: [], hits: 0, context: info.context,
                                                   expired_hint: false, member_only: false, new_only: false});
        if (!m.sources.includes(source)) m.sources.push(source);
        m.hits += info.hits;
        for (const f of ["expired_hint", "member_only", "new_only"]) m[f] = m[f] || !!info[f];
      }
    }
    return Object.values(merged).sort((a, b) =>
      (a.expired_hint - b.expired_hint) || (b.sources.length - a.sources.length) || (b.hits - a.hits));
  }

  function newLines(before, after) {
    const seen = new Set(before.split("\n").map(l => l.trim()));
    return after.split("\n").map(l => l.trim()).filter(l => l && !seen.has(l));
  }

  function readTotal(text, totalRe) {
    let last = null;
    for (const m of text.matchAll(new RegExp(totalRe, "gi"))) last = m; // last "Total" is the amount to pay
    return last ? parseFloat(last[1]) : null;
  }

  // Did a code work? Returns [status, message, saving]
  function classify(before, after, cfg) {
    const added = newLines(before, after), blob = added.join("\n");
    const t0 = readTotal(before, cfg.total_text), t1 = readTotal(after, cfg.total_text);
    const saving = (t0 !== null && t1 !== null && t1 < t0) ? Math.round((t0 - t1) * 100) / 100 : null;
    const failRe = new RegExp(cfg.failure_text, "i"), okRe = new RegExp(cfg.success_text, "i");
    if (failRe.test(blob)) return ["rejected", (added.find(l => failRe.test(l)) || "").slice(0, 160), null];
    if (saving) return ["works", `Total dropped by £${saving.toFixed(2)}`, saving];
    if (okRe.test(blob)) return ["works", (added.find(l => okRe.test(l)) || "").slice(0, 160), null];
    return ["unknown", added.length ? added[0].slice(0, 160) : "No visible response from the site", null];
  }

  // Codes hidden in a page's markup (reveal buttons, page data). Returned as separate paragraphs so
  // wording from neighbouring posts can't leak onto them.
  const HIDDEN = [PATTERNS[3], PATTERNS[4]];
  function hiddenCodes(html) {
    const out = new Set();
    for (const pat of HIDDEN) {
      pat.lastIndex = 0;
      let m;
      while ((m = pat.exec(html))) if (looksLikeCode(m[1])) out.add(m[1]);
    }
    return [...out].map(c => `code ${c}`).join("\n\n");
  }

  const api = {findCodes, mergeCandidates, classify, readTotal, newLines, looksLikeCode, hiddenCodes};
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SnackExtract = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
