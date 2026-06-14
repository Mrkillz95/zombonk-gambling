import { useState, useEffect } from "react";
import { useLocation, Link } from "wouter";
import { motion } from "framer-motion";
import {
  useCreateLobby,
  useJoinLobby,
  useGetActiveLobby,
  getGetActiveLobbyQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getStoredPlayer } from "@/lib/player-store";
import { useToast } from "@/hooks/use-toast";

export default function PartyPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const stored = getStoredPlayer();

  const [name, setName] = useState("");
  const [code, setCode] = useState("");

  const createMutation = useCreateLobby();
  const joinMutation = useJoinLobby();

  const { data: active } = useGetActiveLobby(
    { playerId: stored?.id ?? 0 },
    { query: { enabled: !!stored?.id, queryKey: getGetActiveLobbyQueryKey({ playerId: stored?.id ?? 0 }) } },
  );

  useEffect(() => {
    if (!stored) setLocation("/");
  }, []);

  if (!stored) return null;

  const handleCreate = () => {
    if (!name.trim()) {
      toast({ title: "Give your party a name", variant: "destructive" });
      return;
    }
    createMutation.mutate(
      { data: { hostId: stored.id, name: name.trim() } },
      {
        onSuccess: (res) => setLocation(`/party/${res.lobby.id}`),
        onError: (err: any) =>
          toast({ title: err?.data?.error ?? "Could not create party", variant: "destructive" }),
      },
    );
  };

  const handleJoin = () => {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) {
      toast({ title: "Enter a party code", variant: "destructive" });
      return;
    }
    joinMutation.mutate(
      { data: { playerId: stored.id, code: trimmed } },
      {
        onSuccess: (res) => setLocation(`/party/${res.lobby.id}`),
        onError: (err: any) =>
          toast({ title: err?.data?.error ?? "Could not join party", variant: "destructive" }),
      },
    );
  };

  return (
    <div className="min-h-screen bg-background p-6 max-w-xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <Link href="/lobby" className="text-sm text-muted-foreground hover:text-foreground" data-testid="link-back-lobby">
          ← Casino
        </Link>
        <span className="text-sm text-muted-foreground">{stored.name}</span>
      </div>

      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-3xl font-black mb-1">🎉 Party Tables</h1>
        <p className="text-muted-foreground mb-8">
          Play live with friends. One shared table, one outcome, everyone bets together.
        </p>
      </motion.div>

      {active && (
        <div className="mb-8 p-4 rounded-xl border border-primary/40 bg-primary/5 flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">You're already in a party</p>
            <p className="font-bold">{active.lobby.name}</p>
          </div>
          <Button data-testid="button-rejoin" onClick={() => setLocation(`/party/${active.lobby.id}`)}>
            Rejoin
          </Button>
        </div>
      )}

      <div className="grid gap-6">
        <section className="p-5 rounded-xl border border-border bg-card">
          <h2 className="font-bold mb-3">Host a new party</h2>
          <div className="flex gap-2">
            <Input
              data-testid="input-party-name"
              placeholder="Friday Night Casino"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            />
            <Button data-testid="button-create-party" onClick={handleCreate} disabled={createMutation.isPending}>
              {createMutation.isPending ? "…" : "Create"}
            </Button>
          </div>
        </section>

        <section className="p-5 rounded-xl border border-border bg-card">
          <h2 className="font-bold mb-3">Join with a code</h2>
          <div className="flex gap-2">
            <Input
              data-testid="input-party-code"
              placeholder="ABC123"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              maxLength={8}
              className="uppercase tracking-widest font-mono"
              onKeyDown={(e) => e.key === "Enter" && handleJoin()}
            />
            <Button data-testid="button-join-party" onClick={handleJoin} disabled={joinMutation.isPending} variant="secondary">
              {joinMutation.isPending ? "…" : "Join"}
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}
