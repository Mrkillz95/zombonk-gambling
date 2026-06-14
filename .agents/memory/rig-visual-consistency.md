---
name: Rigged outcome visual consistency
description: Why the server must regenerate game visuals after rigging, and which games recompute win/loss client-side.
---

# Rigged outcome visual consistency

The bet-play endpoint (`artifacts/api-server/src/routes/games.ts`) has a RIGGING LAYER that
overrides `won`/`payout`. The per-game logic above it builds `reels`/`details`/`message` for the
NATURAL result, so after rigging those visuals can contradict the forced `won` (e.g. a rigged
loss showing three matching 7s). A pure `reconcileForRig(...)` helper regenerates the visuals to
match the final `won`, called after the max-payout cap when `rigOverrode` is true.

**Why this matters:** the client (`artifacts/zombonk/src/pages/game.tsx`) does NOT just trust the
`won` flag for some games — it INDEPENDENTLY recomputes win/loss from the visual fields:
- slots → win = all reels equal
- scratch_card → win from allMatch/twoMatch derived from the 3 symbols
- crash → win = crashPoint >= target
- plinko → win = landed slot's multiplier > 1

So for those games the regenerated visuals must genuinely satisfy the predicate, not just carry a
`won` flag. Other games (over_under, hi_lo, roulette, etc.) drive the banner straight from `won`.

**How to apply:** any change to rigging or to a game's client render must keep server visuals and
the client's recompute in agreement. Guard degenerate admin configs (single-symbol slots,
<3 distinct scratch symbols, plinko with no winning/losing bucket) by injecting synthetic mismatch
symbols or falling back to the highest/lowest multiplier slot. `match_bet`/`trivia` are excluded —
they always render "PLACED" and are resolved later by a mod, so they have no win/loss animation.
