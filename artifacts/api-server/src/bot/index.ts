import mineflayer, { type Bot } from "mineflayer";
import { store } from "./store.js";
import { addLog } from "./logger.js";
import { startAI, stopAI, changeState } from "./ai.js";
import { clearTarget, findNearestHostile, lockTarget } from "./combat.js";
import type { BotState } from "./state.js";
import type { Server as IOServer } from "socket.io";

let bot: Bot | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;
let io: IOServer | null = null;
let statusTimer: NodeJS.Timeout | null = null;
let pingTimer: NodeJS.Timeout | null = null;

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
  if (statusTimer) { clearInterval(statusTimer); statusTimer = null; }
  if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
}

export function connect(host: string, port: number, username: string, owner: string): void {
  // Guard against duplicate connections
  if (store.connecting || store.connected) return;

  store.connecting = true;
  store.serverHost = host;
  store.serverPort = port;
  store.username = username;
  store.settings.owner = owner;

  addLog("connection", `Connecting to ${host}:${port} as ${username}…`);

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

    // Load pathfinder and configure movement capabilities
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pf = globalThis.require?.("mineflayer-pathfinder");
      if (pf?.pathfinder) {
        b.loadPlugin(pf.pathfinder);

        // Configure movement: allow jumping and climbing
        if (pf.Movements) {
          const movements = new pf.Movements(b);
          movements.canJump = true;
          movements.canDigStone = false;
          movements.canDigWood = false;
          movements.allowParkour = true;
          movements.allowSprinting = true;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (b.pathfinder as any).setMovements(movements);
        }

        addLog("info", "Pathfinder loaded with jump + sprint");
      }
    } catch {
      addLog("warn", "Pathfinder unavailable — movement disabled");
    }

    startStatusBroadcast();

    // Update ping every 5 seconds (not every physics tick)
    pingTimer = setInterval(() => {
      store.ping = b.player?.ping ?? 0;
    }, 5000);

    startAI(b);
    equipBestWeapon(b);
  });

  b.on("health", () => {
    store.health = b.health ?? 20;
    store.food = b.food ?? 20;

    // Low HP in combat → retreat
    if ((b.health ?? 20) <= 5 && store.state === "COMBAT") {
      addLog("warn", `Low HP (${(b.health ?? 0).toFixed(1)}) — retreating`);
      forceState("IDLE");
      clearTarget();
    }
  });

  b.on("playerJoined", (player) => {
    const isOwner = player.username === store.settings.owner;
    if (!isOwner) return;

    store.ownerOnline = true;
    addLog("info", `Owner ${player.username} joined`);

    if (store.state === "AUTONOMOUS") {
      forceState("FOLLOW");
      addLog("state", "Owner online — switching to FOLLOW");
    }
  });

  b.on("playerLeft", (player) => {
    const isOwner = player.username === store.settings.owner;
    if (!isOwner) return;

    store.ownerOnline = false;
    addLog("info", `Owner ${player.username} left`);

    if (store.state === "FOLLOW") {
      if (store.autonomousMode) {
        forceState("AUTONOMOUS");
        addLog("state", "Owner offline — switching to AUTONOMOUS");
      } else {
        forceState("IDLE");
        addLog("state", "Owner offline — switching to IDLE");
      }
    }
  });

  b.on("entityHurt", (entity) => {
    if (!b.entity) return;

    // Bot itself hurt
    if (entity === b.entity) {
      addLog("combat", `Bot took damage! HP: ${(b.health ?? 0).toFixed(1)}`);
      return;
    }

    // Owner hurt → engage attacker
    const ownerName = store.settings.owner;
    if (!ownerName || store.state === "COMBAT") return;

    const ownerPlayer = b.players[ownerName];
    if (ownerPlayer?.entity !== entity) return;

    addLog("combat", "Owner under attack!");
    // Small delay to debounce rapid hits
    setTimeout(() => {
      if (store.state === "COMBAT") return;
      const hostile = findNearestHostile(b);
      if (hostile) {
        lockTarget(hostile.id);
        store.currentTarget = hostile.name;
        forceState("COMBAT");
      }
    }, 300);
  });

  b.on("message", (msg) => {
    const text = msg.toString().trim();
    if (!text) return;
    // Log chat but don't spam every message
    const logEntry = addLog("info", `[Chat] ${text}`);
    if (io) io.emit("bot:log", logEntry);
  });

  b.on("kicked", (reason) => {
    addLog("connection", `Kicked: ${reason}`);
    handleDisconnect(`Kicked`);
  });

  b.on("error", (err) => {
    // Only log meaningful errors
    if (!err.message.includes("ECONNRESET") && !err.message.includes("EPIPE")) {
      addLog("error", `Error: ${err.message}`);
    }
  });

  b.once("end", (reason) => {
    addLog("connection", `Session ended: ${reason}`);
    handleDisconnect(reason);
  });
}

function handleDisconnect(reason: string): void {
  if (!store.connected && !store.connecting) return; // already cleaned up

  store.connected = false;
  store.connecting = false;
  store.state = "DISCONNECTED";
  store.health = 20;
  store.food = 20;
  store.ping = 0;
  store.nearbyPlayers = 0;
  store.currentTarget = null;
  store.ownerOnline = false;

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
    addLog("connection", `Auto-reconnecting in ${delay / 1000}s…`);
    reconnectTimer = setTimeout(() => {
      connect(store.serverHost, store.serverPort, store.username, store.settings.owner);
    }, delay);
  }
}

export function disconnect(): void {
  // Cancel any pending auto-reconnect
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }

  stopAI();
  clearTarget();
  stopStatusBroadcast();

  if (bot) {
    try { bot.quit(); } catch { /* ignore */ }
    bot = null;
  }

  store.connected = false;
  store.connecting = false;
  store.state = "DISCONNECTED";

  if (io) io.emit("bot:disconnected", { reason: "manual" });
  addLog("connection", "Disconnected");
}

export function reconnect(): void {
  const { serverHost, serverPort, username } = store;
  const owner = store.settings.owner;
  if (!serverHost) { addLog("warn", "No server configured"); return; }
  disconnect();
  setTimeout(() => connect(serverHost, serverPort, username, owner), 1500);
}

function equipBestWeapon(b: Bot): void {
  const priority = [
    "netherite_sword", "diamond_sword", "iron_sword", "stone_sword", "wooden_sword",
    "netherite_axe", "diamond_axe", "iron_axe",
  ];
  for (const name of priority) {
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

// Force a state change bypassing cooldown — for system-level transitions
export function forceState(state: BotState): void {
  const prev = store.state;
  store.state = state;
  if (prev !== state) {
    const logEntry = addLog("state", `State: ${prev} → ${state}`);
    if (io) io.emit("bot:log", logEntry);
  }
}

// For dashboard commands — uses the same export name as before
export function setState(state: BotState): void {
  forceState(state);
}

export function sendCommand(command: string, value?: string): { success: boolean; message: string } {
  if (!store.connected) {
    return { success: false, message: "Bot is not connected" };
  }

  switch (command) {
    case "follow":
      forceState("FOLLOW");
      return { success: true, message: "Following owner" };

    case "guard":
      forceState("GUARD");
      return { success: true, message: "Guarding area" };

    case "stop":
      forceState("IDLE");
      clearTarget();
      if (bot?.pathfinder) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (bot.pathfinder as any).setGoal(null);
        } catch { /* ignore */ }
      }
      return { success: true, message: "Stopped" };

    case "attack_nearest": {
      if (!bot) return { success: false, message: "No bot" };
      const hostile = findNearestHostile(bot);
      if (hostile) {
        lockTarget(hostile.id);
        store.currentTarget = hostile.name;
        forceState("COMBAT");
        return { success: true, message: `Attacking ${hostile.name}` };
      }
      return { success: false, message: "No hostile found nearby" };
    }

    case "toggle_autonomous":
      store.autonomousMode = !store.autonomousMode;
      addLog("state", `Autonomous mode: ${store.autonomousMode ? "ON" : "OFF"}`);
      return { success: true, message: `Autonomous: ${store.autonomousMode ? "ON" : "OFF"}` };

    case "set_owner":
      if (value) {
        store.settings.owner = value;
        addLog("info", `Owner: ${value}`);
        return { success: true, message: `Owner set to ${value}` };
      }
      return { success: false, message: "No owner specified" };

    default:
      return { success: false, message: `Unknown command: ${command}` };
  }
}
