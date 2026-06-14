import { useState } from "react";
import { useLocation } from "wouter";
import { useGetOrCreatePlayer, getGetPlayerQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getStoredPlayer, setStoredPlayer, clearStoredPlayer } from "@/lib/player-store";
import { useToast } from "@/hooks/use-toast";

export default function Home() {
  const [, setLocation] = useLocation();
  const [name, setName] = useState("");
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const stored = getStoredPlayer();

  const joinMutation = useGetOrCreatePlayer();

  const handleJoin = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    joinMutation.mutate(
      { data: { name: trimmed } },
      {
        onSuccess: (player) => {
          setStoredPlayer({ id: player.id, name: player.name });
          queryClient.invalidateQueries({ queryKey: getGetPlayerQueryKey(player.id) });
          setLocation("/lobby");
        },
        onError: () => {
          toast({ title: "Something went wrong", variant: "destructive" });
        },
      }
    );
  };

  const handleContinue = () => setLocation("/lobby");

  const handleLogout = () => {
    clearStoredPlayer();
    window.location.reload();
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-md text-center space-y-8">
        <div className="space-y-2">
          <div className="text-6xl font-black tracking-tighter text-primary glow-primary inline-block">
            ZOMBONK
          </div>
          <div className="text-lg text-muted-foreground tracking-widest uppercase font-medium">
            Virtual Casino
          </div>
        </div>

        <div className="h-px bg-border" />

        {stored ? (
          <div className="space-y-4">
            <div className="bg-card border border-border rounded-xl p-6 space-y-2">
              <p className="text-muted-foreground text-sm">Welcome back,</p>
              <p className="text-2xl font-bold text-foreground">{stored.name}</p>
            </div>
            <Button className="w-full h-12 text-base font-semibold" onClick={handleContinue} data-testid="button-continue">
              Enter the Casino
            </Button>
            <Button variant="ghost" className="w-full text-muted-foreground" onClick={handleLogout} data-testid="button-logout">
              Switch Player
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="bg-card border border-border rounded-xl p-6 space-y-4">
              <p className="text-muted-foreground text-sm">Enter your player name to get started</p>
              <Input
                data-testid="input-name"
                placeholder="Your name..."
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleJoin()}
                className="h-12 text-center text-lg bg-background border-border"
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                Ask the mod for coins to get started
              </p>
            </div>
            <Button
              className="w-full h-12 text-base font-semibold"
              onClick={handleJoin}
              disabled={!name.trim() || joinMutation.isPending}
              data-testid="button-join"
            >
              {joinMutation.isPending ? "Joining..." : "Join the Game"}
            </Button>
          </div>
        )}

        <div className="text-xs text-muted-foreground">
          For entertainment purposes only. No real money involved.
        </div>
      </div>
    </div>
  );
}
