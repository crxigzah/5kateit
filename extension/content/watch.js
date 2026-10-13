// Runs on Deliveroo, Just Eat and Uber Eats pages. Tells the Snackhack panel when the promo code
// box (or the checkout's "add promo code" link) appears or disappears, so Try codes can unlock.
(() => {
  if (globalThis.SnackWatch) return;
  globalThis.SnackWatch = true;
  let last, timer = null;
  const state = () => { try { return SnackTester.detect(SnackConfig.defaults); } catch (e) { return null; } };
  const check = () => {
    timer = null;
    const now = state();
    if (now !== last) {
      last = now;
      chrome.runtime.sendMessage({type: "promo-state", state: now}).catch(() => {}); // panel may be closed
    }
  };
  new MutationObserver(() => { if (!timer) timer = setTimeout(check, 600); })
    .observe(document.documentElement, {subtree: true, childList: true, attributes: true,
                                        attributeFilter: ["style", "class", "hidden", "aria-hidden", "open"]});
  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg && msg.type === "get-promo-state") reply({state: state()});
  });
  check();
})();
