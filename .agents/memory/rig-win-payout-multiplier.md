---
name: Rigged win payout multiplier
description: Forced/rigged wins must pay the player's natural selection multiplier, not a flat 2x
---

# Rigged win payout multiplier

When a rig FORCES a win (game `forceOutcome:"win"`, global per-player rig
forceOutcome/winRatio, or per-player game override `outcome:"win"`), the payout
must use the multiplier the player's own bet would naturally pay — NOT a flat
fallback. Earlier code used `wager * (mult || 2)`, so an 8x color pick force-won
only paid 2x.

**Rule:** resolve the forced-win multiplier in this priority order:
1. An explicitly-configured, non-default rig multiplier (`> 0` and `!== 2`).
2. The natural multiplier for the player's selection, **checked by game type
   before the generic option-odds fallback** — config-driven types
   (number_pick/dice `config.odds`, crash `pick` target, jackpot
   `config.jackpot/wager`, blackjack `config.win_multiplier`, war
   `config.winMult`) resolve from config; option games fall to
   `parseFloat(selectedOpt.odds)`.
3. The pre-rig natural multiplier (`payout/wager`, captured BEFORE any rig branch
   mutates `won`/`payout`) — covers random-mult games (slots/wheel/plinko/etc.)
   that naturally won.
4. Last resort: the explicit value if positive, else 2.

**Why the sentinel 2:** the mod client only sends `forceWinMult` when it differs
from 2, and per-player/global override `mult` defaults to 2 in the form, so the
server cannot distinguish "deliberate 2x" from "unset". Treating 2 as "unset"
makes rigged wins honor real odds by default — the behavior users expect. A
deliberate 2x on a game whose natural odds differ is not expressible (accepted
tradeoff).

**Consistency:** `reconcileForRig` derives its visual `effMult` from
`payout/wager`, so corrected payouts automatically drive matching visuals — no
separate visual change needed.

**Where:** rigging block in `artifacts/api-server/src/routes/games.ts`
(`winMultFor` helper + `naturalMult` captured at block top). The per-option
`trueWinPct` branch already paid `selectedOpt.odds` correctly — leave it.
