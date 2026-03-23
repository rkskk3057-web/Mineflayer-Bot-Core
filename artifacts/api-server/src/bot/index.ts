import mineflayer, { type Bot } from "mineflayer";
import { store } from "./store.js";
import { addLog } from "./logger.js";
import { startAI, stopAI } from "./ai.js";
import { clearTarget, findNearestHostile, lockTarget } from "./combat.js";
import type { BotState } from "./state.js";
import type { Server as IOServer } from "socket.io";

let bot: Bot | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;
let io: IOServer | null = null;
let statusTimer: NodeJS.Timeout | null = null;

export function setSocketIO(server: IOServer): void {
  io = server;
}

export function getBot(): Bot | null {
  return bot;
}

function getBotStatusData() {
  return {
    connected: store.connected,
    state: store.state,
    health: store.health,
    food: store.food,
    ping: store.ping,
    username: store.username,
    serverHost: store.serverHost,
    serverPort: store.serverPort,
    nearbyPlayers: store.nearbyPlayers,
    currentTarget: store.currentTarget,
    ownerOnline: store.ownerOnline,
    cpuMode: store.settings.cpuMode,
    autonomousMode: store.autonomousMode,
    uptime: store.connected && store.startTime > 0
      ? Math.floor((Date.now() - store.startTime) / 1000)
      : 0,
  };
}

function startStatusBroadcast(): void {
  stopStatusBroadcast();
  statusTimer = setInterval(() => {
    if (io) io.emit("bot:status", getBotStatusData());
  }, 1000);
}

function stopStatusBroadcast(): void {
  if (statusTimer) {
    clearInterval(statusTimer);
    statusTimer = null;
  }
}

export function connect(host: string, port: number, username: string, owner: string): void {
  if (store.connecting) return;
  if (bot) {
    disconnect();
  }

  store.connecting = true;
  store.serverHost = host;
  store.serverPort = port;
  store.username = username;
  store.settings.owner = owner;

  addLog("connection", `Connecting to ${host}:${port} as ${username}...`);

  try {
    bot = mineflayer.createBot({
      host,
      port,
      username,
      auth: "offline",
      version: "1.20.1",
      hideErrors: true,
    });

    setupBotEvents(bot);
  } catch (err) {
    store.connecting = false;
    addLog("error", `Failed to create bot: ${String(err)}`);
  }
}

function setupBotEvents(b: Bot): void {
  b.once("spawn", () => {
    store.connected = true;
    store.connecting = false;
    store.state = "IDLE";
    store.startTime = Date.now();

    addLog("connection", `Connected! Spawned as ${b.username}`);
    if (io) io.emit("bot:connected");

    startStatusBroadcast();

    // Load pathfinder plugin
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pathfinderModule = globalThis.require?.("mineflayer-pathfinder");
      if (pathfinderModule?.pathfinder) {
        b.loadPlugin(pathfinderModule.pathfinder);
        addLog("info", "Pathfinder loaded");
      }
    } catch {
      addLog("warn", "Pathfinder not available - movement features disabled");
    }

    startAI(b);
    equipBestWeapon(b);
  });

  b.on("health", () => {
    store.health = b.health ?? 20;
    store.food = b.food ?? 20;

    if (b.health !== undefined && b.health <= 5 && store.state === "COMBAT") {
      addLog("warn", `Low health (${b.health.toFixed(1)}) - retreating`);
      setState("IDLE");
      clearTarget();
    }
  });

  b.on("physicsTick", () => {
    store.ping = b.player?.ping ?? 0;
  });

  b.on("playerJoined", (player) => {
    if (player.username === store.settings.owner) {
      store.ownerOnline = true;
      addLog("info", `Owner ${player.username} joined`);
      if (store.state === "AUTONOMOUS") {
        store.state = "FOLLOW";
        addLog("state", "Owner online - switching to FOLLOW");
      }
    }
  });

  b.on("playerLeft", (player) => {
    if (player.username === store.settings.owner) {
      store.ownerOnline = false;
      addLog("info", `Owner ${player.username} left`);
      if (store.autonomousMode && store.state === "FOLLOW") {
        store.state = "AUTONOMOUS";
        addLog("state", "Owner offline - switching to AUTONOMOUS");
      } else if (store.state === "FOLLOW") {
        store.state = "IDLE";
        addLog("state", "Owner offline - switching to IDLE");
      }
    }
  });

  b.on("entityHurt", (entity) => {
    if (!b.entity) return;
    if (entity === b.entity) {
      addLog("combat", `Bot took damage! HP: ${(b.health ?? 0).toFixed(1)}`);
    }
    // Protect owner
    const ownerName = store.settings.owner;
    if (ownerName && store.state !== "COMBAT") {
      const ownerPlayer = b.players[ownerName];
      if (ownerPlayer?.entity === entity) {
        addLog("combat", "Owner under attack!");
        setTimeout(() => {
          if (!b.entity) return;
          const nearest = findNearestHostile(b);
          if (nearest) {
            lockTarget(nearest.id);
            store.currentTarget = nearest.name;
            store.state = "COMBAT";
          }
        }, 200);
      }
    }
  });

  b.on("message", (msg) => {
    const text = msg.toString();
    if (text.trim()) {
      const logEntry = addLog("info", `[Chat] ${text}`);
      if (io) io.emit("bot:log", logEntry);
    }
  });

  b.on("kicked", (reason) => {
    addLog("connection", `Kicked: ${reason}`);
    handleDisconnect(`Kicked: ${reason}`);
  });

  b.on("error", (err) => {
    addLog("error", `Bot error: ${err.message}`);
  });

  b.once("end", (reason) => {
    addLog("connection", `Disconnected: ${reason}`);
    handleDisconnect(`Disconnected: ${reason}`);
  });
}

function handleDisconnect(reason: string): void {
  store.connected = false;
  store.connecting = false;
  store.state = "DISCONNECTED";
  store.health = 20;
  store.food = 20;
  store.ping = 0;
  store.nearbyPlayers = 0;
  store.currentTarget = null;

  stopAI();
  clearTarget();
  stopStatusBroadcast();

  if (io) {
    io.emit("bot:disconnected", { reason });
    io.emit("bot:status", getBotStatusData());
  }

  bot = null;

  if (store.settings.autoReconnect && store.serverHost) {
    const delay = store.settings.reconnectDelay;
    addLog("connection", `Auto-reconnecting in ${delay / 1000}s...`);
    reconnectTimer = setTimeout(() => {
      connect(store.serverHost, store.serverPort, store.username, store.settings.owner);
    }, delay);
  }
}

export function disconnect(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  stopAI();
  clearTarget();
  stopStatusBroadcast();

  if (bot) {
    try {
      bot.quit();
    } catch {
      // ignore
    }
    bot = null;
  }

  store.connected = false;
  store.connecting = false;
  store.state = "DISCONNECTED";
  if (io) {
    io.emit("bot:disconnected", { reason: "manual" });
  }
  addLog("connection", "Disconnected manually");
}

export function reconnect(): void {
  const { serverHost, serverPort, username } = store;
  const owner = store.settings.owner;
  if (!serverHost) {
    addLog("warn", "No server configured to reconnect to");
    return;
  }
  disconnect();
  setTimeout(() => {
    connect(serverHost, serverPort, username, owner);
  }, 1000);
}

function equipBestWeapon(b: Bot): void {
  const weaponNames = [
    "diamond_sword", "iron_sword", "stone_sword", "wooden_sword",
    "diamond_axe", "iron_axe", "stone_axe", "wooden_axe",
  ];

  for (const name of weaponNames) {
    const item = b.inventory.items().find((i) => i.name === name);
    if (item) {
      b.equip(item, "hand").catch(() => {});
      addLog("info", `Equipped: ${name}`);
      return;
    }
  }
}

export function getCurrentStatus() {
  return getBotStatusData();
}

export function setState(state: BotState): void {
  const prev = store.state;
  store.state = state;
  if (prev !== state) {
    const logEntry = addLog("state", `State: ${prev} → ${state}`);
    if (io) io.emit("bot:log", logEntry);
  }
}

export function sendCommand(command: string, value?: string): { success: boolean; message: string } {
  if (!store.connected) {
    return { success: false, message: "Bot is not connected" };
  }

  switch (command) {
    case "follow":
      setState("FOLLOW");
      return { success: true, message: "Following owner" };

    case "guard":
      setState("GUARD");
      return { success: true, message: "Guarding area" };

    case "stop":
      setState("IDLE");
      clearTarget();
      if (bot?.pathfinder) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (bot.pathfinder as any).setGoal(null);
        } catch {
          // ignore
        }
      }
      return { success: true, message: "Stopped" };

    case "attack_nearest": {
      if (!bot) return { success: false, message: "No bot" };
      const hostile = findNearestHostile(bot);
      if (hostile) {
        lockTarget(hostile.id);
        store.currentTarget = hostile.name;
        setState("COMBAT");
        return { success: true, message: `Attacking ${hostile.name}` };
      }
      return { success: false, message: "No nearby hostile found" };
    }

    case "toggle_autonomous":
      store.autonomousMode = !store.autonomousMode;
      addLog("state", `Autonomous mode: ${store.autonomousMode ? "ON" : "OFF"}`);
      return { success: true, message: `Autonomous mode: ${store.autonomousMode ? "ON" : "OFF"}` };

    case "set_owner":
      if (value) {
        store.settings.owner = value;
        addLog("info", `Owner set to: ${value}`);
        return { success: true, message: `Owner set to ${value}` };
      }
      return { success: false, message: "No owner specified" };

    default:
      return { success: false, message: `Unknown command: ${command}` };
  }
}
