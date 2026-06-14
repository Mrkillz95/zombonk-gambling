---
name: Mod game-edit request/response nullability
description: Why mod game PATCH validation must accept null on option fields, and the empty-update crash guard
---

# Mod game edit contract pitfalls

Two recurring failure modes for `PATCH /api/mod/games/:id` (mod panel "edit game"):

## 1. Optional vs nullable mismatch
The GET/response schema returns option fields (`emoji`, `weight`, `imageUrl`,
`displayOdds`, `trueWinPct`) as **nullable**. When the client loads a game and
re-saves, it sends those values back **including explicit `null`**. If the
request schema marks them `.optional()` (undefined-only) instead of nullable,
Zod rejects the resave with a 400 ("Expected string, received null").

**Rule:** request/input schemas must accept `null` for any field the response can
emit as `null`. In OpenAPI use `type: ["string","null"]` (orval → `.nullish()`).
**Where:** `lib/api-spec/openapi.yaml` `GameOptionInput`; regenerate with
`pnpm --filter @workspace/api-spec run codegen`.

## 2. Empty Drizzle update crashes
The PATCH handler builds `updateData` from only `title/status/config`. An
options-only edit leaves it `{}`, and `db.update(...).set({})` throws
"No values to set" → 500. Guard: only run `.update().set()` when
`Object.keys(updateData).length > 0`; otherwise `select` the existing row before
replacing options.
