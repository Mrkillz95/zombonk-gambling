/**
 * Cryptographically secure replacement for Math.random() (browser).
 * Returns a uniformly distributed float in [0, 1) using the Web Crypto API.
 * Drop-in substitute: any `Math.floor(secureRandom() * n)` keeps the same
 * distribution as before, but values are now drawn from a CSPRNG.
 */
export function secureRandom(): number {
  const buf = new Uint32Array(2);
  crypto.getRandomValues(buf);
  // Build a 53-bit mantissa from two 32-bit words: 27 high bits + 26 low bits.
  const hi = buf[0]! >>> 5; // 27 bits
  const lo = buf[1]! >>> 6; // 26 bits
  return (hi * 2 ** 26 + lo) / 2 ** 53;
}
