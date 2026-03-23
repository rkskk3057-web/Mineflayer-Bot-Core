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
let positionTimer: NodeJS.Timeout | null = null;
let eatCooldown = false;

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
    position: store.position,
    kills: store.kills,
    combatEnabled: store.settings.combatEnabled,
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
  if (positionTimer) { clearInterval(positionTimer); positionTimer = null; }
}

export function connect(host: string, port: number, username: string, owner: string): void {
  if (store.connecting || store.connected) return;

  store.connecting = true;
  store.serverHost = host;
  store.serverPort = port;
  store.username = username;
  store.settings.owner = owner;
  store.kills = 0;
  store.position = null;

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

    addLog("connection", `Connected as ${b.username}`);
    if (io) io.emit("bot:connected");

    // ─── Load & configure pathfinder (JUMP FIX) ───
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pf = globalThis.require?.("mineflayer-pathfinder");
      if (pf?.pathfinder) {
        b.loadPlugin(pf.pathfinder);

        if (pf.Movements) {
          const movements = new pf.Movements(b);
          // Allow jumping over 1-block heights and parkour gaps
          movements.canJump = true;
          movements.allowParkour = true;
          movements.allowSprinting = true;
          // Don't break blocks during pathfinding
          movements.canDig = false;
          // Allow dropping down up to 4 blocks
          movements.maxDropDown = 4;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (b.pathfinder as any).setMovements(movements);
          // Give pathfinder more time to calculate routes
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (b.pathfinder as any).thinkTimeout = 8000;
        }

        addLog("info", "Pathfinder ready — jump & sprint enabled");
      }
    } catch {
      addLog("warn", "Pathfinder unavailable — movement disabled");
    }

    startStatusBroadcast();

    // Update ping every 5s (not every physics tick)
    pingTimer = setInterval(() => {
      store.ping = b.player?.ping ?? 0;
    }, 5000);

    // Update position every 2s
    positionTimer = setInterval(() => {
      if (b.entity?.position) {
        const p = b.entity.position;
        store.position = {
          x: Math.round(p.x * 10) / 10,
          y: Math.round(p.y * 10) / 10,
          z: Math.round(p.z * 10) / 10,
        };
      }
    }, 2000);

    startAI(b);
    equipBestWeapon(b);
  });

  // ─── Health & auto-eat ───
  b.on("health", () => {
    store.health = b.health ?? 20;
    store.food = b.food ?? 20;

    // Low HP while in combat → retreat
    if ((b.health ?? 20) <= 5 && store.state === "COMBAT") {
      addLog("warn", `Low HP (${(b.health ?? 0).toFixed(1)}) — retreating`);
      forceState("IDLE");
      clearTarget();
    }

    // Auto-eat when food is low
    if (store.settings.autoEat && !eatCooldown && (b.food ?? 20) <= 14) {
      tryAutoEat(b);
    }
  });

  // ─── Kill tracking ───
  b.on("entityDead", (entity) => {
    if (!entity || entity === b.entity) return;
    // Count only entities the bot was targeting or in combat with
    if (store.state === "COMBAT" || store.currentTarget !== null) {
      const name = entity.name ?? entity.type ?? "entity";
      store.kills++;
      addLog("combat", `Eliminated: ${name} (total kills: ${store.kills})`);
    }
  });

  // ─── Owner join/leave ───
  b.on("playerJoined", (player) => {
    const isOwner = player.username === store.settings.owner;
    if (!isOwner) return;
    store.ownerOnline = true;
    addLog("info", `Owner ${player.username} joined`);
    if (store.state === "AUTONOMOUS") {
      forceState("FOLLOW");
    }
  });

  b.on("playerLeft", (player) => {
    const isOwner = player.username === store.settings.owner;
    if (!isOwner) return;
    store.ownerOnline = false;
    addLog("info", `Owner ${player.username} left`);
    if (store.state === "FOLLOW") {
      forceState(store.autonomousMode ? "AUTONOMOUS" : "IDLE");
    }
  });

  // ─── Protect owner when hurt ───
  b.on("entityHurt", (entity) => {
    if (!b.entity) return;

    if (entity === b.entity) {
      addLog("combat", `Bot took damage — HP: ${(b.health ?? 0).toFixed(1)}`);
      return;
    }

    if (!store.settings.combatEnabled) return;
    const ownerName = store.settings.owner;
    if (!ownerName || store.state === "COMBAT") return;

    const ownerPlayer = b.players[ownerName];
    if (ownerPlayer?.entity !== entity) return;

    addLog("combat", "Owner under attack!");
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

  // ─── Chat ───
  b.on("message", (msg) => {
    const text = msg.toString().trim();
    if (!text) return;
    const logEntry = addLog("info", `[Chat] ${text}`);
    if (io) io.emit("bot:log", logEntry);
    if (io) io.emit("bot:chat", { message: text, timestamp: new Date().toISOString() });
  });

  b.on("kicked", (reason) => {
    addLog("connection", `Kicked: ${reason}`);
    handleDisconnect("Kicked");
  });

  b.on("error", (err) => {
    if (!err.message.includes("ECONNRESET") && !err.message.includes("EPIPE")) {
      addLog("error", `Error: ${err.message}`);
    }
  });

  b.once("end", (reason) => {
    addLog("connection", `Session ended: ${reason}`);
    handleDisconnect(reason);
  });
}

// ─── Auto-eat ─────────────────────────────────────────────────────────────
function tryAutoEat(b: Bot): void {
  const foodItems = new Set([
    "bread", "cooked_beef", "cooked_chicken", "cooked_porkchop",
    "cooked_mutton", "cooked_rabbit", "cooked_salmon", "cooked_cod",
    "golden_apple", "apple", "carrot", "potato", "baked_potato",
    "beef", "porkchop", "chicken", "mutton", "melon_slice",
  ]);

  const food = b.inventory.items().find((i) => foodItems.has(i.name));
  if (!food) return;

  eatCooldown = true;
  b.equip(food, "hand")
    .then(() => b.consume())
    .then(() => {
      addLog("info", `Auto-ate: ${food.name}`);
    })
    .catch(() => { /* silent */ })
    .finally(() => {
      setTimeout(() => { eatCooldown = false; }, 3000);
    });
}

// ─── Disconnect ───────────────────────────────────────────────────────────
function handleDisconnect(reason: string): void {
  if (!store.connected && !store.connecting) return;

  store.connected = false;
  store.connecting = false;
  store.state = "DISCONNECTED";
  store.health = 20;
  store.food = 20;
  store.ping = 0;
  store.nearbyPlayers = 0;
  store.currentTarget = null;
  store.ownerOnline = false;
  store.position = null;

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
  store.position = null;

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

// ─── Chat ─────────────────────────────────────────────────────────────────
export function sendChat(message: string): { success: boolean; message: string } {
  if (!bot || !store.connected) return { success: false, message: "Bot not connected" };
  try {
    bot.chat(message);
    addLog("info", `[Chat sent] ${message}`);
    return { success: true, message: "Message sent" };
  } catch {
    return { success: false, message: "Failed to send chat" };
  }
}

// ─── Inventory ────────────────────────────────────────────────────────────
export function getInventory() {
  if (!bot || !store.connected) return { items: [] };
  const items = bot.inventory.items().map((item) => ({
    name: item.name,
    displayName: item.displayName,
    count: item.count,
    slot: item.slot,
  }));
  return { items };
}

// ─── Weapon equip ─────────────────────────────────────────────────────────
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

// ─── Exports ──────────────────────────────────────────────────────────────
export function getCurrentStatus() {
  return getBotStatusData();
}

export function forceState(state: BotState): void {
  const prev = store.state;
  store.state = state;
  if (prev !== state) {
    const logEntry = addLog("state", `State: ${prev} → ${state}`);
    if (io) io.emit("bot:log", logEntry);
  }
}

export function setState(state: BotState): void {
  forceState(state);
}

export function sendCommand(command: string, value?: string): { success: boolean; message: string } {
  if (!store.connected) return { success: false, message: "Bot is not connected" };

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
        try { (bot.pathfinder as unknown as { setGoal: (g: null) => void }).setGoal(null); } catch { /* ignore */ }
      }
      return { success: true, message: "Stopped" };

    case "attack_nearest": {
      if (!bot) return { success: false, message: "No bot" };
      if (!store.settings.combatEnabled) return { success: false, message: "Combat disabled" };
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
      addLog("state", `Autonomous: ${store.autonomousMode ? "ON" : "OFF"}`);
      return { success: true, message: `Autonomous: ${store.autonomousMode ? "ON" : "OFF"}` };

    case "toggle_combat":
      store.settings.combatEnabled = !store.settings.combatEnabled;
      addLog("state", `Combat: ${store.settings.combatEnabled ? "ON" : "OFF"}`);
      return { success: true, message: `Combat: ${store.settings.combatEnabled ? "ENABLED" : "DISABLED"}` };

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
