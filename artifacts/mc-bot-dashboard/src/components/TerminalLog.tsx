import { useEffect, useRef } from "react";
import { useGetBotLogs } from "@workspace/api-client-react";
import { Panel, PanelHeader } from "./ui-gaming";
import { Terminal, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";

const levelColors = {
  info: "text-gray-300",
  warn: "text-yellow-400",
  error: "text-red-500",
  combat: "text-orange-500",
  state: "text-purple-400",
  connection: "text-blue-400",
};

export function TerminalLog() {
  const { data } = useGetBotLogs({ limit: 200 });
  const logs = data?.logs || [];
  const scrollRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  const clearLogs = () => {
    queryClient.setQueryData([`/api/bot/logs`, { limit: 200 }], { logs: [] });
  };

  return (
    <Panel className="flex flex-col h-[400px]">
      <PanelHeader 
        title="System Link / Logs" 
        icon={Terminal} 
        action={
          <button onClick={clearLogs} className="text-muted-foreground hover:text-primary transition-colors" title="Clear Logs">
            <Trash2 className="w-4 h-4" />
          </button>
        }
      />
      <div 
        ref={scrollRef}
        className="flex-1 p-4 bg-black/60 font-mono text-sm overflow-y-auto terminal-scroll scanlines"
      >
        {logs.length === 0 ? (
          <div className="text-muted-foreground italic opacity-50">Waiting for data stream...</div>
        ) : (
          <div className="flex flex-col-reverse gap-1">
            {logs.map((log) => (
              <div key={log.id} className={`flex gap-3 ${levelColors[log.level] || 'text-white'} hover:bg-white/5 px-1 py-0.5 rounded transition-colors`}>
                <span className="opacity-50 shrink-0 select-none">
                  [{format(new Date(log.timestamp), "HH:mm:ss")}]
                </span>
                <span className="opacity-70 shrink-0 w-24 select-none">
                  [{log.level.toUpperCase()}]
                </span>
                <span className="break-all">{log.message}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Panel>
  );
}
