const $ = (id) => document.getElementById(id);
const tabQuery = () => chrome.tabs.query({ active: true, currentWindow: true }).then((t) => t[0]);
const toAllFrames = async (tab, msg) => {
  const frames = (await chrome.webNavigation?.getAllFrames?.({ tabId: tab.id })) ?? [{ frameId: 0 }];
  return Promise.all(frames.map((f) => chrome.tabs.sendMessage(tab.id, msg, { frameId: f.frameId }).catch(() => null)));
};

chrome.storage.local.get("wpConfig", ({ wpConfig }) => {
  if (!wpConfig) return;
  $("server").value = wpConfig.server ?? "";
  $("code").value = wpConfig.code ?? "";
  $("token").value = wpConfig.token ?? "";
  $("host").checked = !!wpConfig.isHost;
});

$("connect").onclick = async () => {
  const config = {
    server: $("server").value.trim().replace(/\/$/, ""),
    code: $("code").value.trim().toUpperCase(),
    token: $("token").value.trim(),
    isHost: $("host").checked,
    auto: true,
  };
  if (!config.server || !config.code || !config.token) return ($("status").textContent = "Fill in server, code and token.");
  await chrome.storage.local.set({ wpConfig: config });
  const tab = await tabQuery();
  await toAllFrames(tab, { type: "wp:connect", config });
  $("status").textContent = "Connecting…";
  setTimeout(refresh, 1200);
};

$("disconnect").onclick = async () => {
  const { wpConfig } = await chrome.storage.local.get("wpConfig");
  if (wpConfig) await chrome.storage.local.set({ wpConfig: { ...wpConfig, auto: false } });
  await toAllFrames(await tabQuery(), { type: "wp:disconnect" });
  $("status").textContent = "Disconnected.";
};

async function refresh() {
  const tab = await tabQuery();
  const s = await chrome.runtime.sendMessage({ type: "wp:get-status", tabId: tab.id });
  if (s) $("status").textContent = `${s.status}${s.driftMs !== undefined ? ` · drift ${s.driftMs} ms` : ""}${s.status === "blocked" ? " · click the video once to allow playback" : ""}`;
}
setInterval(refresh, 1000);
refresh();
