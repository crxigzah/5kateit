// Clicking the toolbar icon opens the Snackhack side panel. Browsers without the side panel
// API (e.g. some Opera builds) get the same page as a popup instead.
if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
  chrome.sidePanel.setPanelBehavior({openPanelOnActionClick: true}).catch(() => chrome.action.setPopup({popup: "panel.html"}));
} else {
  chrome.action.setPopup({popup: "panel.html"});
}
