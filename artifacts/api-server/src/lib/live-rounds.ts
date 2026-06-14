import { secureRandom } from "./rng.js";

/**
 * Shared-outcome resolver for synchronized live rounds.
 *
 * Every member bets during a window, then the server resolves ONE outcome that
 * is broadcast to all players (a single roulette result, one crash curve, one
 * blackjack dealer hand). Per-player win/loss is derived from that shared
 * outcome — we never force a per-player outcome here, because that would
 * contradict the single visual everyone watches. Fairness still holds: outcomes
 * use the CSPRNG (secureRandom) and honor each option's editable weight/odds,
 * and every resulting bet is written to betsTable so the too-lucky flagging
 * pipeline sees live-round wins exactly like solo play.
 */

export interface RoundOption {
  id: number;
  label: string;
  odds: string;
  weight?: number | null;
}

export interface RoundBetInput {
  playerId: number;
  optionId?: number | null;
  pick?: string | null;
  wager: number;
}

export interface ResolvedBet {
  playerId: number;
  optionId: number | null;
  pick: string | null;
  wager: number;
  won: boolean;
  payout: number;
}

export interface RoundResolution {
  // Shared visual payload broadcast to all members and stored on the round.
  result: Record<string, unknown>;
  bets: ResolvedBet[];
}

function weightedPick(options: RoundOption[]): RoundOption {
  const total = options.reduce((s, o) => s + (Number(o.weight) > 0 ? Number(o.weight) : 1), 0);
  let r = secureRandom() * total;
  for (const o of options) {
    r -= Number(o.weight) > 0 ? Number(o.weight) : 1;
    if (r <= 0) return o;
  }
  return options[options.length - 1]!;
}

const CARD_FACES = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const CARD_SUITS = ["S", "H", "D", "C"];

function drawCard(): { face: string; suit: string; value: number } {
  const v = Math.floor(secureRandom() * 13);
  return {
    face: CARD_FACES[v]!,
    suit: CARD_SUITS[Math.floor(secureRandom() * 4)]!,
    value: v + 1,
  };
}

function bjValue(cards: { value: number }[]): number {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    if (c.value === 1) {
      aces++;
      total += 11;
    } else {
      total += Math.min(10, c.value);
    }
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return total;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Resolve a live round. `config` is the game config (for win multipliers etc).
 */
export function resolveRound(
  gameType: string,
  config: Record<string, unknown>,
  options: RoundOption[],
  bets: RoundBetInput[],
): RoundResolution {
  if (gameType === "crash") {
    // One shared crash point; each player picked a cashout target (pick).
    // Higher targets are rarer: exponential-ish curve from the CSPRNG.
    const u = Math.max(secureRandom(), 1e-9);
    const crashPoint = round2(Math.max(1, 1 / u) * 0.97);
    const resolved: ResolvedBet[] = bets.map((b) => {
      const target = parseFloat(b.pick ?? "");
      const valid = Number.isFinite(target) && target > 1;
      const won = valid && crashPoint >= target;
      const payout = won ? Math.floor(b.wager * target) : 0;
      return {
        playerId: b.playerId,
        optionId: null,
        pick: b.pick ?? null,
        wager: b.wager,
        won,
        payout,
      };
    });
    return { result: { kind: "crash", crashPoint }, bets: resolved };
  }

  if (gameType === "blackjack") {
    // Shared dealer hand; each player gets their own hand. Dealer hits to 17.
    const dealer = [drawCard(), drawCard()];
    while (bjValue(dealer) < 17) dealer.push(drawCard());
    const dealerTotal = bjValue(dealer);
    const dealerBust = dealerTotal > 21;
    const winMult = Number(config["win_multiplier"]) > 0 ? Number(config["win_multiplier"]) : 2;

    const playerHands: Record<number, { cards: typeof dealer; total: number }> = {};
    const resolved: ResolvedBet[] = bets.map((b) => {
      const hand = [drawCard(), drawCard()];
      while (bjValue(hand) < 17) hand.push(drawCard());
      const total = bjValue(hand);
      playerHands[b.playerId] = { cards: hand, total };
      const playerBust = total > 21;
      const won = !playerBust && (dealerBust || total > dealerTotal);
      const payout = won ? Math.floor(b.wager * winMult) : 0;
      return {
        playerId: b.playerId,
        optionId: null,
        pick: b.pick ?? null,
        wager: b.wager,
        won,
        payout,
      };
    });
    return {
      result: { kind: "blackjack", dealer, dealerTotal, dealerBust, playerHands },
      bets: resolved,
    };
  }

  // Default: option/weighted games (roulette, wheel, color_pick, coin_flip,
  // mystery_box, …). One shared winning option chosen by editable weights.
  const winner = options.length > 0 ? weightedPick(options) : null;
  const resolved: ResolvedBet[] = bets.map((b) => {
    const won = winner != null && b.optionId === winner.id;
    const odds = won ? parseFloat(winner!.odds) : 0;
    const payout = won && Number.isFinite(odds) ? Math.floor(b.wager * odds) : 0;
    return {
      playerId: b.playerId,
      optionId: b.optionId ?? null,
      pick: b.pick ?? null,
      wager: b.wager,
      won,
      payout,
    };
  });
  return {
    result: {
      kind: "option",
      winningOptionId: winner?.id ?? null,
      winningLabel: winner?.label ?? null,
    },
    bets: resolved,
  };
}
