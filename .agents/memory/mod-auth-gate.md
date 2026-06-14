---
name: Mod area auth gating
description: How the Zombonk moderator area is protected on client and server
---

# Mod auth gating

The moderator area (`/mod/dashboard`, `/mod/games`, `/mod/redeem`) is protected at
two layers:

- **Server (the real control):** every `/mod/*` route calls `checkAuth`, comparing
  the `x-mod-password` header to `MOD_PASSWORD`. This is the actual security
  boundary — data cannot be read or mutated without the correct password.
- **Client (UX gate):** a `ModGuard` wrapper (`src/components/mod-guard.tsx`) wraps
  the mod routes in `App.tsx`. It verifies the stored password server-side via the
  `useModAuth` (`/mod/auth`) hook before rendering, redirecting to `/mod` while
  missing/invalid (and clearing the stale value).

**Rule:** a client route guard must *verify* the password against the server, not
merely check that some value exists in `localStorage`. Presence-only checks plus a
post-render `useEffect` redirect let anyone reach the page (UI flash) and accept
stale/wrong stored values.

**Why:** the original gate only checked `getModPassword()` presence in a
post-render effect, so typing the URL directly exposed the dashboard shell. The
server still rejected the API calls, but the perceived bypass was a real UX/security
gap.

## IP allowlist (third layer)

Mod access can additionally be restricted to specific client IPs via the
`MOD_ALLOWED_IPS` env var (comma-separated). Enforced **centrally** by a single
Express middleware `modIpGate` in `lib/mod-auth.ts`, mounted as
`router.use("/mod", modIpGate)` in `routes/index.ts` **before** both `modRouter`
and `redemptionsRouter`.

**Rule:** never re-implement the IP check per-router. There are two routers
serving `/mod/*` paths (`mod.ts` and `redemptions.ts`); a per-file check left the
redemptions endpoints bypassable. The `/mod`-prefixed central gate is the single
source of truth — any new mod router added under `/mod/*` is covered automatically.

**Decisions:**
- Empty/unset `MOD_ALLOWED_IPS` = **fail-open to password-only** (no IP restriction).
  Deliberate, to avoid locking the admin out on misconfig. The var is set to the
  user's IP in the `shared` Replit env so it applies in dev + prod.
- Client IP comes from leftmost `x-forwarded-for` (spoof-safe on Replit's public
  edge; see `replit-client-ip.md`), normalized to strip the `::ffff:` IPv4-mapped
  IPv6 prefix before comparison.
