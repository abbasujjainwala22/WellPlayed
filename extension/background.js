// Keeps the latest per-tab status for the popup.
const statuses = {};
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === "wp:status" && sender.tab) statuses[sender.tab.id] = { ...msg, at: Date.now() };
});
chrome.runtime.onMessage.addListener((msg, _s, reply) => {
  if (msg.type === "wp:get-status") reply(statuses[msg.tabId] || null);
});
