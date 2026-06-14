---
name: CSPRNG for game randomness
description: All random outcomes in Zombonk must use the CSPRNG helpers, never Math.random
---

# CSPRNG randomness

All randomness in the app uses cryptographically secure sources via drop-in
helpers, **never `Math.random()`**:

- Server: `secureRandom()` in `artifacts/api-server/src/lib/rng.ts`
  (Node `crypto.randomBytes`, 48-bit uniform float in `[0,1)`).
- Browser: `secureRandom()` in `artifacts/zombonk/src/lib/secure-random.ts`
  (Web Crypto `getRandomValues`, 53-bit uniform float in `[0,1)`).

**Rule:** any new random draw — especially anything that decides a game outcome
in `artifacts/api-server/src/routes/games.ts` — must call `secureRandom()`. The
helpers are exact drop-ins: `Math.floor(secureRandom() * n)` and
`secureRandom() < p` behave like the old `Math.random()` forms but are
unpredictable.

**Why:** this is a gambling app; `Math.random()` is a predictable PRNG and is
unfit for deciding outcomes. The user explicitly required CSPRNGs.

**How to apply:** import the package-local `secureRandom` and use it everywhere
randomness is needed. If you ever need exact-uniform integer buckets, add a
rejection-sampling `secureRandomInt(max)` rather than reaching for `Math.random`.
