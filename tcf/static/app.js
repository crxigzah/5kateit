const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const STATUS = {works:"Works", rejected:"Rejected", unknown:"Unclear", error:"Couldn't test", untested:"Not tested"};
const ORDER = {works:0, untested:1, unknown:2, error:3, rejected:4};

let S = {sites:{}, codes:[], status:{busy:null, browser:false}, site:null, progress:null};
try { S.site = localStorage.getItem("tcf.site"); } catch (e) {}

async function api(path, body, method = "POST") {
  const r = await fetch(path, {method, headers:{"Content-Type":"application/json"}, body: body ? JSON.stringify(body) : undefined});
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) addLog({msg: j.error || `Request failed (${r.status})`, level:"error", t: Date.now()/1000});
  return j;
}

function renderTabs() {
  $("tabs").innerHTML = Object.entries(S.sites).map(([k, s]) =>
    `<button class="tab" role="tab" data-k="${k}" aria-selected="${k === S.site}"><span class="dot d-${k}"></span>${esc(s.name)}</button>`).join("");
  $("tabs").querySelectorAll(".tab").forEach(b => b.onclick = () => {
    S.site = b.dataset.k; try { localStorage.setItem("tcf.site", S.site); } catch (e) {}
    renderAll();
  });
  document.querySelectorAll(".site-name").forEach(n => n.textContent = S.sites[S.site]?.name || "");
}

function renderCodes() {
  const list = S.codes.filter(c => c.site === S.site)
    .sort((a, b) => (ORDER[a.status] - ORDER[b.status]) || ((b.saving || 0) - (a.saving || 0)) || ((b.sources?.length || 0) - (a.sources?.length || 0)));
  $("empty").hidden = list.length > 0;
  const busy = !!S.status.busy;
  const testing = S.progress && S.progress.site === S.site ? S.progress.code : null;
  $("rows").innerHTML = list.map(c => `
    <tr class="${c.code === testing ? "testing" : ""}">
      <td><span class="code">${esc(c.code)}</span>${c.expired_hint ? `<div class="msg">Posted as possibly expired</div>` : ""}</td>
      <td><span class="pill ${c.code === testing ? "busy" : c.status}">${c.code === testing ? "Testing…" : STATUS[c.status] || c.status}</span>
          ${c.message ? `<div class="msg">${esc(c.message)}</div>` : ""}</td>
      <td>${c.saving ? `£${Number(c.saving).toFixed(2)}` : "–"}</td>
      <td class="src">${esc((c.sources || []).join(", "))}</td>
      <td><div class="actions">
        <button class="btn small" data-act="test" data-code="${esc(c.code)}" ${busy ? "disabled" : ""}>Test</button>
        ${c.status === "works" ? `<button class="btn small primary" data-act="apply" data-code="${esc(c.code)}" ${busy ? "disabled" : ""}>Apply</button>` : ""}
        <button class="btn small danger" data-act="del" data-code="${esc(c.code)}" aria-label="Delete ${esc(c.code)}">✕</button>
      </div></td>
    </tr>`).join("");
  $("rows").querySelectorAll("button").forEach(b => b.onclick = () => {
    const code = b.dataset.code;
    if (b.dataset.act === "test") api("/api/test", {site: S.site, codes: [code]});
    if (b.dataset.act === "apply") api("/api/apply", {site: S.site, code});
    if (b.dataset.act === "del") api("/api/codes", {site: S.site, code}, "DELETE");
  });
  const n = k => list.filter(c => c.status === k).length;
  $("summary").innerHTML = [["works", "working"], ["untested", "to test"], ["rejected", "rejected"]]
    .filter(([k]) => n(k)).map(([k, l]) => `<span class="pill ${k}">${n(k)} ${l}</span>`).join("");
  const toTest = n("untested") + n("unknown");
  $("btnTest").textContent = toTest ? `Test ${Math.min(toTest, S.maxCodes || 15)} code${toTest === 1 ? "" : "s"}` : "Test codes";
}

function renderStatus() {
  const busy = S.status.busy;
  ["btnOpen", "btnFind", "btnTest"].forEach(id => $(id).disabled = !!busy);
  $("btnStop").hidden = !busy;
  $("busy").textContent = busy ? busy + "…" : (S.status.browser ? "Browser open" : "Ready");
  $("busy").className = "pill" + (busy ? " busy" : "");
  const p = S.progress;
  $("progress").hidden = !p;
  if (p) {
    $("bar").style.width = `${(p.i - 1) / p.n * 100}%`;
    $("progressText").textContent = `Trying ${p.code} (${p.i} of ${p.n})`;
  }
}

function addLog(e) {
  const li = document.createElement("li");
  const t = new Date(e.t * 1000).toLocaleTimeString("en-GB");
  li.innerHTML = `<time>${t}</time><span class="${e.level}">${esc(e.msg)}</span>`;
  $("log").appendChild(li);
  while ($("log").children.length > 300) $("log").firstChild.remove();
}

function renderAll() { renderTabs(); renderCodes(); renderStatus(); }

$("btnOpen").onclick = () => api("/api/open", {site: S.site});
$("btnFind").onclick = () => api("/api/find", {site: S.site, query: $("query").value});
$("btnTest").onclick = () => api("/api/test", {site: S.site});
$("btnStop").onclick = () => api("/api/stop", {});
$("addForm").onsubmit = async e => {
  e.preventDefault();
  const code = $("addCode").value.trim();
  if (!code) return;
  const j = await api("/api/codes", {site: S.site, code});
  if (j.ok) $("addCode").value = "";
};

(async function boot() {
  const st = await (await fetch("/api/state")).json();
  S.sites = st.sites; S.codes = st.codes; S.status = st.status; S.maxCodes = st.max_codes;
  if (!S.sites[S.site]) S.site = Object.keys(S.sites)[0];
  $("cfgPath").textContent = st.config_path;
  st.log.forEach(addLog);
  if (!st.log.length) addLog({msg: "Pick an app above, then start at step 1.", level: "info", t: Date.now() / 1000});
  renderAll();
  const es = new EventSource("/api/events");
  es.onmessage = ev => {
    const {kind, data} = JSON.parse(ev.data);
    if (kind === "log") addLog(data);
    if (kind === "codes") { S.codes = data; renderCodes(); }
    if (kind === "status") { S.status = data; if (!data.busy) S.progress = null; renderStatus(); renderCodes(); }
    if (kind === "progress") { S.progress = data; renderStatus(); renderCodes(); }
  };
})();
