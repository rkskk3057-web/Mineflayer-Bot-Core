import { useState, useEffect } from "react";
import { Users, Plus, X, Wifi, WifiOff, AlertCircle, Loader2, Trash2 } from "lucide-react";
import {
  useGetClones,
  useSpawnClone,
  useKillClone,
  useKillAllClones,
} from "@workspace/api-client-react";
import { Panel, PanelHeader, GameButton } from "./ui-gaming";

interface CloneBot {
  id: string;
  username: string;
  status: "connecting" | "online" | "offline" | "error";
  health: number;
  food: number;
  state: string;
  host: string;
  port: number;
}

function StatusIcon({ status }: { status: CloneBot["status"] }) {
  switch (status) {
    case "online":     return <Wifi className="w-3.5 h-3.5 text-green-400" />;
    case "connecting": return <Loader2 className="w-3.5 h-3.5 text-yellow-400 animate-spin" />;
    case "error":      return <AlertCircle className="w-3.5 h-3.5 text-red-400" />;
    default:           return <WifiOff className="w-3.5 h-3.5 text-zinc-500" />;
  }
}

const STATUS_COLOR: Record<string, string> = {
  online: "text-green-400",
  connecting: "text-yellow-400",
  error: "text-red-400",
  offline: "text-zinc-500",
};

export function ClonePanel() {
  const [clones, setClones] = useState<CloneBot[]>([]);
  const [customName, setCustomName] = useState("");

  const { data, refetch } = useGetClones();
  const spawn = useSpawnClone();
  const kill = useKillClone();
  const killAll = useKillAllClones();

  useEffect(() => {
    if (data?.clones) setClones(data.clones as CloneBot[]);
  }, [data]);

  useEffect(() => {
    const t = setInterval(() => { refetch(); }, 3000);
    return () => clearInterval(t);
  }, [refetch]);

  const handleSpawn = () => {
    spawn.mutate(
      { data: customName ? { username: customName } : {} },
      { onSuccess: () => { refetch(); setCustomName(""); } }
    );
  };

  const handleKill = (id: string) => {
    kill.mutate({ id }, { onSuccess: () => refetch() });
  };

  const handleKillAll = () => {
    killAll.mutate(undefined, { onSuccess: () => refetch() });
  };

  const onlineCount = clones.filter(c => c.status === "online").length;

  return (
    <Panel>
      <PanelHeader
        title="Clone Network"
        icon={Users}
        action={
          <span className="text-[10px] font-mono font-bold text-muted-foreground">
            {onlineCount} / 5
          </span>
        }
      />
      <div className="p-4 space-y-3">

        {/* Spawn */}
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Username prefix (optional)"
            value={customName}
            onChange={e => setCustomName(e.target.value)}
            className="flex-1 bg-black/50 border border-border rounded-lg px-3 py-2 font-mono text-xs focus:border-primary focus:outline-none"
          />
          <GameButton
            onClick={handleSpawn}
            disabled={spawn.isPending || onlineCount >= 5}
            className="px-3 py-2 text-xs gap-1"
          >
            <Plus className="w-3.5 h-3.5" />
            SPAWN
          </GameButton>
        </div>

        {/* List */}
        <div className="space-y-1.5">
          {clones.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4 border border-dashed border-border/50 rounded-lg">
              No clones active
            </p>
          ) : clones.map((clone) => (
            <div
              key={clone.id}
              className="flex items-center gap-2 bg-black/30 border border-border/50 rounded-lg px-3 py-2"
            >
              <StatusIcon status={clone.status} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono font-bold truncate">{clone.username}</span>
                  <span className={`text-[10px] font-mono uppercase ${STATUS_COLOR[clone.status]}`}>
                    {clone.status}
                  </span>
                </div>
                {clone.status === "online" && (
                  <div className="flex gap-3 mt-0.5">
                    <span className="text-[10px] text-muted-foreground font-mono">❤ {clone.health.toFixed(0)}</span>
                    <span className="text-[10px] text-muted-foreground font-mono">🍗 {clone.food.toFixed(0)}</span>
                    <span className="text-[10px] text-primary/70 font-mono uppercase">{clone.state}</span>
                  </div>
                )}
              </div>
              <button
                onClick={() => handleKill(clone.id)}
                className="p-1.5 rounded-lg hover:bg-red-500/20 text-muted-foreground hover:text-red-400 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>

        {/* Kill all */}
        {clones.length > 0 && (
          <button
            onClick={handleKillAll}
            className="w-full flex items-center justify-center gap-2 py-2 text-xs font-mono font-bold text-red-400 border border-red-500/30 rounded-lg hover:bg-red-500/10 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            TERMINATE ALL
          </button>
        )}
      </div>
    </Panel>
  );
}
