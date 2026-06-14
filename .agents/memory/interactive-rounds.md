---
name: Interactive game rounds (Zombonk)
description: Durable design decisions for stateful interactive games — the honesty/rig tradeoff and the escrow/settle integrity invariants.
---

# Two game execution paths

Zombonk resolves games two ways:
- **One-shot**: bet → resolve in a single call. This path APPLIES the rig system (forced outcomes / global rig / per-player overrides / streaks) and writes a `bets` row.
- **Interactive rounds**: multi-step stateful play (blackjack, mines, video_poker, hi_lo, crash) backed by a rounds table.

## Decision: interactive rounds are HONEST (rig NOT applied)
**Rule:** Interactive round games deal/draw with honest CSPRNG and do NOT apply the rig knobs. Only the one-shot path is riggable in v1.
**Why:** A game where the player makes mid-round decisions can't be deterministically forced without breaking decision integrity; v1 chose honesty for these 5 games. The user was told this explicitly.
**How to apply:** Don't expect mods to rig blackjack/mines/etc. until rig-at-deal (deck/mine stacking) is added. The other ~17 non-interactive games still rig via the one-shot path.

## Invariant: round money integrity (hard rule for any new round type)
**Rule:** Every round mutation that touches balance or status MUST run inside a DB transaction that takes a `FOR UPDATE` row lock (player row on start, round row on action), use atomic balance deltas (`balance = balance ± amount`), and resolve via compare-and-set (`WHERE status='active'`) so settlement is idempotent and single-shot.
**Why:** Without this, concurrent requests cause overdraw on start and double-settlement on action/poll — flagged as severe in review and fixed. Verified with parallel-request tests (exactly one settle; no overdraw).
**How to apply:** Reuse the existing `settle()` (CAS) + row-lock-then-recheck-`active` pattern when adding any new interactive game or resolve path. Driver is drizzle node-postgres at READ COMMITTED — correctness relies on row locks + conditional predicates, not serializable isolation.

## Gotcha: round state is private — GET must enforce ownership
The round-state GET requires a `playerId` and returns 403 on mismatch (round IDs are sequential/enumerable). Keep ownership checks on any endpoint that returns round state.

## Gotcha: orval barrel collision on path+query endpoints
An endpoint with BOTH a path param and a query param makes orval's zod client emit a `<Op>Params` value while the types client emits a `<Op>Params` type — the api-zod barrel then throws TS2308. Resolve by adding an explicit `export { <Op>Params } from "./generated/api"` after the two `export *` lines in the api-zod index barrel.
