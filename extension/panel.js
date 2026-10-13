// Snackhack side panel: finds codes on deal sites and tries them in the current checkout tab.
const C = SnackConfig, X = SnackExtract;
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const gbp = n => "£" + Number(n).toFixed(2);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const STATUS = {works:"Works", rejected:"Didn't work", unknown:"Unclear", error:"Couldn't try", untested:"Not tried yet"};
const ORDER = {works:0, untested:1, unknown:2, error:3, rejected:4};
const FILTERS = [["all","All"],["works","Working"],["todo","To try"],["rejected","Didn't work"]];

const S = {site: "deliveroo", tab: null, tabSite: null, promo: null, codes: [], accounts: {}, log: [], history: [],
           lastFind: {}, busy: null, progress: null, filter: "all", stop: false};
const REFIND_AFTER = 30 * 60 * 1000;      // Try codes searches again if the last search is older than this
const RETRY_AFTER = 14 * 24 * 3600 * 1000; // codes that failed get another go after two weeks

/* ---------- storage ---------- */
async function load() {
  const d = await chrome.storage.local.get(["codes", "accounts", "log", "site", "history", "lastFind"]);
  S.codes = d.codes || []; S.accounts = d.accounts || {}; S.log = d.log || [];
  S.history = d.history || []; S.lastFind = d.lastFind || {};
  if (d.site && C.sites[d.site]) S.site = d.site;
}
const saveCodes = () => chrome.storage.local.set({codes: S.codes});
const saveAccounts = () => chrome.storage.local.set({accounts: S.accounts});

function upsert(site, code, fields = {}) {
  code = code.toUpperCase();
  let c = S.codes.find(x => x.site === site && x.code === code);
  if (!c) {
    c = {site, code, status: "untested", sources: [], message: "", saving: null, tested_at: null, added_at: Date.now()};
    S.codes.push(c);
  }
  for (const [k, v] of Object.entries(fields)) {
    if (k === "sources") c.sources = [...new Set([...(c.sources || []), ...v])].sort();
    else if (v !== undefined) c[k] = v;
  }
  return c;
}

function log(msg, level = "info") {
  S.log.push({msg, level, t: Date.now()});
  S.log = S.log.slice(-120);
  chrome.storage.local.set({log: S.log});
  renderLog();
  if (level === "error") toast(msg);
}

let toastTimer;
function toast(msg) {
  const t = $("toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.hidden = true, 3800);
}

/* ---------- helpers ---------- */
const site = () => C.sites[S.site];
const acct = () => S.accounts[S.site] || {member: false, new: false};
const siteCodes = () => S.codes.filter(c => c.site === S.site);
const usable = c => { const a = S.accounts[c.site] || {}; return !((c.member_only && !a.member) || (c.new_only && !a.new)); };
// Worth trying on this basket: new codes, unclear ones, ones that worked before (they often work again),
// and failures old enough that they might have been switched on since.
const due = c => ["untested", "unknown", "works"].includes(c.status) ||
  (["rejected", "error"].includes(c.status) && c.tested_at && Date.now() - c.tested_at > RETRY_AFTER);
const toTry = () => siteCodes().filter(c => due(c) && usable(c));
const onSiteTab = () => S.tab && S.tabSite === S.site;
const promoReady = () => onSiteTab() && !!S.promo;
const shortDate = t => new Date(t).toLocaleDateString("en-GB", {day: "numeric", month: "short"});

const PINNED_TAB = Number(new URLSearchParams(location.search).get("tab")) || null; // used by the automated tests

const OWN_WINDOW = new URLSearchParams(location.search).has("window"); // opened as a window (Opera etc.)

async function activeShopTab() {
  if (PINNED_TAB) return chrome.tabs.get(PINNED_TAB).catch(() => null);
  if (OWN_WINDOW) {
    // Our own window isn't where the shopping happens: use the browser window the user was last in.
    const w = await chrome.windows.getLastFocused({windowTypes: ["normal"]}).catch(() => null);
    if (!w) return null;
    const [tab] = await chrome.tabs.query({active: true, windowId: w.id});
    return tab || null;
  }
  const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
  return tab || null;
}

async function refreshTab() {
  const tab = await activeShopTab();
  S.tab = tab || null;
  const detected = tab && tab.url ? C.siteForUrl(tab.url) : null; // url is only visible on sites we have access to
  if (detected && detected !== S.tabSite && !S.busy) { S.site = detected; chrome.storage.local.set({site: detected}); }
  S.tabSite = detected;
  await askPromo();
  renderAll();
}

// Ask the page whether the promo code box is showing. The watcher script answers; tabs opened
// before Snackhack was installed don't have it yet, so inject it once and ask again.
async function askPromo() {
  if (!S.tab || !S.tabSite) { S.promo = null; return; }
  const ask = () => chrome.tabs.sendMessage(S.tab.id, {type: "get-promo-state"});
  try { S.promo = (await ask()).state; }
  catch (e) {
    try {
      await chrome.scripting.executeScript({target: {tabId: S.tab.id},
        files: ["lib/config.js", "lib/extract.js", "content/tester.js", "content/watch.js"]});
      S.promo = (await ask()).state;
    } catch (e2) { S.promo = null; }
  }
}

/* ---------- finding codes ---------- */
function htmlToText(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("style, noscript, svg").forEach(n => n.remove());
  doc.querySelectorAll("script").forEach(n => n.remove());
  doc.querySelectorAll("p, div, li, h1, h2, h3, h4, article, section, br, tr, a, button").forEach(n => n.append("\n"));
  // Plus codes voucher sites hide in reveal buttons and page data, each kept on its own.
  return (doc.body ? doc.body.textContent : "") + "\n\n" + X.hiddenCodes(html);
}

async function fetchText(src, nameRe) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 12000);
  try {
    const r = await fetch(src.url, {credentials: "omit", signal: ctl.signal});
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    if (src.kind === "reddit_json") {
      const posts = ((await r.json()).data || {}).children || [];
      const texts = posts.map(p => `${p.data.title || ""}\n${p.data.selftext || ""}`);
      // Site-wide searches pick up unrelated posts; subreddit searches are already on topic.
      return (src.url.includes("/r/") ? texts : texts.filter(t => nameRe.test(t))).join("\n\n");
    }
    return htmlToText(await r.text());
  } finally { clearTimeout(timer); }
}

async function inParallel(items, limit, fn) {
  const out = new Array(items.length); let next = 0;
  await Promise.all(Array.from({length: Math.min(limit, items.length)}, async () => {
    while (next < items.length) {
      const i = next++;
      if (S.stop) throw new Error("Stopped.");
      try { out[i] = {ok: true, value: await fn(items[i])}; } catch (e) { out[i] = {ok: false, error: e}; }
    }
  }));
  return out;
}

async function findCodes() {
  const s = site(), a = acct();
  const nameRe = new RegExp(s.query.split(/\s+/).join("\\s*"), "i");
  const sources = C.sourceUrls(S.site, a.member);
  let done = 0;
  setBusy(`Checking ${sources.length} sources`);
  const res = await inParallel(sources, 5, async src => {
    const codes = X.findCodes(await fetchText(src, nameRe));
    setBusy(`Checking sources ${++done}/${sources.length}`);
    return codes;
  });
  const results = [], failed = [];
  res.forEach((r, i) => r.ok ? results.push([sources[i].name, r.value]) : failed.push(sources[i].name));
  const ranked = X.mergeCandidates(results).slice(0, 40);
  let fresh = 0;
  for (const c of ranked) {
    const exists = S.codes.some(x => x.site === S.site && x.code === c.code);
    if (!exists) fresh++;
    upsert(S.site, c.code, {sources: c.sources, context: c.context, expired_hint: c.expired_hint,
                            member_only: c.member_only, new_only: c.new_only, ...(exists ? {} : {status: "untested"})});
  }
  S.lastFind[S.site] = Date.now();
  await chrome.storage.local.set({lastFind: S.lastFind});
  await saveCodes();
  const loaded = sources.length - failed.length;
  log(`Checked ${sources.length} sources (${loaded} loaded${failed.length ? `, ${[...new Set(failed)].join(", ")} unavailable` : ""}).`,
      loaded ? "info" : "warn");
  const nm = ranked.filter(c => c.member_only).length;
  log(ranked.length ? `Found ${ranked.length} codes for ${s.name}, ${fresh} new${nm ? `, ${nm} for ${s.member_name}` : ""}.`
                    : `No codes found for ${s.name} right now. You can paste your own.`, ranked.length ? "good" : "info");
}

/* ---------- trying codes in the checkout tab ---------- */
async function inPage(tabId, func, args) {
  await chrome.scripting.executeScript({target: {tabId}, files: ["lib/config.js", "lib/extract.js", "content/tester.js"]});
  const [res] = await chrome.scripting.executeScript({target: {tabId}, func, args});
  return res ? res.result : null;
}
const pageTry = (tabId, code) => inPage(tabId, (c, cfg, wait) => SnackTester.tryCode(c, cfg, {}, wait),
                                        [code, C.defaults, C.testing.result_wait_seconds]);
const pageRemove = (tabId, code) => inPage(tabId, (c, cfg) => SnackTester.removeCode(c, cfg), [code, C.defaults]);

async function pause(seconds) {
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) { if (S.stop) throw new Error("Stopped."); await sleep(200); }
}

function record(code, r) {
  const c = upsert(S.site, code, {status: r.status, message: r.message, saving: r.saving, tested_at: Date.now()});
  c.tries = (c.tries || 0) + 1;
  if (r.status === "works") {
    c.wins = (c.wins || 0) + 1;
    c.best_saving = Math.max(c.best_saving || 0, r.saving || 0) || null;
  }
  return c;
}

async function tryCodes(only) {
  if (!promoReady()) { toast(`Go to your ${site().name} checkout and open the promo code box first.`); return; }
  const tabId = S.tab.id, s = site(), t = C.testing, a = acct();
  // One tap: search first if we haven't recently, so there's always something fresh to try.
  if (!only && (!toTry().length || Date.now() - (S.lastFind[S.site] || 0) > REFIND_AFTER)) await findCodes();
  setBusy("Trying codes");
  let codes = only;
  if (!codes) {
    const pool = siteCodes().filter(due);
    const skip = pool.filter(c => !usable(c));
    if (skip.length) log(`Skipping ${skip.length} code${skip.length === 1 ? "" : "s"} for members or new customers only.`);
    codes = pool.filter(usable)
      .sort((x, y) => ((y.status === "works") - (x.status === "works")) || ((y.best_saving || 0) - (x.best_saving || 0))
                      || (x.expired_hint - y.expired_hint) || ((a.member && y.member_only) - (a.member && x.member_only))
                      || ((y.sources?.length || 0) - (x.sources?.length || 0)))
      .map(c => c.code);
  }
  codes = codes.slice(0, t.max_codes_per_run);
  if (!codes.length) { log("No codes to try yet. Paste one in, or check the app's own offers page."); return; }
  log(`Trying ${codes.length} code${codes.length === 1 ? "" : "s"} on ${s.name}. Leave the page alone while it runs.`);
  const run = {site: S.site, at: Date.now(), results: []};
  const working = []; let applied = null;
  try {
    for (let i = 0; i < codes.length; i++) {
      const code = codes[i];
      if (S.stop) throw new Error("Stopped.");
      S.progress = {code, i: i + 1, n: codes.length}; renderHero(); renderCoupons();
      const r = await pageTry(tabId, code) || {status: "error", message: "The page didn't respond", saving: null};
      record(code, r);
      run.results.push({code, status: r.status, saving: r.saving});
      await saveCodes(); renderAll();
      log(`${code}: ${STATUS[r.status] || r.status}. ${r.message}`, r.status === "works" ? "good" : r.status === "rejected" ? "info" : "warn");
      if (r.status === "error") break;
      if (r.status === "works") {
        working.push([r.saving || 0, code]); applied = code;
        if (await pageRemove(tabId, code)) applied = null;
        else if (i < codes.length - 1) { log("Couldn't remove it to try the rest, so stopping with this code applied.", "warn"); break; }
      }
      if (i < codes.length - 1) await pause(t.min_delay_seconds + Math.random() * (t.max_delay_seconds - t.min_delay_seconds));
    }
  } finally {
    S.progress = null;
    if (working.length) {
      working.sort((x, y) => y[0] - x[0]);
      const [bestSaving, best] = working[0];
      if (applied !== best) {
        if (applied) await pageRemove(tabId, applied);
        await sleep(1500);
        await pageTry(tabId, best);
      }
      run.best = best; run.saving = bestSaving || null;
      log(`Best code: ${best}${bestSaving ? `, saving ${gbp(bestSaving)}` : ""}. It's applied in your basket now.`, "good");
    } else if (run.results.length) {
      log("None of those worked this time. Check the app's own offers page too.");
    }
    if (run.results.length) {
      S.history.push(run); S.history = S.history.slice(-200);
      await chrome.storage.local.set({history: S.history});
    }
  }
}

async function applyCode(code) {
  if (!onSiteTab()) { toast(`Open your ${site().name} checkout in this tab first.`); return; }
  const r = await pageTry(S.tab.id, code) || {status: "error", message: "The page didn't respond", saving: null};
  record(code, r);
  await saveCodes();
  log(`${code}: ${STATUS[r.status]}. ${r.message}`, r.status === "works" ? "good" : "info");
}

/* ---------- jobs ---------- */
function setBusy(label) { S.busy = label; renderSteps(); renderBusy(); }
async function job(label, fn) {
  if (S.busy) return;
  S.stop = false; setBusy(label);
  try { await fn(); }
  catch (e) { e.message === "Stopped." ? log("Stopped.") : log(`Something went wrong: ${e.message}`, "error"); }
  finally { S.busy = null; S.progress = null; renderAll(); }
}

/* ---------- rendering ---------- */
function renderTabs() {
  $("tabs").innerHTML = Object.entries(C.sites).map(([k, s]) =>
    `<button class="tab" role="tab" data-k="${k}" aria-selected="${k === S.site}"><span class="dot d-${k}"></span>${esc(s.name)}</button>`).join("");
  $("tabs").querySelectorAll(".tab").forEach(b => b.onclick = () => {
    if (S.busy) return;
    S.site = b.dataset.k; chrome.storage.local.set({site: S.site}); renderAll();
  });
  document.querySelectorAll(".site-name").forEach(n => n.textContent = site().name);
}

function renderWhere() {
  const w = $("where"), s = site();
  const states = {
    box: ["on", "✓", "Promo code box found", "Hit Try codes and Snackhack does the rest."],
    opener: ["on", "✓", `You're at the ${s.name} checkout`, "Snackhack will open the promo code box for you."],
  };
  if (onSiteTab()) {
    const [cls, icon, title, text] = states[S.promo] ||
      ["wait", "🛒", `You're on ${s.name}`, "Go to checkout and open the promo code box. Try codes unlocks when Snackhack sees it."];
    w.className = `card where ${cls}`;
    w.innerHTML = `<div class="w-icon">${icon}</div><div class="w-text"><b>${esc(title)}</b><span>${esc(text)}</span></div>`;
  } else {
    w.className = "card where";
    w.innerHTML = `<div class="w-icon">🛵</div><div class="w-text"><b>Open ${esc(s.name)} to try codes</b>
      <span>You can find codes from anywhere.</span></div><button class="btn sm soft" id="btnOpen">Open</button>`;
    $("btnOpen").onclick = () => chrome.tabs.create({url: s.start_url});
  }
}

function renderSteps() {
  const busy = !!S.busy, finding = busy && /sources|Finding/.test(S.busy);
  $("btnFind").disabled = busy;
  $("btnTest").disabled = busy || !promoReady();
  $("btnStop").hidden = !busy;
  const n = toTry().length;
  $("btnTest").textContent = busy && !finding ? "Trying codes…"
    : n ? `Try ${Math.min(n, C.testing.max_codes_per_run)} code${n === 1 ? "" : "s"}` : "Find & try codes";
  $("btnFind").textContent = finding ? "Searching…" : "Find codes";
  $("btnTest").title = promoReady() ? "" : "Unlocks when you're on the promo code step at checkout";
}

function renderStats() {
  const runs = S.history.filter(r => r.site === S.site);
  const all = S.history;
  const saved = runs.reduce((sum, r) => sum + (r.saving || 0), 0), savedAll = all.reduce((sum, r) => sum + (r.saving || 0), 0);
  const tried = runs.reduce((n, r) => n + r.results.length, 0), worked = runs.reduce((n, r) => n + r.results.filter(x => x.status === "works").length, 0);
  $("stats").hidden = !runs.length && !all.length;
  $("stats").innerHTML = `
    <div class="stat"><b>${gbp(saved)}</b><span>saved on ${esc(site().name)}</span></div>
    <div class="stat"><b>${runs.length}</b><span>order${runs.length === 1 ? "" : "s"} checked</span></div>
    <div class="stat"><b>${worked}/${tried}</b><span>codes worked</span></div>
    ${all.length !== runs.length ? `<div class="stat-all">${gbp(savedAll)} saved across all apps</div>` : ""}`;
}

function renderAccount() {
  const s = site(), a = acct();
  $("memberName").textContent = s.member_name;
  $("accMember").checked = !!a.member;
  $("accNew").checked = !!a.new;
  const skipped = [!a.member && `${s.member_name}-only`, !a.new && "new-customer"].filter(Boolean);
  $("accHint").textContent = [a.member ? `We'll also hunt for ${s.member_name} deals and try them first.` : "",
    skipped.length ? `We'll skip ${skipped.join(" and ")} codes so they don't waste your tries.` : ""].filter(Boolean).join(" ");
}

function renderHero() {
  const h = $("hero"), p = S.progress;
  const working = siteCodes().filter(c => c.status === "works").sort((x, y) => (y.saving || 0) - (x.saving || 0));
  h.className = "card hero";
  if (p) {
    h.innerHTML = `<div class="progress"><div class="progress-label"><span>Trying <code>${esc(p.code)}</code></span><span>${p.i} of ${p.n}</span></div>
      <div class="progress-track"><div class="progress-bar" style="width:${(p.i - 1) / p.n * 100}%"></div></div>
      <div class="small">Leave the ${esc(site().name)} page alone until this finishes.</div></div>`;
    return;
  }
  if (working.length) {
    const best = working[0];
    h.classList.add("win");
    h.innerHTML = `<div class="hero-main"><span class="hero-kicker">Best code${working.length > 1 ? ` of ${working.length}` : ""}</span>
        <span class="hero-big">${best.saving ? `<span class="sun">${gbp(best.saving)}</span> off` : "It works"}</span>
        <span class="hero-sub"><code>${esc(best.code)}</code></span></div>
      <button class="btn sm on-brand" id="applyBest" ${S.busy || !promoReady() ? "disabled" : ""}>Apply</button>`;
    $("applyBest").onclick = () => job("Applying code", () => applyCode(best.code));
    return;
  }
  const n = toTry().length;
  const [icon, title, text] = siteCodes().length
    ? (n ? ["🎟️", `${n} code${n === 1 ? "" : "s"} ready to try`, "At the promo code step? Hit Try codes."]
         : ["🔍", "Nothing worked yet", "Hit Find & try codes for a fresh search, or check the app's offers page."])
    : ["🍟", "No codes yet", `Get to the promo code step and hit Find & try codes, or Find codes to look now.`];
  h.innerHTML = `<div class="hero-idle"><div class="hero-icon" aria-hidden="true">${icon}</div><div><h2>${esc(title)}</h2><p>${esc(text)}</p></div></div>`;
}

function renderCoupons() {
  const all = siteCodes();
  const counts = {all: all.length, works: all.filter(c => c.status === "works").length,
    todo: all.filter(c => c.status === "untested" || c.status === "unknown").length,
    rejected: all.filter(c => c.status === "rejected" || c.status === "error").length};
  $("filters").innerHTML = FILTERS.map(([k, l]) =>
    `<button class="filter" role="tab" data-k="${k}" aria-selected="${S.filter === k}">${l}<span class="n">${counts[k]}</span></button>`).join("");
  $("filters").querySelectorAll(".filter").forEach(b => b.onclick = () => { S.filter = b.dataset.k; renderCoupons(); });

  let list = all;
  if (S.filter === "works") list = all.filter(c => c.status === "works");
  if (S.filter === "todo") list = all.filter(c => c.status === "untested" || c.status === "unknown");
  if (S.filter === "rejected") list = all.filter(c => c.status === "rejected" || c.status === "error");
  list = [...list].sort((x, y) => (ORDER[x.status] - ORDER[y.status]) || ((y.saving || 0) - (x.saving || 0))
                                  || (usable(y) - usable(x)) || ((y.sources?.length || 0) - (x.sources?.length || 0)));
  const busy = !!S.busy, testing = S.progress ? S.progress.code : null, canTry = promoReady() && !busy;
  $("empty").hidden = list.length > 0;
  $("empty").innerHTML = all.length ? "<b>Nothing in this list</b><span>Pick another filter.</span>"
                                    : "<b>Your codes show up here</b><span>Found codes, and ones you paste in, appear as cards.</span>";
  $("coupons").innerHTML = list.map(c => {
    const st = c.code === testing ? "testing" : c.status;
    const tags = [`<span class="chip ${st}">${st === "testing" ? "Trying now…" : STATUS[c.status] || c.status}</span>`];
    if (c.member_only) tags.push(`<span class="chip member">${esc(C.sites[c.site].member_name)} only</span>`);
    if (c.new_only) tags.push(`<span class="chip newcust">New customers</span>`);
    if (!usable(c) && c.status !== "works") tags.push(`<span class="chip skip">Skipped for you</span>`);
    return `<article class="coupon is-${st}">
      <div class="c-main"><div class="c-code">${esc(c.code)}</div><div class="tags">${tags.join("")}</div>
        ${c.message ? `<div class="c-msg">${esc(c.message)}</div>` : ""}
        ${c.tested_at ? `<div class="c-src">Tried ${c.tries || 1}× · last ${shortDate(c.tested_at)}${c.wins ? ` · worked ${c.wins}×` : ""}</div>` : ""}
        ${c.sources?.length ? `<div class="c-src">From ${esc(c.sources.slice(0, 4).join(", "))}${c.sources.length > 4 ? ` +${c.sources.length - 4}` : ""}</div>` : ""}</div>
      <div class="c-side"><div class="c-saving ${c.best_saving || c.saving ? "" : "none"}">${c.best_saving || c.saving ? gbp(c.best_saving || c.saving) : "–"}</div>
        <div class="c-actions">
          ${c.status === "works" ? `<button class="btn sm primary" data-act="apply" data-code="${esc(c.code)}" ${canTry ? "" : "disabled"}>Apply</button>`
                                 : `<button class="btn sm" data-act="try" data-code="${esc(c.code)}" ${canTry ? "" : "disabled"}>Try</button>`}
          <button class="btn sm icon" data-act="del" data-code="${esc(c.code)}" aria-label="Remove ${esc(c.code)}" title="Remove">✕</button>
        </div></div>
    </article>`;
  }).join("");
  $("coupons").querySelectorAll("button").forEach(b => b.onclick = async () => {
    const code = b.dataset.code;
    if (b.dataset.act === "try") job("Trying codes", () => tryCodes([code]));
    if (b.dataset.act === "apply") job("Applying code", () => applyCode(code));
    if (b.dataset.act === "del") { S.codes = S.codes.filter(c => !(c.site === S.site && c.code === code)); await saveCodes(); renderAll(); }
  });
}

function renderLog() {
  $("log").innerHTML = S.log.map(e => `<li><time>${new Date(e.t).toLocaleTimeString("en-GB", {hour: "2-digit", minute: "2-digit"})}</time><span class="${e.level}">${esc(e.msg)}</span></li>`).join("");
  const last = S.log[S.log.length - 1];
  $("lastLog").textContent = S.busy ? S.busy + "…" : last ? last.msg : "Ready when you are";
}
function renderBusy() { $("busyDot").className = "pulse" + (S.busy ? " busy" : ""); renderLog(); }

function renderAll() { renderTabs(); renderWhere(); renderSteps(); renderAccount(); renderHero(); renderStats(); renderCoupons(); renderBusy(); }

/* ---------- events ---------- */
$("btnFind").onclick = () => job("Finding codes", findCodes);
$("btnTest").onclick = () => job("Trying codes", () => tryCodes());
$("btnStop").onclick = () => { S.stop = true; toast("Stopping after this step…"); };
$("accMember").onchange = e => { S.accounts[S.site] = {...acct(), member: e.target.checked}; saveAccounts(); renderAll(); };
$("accNew").onchange = e => { S.accounts[S.site] = {...acct(), new: e.target.checked}; saveAccounts(); renderAll(); };
$("addForm").onsubmit = async e => {
  e.preventDefault();
  const code = $("addCode").value.trim().toUpperCase();
  if (!/^[A-Z0-9_-]{3,24}$/.test(code)) { toast("That doesn't look like a code. Letters and numbers only."); return; }
  upsert(S.site, code, {sources: ["Added by you"]});
  await saveCodes(); $("addCode").value = ""; toast(`Added ${code}`); renderAll();
};
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg && msg.type === "promo-state" && sender.tab && S.tab && sender.tab.id === S.tab.id) {
    S.promo = msg.state; if (!S.busy) renderAll();
  }
});
setInterval(async () => { if (!S.busy && S.tabSite) { const before = S.promo; await askPromo(); if (S.promo !== before) renderAll(); } }, 4000);
chrome.tabs.onActivated.addListener(refreshTab);
if (OWN_WINDOW) chrome.windows.onFocusChanged.addListener(() => { if (!S.busy) refreshTab(); });
chrome.tabs.onUpdated.addListener((id, info) => { if (info.url || info.status === "complete") refreshTab(); });
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || S.busy) return;
  if (changes.codes) S.codes = changes.codes.newValue || [];
  if (changes.accounts) S.accounts = changes.accounts.newValue || {};
  if (changes.history) S.history = changes.history.newValue || [];
  renderAll();
});

(async () => { await load(); renderAll(); await refreshTab(); })();
