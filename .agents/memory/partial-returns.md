---
name: Partial returns (won vs payout decoupling)
description: In Zombonk, payout is independent of the won flag; UI must surface won=false & payout>0 as a partial return
---

# Partial returns

`won` and `payout` are independent in the play handler. The balance is always
credited `newBalance = balance - wager + payout` regardless of `won`, so a bet
can lose (`won=false`) yet return coins (`payout>0`).

Cases where `won=false` but `payout>0`:
- **plinko** — `won = multiplier > 1`, so any sub-1x slot (e.g. 0.3x, 0.5x)
  returns partial coins while `won` is false.
- **blackjack push** — `won=false`, `payout=wager` (full wager returned).
- Any mod-configured game whose outcome multiplier is between 0 and 1.

**Rule:** UI must treat `!result.won && result.payout > 0` as a distinct
"partial return" state (show the returned coins, neutral/amber styling) — never
as a total loss. Keying off this universal condition makes the display fix
game-agnostic; don't special-case per game type.

**Why:** users reported "partial returns don't work on plinko" — the coins were
actually credited server-side, but the result panel only showed payout when
`won` was true and otherwise rendered "LOSS", hiding the returned coins.
