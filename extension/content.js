// Runs in every frame. Idle until the popup connects this tab to a room; then it follows the room
// timeline by controlling the page's own <video> element (play/pause/seek/rate). Nothing is read or copied.
(() => {
  if (window.__wpSyncLoaded) return;
  window.__wpSyncLoaded = true;
  const { expectedPosition, driftAction, ClockSync } = window.WPSync;

  let ws = null, clock = new ClockSync(), timeline = null, timer = null, pingTimer = null, suppressUntil = 0;
  let cfg = null, canControl = false, status = "idle";

  const biggestVideo = () => {
    const vids = [...document.querySelectorAll("video")].filter((v) => v.readyState > 0 || v.src || v.currentSrc);
    return vids.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0] || null;
  };
  const quiet = (fn, ms = 700) => { suppressUntil = Date.now() + ms; fn(); };
  const report = (s, extra = {}) => { status = s; chrome.runtime.sendMessage({ type: "wp:status", status: s, ...extra }).catch(() => {}); };

  function tick() {
    const v = biggestVideo();
    if (!v || !timeline || !clock.ready) return;
    const now = clock.serverNow();
    const expected = expectedPosition(timeline, now);
    const drift = v.currentTime - expected;
    if (timeline.state === "paused") {
      if (!v.paused) quiet(() => v.pause());
      if (Math.abs(drift) > 0.25) quiet(() => (v.currentTime = expected));
    } else if (now < timeline.anchorServerMs) {
      if (!v.paused) quiet(() => v.pause());
    } else {
      if (v.paused) {
        quiet(() => (v.currentTime = expected));
        v.play().catch(() => report("blocked"));
      } else {
        const a = driftAction(drift, expected, timeline.rate);
        if (a.kind === "seek") quiet(() => (v.currentTime = a.to));
        else v.playbackRate = a.rate;
      }
    }
    report("synced", { driftMs: Math.round(drift * 1000), title: document.title });
  }

  function attachUserListeners() {
    const send = (data) => canControl && ws && ws.readyState === 1 && ws.send(JSON.stringify({ type: "timeline:set", data }));
    document.addEventListener("play", (e) => e.target.tagName === "VIDEO" && Date.now() > suppressUntil && send({ action: "play", at: e.target.currentTime }), true);
    document.addEventListener("pause", (e) => e.target.tagName === "VIDEO" && Date.now() > suppressUntil && send({ action: "pause", at: e.target.currentTime }), true);
    document.addEventListener("seeked", (e) => e.target.tagName === "VIDEO" && Date.now() > suppressUntil && send({ action: "seek", to: e.target.currentTime }), true);
  }

  function connect(c) {
    disconnect();
    cfg = c;
    clock = new ClockSync();
    const url = `${c.server.replace(/^http/, "ws")}/ws/rooms/${c.code}?token=${encodeURIComponent(c.token)}&device=screen`;
    ws = new WebSocket(url);
    ws.onopen = () => {
      report("connected");
      const ping = () => ws.readyState === 1 && ws.send(JSON.stringify({ type: "clock:ping", data: { t0: Date.now() } }));
      ping();
      pingTimer = setInterval(ping, 3000);
      timer = setInterval(tick, 500);
    };
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.type === "clock:pong") clock.addSample(m.data.t0, m.data.serverMs, Date.now());
      else if (m.type === "room:snapshot") { timeline = m.data.timeline; canControl = m.data.you.isHost || m.data.settings.membersCanControl; }
      else if (m.type === "settings:state") canControl = cfg.isHost || m.data.settings.membersCanControl;
      else if (m.type === "timeline:state" && (!timeline || m.data.version >= timeline.version)) { timeline = m.data; tick(); }
    };
    ws.onclose = () => { clearInterval(timer); clearInterval(pingTimer); if (cfg) { report("reconnecting"); setTimeout(() => cfg && connect(cfg), 1500); } };
  }

  function disconnect() {
    const c = cfg; cfg = null;
    clearInterval(timer); clearInterval(pingTimer);
    if (ws) { ws.onclose = null; ws.close(); ws = null; }
    if (c) report("idle");
  }

  attachUserListeners();
  chrome.runtime.onMessage.addListener((msg, _s, reply) => {
    if (msg.type === "wp:connect") { connect(msg.config); reply({ ok: true }); }
    else if (msg.type === "wp:disconnect") { disconnect(); reply({ ok: true }); }
    else if (msg.type === "wp:ping") reply({ status, hasVideo: !!biggestVideo() });
    return true;
  });
  chrome.storage.local.get("wpConfig", ({ wpConfig }) => { if (wpConfig?.auto) connect(wpConfig); });
})();
