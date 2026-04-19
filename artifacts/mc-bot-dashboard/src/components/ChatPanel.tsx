import { useState, useEffect, useRef } from "react";
import { Panel, PanelHeader, GameButton } from "./ui-gaming";
import { MessageSquare, Send } from "lucide-react";
import { format } from "date-fns";
import { onBotChat, type ChatMessage } from "@/hooks/use-socket";
import { useGetBotStatus } from "@workspace/api-client-react";

export function ChatPanel() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const { data: status } = useGetBotStatus({ query: { refetchInterval: 3000 } });
  const scrollRef = useRef<HTMLDivElement>(null);

  // Subscribe to live chat from Socket.IO
  useEffect(() => {
    return onBotChat((msg) => {
      setMessages(prev => [msg, ...prev].slice(0, 100));
    });
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim() || !status?.connected) return;
    setSending(true);
    try {
      const base = import.meta.env.BASE_URL ?? "/";
      const res = await fetch(`${base}api/bot/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: input.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        setMessages(prev => [
          { message: `[You] ${input.trim()}`, timestamp: new Date().toISOString() },
          ...prev,
        ].slice(0, 100));
        setInput("");
      }
    } catch {
      // ignore
    } finally {
      setSending(false);
    }
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  const isConnected = status?.connected ?? false;

  return (
    <Panel className="flex flex-col">
      <PanelHeader title="Chat Bridge" icon={MessageSquare} />
      <div
        ref={scrollRef}
        className="h-40 overflow-y-auto p-3 bg-black/50 font-mono text-xs space-y-1 flex flex-col-reverse"
      >
        {messages.length === 0 ? (
          <div className="text-muted-foreground italic opacity-50 text-center pt-4">No messages yet…</div>
        ) : (
          messages.map((m, i) => (
            <div key={i} className="flex gap-2 text-gray-300 hover:bg-white/5 px-1 py-0.5 rounded">
              <span className="opacity-40 shrink-0">[{format(new Date(m.timestamp), "HH:mm")}]</span>
              <span className="break-all">{m.message}</span>
            </div>
          ))
        )}
      </div>
      <div className="p-3 border-t border-border/50 flex gap-2">
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKey}
          disabled={!isConnected || sending}
          placeholder={isConnected ? "Type a message…" : "Connect bot first"}
          className="flex-1 bg-black/50 border border-border rounded-lg px-3 py-2 font-mono text-sm focus:border-primary focus:outline-none disabled:opacity-40"
        />
        <GameButton onClick={sendMessage} disabled={!isConnected || sending || !input.trim()} className="px-3">
          <Send className="w-4 h-4" />
        </GameButton>
      </div>
    </Panel>
  );
}
