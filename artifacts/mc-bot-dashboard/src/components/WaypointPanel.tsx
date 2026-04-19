import { useState, useEffect } from "react";
import { MapPin, Plus, Trash2, Play, ChevronDown, ChevronUp } from "lucide-react";
import {
  useGetWaypoints,
  useAddWaypoint,
  useClearWaypoints,
  useRemoveWaypoint,
  useSendBotCommand,
} from "@workspace/api-client-react";
import { Panel, PanelHeader, GameButton } from "./ui-gaming";

interface Waypoint {
  id: string;
  label: string;
  x: number;
  y: number;
  z: number;
}

export function WaypointPanel() {
  const [waypoints, setWaypoints] = useState<Waypoint[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [label, setLabel] = useState("");
  const [x, setX] = useState("");
  const [y, setY] = useState("");
  const [z, setZ] = useState("");

  const { data, refetch } = useGetWaypoints();
  const add = useAddWaypoint();
  const clear = useClearWaypoints();
  const remove = useRemoveWaypoint();
  const command = useSendBotCommand();

  useEffect(() => {
    if (data?.waypoints) setWaypoints(data.waypoints as Waypoint[]);
  }, [data]);

  const handleAdd = () => {
    const nx = parseFloat(x);
    const ny = parseFloat(y);
    const nz = parseFloat(z);
    if (isNaN(nx) || isNaN(ny) || isNaN(nz)) return;
    add.mutate(
      { data: { label: label || `WP${waypoints.length + 1}`, x: nx, y: ny, z: nz } },
      { onSuccess: () => { refetch(); setLabel(""); setX(""); setY(""); setZ(""); setShowForm(false); } }
    );
  };

  const handlePatrol = () => {
    command.mutate({ data: { command: "patrol" } });
  };

  return (
    <Panel>
      <PanelHeader
        title="Patrol Waypoints"
        icon={MapPin}
        action={
          <button
            onClick={() => setShowForm(f => !f)}
            className="flex items-center gap-1 text-[10px] font-mono text-primary/70 hover:text-primary transition-colors"
          >
            {showForm ? <><ChevronUp className="w-3 h-3" /> HIDE</> : <><Plus className="w-3 h-3" /> ADD</>}
          </button>
        }
      />
      <div className="p-4 space-y-3">

        {/* Add form */}
        {showForm && (
          <div className="space-y-2 p-3 bg-black/20 rounded-lg border border-border/50">
            <input
              type="text"
              placeholder="Label (optional)"
              value={label}
              onChange={e => setLabel(e.target.value)}
              className="w-full bg-black/50 border border-border rounded-lg px-3 py-2 font-mono text-xs focus:border-primary focus:outline-none"
            />
            <div className="grid grid-cols-3 gap-2">
              <input type="number" placeholder="X" value={x} onChange={e => setX(e.target.value)}
                className="bg-black/50 border border-border rounded-lg px-2 py-2 font-mono text-xs text-center focus:border-primary focus:outline-none" />
              <input type="number" placeholder="Y" value={y} onChange={e => setY(e.target.value)}
                className="bg-black/50 border border-border rounded-lg px-2 py-2 font-mono text-xs text-center focus:border-primary focus:outline-none" />
              <input type="number" placeholder="Z" value={z} onChange={e => setZ(e.target.value)}
                className="bg-black/50 border border-border rounded-lg px-2 py-2 font-mono text-xs text-center focus:border-primary focus:outline-none" />
            </div>
            <GameButton
              onClick={handleAdd}
              disabled={add.isPending || !x || !y || !z}
              className="w-full py-2 gap-2 text-xs"
            >
              <Plus className="w-3.5 h-3.5" />
              ADD WAYPOINT
            </GameButton>
          </div>
        )}

        {/* Waypoint list */}
        <div className="space-y-1.5">
          {waypoints.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4 border border-dashed border-border/50 rounded-lg">
              No waypoints — add some to enable patrol mode
            </p>
          ) : waypoints.map((wp, idx) => (
            <div
              key={wp.id}
              className="flex items-center gap-2 bg-black/30 border border-border/50 rounded-lg px-3 py-2"
            >
              <div className="w-5 h-5 rounded bg-primary/10 border border-primary/30 flex items-center justify-center shrink-0">
                <span className="text-[10px] font-mono font-bold text-primary">{idx + 1}</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-mono font-bold">{wp.label}</div>
                <div className="text-[10px] font-mono text-muted-foreground">
                  X{wp.x.toFixed(0)} Y{wp.y.toFixed(0)} Z{wp.z.toFixed(0)}
                </div>
              </div>
              <button
                onClick={() => remove.mutate({ id: wp.id }, { onSuccess: () => refetch() })}
                className="p-1.5 rounded-lg hover:bg-red-500/20 text-muted-foreground hover:text-red-400 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>

        {/* Controls */}
        {waypoints.length > 0 && (
          <div className="grid grid-cols-2 gap-2">
            <GameButton onClick={handlePatrol} className="py-2 gap-1.5 text-xs">
              <Play className="w-3.5 h-3.5" />
              START PATROL
            </GameButton>
            <button
              onClick={() => clear.mutate(undefined, { onSuccess: () => refetch() })}
              className="flex items-center justify-center gap-2 py-2 text-xs font-mono font-bold text-red-400 border border-red-500/30 rounded-lg hover:bg-red-500/10 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              CLEAR ALL
            </button>
          </div>
        )}
      </div>
    </Panel>
  );
}
