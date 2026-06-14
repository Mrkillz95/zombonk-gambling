import { useState } from "react";
import { useLocation } from "wouter";
import { useRegisterPlayer, useLoginPlayer, getGetPlayerQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getStoredPlayer, setStoredPlayer, setStoredToken, clearStoredPlayer } from "@/lib/player-store";
import { useToast } from "@/hooks/use-toast";

type Mode = "register" | "login";

export default function Home() {
  const [, setLocation] = useLocation();
  const [mode, setMode] = useState<Mode>("login");
  const [name, setName] = useState("");
  const [discordUser, setDiscordUser] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const stored = getStoredPlayer();

  const registerMutation = useRegisterPlayer();
  const loginMutation = useLoginPlayer();

  const isPending = registerMutation.isPending || loginMutation.isPending;

  const handleRegister = () => {
    const trimmedName = name.trim();
    const trimmedDiscord = discordUser.trim();
    if (!trimmedName || !password) return;
    if (password !== confirmPassword) {
      toast({ title: "Passwords don't match", variant: "destructive" });
      return;
    }
    registerMutation.mutate(
      { data: { name: trimmedName, discordUser: trimmedDiscord || undefined, password } },
      {
        onSuccess: (player) => {
          setStoredPlayer({ id: player.id, name: player.name });
          if (player.sessionToken) setStoredToken(player.sessionToken);
          queryClient.invalidateQueries({ queryKey: getGetPlayerQueryKey(player.id) });
          setLocation("/lobby");
        },
        onError: (err: any) => {
          const msg = err?.response?.data?.error ?? "Something went wrong";
          toast({ title: msg, variant: "destructive" });
        },
      }
    );
  };

  const handleLogin = () => {
    const trimmedName = name.trim();
    if (!trimmedName || !password) return;
    loginMutation.mutate(
      { data: { name: trimmedName, password } },
      {
        onSuccess: (player) => {
          setStoredPlayer({ id: player.id, name: player.name });
          if (player.sessionToken) setStoredToken(player.sessionToken);
          queryClient.invalidateQueries({ queryKey: getGetPlayerQueryKey(player.id) });
          setLocation("/lobby");
        },
        onError: (err: any) => {
          const msg = err?.response?.data?.error ?? "Invalid username or password";
          toast({ title: msg, variant: "destructive" });
        },
      }
    );
  };

  const handleContinue = () => setLocation("/lobby");

  const handleLogout = () => {
    clearStoredPlayer();
    window.location.reload();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      if (mode === "register") handleRegister();
      else handleLogin();
    }
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
            {/* Tabs */}
            <div className="flex bg-card border border-border rounded-xl overflow-hidden">
              <button
                className={`flex-1 py-3 text-sm font-semibold transition-colors ${mode === "login" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                onClick={() => { setMode("login"); setName(""); setPassword(""); setConfirmPassword(""); setDiscordUser(""); }}
                data-testid="tab-login"
              >
                Sign In
              </button>
              <button
                className={`flex-1 py-3 text-sm font-semibold transition-colors ${mode === "register" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                onClick={() => { setMode("register"); setName(""); setPassword(""); setConfirmPassword(""); setDiscordUser(""); }}
                data-testid="tab-register"
              >
                Create Account
              </button>
            </div>

            <div className="bg-card border border-border rounded-xl p-6 space-y-3">
              {mode === "login" ? (
                <>
                  <p className="text-muted-foreground text-sm">Sign in with your in-game username and password</p>
                  <Input
                    data-testid="input-name"
                    placeholder="In-game username"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={handleKeyDown}
                    className="h-11 bg-background border-border"
                    autoFocus
                  />
                  <Input
                    data-testid="input-password"
                    type="password"
                    placeholder="Password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={handleKeyDown}
                    className="h-11 bg-background border-border"
                  />
                </>
              ) : (
                <>
                  <p className="text-muted-foreground text-sm">Create a new player account</p>
                  <Input
                    data-testid="input-discord"
                    placeholder="Discord username (e.g. cooluser#1234)"
                    value={discordUser}
                    onChange={(e) => setDiscordUser(e.target.value)}
                    onKeyDown={handleKeyDown}
                    className="h-11 bg-background border-border"
                    autoFocus
                  />
                  <Input
                    data-testid="input-name"
                    placeholder="In-game username"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={handleKeyDown}
                    className="h-11 bg-background border-border"
                  />
                  <Input
                    data-testid="input-password"
                    type="password"
                    placeholder="Password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={handleKeyDown}
                    className="h-11 bg-background border-border"
                  />
                  <Input
                    data-testid="input-confirm-password"
                    type="password"
                    placeholder="Confirm password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    onKeyDown={handleKeyDown}
                    className="h-11 bg-background border-border"
                  />
                  <p className="text-xs text-muted-foreground">
                    Ask the mod for coins to get started
                  </p>
                </>
              )}
            </div>

            {mode === "login" ? (
              <Button
                className="w-full h-12 text-base font-semibold"
                onClick={handleLogin}
                disabled={!name.trim() || !password || isPending}
                data-testid="button-join"
              >
                {isPending ? "Signing in..." : "Sign In"}
              </Button>
            ) : (
              <Button
                className="w-full h-12 text-base font-semibold"
                onClick={handleRegister}
                disabled={!name.trim() || !password || isPending}
                data-testid="button-join"
              >
                {isPending ? "Creating..." : "Create Account"}
              </Button>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
