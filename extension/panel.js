// Snackhack side panel: finds codes on deal sites and tries them in the current checkout tab.
const C = SnackConfig, X = SnackExtract;
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const gbp = n => "£" + Number(n).toFixed(2);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const STATUS = {works:"Works", rejected:"Didn't work", unknown:"Unclear", error:"Couldn't try", untested:"Not tried yet"};
const ORDER = {works:0, untested:1, unknown:2, error:3, rejected:4};
const FILTERS = [["all","All"],["works","Working"],["todo","To try"],["rejected","Didn't work"]];

const S = {site: "deliveroo", tab: null, tabSite: null, codes: [], accounts: {}, log: [],
           busy: null, progress: null, filter: "all", stop: false};

/* ---------- storage ---------- */
async function load() {
  const d = await chrome.storage.local.get(["codes", "accounts", "log", "site"]);
  S.codes = d.codes || []; S.accounts = d.accounts || {}; S.log = d.log || [];
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
const toTry = () => siteCodes().filter(c => (c.status === "untested" || c.status === "unknown") && usable(c));
const onSiteTab = () => S.tab && S.tabSite === S.site;

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
  renderAll();
}

/* ---------- finding codes ---------- */
function htmlToText(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script, style, noscript, svg").forEach(n => n.remove());
  doc.querySelectorAll("p, div, li, h1, h2, h3, h4, article, section, br, tr, a").forEach(n => n.append("\n"));
  const embedded = html.match(/"(?:voucherCode|voucher_code|couponCode|promoCode)"\s*:\s*"[A-Z0-9_-]{4,20}"/g) || [];
  return (doc.body ? doc.body.textContent : "") + "\n" + embedded.join("\n");
}

async function fetchSource(src, query, nameRe) {
  const url = src.url.replace("{q}", encodeURIComponent(query));
  const r = await fetch(url, {credentials: "omit"});
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  if (src.kind === "reddit_json") {
    const posts = ((await r.json()).data || {}).children || [];
    return posts.map(p => `${p.data.title || ""}\n${p.data.selftext || ""}`).filter(t => nameRe.test(t)).join("\n\n");
  }
  return htmlToText(await r.text());
}

async function findCodes() {
  const s = site(), a = acct(), extra = $("query").value.trim();
  const nameRe = new RegExp(s.query.split(/\s+/).join("\\s*"), "i");
  const queries = [[[s.query, extra].filter(Boolean).join(" "), ""]];
  if (a.member) queries.push([[s.member_query, extra].filter(Boolean).join(" "), ` (${s.member_name})`]);
  const results = [];
  for (const [query, label] of queries) {
    for (const src of C.sources) {
      if (S.stop) throw new Error("Stopped.");
      setBusy(`Searching ${src.name}${label}`);
      try {
        const codes = X.findCodes(await fetchSource(src, query, nameRe));
        const n = Object.keys(codes).length;
        log(`${src.name}${label}: ${n} possible code${n === 1 ? "" : "s"}.`);
        results.push([src.name, codes]);
      } catch (e) {
        log(`${src.name}${label} didn't load (${e.message}). Skipping.`, "warn");
      }
    }
  }
  const ranked = X.mergeCandidates(results).slice(0, 30);
  for (const c of ranked) {
    const exists = S.codes.some(x => x.site === S.site && x.code === c.code);
    upsert(S.site, c.code, {sources: c.sources, context: c.context, expired_hint: c.expired_hint,
                            member_only: c.member_only, new_only: c.new_only, ...(exists ? {} : {status: "untested"})});
  }
  await saveCodes();
  const nm = ranked.filter(c => c.member_only).length;
  log(ranked.length ? `Found ${ranked.length} codes for ${s.name}${nm ? ` (${nm} for ${s.member_name})` : ""}.`
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

async function tryCodes(only) {
  if (!onSiteTab()) { toast(`Open your ${site().name} checkout in this tab first.`); return; }
  const tabId = S.tab.id, s = site(), t = C.testing, a = acct();
  let codes = only;
  if (!codes) {
    const pool = siteCodes().filter(c => c.status === "untested" || c.status === "unknown");
    const skip = pool.filter(c => !usable(c));
    if (skip.length) log(`Skipping ${skip.length} code${skip.length === 1 ? "" : "s"} for members or new customers only.`);
    codes = pool.filter(usable)
      .sort((x, y) => (x.expired_hint - y.expired_hint) || ((a.member && y.member_only) - (a.member && x.member_only))
                      || ((y.sources?.length || 0) - (x.sources?.length || 0)))
      .map(c => c.code);
  }
  codes = codes.slice(0, t.max_codes_per_run);
  if (!codes.length) { toast("Nothing to try. Find codes or paste one first."); return; }
  log(`Trying ${codes.length} code${codes.length === 1 ? "" : "s"} on ${s.name}. Leave the page alone while it runs.`);
  const working = []; let applied = null;
  for (let i = 0; i < codes.length; i++) {
    const code = codes[i];
    if (S.stop) throw new Error("Stopped.");
    S.progress = {code, i: i + 1, n: codes.length}; renderHero(); renderCoupons();
    const r = await pageTry(tabId, code) || {status: "error", message: "The page didn't respond", saving: null};
    upsert(S.site, code, {status: r.status, message: r.message, saving: r.saving, tested_at: Date.now()});
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
  S.progress = null;
  if (working.length) {
    working.sort((x, y) => y[0] - x[0]);
    const best = working[0][1];
    if (applied !== best) {
      if (applied) await pageRemove(tabId, applied);
      await sleep(1500);
      await pageTry(tabId, best);
    }
    log(`Best code: ${best}. It's applied in your basket now.`, "good");
  } else {
    log("None of those worked. Try a restaurant search, or check the app's own offers page.");
  }
}

async function applyCode(code) {
  if (!onSiteTab()) { toast(`Open your ${site().name} checkout in this tab first.`); return; }
  const r = await pageTry(S.tab.id, code);
  upsert(S.site, code, {status: r.status, message: r.message, saving: r.saving, tested_at: Date.now()});
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
  w.className = "card where" + (onSiteTab() ? " on" : "");
  if (onSiteTab()) {
    w.innerHTML = `<div class="w-icon">✓</div><div class="w-text"><b>You're on ${esc(s.name)}</b>
      <span>Fill your basket and go to checkout, then hit Try codes.</span></div>`;
  } else {
    w.innerHTML = `<div class="w-icon">🛵</div><div class="w-text"><b>Open ${esc(s.name)} to try codes</b>
      <span>You can find codes from anywhere.</span></div><button class="btn sm soft" id="btnOpen">Open</button>`;
    $("btnOpen").onclick = () => chrome.tabs.create({url: s.start_url});
  }
}

function renderSteps() {
  const busy = !!S.busy;
  $("btnFind").disabled = busy;
  $("btnTest").disabled = busy || !onSiteTab();
  $("btnStop").hidden = !busy;
  const n = toTry().length;
  $("btnTest").textContent = busy && S.busy !== "Finding codes" && !S.busy.startsWith("Searching") ? "Trying codes…"
    : n ? `Try ${Math.min(n, C.testing.max_codes_per_run)} code${n === 1 ? "" : "s"}` : "Try codes";
  $("btnFind").textContent = busy && (S.busy === "Finding codes" || S.busy.startsWith("Searching")) ? "Searching…" : "Find codes";
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
      <button class="btn sm on-brand" id="applyBest" ${S.busy || !onSiteTab() ? "disabled" : ""}>Apply</button>`;
    $("applyBest").onclick = () => job("Applying code", () => applyCode(best.code));
    return;
  }
  const n = toTry().length;
  const [icon, title, text] = siteCodes().length
    ? (n ? ["🎟️", `${n} code${n === 1 ? "" : "s"} ready to try`, "At checkout? Hit Try codes."]
         : ["🔍", "Nothing worked yet", "Try a restaurant search, or check the app's offers page."])
    : ["🍟", "No codes yet", `Hit Find codes and we'll search the deal sites for ${site().name}.`];
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
  const busy = !!S.busy, testing = S.progress ? S.progress.code : null, canTry = onSiteTab() && !busy;
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
        ${c.sources?.length ? `<div class="c-src">From ${esc(c.sources.join(", "))}</div>` : ""}</div>
      <div class="c-side"><div class="c-saving ${c.saving ? "" : "none"}">${c.saving ? gbp(c.saving) : "–"}</div>
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

function renderAll() { renderTabs(); renderWhere(); renderSteps(); renderAccount(); renderHero(); renderCoupons(); renderBusy(); }

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
chrome.tabs.onActivated.addListener(refreshTab);
if (OWN_WINDOW) chrome.windows.onFocusChanged.addListener(() => { if (!S.busy) refreshTab(); });
chrome.tabs.onUpdated.addListener((id, info) => { if (info.url || info.status === "complete") refreshTab(); });
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || S.busy) return;
  if (changes.codes) S.codes = changes.codes.newValue || [];
  if (changes.accounts) S.accounts = changes.accounts.newValue || {};
  renderAll();
});

(async () => { await load(); renderAll(); await refreshTab(); })();
