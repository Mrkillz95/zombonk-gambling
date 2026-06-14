// Statistical detection of improbably lucky players ("too lucky" flagging).
//
// For each bet we estimate the win probability the player *should* have had,
// then compare their actual win count to that expectation with a binomial
// z-score. A large positive z-score (or a very long win streak) means their
// results are statistically improbable. Outcomes are decided server-side with a
// CSPRNG, so this is a review signal for mods, not proof of cheating — and
// because mods can deliberately "rig" players to win, flagged players carry a
// `rigged` flag so an explained streak isn't mistaken for an exploit.

export type BetRow = {
  won: boolean;
  wager: number;
  payout: number;
  optionOdds: number | null;
  optionTrueWinPct: number | null;
  gameType: string;
  gameConfig: Record<string, unknown> | null;
  createdAt: Date;
};

const MIN_P = 0.0001;
const MAX_P = 0.9999;
const clampP = (p: number): number => Math.min(MAX_P, Math.max(MIN_P, p));

// Below this many bets we don't trust the z-score (small samples swing wildly),
// so we fall back to win-streak detection only.
export const MIN_BETS_FOR_ZSCORE = 20;

export type Severity = "watch" | "suspicious" | "impossible";

/**
 * Expected win probability for a single bet.
 *
 * Prefers authoritative sources in order: the option's configured true win %,
 * then the option's payout odds, then a winning bet's realized multiplier, then
 * the game's configured odds, then per-type defaults. When in doubt we lean
 * toward a *higher* probability, which makes the test conservative (it under-
 * flags rather than falsely accusing a player).
 */
export function betWinProb(b: BetRow): number {
  if (b.optionTrueWinPct != null) return clampP(b.optionTrueWinPct / 100);
  if (b.optionOdds != null && b.optionOdds > 1) return clampP(1 / b.optionOdds);

  if (b.won && b.wager > 0 && b.payout > 0) {
    const m = b.payout / b.wager;
    if (m > 1) return clampP(1 / m);
  }

  const cfg = b.gameConfig ?? {};
  const cfgOdds = Number((cfg as Record<string, unknown>).odds);
  if (Number.isFinite(cfgOdds) && cfgOdds > 1) return clampP(1 / cfgOdds);

  switch (b.gameType) {
    case "coin_flip":
    case "over_under":
    case "color_pick":
      return 0.5;
    case "dice": {
      const sides = Number((cfg as Record<string, unknown>).sides) || 6;
      return clampP(1 / sides);
    }
    default:
      return 0.5;
  }
}

// erfc approximation (Abramowitz & Stegun 7.1.26), max error ~1.2e-7.
function erfc(x: number): number {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const r =
    t *
    Math.exp(
      -z * z -
        1.26551223 +
        t *
          (1.00002368 +
            t *
              (0.37409196 +
                t *
                  (0.09678418 +
                    t *
                      (-0.18628806 +
                        t *
                          (0.27886807 +
                            t *
                              (-1.13520398 +
                                t *
                                  (1.48851587 +
                                    t * (-0.82215223 + t * 0.17087277))))))))
    );
  return x >= 0 ? r : 2 - r;
}

// One-sided upper-tail probability P(Z >= z) for a standard normal.
export function upperTail(z: number): number {
  return 0.5 * erfc(z / Math.SQRT2);
}

export function oddsAgainstLabel(prob: number): string {
  if (!Number.isFinite(prob) || prob <= 0) return "1 in >1e15";
  const n = 1 / prob;
  if (n < 10) return `1 in ${n.toFixed(1)}`;
  if (n < 1e6) return `1 in ${Math.round(n).toLocaleString("en-US")}`;
  const exp = Math.floor(Math.log10(n));
  const mant = n / Math.pow(10, exp);
  return `1 in ${mant.toFixed(1)}e${exp}`;
}

export type FlagStats = {
  totalBets: number;
  wins: number;
  winRate: number;
  expectedWins: number;
  expectedWinRate: number;
  netProfit: number;
  totalWagered: number;
  roi: number;
  zScore: number;
  oddsAgainst: string;
  longestWinStreak: number;
  severity: Severity;
  severityRank: number;
  flagged: boolean;
};

export function computeFlagStats(bets: BetRow[]): FlagStats {
  const sorted = [...bets].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
  );

  let mu = 0;
  let varSum = 0;
  let wins = 0;
  let totalWagered = 0;
  let totalPayout = 0;
  let streak = 0;
  let longest = 0;
  // Probability of the current win streak, and the rarest (lowest-probability)
  // streak of length >= 2 seen so far. We score streaks by their combined
  // probability, not raw length, so a long run of high-win-chance bets isn't
  // treated as improbable.
  let streakProb = 1;
  let rarestStreakProb = 1;

  for (const b of sorted) {
    const p = betWinProb(b);
    mu += p;
    varSum += p * (1 - p);
    totalWagered += b.wager;
    totalPayout += b.payout;
    if (b.won) {
      wins++;
      streak++;
      if (streak > longest) longest = streak;
      streakProb *= p;
      if (streak >= 2 && streakProb < rarestStreakProb) {
        rarestStreakProb = streakProb;
      }
    } else {
      streak = 0;
      streakProb = 1;
    }
  }

  const n = sorted.length;
  const sd = Math.sqrt(varSum);
  const zScore = sd > 0 ? (wins - mu) / sd : 0;
  const netProfit = totalPayout - totalWagered;
  const winRate = n > 0 ? wins / n : 0;
  const expectedWinRate = n > 0 ? mu / n : 0;
  const roi = totalWagered > 0 ? netProfit / totalWagered : 0;
  const oddsAgainst = oddsAgainstLabel(upperTail(zScore));

  // 0 none, 1 watch, 2 suspicious, 3 impossible.
  let rank = 0;
  if (n >= MIN_BETS_FOR_ZSCORE) {
    if (zScore >= 6) rank = 3;
    else if (zScore >= 4.5) rank = 2;
    else if (zScore >= 3.5) rank = 1;
  }
  // Win-streak override catches short-but-improbable runs the z-score (which
  // needs a minimum sample) would miss. Scored by the streak's combined
  // probability, so only genuinely unlikely runs trip it.
  if (rarestStreakProb <= 1e-9) rank = Math.max(rank, 3);
  else if (rarestStreakProb <= 1e-6) rank = Math.max(rank, 2);
  else if (rarestStreakProb <= 1e-4) rank = Math.max(rank, 1);

  const severity: Severity =
    rank >= 3 ? "impossible" : rank >= 2 ? "suspicious" : "watch";

  return {
    totalBets: n,
    wins,
    winRate,
    expectedWins: mu,
    expectedWinRate,
    netProfit,
    totalWagered,
    roi,
    zScore,
    oddsAgainst,
    longestWinStreak: longest,
    severity,
    severityRank: rank,
    flagged: rank > 0,
  };
}
