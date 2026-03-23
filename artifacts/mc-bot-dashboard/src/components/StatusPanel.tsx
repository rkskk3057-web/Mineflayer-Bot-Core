import { useGetBotStatus } from "@workspace/api-client-react";
import { Panel, PanelHeader } from "./ui-gaming";
import { Activity, Shield, Zap, Skull, Clock, Wifi } from "lucide-react";

function ProgressBar({ value, max, colorClass, label }: { value: number, max: number, colorClass: string, label: string }) {
  const percentage = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="space-y-1 w-full">
      <div className="flex justify-between text-xs font-bold font-display tracking-wider text-muted-foreground">
        <span>{label}</span>
        <span>{value} / {max}</span>
      </div>
      <div className="h-3 w-full bg-black/50 rounded-full overflow-hidden border border-border/30">
        <div 
          className={`h-full transition-all duration-500 ease-out ${colorClass}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

const stateColors = {
  IDLE: "bg-gray-500/20 text-gray-400 border-gray-500/50",
  FOLLOW: "bg-blue-500/20 text-blue-400 border-blue-500/50",
  GUARD: "bg-yellow-500/20 text-yellow-400 border-yellow-500/50",
  COMBAT: "bg-red-500/20 text-red-400 border-red-500/50",
  AUTONOMOUS: "bg-purple-500/20 text-purple-400 border-purple-500/50",
  DISCONNECTED: "bg-zinc-800 text-zinc-500 border-zinc-700",
};

export function StatusPanel() {
  const { data: status, isLoading } = useGetBotStatus({
    query: { refetchInterval: 5000 } // fallback fallback polling, main is socket
  });

  if (isLoading || !status) {
    return (
      <Panel className="h-64 animate-pulse bg-card/20 flex items-center justify-center">
        <div className="text-primary glow-text font-display font-bold">INITIALIZING SENSORS...</div>
      </Panel>
    );
  }

  const formatUptime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h}h ${m}m ${s}s`;
  };

  return (
    <Panel className="glow-box">
      <PanelHeader title="Tactical HUD" icon={Activity} />
      <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-6">
        
        {/* Vitals */}
        <div className="space-y-4">
          <ProgressBar 
            label="HEALTH" 
            value={status.health} 
            max={20} 
            colorClass="bg-gradient-to-r from-red-500 to-green-500" 
          />
          <ProgressBar 
            label="FOOD" 
            value={status.food} 
            max={20} 
            colorClass="bg-gradient-to-r from-yellow-600 to-orange-400" 
          />
          
          <div className="flex items-center justify-between pt-2">
             <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-bold">MODE:</span>
             </div>
             <span className={`px-2 py-0.5 rounded text-xs font-bold border ${stateColors[status.state]}`}>
               {status.state}
             </span>
          </div>
        </div>

        {/* Environmental Data */}
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-black/30 p-3 rounded-lg border border-white/5 flex flex-col items-center justify-center text-center">
            <Wifi className={`w-5 h-5 mb-1 ${status.ping < 100 ? 'text-green-400' : 'text-yellow-400'}`} />
            <span className="text-2xl font-mono font-bold">{status.ping}</span>
            <span className="text-[10px] text-muted-foreground font-display tracking-widest uppercase">Ping (ms)</span>
          </div>
          
          <div className="bg-black/30 p-3 rounded-lg border border-white/5 flex flex-col items-center justify-center text-center">
            <Skull className="w-5 h-5 mb-1 text-red-400" />
            <span className="text-2xl font-mono font-bold">{status.nearbyPlayers}</span>
            <span className="text-[10px] text-muted-foreground font-display tracking-widest uppercase">Entities Near</span>
          </div>

          <div className="bg-black/30 p-3 rounded-lg border border-white/5 flex flex-col items-center justify-center text-center">
            <Zap className="w-5 h-5 mb-1 text-purple-400" />
            <span className="text-lg font-mono font-bold mt-1">{status.cpuMode}</span>
            <span className="text-[10px] text-muted-foreground font-display tracking-widest uppercase">CPU Mode</span>
          </div>

          <div className="bg-black/30 p-3 rounded-lg border border-white/5 flex flex-col items-center justify-center text-center">
            <Clock className="w-5 h-5 mb-1 text-blue-400" />
            <span className="text-sm font-mono font-bold mt-1">{formatUptime(status.uptime)}</span>
            <span className="text-[10px] text-muted-foreground font-display tracking-widest uppercase">Uptime</span>
          </div>
        </div>

        {/* Target Lock */}
        {status.currentTarget && (
          <div className="col-span-1 md:col-span-2 bg-red-950/30 border border-red-500/30 p-3 rounded-lg flex items-center justify-between">
             <div className="flex items-center gap-3">
                <div className="relative flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
                </div>
                <span className="text-red-400 font-bold font-display uppercase tracking-widest text-sm">Target Locked</span>
             </div>
             <span className="font-mono text-white text-sm bg-black/50 px-3 py-1 rounded">{status.currentTarget}</span>
          </div>
        )}
      </div>
    </Panel>
  );
}
