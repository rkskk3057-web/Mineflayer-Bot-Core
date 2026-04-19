import { useEffect, useRef, useState } from "react";
import { useGetBotLogs } from "@workspace/api-client-react";
import { Panel, PanelHeader } from "./ui-gaming";
import { Terminal, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import { getGetBotLogsQueryKey } from "@workspace/api-client-react";

type Level = "all" | "info" | "warn" | "error" | "combat" | "state" | "connection";

const LEVEL_COLOR: Record<string, string> = {
  info:       "text-gray-300",
  warn:       "text-yellow-400",
  error:      "text-red-400",
  combat:     "text-orange-400",
  state:      "text-purple-400",
  connection: "text-blue-400",
};

const FILTER_OPTIONS: Level[] = ["all", "combat", "state", "connection", "warn", "error"];

export function TerminalLog() {
  const { data } = useGetBotLogs({ limit: 200 });
  const logs = data?.logs ?? [];
  const scrollRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Level>("all");
  const [paused, setPaused] = useState(false);

  const filtered = filter === "all" ? logs : logs.filter(l => l.level === filter);

  useEffect(() => {
    if (!paused && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [filtered, paused]);

  const clearLogs = () => {
    queryClient.setQueryData(getGetBotLogsQueryKey({ limit: 200 }), { logs: [] });
  };

  return (
    <Panel className="flex flex-col">
      <PanelHeader
        title="System Log"
        icon={Terminal}
        action={
          <button onClick={clearLogs} className="text-muted-foreground hover:text-red-400 transition-colors" title="Clear">
            <Trash2 className="w-4 h-4" />
          </button>
        }
      />

      {/* Filter bar */}
      <div className="flex gap-1 px-3 pt-2 pb-1 flex-wrap">
        {FILTER_OPTIONS.map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-2 py-0.5 rounded text-[10px] font-bold font-display tracking-widest uppercase transition-all border
              ${filter === f
                ? "bg-primary/20 border-primary/50 text-primary"
                : "border-border/50 text-muted-foreground hover:border-primary/30 hover:text-primary/70"
              }`}
          >
            {f}
          </button>
        ))}
        <button
          onClick={() => setPaused(p => !p)}
          className={`ml-auto px-2 py-0.5 rounded text-[10px] font-bold font-display tracking-widest uppercase transition-all border
            ${paused
              ? "bg-yellow-500/20 border-yellow-500/50 text-yellow-400"
              : "border-border/50 text-muted-foreground hover:border-yellow-500/30"
            }`}
        >
          {paused ? "▶ RESUME" : "⏸ PAUSE"}
        </button>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 min-h-[280px] max-h-[340px] px-3 pb-3 font-mono text-xs overflow-y-auto space-y-0.5"
      >
        {filtered.length === 0 ? (
          <div className="text-muted-foreground opacity-40 py-4 text-center">No logs yet…</div>
        ) : (
          [...filtered].reverse().map(log => (
            <div
              key={log.id}
              className={`flex gap-2 hover:bg-white/5 px-1 py-0.5 rounded ${LEVEL_COLOR[log.level] ?? "text-white"}`}
            >
              <span className="opacity-40 shrink-0 tabular-nums">
                {format(new Date(log.timestamp), "HH:mm:ss")}
              </span>
              <span className="opacity-60 shrink-0 w-12 uppercase text-[9px] leading-5">{log.level}</span>
              <span className="break-all">{log.message}</span>
            </div>
          ))
        )}
      </div>
    </Panel>
  );
}
