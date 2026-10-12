"""JavaScript run inside the checkout page to locate the promo box.

Each finder tags the element it picks with data-tcf="..." so Playwright can then
type and click through a normal locator (real keyboard and mouse events).
"""

COMMON = r"""
const visible = el => {
  if (!el || !el.isConnected) return false;
  const r = el.getBoundingClientRect(), s = getComputedStyle(el);
  return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0';
};
const label = el => {
  let t = [el.placeholder, el.getAttribute('aria-label'), el.name, el.id, el.getAttribute('data-testid'), el.getAttribute('autocomplete')];
  if (el.id) { const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l) t.push(l.innerText); }
  const wrap = el.closest('label'); if (wrap) t.push(wrap.innerText);
  const lb = el.getAttribute('aria-labelledby');
  if (lb) lb.split(/\s+/).forEach(id => { const n = document.getElementById(id); if (n) t.push(n.innerText); });
  return t.filter(Boolean).join(' ');
};
const textOf = el => (el.innerText || el.value || el.getAttribute('aria-label') || '').trim();
const clickables = () => [...document.querySelectorAll('button, a, [role=button], input[type=submit], input[type=button], [tabindex="0"], summary, label')];
const tag = (el, name) => { document.querySelectorAll(`[data-tcf="${name}"]`).forEach(n => n.removeAttribute('data-tcf')); el.setAttribute('data-tcf', name); return true; };
"""

FIND_INPUT = COMMON + r"""
([hint, selector]) => {
  if (selector) { const el = document.querySelector(selector); return el && visible(el) ? tag(el, 'input') : false; }
  const re = new RegExp(hint, 'i');
  const skip = /search|email|password|postcode|post code|address|phone|name|card|cvv|expiry|note|instruction|tip/i;
  const inputs = [...document.querySelectorAll('input:not([type]), input[type=text], input[type=search], input[type=tel]')]
    .filter(visible).filter(el => !el.disabled && !el.readOnly);
  const hit = inputs.find(el => re.test(label(el)) && !skip.test(label(el).replace(re, '')))
           || inputs.find(el => re.test(label(el)));
  return hit ? tag(hit, 'input') : false;
}
"""

FIND_OPENER = COMMON + r"""
([pattern, selector]) => {
  if (selector) { const el = document.querySelector(selector); return el && visible(el) ? tag(el, 'open') : false; }
  const re = new RegExp(pattern, 'i');
  const cands = clickables().filter(visible).filter(el => {
    const t = textOf(el).split('\n')[0].trim();
    return t.length < 40 && re.test(t);
  });
  return cands.length ? tag(cands[0], 'open') : false;
}
"""

FIND_APPLY = COMMON + r"""
([pattern, selector]) => {
  if (selector) { const el = document.querySelector(selector); return el && visible(el) ? tag(el, 'apply') : false; }
  const input = document.querySelector('[data-tcf="input"]');
  if (!input) return false;
  const re = new RegExp(pattern, 'i');
  const form = input.closest('form');
  if (form) {
    const b = [...form.querySelectorAll('button, input[type=submit], [role=button]')].filter(visible)
      .find(el => re.test(textOf(el)) || el.type === 'submit');
    if (b) return tag(b, 'apply');
  }
  // Walk up from the input and take the nearest matching button.
  let node = input.parentElement;
  for (let i = 0; node && i < 6; i++, node = node.parentElement) {
    const b = [...node.querySelectorAll('button, [role=button], input[type=submit]')].filter(visible)
      .find(el => re.test(textOf(el)));
    if (b) return tag(b, 'apply');
  }
  return false;
}
"""

FIND_REMOVE = COMMON + r"""
([pattern, code]) => {
  const re = new RegExp(pattern, 'i');
  const all = clickables().filter(visible);
  // Prefer a remove button sitting near the applied code's text.
  const holder = [...document.querySelectorAll('body *')].find(n => n.children.length < 4 && visible(n) && (n.innerText || '').toUpperCase().includes(code));
  if (holder) {
    let node = holder;
    for (let i = 0; node && i < 5; i++, node = node.parentElement) {
      const b = [...node.querySelectorAll('button, a, [role=button]')].filter(visible)
        .find(el => re.test(textOf(el)) || re.test(el.getAttribute('aria-label') || ''));
      if (b) return tag(b, 'remove');
    }
  }
  const b = all.find(el => re.test(textOf(el)) || /remove (code|voucher|promo)/i.test(el.getAttribute('aria-label') || ''));
  return b ? tag(b, 'remove') : false;
}
"""

PAGE_TEXT = "() => document.body ? document.body.innerText : ''"
