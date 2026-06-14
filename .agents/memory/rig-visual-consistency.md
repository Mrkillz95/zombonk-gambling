---
name: Rigged outcome visual consistency
description: Why the server regenerates game visuals after rigging, what the client actually trusts, and why rigged visuals must be RANDOMIZED not deterministic.
---

# Rigged outcome visual consistency

The bet-play endpoint (`artifacts/api-server/src/routes/games.ts`) has a RIGGING LAYER that
overrides `won`/`payout`. The per-game logic above it builds `reels`/`details`/`message` for the
NATURAL result, so after rigging those visuals can contradict the forced `won` (e.g. a rigged
loss showing three matching 7s). A pure `reconcileForRig(...)` helper regenerates the visuals to
match the final `won`, called after the max-payout cap when `rigOverrode` is true.

**What the client actually trusts:** the client (`artifacts/zombonk/src/pages/game.tsx`) drives the
win/loss banner, screen flash, and every sub-component's `won` prop straight from `result.won`. It
does NOT recompute the outcome and flip it. The visual fields it derives locally — slots
`allMatch` (reels all equal), scratch `allMatch`/`twoMatch`, crash `crashedBefore` (crashPoint <
target), plinko ball landing in the slot — are COSMETIC (highlighting / animation only). So the
regenerated visuals must stay *cosmetically* consistent with `won` so the animation doesn't look
self-contradictory, but they never override the banner. (Earlier notes claimed the client
"independently recomputes win" — that was over-cautious; it's cosmetic, not a logic override.)

Constraints to keep visuals cosmetically aligned with `won`:
- slots → loss must NOT be all-equal; win is all-equal.
- scratch_card → loss needs 3 DISTINCT labels; win is all 3 equal.
- crash → win crashPoint >= target; loss crashPoint < target.
- plinko → win lands a slot with multiplier > 1; loss lands a slot with multiplier <= 1.

**Rigging must NOT be obvious — randomize among ALL valid candidates.** A deterministic visual pick
(e.g. forced plinko loss always landing slot 0, forced slots loss always the same two symbols)
makes rigging detectable across repeated plays. `reconcileForRig` therefore picks RANDOMLY among
every valid candidate: plinko loss = any slot with mult<=1, win = random among winning slots whose
mult is closest to effMult; slots loss = random non-all-equal reels; option games (coin_flip,
roulette, etc.) loss = random non-selected option; keno/mines/war/baccarat/blackjack randomize
draws/layouts/values; losing poker hands use `randomHighCardHand(n)`. Helpers: `pickRandom`,
`shuffle`, `randomHighCardHand`.

**Believability for WINS:** keep the displayed multiplier ≈ effMult (`payout/wager`) so the "won N
coins" message stays consistent — randomize only among candidates TIED at the closest multiplier.
Losses have payout 0, so their visuals can randomize freely.

**How to apply:** any change to rigging or a game's client render must keep server visuals
cosmetically agreeing with `won` AND keep them randomized across plays. Degenerate admin configs
(single-reel slots, <3 distinct scratch symbols, plinko with all mults >1 or all <=1) can't be made
fully consistent — they're best-effort fallbacks (closest extreme slot, synthetic mismatch symbol)
and don't occur with real configs. `match_bet`/`trivia` are excluded — they render "PLACED" and are
resolved later by a mod, so they have no win/loss animation.
