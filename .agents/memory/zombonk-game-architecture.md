---
name: Zombonk game architecture
description: Non-obvious, non-code-derivable constraints when adding/animating/removing Zombonk casino games.
---

# Zombonk game architecture — durable constraints

## Engine, UI, and DB are decoupled by game `type`
The Express engine and the React UI both already support ~25 game types, but a type is only *playable* if a DB `games` row of that type exists — there is no static seed baked into the app. Adding a game can be pure data (a row + options), not new code. The reproducible seed is `scripts/src/seed-games.ts` (idempotent by title, self-heals missing options, transactional).
**Why:** people assume "add a game" means writing engine/UI code; usually it just means creating the row. **How to apply:** before coding a new game, check whether the type is already supported and only missing a row.

## Play is one-shot and server-authoritative; playerId travels in the body
`POST /api/games/:id/play` resolves a bet in a single call — there is no interactive table flow (no real hit/stand or hold/draw); blackjack, video poker, etc. all resolve in one POST. `playerId` is sent **explicitly in the request body** (the client resolves it, the play endpoint does not infer it from IP).
**Why:** both facts are easy to get wrong and silently break tests or auth assumptions. **How to apply:** when testing plays or adding interactivity, account for the one-shot model and pass playerId explicitly.

## Rig + reconcile coupling (do NOT break)
After any rig override forces an outcome, the server regenerates the visual fields (reels/details/message) so the animation can never contradict the forced result. Game UI must render purely from the server response, never recompute win/loss locally in a way that could disagree with a rig.
**Why:** the casino's integrity depends on visuals always agreeing with the server outcome — a forced loss must never look like a win. **How to apply:** when adding or animating any game with win/loss visuals, drive the reveal from the server response only, and add a reconcile branch for the new type (mod-resolved types like match_bet/trivia are exempt — they render "PLACED").

## Removal safety
Never delete a `games` row that has bets — bets FK to it and history/flagging/stats depend on it. Retextured duplicates with real bet history must be kept (e.g. Color Pick). Only zero-bet pure duplicates are safe to remove.
