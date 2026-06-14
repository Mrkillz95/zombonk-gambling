import { useState } from "react";
import { useLocation } from "wouter";
import { useModAuth } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setModPassword } from "@/lib/player-store";
import { useToast } from "@/hooks/use-toast";

export default function ModLogin() {
  const [, setLocation] = useLocation();
  const [password, setPassword] = useState("");
  const { toast } = useToast();
  const authMutation = useModAuth();

  const handleLogin = () => {
    authMutation.mutate(
      { data: { password } },
      {
        onSuccess: (res) => {
          if (res.success) {
            setModPassword(password);
            setLocation("/mod/dashboard");
          } else {
            toast({ title: "Wrong password", variant: "destructive" });
          }
        },
        onError: () => {
          toast({ title: "Wrong password", variant: "destructive" });
        },
      }
    );
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center space-y-1">
          <div className="text-3xl font-black text-primary tracking-tighter">ZOMBONK</div>
          <div className="text-sm text-muted-foreground uppercase tracking-widest">Moderator Access</div>
        </div>

        <div className="bg-card border border-border rounded-xl p-6 space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground">Password</label>
            <Input
              data-testid="input-mod-password"
              type="password"
              placeholder="Enter mod password..."
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleLogin()}
              className="h-11"
              autoFocus
            />
          </div>
          <Button
            className="w-full h-11 font-semibold"
            onClick={handleLogin}
            disabled={!password || authMutation.isPending}
            data-testid="button-mod-login"
          >
            {authMutation.isPending ? "Verifying..." : "Access Dashboard"}
          </Button>
        </div>

        <div className="text-center">
          <a href="/" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            Back to game
          </a>
        </div>
      </div>
    </div>
  );
}
