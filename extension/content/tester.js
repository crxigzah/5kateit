// Injected into the checkout tab. Finds the promo box, types a code, reads the result.
// Needs lib/extract.js injected first (SnackExtract).
(function () {
  if (globalThis.SnackTester) return;

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const visible = el => {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect(), s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && s.opacity !== "0";
  };
  const label = el => {
    const t = [el.placeholder, el.getAttribute("aria-label"), el.name, el.id, el.getAttribute("data-testid"), el.getAttribute("autocomplete")];
    if (el.id) { const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l) t.push(l.innerText); }
    const wrap = el.closest("label"); if (wrap) t.push(wrap.innerText);
    const lb = el.getAttribute("aria-labelledby");
    if (lb) lb.split(/\s+/).forEach(id => { const n = document.getElementById(id); if (n) t.push(n.innerText); });
    return t.filter(Boolean).join(" ");
  };
  const textOf = el => (el.innerText || el.value || el.getAttribute("aria-label") || "").trim();
  const clickables = () => [...document.querySelectorAll('button, a, [role=button], input[type=submit], input[type=button], [tabindex="0"], summary, label')];
  const pageText = () => (document.body ? document.body.innerText : "");

  function findInput(cfg, selector) {
    if (selector) { const el = document.querySelector(selector); return visible(el) ? el : null; }
    const re = new RegExp(cfg.input_hint, "i");
    const skip = /search|email|password|postcode|post code|address|phone|name|card|cvv|expiry|note|instruction|tip/i;
    const inputs = [...document.querySelectorAll("input:not([type]), input[type=text], input[type=search], input[type=tel]")]
      .filter(visible).filter(el => !el.disabled && !el.readOnly);
    return inputs.find(el => re.test(label(el)) && !skip.test(label(el).replace(re, ""))) || inputs.find(el => re.test(label(el))) || null;
  }

  function findOpener(cfg, selector) {
    if (selector) { const el = document.querySelector(selector); return visible(el) ? el : null; }
    const re = new RegExp(cfg.open_text, "i");
    return clickables().filter(visible).find(el => { const t = textOf(el).split("\n")[0].trim(); return t.length < 40 && re.test(t); }) || null;
  }

  function findApply(input, cfg, selector) {
    if (selector) { const el = document.querySelector(selector); return visible(el) ? el : null; }
    const re = new RegExp(cfg.apply_text, "i");
    const form = input.closest("form");
    if (form) {
      const b = [...form.querySelectorAll("button, input[type=submit], [role=button]")].filter(visible)
        .find(el => re.test(textOf(el)) || el.type === "submit");
      if (b) return b;
    }
    let node = input.parentElement;
    for (let i = 0; node && i < 6; i++, node = node.parentElement) {
      const b = [...node.querySelectorAll("button, [role=button], input[type=submit]")].filter(visible).find(el => re.test(textOf(el)));
      if (b) return b;
    }
    return null;
  }

  function findRemove(code, cfg) {
    const re = new RegExp(cfg.remove_text, "i");
    const holder = [...document.querySelectorAll("body *")].find(n => n.children.length < 4 && visible(n) && (n.innerText || "").toUpperCase().includes(code));
    if (holder) {
      let node = holder;
      for (let i = 0; node && i < 5; i++, node = node.parentElement) {
        const b = [...node.querySelectorAll("button, a, [role=button]")].filter(visible)
          .find(el => re.test(textOf(el)) || re.test(el.getAttribute("aria-label") || ""));
        if (b) return b;
      }
    }
    return clickables().filter(visible).find(el => re.test(textOf(el)) || /remove (code|voucher|promo)/i.test(el.getAttribute("aria-label") || "")) || null;
  }

  // Set a value the way a person typing would, so React/Vue forms pick it up.
  async function typeInto(el, value) {
    el.focus();
    el.click();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(el, "");
    el.dispatchEvent(new Event("input", {bubbles: true}));
    for (const ch of value) {
      el.dispatchEvent(new KeyboardEvent("keydown", {key: ch, bubbles: true}));
      setter.call(el, el.value + ch);
      el.dispatchEvent(new InputEvent("input", {bubbles: true, data: ch, inputType: "insertText"}));
      el.dispatchEvent(new KeyboardEvent("keyup", {key: ch, bubbles: true}));
      await sleep(50 + Math.random() * 90);
    }
    el.dispatchEvent(new Event("change", {bubbles: true}));
  }

  function pressEnter(el) {
    for (const type of ["keydown", "keypress", "keyup"])
      el.dispatchEvent(new KeyboardEvent(type, {key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true}));
    if (el.form) el.form.requestSubmit ? el.form.requestSubmit() : el.form.submit();
  }

  async function locate(cfg, sel) {
    let input = findInput(cfg, sel.input_selector);
    if (input) return input;
    const opener = findOpener(cfg, sel.open_selector);
    if (!opener) return null;
    opener.click();
    for (let i = 0; i < 8 && !input; i++) { await sleep(500); input = findInput(cfg, sel.input_selector); }
    return input;
  }

  async function tryCode(code, cfg, sel = {}, waitSeconds = 8) {
    const input = await locate(cfg, sel);
    if (!input) return {status: "error", message: "Couldn't find the promo code box on this page. Go to checkout (or open the promo/voucher section) and try again.", saving: null};
    const before = pageText();
    await typeInto(input, code);
    await sleep(300 + Math.random() * 500);
    const apply = findApply(input, cfg, sel.apply_selector);
    if (apply) apply.click(); else pressEnter(input);
    let result = ["unknown", "No visible response from the site", null];
    const deadline = Date.now() + waitSeconds * 1000;
    while (Date.now() < deadline) {
      await sleep(500);
      result = SnackExtract.classify(before, pageText(), cfg);
      if (result[0] !== "unknown") {
        await sleep(1000); // let the total update, then read it again for the saving
        const again = SnackExtract.classify(before, pageText(), cfg);
        if (again[0] === result[0]) result = again;
        break;
      }
    }
    return {status: result[0], message: result[1], saving: result[2]};
  }

  async function removeCode(code, cfg) {
    const b = findRemove(code.toUpperCase(), cfg);
    if (!b) return false;
    b.click();
    await sleep(1500);
    return !pageText().toUpperCase().includes(code.toUpperCase());
  }

  globalThis.SnackTester = {tryCode, removeCode, hasPromoBox: cfg => !!(findInput(cfg) || findOpener(cfg))};
})();
