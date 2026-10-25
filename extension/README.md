# WellPlayed Sync (browser extension)

For **Household Mode** on services you pay for yourself (Netflix, Prime, Disney+, …). Each home plays the title from its own account; this extension only keeps the tab's `<video>` in step with the room: play, pause, seek and a small playback-rate nudge. It never reads, copies or restreams the stream, so DRM and platform terms are untouched.

## Install (Chrome / Edge / Brave)
1. `chrome://extensions` → enable **Developer mode** → **Load unpacked** → pick this `extension/` folder.
2. In the WellPlayed room, click **📱 Pair phone** → *Own streaming service?* to see the server, room code and token.
3. Open your streaming service in a tab, start the title, click the extension icon, paste the three values, **Connect this tab**.

The host ticks “I’m the host” if their play/pause/seek in the streaming tab should drive the room. Everyone else follows.

## Notes
- No build step: plain JavaScript, Manifest V3. The drift maths mirrors `frontend/src/lib/sync-core`.
- Streaming sites change often. The extension relies only on the standard `HTMLVideoElement`, and picks the largest video in any frame. If playback is blocked by autoplay policy, click the video once.
- Ads inserted by a service will look like drift; the room waits/corrects once the content resumes.
- Tested against the repo's demo video page (`frontend/e2e/extension.mjs`), **not** against real streaming services.
