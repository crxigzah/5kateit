// Toolbar icon: Chrome, Edge and Brave open the Snackhack side panel. Opera has the side panel
// API but doesn't show extension side panels, so there (and anywhere without the API) the icon
// opens Snackhack in its own small window instead. A window, not a popup, because a popup closes
// as soon as you click the page, which would stop a run halfway.
const IS_OPERA = /\bOPR\//.test(navigator.userAgent);
const SIDE_PANEL = !!(chrome.sidePanel && chrome.sidePanel.setPanelBehavior) && !IS_OPERA;

async function setup() {
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    // Explicitly off in Opera: an earlier version turned it on, which swallowed icon clicks.
    await chrome.sidePanel.setPanelBehavior({openPanelOnActionClick: SIDE_PANEL}).catch(() => {});
  }
}
chrome.runtime.onInstalled.addListener(setup);
chrome.runtime.onStartup.addListener(setup);
setup();

async function openWindow() {
  const {panelWindowId} = await chrome.storage.session.get("panelWindowId");
  if (panelWindowId) {
    try { await chrome.windows.update(panelWindowId, {focused: true}); return panelWindowId; } catch (e) { /* closed */ }
  }
  const w = await chrome.windows.create({url: "panel.html?window=1", type: "popup", width: 420, height: 860, focused: true});
  await chrome.storage.session.set({panelWindowId: w.id});
  return w.id;
}

// Only fires when the side panel isn't handling the click.
chrome.action.onClicked.addListener(() => { openWindow(); });
chrome.windows.onRemoved.addListener(async id => {
  const {panelWindowId} = await chrome.storage.session.get("panelWindowId");
  if (id === panelWindowId) chrome.storage.session.remove("panelWindowId");
});
