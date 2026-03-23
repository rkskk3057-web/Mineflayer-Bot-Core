import { useEffect, useState } from "react";
import { io, Socket } from "socket.io-client";
import { useQueryClient } from "@tanstack/react-query";
import { 
  getGetBotStatusQueryKey, 
  getGetBotLogsQueryKey,
  type BotStatus,
  type LogEntry
} from "@workspace/api-client-react";

export function useBotSocket() {
  const [isConnected, setIsConnected] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    // Connect to the backend Socket.IO (mounted at /api/socket.io)
    const path = "/api/socket.io";
    
    const socketInstance: Socket = io(window.location.origin, {
      path,
      transports: ["websocket", "polling"]
    });

    socketInstance.on("connect", () => setIsConnected(true));
    socketInstance.on("disconnect", () => setIsConnected(false));

    // Handle incoming bot status
    socketInstance.on("bot:status", (status: BotStatus) => {
      queryClient.setQueryData(getGetBotStatusQueryKey(), status);
    });

    // Handle incoming logs
    socketInstance.on("bot:log", (log: LogEntry) => {
      queryClient.setQueryData(getGetBotLogsQueryKey({ limit: 200 }), (old: any) => {
        if (!old) return { logs: [log] };
        // Keep last 200 logs, newer logs at the top
        return { logs: [log, ...old.logs].slice(0, 200) };
      });
    });

    // Invalidate status on structural connection changes
    socketInstance.on("bot:connected", () => {
      queryClient.invalidateQueries({ queryKey: getGetBotStatusQueryKey() });
    });

    socketInstance.on("bot:disconnected", () => {
      queryClient.invalidateQueries({ queryKey: getGetBotStatusQueryKey() });
    });

    return () => {
      socketInstance.disconnect();
    };
  }, [queryClient]);

  return { isConnected };
}
