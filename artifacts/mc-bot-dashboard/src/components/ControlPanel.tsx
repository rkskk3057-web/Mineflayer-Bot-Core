import { useSendBotCommand, useGetBotStatus } from "@workspace/api-client-react";
import { Panel, PanelHeader, GameButton } from "./ui-gaming";
import {
  Navigation, ShieldAlert, StopCircle, Cpu,
  Crosshair, Sword, Shield, EyeOff, MapPin,
  PackageOpen, Shirt,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type Cmd =
  | "follow" | "guard" | "patrol" | "stop" | "sneak"
  | "attack_nearest" | "toggle_autonomous" | "toggle_combat"
  | "equip_weapon" | "equip_armor";

export function ControlPanel() {
  const { mutate: sendCommand, isPending } = useSendBotCommand();
  const { data: status } = useGetBotStatus({ query: { refetchInterval: 2000 } });
  const { toast } = useToast();

  const cmd = (command: Cmd) => {
    sendCommand({ data: { command } }, {
      onSuccess: (res) => { toast({ title: res.message ?? "Done" }); },
      onError: () => toast({ title: "Command failed", variant: "destructive" }),
    });
  };

  const isConnected = status?.connected ?? false;
  const combatOn = status?.combatEnabled ?? true;
  const autoOn = status?.autonomousMode ?? false;
  const sneaking = status?.sneaking ?? false;
  const botState = status?.state ?? "DISCONNECTED";

  return (
    <Panel>
      <PanelHeader title="Tactical Controls" icon={Crosshair} />
      <div className="p-4 space-y-3">

        {/* Primary movement/mode actions */}
        <div className="grid grid-cols-3 gap-2">
          <GameButton
            onClick={() => cmd("follow")}
            disabled={isPending || !isConnected}
            className={`text-xs py-3 flex-col gap-1 h-16 ${botState === "FOLLOW" ? "ring-1 ring-primary" : ""}`}
          >
            <Navigation className="w-5 h-5" />
            FOLLOW
          </GameButton>
          <GameButton
            variant="secondary"
            onClick={() => cmd("guard")}
            disabled={isPending || !isConnected}
            className={`text-xs py-3 flex-col gap-1 h-16 ${botState === "GUARD" ? "ring-1 ring-blue-400" : ""}`}
          >
            <ShieldAlert className="w-5 h-5" />
            GUARD
          </GameButton>
          <GameButton
            variant="danger"
            onClick={() => cmd("attack_nearest")}
            disabled={isPending || !isConnected || !combatOn}
            className={`text-xs py-3 flex-col gap-1 h-16 ${botState === "COMBAT" ? "ring-1 ring-red-400" : ""}`}
          >
            <Sword className="w-5 h-5" />
            ATTACK
          </GameButton>
        </div>

        {/* Secondary actions row */}
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => cmd("patrol")}
            disabled={isPending || !isConnected}
            className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-xs font-bold font-display tracking-widest uppercase border transition-all duration-200 disabled:opacity-40
              ${botState === "PATROL"
                ? "bg-yellow-500/20 border-yellow-500/50 text-yellow-300 hover:bg-yellow-500/30"
                : "bg-zinc-800/50 border-zinc-600 text-zinc-400 hover:bg-zinc-700/50"
              }`}
          >
            <MapPin className="w-4 h-4" />
            {botState === "PATROL" ? "PATROLLING" : "PATROL"}
          </button>

          <button
            onClick={() => cmd("sneak")}
            disabled={isPending || !isConnected}
            className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-xs font-bold font-display tracking-widest uppercase border transition-all duration-200 disabled:opacity-40
              ${sneaking
                ? "bg-purple-500/20 border-purple-500/50 text-purple-300 hover:bg-purple-500/30"
                : "bg-zinc-800/50 border-zinc-600 text-zinc-400 hover:bg-zinc-700/50"
              }`}
          >
            <EyeOff className="w-4 h-4" />
            {sneaking ? "SNEAKING" : "SNEAK"}
          </button>
        </div>

        {/* Toggle row */}
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => cmd("toggle_combat")}
            disabled={isPending || !isConnected}
            className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-xs font-bold font-display tracking-widest uppercase border transition-all duration-200 disabled:opacity-40
              ${combatOn
                ? "bg-red-500/20 border-red-500/50 text-red-300 hover:bg-red-500/30"
                : "bg-zinc-800/50 border-zinc-600 text-zinc-400 hover:bg-zinc-700/50"
              }`}
          >
            <Shield className="w-4 h-4" />
            {combatOn ? "COMBAT ON" : "COMBAT OFF"}
          </button>

          <button
            onClick={() => cmd("toggle_autonomous")}
            disabled={isPending || !isConnected}
            className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-xs font-bold font-display tracking-widest uppercase border transition-all duration-200 disabled:opacity-40
              ${autoOn
                ? "bg-cyan-500/20 border-cyan-500/50 text-cyan-300 hover:bg-cyan-500/30"
                : "bg-zinc-800/50 border-zinc-600 text-zinc-400 hover:bg-zinc-700/50"
              }`}
          >
            <Cpu className="w-4 h-4" />
            {autoOn ? "AUTO ON" : "AUTO OFF"}
          </button>
        </div>

        {/* Equipment row */}
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => cmd("equip_weapon")}
            disabled={isPending || !isConnected}
            className="flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-bold font-display tracking-widest uppercase border border-border bg-zinc-800/50 text-zinc-400 hover:bg-zinc-700/50 hover:text-foreground transition-all duration-200 disabled:opacity-40"
          >
            <PackageOpen className="w-4 h-4" />
            EQUIP WEAPON
          </button>
          <button
            onClick={() => cmd("equip_armor")}
            disabled={isPending || !isConnected}
            className="flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-bold font-display tracking-widest uppercase border border-border bg-zinc-800/50 text-zinc-400 hover:bg-zinc-700/50 hover:text-foreground transition-all duration-200 disabled:opacity-40"
          >
            <Shirt className="w-4 h-4" />
            EQUIP ARMOR
          </button>
        </div>

        {/* Stop — full width, prominent */}
        <GameButton
          variant="danger"
          onClick={() => cmd("stop")}
          disabled={isPending || !isConnected}
          className="w-full bg-red-700 hover:bg-red-600 py-3"
        >
          <StopCircle className="w-5 h-5" />
          FORCE STOP
        </GameButton>
      </div>
    </Panel>
  );
}
