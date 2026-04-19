import { useGetBotStatus } from "@workspace/api-client-react";
import { Panel, PanelHeader } from "./ui-gaming";
import {
  Activity, Wifi, MapPin, Swords, User, Shield,
  Clock, Users, Target, Zap,
} from "lucide-react";

function Bar({ value, max, color, label }: { value: number; max: number; color: string; label: string }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[10px] font-bold font-display tracking-widest text-muted-foreground">
        <span>{label}</span>
        <span className="tabular-nums">{value.toFixed(0)} / {max}</span>
      </div>
      <div className="h-2.5 w-full bg-black/60 rounded-full overflow-hidden border border-white/5">
        <div
          className={`h-full rounded-full transition-all duration-700 ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

const STATE_STYLE: Record<string, string> = {
  IDLE:         "bg-zinc-700/40 text-zinc-300 border-zinc-600",
  FOLLOW:       "bg-blue-500/20 text-blue-300 border-blue-500/60",
  GUARD:        "bg-yellow-500/20 text-yellow-300 border-yellow-500/60",
  COMBAT:       "bg-red-500/20 text-red-300 border-red-500/60 animate-pulse",
  AUTONOMOUS:   "bg-purple-500/20 text-purple-300 border-purple-500/60",
  DISCONNECTED: "bg-zinc-900 text-zinc-500 border-zinc-700",
};

const STATE_ICON: Record<string, string> = {
  IDLE: "●", FOLLOW: "↗", GUARD: "⬡", COMBAT: "⚔", AUTONOMOUS: "◈", DISCONNECTED: "○",
};

function Tile({ icon: Icon, value, label, accent = false }: {
  icon: React.ElementType; value: string | number; label: string; accent?: boolean;
}) {
  return (
    <div className={`bg-black/30 border rounded-lg p-3 flex flex-col items-center text-center gap-1 ${accent ? "border-primary/30" : "border-white/5"}`}>
      <Icon className={`w-4 h-4 ${accent ? "text-primary" : "text-muted-foreground"}`} />
      <span className="text-lg font-mono font-bold leading-none">{value}</span>
      <span className="text-[9px] font-display tracking-widest text-muted-foreground uppercase">{label}</span>
    </div>
  );
}

function formatUptime(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}h ${m}m ${sec}s`;
}

export function StatusPanel() {
  const { data: status } = useGetBotStatus({ query: { refetchInterval: 5000 } });

  if (!status) {
    return (
      <Panel className="h-48 flex items-center justify-center">
        <span className="text-muted-foreground font-mono text-sm animate-pulse">SYNCING SENSORS…</span>
      </Panel>
    );
  }

  const healthColor =
    status.health > 14 ? "bg-green-500" :
    status.health > 7  ? "bg-yellow-500" : "bg-red-500";

  const foodColor =
    status.food > 14 ? "bg-orange-400" :
    status.food > 7  ? "bg-yellow-500" : "bg-red-500";

  return (
    <Panel className="glow-box">
      <PanelHeader
        title="Tactical HUD"
        icon={Activity}
        action={
          <span className={`px-2 py-0.5 rounded border text-xs font-bold font-display tracking-widest ${STATE_STYLE[status.state] ?? STATE_STYLE.DISCONNECTED}`}>
            {STATE_ICON[status.state]} {status.state}
          </span>
        }
      />
      <div className="p-4 space-y-4">

        {/* Vital bars */}
        <div className="space-y-2.5">
          <Bar value={status.health} max={20} color={healthColor} label="HEALTH" />
          <Bar value={status.food}   max={20} color={foodColor}   label="FOOD"   />
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-4 gap-2">
          <Tile icon={Wifi}   value={status.ping}          label="Ping ms"  accent={status.ping < 100} />
          <Tile icon={Users}  value={status.nearbyPlayers}  label="Nearby"  />
          <Tile icon={Swords} value={status.kills}          label="Kills"   accent={status.kills > 0} />
          <Tile icon={Clock}  value={status.connected ? formatUptime(status.uptime) : "—"} label="Uptime" />
        </div>

        {/* Position */}
        {status.position && (
          <div className="bg-black/30 border border-white/5 rounded-lg p-2.5 flex items-center gap-3">
            <MapPin className="w-4 h-4 text-blue-400 shrink-0" />
            <div className="grid grid-cols-3 gap-2 w-full">
              {[["X", status.position.x], ["Y", status.position.y], ["Z", status.position.z]].map(([axis, val]) => (
                <div key={String(axis)} className="text-center">
                  <div className="text-[9px] text-muted-foreground font-display tracking-widest">{axis}</div>
                  <div className="font-mono text-sm font-bold">{Number(val).toFixed(1)}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Owner / Combat row */}
        <div className="grid grid-cols-3 gap-2 text-[10px] font-display tracking-widest font-bold">
          <div className={`flex items-center justify-center gap-1.5 rounded px-2 py-1.5 border ${status.ownerOnline ? "bg-green-500/10 border-green-500/40 text-green-400" : "bg-zinc-800/40 border-zinc-700 text-zinc-500"}`}>
            <User className="w-3 h-3" />
            {status.ownerOnline ? "OWNER ✓" : "OWNER —"}
          </div>
          <div className={`flex items-center justify-center gap-1.5 rounded px-2 py-1.5 border ${status.combatEnabled ? "bg-red-500/10 border-red-500/40 text-red-400" : "bg-zinc-800/40 border-zinc-700 text-zinc-500"}`}>
            <Shield className="w-3 h-3" />
            {status.combatEnabled ? "COMBAT ✓" : "COMBAT ✗"}
          </div>
          <div className={`flex items-center justify-center gap-1.5 rounded px-2 py-1.5 border ${status.autonomousMode ? "bg-purple-500/10 border-purple-500/40 text-purple-400" : "bg-zinc-800/40 border-zinc-700 text-zinc-500"}`}>
            <Zap className="w-3 h-3" />
            {status.autonomousMode ? "AUTO ✓" : "AUTO ✗"}
          </div>
        </div>

        {/* Target lock */}
        {status.currentTarget && (
          <div className="bg-red-950/40 border border-red-500/40 rounded-lg p-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="flex h-2 w-2 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
              </span>
              <Target className="w-3.5 h-3.5 text-red-400" />
              <span className="text-red-400 font-bold font-display text-[10px] tracking-widest">TARGET LOCKED</span>
            </div>
            <span className="font-mono text-sm text-white bg-black/50 px-2 py-0.5 rounded">{status.currentTarget}</span>
          </div>
        )}
      </div>
    </Panel>
  );
}
