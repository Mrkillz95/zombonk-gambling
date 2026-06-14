import { useState, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import { secureRandom } from "@/lib/secure-random";

// ── Crash Meter ───────────────────────────────────────────────────────────────
export function CrashMeter({ crashPoint, targetMult, won, onComplete }: {
  crashPoint: number; targetMult: number; won: boolean; onComplete: () => void;
}) {
  const [display, setDisplay] = useState(1.0);
  const duration = Math.min(4.0, 1.0 + crashPoint * 0.45);

  useEffect(() => {
    const start = performance.now();
    let id: number;
    const tick = (now: number) => {
      const t = Math.min((now - start) / 1000 / duration, 1);
      const eased = t < 1 ? 1 - Math.pow(1 - t, 2) : 1;
      setDisplay(1 + (crashPoint - 1) * eased);
      if (t < 1) { id = requestAnimationFrame(tick); }
      else { setTimeout(onComplete, 700); }
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, []);

  const progress = Math.min((display - 1) / Math.max(crashPoint - 1, 0.01), 1);
  const peaked = display >= crashPoint * 0.99;
  const crashedBefore = crashPoint < targetMult;

  return (
    <div className="space-y-3 py-2">
      <div className="text-center space-y-1">
        <motion.p
          className={`text-5xl font-black tabular-nums transition-colors ${
            peaked ? (won ? "text-primary" : "text-destructive") : "text-yellow-400"
          }`}
          animate={peaked ? { scale: [1, 1.18, 1] } : {}}
          transition={{ type: "spring", stiffness: 300, damping: 15 }}
        >
          {display.toFixed(2)}x
        </motion.p>
        <p className="text-xs text-muted-foreground">
          Your target: <span className="font-bold text-foreground">{targetMult}x</span>
        </p>
      </div>
      <div className="h-3 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${
            peaked && crashedBefore ? "bg-destructive" : "bg-yellow-400"
          }`}
          style={{ width: `${progress * 100}%` }}
        />
      </div>
      {peaked && (
        <motion.p
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className={`text-xs text-center font-bold ${won ? "text-primary" : "text-destructive"}`}
        >
          {won ? `✅ Survived to ${crashPoint}x!` : `💥 Crashed at ${crashPoint}x`}
        </motion.p>
      )}
    </div>
  );
}

// ── Win particles ───────────────────────────────────────────────────────────
export function WinParticles() {
  const particles = useMemo(() =>
    Array.from({ length: 14 }, (_, i) => ({
      id: i,
      angle: (i / 14) * 360 + (secureRandom() - 0.5) * 18,
      dist: 65 + secureRandom() * 70,
      delay: secureRandom() * 0.18,
      scale: 0.8 + secureRandom() * 0.7,
      sym: ["🪙", "⭐", "💰", "✨", "🎉"][i % 5],
    })), []
  );
  return (
    <div className="absolute inset-0 pointer-events-none flex items-center justify-center overflow-hidden">
      {particles.map(p => {
        const rad = (p.angle * Math.PI) / 180;
        return (
          <motion.span
            key={p.id}
            className="absolute text-xl select-none"
            initial={{ x: 0, y: 0, opacity: 1, scale: 0, rotate: 0 }}
            animate={{ x: Math.cos(rad) * p.dist, y: Math.sin(rad) * p.dist - 20, opacity: 0, scale: p.scale, rotate: p.angle }}
            transition={{ duration: 0.85, delay: p.delay, ease: [0.22, 0.61, 0.36, 1] }}
          >
            {p.sym}
          </motion.span>
        );
      })}
    </div>
  );
}

// ── Option button grid ─────────────────────────────────────────────────────
export function OptionGrid({ options, selected, onSelect, columns = 2 }: {
  options: any[]; selected: number | null; onSelect: (id: number) => void; columns?: number;
}) {
  return (
    <div className={`grid gap-2`} style={{ gridTemplateColumns: `repeat(${Math.min(columns, options.length)}, 1fr)` }}>
      {options.map((opt) => (
        <button
          key={opt.id}
          data-testid={`button-option-${opt.id}`}
          onClick={() => onSelect(opt.id)}
          className={`h-14 rounded-lg border-2 flex flex-col items-center justify-center font-bold transition-all px-2 ${selected === opt.id ? "border-primary bg-primary/15 text-primary" : "border-border bg-background text-foreground hover:border-primary/50"}`}
        >
          {opt.imageUrl && (
            <img src={opt.imageUrl} alt="" className="h-5 w-5 object-cover rounded mb-0.5"
              onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
          )}
          <span className="text-sm leading-tight text-center">{opt.label}</span>
          <span className="text-xs text-muted-foreground font-normal mt-0.5">{opt.displayOdds ?? `${opt.odds}x`}</span>
        </button>
      ))}
    </div>
  );
}

// ── Playing Card ───────────────────────────────────────────────────────────
export function PlayingCard({ face, suit, size = "md" }: { face: string; suit: string; size?: "sm" | "md" }) {
  const isRed = suit === "♥" || suit === "♦";
  const cls = size === "sm" ? "w-9 h-12 text-xs" : "w-12 h-16 text-sm";
  return (
    <div className={`${cls} bg-zinc-100 dark:bg-zinc-200 rounded border border-zinc-300 flex flex-col items-center justify-center gap-0.5 shadow-sm shrink-0`}>
      <span className={`font-black leading-none ${isRed ? "text-red-600" : "text-zinc-900"}`}>{face}</span>
      <span className={`leading-none ${size === "sm" ? "text-base" : "text-xl"} ${isRed ? "text-red-500" : "text-zinc-800"}`}>{suit}</span>
    </div>
  );
}
