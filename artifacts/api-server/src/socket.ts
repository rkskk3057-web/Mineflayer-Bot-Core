import type { Server as IOServer } from "socket.io";

let _io: IOServer | null = null;

export function setSocketIO(server: IOServer): void {
  _io = server;
}

// Proxy object so callers can import `io` directly without null checks
export const io = new Proxy({} as IOServer, {
  get(_target, prop) {
    if (!_io) return () => {};
    return (_io as unknown as Record<string, unknown>)[prop as string];
  },
});
