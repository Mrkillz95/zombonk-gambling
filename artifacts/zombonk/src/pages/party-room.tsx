import { useState, useEffect, useRef } from "react";
import { useParams, useLocation, Link } from "wouter";
import { AnimatePresence, motion } from "framer-motion";
import {
  useGetLobby,
  useListGames,
  useStartLobbyRound,
  usePlaceRoundBet,
  useSendLobbyChat,
  useTransferCoins,
  useLeaveLobby,
  getGetLobbyQueryKey,
} from "@workspace/api-client-react";
import type { LobbyRoundView, LobbyMemberView } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { getStoredPlayer } from "@/lib/player-store";
import { useToast } from "@/hooks/use-toast";
import { useLobbySocket } from "@/lib/lobby-socket";
import { CrashMeter, WinParticles, OptionGrid, PlayingCard } from "@/components/game-visuals";
import { useQueryClient } from "@tanstack/react-query";

const SUIT_SYMBOL: Record<string, string> = { S: "♠", H: "♥", D: "♦", C: "♣" };
const NUMBER_TYPES = new Set(["crash"]);
const LIVE_DEDICATED_TYPES = new Set(["crash", "blackjack"]);

// A game can host a live party round only if it has a dedicated shared resolver
// (crash, blackjack) or option-weighted outcomes everyone can bet on. Games with
// no shared option (slots, plinko, dice, …) are hidden from the host picker.
function isLiveRoundSupported(g: { type: string; options?: { id: number }[] }): boolean {
  return LIVE_DEDICATED_TYPES.has(g.type) || (g.options?.length ?? 0) > 0;
}

function fmt(n: number) {
  return n.toLocaleString();
}

export default function PartyRoomPage() {
  const { id } = useParams<{ id: string }>();
  const lobbyId = Number(id);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const stored = getStoredPlayer();

  const { connected } = useLobbySocket(Number.isFinite(lobbyId) ? lobbyId : null, stored?.id ?? null);

  const { data: lobby, isLoading, error } = useGetLobby(lobbyId, {
    query: {
      enabled: Number.isFinite(lobbyId),
      queryKey: getGetLobbyQueryKey(lobbyId),
      refetchInterval: 4000,
    },
  });

  const { data: games } = useListGames(
    { status: "open" },
    { query: { queryKey: ["/api/games", { status: "open" }] } },
  );

  const startRound = useStartLobbyRound();
  const placeBet = usePlaceRoundBet();
  const sendChat = useSendLobbyChat();
  const transfer = useTransferCoins();
  const leave = useLeaveLobby();

  const [chatInput, setChatInput] = useState("");
  const [selectedGameId, setSelectedGameId] = useState<number | null>(null);
  const [wager, setWager] = useState(50);
  const [selectedOptionId, setSelectedOptionId] = useState<number | null>(null);
  const [crashTarget, setCrashTarget] = useState("2.0");
  const [transferTo, setTransferTo] = useState<number | null>(null);
  const [transferAmt, setTransferAmt] = useState(50);
  const [now, setNow] = useState(Date.now());
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!stored) setLocation("/");
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lobby?.messages.length]);

  if (!stored) return null;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background p-6 max-w-5xl mx-auto">
        <Skeleton className="h-8 w-48 mb-4" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  if (error || !lobby) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-3">
        <p className="text-muted-foreground">This party isn't available anymore.</p>
        <Button onClick={() => setLocation("/party")} data-testid="button-back-party">Back to Parties</Button>
      </div>
    );
  }

  const me = lobby.members.find((m) => m.playerId === stored.id);
  const isHost = lobby.lobby.hostId === stored.id;
  const round = lobby.currentRound ?? null;
  const myBalance = me?.balance ?? 0;

  const leaderboard = [...lobby.members].sort((a, b) => b.balance - a.balance);

  const activity = buildActivity(lobby);

  const handleChat = () => {
    const body = chatInput.trim();
    if (!body) return;
    setChatInput("");
    sendChat.mutate(
      { id: lobbyId, data: { playerId: stored.id, body } },
      {
        onError: (err: any) => toast({ title: err?.data?.error ?? "Message failed", variant: "destructive" }),
      },
    );
  };

  const handleStartRound = () => {
    if (!selectedGameId) {
      toast({ title: "Pick a game first", variant: "destructive" });
      return;
    }
    startRound.mutate(
      { id: lobbyId, data: { playerId: stored.id, gameId: selectedGameId } },
      {
        onSuccess: () => {
          setSelectedOptionId(null);
          queryClient.invalidateQueries({ queryKey: getGetLobbyQueryKey(lobbyId) });
        },
        onError: (err: any) => toast({ title: err?.data?.error ?? "Could not start round", variant: "destructive" }),
      },
    );
  };

  const handleBet = () => {
    if (!round) return;
    if (wager <= 0 || wager > myBalance) {
      toast({ title: "Not enough coins", variant: "destructive" });
      return;
    }
    const isOption = (round.options?.length ?? 0) > 0;
    const isNumber = NUMBER_TYPES.has(round.gameType);
    if (isOption && !selectedOptionId) {
      toast({ title: "Choose a bet", variant: "destructive" });
      return;
    }
    placeBet.mutate(
      {
        id: lobbyId,
        roundId: round.id,
        data: {
          playerId: stored.id,
          wager,
          optionId: isOption ? selectedOptionId : undefined,
          pick: isNumber ? crashTarget : undefined,
        },
      },
      {
        onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetLobbyQueryKey(lobbyId) }),
        onError: (err: any) => toast({ title: err?.data?.error ?? "Bet failed", variant: "destructive" }),
      },
    );
  };

  const handleTransfer = () => {
    if (!transferTo || transferAmt <= 0) return;
    transfer.mutate(
      { id: lobbyId, data: { fromPlayerId: stored.id, toPlayerId: transferTo, amount: transferAmt } },
      {
        onSuccess: () => {
          setTransferTo(null);
          toast({ title: "Coins sent!" });
          queryClient.invalidateQueries({ queryKey: getGetLobbyQueryKey(lobbyId) });
        },
        onError: (err: any) => toast({ title: err?.data?.error ?? "Transfer failed", variant: "destructive" }),
      },
    );
  };

  const handleLeave = () => {
    leave.mutate(
      { id: lobbyId, data: { playerId: stored.id } },
      {
        onSuccess: () => setLocation("/party"),
        onError: () => setLocation("/party"),
      },
    );
  };

  return (
    <div className="min-h-screen bg-background p-4 md:p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <Link href="/party" className="text-sm text-muted-foreground hover:text-foreground" data-testid="link-parties">←</Link>
          <div>
            <h1 className="text-xl font-black leading-tight">{lobby.lobby.name}</h1>
            <p className="text-xs text-muted-foreground">
              Code <span className="font-mono font-bold text-foreground tracking-widest">{lobby.lobby.code}</span>
              <span className={`ml-2 ${connected ? "text-primary" : "text-muted-foreground"}`}>
                {connected ? "● live" : "○ reconnecting"}
              </span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="secondary" className="font-bold">🪙 {fmt(myBalance)}</Badge>
          <Button size="sm" variant="ghost" onClick={handleLeave} data-testid="button-leave">Leave</Button>
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        {/* Live table — spans 2 cols */}
        <div className="md:col-span-2 space-y-4">
          <LiveTable
            round={round}
            isHost={isHost}
            games={(games ?? []).filter(isLiveRoundSupported)}
            selectedGameId={selectedGameId}
            setSelectedGameId={setSelectedGameId}
            wager={wager}
            setWager={setWager}
            selectedOptionId={selectedOptionId}
            setSelectedOptionId={setSelectedOptionId}
            crashTarget={crashTarget}
            setCrashTarget={setCrashTarget}
            myId={stored.id}
            myBalance={myBalance}
            now={now}
            onStart={handleStartRound}
            onBet={handleBet}
            starting={startRound.isPending}
            betting={placeBet.isPending}
          />

          {/* Chat */}
          <section className="rounded-xl border border-border bg-card flex flex-col h-72">
            <div className="px-4 py-2 border-b border-border font-bold text-sm">💬 Chat</div>
            <div className="flex-1 overflow-y-auto px-4 py-2 space-y-1.5">
              {lobby.messages.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-6">Say hi to your party 👋</p>
              )}
              {lobby.messages.map((m) => (
                <div key={m.id} className="text-sm" data-testid={`chat-message-${m.id}`}>
                  <span className={`font-bold ${m.playerId === stored.id ? "text-primary" : "text-foreground"}`}>
                    {m.playerName}
                  </span>
                  <span className="text-muted-foreground">: </span>
                  <span className="break-words">{m.body}</span>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
            <div className="p-2 border-t border-border flex gap-2">
              <Input
                data-testid="input-chat"
                placeholder="Message…"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleChat()}
              />
              <Button size="sm" onClick={handleChat} data-testid="button-send-chat">Send</Button>
            </div>
          </section>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Roster */}
          <section className="rounded-xl border border-border bg-card">
            <div className="px-4 py-2 border-b border-border font-bold text-sm">
              👥 Players ({lobby.members.filter((m) => m.online).length}/{lobby.members.length} online)
            </div>
            <div className="p-2 space-y-1">
              {leaderboard.map((m, i) => (
                <div
                  key={m.playerId}
                  className="flex items-center justify-between px-2 py-1.5 rounded-lg hover:bg-muted/50"
                  data-testid={`member-${m.playerId}`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs w-4 text-muted-foreground">{i + 1}</span>
                    <span className={`h-2 w-2 rounded-full shrink-0 ${m.online ? "bg-primary" : "bg-muted-foreground/40"}`} />
                    <span className="text-sm truncate">
                      {m.name}
                      {m.isHost && <span className="ml-1 text-xs text-yellow-500">👑</span>}
                      {m.playerId === stored.id && <span className="ml-1 text-xs text-muted-foreground">(you)</span>}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-xs font-bold tabular-nums">🪙{fmt(m.balance)}</span>
                    {m.playerId !== stored.id && (
                      <button
                        className="text-xs text-primary hover:underline"
                        onClick={() => setTransferTo(m.playerId)}
                        data-testid={`button-send-${m.playerId}`}
                      >
                        send
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Activity feed */}
          <section className="rounded-xl border border-border bg-card">
            <div className="px-4 py-2 border-b border-border font-bold text-sm">📜 Activity</div>
            <div className="p-2 space-y-1 max-h-48 overflow-y-auto">
              {activity.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-4">No activity yet</p>
              )}
              {activity.map((a, i) => (
                <p key={i} className="text-xs text-muted-foreground" data-testid={`activity-${i}`}>
                  {a}
                </p>
              ))}
            </div>
          </section>
        </div>
      </div>

      {/* Transfer modal */}
      <AnimatePresence>
        {transferTo !== null && (
          <motion.div
            className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setTransferTo(null)}
          >
            <motion.div
              className="bg-card rounded-xl border border-border p-5 w-full max-w-xs"
              initial={{ scale: 0.95 }}
              animate={{ scale: 1 }}
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="font-bold mb-1">Send coins</h3>
              <p className="text-sm text-muted-foreground mb-4">
                to {lobby.members.find((m) => m.playerId === transferTo)?.name}
              </p>
              <Input
                type="number"
                data-testid="input-transfer-amount"
                value={transferAmt}
                onChange={(e) => setTransferAmt(Number(e.target.value))}
                min={1}
                max={myBalance}
                className="mb-4"
              />
              <div className="flex gap-2">
                <Button variant="ghost" className="flex-1" onClick={() => setTransferTo(null)}>Cancel</Button>
                <Button className="flex-1" onClick={handleTransfer} disabled={transfer.isPending} data-testid="button-confirm-transfer">
                  Send
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Live table ──────────────────────────────────────────────────────────────
function LiveTable(props: {
  round: LobbyRoundView | null;
  isHost: boolean;
  games: { id: number; title: string; type: string }[];
  selectedGameId: number | null;
  setSelectedGameId: (id: number) => void;
  wager: number;
  setWager: (n: number) => void;
  selectedOptionId: number | null;
  setSelectedOptionId: (id: number) => void;
  crashTarget: string;
  setCrashTarget: (s: string) => void;
  myId: number;
  myBalance: number;
  now: number;
  onStart: () => void;
  onBet: () => void;
  starting: boolean;
  betting: boolean;
}) {
  const { round, isHost, games, selectedGameId, setSelectedGameId, myId, now } = props;

  // No active round → lobby / start screen
  if (!round || round.status === "cancelled") {
    return (
      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="font-bold mb-1">🎲 Live Table</h2>
        <p className="text-sm text-muted-foreground mb-4">
          {isHost ? "Start a synchronized round — everyone bets, one shared outcome." : "Waiting for the host to start a round…"}
        </p>
        {isHost && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              {games.map((g) => (
                <button
                  key={g.id}
                  onClick={() => setSelectedGameId(g.id)}
                  data-testid={`button-game-${g.id}`}
                  className={`h-12 rounded-lg border-2 text-sm font-bold px-2 ${
                    selectedGameId === g.id ? "border-primary bg-primary/15 text-primary" : "border-border hover:border-primary/50"
                  }`}
                >
                  {g.title}
                </button>
              ))}
              {games.length === 0 && <p className="text-xs text-muted-foreground col-span-2">No open games available.</p>}
            </div>
            <Button className="w-full" onClick={props.onStart} disabled={props.starting} data-testid="button-start-round">
              {props.starting ? "Starting…" : "Start Round"}
            </Button>
          </div>
        )}
      </section>
    );
  }

  const secs = Math.max(0, Math.ceil((new Date(round.bettingEndsAt).getTime() - now) / 1000));
  const myBet = round.bets.find((b) => b.playerId === myId);

  // Betting window open
  if (round.status === "betting") {
    const isOption = (round.options?.length ?? 0) > 0;
    const isNumber = NUMBER_TYPES.has(round.gameType);
    return (
      <section className="rounded-xl border border-primary/40 bg-card p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold">🎲 {round.gameTitle}</h2>
          <Badge className="font-bold tabular-nums" variant={secs <= 5 ? "destructive" : "secondary"}>
            ⏱ {secs}s
          </Badge>
        </div>

        {myBet ? (
          <div className="text-center py-6 space-y-1">
            <p className="text-3xl">✅</p>
            <p className="font-bold">Bet placed: 🪙{fmt(myBet.wager)}</p>
            <p className="text-sm text-muted-foreground">Waiting for the round to resolve…</p>
          </div>
        ) : (
          <div className="space-y-3">
            {isOption && (
              <OptionGrid
                options={round.options ?? []}
                selected={props.selectedOptionId}
                onSelect={props.setSelectedOptionId}
              />
            )}
            {isNumber && (
              <div>
                <label className="text-xs text-muted-foreground">Cash-out target (x)</label>
                <Input
                  type="number"
                  step="0.1"
                  min="1.1"
                  data-testid="input-crash-target"
                  value={props.crashTarget}
                  onChange={(e) => props.setCrashTarget(e.target.value)}
                />
              </div>
            )}
            <div>
              <label className="text-xs text-muted-foreground">Wager</label>
              <Input
                type="number"
                data-testid="input-wager"
                value={props.wager}
                onChange={(e) => props.setWager(Number(e.target.value))}
                min={1}
                max={props.myBalance}
              />
            </div>
            <Button className="w-full" onClick={props.onBet} disabled={props.betting} data-testid="button-place-bet">
              {props.betting ? "Placing…" : `Bet 🪙${fmt(props.wager)}`}
            </Button>
          </div>
        )}

        {round.bets.length > 0 && (
          <div className="mt-4 pt-3 border-t border-border">
            <p className="text-xs text-muted-foreground mb-1">In this round ({round.bets.length})</p>
            <div className="flex flex-wrap gap-1.5">
              {round.bets.map((b) => (
                <Badge key={b.playerId} variant="outline" className="text-xs">
                  {b.playerName} · 🪙{fmt(b.wager)}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </section>
    );
  }

  // Resolved → show shared outcome
  return <ResolvedTable round={round} myId={myId} />;
}

// ── Resolved outcome ────────────────────────────────────────────────────────
function ResolvedTable({ round, myId }: { round: LobbyRoundView; myId: number }) {
  const result = (round.result ?? {}) as any;
  const myBet = round.bets.find((b) => b.playerId === myId);
  const kind = result.kind as string | undefined;

  return (
    <section className="relative rounded-xl border border-border bg-card p-5 overflow-hidden">
      {myBet?.won && <WinParticles />}
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-bold">🎲 {round.gameTitle}</h2>
        <Badge variant="outline">Resolved</Badge>
      </div>

      {/* Shared outcome visual */}
      <div className="mb-4">
        {kind === "crash" && (
          <CrashMeter
            crashPoint={Number(result.crashPoint) || 1}
            targetMult={myBet?.pick ? parseFloat(myBet.pick) : 2}
            won={!!myBet?.won}
            onComplete={() => {}}
          />
        )}
        {kind === "option" && (
          <div className="text-center py-4">
            <p className="text-sm text-muted-foreground">Winner</p>
            <p className="text-2xl font-black text-primary">{result.winningLabel ?? "—"}</p>
          </div>
        )}
        {kind === "blackjack" && (
          <BlackjackResult result={result} myId={myId} />
        )}
      </div>

      {/* My result */}
      {myBet && (
        <div
          className={`rounded-lg p-3 text-center mb-3 ${
            myBet.won ? "bg-primary/10 text-primary" : myBet.payout > 0 ? "bg-yellow-400/10 text-yellow-500" : "bg-destructive/10 text-destructive"
          }`}
          data-testid="my-result"
        >
          <p className="font-bold">
            {myBet.won ? `You won 🪙${fmt(myBet.payout)}!` : myBet.payout > 0 ? `Partial return 🪙${fmt(myBet.payout)}` : `You lost 🪙${fmt(myBet.wager)}`}
          </p>
        </div>
      )}

      {/* Everyone's results */}
      <div className="space-y-1">
        {round.bets.map((b) => (
          <div key={b.playerId} className="flex items-center justify-between text-sm px-1" data-testid={`result-${b.playerId}`}>
            <span>{b.playerName}</span>
            <span className={b.won ? "text-primary font-bold" : "text-muted-foreground"}>
              {b.won ? `+🪙${fmt(b.payout)}` : `-🪙${fmt(b.wager)}`}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function BlackjackResult({ result, myId }: { result: any; myId: number }) {
  const dealer: { face: string; suit: string }[] = result.dealer ?? [];
  const myHand = result.playerHands?.[myId] as { cards: { face: string; suit: string }[]; total: number } | undefined;
  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs text-muted-foreground mb-1">Dealer · {result.dealerTotal}{result.dealerBust ? " (bust)" : ""}</p>
        <div className="flex gap-1.5 flex-wrap">
          {dealer.map((c, i) => (
            <PlayingCard key={i} face={c.face} suit={SUIT_SYMBOL[c.suit] ?? c.suit} size="sm" />
          ))}
        </div>
      </div>
      {myHand && (
        <div>
          <p className="text-xs text-muted-foreground mb-1">Your hand · {myHand.total}</p>
          <div className="flex gap-1.5 flex-wrap">
            {myHand.cards.map((c, i) => (
              <PlayingCard key={i} face={c.face} suit={SUIT_SYMBOL[c.suit] ?? c.suit} size="sm" />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Activity feed builder ───────────────────────────────────────────────────
function buildActivity(lobby: { members: LobbyMemberView[]; transfers: { fromName: string; toName: string; amount: number }[]; currentRound?: LobbyRoundView | null }): string[] {
  const items: string[] = [];
  for (const t of lobby.transfers.slice(0, 6)) {
    items.push(`💸 ${t.fromName} sent 🪙${fmt(t.amount)} to ${t.toName}`);
  }
  const round = lobby.currentRound;
  if (round && round.status === "resolved") {
    for (const b of round.bets) {
      if (b.won) items.push(`🎉 ${b.playerName} won 🪙${fmt(b.payout)} on ${round.gameTitle}`);
    }
  }
  return items;
}
