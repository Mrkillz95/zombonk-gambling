---
name: Dev DB holds the user's real play data
description: The shared dev Postgres contains the user's actual players/balances — snapshot before destructive tests
---

# Dev DB holds real data

The dev `DATABASE_URL` Postgres for Zombonk contains the user's **real** players
and balances (e.g. a main account with tens of thousands of coins), not throwaway
fixtures. Some rows are genuine progress; others are prior test accounts (names
like `SmokeTest99`, `StartBalTest_*`).

**Rule:** before exercising any destructive/bulk mutation against it (e.g.
`set-all-balance`, mass deletes), `SELECT` and save the affected rows first so you
can restore exact values afterward. Prefer creating a fresh disposable player for
single-row tests, and delete it (and its bets, due to the FK) when done.

**Why:** a bulk `set-all-balance` test overwrote every player's balance to a flat
value, clobbering the real main account. Restoring required values captured
earlier in the session — anything not snapshotted (rows hidden by an earlier
`LIMIT`) could not be recovered.
