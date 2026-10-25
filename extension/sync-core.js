// Same maths as frontend/src/lib/sync-core (kept dependency-free so the extension needs no build step).
(function (g) {
  const DRIFT_IGNORE_S = 0.08;
  const DRIFT_SEEK_S = 2;
  const RATE_NUDGE = 0.05;

  function expectedPosition(t, serverNowMs) {
    if (t.state !== "playing") return t.anchorMediaS;
    return t.anchorMediaS + (Math.max(0, serverNowMs - t.anchorServerMs) / 1000) * t.rate;
  }

  function driftAction(drift, expected, baseRate) {
    const abs = Math.abs(drift);
    if (abs < DRIFT_IGNORE_S) return { kind: "none", rate: baseRate };
    if (abs >= DRIFT_SEEK_S) return { kind: "seek", to: expected };
    return { kind: "rate", rate: baseRate * (drift > 0 ? 1 - RATE_NUDGE : 1 + RATE_NUDGE) };
  }

  class ClockSync {
    constructor() { this.samples = []; this.offsetMs = 0; this.ready = false; }
    addSample(t0, serverMs, t3) {
      const rtt = t3 - t0;
      if (rtt < 0) return;
      this.samples.push({ offset: serverMs - (t0 + t3) / 2, rtt });
      if (this.samples.length > 40) this.samples.shift();
      const best = [...this.samples].sort((a, b) => a.rtt - b.rtt).slice(0, 5);
      const offs = best.map((s) => s.offset).sort((a, b) => a - b);
      this.offsetMs = offs[Math.floor(offs.length / 2)];
      this.ready = true;
    }
    serverNow(local = Date.now()) { return local + this.offsetMs; }
  }

  g.WPSync = { expectedPosition, driftAction, ClockSync };
})(typeof globalThis !== "undefined" ? globalThis : window);
