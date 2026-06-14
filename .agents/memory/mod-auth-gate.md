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
