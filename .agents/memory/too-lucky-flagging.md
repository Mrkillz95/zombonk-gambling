---
name: Too-lucky player flagging
description: How improbable-win detection works and the invariants to preserve
---

# Too-lucky flagging

Detects statistically improbable winners for mod review (endpoint
`GET /mod/flagged-players`, UI section on the mod dashboard). Logic lives in
`artifacts/api-server/src/lib/flagging.ts`.

Method: per bet, estimate the win probability the player *should* have had
(`betWinProb`), then a binomial/Poisson-binomial z-score over their bets, plus a
**probability-aware** win-streak override.

**Rules / invariants worth preserving:**
- `betWinProb` is deliberately biased toward a *higher* p (prefers true win %,
  then 1/odds, then realized multiplier, then config odds, then per-type
  defaults). Overestimating p makes the test *under-flag* — the right bias for an
  accusation feature.
- The streak override must stay **probability-based** (combined p of the run),
  never raw streak length. A long run of high-win-chance bets is NOT improbable;
  flagging it by length alone causes false accusations.
- Always surface the `rigged` flag (player.globalRig set). Mods can force wins, so
  rigged players are *expected* to appear flagged — that isn't an exploit.

**Why:** outcomes are server-side CSPRNG, so players can't actually rig results;
this is a review signal, not proof of cheating. Framing it as "explained when
rigged" + conservative p estimation avoids falsely accusing legitimate players.

**How to apply:** when adding new game types, give them a sensible default in
`betWinProb`'s switch (or rely on game `config.odds`). When changing the response
shape, remember the dashboard invalidates `getModListFlaggedPlayersQueryKey()`
after player mutations to keep the panel fresh.
