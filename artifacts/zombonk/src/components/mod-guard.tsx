import { useEffect, useState, type ReactNode } from "react";
import { Redirect } from "wouter";
import { useModAuth } from "@workspace/api-client-react";
import { getModPassword, clearModPassword } from "@/lib/player-store";

export default function ModGuard({ children }: { children: ReactNode }) {
  const password = getModPassword();
  const [status, setStatus] = useState<"checking" | "ok" | "fail">("checking");
  const authMutation = useModAuth();

  useEffect(() => {
    if (!password) {
      setStatus("fail");
      return;
    }
    let cancelled = false;
    setStatus("checking");
    authMutation.mutate(
      { data: { password } },
      {
        onSuccess: (res) => {
          if (cancelled) return;
          if (res.success) {
            setStatus("ok");
          } else {
            clearModPassword();
            setStatus("fail");
          }
        },
        onError: () => {
          if (cancelled) return;
          clearModPassword();
          setStatus("fail");
        },
      }
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [password]);

  if (status === "fail") return <Redirect to="/mod" />;

  if (status === "checking") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-sm text-muted-foreground uppercase tracking-widest">
          Verifying access…
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
