const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const gbp = n => "£" + Number(n).toFixed(2);
const STATUS = {works:"Works", rejected:"Didn't work", unknown:"Unclear", error:"Couldn't try", untested:"Not tried yet"};
const ORDER = {works:0, untested:1, unknown:2, error:3, rejected:4};
const FILTERS = [["all","All"],["works","Working"],["todo","To try"],["rejected","Didn't work"]];

let S = {sites:{}, codes:[], accounts:{}, status:{busy:null, browser:false}, site:null, progress:null,
         filter:"all", lastLog:null, opened:{}};
try { S.site = localStorage.getItem("sh.site"); } catch (e) {}

async function api(path, body, method = "POST") {
  let r, j = {};
  try {
    r = await fetch(path, {method, headers:{"Content-Type":"application/json"}, body: body ? JSON.stringify(body) : undefined});
    j = await r.json().catch(() => ({}));
  } catch (e) { toast("Lost connection to Snackhack. Is it still running?"); return {}; }
  if (!r.ok || j.ok === false) toast(j.error || `Something went wrong (${r.status})`);
  return j;
}

let toastTimer;
function toast(msg) {
  const t = $("toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.hidden = true, 3500);
}

const site = () => S.sites[S.site] || {};
const acct = () => S.accounts[S.site] || {};
const siteCodes = () => S.codes.filter(c => c.site === S.site);
function usable(c) {
  const a = S.accounts[c.site] || {};
  return !((c.member_only && !a.member) || (c.new_only && !a.new));
}
const toTry = () => siteCodes().filter(c => (c.status === "untested" || c.status === "unknown") && usable(c));

/* ---------- header ---------- */
function renderTabs() {
  $("tabs").innerHTML = Object.entries(S.sites).map(([k, s]) =>
    `<button class="tab" role="tab" data-k="${k}" aria-selected="${k === S.site}"><span class="dot d-${k}"></span>${esc(s.name)}</button>`).join("");
  $("tabs").querySelectorAll(".tab").forEach(b => b.onclick = () => {
    S.site = b.dataset.k; try { localStorage.setItem("sh.site", S.site); } catch (e) {}
    renderAll();
  });
  document.querySelectorAll(".site-name").forEach(n => n.textContent = site().name || "");
  $("appChip").innerHTML = `<span class="dot d-${S.site}"></span>${esc(site().name || "")}`;
}

/* ---------- guide ---------- */
function renderSteps() {
  const busy = !!S.status.busy;
  const opened = S.status.browser && S.opened[S.site];
  const hasCodes = siteCodes().length > 0;
  const current = !opened ? 1 : !hasCodes ? 2 : 3;
  [1, 2, 3].forEach(n => {
    const el = $("step" + n);
    el.classList.toggle("current", n === current);
    el.classList.toggle("done", n < current);
  });
  ["btnOpen", "btnFind", "btnTest"].forEach(id => $(id).disabled = busy);
  $("btnStop").hidden = !busy;
  const n = toTry().length;
  $("btnTest").textContent = n ? `Try ${Math.min(n, S.maxCodes || 15)} code${n === 1 ? "" : "s"}` : "Try codes";
  $("guideTitle").textContent = busy ? (S.status.busy + "…")
    : current === 1 ? "Let's find you a code" : current === 2 ? "Now let's hunt for codes" : "Ready to try them";
}

function renderAccount() {
  const s = site(), a = acct();
  $("memberName").textContent = s.member_name || "a membership";
  $("accMember").checked = !!a.member;
  $("accNew").checked = !!a.new;
  const skipped = [!a.member && `${s.member_name}-only`, !a.new && "new-customer"].filter(Boolean);
  $("accHint").textContent = [
    a.member ? `We'll also hunt for ${s.member_name} deals and try them first.` : "",
    skipped.length ? `We'll skip ${skipped.join(" and ")} codes so they don't waste your tries.` : "",
  ].filter(Boolean).join(" ");
}

/* ---------- hero ---------- */
function renderHero() {
  const h = $("hero"), p = S.progress && S.progress.site === S.site ? S.progress : null;
  const working = siteCodes().filter(c => c.status === "works").sort((a, b) => (b.saving || 0) - (a.saving || 0));
  h.className = "card hero";
  if (p) {
    h.innerHTML = `<div class="progress">
      <div class="progress-label"><span>Trying <code>${esc(p.code)}</code></span><span>${p.i} of ${p.n}</span></div>
      <div class="progress-track"><div class="progress-bar" style="width:${(p.i - 1) / p.n * 100}%"></div></div>
      <div class="hint">Leave the ${esc(site().name)} window alone until this finishes.</div></div>`;
    return;
  }
  if (working.length) {
    const best = working[0];
    h.classList.add("win");
    h.innerHTML = `<div class="hero-main">
        <span class="hero-kicker">Best code${working.length > 1 ? ` of ${working.length} that work` : ""}</span>
        <span class="hero-big">${best.saving ? `<span class="sun">${gbp(best.saving)}</span> off` : "It works"}</span>
        <span class="hero-sub"><code>${esc(best.code)}</code> ${best.saving ? "on this basket" : esc(best.message || "")}</span>
      </div>
      <button class="btn on-brand" data-apply="${esc(best.code)}" ${S.status.busy ? "disabled" : ""}>Apply it</button>`;
    h.querySelector("[data-apply]").onclick = e => api("/api/apply", {site: S.site, code: e.currentTarget.dataset.apply});
    return;
  }
  const n = toTry().length;
  const [icon, title, text] = siteCodes().length
    ? (n ? ["🎟️", `${n} code${n === 1 ? "" : "s"} ready to try`, "Get your basket to checkout, then hit Try codes."]
         : ["🔍", "Nothing worked this time", "Try a restaurant search, or check the app's own offers page."])
    : ["🛵", "No codes yet", `Hit Find codes and we'll search the usual deal sites for ${site().name || "you"}.`];
  h.innerHTML = `<div class="hero-idle"><div class="hero-icon" aria-hidden="true">${icon}</div>
    <div><h2>${esc(title)}</h2><p>${esc(text)}</p></div></div>`;
}

/* ---------- coupons ---------- */
function renderFilters(list) {
  const counts = {all: list.length, works: list.filter(c => c.status === "works").length,
    todo: list.filter(c => c.status === "untested" || c.status === "unknown").length,
    rejected: list.filter(c => c.status === "rejected" || c.status === "error").length};
  $("filters").innerHTML = FILTERS.map(([k, l]) =>
    `<button class="filter" role="tab" data-k="${k}" aria-selected="${S.filter === k}">${l}<span class="n">${counts[k]}</span></button>`).join("");
  $("filters").querySelectorAll(".filter").forEach(b => b.onclick = () => { S.filter = b.dataset.k; renderCoupons(); });
}

function renderCoupons() {
  const all = siteCodes();
  renderFilters(all);
  let list = all;
  if (S.filter === "works") list = all.filter(c => c.status === "works");
  if (S.filter === "todo") list = all.filter(c => c.status === "untested" || c.status === "unknown");
  if (S.filter === "rejected") list = all.filter(c => c.status === "rejected" || c.status === "error");
  list.sort((a, b) => (ORDER[a.status] - ORDER[b.status]) || ((b.saving || 0) - (a.saving || 0))
                      || (usable(b) - usable(a)) || ((b.sources?.length || 0) - (a.sources?.length || 0)));
  const busy = !!S.status.busy;
  const testing = S.progress && S.progress.site === S.site ? S.progress.code : null;
  $("empty").hidden = list.length > 0;
  $("empty").innerHTML = all.length ? "<b>Nothing in this list</b><span>Pick another filter above.</span>"
                                    : "<b>Your codes will show up here</b><span>Found codes, and ones you paste in, appear as cards you can try or apply.</span>";
  $("coupons").innerHTML = list.map(c => {
    const st = c.code === testing ? "testing" : c.status;
    const tags = [];
    tags.push(`<span class="chip ${st}">${st === "testing" ? "Trying now…" : STATUS[c.status] || c.status}</span>`);
    if (c.member_only) tags.push(`<span class="chip member">${esc(S.sites[c.site]?.member_name || "Members")} only</span>`);
    if (c.new_only) tags.push(`<span class="chip newcust">New customers</span>`);
    if (!usable(c) && c.status !== "works") tags.push(`<span class="chip skip">Skipped for you</span>`);
    return `<article class="coupon is-${st}">
      <div class="c-main">
        <div class="c-code">${esc(c.code)}</div>
        <div class="tags">${tags.join("")}</div>
        ${c.message ? `<div class="c-msg">${esc(c.message)}</div>` : ""}
        ${c.sources?.length ? `<div class="c-src">From ${esc(c.sources.join(", "))}</div>` : ""}
      </div>
      <div class="c-side">
        <div class="c-saving ${c.saving ? "" : "none"}">${c.saving ? gbp(c.saving) : "–"}</div>
        <div class="c-actions">
          ${c.status === "works"
            ? `<button class="btn sm primary" data-act="apply" data-code="${esc(c.code)}" ${busy ? "disabled" : ""}>Apply</button>`
            : `<button class="btn sm" data-act="test" data-code="${esc(c.code)}" ${busy ? "disabled" : ""}>Try</button>`}
          <button class="btn sm icon" data-act="del" data-code="${esc(c.code)}" aria-label="Remove ${esc(c.code)}" title="Remove">✕</button>
        </div>
      </div>
    </article>`;
  }).join("");
  $("coupons").querySelectorAll("button").forEach(b => b.onclick = () => {
    const code = b.dataset.code;
    if (b.dataset.act === "test") api("/api/test", {site: S.site, codes: [code]});
    if (b.dataset.act === "apply") api("/api/apply", {site: S.site, code});
    if (b.dataset.act === "del") api("/api/codes", {site: S.site, code}, "DELETE");
  });
}

/* ---------- activity ---------- */
function addLog(e) {
  const li = document.createElement("li");
  li.innerHTML = `<time>${new Date(e.t * 1000).toLocaleTimeString("en-GB", {hour: "2-digit", minute: "2-digit"})}</time><span class="${e.level}">${esc(e.msg)}</span>`;
  $("log").appendChild(li);
  while ($("log").children.length > 300) $("log").firstChild.remove();
  $("lastLog").textContent = e.msg;
  if (e.level === "error") { toast(e.msg); $("activity").open = true; }
}
function renderBusy() { $("busyDot").className = "pulse" + (S.status.busy ? " busy" : ""); }

function renderAll() { renderTabs(); renderSteps(); renderAccount(); renderHero(); renderCoupons(); renderBusy(); }

/* ---------- actions ---------- */
$("btnOpen").onclick = async () => { const j = await api("/api/open", {site: S.site}); if (j.ok) S.opened[S.site] = true; };
$("btnFind").onclick = () => api("/api/find", {site: S.site, query: $("query").value});
$("btnTest").onclick = () => api("/api/test", {site: S.site});
$("btnStop").onclick = () => api("/api/stop", {});
$("accMember").onchange = e => saveAccount("member", e.target.checked);
$("accNew").onchange = e => saveAccount("new", e.target.checked);
$("addForm").onsubmit = async e => {
  e.preventDefault();
  const code = $("addCode").value.trim();
  if (!code) { toast("Paste a code first."); return; }
  const j = await api("/api/codes", {site: S.site, code});
  if (j.ok) { $("addCode").value = ""; toast(`Added ${code.toUpperCase()}`); }
};
async function saveAccount(field, value) {
  const j = await api("/api/account", {site: S.site, [field]: value});
  if (j.ok) { S.accounts[S.site] = j.account; renderAll(); }
}

(async function boot() {
  const st = await (await fetch("/api/state")).json();
  Object.assign(S, {sites: st.sites, codes: st.codes, accounts: st.accounts || {}, status: st.status, maxCodes: st.max_codes});
  if (!S.sites[S.site]) S.site = Object.keys(S.sites)[0];
  $("cfgPath").textContent = st.config_path;
  st.log.forEach(addLog);
  renderAll();
  const es = new EventSource("/api/events");
  es.onmessage = ev => {
    const {kind, data} = JSON.parse(ev.data);
    if (kind === "log") addLog(data);
    if (kind === "codes") { S.codes = data; renderAll(); }
    if (kind === "status") {
      if (data.browser && S.status.busy === "Opening site") S.opened[S.site] = true;
      if (!data.browser) S.opened = {};
      S.status = data; if (!data.busy) S.progress = null; renderAll();
    }
    if (kind === "progress") { S.progress = data; renderHero(); renderCoupons(); }
  };
})();
