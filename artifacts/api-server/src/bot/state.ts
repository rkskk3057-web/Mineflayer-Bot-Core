export type BotState = "IDLE" | "FOLLOW" | "GUARD" | "COMBAT" | "AUTONOMOUS" | "PATROL" | "DISCONNECTED";
export type CpuMode = "LOW" | "NORMAL" | "HIGH";

export interface BotSettings {
  followDistance: number;
  detectionRadius: number;
  aggressionLevel: number;
  attackDelay: number;
  scanInterval: number;
  cpuMode: CpuMode;
  autoReconnect: boolean;
  reconnectDelay: number;
  owner: string;
  combatEnabled: boolean;
  autoEat: boolean;
  antiAfk: boolean;
  lootPickup: boolean;
  criticalHits: boolean;
  sneakFollow: boolean;
}

export interface LogEntry {
  id: string;
  timestamp: string;
  level: "info" | "warn" | "error" | "combat" | "state" | "connection";
  message: string;
}

export interface BotTask {
  id: string;
  type: "follow" | "guard_area" | "move_to" | "patrol";
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

export interface BotPosition {
  x: number;
  y: number;
  z: number;
}

export interface WaypointEntry {
  id: string;
  label: string;
  x: number;
  y: number;
  z: number;
}

export interface CloneBot {
  id: string;
  username: string;
  status: "connecting" | "online" | "offline" | "error";
  health: number;
  food: number;
  state: string;
  host: string;
  port: number;
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
  position: BotPosition | null;
  kills: number;
  deaths: number;
  combatEnabled: boolean;
  sneaking: boolean;
  isSwimming: boolean;
  cloneCount: number;
  lastError: string | null;
  connectAttempts: number;
  version: string;
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
  combatEnabled: true,
  autoEat: true,
  antiAfk: true,
  lootPickup: true,
  criticalHits: true,
  sneakFollow: false,
};
