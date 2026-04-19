import { useEffect } from "react";
import { useGetSettings, useUpdateSettings, type BotSettings } from "@workspace/api-client-react";
import { Panel, PanelHeader, GameButton } from "./ui-gaming";
import { Settings2, Save } from "lucide-react";
import { useForm } from "react-hook-form";
import { useToast } from "@/hooks/use-toast";

function Toggle({ label, sub, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string; sub?: string }) {
  return (
    <div className="flex items-center justify-between bg-black/30 p-3 rounded-lg border border-border/50">
      <div>
        <div className="text-sm font-bold">{label}</div>
        {sub && <div className="text-[10px] text-muted-foreground font-display uppercase tracking-wider">{sub}</div>}
      </div>
      <label className="relative inline-flex items-center cursor-pointer">
        <input type="checkbox" className="sr-only peer" {...props} />
        <div className="w-11 h-6 bg-zinc-800 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary/50 rounded-full peer
          peer-checked:after:translate-x-full peer-checked:after:border-white
          after:content-[''] after:absolute after:top-[2px] after:left-[2px]
          after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5
          after:transition-all peer-checked:bg-primary" />
      </label>
    </div>
  );
}

export function SettingsPanel() {
  const { data: settings, isLoading } = useGetSettings();
  const { mutate: updateSettings, isPending } = useUpdateSettings();
  const { toast } = useToast();
  const { register, handleSubmit, reset } = useForm<BotSettings>();

  useEffect(() => {
    if (settings) reset(settings);
  }, [settings, reset]);

  const onSubmit = (data: BotSettings) => {
    updateSettings({
      data: {
        ...data,
        followDistance:  Number(data.followDistance),
        detectionRadius: Number(data.detectionRadius),
        aggressionLevel: Number(data.aggressionLevel),
        attackDelay:     Number(data.attackDelay),
        scanInterval:    Number(data.scanInterval),
        reconnectDelay:  Number(data.reconnectDelay),
      },
    }, {
      onSuccess: () => toast({ title: "Settings saved" }),
      onError:   () => toast({ title: "Save failed", variant: "destructive" }),
    });
  };

  if (isLoading) return <div className="h-64 animate-pulse bg-card/20 rounded-xl" />;

  return (
    <Panel>
      <PanelHeader title="Configuration" icon={Settings2} />
      <form onSubmit={handleSubmit(onSubmit)} className="p-4 space-y-4">

        <div className="grid grid-cols-2 gap-3">
          {[
            { label: "Follow Dist (blocks)", key: "followDistance", step: "0.5" },
            { label: "Scan Radius (blocks)", key: "detectionRadius", step: "1" },
            { label: "Attack Delay (ms)",    key: "attackDelay",     step: "50" },
            { label: "Scan Interval (ms)",   key: "scanInterval",    step: "50" },
          ].map(({ label, key, step }) => (
            <div key={key}>
              <label className="text-[10px] font-display tracking-widest text-muted-foreground uppercase">{label}</label>
              <input
                type="number"
                step={step}
                {...register(key as keyof BotSettings)}
                className="w-full bg-black/50 border border-border rounded-lg p-2 font-mono text-sm focus:border-primary focus:outline-none"
              />
            </div>
          ))}
        </div>

        {/* Aggression slider */}
        <div>
          <label className="text-[10px] font-display tracking-widest text-muted-foreground uppercase">
            Aggression Level (0–10)
          </label>
          <input
            type="range" min="0" max="10" step="1"
            {...register("aggressionLevel")}
            className="w-full accent-primary cursor-pointer mt-1"
          />
          <div className="flex justify-between text-[9px] text-muted-foreground font-mono mt-0.5">
            <span>Passive</span><span>Balanced</span><span>Aggressive</span>
          </div>
        </div>

        {/* Owner + CPU mode */}
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="text-[10px] font-display tracking-widest text-muted-foreground uppercase">Owner Username</label>
            <input
              type="text"
              {...register("owner")}
              placeholder="e.g. Steve"
              className="w-full bg-black/50 border border-border rounded-lg p-2 font-mono text-sm focus:border-primary focus:outline-none"
            />
          </div>
          <div className="col-span-2">
            <label className="text-[10px] font-display tracking-widest text-muted-foreground uppercase">CPU Mode</label>
            <select
              {...register("cpuMode")}
              className="w-full bg-black/50 border border-border rounded-lg p-2 font-mono text-sm focus:border-primary focus:outline-none"
            >
              <option value="LOW">LOW — Battery saver</option>
              <option value="NORMAL">NORMAL — Balanced</option>
              <option value="HIGH">HIGH — Combat ready</option>
            </select>
          </div>
        </div>

        {/* Toggles — Survival */}
        <div>
          <p className="text-[9px] font-display tracking-widest text-muted-foreground uppercase mb-2">Survival</p>
          <div className="space-y-2">
            <Toggle label="Auto-Reconnect"  sub="Recover after disconnect"       {...register("autoReconnect")} />
            <Toggle label="Combat Enabled"  sub="Attack hostiles / defend owner" {...register("combatEnabled")} />
            <Toggle label="Auto-Eat"        sub="Eat food when hungry"           {...register("autoEat")} />
          </div>
        </div>

        {/* Toggles — Tactics */}
        <div>
          <p className="text-[9px] font-display tracking-widest text-muted-foreground uppercase mb-2">Tactics</p>
          <div className="space-y-2">
            <Toggle label="Critical Hits"   sub="Jump before attacking (+50% dmg)" {...register("criticalHits")} />
            <Toggle label="Loot Pickup"     sub="Auto-collect nearby item drops"   {...register("lootPickup")} />
            <Toggle label="Anti-AFK"        sub="Random idle movements to stay active" {...register("antiAfk")} />
            <Toggle label="Sneak Follow"    sub="Sneak when following owner"        {...register("sneakFollow")} />
          </div>
        </div>

        <GameButton type="submit" className="w-full" disabled={isPending}>
          <Save className="w-4 h-4" />
          {isPending ? "Saving…" : "Save Settings"}
        </GameButton>
      </form>
    </Panel>
  );
}
