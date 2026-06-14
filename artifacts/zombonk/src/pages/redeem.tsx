import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  useListRedemptionItems,
  useCreateRedemptionRequest,
  useGetPlayer,
  getGetPlayerQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getStoredPlayer } from "@/lib/player-store";
import { useToast } from "@/hooks/use-toast";

export default function RedeemPage() {
  const [, setLocation] = useLocation();
  const stored = getStoredPlayer();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  useEffect(() => { if (!stored) setLocation("/"); }, [stored]);

  const { data: player } = useGetPlayer(stored?.id ?? 0, {
    query: { enabled: !!stored?.id, queryKey: getGetPlayerQueryKey(stored?.id ?? 0) },
  });
  const { data: items, isLoading } = useListRedemptionItems();
  const requestMutation = useCreateRedemptionRequest();

  const [confirming, setConfirming] = useState<number | null>(null);
  const [submitted, setSubmitted] = useState<Set<number>>(new Set());

  const handleRequest = (itemId: number) => {
    if (!stored) return;
    requestMutation.mutate(
      { id: itemId, data: { playerId: stored.id } },
      {
        onSuccess: () => {
          setSubmitted((prev) => new Set(prev).add(itemId));
          setConfirming(null);
          queryClient.invalidateQueries({ queryKey: getGetPlayerQueryKey(stored.id) });
          toast({ title: "Request submitted! The moderator will fulfill it soon." });
        },
        onError: (err: any) => {
          setConfirming(null);
          toast({
            title: err?.data?.error ?? "Failed to submit request",
            variant: "destructive",
          });
        },
      }
    );
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50 backdrop-blur sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/lobby">
              <Button variant="ghost" size="sm" data-testid="link-lobby">← Lobby</Button>
            </Link>
            <span className="text-muted-foreground">/</span>
            <span className="font-bold text-foreground">Turn In Credits</span>
          </div>
          {player && (
            <Badge
              variant="outline"
              className="border-primary/40 text-primary font-mono font-bold"
              data-testid="text-balance"
            >
              {player.balance.toLocaleString()} coins
            </Badge>
          )}
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-black text-foreground">Turn In Credits</h1>
          <p className="text-muted-foreground text-sm">
            Spend your virtual coins on real-world rewards set by the moderator. Coins are deducted immediately and
            your request is sent to the mod for fulfillment.
          </p>
        </div>

        {isLoading && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-36 rounded-xl" />)}
          </div>
        )}

        {!isLoading && (!items || items.length === 0) && (
          <div className="bg-card border border-border rounded-xl p-12 text-center space-y-2">
            <div className="text-4xl mb-2">🎁</div>
            <p className="text-foreground font-semibold">No rewards available yet</p>
            <p className="text-muted-foreground text-sm">
              The moderator hasn't added any rewards. Check back later!
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {items?.map((item) => {
            const canAfford = (player?.balance ?? 0) >= item.cost;
            const isConfirming = confirming === item.id;
            const isDone = submitted.has(item.id);

            return (
              <div
                key={item.id}
                data-testid={`card-item-${item.id}`}
                className={`bg-card border rounded-xl p-5 flex flex-col gap-3 transition-colors ${
                  isDone
                    ? "border-primary/40 bg-primary/5"
                    : canAfford
                    ? "border-border hover:border-primary/40"
                    : "border-border opacity-60"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-bold text-foreground leading-snug">{item.name}</h3>
                  <Badge
                    variant="outline"
                    className="shrink-0 border-accent/40 text-accent font-mono font-bold"
                    data-testid={`text-cost-${item.id}`}
                  >
                    {item.cost.toLocaleString()} coins
                  </Badge>
                </div>

                {item.description && (
                  <p className="text-muted-foreground text-sm leading-relaxed flex-1">
                    {item.description}
                  </p>
                )}

                {isDone ? (
                  <div className="mt-auto flex items-center gap-2 text-primary text-sm font-semibold">
                    <span>✓</span>
                    <span>Request submitted!</span>
                  </div>
                ) : isConfirming ? (
                  <div className="mt-auto space-y-2">
                    <p className="text-xs text-muted-foreground">
                      Spend <span className="text-accent font-bold">{item.cost.toLocaleString()} coins</span> on "{item.name}"?
                    </p>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        className="flex-1"
                        onClick={() => handleRequest(item.id)}
                        disabled={requestMutation.isPending}
                        data-testid={`button-confirm-${item.id}`}
                      >
                        {requestMutation.isPending ? "Submitting…" : "Confirm"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setConfirming(null)}
                        data-testid={`button-cancel-${item.id}`}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    size="sm"
                    className="mt-auto"
                    variant={canAfford ? "default" : "outline"}
                    disabled={!canAfford}
                    onClick={() => setConfirming(item.id)}
                    data-testid={`button-redeem-${item.id}`}
                  >
                    {canAfford ? "Redeem" : `Need ${(item.cost - (player?.balance ?? 0)).toLocaleString()} more`}
                  </Button>
                )}
              </div>
            );
          })}
        </div>

        <p className="text-center text-xs text-muted-foreground">
          Coins are deducted immediately. If your request is denied, coins are refunded.
        </p>
      </div>
    </div>
  );
}
