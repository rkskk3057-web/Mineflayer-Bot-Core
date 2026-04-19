import { useState } from "react";
import { Panel, PanelHeader, GameButton } from "./ui-gaming";
import { Package, RefreshCw } from "lucide-react";
import { useGetBotStatus } from "@workspace/api-client-react";

interface InventoryItem {
  name: string;
  displayName: string;
  count: number;
  slot: number;
}

function itemColor(name: string): string {
  if (name.includes("netherite")) return "text-rose-400";
  if (name.includes("diamond")) return "text-cyan-400";
  if (name.includes("iron")) return "text-slate-300";
  if (name.includes("gold")) return "text-yellow-400";
  if (name.includes("sword") || name.includes("axe") || name.includes("bow")) return "text-red-400";
  if (name.includes("helmet") || name.includes("chestplate") || name.includes("leggings") || name.includes("boots")) return "text-blue-400";
  if (name.includes("food") || name.includes("bread") || name.includes("beef") || name.includes("chicken") || name.includes("pork") || name.includes("apple") || name.includes("carrot")) return "text-orange-400";
  return "text-gray-300";
}

export function InventoryPanel() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const { data: status } = useGetBotStatus({ query: { refetchInterval: 5000 } });

  const refresh = async () => {
    if (!status?.connected) return;
    setLoading(true);
    try {
      const base = import.meta.env.BASE_URL ?? "/";
      const res = await fetch(`${base}api/bot/inventory`);
      const data = await res.json();
      setItems(data.items ?? []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  const isConnected = status?.connected ?? false;

  return (
    <Panel>
      <PanelHeader
        title="Inventory"
        icon={Package}
        action={
          <GameButton
            variant="outline"
            onClick={refresh}
            disabled={!isConnected || loading}
            className="text-[10px] px-2 py-1 h-auto"
          >
            <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
            Scan
          </GameButton>
        }
      />
      <div className="p-3">
        {!isConnected ? (
          <p className="text-muted-foreground text-xs text-center py-4 font-mono">Bot not connected</p>
        ) : items.length === 0 ? (
          <p className="text-muted-foreground text-xs text-center py-4 font-mono opacity-60">
            {loading ? "Scanning…" : "Press Scan to load inventory"}
          </p>
        ) : (
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {items.map((item, i) => (
              <div key={i} className="flex items-center justify-between px-2 py-1 rounded hover:bg-white/5 transition-colors">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[10px] text-muted-foreground font-mono w-5 shrink-0">{item.slot}</span>
                  <span className={`text-xs font-mono truncate ${itemColor(item.name)}`}>
                    {item.displayName || item.name}
                  </span>
                </div>
                <span className="text-xs font-mono font-bold text-muted-foreground shrink-0 ml-2">×{item.count}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Panel>
  );
}
