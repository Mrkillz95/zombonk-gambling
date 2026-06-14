import { randomBytes } from "node:crypto";

/**
 * Cryptographically secure replacement for Math.random().
 * Returns a uniformly distributed float in [0, 1) using 48 bits of CSPRNG
 * entropy. This is a drop-in substitute: any `Math.floor(secureRandom() * n)`
 * keeps the same distribution as before, but outcomes are now unpredictable.
 */
export function secureRandom(): number {
  const buf = randomBytes(6); // 48 bits of entropy
  let v = 0;
  for (let i = 0; i < buf.length; i++) {
    v = v * 256 + buf[i]!;
  }
  return v / 2 ** 48;
}
