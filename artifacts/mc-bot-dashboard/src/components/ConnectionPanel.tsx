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
import { Plug, Power, RotateCw, Server } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export function ConnectionPanel() {
  const { data: status } = useGetBotStatus();
  const { data: serversData } = useGetServerConfigs();
  const { mutate: connect, isPending: isConnecting } = useConnectBot();
  const { mutate: disconnect, isPending: isDisconnecting } = useDisconnectBot();
  const { mutate: reconnect, isPending: isReconnecting } = useReconnectBot();
  const { toast } = useToast();

  const [form, setForm] = useState<ConnectRequest>({
    host: "localhost",
    port: 25565,
    username: "AI_Bot",
    owner: "Player1"
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
        owner: cfg.owner
      });
    }
  };

  const isPending = isConnecting || isDisconnecting || isReconnecting;
  const isConnected = status?.connected;

  return (
    <Panel className={isConnected ? "border-primary/50" : "border-muted"}>
      <PanelHeader 
        title="Uplink Control" 
        icon={Server} 
        action={
          <div className="flex items-center gap-2">
            <div className={`w-2.5 h-2.5 rounded-full ${isConnected ? 'bg-primary shadow-[0_0_8px_rgba(0,255,0,0.8)]' : 'bg-red-500 shadow-[0_0_8px_rgba(255,0,0,0.8)]'}`} />
            <span className="text-xs font-bold font-display uppercase tracking-widest text-muted-foreground">
              {isConnected ? 'ONLINE' : 'OFFLINE'}
            </span>
          </div>
        }
      />
      <div className="p-4 space-y-4">
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
