import mineflayer, { type Bot } from "mineflayer";
import { store } from "./store.js";
import { addLog } from "./logger.js";
import { startAI, stopAI } from "./ai.js";
import { clearTarget, findNearestHostile, lockTarget } from "./combat.js";
import { equipBestArmor, equipBestWeapon, setSneaking, tickSwimming } from "./abilities.js";
import { getCloneCount } from "./clones.js";
import type { BotState } from "./state.js";
import { io } from "../socket.js";

let bot: Bot | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;
let statusTimer: NodeJS.Timeout | null = null;
let pingTimer: NodeJS.Timeout | null = null;
let positionTimer: NodeJS.Timeout | null = null;
let eatCooldown = false;

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
    deaths: store.deaths,
    combatEnabled: store.settings.combatEnabled,
    sneaking: store.sneaking,
    isSwimming: store.isSwimming,
    cloneCount: getCloneCount(),
  };
}

function startStatusBroadcast(): void {
  stopStatusBroadcast();
  statusTimer = setInterval(() => {
    io.emit("bot:status", getBotStatusData());
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
  if (owner) store.settings.owner = owner;
  store.kills = 0;
  store.deaths = 0;
  store.position = null;
  store.ownerOnline = false;
  store.sneaking = false;
  store.isSwimming = false;

  addLog("connection", `Connecting to ${host}:${port} as ${username}…`);

  try {
    bot = mineflayer.createBot({
      host,
      port,
      username,
      auth: "offline",
      version: "1.20.4",
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
    io.emit("bot:connected");

    // ── Load pathfinder ──────────────────────────────────────────────────────
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pf = globalThis.require?.("mineflayer-pathfinder");
      if (pf?.pathfinder) {
        b.loadPlugin(pf.pathfinder);
        if (pf.Movements) {
          const movements = new pf.Movements(b);
          movements.canDig = false;
          movements.allowParkour = false;   // no erratic leaps
          movements.allowSprinting = true;
          movements.maxDropDown = 4;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (b.pathfinder as any).setMovements(movements);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (b.pathfinder as any).thinkTimeout = 6000;
        }
        addLog("info", "Pathfinder loaded — stable movement active");
      }
    } catch {
      addLog("warn", "Pathfinder unavailable");
    }

    // ── Physics tick — swimming + sneak sync ─────────────────────────────────
    // This fires every game tick (~50ms). We keep it lean.
    b.on("physicsTick", () => {
      // ── SWIMMING FIX ─────────────────────────────────────────────────────
      // Mineflayer tracks `isInWater` based on the block the bot's feet are in.
      // When in water, we press jump so the bot swims upward instead of sinking.
      // The pathfinder overrides control states for its own navigation — but even
      // then it needs this signal to know the bot should swim rather than walk.
      tickSwimming(b);
    });

    // ── Owner detection ──────────────────────────────────────────────────────
    checkOwnerOnline(b);
    setTimeout(() => checkOwnerOnline(b), 3000);
    setTimeout(() => checkOwnerOnline(b), 8000);

    startStatusBroadcast();

    pingTimer = setInterval(() => {
      store.ping = b.player?.ping ?? 0;
    }, 5000);

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

    // Equip best gear
    setTimeout(() => {
      equipBestWeapon(b);
      equipBestArmor(b);
    }, 1000);

    startAI(b);
  });

  // ── Health / auto-eat ─────────────────────────────────────────────────────
  b.on("health", () => {
    store.health = b.health ?? 20;
    store.food = b.food ?? 20;

    if ((b.health ?? 20) <= 5 && store.state === "COMBAT") {
      addLog("warn", `Low HP (${(b.health ?? 0).toFixed(1)}) — retreating`);
      forceState("IDLE");
      clearTarget();
    }

    if (store.settings.autoEat && !eatCooldown && (b.food ?? 20) <= 14) {
      tryAutoEat(b);
    }
  });

  // ── Auto-respawn + death counter ──────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (b as any).on("death", () => {
    store.health = 0;
    store.deaths++;
    addLog("warn", `Bot died (deaths: ${store.deaths}) — respawning…`);
    store.state = "IDLE";
    store.sneaking = false;
    clearTarget();
    io.emit("bot:death", { deaths: store.deaths });
    setTimeout(() => {
      try {
        b.respawn();
        addLog("info", "Respawned");
        // Re-equip after respawn
        setTimeout(() => { equipBestWeapon(b); equipBestArmor(b); }, 2000);
      } catch { /* ignore */ }
    }, 1500);
  });

  // ── Kill tracking ─────────────────────────────────────────────────────────
  b.on("entityDead", (entity) => {
    if (!entity || entity === b.entity) return;
    if (store.state === "COMBAT" || store.currentTarget !== null) {
      const name = entity.name ?? entity.type ?? "entity";
      store.kills++;
      const entry = addLog("combat", `Eliminated: ${name} | kills: ${store.kills}`);
      io.emit("bot:log", entry);
      io.emit("bot:kill", { kills: store.kills, target: name });
      // Re-equip weapon after fight in case we swapped
      equipBestWeapon(b);
    }
  });

  // ── Owner join/leave ──────────────────────────────────────────────────────
  b.on("playerJoined", (player) => {
    if (!isOwner(player.username)) return;
    store.ownerOnline = true;
    addLog("info", `Owner ${player.username} joined`);
    if (store.state === "AUTONOMOUS" || store.state === "IDLE") {
      forceState("FOLLOW");
    }
  });

  b.on("playerLeft", (player) => {
    if (!isOwner(player.username)) return;
    store.ownerOnline = false;
    addLog("info", `Owner ${player.username} left`);
    if (store.state === "FOLLOW") {
      forceState(store.autonomousMode ? "AUTONOMOUS" : "GUARD");
    }
  });

  // ── Protect owner when hurt ───────────────────────────────────────────────
  b.on("entityHurt", (entity) => {
    if (!b.entity) return;
    if (entity === b.entity) {
      addLog("combat", `Bot took damage — HP: ${(b.health ?? 0).toFixed(1)}`);
      return;
    }
    if (!store.settings.combatEnabled) return;
    if (!store.settings.owner || store.state === "COMBAT") return;
    const ownerPlayer = findOwnerPlayer(b);
    if (ownerPlayer?.entity !== entity) return;
    addLog("combat", "Owner under attack — engaging!");
    setTimeout(() => {
      if (store.state === "COMBAT") return;
      const hostile = findNearestHostile(b);
      if (hostile) {
        lockTarget(hostile.id);
        store.currentTarget = hostile.name;
        forceState("COMBAT");
      }
    }, 200);
  });

  // ── In-game chat: owner commands + bridge ────────────────────────────────
  b.on("message", (msg) => {
    const text = msg.toString().trim();
    if (!text) return;
    const entry = addLog("info", `[Chat] ${text}`);
    io.emit("bot:log", entry);
    io.emit("bot:chat", { message: text, timestamp: new Date().toISOString() });
    handleOwnerChatCommand(b, text);
  });

  // ── Whisper commands (private messages) ──────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (b as any).on("whisper", (username: string, message: string) => {
    if (!isOwner(username)) return;
    addLog("info", `[Whisper] ${username}: ${message}`);
    handleOwnerDirectCommand(b, message.trim().toLowerCase());
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

// ── Owner helpers ─────────────────────────────────────────────────────────────

function isOwner(username: string): boolean {
  const owner = store.settings.owner;
  if (!owner) return false;
  return owner.toLowerCase() === username.toLowerCase();
}

function findOwnerPlayer(b: Bot) {
  const owner = store.settings.owner;
  if (!owner) return null;
  if (b.players[owner]) return b.players[owner];
  const key = Object.keys(b.players).find(k => k.toLowerCase() === owner.toLowerCase());
  return key ? b.players[key] : null;
}

function checkOwnerOnline(b: Bot): void {
  const ownerPlayer = findOwnerPlayer(b);
  const wasOnline = store.ownerOnline;
  store.ownerOnline = ownerPlayer !== null;
  if (!wasOnline && store.ownerOnline) {
    addLog("info", `Owner ${ownerPlayer!.username} is online`);
  }
}

// ── Owner chat commands ───────────────────────────────────────────────────────

function handleOwnerChatCommand(b: Bot, text: string): void {
  const match = text.match(/^<([^>]+)>\s+(.+)$/);
  if (!match) return;
  const [, sender, cmd] = match;
  if (!isOwner(sender)) return;
  handleOwnerDirectCommand(b, cmd.trim().toLowerCase());
}

function handleOwnerDirectCommand(b: Bot, command: string): void {
  addLog("info", `Owner command: ${command}`);
  switch (command) {
    case "come": case "follow":
      forceState("FOLLOW");
      b.chat("Following you!");
      break;
    case "stay": case "stop": case "idle":
      forceState("IDLE");
      stopPathfinder(b);
      setSneaking(b, false);
      b.chat("Standing by.");
      break;
    case "guard":
      forceState("GUARD");
      b.chat("Guarding area.");
      break;
    case "patrol":
      if (store.waypoints.length > 0) {
        forceState("PATROL");
        b.chat("Patrolling waypoints.");
      } else {
        b.chat("No waypoints set.");
      }
      break;
    case "fight": case "attack": {
      if (!store.settings.combatEnabled) { b.chat("Combat is disabled."); break; }
      const hostile = findNearestHostile(b);
      if (hostile) {
        lockTarget(hostile.id);
        store.currentTarget = hostile.name;
        forceState("COMBAT");
        b.chat(`Attacking ${hostile.name}!`);
      } else { b.chat("No targets nearby."); }
      break;
    }
    case "auto": case "autonomous":
      store.autonomousMode = !store.autonomousMode;
      b.chat(`Autonomous: ${store.autonomousMode ? "ON" : "OFF"}`);
      break;
    case "sneak":
      setSneaking(b, !store.sneaking);
      b.chat(`Sneaking: ${store.sneaking ? "ON" : "OFF"}`);
      break;
    case "health": case "hp":
      b.chat(`HP: ${(b.health ?? 20).toFixed(1)}/20 | Food: ${b.food ?? 20}/20`);
      break;
    case "stats":
      b.chat(`Kills: ${store.kills} | Deaths: ${store.deaths} | State: ${store.state}`);
      break;
    case "pos": case "position":
      if (b.entity?.position) {
        const p = b.entity.position;
        b.chat(`Position: ${Math.round(p.x)}, ${Math.round(p.y)}, ${Math.round(p.z)}`);
      }
      break;
  }
}

function stopPathfinder(b: Bot): void {
  try {
    if (b.pathfinder) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (b.pathfinder as any).setGoal(null);
    }
  } catch { /* ignore */ }
}

// ── Auto-eat ──────────────────────────────────────────────────────────────────

function tryAutoEat(b: Bot): void {
  const foodPriority = [
    "golden_apple", "cooked_beef", "cooked_porkchop", "cooked_mutton",
    "cooked_chicken", "cooked_salmon", "cooked_cod", "cooked_rabbit",
    "bread", "baked_potato", "apple", "carrot", "potato", "melon_slice",
    "beef", "porkchop", "chicken",
  ];

  const food = foodPriority
    .map(name => b.inventory.items().find(i => i.name === name))
    .find(Boolean);

  if (!food) return;

  eatCooldown = true;
  b.equip(food, "hand")
    .then(() => b.consume())
    .then(() => addLog("info", `Ate: ${food.name}`))
    .catch(() => { /* silent */ })
    .finally(() => setTimeout(() => { eatCooldown = false; }, 3000));
}

// ── Disconnect ────────────────────────────────────────────────────────────────

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
  store.sneaking = false;
  store.isSwimming = false;

  stopAI();
  clearTarget();
  stopStatusBroadcast();

  io.emit("bot:disconnected", { reason });
  io.emit("bot:status", getBotStatusData());

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
  store.sneaking = false;

  io.emit("bot:disconnected", { reason: "manual" });
  addLog("connection", "Disconnected");
}

export function reconnect(): void {
  const { serverHost, serverPort, username } = store;
  const owner = store.settings.owner;
  if (!serverHost) { addLog("warn", "No server configured"); return; }
  disconnect();
  setTimeout(() => connect(serverHost, serverPort, username, owner), 1500);
}

// ── Chat / Inventory ──────────────────────────────────────────────────────────

export function sendChat(message: string): { success: boolean; message: string } {
  if (!bot || !store.connected) return { success: false, message: "Bot not connected" };
  try {
    bot.chat(message);
    addLog("info", `[Sent] ${message}`);
    return { success: true, message: "Message sent" };
  } catch {
    return { success: false, message: "Failed to send" };
  }
}

export function getInventory() {
  if (!bot || !store.connected) return { items: [] };
  const equipped = [
    { slot: "mainhand", item: bot.heldItem },
    { slot: "head", item: bot.inventory.slots[5] },
    { slot: "chest", item: bot.inventory.slots[6] },
    { slot: "legs", item: bot.inventory.slots[7] },
    { slot: "feet", item: bot.inventory.slots[8] },
  ];

  const items = bot.inventory.items().map(item => ({
    name: item.name,
    displayName: item.displayName,
    count: item.count,
    slot: item.slot,
    durability: (item as unknown as { durabilityUsed?: number }).durabilityUsed ?? 0,
  }));

  const equippedItems = equipped
    .filter(e => e.item)
    .map(e => ({
      name: e.item!.name,
      displayName: e.item!.displayName,
      count: 1,
      slot: -1,
      equippedAs: e.slot,
    }));

  return { items, equipped: equippedItems };
}

// ── Status / State ────────────────────────────────────────────────────────────

export function getCurrentStatus() {
  return getBotStatusData();
}

export function forceState(state: BotState): void {
  const prev = store.state;
  store.state = state;
  if (prev !== state) {
    const entry = addLog("state", `State: ${prev} → ${state}`);
    io.emit("bot:log", entry);
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

    case "patrol":
      if (store.waypoints.length === 0) return { success: false, message: "No waypoints set" };
      forceState("PATROL");
      return { success: true, message: "Patrolling" };

    case "stop":
      forceState("IDLE");
      clearTarget();
      if (bot) stopPathfinder(bot);
      if (bot) setSneaking(bot, false);
      return { success: true, message: "Stopped" };

    case "sneak":
      if (!bot) return { success: false, message: "No bot" };
      setSneaking(bot, !store.sneaking);
      return { success: true, message: `Sneaking: ${store.sneaking ? "ON" : "OFF"}` };

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
      addLog("state", `Combat: ${store.settings.combatEnabled ? "ENABLED" : "DISABLED"}`);
      return { success: true, message: `Combat: ${store.settings.combatEnabled ? "ENABLED" : "DISABLED"}` };

    case "set_owner":
      if (value) {
        store.settings.owner = value;
        addLog("info", `Owner set: ${value}`);
        if (bot) checkOwnerOnline(bot);
        return { success: true, message: `Owner set to ${value}` };
      }
      return { success: false, message: "No owner specified" };

    case "check_owner":
      if (bot) checkOwnerOnline(bot);
      return { success: true, message: `Owner online: ${store.ownerOnline}` };

    case "equip_weapon":
      if (bot) equipBestWeapon(bot);
      return { success: true, message: "Best weapon equipped" };

    case "equip_armor":
      if (bot) equipBestArmor(bot);
      return { success: true, message: "Best armor equipped" };

    default:
      return { success: false, message: `Unknown command: ${command}` };
  }
}
