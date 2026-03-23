import { defaultSettings } from "./state.js";
import type { BotSettings, BotTask, ServerConfig, BotState, CpuMode } from "./state.js";

// In-memory store for bot runtime data
export const store = {
  // Connection
  connected: false,
  connecting: false,
  serverHost: "",
  serverPort: 25565,
  username: "MCBot",

  // Status
  state: "DISCONNECTED" as BotState,
  health: 20,
  food: 20,
  ping: 0,
  nearbyPlayers: 0,
  currentTarget: null as string | null,
  ownerOnline: false,
  autonomousMode: false,
  startTime: 0,

  // Settings
  settings: { ...defaultSettings },

  // Whitelist
  whitelist: new Set<string>(),

  // Tasks
  tasks: [] as BotTask[],

  // Server configs
  serverConfigs: [] as ServerConfig[],
};

export function getUptime(): number {
  if (!store.connected || store.startTime === 0) return 0;
  return Math.floor((Date.now() - store.startTime) / 1000);
}

export function getCpuMode(): CpuMode {
  return store.settings.cpuMode;
}

export function getScanInterval(): number {
  const base = store.settings.scanInterval;
  switch (store.settings.cpuMode) {
    case "LOW": return Math.max(base * 2, 1000);
    case "HIGH": return Math.max(base / 2, 150);
    default: return base;
  }
}
