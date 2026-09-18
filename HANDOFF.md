# HANDOFF.md

Status handoff for the next agent working on FPS1. Read [FEATURES.md](FEATURES.md) first — this file only covers where the project has **deviated** from that spec, plus current bugs/assumptions/verification status. FEATURES.md has not been updated to reflect these deviations; treat this file as the source of truth for scope until it is.

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
