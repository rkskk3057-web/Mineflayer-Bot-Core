import { useState } from "react";
import { 
  useConnectBot, 
  useDisconnectBot, 
  useReconnectBot, 
  useGetBotStatus,
  useGetServerConfigs,
  type ConnectRequest
} from "@workspace/api-client-react";
import { Panel, PanelHeader, GameButton } from "./ui-gaming";
import { Plug, Power, RotateCw, Server, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const MC_VERSIONS = [
  "1.21.11", "1.21.9", "1.21.8", "1.21.6", "1.21.5", "1.21.4", "1.21.3", "1.21.1",
  "1.20.6", "1.20.4", "1.20.2", "1.20.1",
  "1.19.4", "1.19.2",
  "1.18.2", "1.17.1", "1.16.5",
  "1.12.2", "1.8.9",
];

export function ConnectionPanel() {
  const { data: status } = useGetBotStatus({ query: { refetchInterval: 2000 } });
  const { data: serversData } = useGetServerConfigs();
  const { mutate: connect, isPending: isConnecting } = useConnectBot();
  const { mutate: disconnect, isPending: isDisconnecting } = useDisconnectBot();
  const { mutate: reconnect, isPending: isReconnecting } = useReconnectBot();
  const { toast } = useToast();

  const [form, setForm] = useState<ConnectRequest>({
    host: "froxsmp.enderman.cloud",
    port: 41535,
    username: "guard",
    owner: "",
    version: "",
  });

  const handleConnect = (e: React.FormEvent) => {
    e.preventDefault();
    connect({ data: form }, {
      onSuccess: () => toast({ title: "Connecting..." }),
      onError: (err) => toast({ title: "Connection Error", description: String(err), variant: "destructive" })
    });
  };

  const handleDisconnect = () => {
    disconnect(undefined, {
      onSuccess: () => toast({ title: "Disconnected" }),
    });
  };

  const handleReconnect = () => {
    reconnect(undefined, {
      onSuccess: () => toast({ title: "Reconnecting..." }),
    });
  };

  const handleLoadConfig = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const cfgId = e.target.value;
    if (!cfgId) return;
    const cfg = serversData?.configs.find(c => c.id === cfgId);
    if (cfg) {
      setForm({
        host: cfg.host,
        port: cfg.port,
        username: cfg.username,
        owner: cfg.owner,
        version: form.version,
      });
    }
  };

  const isPending = isConnecting || isDisconnecting || isReconnecting;
  const isConnected = status?.connected;
  const lastError = status?.lastError;
  const attempts = status?.connectAttempts ?? 0;
  const liveVersion = status?.version;

  return (
    <Panel className={isConnected ? "border-primary/50" : "border-muted"}>
      <PanelHeader 
        title="Uplink Control" 
        icon={Server} 
        action={
          <div className="flex items-center gap-2">
            <div className={`w-2.5 h-2.5 rounded-full ${isConnected ? 'bg-primary shadow-[0_0_8px_rgba(0,255,0,0.8)]' : 'bg-red-500 shadow-[0_0_8px_rgba(255,0,0,0.8)]'}`} />
            <span className="text-xs font-bold font-display uppercase tracking-widest text-muted-foreground">
              {isConnected ? `ONLINE${liveVersion ? ` · v${liveVersion}` : ''}` : 'OFFLINE'}
            </span>
          </div>
        }
      />
      <div className="p-4 space-y-4">
        {!isConnected && lastError && (
          <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/40 rounded-lg p-2.5 text-xs">
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="font-bold text-red-300 uppercase tracking-wide text-[10px] font-display">
                Last Error {attempts > 0 && `· attempt ${attempts}/5`}
              </div>
              <div className="text-red-200/80 break-words mt-0.5 leading-relaxed">{lastError}</div>
            </div>
          </div>
        )}

        {serversData?.configs && serversData.configs.length > 0 && (
          <select 
            className="w-full bg-black/40 border border-border/50 rounded-lg p-2 text-sm text-foreground focus:border-primary focus:outline-none"
            onChange={handleLoadConfig}
            disabled={isConnected || isPending}
          >
            <option value="">-- Load Saved Profile --</option>
            {serversData.configs.map(c => (
              <option key={c.id} value={c.id}>{c.name} ({c.host})</option>
            ))}
          </select>
        )}

        <form onSubmit={handleConnect} className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="text-[10px] font-display tracking-widest text-muted-foreground uppercase">Host IP</label>
              <input 
                type="text" 
                value={form.host}
                onChange={e => setForm({...form, host: e.target.value})}
                disabled={isConnected || isPending}
                className="w-full bg-black/50 border border-border rounded-lg p-2 font-mono text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/50"
                required
              />
            </div>
            <div>
              <label className="text-[10px] font-display tracking-widest text-muted-foreground uppercase">Port</label>
              <input 
                type="number" 
                value={form.port}
                onChange={e => setForm({...form, port: Number(e.target.value)})}
                disabled={isConnected || isPending}
                className="w-full bg-black/50 border border-border rounded-lg p-2 font-mono text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/50"
                required
              />
            </div>
          </div>
          
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-display tracking-widest text-muted-foreground uppercase">Bot Username</label>
              <input 
                type="text" 
                value={form.username}
                onChange={e => setForm({...form, username: e.target.value})}
                disabled={isConnected || isPending}
                className="w-full bg-black/50 border border-border rounded-lg p-2 font-mono text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/50"
                required
              />
            </div>
            <div>
              <label className="text-[10px] font-display tracking-widest text-muted-foreground uppercase">Owner Name</label>
              <input 
                type="text" 
                value={form.owner}
                onChange={e => setForm({...form, owner: e.target.value})}
                disabled={isConnected || isPending}
                className="w-full bg-black/50 border border-border rounded-lg p-2 font-mono text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/50"
                required
              />
            </div>
          </div>

          <div>
            <label className="text-[10px] font-display tracking-widest text-muted-foreground uppercase">
              Minecraft Version <span className="opacity-50 normal-case tracking-normal">(blank = auto-detect)</span>
            </label>
            <input
              type="text"
              list="mc-versions"
              value={form.version ?? ""}
              onChange={e => setForm({...form, version: e.target.value})}
              disabled={isConnected || isPending}
              placeholder="e.g. 1.21.11 — leave blank to auto-detect"
              className="w-full bg-black/50 border border-border rounded-lg p-2 font-mono text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
            <datalist id="mc-versions">
              {MC_VERSIONS.map(v => (
                <option key={v} value={v} />
              ))}
            </datalist>
            <p className="text-[10px] text-muted-foreground/70 mt-1 italic">
              If the server kicks you with "Outdated client! Please use X" — type that exact version here.
            </p>
          </div>

          <div className="pt-2 grid grid-cols-2 gap-2">
            {!isConnected ? (
              <GameButton type="submit" disabled={isPending} className="col-span-2">
                <Power className="w-4 h-4" />
                Initialize Link
              </GameButton>
            ) : (
              <>
                <GameButton type="button" variant="danger" onClick={handleDisconnect} disabled={isPending}>
                  <Plug className="w-4 h-4" />
                  Cut Link
                </GameButton>
                <GameButton type="button" variant="secondary" onClick={handleReconnect} disabled={isPending}>
                  <RotateCw className="w-4 h-4" />
                  Cycle
                </GameButton>
              </>
            )}
          </div>
        </form>
      </div>
    </Panel>
  );
}
