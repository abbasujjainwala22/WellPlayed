import { API_BASE } from "./api";
import { ClockSync } from "./sync-core";

type Handler = (data: any) => void;

/**
 * connecting: first connection in progress · live: connected · reconnecting: dropped, retrying with backoff ·
 * offline: the browser has no network, waiting for it · failed: gave up after MAX_ATTEMPTS (Retry starts over).
 */
export type ConnStatus = "connecting" | "live" | "reconnecting" | "offline" | "failed";

/** How long a message nobody was listening for stays available to a late subscriber. */
const UNHEARD_TTL_MS = 10_000;
/** The server answers every clock:ping with clock:pong; no pong this long after a ping means the link is dead. */
const PONG_TIMEOUT_MS = 10_000;
/** Consecutive failed attempts before we stop retrying on our own and offer a Retry button. */
const MAX_ATTEMPTS = 8;
const BACKOFF_BASE_MS = 500;
const BACKOFF_MAX_MS = 10_000;
/** Close codes that mean "don't come back": not a member any more, no such room, the party ended. */
const FATAL = new Set([4401, 4404, 4410]);

/** WebSocket client with reconnection, typed-by-convention events and built-in clock sync. */
export class RoomSocket {
  readonly clock = new ClockSync();
  private ws: WebSocket | null = null;
  private handlers = new Map<string, Set<Handler>>();
  /** Latest message of each type that arrived before anyone subscribed to it (see `on`). */
  private unheard = new Map<string, { data: unknown; at: number }>();
  private closed = false;
  private ended = false;
  private attempts = 0;
  private retryTimer: number | undefined;
  private pingTimer: number | undefined;
  private pongTimer: number | undefined;
  private pings = 0;
  private listening = false;
  connected = false;
  status: ConnStatus = "connecting";

  constructor(
    private code: string,
    private token: string,
    private device: "screen" | "companion" = "screen",
  ) {}

  /** Start (or restart) connecting. Safe to call again after close(), which React StrictMode does. */
  connect(): void {
    this.closed = false;
    this.listen(true);
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) return; // already connecting or open
    this.open();
  }

  /** Reconnect now, e.g. from a Retry button. Starts the attempt count over. */
  retry(): void {
    if (this.closed || this.ended) return;
    this.attempts = 0;
    this.drop();
    if (this.status !== "connecting") this.setStatus("reconnecting");
    this.open();
  }

  close(): void {
    this.closed = true;
    this.listen(false);
    window.clearTimeout(this.retryTimer);
    this.stopTimers();
    const ws = this.ws;
    this.ws = null;
    ws?.close();
    if (this.connected) {
      this.connected = false;
      this.emit("_connected", false);
    }
  }

  private open(): void {
    if (this.closed || this.ended) return;
    window.clearTimeout(this.retryTimer);
    const server = API_BASE ? new URL(API_BASE) : location;
    const proto = server.protocol === "https:" ? "wss" : "ws";
    const url = `${proto}://${server.host}/ws/rooms/${this.code}?token=${encodeURIComponent(this.token)}&device=${this.device}`;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => {
      if (ws !== this.ws) return;
      this.attempts = 0;
      this.connected = true;
      this.setStatus("live");
      this.emit("_connected", true);
      this.pings = 0;
      this.ping();
      window.clearInterval(this.pingTimer);
      this.pingTimer = window.setInterval(() => this.ping(), 2000);
    };
    ws.onmessage = (ev) => {
      if (ws !== this.ws) return;
      const msg = JSON.parse(ev.data);
      if (msg.type === "clock:pong") {
        window.clearTimeout(this.pongTimer);
        this.pongTimer = undefined;
        this.clock.addSample(msg.data.t0, msg.data.serverMs, Date.now());
        // sample quickly at first, then relax to every 30 s
        if (++this.pings === 8) {
          window.clearInterval(this.pingTimer);
          this.pingTimer = window.setInterval(() => this.ping(), 30000);
        }
        return;
      }
      this.emit(msg.type, msg.data);
    };
    ws.onclose = (ev) => {
      if (ws !== this.ws) return; // a socket we already gave up on
      this.ws = null;
      this.lost();
      if (FATAL.has(ev.code)) {
        this.ended = true;
        this.listen(false);
        return this.emit("_ended", ev.code);
      }
      this.scheduleRetry();
    };
  }

  /** Forget the current socket without waiting for its close handshake (which a dead link may never finish). */
  private drop(): void {
    const ws = this.ws;
    if (!ws) return;
    this.ws = null;
    ws.onopen = ws.onmessage = ws.onclose = null;
    try {
      ws.close();
    } catch {
      /* already closed */
    }
    this.lost();
  }

  private lost(): void {
    this.stopTimers();
    if (this.connected) {
      this.connected = false;
      this.emit("_connected", false);
    }
  }

  private scheduleRetry(): void {
    if (this.closed || this.ended) return;
    window.clearTimeout(this.retryTimer);
    if (navigator.onLine === false) return this.setStatus("offline"); // the "online" event brings us back
    if (++this.attempts > MAX_ATTEMPTS) return this.setStatus("failed");
    this.setStatus("reconnecting");
    // exponential backoff with jitter, so a room full of people doesn't reconnect in lockstep after a blip
    const ceiling = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (this.attempts - 1));
    this.retryTimer = window.setTimeout(() => this.open(), ceiling / 2 + Math.random() * (ceiling / 2));
  }

  private stopTimers(): void {
    window.clearInterval(this.pingTimer);
    window.clearTimeout(this.pongTimer);
    this.pingTimer = this.pongTimer = undefined;
  }

  private ping(): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.send("clock:ping", { t0: Date.now() });
    // keep the earliest pending deadline: a ping that is never answered must not be pushed back by the next one
    if (this.pongTimer === undefined) {
      this.pongTimer = window.setTimeout(() => {
        this.pongTimer = undefined;
        this.drop();
        this.scheduleRetry();
      }, PONG_TIMEOUT_MS);
    }
  }

  /** Come back straight away when the network returns or the tab is shown again, instead of waiting out the backoff. */
  private onOnline = () => {
    if (this.closed || this.ended) return;
    if (!this.ws) this.retry();
  };

  private onOffline = () => {
    if (!this.connected && !this.closed && !this.ended) this.setStatus("offline");
  };

  private onVisible = () => {
    if (document.visibilityState !== "visible" || this.closed || this.ended) return;
    if (this.ws?.readyState === WebSocket.OPEN) this.ping(); // check the link is still alive (the pong deadline catches it)
    else if (!this.ws) this.retry();
  };

  private listen(on: boolean): void {
    if (on === this.listening) return;
    this.listening = on;
    if (on) {
      window.addEventListener("online", this.onOnline);
      window.addEventListener("offline", this.onOffline);
      document.addEventListener("visibilitychange", this.onVisible);
    } else {
      window.removeEventListener("online", this.onOnline);
      window.removeEventListener("offline", this.onOffline);
      document.removeEventListener("visibilitychange", this.onVisible);
    }
  }

  private setStatus(s: ConnStatus): void {
    if (s === this.status) return;
    this.status = s;
    this.emit("_status", s);
  }

  send(type: string, data: unknown = {}): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type, data }));
  }

  on(type: string, fn: Handler): () => void {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(fn);
    // The room UI mounts only after "room:snapshot", but the server sends each feature's initial
    // state (queue, polls, households, ...) straight after it. Hand a late subscriber what it missed.
    const missed = this.unheard.get(type);
    if (missed) {
      this.unheard.delete(type);
      if (Date.now() - missed.at < UNHEARD_TTL_MS) fn(missed.data);
    }
    return () => this.handlers.get(type)?.delete(fn);
  }

  /** Emit a locally generated event to subscribers (used for client-side re-routing). */
  deliver(type: string, data: unknown): void {
    this.emit(type, data);
  }

  private emit(type: string, data: unknown): void {
    const fns = this.handlers.get(type);
    if (fns?.size) fns.forEach((fn) => fn(data));
    else this.unheard.set(type, { data, at: Date.now() });
  }
}
