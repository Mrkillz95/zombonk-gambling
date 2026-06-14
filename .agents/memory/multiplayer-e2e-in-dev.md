---
name: Testing multiplayer flows in dev
description: How to e2e-test features needing multiple distinct accounts despite one-account-per-IP.
---

# Testing multiplayer flows in dev

Registration enforces one account per IP, and in dev every browser/curl request collapses to a single client IP, so you CANNOT create two distinct accounts through the UI to test multiplayer.

**Workaround:** seed two test players directly in the DB (or once via curl with distinct `X-Forwarded-For`), then LOG IN as those existing accounts in two browser contexts (or two curl sessions). Login does not trigger the IP rule, so reuse seeded credentials to drive the login steps.

For lobby write actions you must capture the `sessionToken` from each login response and send it as `Authorization: Bearer <token>` — those endpoints reject calls whose token doesn't resolve to the acting player.

**Gotcha:** the testing agent's per-step time can exceed short server timers. A 15s betting window often elapses before the agent finishes one browser's actions and switches to the other — make windows generous and/or do not rely on tight wall-clock timing in test assertions.
