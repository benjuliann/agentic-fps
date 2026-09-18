# HANDOFF.md

Status handoff for the next agent working on FPS1. Read [FEATURES.md](FEATURES.md) first — this file only covers where the project has **deviated** from that spec, plus current bugs/assumptions/verification status. FEATURES.md has not been updated to reflect these deviations; treat this file as the source of truth for scope until it is.

## Done: start-screen overlay rework

`#overlay` now shows a title ("AGENTIC FPS"), a control list (including Shift-to-sprint, flagged to and kept per the user), and a "Click to start" CTA — markup/CSS only in [index.html](index.html#L101-L149), no JS changes, click-to-lock handler unaffected. Verified via headless Playwright: overlay renders with correct content, no console errors, click still reaches `player.js`'s pointer-lock request.

## Done: red damage vignette on player hit

User request: "when dummy shots hit me, i should get feedback (either audio or sudden red vignette)." Picked the vignette (visual), matching the existing crosshair-hit-flash pattern (`#crosshair.hit`) rather than adding a new synthesized SFX to `js/audio.js`.

- `js/player.js` now has the same tiny event-emitter pattern `js/weapons.js` already uses (`this.listeners`, `on()`, `_emit()`) and emits `'damage'` from `takeDamage()` whenever damage is actually applied (guarded by the existing `if (this.health <= 0) return`).
- `index.html`: new `#damage-vignette` div inside `#hud` (so it inherits `pointer-events: none`), a fixed full-screen radial gradient (red, transparent center, opaque edges) at `opacity: 0` with a `0.4s` fade-out transition; a `.flash` class variant sets `opacity: 1` with `transition: none` for an instant flash-in.
- `js/hud.js` subscribes via `player.on('damage', () => this._flashVignette())`; `_flashVignette()` adds `.flash`, forces a reflow (`el.offsetWidth`) so the instant opacity:1 state actually paints, then removes `.flash` so the base rule's transition fades it back to 0 — same "force a reflow between the instant state and the transition" idiom `_flashCrosshair()`'s simpler `setTimeout` version didn't need, since that one just swaps a color instantly rather than fading.

**Not restricted to dummy shots** — `takeDamage()` is the single existing funnel for all damage (dummy hits *and* fall damage), and splitting a "dummy-only" path would've meant either a new parameter threaded through `takeDamage()` or a second method fall damage and dummy fire call differently. Went with the simpler read: any damage flashes the vignette. Flag if fall-damage flashing too isn't wanted.

Verified via headless Playwright (same scratchpad Playwright install, temporary `window.__debug` hook, reverted after): confirmed exactly one `damage` listener is registered, `getComputedStyle` shows the vignette starts at `opacity: 0` with `transition-duration: 0.4s`, `classList.add('flash')` fires synchronously inside `takeDamage()`, and health still decrements normally (100 → 80 on a forced 20-damage call). No console errors. Not verified: how the flash actually looks/reads on a real hit in the browser (only checked the DOM/class mechanics), and it wasn't checked against a *fatal* hit (health hitting 0 and respawning) specifically, though `_emit` fires before the respawn branch either way.

## Done: dummy wander movement (with collision) + shot tracer beam

Scope confirmed with the user via AskUserQuestion before implementing (2026-09-18): dummies get real cannon-es bodies (not manual `level.obstacles` checks), wandering pauses during guard-scan turns and while engaging/firing, and the tracer beam applies to both dummy and player shots.

1. **Dummy movement** (`js/dummy.js`). Each `Dummy` now owns a `CANNON.Body` (cylinder, radius/height matched to the existing capsule mesh: 0.4 / 2.0), added to the shared `physics` world passed into the constructor (`new Dummy(scene, physics, position)` — `main.js` updated). Own collision group (`DUMMY_GROUP = 4`, mask `GROUND_GROUP = 1`) so dummies collide with level geometry (crates, parapets) but pass through the player and each other, avoiding physical push-around that wasn't asked for.
   - Wander is a simple two-state machine (`idle` ⇄ `moving`) driven by setting `body.velocity.x/z` toward a randomly picked point, arrived within `WANDER_ARRIVE_DIST = 0.5`. Targets come from `level.getAreaAt(x, z)` (new method — returns whichever of `MAIN_ROOF`/`HVAC_DECK`/`CRANE_DECK` a point falls in, preferring the smallest match since the decks sit inside the main roof's x/z footprint) inset by `WANDER_EDGE_MARGIN = 3`, so a dummy never picks a target near its current area's edge/ramp.
   - Collision comes for free from cannon-es: walking into a cover crate or the main roof's parapet stops the body like it would the player (confirmed in verification below — a dummy driven straight at a crate stopped flush against its face, ~0.4 short of the crate's edge, matching the dummy's radius).
   - Pausing: `_updateWander` is called with `paused = wasTurning || !!sight` each frame, where `wasTurning` is true mid guard-scan rotation and `sight` is the (refactored-out) LOS/range check also used by firing — so a dummy freezes in place whenever it's turning to a new guard yaw or has the player in sight/range (whether or not it's actually off cooldown to fire).
   - Respawn now also teleports `body.position`/zeroes `body.velocity` and resets wander state, alongside the existing mesh/health-bar reset.
   - **Tuned this session (user: "move more and a bit faster"):** `WANDER_SPEED` 2 → 3, `WANDER_IDLE_MIN..MAX` 1.5-4s → 0.5-1.5s (dummies spend most of their time in `moving` now instead of split roughly evenly with idle — confirmed ~73% moving-state fraction and ~2.1 units/s average displacement over a 4s sample).
   - **Added this session (user: "jump if possible"):** dummies occasionally hop while actively wandering (not during idle/guard-scan/firing pauses) — `_isGrounded()` (same raycast pattern as `player.js`) gates a vertical velocity kick (`DUMMY_JUMP_VELOCITY = 5`) on a `JUMP_MIN..MAX_INTERVAL = 3-6s` timer that only ticks down while in the `moving` branch of `_updateWander`. Confirmed airborne (position.y rose to ~1.92 from a resting ~1) with no console errors.
   - Numeric constants (speed/idle timing/edge margin/jump interval/jump velocity) are reasoned defaults, not user-specified beyond the general "faster"/"more"/"jump if possible" asks — see assumptions below.

2. **Shot tracer beam.** New `js/tracer.js` (`TracerManager`): `spawn(from, to)` draws a `THREE.Line` (`TRACER_DURATION = 0.15s`, fades via `opacity`, removed + disposed on expiry); `update(delta)` must run once per frame (wired into `main.js`'s `animate()`, alongside `physics.step`/`player.update`/etc.). One instance is created in `main.js` and passed to both `Weapons` (constructor param, used in `fire()` — beam from the raycaster's ray origin to either the hit point or full `RANGE` on a miss) and each `Dummy.update()` (beam from the dummy's eye to `player.camera.position`, spawned only on an actual hit, not every LOS-in-range frame).

**Assumptions not confirmed with the user (reasoned defaults, flag if they feel off):** wander speed (3, still well under the player's 6/10) and idle pause length (0.5-1.5s) are a judgment call on "a bit faster"/"move more," not exact numbers from the user; edge margin (3, vs. the spawn-point logic's 2); tracer duration (0.15s) and color (`0xffee88`, warm yellow); dummies pass through the player and each other rather than physically blocking (chosen to avoid unrequested push-around behavior, not confirmed); a wandering dummy can still be shot mid-move (no invulnerability change); jump velocity/interval (5, 3-6s) reasoned from the player's own `JUMP_VELOCITY = 6`, not confirmed; jumps only happen while actively wandering, not while idling/guard-scanning/engaging — not explicitly asked, but pausing everything-but-movement for a jump seemed like the more natural reading of "jump if possible."

## Done: dummy gun tracer readability (muzzle-origin tracer + gun aim rotation)

User feedback: "it isn't clear who is shooting at me now, dummy guns shoot point exactly where the tracer for better readability." The tracer beam (added last session) originated from an invisible eye point at the dummy's center (`position + (0,1,0)`), not the visible gun mesh — which sat offset to the side/forward of that point and only ever yawed with the body's guard-scan direction. That mismatch between the beam's actual origin/direction and the visible gun model made it hard to tell which dummy was firing.

Two changes in `js/dummy.js`, no other files touched:

1. **Tracer origin**: `_updateFire` now computes the tracer's start point from `this.gunMesh.localToWorld(new THREE.Vector3(0, 0, -0.35))` (the muzzle tip — half the gun box's 0.7-unit length forward) instead of `sight.eye`.
2. **Gun aim rotation** (new `_updateGunAim`, called every frame from `update()` right after `_canSeePlayer`): while `sight` is truthy, `gunMesh.lookAt(player.camera.position)` orients the barrel (yaw *and* pitch) to point exactly at the player, matching the tracer's actual direction; when not in sight, it resets to `gunMesh.rotation.set(0, 0, 0)` (resting, forward with the body) so the gun doesn't stay pinned to a stale aim.

`_canSeePlayer`'s returned `{ eye }` is still used for the LOS raycast itself — only the tracer spawn point and gun orientation stopped using `sight.eye` as a draw/aim point.

**Verified via headless Playwright** (reused the existing scratchpad Chromium install from a prior session's `pw` folder, temporary `window.__debug` hook in `main.js` added and reverted, script `verify_gun_aim.js`): moved the player's **physics body** (not `camera.position` directly — `player.js`'s `update()` overwrites camera position from the body every frame, so a direct position set doesn't stick) and a dummy into LOS/range of each other, let several real frames of the update loop run, then compared `gunMesh.getWorldDirection()` to the normalized vector from the gun's world position to the player's camera position — dot product came back `1.0000000000000002` (exact match, both yaw and pitch). Also confirmed the gun snaps back to resting rotation `(0, 0, 0)` once the dummy is moved out of range. No console/page errors.

**Not done:** real human playtesting of how the rotation looks/feels in motion (only checked the underlying vector math). The muzzle offset (`(0, 0, -0.35)` local to the gun mesh) still introduces a small parallax versus the tracer's exact endpoint since the gun sits offset from the dummy's pivot — not a bug, just an unverified-by-eye approximation.

## Done: L-shaped dummy gun (readability follow-up)

User feedback on a screenshot: the dummy's gun (a single small box) reads as a flat dot/square when aimed straight at the camera — no visible cue it's a gun pointed at the player. Fix in `js/dummy.js`'s `Dummy` constructor only:

- `this.gunMesh` is now a `THREE.Group` (same attach point/position `(0.15, 0.1, -0.55)` on the capsule mesh) holding two child meshes instead of one box: a `barrel` (`0.12×0.12×0.7`, same as before minus a hair of thickness) and a `grip` (`0.1×0.3×0.1`) offset down and back (`0, -0.18, 0.22`) to form an L silhouette. Both are children of the group, so `_updateGunAim`'s `lookAt`/reset and `_updateFire`'s muzzle `localToWorld((0,0,-0.35))` (still the barrel's front face) keep working unchanged — no other method touched.

**Verified via headless Playwright** (same reused scratchpad Chromium install, temporary `window.__debug` hook added/reverted, script `verify_gun_shape.js` in this session's own scratchpad): positioned a dummy in front of the player at a resting height with the gun aimed dead-on (same angle as the user's screenshot), computed the gun's exact screen position via `Object3D.project(camera)`, and cropped a screenshot around it. Confirmed the gun now renders as a visibly elongated dark shape (barrel end + grip) rather than a flat dot, even head-on. No console errors.

**Not done / open question the user asked but wasn't answered with code:** "what else can make it clear it's pointed at the player" — flagged back to the user as options rather than implemented speculatively (see chat): a persistent thin laser-sight line while the dummy has sight (not just the 0.15s firing tracer), a brief muzzle-flash flare at the exact fire moment, or a brighter/contrasting muzzle tip color for at-a-distance visibility. None implemented — no unrequested feature added per this project's simplicity guideline.

## Done: muzzle tip + flash, smaller/slower dummy target acquisition

Two separate asks in one message, both scoped to `js/dummy.js`:

1. **Muzzle tip + flash** (the two options from the previous turn's "what else could help" list that the user picked): a small bright box (`MUZZLE_TIP_COLOR = 0xffee88`, same warm yellow as the tracer, ties the two together) sits at the barrel's front face; a `THREE.Sprite` (`muzzleFlash`, `MUZZLE_FLASH_COLOR = 0xffffaa`) at the same spot is toggled visible for `MUZZLE_FLASH_DURATION = 0.06s` exactly on the frame a shot fires, ticked down in `_updateFire`. Not implemented: the laser-sight option from that same list — wasn't requested this time either.
2. **Detection/lock-on tuning**, user: "dummys line of sight should be smaller, not immediately lock onto the player when identified":
   - `MAX_FIRE_RANGE`: 25 → 15 ("line of sight...smaller" read as detection range, not a narrower FOV cone — dummies still see 360° around themselves, no facing-angle check existed before or now; flag if a facing cone was actually meant).
   - New `sightTimer` (accumulates while `_canSeePlayer` is truthy, resets to 0 the instant it isn't) gates firing: `_updateFire` now also requires `sightTimer >= REACTION_DELAY` (`0.5s`) before it'll shoot, on top of the existing `fireTimer` cooldown. Spotting the player no longer fires the same frame.
   - `_updateGunAim` no longer snaps the gun to the target instantly via `lookAt` — it now computes the target quaternion via `lookAt` (into a scratch value) and slerps the actual `gunMesh.quaternion` toward it at `GUN_AIM_LERP_SPEED = 6`/sec, so the barrel visibly swings onto the player instead of teleporting to face them. This constant is tuned so the gun is nearly fully aimed by the time `REACTION_DELAY` elapses and the first shot fires — the two constants intentionally pair together, not independent knobs.
   - `sightTimer` is reset to 0 on respawn alongside the other transient AI state (wander/jump timers), same pattern as before.

**Verified via headless Playwright** (reused scratchpad Chromium install, temporary `window.__debug` hook added/reverted, scripts `verify_reaction.js` and `verify_muzzle_flash.js` in this session's scratchpad):
- Sampled player health + `dummy.sightTimer` every ~50ms with the dummy continuously sighted: health stayed at 100 through `sightTimer ≈ 0.48s`, then dropped to 75 by the next sample (`sightTimer ≈ 0.62s`) — confirms no shot fires before `REACTION_DELAY`.
- Confirmed a dummy placed at distance 20 (inside the *old* 25-unit range but outside the *new* 15-unit one) returns `null` from `_canSeePlayer`.
- Sampled every `requestAnimationFrame`: `muzzleFlash.visible` flips `true` on the exact frame health drops (the fire frame) and back to `false` the following sampled frame, consistent with the 0.06s duration.
- No console/page errors in either run.

**Not done:** real human playtesting of how the 0.5s reaction delay and the gun's swing-to-target speed actually feel — both are reasoned defaults, not user-specified magnitudes, and are the most likely values to need re-tuning. Also not verified visually: how the muzzle tip/flash actually look at typical engagement distances (only checked visibility-flag/timing mechanics headlessly, not a screenshot this time).

## Bug found + fixed this session: dummy gun aimed backwards (grip toward player, not muzzle)

User caught this on a screenshot: when a dummy has sight, the gun's *rear* (grip end) faced the player instead of the muzzle. Root cause was a convention mismatch between two different rotation mechanisms already in the file, not anything wrong with the L-shape/muzzle-tip geometry itself:

- The gun's resting pose and the body's guard-scan turning (`_updateLook`, `mesh.rotation.y = this.facingYaw`) both use the "local **-Z** is forward" convention — same one `level.js`'s `_buildBridge`/`_buildRamp` use (`atan2(dx, dz)`-style yaw math), and the one the muzzle/barrel/grip geometry was built against (muzzle at local `z=-0.38`, grip at `z=+0.22`).
- `Object3D.lookAt()` (used in `_updateGunAim` to aim at the player) does **not** follow that convention — for a non-camera object it points local **+Z** at the target, the opposite axis. Last session's verification (`gunMesh.getWorldDirection()`, which reads the +Z column) got a dot product of `1.0` and looked correct, but that was checking the wrong end — it confirmed `lookAt` did what `lookAt` always does, not that the *muzzle* pointed at the player.

**Fix:** one line in `_updateGunAim` — `this.gunMesh.rotateY(Math.PI)` immediately after `lookAt()`, before capturing the quaternion used as the slerp target. This flips the assembly 180° around its own (already-aimed) local Y axis, which swaps which end (-Z vs +Z) faces the target while leaving "up" alone (no roll/upside-down flip) — so the muzzle, not the grip, ends up toward the player. Nothing else in `_updateGunAim`, `_updateFire`, or the constructor's geometry needed to change.

**Verified via headless Playwright** (reused scratchpad Chromium install, temporary `window.__debug` hook added/reverted, script `verify_muzzle_direction.js`): let the real update loop run until the aim slerp converged, then measured the *muzzle tip's* world position (not `getWorldDirection()`, learning from the earlier mistake) against the player — direction from the gun's pivot to the muzzle tip vs. direction to the player: dot `0.9994`; muzzle tip measurably closer to the player than the grip (`5.14` vs `5.74` units away). Re-ran the earlier `verify_gun_shape.js` screenshot script at the same angle as the user's screenshot and visually confirmed the bright muzzle tip now faces the camera. No console errors.

## Done: host on Vercel

User confirmed (2026-09-18) the site is live on Vercel via the GitHub-connected auto-deploy flow described below. The local `origin` remote already points at `https://github.com/benjuliann/agentic-fps.git` (confirmed this session), so the rename cleanup noted below is complete.

Setup decisions that were made (kept for reference, not pending anymore):
- **Deploy method:** GitHub repo (`benjuliann/agentic-fps`) connected to a Vercel project via the dashboard/GitHub App, so pushes to `main` auto-deploy. Not a one-off CLI deploy.
- **Domain:** default `*.vercel.app` subdomain. No custom domain, no DNS work needed.
- **Project name:** `agentic-fps`.

**Not yet verified this session** — the live-site checks from the prior handoff still need a pass on the actual `*.vercel.app` URL:
- Load the URL, check for console errors — the CDN imports (three.js, cannon-es from unpkg) need to resolve over the public internet, not just localhost.
- Re-run FEATURES.md's checklist items 2 and 9 (pointer lock engages, `AudioContext` unlocks) on the live URL — both depend on a user gesture and are worth re-confirming under https rather than assuming local-http behavior carries over.
- Confirm `js/*.js` files are served with a correct JS MIME type (Vercel handles this correctly by default; `server.js`'s local dev server only special-cases `.html`/`.js` and falls back to `application/octet-stream` for anything else, so this isn't a given on every static host).

## Scope deviations from FEATURES.md

FEATURES.md describes a single box-room arena with static, non-attacking dummies and flat-color-only materials. Actual implementation:

- **Multi-tier rooftop map**, not a box room: one main roof + 2 raised decks + a connecting bridge (all reachable via ramps, no jumping required).
- **Armed dummies**: guard-scan idle behavior + hitscan firing at the player, not static targets.
- **Procedural noise textures** (canvas-generated) instead of pure flat colors — still no image-asset pipeline, so this is a smaller deviation than full textures would be.
- **HUD has visual health/ammo bars**, not text-only.

Consider updating FEATURES.md's scope section to reflect these — not done since it wasn't asked for.

## Current state

- `js/level.js` — rooftop geometry. `MAIN_ROOF` (x:-35..35, z:-35..35, y=0, only edge with a parapet — the one real fall), `HVAC_DECK` (x:-30..-10, z:0..20, y=2.2), `CRANE_DECK` (x:10..30, z:-20..0, y=3), connected to the main roof by ramps (`_buildRamp`) and to each other by a diagonal bridge (`_buildBridge`, no railings — user's explicit choice). 7 cover crates (`_buildCover`, 2 units tall) placed to both block dummies' LOS and add clutter. All materials use `_makeNoiseTexture` (canvas noise, `RepeatWrapping`; floors get per-area tile scaling via `FLOOR_TEXTURE_TILE`). Also tracks `this.obstacles` (rectangles: props/parapet, not floors/ramps/bridge) and exposes `getRandomSpawnPoint(radius)` — see dummy respawn below. That method also rejects any point within `MIN_RESPAWN_DIST_FROM_PLAYER_SPAWN` (26) of `this.spawnPoint`, so a respawning dummy can't land inside its own `MAX_FIRE_RANGE` of the player's fixed spawn (added this session — see below).
- `js/player.js` — fall damage (`FALL_DEATH_Y = -15`, flat 100 damage → respawn at spawn with full health, no game-over screen). Jump-buffer fix (jump press before landing still fires on landing) — confirmed working. Space-jump is bound globally (not gated by area) and confirmed working on all four surface types (main roof, HVAC deck, crane deck, bridge) — see cannon-es AABB bug below, which was silently breaking this on the decks/bridge until a prior session. Tracks `this.deaths`, incremented in `takeDamage()` whenever health hits 0 (any cause — fall damage or dummy fire — routes through this one path).
- `js/dummy.js` — guard-scan (turns toward a random yaw every 2-4s) + hitscan fire (`DUMMY_DAMAGE = 25`, `FIRE_COOLDOWN = 10s`, always hits if LOS clear — no miss chance). `MAX_FIRE_RANGE = 25`. On respawn (after `RESPAWN_DELAY = 3s`), a dummy moves to `level.getRandomSpawnPoint(RESPAWN_CLEARANCE_RADIUS)` — a random point on one of the three floor areas, inset from edges, clear of obstacles and of the player's spawn — instead of its original fixed spot, and plays `audio.playRespawn()`. Initial spawn positions (in `main.js`) are still fixed.
- `js/audio.js` — `playRespawn()`: sine tone at 65.41 Hz (C2), same envelope style as `playJump`/`playHit`.
- `js/weapons.js` — tracks `this.kills`, incremented in `fire()` when a raycast hit transitions a dummy from `hp > 0` to `hp === 0` (checked via a `wasAlive` snapshot before calling `dummy.takeDamage`, so repeated shots at an already-dead/respawning dummy don't double-count).
- `js/main.js` — owns match timing: `MATCH_DURATION = 90` (seconds), `timeLeft` counts down once `matchStarted` (set true the first time `player.isLocked` becomes true, i.e. first successful pointer lock — not page load). Never pauses if the player later loses pointer lock. `hud.update(timeLeft, timeLeft === 0)` is called every frame.
- `js/hud.js` / `index.html` — `#health-text`/`#ammo-text` spans hold the number; separate bar divs show percentage-width fill. `#timer` and `#kd` show the live countdown (`m:ss`) and `Kills / Deaths / K:D` ratio every frame, reading `weapons.kills` / `player.deaths` directly (no event needed, same pattern as the health bar). `#results` is hidden until `timeLeft` first hits 0, at which point HUD snapshots kills/deaths into it **once** (`this.resultsShown` guard) and never updates it again — kills/deaths keep counting live in `#kd` after that if the player keeps playing, but `#results` stays frozen at the match-end values. No game-over/lock-out — firing, movement, and dummy AI all keep running after time expires; only the results panel appears. No restart mechanism.

**Assumptions not confirmed with the user:** dummy damage (25) and no miss chance; dummy reuses `playGunshot()` rather than a distinct sound; `FALL_DEATH_Y`/`MAX_FIRE_RANGE` values (reasoned, not given); cover crate placement (reasoned from dummy eye height + LOS, not playtested); random dummy respawn only covers the three floor areas, not the bridge itself (thin diagonal connector, not treated as a spawn surface); match timer starts at first pointer-lock rather than page load and never pauses; "deaths" counts every health-zero event including fall damage, not just dummy kills; no restart/replay flow after results appear.

## Bug found + fixed this session: stale cannon-es AABBs broke raycasts off-origin

Every static body in `level.js` was built as `new CANNON.Body({...})` followed by `body.position.set(x, y, z)` (and, for ramps/bridge, `body.quaternion.set(...)`) *after* construction. cannon-es computes a body's broadphase AABB once, at construction time — so any body positioned via `.set()` afterward keeps an AABB baked at `(0,0,0)`, not its real position. Raycasts (e.g. `player.js`'s `_isGrounded()`, used by jump) get silently rejected against that body if the query doesn't happen to overlap the origin-centered AABB.

This is why jump only reliably worked on the main roof (its floor body happens to sit near the origin, masking the bug) and silently failed on the HVAC deck, crane deck, and bridge — exactly the platforms the user flagged. Confirmed via a raw `world.raycastClosest` probe: the HVAC deck floor body physically existed and the player visually rested on it, but the AABB reported was `[-10,10]`-ish around the origin instead of its true `x:[-30,-10]` bounds, so broadphase pruned it out of every raycast query away from the origin.

**Fix:** `_addBox`/`_addCylinder` now pass `position` (a `CANNON.Vec3`) directly into the `CANNON.Body` constructor options instead of setting it after. `_buildRamp`/`_buildBridge` (which also need quaternion, computed after construction) call `body.updateAABB()` explicitly right before `physics.addBody(body)`. If any future code in `level.js` constructs a body and repositions it after the fact, it needs the same treatment or this regresses.

## Verification (prior session — dummy respawn / jump-on-all-surfaces)

Reused a prior session's Playwright/Chromium install (npm deps live in the OS scratchpad, outside this project — still zero npm dependencies here). Script: `verify.js` in the scratchpad (`C:\Users\benju\AppData\Local\Temp\claude\c--Users-benju-OneDrive-CS-FPS1\<session-id>\scratchpad`) — drives the game via a temporary `window.__debug = { player, level, dummies, audio, camera }` hook added to `main.js` for the duration of the test, then reverted (not part of the shipped code).

- Confirmed jump (`_isGrounded()` + Space) fires correctly on all four surfaces: main roof, HVAC deck, crane deck, bridge midpoint — this is what surfaced the AABB bug above.
- Confirmed dummy respawn: dies → hides → respawns after 3s at full HP, at a new randomized position (on a valid floor area, clear of all obstacles per the rectangle test in `getRandomSpawnPoint`), with `playRespawn()` firing. Re-ran 5x total, no flakiness.
- Ran the full page load with no console/page errors.

## Verification (this session — K/D counter + 90s timer)

Same scratchpad/Playwright setup, same temporary `window.__debug` hook pattern (added, tested, reverted). Script: `verify_kd.js` in the scratchpad, alongside the still-passing `verify.js`.

- Confirmed live HUD (`#kd`, `#timer`) starts at `Kills: 0  Deaths: 0  K/D: 0.00` / `Time: 1:30`, `#results` starts hidden.
- Confirmed `weapons.kills` increments exactly once per dummy kill (aimed the camera at a dummy and called `weapons.fire()` 4x for 100 HP / 25 dmg, with `document.pointerLockElement` stubbed via `Object.defineProperty` since headless Chromium has no real pointer-lock gesture) and `player.deaths` increments exactly once per `takeDamage`-triggered respawn.
- **Found + fixed:** with the player idle at its fixed spawn for the real-time 90s wait, a dummy that randomly respawned within `MAX_FIRE_RANGE` (25) of the player's spawn point repeatedly sniped it, inflating `deaths` (1 → 3 over one run) — a direct consequence of last session's random-respawn feature not preserving the "clear of player spawn" property the original fixed dummy positions had (see `main.js`'s placement comment). Fixed via `MIN_RESPAWN_DIST_FROM_PLAYER_SPAWN` in `level.js` (see above); confirmed `deaths` stayed at 1 across the full 90s wait after the fix, and reran `verify.js` 3x to confirm the extra constraint didn't break normal respawn placement (still 11/11, no fallback-exhaustion issues).
- Waited out the real 90-second timer end-to-end: confirmed `#timer` reaches `Time: 0:00`, `#results` becomes visible with a frozen `Kills: 1 / Deaths: 1 / K/D: 1.00` snapshot matching what had happened before the wait.

**Not done:** real human playtesting. All checks above (both sessions) drove the player/dummies via direct state manipulation (teleporting bodies, dispatching keys, calling `takeDamage`/`fire` directly, stubbing `pointerLockElement`), not real mouse-driven aiming/movement — whether guard-scanning, cover placement, map scale, the random dummy respawn locations, and the new match-timer pacing actually *feel* right is still unverified. This remains the top outstanding item, alongside everything flagged in prior sessions (pointer lock engage, fall damage/respawn, bridge walkability, level geometry overlap audit, texture/HUD rendering) which was not re-verified this session since nothing touched those areas.

## Verification (this session — dummy wander/collision + shot tracers)

Reused the same scratchpad Playwright/Chromium install as prior sessions (`.../22b5076c-a471-4a65-9f3a-abbd28a2e8ad/scratchpad/pw`), same temporary `window.__debug` hook pattern in `main.js` (added, tested, reverted — not shipped). Scripts: `verify_wander_tracer.js` and a follow-up `verify_dummy_tracer2.js`, both in that scratchpad's `pw` folder.

- Confirmed a dummy transitions `idle` → `moving` and its position changes over a real 5s sample window (moved ~5.2 units), consistent with `WANDER_SPEED = 2`.
- Confirmed collision: teleported a dummy to x=3.8 next to the cover crate at `[6, 1, -16]` (half-extent 0.8) and forced a wander target through it (x=9); after 3s the dummy had stopped at x≈4.80 — flush against the crate's face (5.2 minus the dummy's 0.4 radius), not clipped through.
- Confirmed pause-while-engaged: with the player placed in LOS/range, a dummy's nonzero velocity was zeroed within 500ms and stayed at (0,0).
- Confirmed both fire paths spawn a tracer: dummy fire (sampled every `requestAnimationFrame` for up to 6 frames to catch it before the 0.15s fade) and player `weapons.fire()` (tracer count went 0→1 immediately, back to 0 after 400ms — confirms fade/cleanup too). Also confirmed dummy fire still correctly applies `DUMMY_DAMAGE` (`player.health` dropped 100→75 on one forced shot).
- No console/page errors across all runs.

**Not done:** real human playtesting of how wander speed/pausing/tracer feel in practice, and no check of wander behavior on the HVAC/crane decks or bridge specifically (only the main-roof dummy was driven) — `getAreaAt`'s smallest-match logic is reasoned from the area rectangles' geometry but not exercised on a deck in this verification pass.

## Done: dummy body-facing, gun offset, and player viewmodel gun (prior session's 3 queued items)

All three "Next steps" items from the prior handoff, implemented this session:

1. **Dummy body rotates to face the player** (`js/dummy.js`). `_updateLook` (called from `update()`) now takes `sight`/`player` params: while `sight` is truthy it computes `this.lookTargetYaw = Math.atan2(-dx, -dz)` (the yaw that points this codebase's "-Z is forward" convention at the player) every frame instead of picking a random guard-scan yaw; the existing turn-rate stepping (`LOOK_TURN_SPEED`, unchanged — reused rather than introducing a second speed constant) then turns the body toward it, same as it already did for guard-scan. When `sight` goes false it falls back to the normal randomized guard-scan behavior unchanged.
   - Needed a new `_angleDiff(a, b)` helper (wraps to `[-PI, PI]`) — the old `lookTargetYaw - facingYaw` subtraction was fine when guard-scan only ever picked targets within `±LOOK_ARC` (90°) of the current facing, but facing an arbitrary player position can require crossing the ±180° seam, and without wrapping the dummy would turn the long way around. `update()`'s `wasTurning` check was also switched to use `_angleDiff` for the same reason.
   - `_updateGunAim` (the gun's own `lookAt`-based slerp) needed no changes — it already computes world-space aim through the object hierarchy regardless of the parent body's rotation, so it keeps working as the body now also turns.
2. **Gun offset moved slight-right/forward**: `this.gunMesh.position` in the `Dummy` constructor, `(0.15, 0.1, -0.55)` → `(0.3, 0.1, -0.6)`. A judgment call, not a user-specified value (see below).
3. **Player first-person viewmodel gun + tracer origin fix** (`js/weapons.js`, one line in `js/main.js`). `Weapons._buildGunModel()` builds the same L-shaped barrel+grip look as the dummies' guns (visual consistency), scaled down, as a `THREE.Group` (`this.gunGroup`) added as a child of the camera at local offset `(0.25, -0.25, -0.5)` (bottom-right, forward) — camera/HUD-anchored, not physics-tracked, per the queued spec. `main.js` now does `scene.add(camera)` right after creating it (one comment-explained line) since three.js only renders what's reachable from the `scene` graph — without this the camera's child (the gun) would update but never actually draw. `fire()` now spawns the player's tracer from `this.gunGroup.localToWorld((0,0,-GUN_BARREL_LENGTH/2))` (the muzzle tip, after an explicit `updateMatrixWorld(true)` since `fire()` runs from a `mousedown` handler rather than inside the animate loop) instead of the raycaster's invisible ray origin; the aim raycast itself is untouched (still `raycaster.setFromCamera` from screen center), only the tracer's visual start point changed.

**Assumptions not confirmed with the user (reasoned defaults, flag if they feel off):** dummy body turn speed while facing the player reuses `LOOK_TURN_SPEED` (1.2 rad/s, the existing guard-scan pace) rather than a faster/instant turn — not explicitly asked, chosen for consistency/simplicity over introducing a second tuning knob; the gun offset's new exact values `(0.3, 0.1, -0.6)` are a modest nudge right/forward from the old `(0.15, 0.1, -0.55)`, not a precise "hand grip" position; the player viewmodel gun is a fully static mesh (no sway/bob/recoil animation, no muzzle flash) since none of those were requested and the prior handoff flagged sway/recoil as an open question rather than a spec; viewmodel gun size/offset (`barrel 0.06×0.06×0.35`, offset `(0.25, -0.25, -0.5)` from camera) are reasoned for a plausible-looking close-up FPS gun, not measured against a screenshot; the viewmodel uses ordinary depth-tested rendering (no second render pass/`depthTest: false` trick some FPS games use to prevent a viewmodel clipping into nearby walls) — matches this project's existing simple-materials approach but means standing very close to a wall could visually clip the gun into it.

**Verified via headless Playwright** (reused scratchpad Chromium install at `.../22b5076c-a471-4a65-9f3a-abbd28a2e8ad/scratchpad/pw`, temporary `window.__debug` hook in `main.js` added and reverted, script `verify_facing_and_gunmodel.js`):
- Confirmed `weapons.gunGroup` is a child of `camera` (so it's actually in the render graph via the new `scene.add(camera)`), positioned at the exact configured local offset, with 2 child meshes (barrel + grip).
- Fired once and compared the spawned tracer's start point to the gun's muzzle world position vs. the camera's world position: distance to muzzle ≈ 7.6e-7 (essentially exact), distance to camera ≈ 0.76 units — confirms the tracer now originates from the visible muzzle, not the old invisible camera-based origin.
- Placed the player 10 units along +X from a stationary dummy and let ~2s of real frames run: `dummy.facingYaw` (and `mesh.rotation.y`) converged from `0` to `≈-1.573` against an expected `-PI/2 ≈ -1.5708` (within ~0.002 rad — float/timing jitter from the discrete per-frame turn-rate step, not a systematic bug) — confirms the body actually turns to face the player instead of only the gun.
- Confirmed `dummy.gunMesh.position` reads the new `(0.3, 0.1, -0.6)`.
- No console/page errors.

**Not done:** real human playtesting of how the body-turn speed, new gun offset, and viewmodel gun position/size actually look and feel in motion — all three are the most likely candidates for follow-up tuning requests.

## Next steps (not started)

None queued by the user at the moment.
