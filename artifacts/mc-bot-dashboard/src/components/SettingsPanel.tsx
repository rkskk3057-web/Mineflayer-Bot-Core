import { useEffect } from "react";
import { useGetSettings, useUpdateSettings, type BotSettings, type BotSettingsCpuMode } from "@workspace/api-client-react";
import { Panel, PanelHeader, GameButton } from "./ui-gaming";
import { Settings2, Save } from "lucide-react";
import { useForm } from "react-hook-form";
import { useToast } from "@/hooks/use-toast";

export function SettingsPanel() {
  const { data: settings, isLoading } = useGetSettings();
  const { mutate: updateSettings, isPending } = useUpdateSettings();
  const { toast } = useToast();

  const { register, handleSubmit, reset } = useForm<BotSettings>();

  useEffect(() => {
    if (settings) {
      reset(settings);
    }
  }, [settings, reset]);

  const onSubmit = (data: BotSettings) => {
    // Ensure numbers are cast correctly
    const payload: BotSettings = {
      ...data,
      followDistance: Number(data.followDistance),
      detectionRadius: Number(data.detectionRadius),
      aggressionLevel: Number(data.aggressionLevel),
      attackDelay: Number(data.attackDelay),
      scanInterval: Number(data.scanInterval),
      reconnectDelay: Number(data.reconnectDelay),
    };

    updateSettings({ data: payload }, {
      onSuccess: () => toast({ title: "Configuration Saved", description: "Parameters applied to core." }),
      onError: () => toast({ title: "Error", description: "Failed to apply configuration", variant: "destructive" })
    });
  };

  if (isLoading) return <div className="h-64 animate-pulse bg-card/20 rounded-xl" />;

  return (
    <Panel>
      <PanelHeader title="System Configuration" icon={Settings2} />
      <form onSubmit={handleSubmit(onSubmit)} className="p-5 space-y-4">
        
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-[10px] font-display tracking-widest text-muted-foreground uppercase">Follow Dist (Blocks)</label>
            <input type="number" step="0.5" {...register("followDistance")} className="w-full bg-black/50 border border-border rounded-lg p-2 font-mono text-sm focus:border-primary focus:outline-none" />
          </div>
          <div>
            <label className="text-[10px] font-display tracking-widest text-muted-foreground uppercase">Scan Radius (Blocks)</label>
            <input type="number" step="1" {...register("detectionRadius")} className="w-full bg-black/50 border border-border rounded-lg p-2 font-mono text-sm focus:border-primary focus:outline-none" />
          </div>
          
          <div>
            <label className="text-[10px] font-display tracking-widest text-muted-foreground uppercase">Attack Delay (ms)</label>
            <input type="number" step="50" {...register("attackDelay")} className="w-full bg-black/50 border border-border rounded-lg p-2 font-mono text-sm focus:border-primary focus:outline-none" />
          </div>
          <div>
            <label className="text-[10px] font-display tracking-widest text-muted-foreground uppercase">Scan Interval (ms)</label>
            <input type="number" step="50" {...register("scanInterval")} className="w-full bg-black/50 border border-border rounded-lg p-2 font-mono text-sm focus:border-primary focus:outline-none" />
          </div>

          <div className="col-span-2">
            <label className="text-[10px] font-display tracking-widest text-muted-foreground uppercase">Aggression Level (0–10)</label>
            <input type="range" min="0" max="10" step="1" {...register("aggressionLevel")} className="w-full accent-primary cursor-pointer" />
            <div className="flex justify-between text-[10px] text-muted-foreground font-mono mt-1">
              <span>Passive</span><span>Balanced</span><span>Aggressive</span>
            </div>
          </div>

          <div className="col-span-2">
            <label className="text-[10px] font-display tracking-widest text-muted-foreground uppercase">Owner Username</label>
            <input type="text" {...register("owner")} className="w-full bg-black/50 border border-border rounded-lg p-2 font-mono text-sm focus:border-primary focus:outline-none" placeholder="Player1" />
          </div>

          <div className="col-span-2">
            <label className="text-[10px] font-display tracking-widest text-muted-foreground uppercase">CPU Throttle Mode</label>
            <select {...register("cpuMode")} className="w-full bg-black/50 border border-border rounded-lg p-2 font-mono text-sm focus:border-primary focus:outline-none">
              <option value="LOW">LOW (Battery / Safe)</option>
              <option value="NORMAL">NORMAL (Balanced)</option>
              <option value="HIGH">HIGH (Combat Ready)</option>
            </select>
          </div>

          <div className="col-span-2 flex items-center justify-between bg-black/30 p-3 rounded-lg border border-border/50">
            <div className="flex flex-col">
              <span className="text-sm font-bold">Auto-Reconnect</span>
              <span className="text-[10px] text-muted-foreground font-display uppercase tracking-wider">Attempt connection loss recovery</span>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" {...register("autoReconnect")} className="sr-only peer" />
              <div className="w-11 h-6 bg-zinc-800 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary/50 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
            </label>
          </div>
        </div>

        <GameButton type="submit" className="w-full mt-2" disabled={isPending}>
          <Save className="w-4 h-4" />
          {isPending ? "Applying..." : "Apply Parameters"}
        </GameButton>
      </form>
    </Panel>
  );
}
