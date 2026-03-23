import { useState } from "react";
import { useGetWhitelist, useAddToWhitelist, useRemoveFromWhitelist } from "@workspace/api-client-react";
import { Panel, PanelHeader, GameButton } from "./ui-gaming";
import { ShieldCheck, UserPlus, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

export function WhitelistPanel() {
  const { data } = useGetWhitelist();
  const { mutate: addPlayer, isPending: isAdding } = useAddToWhitelist();
  const { mutate: removePlayer } = useRemoveFromWhitelist();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const [newPlayer, setNewPlayer] = useState("");

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPlayer.trim()) return;
    addPlayer({ data: { username: newPlayer.trim() } }, {
      onSuccess: () => {
        setNewPlayer("");
        queryClient.invalidateQueries({ queryKey: ["/api/settings/whitelist"] });
        toast({ title: "Player Whitelisted", description: "Clearance granted." });
      }
    });
  };

  const handleRemove = (username: string) => {
    removePlayer({ username }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/settings/whitelist"] });
      }
    });
  };

  const list = data?.whitelist || [];

  return (
    <Panel>
      <PanelHeader title="Security Clearance" icon={ShieldCheck} />
      <div className="p-4 space-y-4">
        
        <form onSubmit={handleAdd} className="flex gap-2">
          <input 
            type="text" 
            placeholder="Username..."
            value={newPlayer}
            onChange={e => setNewPlayer(e.target.value)}
            className="flex-1 bg-black/50 border border-border rounded-lg p-2 font-mono text-sm focus:border-primary focus:outline-none"
          />
          <GameButton type="submit" disabled={isAdding || !newPlayer.trim()}>
            <UserPlus className="w-4 h-4" />
          </GameButton>
        </form>

        <div className="space-y-1">
          {list.length === 0 ? (
            <div className="text-xs text-muted-foreground italic text-center py-2">No cleared entities</div>
          ) : (
            list.map(username => (
              <div key={username} className="flex items-center justify-between p-2 rounded bg-black/40 border border-border/30 group hover:border-primary/30 transition-colors">
                <span className="font-mono text-sm text-gray-200">{username}</span>
                <button 
                  onClick={() => handleRemove(username)}
                  className="text-muted-foreground hover:text-destructive p-1 rounded hover:bg-destructive/10 transition-colors opacity-50 group-hover:opacity-100"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </Panel>
  );
}
