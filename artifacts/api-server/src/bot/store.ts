import { defaultSettings } from "./state.js";
import type { BotSettings, BotTask, ServerConfig, BotState, CpuMode, BotPosition, WaypointEntry } from "./state.js";

export const store = {
  connected: false,
  connecting: false,
  serverHost: "",
  serverPort: 25565,
  username: "MCBot",

  state: "DISCONNECTED" as BotState,
  health: 20,
  food: 20,
  ping: 0,
  nearbyPlayers: 0,
  currentTarget: null as string | null,
  ownerOnline: false,
  autonomousMode: false,
  startTime: 0,

  position: null as BotPosition | null,
  kills: 0,
  deaths: 0,
  sneaking: false,
  isSwimming: false,

  settings: { ...defaultSettings },
  whitelist: new Set<string>(),
  tasks: [] as BotTask[],
  serverConfigs: [] as ServerConfig[],
  waypoints: [] as WaypointEntry[],
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
    case "LOW":  return Math.max(base * 2, 1000);
    case "HIGH": return Math.max(base / 2, 150);
    default:     return base;
  }
}
