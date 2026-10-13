const test = require("node:test");
const assert = require("node:assert");
const X = require("../lib/extract.js");
const CONFIG = require("../lib/config.js");
const CFG = CONFIG.defaults;

test("finds codes in deal text", () => {
  const found = X.findCodes(`£5 off £20 at Deliveroo with code ROO5OFF - selected accounts
    Uber Eats: use EATS20 for 20% off. Code: FREEDEL25 works in the app.
    Just Eat voucher JUSTSAVE10 at checkout`);
  for (const c of ["ROO5OFF", "EATS20", "FREEDEL25", "JUSTSAVE10"]) assert.ok(found[c], c);
});

test("ignores noise", () => {
  assert.deepStrictEqual(X.findCodes("Promo code: FREE delivery. Use the APP. Code 2024. Voucher code needed: NONE"), {});
});

test("code must be upper case but keywords any case", () => {
  const found = X.findCodes("CODE: Deliveroo rocks. promo code SAVE5NOW today");
  assert.ok(found.SAVE5NOW); assert.ok(!found.Deliveroo);
});

test("flags expired", () => {
  assert.ok(X.findCodes("Update: code OLDDEAL10 has expired").OLDDEAL10.expired_hint);
});

test("reads voucherCode JSON embedded in pages", () => {
  assert.ok(X.findCodes('{"title":"x","voucherCode":"HUKD7OFF"}').HUKD7OFF);
});

test("ranking prefers multiple sources", () => {
  const r = X.mergeCandidates([["A", X.findCodes("code AAAA11")], ["B", X.findCodes("code BBBB22 and code AAAA11")]]);
  assert.strictEqual(r[0].code, "AAAA11"); assert.deepStrictEqual(r[0].sources, ["A", "B"]);
});

test("member and new-customer tagging", () => {
  const found = X.findCodes("Deliveroo Plus members: use code PLUSFEAST for £5 off.\n" + "x ".repeat(80) +
    "\nNew customers get £10 off with code HELLO10 on your first order.\n" + "y ".repeat(80) + "\nAnyone can use code EVERYONE7 this week.");
  assert.ok(found.PLUSFEAST.member_only && !found.PLUSFEAST.new_only);
  assert.ok(found.HELLO10.new_only && !found.HELLO10.member_only);
  assert.ok(!found.EVERYONE7.member_only && !found.EVERYONE7.new_only);
  assert.ok(X.findCodes("Uber One members get code ONEEATS15").ONEEATS15.member_only);
  assert.ok(X.findCodes("Just Eat+ exclusive: code JEPLUS4").JEPLUS4.member_only);
});

test("classify rejected / works / unknown", () => {
  const before = "Checkout\nSubtotal\n£18.50\nTotal\n£20.99";
  let [s, msg] = X.classify(before, before + "\nSorry, ABC123 isn't valid.", CFG);
  assert.strictEqual(s, "rejected"); assert.match(msg, /isn't valid/);
  const r = X.classify(before, "Checkout\nSubtotal\n£18.50\nPromo SAVE5: -£5.00\nTotal\n£15.99", CFG);
  assert.strictEqual(r[0], "works"); assert.strictEqual(r[2], 5);
  assert.strictEqual(X.classify("Total\n£10.00", "Total\n£10.00", CFG)[0], "unknown");
});

test("site detection by URL", () => {
  assert.strictEqual(CONFIG.siteForUrl("https://deliveroo.co.uk/checkout"), "deliveroo");
  assert.strictEqual(CONFIG.siteForUrl("https://www.just-eat.co.uk/basket"), "justeat");
  assert.strictEqual(CONFIG.siteForUrl("https://www.ubereats.com/gb/checkout"), "ubereats");
  assert.strictEqual(CONFIG.siteForUrl("https://notdeliveroo.co.uk/"), null);
  assert.strictEqual(CONFIG.siteForUrl("chrome://extensions"), null);
});

test("tags stay within their own post", () => {
  const found = X.findCodes("Deliveroo Plus members: use code PLUSONLY9\n\nAnyone: £5 off with code SAVE5NOW");
  assert.ok(found.PLUSONLY9.member_only); assert.ok(!found.SAVE5NOW.member_only);
});

test("hidden codes in reveal buttons and page data", () => {
  const html = `<button data-clipboard-text="ROOHIDE7">Reveal code</button>
    <div data-voucher-code='JE10HIDDEN'></div><script>{"code":"UBERJSON5","currency":{"code":"GBP"}}</script>`;
  const found = X.findCodes(html);
  for (const c of ["ROOHIDE7", "JE10HIDDEN", "UBERJSON5"]) assert.ok(found[c], c);
  assert.ok(!found.GBP);
});

test("source list covers many sites and adds member searches", () => {
  const plain = CONFIG.sourceUrls("ubereats", false), member = CONFIG.sourceUrls("ubereats", true);
  assert.ok(plain.length >= 13, `only ${plain.length} sources`);
  assert.ok(member.length > plain.length);
  assert.ok(member.some(s => s.url.includes("Uber%20One")));
  assert.ok(plain.every(s => !s.url.includes("{")));
  // Sites without a page for an app are skipped rather than fetched with a blank name
  assert.ok(!CONFIG.sourceUrls("deliveroo", false).some(s => s.url.includes("savoo")));
});

test("hidden codes come out on their own, without neighbouring wording", () => {
  const html = `<h2>Deliveroo code BADCODE1 for 20% off</h2><h2>Deliveroo Plus members: use code TENOFF</h2>
    <button data-clipboard-text="ROOHIDE7">Reveal</button>`;
  assert.strictEqual(X.hiddenCodes(html), "code ROOHIDE7");
});
