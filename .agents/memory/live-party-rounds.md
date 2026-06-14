---
name: Live party round constraints
description: Which games can host a synchronized lobby round, and why the betting window is sized for humans.
---

# Live party rounds (shared synchronized tables)

## Only some games can host a live round
A live round resolves ONE shared outcome everyone bets against. A game qualifies only if:
- its type has a dedicated shared resolver: `crash` or `blackjack`, OR
- it is option-weighted with at least one game option (roulette, coin_flip, color_pick, card_draw, over_under, baccarat, mystery_box, …).

Games with no shared option and no dedicated resolver (slots, plinko, dice, number_pick, wheel, jackpot, keno, scratch_card, video_poker, mines, war, three_card_poker) must NOT be startable — the option resolver returns a null winner ("Winner —") and everyone loses.

**Why:** a host could otherwise start a round on e.g. slots and produce a meaningless round where no one can win.

**How to apply:** the start-round endpoint is authoritative — it loads the game's option count and rejects unsupported games (`isLiveRoundSupported(type, optionCount)`). The frontend host picker filters the same way using `game.options` from the games list (which includes options), but server validation is the real guard.

## Betting window is sized for multiple humans
The window must be long enough for several real players to read options and enter a wager before resolution. 15s was too short (a second player routinely missed the window); 30s works in two-player e2e. Keep it generous, not tight.
