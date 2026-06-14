---
name: Client IP behind Replit proxy
description: How to derive a real, spoof-resistant client IP for apps served through Replit's edge.
---

# Deriving client IP on Replit

Replit's **public edge** (the `*.replit.dev` dev domain and published domains) overwrites any
client-supplied `X-Forwarded-For` with the genuine client IP, placing the real IP as the
**leftmost** entry. So with `app.set("trust proxy", true)`, reading the first `X-Forwarded-For`
entry (or `req.ip`) yields the real public IP and client spoofing via a forged XFF header is
ignored.

**Verified:** sending `X-Forwarded-For: 1.2.3.4` to the public dev domain stored the real public
IP (e.g. `136.x.x.x`), not `1.2.3.4`.

**Caveat:** the *internal* shared proxy at `localhost:80` does NOT sanitize XFF — a forged header
there is trusted. External users can't reach that path, so it only matters for local curl tests.

**Why:** matters for anti-multi-account / IP-dedup features. Trusting leftmost XFF is safe for
real traffic; don't over-engineer hop-counting.
