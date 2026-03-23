import { useEffect, useState } from "react";
import { io, Socket } from "socket.io-client";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetBotStatusQueryKey,
  getGetBotLogsQueryKey,
  type BotStatus,
  type LogEntry,
} from "@workspace/api-client-react";

export type ChatMessage = { message: string; timestamp: string };
const chatListeners = new Set<(msg: ChatMessage) => void>();
export function onBotChat(fn: (msg: ChatMessage) => void) {
  chatListeners.add(fn);
  return () => chatListeners.delete(fn);
}

let _socket: Socket | null = null;

export function useBotSocket() {
  const [isConnected, setIsConnected] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (_socket) {
      setIsConnected(_socket.connected);
      const onConnect = () => setIsConnected(true);
      const onDisconnect = () => setIsConnected(false);
      _socket.on("connect", onConnect);
      _socket.on("disconnect", onDisconnect);
      return () => {
        _socket?.off("connect", onConnect);
        _socket?.off("disconnect", onDisconnect);
      };
    }

    const socketInstance: Socket = io(window.location.origin, {
      path: "/api/socket.io",
      transports: ["websocket", "polling"],
    });
    _socket = socketInstance;

    socketInstance.on("connect", () => setIsConnected(true));
    socketInstance.on("disconnect", () => setIsConnected(false));

    socketInstance.on("bot:status", (status: BotStatus) => {
      queryClient.setQueryData(getGetBotStatusQueryKey(), status);
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    socketInstance.on("bot:log", (log: LogEntry) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      queryClient.setQueryData(getGetBotLogsQueryKey({ limit: 200 }), (old: any) => {
        if (!old) return { logs: [log] };
        return { logs: [log, ...old.logs].slice(0, 200) };
      });
    });

    socketInstance.on("bot:chat", (msg: ChatMessage) => {
      chatListeners.forEach((fn) => fn(msg));
    });

    socketInstance.on("bot:connected", () => {
      queryClient.invalidateQueries({ queryKey: getGetBotStatusQueryKey() });
    });

    socketInstance.on("bot:disconnected", () => {
      queryClient.invalidateQueries({ queryKey: getGetBotStatusQueryKey() });
    });

    return () => { /* keep socket alive */ };
  }, [queryClient]);

  return { isConnected };
}
