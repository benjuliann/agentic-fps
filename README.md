# Agentic FPS

A browser-based single-player FPS prototype built with three.js and cannon-es. You spawn on a multi-tier rooftop, fight back against armed dummy targets, and rack up kills before the clock runs out.

## How to play

Click the start screen to lock the pointer and begin. You have 90 seconds to get as many kills as possible while staying alive, dummies scan the area and shoot back, and falling off the roof is fatal.

| Action | Control |
| ------ | ------- |
| Move   | WASD    |
| Look   | Mouse   |
| Fire   | Click   |
| Reload | R       |
| Jump   | Space   |
| Sprint | Shift   |

Health, ammo, a live timer, and a kills/deaths/K:D readout are shown in the HUD. When the 90-second timer hits zero, a results panel appears with your final kills/deaths/K:D. The match itself keeps running (no lockout, no restart flow).

## Running it

No build step, no npm dependencies, it's a static site (`index.html` + `js/*.js`) that loads three.js and cannon-es from a CDN via an import map.

```
node server.js
```

Then open `http://localhost:8000`. (`server.js` is a bare Node dev server for local use only.)

## Development process: building a game from Markdown files

This project is an experiment in driving an entire game's implementation through a coding agent (Claude Code), using a small set of Markdown files as the interface between human intent and agent output, instead of writing the game code by hand:

- **[FEATURES.md](FEATURES.md)** — the original spec, written up front. It defines scope (what to build and what to explicitly leave out), states assumptions the agent should flag rather than silently resolve, lays out the file structure, and gives a manual verification checklist. This is what the agent implemented against.
- **[HANDOFF.md](HANDOFF.md)** — a running handoff document, rewritten each session. Since agent sessions don't share memory, this file carries forward everything a fresh session needs: where the implementation has deviated from FEATURES.md, what's currently in progress, unconfirmed assumptions, bugs found and fixed (with root cause), and what has and hasn't been verified yet. It's treated as the source of truth for current state whenever it disagrees with FEATURES.md.
- **[CLAUDE.md](CLAUDE.md)** — standing behavioral guidelines for the agent itself (think before coding, minimum-necessary changes, surgical edits, verify before declaring done), applied across every session regardless of task.

In practice, the loop looked like: read FEATURES.md and HANDOFF.md → do the next task → update HANDOFF.md with what changed, what was assumed, and what was verified (often via a scripted Playwright pass) → repeat in a new session. The result is that the Markdown files, not just the code, are the record of how the game was built, including the deviations, bugs, and unresolved assumptions along the way.

This wasn't a single "vibe coded" prompt-and-done process. Human judgment sat at each decision point, not just at the start. Design choices that deviated from the original spec (e.g. a multi-tier rooftop instead of a box room, armed dummies instead of static targets, the connecting bridge deliberately left without railings) were either directed or confirmed by a human, not picked unilaterally by the agent. Ambiguous or consequential calls (deploy target, project naming, whether a control belongs in the instructions) were surfaced as explicit questions rather than silently resolved. See the assumptions and open questions logged throughout HANDOFF.md. The Markdown files served as the record of that back-and-forth, not just a spec the agent executed against on its own.
