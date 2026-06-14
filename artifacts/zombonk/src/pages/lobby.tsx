import { useLocation, Link } from "wouter";
import { useListGames, useGetRecentActivity, useGetPlayer, getGetPlayerQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { motion } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getStoredPlayer } from "@/lib/player-store";

const cardVariants = {
  hidden: { opacity: 0, y: 28, scale: 0.96 },
  show: { opacity: 1, y: 0, scale: 1, transition: { type: "spring" as const, stiffness: 280, damping: 22 } },
};

const feedVariants = {
  hidden: { opacity: 0, x: 30 },
  show: { opacity: 1, x: 0, transition: { type: "spring" as const, stiffness: 300, damping: 24 } },
};

const GAME_TYPE_LABELS: Record<string, string> = {
  slots: "Slot Machine",
  coin_flip: "Coin Flip",
  match_bet: "Match Bet",
  number_pick: "Number Pick",
  mystery_box: "Mystery Box",
};

const GAME_TYPE_ICONS: Record<string, string> = {
  slots: "SLOTS",
  coin_flip: "FLIP",
  match_bet: "BET",
  number_pick: "PICK",
  mystery_box: "BOX",
};

export default function Lobby() {
  const [, setLocation] = useLocation();
  const stored = getStoredPlayer();

  useEffect(() => {
    if (!stored) setLocation("/");
  }, [stored, setLocation]);

  const { data: games, isLoading: gamesLoading } = useListGames({ status: "open" });
  const { data: recent, isLoading: recentLoading } = useGetRecentActivity();
  const { data: player } = useGetPlayer(stored?.id ?? 0, {
    query: { enabled: !!stored?.id, queryKey: getGetPlayerQueryKey(stored?.id ?? 0) },
  });

  return (
    <div className="min-h-screen bg-background">
      {/* Top bar */}
      <header className="border-b border-border bg-card/50 backdrop-blur sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link href="/">
            <span className="text-xl font-black text-primary tracking-tighter cursor-pointer">ZOMBONK</span>
          </Link>
          <div className="flex items-center gap-4">
            {player && (
              <div className="flex items-center gap-2" data-testid="text-balance">
                <span className="text-muted-foreground text-sm">{player.name}</span>
                <Badge variant="outline" className="border-primary/40 text-primary font-mono font-bold">
                  {player.balance.toLocaleString()} coins
                </Badge>
              </div>
            )}
            <Link href="/party">
              <Button variant="ghost" size="sm" data-testid="link-party">🎉 Party</Button>
            </Link>
            <Link href="/redeem">
              <Button variant="ghost" size="sm" data-testid="link-redeem">🎁 Redeem</Button>
            </Link>
            <Link href="/history">
              <Button variant="ghost" size="sm" data-testid="link-history">History</Button>
            </Link>
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 py-8 grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Games grid */}
        <div className="lg:col-span-2 space-y-4">
          <h2 className="text-lg font-bold tracking-wide uppercase text-muted-foreground">
            Open Games
          </h2>

          {gamesLoading && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-36 rounded-xl" />
              ))}
            </div>
          )}

          {!gamesLoading && (!games || games.length === 0) && (
            <div className="bg-card border border-border rounded-xl p-8 text-center text-muted-foreground">
              No games open right now. Check back soon.
            </div>
          )}

          <motion.div
            className="grid grid-cols-1 sm:grid-cols-2 gap-4"
            initial="hidden"
            animate="show"
            variants={{ show: { transition: { staggerChildren: 0.07 } } }}
          >
            {games?.map((game) => (
              <motion.div
                key={game.id}
                variants={cardVariants}
                whileHover={{ y: -3, transition: { duration: 0.18 } }}
                whileTap={{ scale: 0.97 }}
                data-testid={`card-game-${game.id}`}
                className="bg-card border border-border rounded-xl p-5 flex flex-col gap-3 hover:border-primary/50 transition-colors cursor-pointer group"
                onClick={() => setLocation(`/game/${game.id}`)}
              >
                <div className="flex items-start justify-between">
                  <div className="bg-primary/10 border border-primary/20 rounded-lg px-2 py-1">
                    <span className="text-primary text-xs font-bold tracking-wider">
                      {GAME_TYPE_ICONS[game.type] ?? game.type.toUpperCase()}
                    </span>
                  </div>
                  <Badge variant="outline" className="border-green-500/30 text-green-400 text-xs">
                    OPEN
                  </Badge>
                </div>
                <div>
                  <h3 className="font-bold text-foreground group-hover:text-primary transition-colors">
                    {game.title}
                  </h3>
                  <p className="text-muted-foreground text-sm mt-0.5">
                    {GAME_TYPE_LABELS[game.type] ?? game.type}
                  </p>
                </div>
                <Button size="sm" className="mt-auto w-full" data-testid={`button-play-${game.id}`}>
                  Play Now
                </Button>
              </motion.div>
            ))}
          </motion.div>
        </div>

        {/* Recent activity */}
        <div className="space-y-4">
          <h2 className="text-lg font-bold tracking-wide uppercase text-muted-foreground">
            Live Feed
          </h2>
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            {recentLoading && (
              <div className="p-4 space-y-3">
                {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 rounded" />)}
              </div>
            )}
            {!recentLoading && (!recent || recent.length === 0) && (
              <div className="p-6 text-center text-muted-foreground text-sm">
                No bets yet. Be the first!
              </div>
            )}
            <motion.div
              className="divide-y divide-border"
              initial="hidden"
              animate="show"
              variants={{ show: { transition: { staggerChildren: 0.05 } } }}
            >
              {recent?.map((item) => (
                <motion.div
                  key={item.id}
                  variants={feedVariants}
                  data-testid={`row-activity-${item.id}`}
                  className="px-4 py-3 flex items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{item.playerName}</p>
                    <p className="text-xs text-muted-foreground truncate">{item.gameTitle}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className={`text-sm font-bold ${item.won ? "text-primary" : "text-destructive"}`}>
                      {item.won ? `+${item.payout}` : `-${item.wager}`}
                    </p>
                    <p className="text-xs text-muted-foreground">{item.won ? "WIN" : "LOSS"}</p>
                  </div>
                </motion.div>
              ))}
            </motion.div>
          </div>
        </div>
      </div>
    </div>
  );
}
