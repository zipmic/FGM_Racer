# Theme Grand Prix – Future Game Makers Jam 2026 #2

A fully directed, deterministic 3D short film (Three.js) that reveals the jam theme
through an absurd race. 17 hand-built cartoon vehicles, scripted comic crashes,
an automatic camera director, a live leaderboard, synthesised music/SFX and a finale
where the little e-scooter hacks its speed limiter, beats Goth Mommy … and never stops.

## Run it (Windows)

Requires Node.js 18+.

```bash
npm install
npm run dev
```

Open http://localhost:5179 in Chrome or Edge. For the show, build once and serve the static files:

```bash
npm run build
npm run preview
```

### GitHub Pages

`.github/workflows/deploy.yml` builds and publishes the site on every push to `main`.
One-time setup in the repository: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
The site then appears at `https://<user>.github.io/<repo>/` (the build uses relative paths, so any repo name works).

## Using it

* **Setup panel** (shown first): edit theme names, votes, colours, vehicle type, who takes part,
  add/remove themes, reorder ties (▲/▼), export/import JSON, and see the computed final order.
  Changes are saved in the browser (localStorage). "Spring til scene" starts at any scene for testing.
* **Start animation** – plays the film from the start (sound starts on this click).
* During playback all controls are hidden; move the mouse to show them:
  Opsætning (back to setup), Replay, ⏪/⏩ previous/next scene (Skip), Pause/Resume,
  timeline scrubber, Sound on/off, Fullscreen.
* Keyboard: `Space` pause, `←`/`→` scene, `R` replay, `M` sound, `F` fullscreen, `B` back to setup.

The special finale (hack + Goth Mommy explosion) is used when the winner uses the *scooter* vehicle
and the runner-up uses the *goth* vehicle. Any other result gets a generic but complete finale with
the correct winner; a scooter winner always gets the "can't stop moving" ending.

## How it is built

Everything in the world is a pure function of time, so playback, pause, skip and replay are
always identical (no physics, no frame-rate dependence).

| Module | Role |
|---|---|
| `src/config.js` | Configuration manager: themes, votes, colours, vehicles, standings, JSON import/export |
| `src/core/TimeMap.js` | Timeline: film time → story time (slow motion) |
| `src/race/RaceScript.js` | Race director script: eliminations, slow-mo, racer curves, finale, shot list, events |
| `src/race/RaceDirector.js` | Evaluates every racer pose per frame, applies crashes, standings |
| `src/race/crashes.js` | The 17 scripted comic crashes + their props, effects, sounds and camera shots |
| `src/camera/CameraDirector.js` | Shot evaluation (follow, static, crash cams, aerials, money shot, zoom-out) |
| `src/vehicles/designs.js` | The 18 vehicle models (17 themes + generic kart) with idle animation |
| `src/world/*` | Scene/renderer/post FX, track, terrain + escape landscape, stands, crowd, tunnel, bridge |
| `src/fx/Effects.js` | Deterministic particles (smoke, sparks, confetti, bats, coins…), energy trail, beacon |
| `src/audio/AudioManager.js` | Web Audio synth: music sequencer per scene + ~70 sound effects |
| `src/ui/*` | Leaderboard, overlays (labels, banners, winner card, end text), setup panel |

Dependencies: `three` (runtime) and `vite` (dev server/build). No CDN or external assets.
Add `?debug` to the URL to get `window.__shot(t)` for rendering any frame as a still.
