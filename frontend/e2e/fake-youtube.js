// Stand-in for https://www.youtube.com/iframe_api, served by the e2e test when YouTube itself is
// unreachable. Mirrors the parts of YT.Player that WellPlayed relies on, including the behaviour that
// matters for sync: playback rates are rounded to YouTube's 0.25 steps, and videos whose id starts
// with "noembed" raise error 150 like an embed-disabled upload.
(() => {
  const STATES = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 };
  const RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
  window.__ytPlayers = [];

  class Player {
    constructor(el, opts) {
      const slot = typeof el === "string" ? document.getElementById(el) : el;
      this.video = document.createElement("video");
      this.video.src = "/demo.webm";
      this.video.muted = true;
      this.video.playsInline = true;
      this.video.style.cssText = "width:100%;height:100%;background:#000";
      slot.replaceWith(this.video);
      this.events = opts.events || {};
      this.state = STATES.UNSTARTED;
      this.id = opts.videoId;
      const set = (s) => {
        if (s === this.state) return;
        this.state = s;
        this.events.onStateChange?.({ data: s, target: this });
      };
      this.video.addEventListener("playing", () => set(STATES.PLAYING));
      this.video.addEventListener("pause", () => !this.video.ended && set(STATES.PAUSED));
      this.video.addEventListener("waiting", () => set(STATES.BUFFERING));
      this.video.addEventListener("ended", () => set(STATES.ENDED));
      window.__ytPlayers.push(this);
      setTimeout(() => {
        this.events.onReady?.({ target: this });
        if (String(this.id).startsWith("noembed")) this.events.onError?.({ data: 150, target: this });
      }, 50);
    }
    playVideo() {
      void this.video.play().catch(() => {});
    }
    pauseVideo() {
      this.video.pause();
    }
    seekTo(s) {
      this.video.currentTime = s;
    }
    cueVideoById(id) {
      this.id = id;
      this.video.currentTime = 0;
    }
    getCurrentTime() {
      return this.video.currentTime;
    }
    getDuration() {
      return Number.isFinite(this.video.duration) ? this.video.duration : 0;
    }
    getPlayerState() {
      return this.state;
    }
    getPlaybackRate() {
      return this.video.playbackRate;
    }
    getAvailablePlaybackRates() {
      return RATES;
    }
    setPlaybackRate(r) {
      this.video.playbackRate = RATES.reduce((a, b) => (Math.abs(b - r) < Math.abs(a - r) ? b : a));
    }
    getVideoLoadedFraction() {
      const v = this.video;
      return v.buffered.length && v.duration ? v.buffered.end(v.buffered.length - 1) / v.duration : 0;
    }
    destroy() {
      this.video.remove();
    }
    /** Test hook: a viewer presses pause inside the YouTube player. */
    userPause() {
      this.video.pause();
    }
  }

  window.YT = { Player, PlayerState: STATES };
  setTimeout(() => window.onYouTubeIframeAPIReady?.(), 0);
})();
