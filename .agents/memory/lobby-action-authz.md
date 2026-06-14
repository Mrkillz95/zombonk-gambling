---
name: Lobby action authorization
description: Why money/identity lobby actions need a session token, and the option-game UI/server contract for live rounds.
---

# Lobby action authorization & live-round option contract

## Money/identity actions must bind the caller to a token
The app otherwise has NO auth — every endpoint trusts a client-supplied `playerId`/`fromPlayerId` in the body. For single-player that only lets you affect your own account. But multiplayer added cross-account actions (peer transfers, chat-as, kick-on-leave) where a member could spoof another member's id to move/spend their balance or impersonate them.

**Rule:** login/register issue an opaque bearer session token (stored on the player row, rotated each login, returned only on auth responses). The client attaches it via the generated client's `setAuthTokenGetter`. Lobby write actions (transfer, bet, chat, leave, start-round) must verify the token resolves to exactly the acting player before mutating.

**Why:** a code review rejected the feature for broken access control — spoofable player ids on money-moving endpoints.

**How to apply:** any NEW endpoint that moves balance or acts as a specific player must call the caller-verification guard. GET/read endpoints stay open (consistent with the public getPlayer). The single-player `/games/play` is intentionally left as-is (pre-existing design; you can only spend your own balance).

## Balance mutations must be atomic (relative SQL arithmetic + guard), never read-then-set
Any endpoint that changes a player's `balance` must use a single conditional UPDATE with relative arithmetic — e.g. `UPDATE players SET balance = balance - $amount WHERE id = $id AND balance >= $amount` (in Drizzle: `.set({ balance: sql\`${playersTable.balance} - ${amount}\` })` with a `gte` guard) and check the `.returning()` row count before crediting the counterparty. Credits use `balance + $amount`. Wrap multi-row moves (transfer) in a transaction.

**Why:** a code review rejected the feature for an integrity flaw — the original read-then-set absolute writes (`set({ balance: from.balance - amount })`) let two concurrent transfers/bets from the same player both pass the funds check and last-write-wins, overspending or *minting* virtual currency.

**How to apply:** applies to lobby transfer, live-round bet debit, and round-payout credit. Verified with a concurrency test: 8 parallel transfers of ⌊balance/3⌋ → exactly 3 succeed, rest 400, total balance conserved, sender never negative. Add such a parallel-request test for any new balance-moving path.

## Option games: UI must follow the server's support rule, not a hardcoded type list
The bet UI decides whether to show the option-selection grid. Drive that from whether the round actually has options (`round.options.length > 0`), NOT a hardcoded set of game-type strings.

**Why:** the server accepts any option-weighted game as a live round, but a hardcoded UI allowlist (roulette/coin_flip/…) silently omitted others (baccarat, over_under, card_draw). Those rounds then sent no `optionId`, so the resolver matched no winner and everyone lost.

**How to apply:** keep the host picker filter and the bet-form option detection both keyed off options presence so they can never drift from the set the server resolves.
