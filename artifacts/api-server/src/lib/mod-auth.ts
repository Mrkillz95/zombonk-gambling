import type { Request, Response, NextFunction } from "express";

function normalizeIp(ip: string | null | undefined): string {
  if (!ip) return "";
  let v = ip.trim();
  // Normalize IPv4-mapped IPv6 (e.g. "::ffff:1.2.3.4") to plain IPv4.
  if (v.startsWith("::ffff:")) v = v.slice("::ffff:".length);
  return v;
}

// Optional IP allowlist for the entire mod area. Comma-separated list of allowed
// client IPs in MOD_ALLOWED_IPS. When empty/unset, no IP restriction is applied
// (mod access falls back to password-only).
const MOD_ALLOWED_IPS = (process.env.MOD_ALLOWED_IPS || "")
  .split(",")
  .map((s) => normalizeIp(s))
  .filter(Boolean);

export function getClientIp(req: {
  headers: Record<string, unknown>;
  ip?: string;
}): string | null {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length > 0) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.ip ?? null;
}

export function ipAllowed(req: {
  headers: Record<string, unknown>;
  ip?: string;
}): boolean {
  if (MOD_ALLOWED_IPS.length === 0) return true;
  const ip = normalizeIp(getClientIp(req));
  return !!ip && MOD_ALLOWED_IPS.includes(ip);
}

// Express middleware: blocks any request from a non-allowlisted IP before it
// reaches any mod route handler. Mount at the "/mod" path prefix.
export function modIpGate(req: Request, res: Response, next: NextFunction): void {
  if (!ipAllowed(req)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
}
