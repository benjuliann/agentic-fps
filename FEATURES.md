# Agentic FPS — Feature Spec

Spec for a browser-based single-player FPS prototype using three.js. Intended to be implemented file-by-file by a coding agent.

## Scope

**In scope:** movement, shooting, one test map, HUD, shootable dummy targets with health bars, sound effects (gunshot, footsteps, jump). This is an FPS core, not a Roblox-style platform.

**Explicitly out of scope** (do not build unless asked):

- Multiplayer/networking
- Accounts, avatars, marketplace
- In-browser UGC scripting engine
- Multiple maps / level editor
- Asset pipeline (GLTF models) — level geometry is procedural for now

## Assumptions (flag if wrong instead of silently changing)

- three.js loaded via CDN `<script type="importmap">` — no npm/bundler build step.
- Physics: `cannon-es` (pure JS, no WASM build step) for the player collider and raycasts. If perf becomes an issue later, Rapier is the alternative — do not switch without flagging it.
- Level geometry: a single procedural box-room arena, not an imported model.
- No asset loading, no textures beyond flat materials — dummies are simple primitive meshes (e.g. capsule/box), not modeled/rigged characters.
- Sound effects: synthesized at runtime via the Web Audio API (oscillator/noise nodes), not external audio files, since there's no audio asset pipeline and the implementing bot can't source licensed sound files. This keeps SFX "possible" without a build step. If the user later supplies real audio files, swap them in `js/audio.js` — do not change the rest of the code to fetch them without confirming file paths first.
- Health bars render above each dummy as an in-world `THREE.Sprite` with a canvas-generated texture (redrawn when health changes) — no extra rendering library (e.g. CSS2DRenderer) needed.

## File structure

```
index.html
js/
  main.js
  physics.js
  level.js
  player.js
  weapons.js
  hud.js
  dummy.js
  audio.js
```

### `index.html`

- Import map for `three` and `cannon-es` from CDN.
- Empty `<body>` — three.js appends its own `<canvas>`.
- HUD DOM elements the game will control: health readout, ammo readout, crosshair, "click to play" overlay (needed for Pointer Lock API, which requires a user gesture).
- `<script type="module" src="js/main.js">`.

### `js/main.js`

- Entry point. Owns: `THREE.Scene`, `THREE.PerspectiveCamera`, `THREE.WebGLRenderer`, the animation loop (`requestAnimationFrame`).
- Instantiates `Level`, `Player`, `Weapons`, `HUD`, one or more `Dummy` targets, the audio wrapper, and the physics world.
- Each frame: step physics → update player → update weapons → update dummies (health bar sprites face camera) → render.

### `js/physics.js`

- Wraps a `cannon-es` `World` (gravity, fixed timestep step function).
- Exposes: add-body helper, step function called from the main loop.

### `js/level.js`

- Builds the test arena: floor + four walls as `THREE.Mesh` + matching static `cannon-es` bodies.
- Defines one spawn point (position + facing).

### `js/player.js`

- Pointer Lock controls for mouselook (yaw/pitch on the camera).
- WASD movement + jump, implemented as forces/velocity on a `cannon-es` capsule (or cylinder) body.
- Camera position each frame follows the physics body.

### `js/weapons.js`

- Fire on mouse click (subject to pointer lock being active).
- Hitscan: raycast from camera center against level meshes and dummy meshes.
- On dummy hit: apply damage via `dummy.js`, play gunshot + hit-impact sound via `audio.js`.
- Ammo count + reload key binding.
- Emits hit/fire events for `hud.js` to react to (no direct DOM access here).

### `js/dummy.js`

- Defines a `Dummy` target: primitive mesh body, fixed spawn position, HP value.
- Floating health-bar sprite above the mesh (canvas texture, redrawn on damage).
- `takeDamage(amount)` — reduces HP, updates health bar, triggers a reset/respawn (or removal) at 0 HP.
- Does not move or attack — a static target, not an AI enemy.

### `js/audio.js`

- Wraps the Web Audio API `AudioContext`.
- Exposes play functions for: gunshot, footstep, jump, dummy-hit — each synthesized (oscillator/noise burst), no external files.
- Footstep sound triggers on a timer while `player.js` reports movement; jump/gunshot/hit trigger once per event.

### `js/hud.js`

- Owns all DOM updates: health, ammo, crosshair state, click-to-play overlay show/hide.
- Reads state from `player.js` / `weapons.js`; does not own game logic.
- Does not manage dummy health bars — those are in-world sprites owned by `dummy.js`, not DOM/HUD elements.

## Verification checklist (for the implementing agent)

1. `index.html` loads with no console errors, canvas fills the viewport → check: open in browser, inspect console.
2. Click locks the pointer and hides the overlay → check: click canvas, cursor disappears, overlay hidden.
3. WASD moves the player, mouse looks around, player collides with walls/floor (doesn't fall through or clip out) → check: manual test in browser.
4. Jump works and gravity returns the player to the floor → check: manual test.
5. Left-click fires a hitscan shot; hitting a wall is detectable (log or visual feedback) → check: manual test.
6. Ammo count decrements on fire and reload key resets it → check: HUD readout updates.
7. Health/ammo HUD values reflect actual game state, not hardcoded → check: read `hud.js` against `player.js`/`weapons.js` state.
8. Shooting a dummy reduces its health bar and it resets/despawns at 0 HP → check: manual test, shoot a dummy to zero.
9. Gunshot sound plays on fire, footstep sound plays while moving, jump sound plays on jump → check: manual test with audio unmuted (note: browsers block audio until a user gesture — verify the pointer-lock click also unlocks the `AudioContext`).
