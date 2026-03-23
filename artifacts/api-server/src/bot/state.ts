export type BotState = "IDLE" | "FOLLOW" | "GUARD" | "COMBAT" | "AUTONOMOUS" | "DISCONNECTED";
export type CpuMode = "LOW" | "NORMAL" | "HIGH";

export interface BotSettings {
  followDistance: number;
  detectionRadius: number;
  aggressionLevel: number; // 0-10
  attackDelay: number; // ms
  scanInterval: number; // ms
  cpuMode: CpuMode;
  autoReconnect: boolean;
  reconnectDelay: number; // ms
  owner: string;
}

export interface LogEntry {
  id: string;
  timestamp: string;
  level: "info" | "warn" | "error" | "combat" | "state" | "connection";
  message: string;
}

export interface BotTask {
  id: string;
  type: "follow" | "guard_area" | "move_to";
  status: "pending" | "active" | "paused" | "done";
  params: Record<string, unknown>;
}

export interface ServerConfig {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  owner: string;
}

export interface BotStatusData {
  connected: boolean;
  state: BotState;
  health: number;
  food: number;
  ping: number;
  username: string;
  serverHost: string;
  serverPort: number;
  nearbyPlayers: number;
  currentTarget: string | null;
  ownerOnline: boolean;
  cpuMode: CpuMode;
  autonomousMode: boolean;
  uptime: number;
}

export const defaultSettings: BotSettings = {
  followDistance: 3,
  detectionRadius: 12,
  aggressionLevel: 5,
  attackDelay: 600,
  scanInterval: 400,
  cpuMode: "NORMAL",
  autoReconnect: true,
  reconnectDelay: 5000,
  owner: "",
};
