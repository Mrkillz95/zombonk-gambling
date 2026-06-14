# Zombonk

A non-real-money virtual casino: players bet virtual coins on a library of games. There are two play styles — interactive games with real mid-round decisions (Blackjack, Mines, Video Poker, Hi-Lo, Crash) and one-shot bet→resolve games (slots, roulette, baccarat, war, etc.) with staged reveal animations. A mod panel can edit odds and rig outcomes for the one-shot games.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/zombonk` — React + Vite frontend (player UI). `src/pages/game.tsx` = one-shot games + staged reveals; `src/pages/round-game.tsx` = interactive round games.
- `artifacts/api-server` — Express API. `src/routes/games.ts` = one-shot play + rig engine; `src/routes/rounds.ts` = interactive round engine.
- `lib/db` — Drizzle schema (source of truth for DB). `src/schema/rounds.ts` = interactive round state.
- `lib/api-spec/openapi.yaml` — API contract (source of truth); run codegen after edits.
- Generated client/zod live in `lib/api-client-react` and `lib/api-zod` — do not hand-edit generated files.

## Architecture decisions

- **Two execution paths.** One-shot games (`games.ts`) are riggable; interactive rounds (`rounds.ts`) deal with honest CSPRNG and intentionally do NOT apply the rig in v1 — forcing a player-decision game would break decision integrity.
- **Round money integrity.** Round start/action/resolve run in DB transactions with `FOR UPDATE` row locks, atomic balance deltas, and compare-and-set settlement (`WHERE status='active'`) so settles are idempotent and balances can't overdraw under concurrency.
- **Round state is private.** `GET /rounds/:roundId` requires `playerId` and returns 403 on mismatch (round IDs are enumerable).
- **No session auth on game calls.** `playerId` is passed explicitly in the request body/query (intentional for this app).
- **Server logging:** use `req.log` in handlers, never `console.log`.

## Product

Players sign in, receive virtual coins, and play casino games for entertainment (no real money, no cashout). Interactive games let players make real decisions each round; one-shot games resolve instantly with animated reveals. Mods can tune odds and rig one-shot outcomes.

## User preferences

- Games must be genuinely interactive where the genre calls for it (real hit/stand/reveal/cashout decisions), not one-click "bet → result". Non-decision games should still show staged reveal animations rather than an instant flash.
- Keep the dark casino theme.

## Gotchas

- **Orval barrel collision:** an endpoint with BOTH a path param and a query param makes the zod client emit a `<Op>Params` value and the types client a `<Op>Params` type, breaking the `@workspace/api-zod` barrel (TS2308). Fix by adding an explicit `export { <Op>Params } from "./generated/api";` after the `export *` lines in `lib/api-zod/src/index.ts`.
- After editing `openapi.yaml`, run `pnpm --filter @workspace/api-spec run codegen` (it also runs `typecheck:libs`).
- Verify artifacts with `pnpm --filter @workspace/<slug> run typecheck`, not `build` (build needs workflow-provided env).

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
