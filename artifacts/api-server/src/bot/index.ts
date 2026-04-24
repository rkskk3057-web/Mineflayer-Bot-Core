import mineflayer, { type Bot } from "mineflayer";
import { store } from "./store.js";
import { addLog } from "./logger.js";
import { startAI, stopAI } from "./ai.js";
import { clearTarget, findNearestHostile, lockTarget } from "./combat.js";
import {
  equipBestArmor, equipBestWeapon, setSneaking,
  tickSwimming, resetAbilityTimers,
} from "./abilities.js";
import { getCloneCount } from "./clones.js";
import type { BotState } from "./state.js";
import { io } from "../socket.js";

let bot: Bot | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;
let statusTimer: NodeJS.Timeout | null = null;
let pingTimer: NodeJS.Timeout | null = null;
let positionTimer: NodeJS.Timeout | null = null;
let eatCooldown = false;

// Kill tracking: set to track which entity IDs the bot last attacked
// so we can attribute deaths correctly even if state changes first
let lastAttackedEntityIds = new Set<number>();

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
    lastError: store.lastError,
    connectAttempts: store.connectAttempts,
    version: store.version,
  };
}

const MAX_RECONNECT_ATTEMPTS = 5;

function startStatusBroadcast(): void {
  stopStatusBroadcast();
  statusTimer = setInterval(() => {
    io.emit("bot:status", getBotStatusData());
  }, 1000);
}

function stopStatusBroadcast(): void {
  if (statusTimer)   { clearInterval(statusTimer);   statusTimer = null; }
  if (pingTimer)     { clearInterval(pingTimer);      pingTimer = null; }
  if (positionTimer) { clearInterval(positionTimer);  positionTimer = null; }
}

export function connect(host: string, port: number, username: string, owner: string, version?: string): void {
  if (store.connecting || store.connected) return;

  // Cancel any pending reconnect timer when a fresh connect is requested
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }

  // If host/port/username/version changed, treat as a fresh session (reset attempt counter)
  const isNewSession =
    host !== store.serverHost ||
    port !== store.serverPort ||
    username !== store.username ||
    (version ?? "") !== store.version;
  if (isNewSession) {
    store.connectAttempts = 0;
    store.lastError = null;
  }

  store.connecting = true;
  store.serverHost = host;
  store.serverPort = port;
  store.username = username;
  store.version = version ?? "";
  store.connectAttempts++;
  if (owner) store.settings.owner = owner;

  // Reset all tracked state
  store.kills = 0;
  store.deaths = 0;
  store.position = null;
  store.ownerOnline = false;
  store.sneaking = false;
  store.isSwimming = false;
  lastAttackedEntityIds = new Set();
  resetAbilityTimers();

  const versionLabel = version ? `v${version}` : "auto-detect";
  addLog(
    "connection",
    `Connecting to ${host}:${port} as ${username} (${versionLabel}, attempt ${store.connectAttempts}/${MAX_RECONNECT_ATTEMPTS})…`,
  );

  try {
    const opts: Parameters<typeof mineflayer.createBot>[0] = {
      host,
      port,
      username,
      auth: "offline",
      hideErrors: true,
      checkTimeoutInterval: 30_000,
    };
    if (version && version.trim()) {
      opts.version = version.trim();
    }
    bot = mineflayer.createBot(opts);
    setupBotEvents(bot);
  } catch (err) {
    const msg = (err as Error)?.message ?? String(err);
    store.lastError = msg;
    store.connecting = false;
    addLog("error", `Failed to create bot: ${msg}`);
    io.emit("bot:status", getBotStatusData());
    scheduleReconnect();
  }
}

function scheduleReconnect(): void {
  if (!store.settings.autoReconnect || !store.serverHost) return;
  if (store.connectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    addLog(
      "error",
      `Reconnect aborted after ${MAX_RECONNECT_ATTEMPTS} failed attempts. Last error: ${store.lastError ?? "unknown"}. Use the dashboard to reconnect manually.`,
    );
    io.emit("bot:status", getBotStatusData());
    return;
  }
  const baseDelay = store.settings.reconnectDelay || 5000;
  // Exponential backoff: 1×, 2×, 3×, 4×, 5× — capped at 60s
  const delay = Math.min(baseDelay * store.connectAttempts, 60_000);
  addLog("connection", `Auto-reconnecting in ${Math.round(delay / 1000)}s (attempt ${store.connectAttempts + 1}/${MAX_RECONNECT_ATTEMPTS})…`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect(store.serverHost, store.serverPort, store.username, store.settings.owner, store.version);
  }, delay);
}

function setupBotEvents(b: Bot): void {

  b.once("spawn", () => {
    store.connected = true;
    store.connecting = false;
    store.state = "IDLE";
    store.startTime = Date.now();
    store.lastError = null;
    store.connectAttempts = 0;        // Reset on successful spawn
    store.version = b.version ?? store.version;

    addLog("connection", `Connected as ${b.username} (v${b.version})`);
    io.emit("bot:connected");

    // ── Load pathfinder ──────────────────────────────────────────────────────
    // allowParkour=false: prevents erratic leaps across gaps
    // The pathfinder still handles step-up (1-block height), water navigation,
    // and normal terrain — just no horizontal gap-jumping
    let pathfinderLoaded = false;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pf = globalThis.require?.("mineflayer-pathfinder");
      if (pf?.pathfinder) {
        b.loadPlugin(pf.pathfinder);
        if (pf.Movements) {
          const movements = new pf.Movements(b);
          movements.canDig        = false;  // never break blocks
          movements.allowParkour  = false;  // no gap-jumping (fixes erratic leaps)
          movements.allowSprinting = true;  // sprint when following
          movements.maxDropDown   = 4;      // can step down up to 4 blocks
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (b.pathfinder as any).setMovements(movements);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (b.pathfinder as any).thinkTimeout = 8000;
          pathfinderLoaded = true;
        }
      }
    } catch (e) {
      addLog("warn", `Pathfinder failed to load: ${String(e)}`);
    }
    addLog("info", pathfinderLoaded ? "Pathfinder active" : "Pathfinder unavailable — movement disabled");

    // ── Physics tick ─────────────────────────────────────────────────────────
    // Runs every game tick (~50ms). Keep it very lean.
    // Swimming fix: bot.entity.isInWater is the correct way to detect water.
    // When in water, set jump=true so the bot swims up (not sinks).
    // When leaving water, we clear jump to prevent runaway jumping.
    b.on("physicsTick", () => {
      tickSwimming(b);
    });

    // ── Owner detection: check immediately + at 3s + 8s ─────────────────────
    // If the owner was already online when bot spawned, playerJoined never fires.
    checkOwnerOnline(b);
    setTimeout(() => { if (store.connected) checkOwnerOnline(b); }, 3000);
    setTimeout(() => { if (store.connected) checkOwnerOnline(b); }, 8000);

    startStatusBroadcast();

    // Ping polled every 5s — not every tick (reduces CPU)
    pingTimer = setInterval(() => {
      if (b.player) store.ping = b.player.ping ?? 0;
    }, 5000);

    // Position updated every 2s
    positionTimer = setInterval(() => {
      const p = b.entity?.position;
      if (p) {
        store.position = {
          x: Math.round(p.x * 10) / 10,
          y: Math.round(p.y * 10) / 10,
          z: Math.round(p.z * 10) / 10,
        };
      }
    }, 2000);

    // Equip best gear with a short delay (inventory may not be loaded yet)
    setTimeout(() => {
      equipBestWeapon(b);
      equipBestArmor(b);
    }, 2000);

    startAI(b);
  });

  // ── Health / auto-eat ─────────────────────────────────────────────────────
  b.on("health", () => {
    store.health = b.health ?? 20;
    store.food   = b.food   ?? 20;

    if ((b.health ?? 20) <= 5 && store.state === "COMBAT") {
      addLog("warn", `Low HP (${store.health.toFixed(1)}) — retreating`);
      forceState("IDLE");
      clearTarget();
      lastAttackedEntityIds.clear();
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
    addLog("warn", `Died — respawning (deaths: ${store.deaths})`);
    store.state = "IDLE";
    store.sneaking = false;
    clearTarget();
    lastAttackedEntityIds.clear();
    io.emit("bot:death", { deaths: store.deaths });
    setTimeout(() => {
      try {
        b.respawn();
        addLog("info", "Respawned");
        // Re-equip after respawn
        setTimeout(() => {
          equipBestWeapon(b);
          equipBestArmor(b);
        }, 2000);
      } catch { /* ignore */ }
    }, 1500);
  });

  // ── Kill tracking ─────────────────────────────────────────────────────────
  // Track which entities the bot attacked (by ID). When any entity dies,
  // if we attacked it, count it as a kill — regardless of current state/target.
  b.on("entityDead", (entity) => {
    if (!entity || entity === b.entity) return;
    // Count if: we recently attacked this entity OR we're in active combat nearby
    const wasOurTarget = lastAttackedEntityIds.has(entity.id);
    const nearbyKill = (store.state === "COMBAT") &&
      bot?.entity?.position &&
      entity.position &&
      bot.entity.position.distanceTo(entity.position) < 10;

    if (wasOurTarget || nearbyKill) {
      const name = entity.name ?? entity.type ?? "entity";
      store.kills++;
      lastAttackedEntityIds.delete(entity.id);
      const entry = addLog("combat", `Killed: ${name} | total: ${store.kills}`);
      io.emit("bot:log", entry);
      io.emit("bot:kill", { kills: store.kills, target: name });
      // Re-equip best weapon after fight
      setTimeout(() => equipBestWeapon(b), 500);
    }
  });

  // ── Track attack hits (for kill attribution) ─────────────────────────────
  b.on("entityHurt", (entity) => {
    if (!b.entity) return;
    if (entity === b.entity) {
      store.health = b.health ?? 20;
      addLog("combat", `Took damage — HP: ${store.health.toFixed(1)}`);
      return;
    }

    // If we attacked this entity, add it to our "kill credit" set
    if (store.state === "COMBAT" && store.currentTarget &&
        entity.name === store.currentTarget) {
      lastAttackedEntityIds.add(entity.id);
    }

    // Protect owner
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
        lastAttackedEntityIds.add(hostile.id);
        forceState("COMBAT");
      }
    }, 150);
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

  // ── In-game chat bridge + owner commands ─────────────────────────────────
  b.on("message", (msg) => {
    const text = msg.toString().trim();
    if (!text) return;
    const entry = addLog("info", `[Chat] ${text}`);
    io.emit("bot:log", entry);
    io.emit("bot:chat", { message: text, timestamp: new Date().toISOString() });
    handleOwnerChatCommand(b, text);
  });

  // ── Whisper (private message) ─────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (b as any).on("whisper", (username: string, message: string) => {
    if (!isOwner(username)) return;
    addLog("info", `[Whisper from ${username}] ${message}`);
    handleOwnerDirectCommand(b, message.trim().toLowerCase());
  });

  b.on("kicked", (reason) => {
    const reasonStr = String(reason);
    store.lastError = `Kicked: ${reasonStr}`;
    addLog("connection", `Kicked: ${reasonStr}`);
    handleDisconnect("kicked");
  });

  b.on("error", (err) => {
    const msg = err?.message ?? String(err);
    // Translate common low-level errors into user-friendly explanations
    let friendly = msg;
    if (msg.includes("ECONNREFUSED")) {
      friendly = "Server refused the connection — it may be offline, on a different port, or blocking this IP.";
    } else if (msg.includes("ETIMEDOUT")) {
      friendly = "Connection timed out — server is unreachable.";
    } else if (msg.includes("ENOTFOUND") || msg.includes("EAI_AGAIN")) {
      friendly = "Server hostname could not be resolved — check the address.";
    } else if (msg.toLowerCase().includes("unsupported protocol") || msg.toLowerCase().includes("version")) {
      friendly = `Version mismatch — try selecting a specific Minecraft version. (${msg})`;
    }
    store.lastError = friendly;
    addLog("error", friendly);
    io.emit("bot:status", getBotStatusData());
  });

  b.once("end", (reason) => {
    const reasonStr = String(reason);
    addLog("connection", `Connection ended: ${reasonStr}`);
    if (!store.lastError) {
      store.lastError = `Connection ended: ${reasonStr}`;
    }
    handleDisconnect(reasonStr);
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
  if (!wasOnline && store.ownerOnline && ownerPlayer) {
    addLog("info", `Owner ${ownerPlayer.username} is online`);
  }
}

// ── Owner chat command parser ─────────────────────────────────────────────────
// Handles multiple server message formats:
//   <username> message       (standard vanilla)
//   [username] message       (some plugins)
//   username: message        (some servers)
//   username whispers...     (some servers)

function handleOwnerChatCommand(b: Bot, text: string): void {
  if (!store.settings.owner) return;

  // Try several common formats
  let sender: string | null = null;
  let cmd: string | null = null;

  const patterns = [
    /^<([^>]+)>\s+(.+)$/,           // <username> message
    /^\[([^\]]+)\]\s+(.+)$/,        // [username] message
    /^([A-Za-z0-9_]{1,16}):\s+(.+)$/, // username: message
  ];

  for (const pat of patterns) {
    const m = text.match(pat);
    if (m) { sender = m[1]; cmd = m[2]; break; }
  }

  if (!sender || !cmd) return;
  if (!isOwner(sender)) return;
  handleOwnerDirectCommand(b, cmd.trim().toLowerCase());
}

export function handleOwnerDirectCommand(b: Bot, command: string): void {
  addLog("info", `Owner cmd: ${command}`);

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
      if (store.waypoints.length > 0) { forceState("PATROL"); b.chat("Patrolling."); }
      else { b.chat("No waypoints set."); }
      break;

    case "fight": case "attack": {
      if (!store.settings.combatEnabled) { b.chat("Combat is disabled."); break; }
      const h = findNearestHostile(b);
      if (h) {
        lockTarget(h.id);
        store.currentTarget = h.name;
        lastAttackedEntityIds.add(h.id);
        forceState("COMBAT");
        b.chat(`Engaging ${h.name}!`);
      } else { b.chat("No targets."); }
      break;
    }

    case "sneak":
      setSneaking(b, !store.sneaking);
      b.chat(`Sneaking: ${store.sneaking ? "ON" : "OFF"}`);
      break;

    case "auto": case "autonomous":
      store.autonomousMode = !store.autonomousMode;
      b.chat(`Autonomous: ${store.autonomousMode ? "ON" : "OFF"}`);
      break;

    case "combat":
      store.settings.combatEnabled = !store.settings.combatEnabled;
      b.chat(`Combat: ${store.settings.combatEnabled ? "ENABLED" : "DISABLED"}`);
      break;

    case "hp": case "health":
      b.chat(`HP: ${(b.health ?? 20).toFixed(1)}/20 | Food: ${b.food ?? 20}/20`);
      break;

    case "stats":
      b.chat(`Kills: ${store.kills} | Deaths: ${store.deaths} | State: ${store.state}`);
      break;

    case "pos": case "position": {
      const p = b.entity?.position;
      if (p) b.chat(`Pos: ${Math.round(p.x)}, ${Math.round(p.y)}, ${Math.round(p.z)}`);
      break;
    }

    case "help":
      b.chat("Commands: come, stay, guard, patrol, fight, sneak, auto, combat, hp, stats, pos");
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
  const priority = [
    "golden_apple", "enchanted_golden_apple",
    "cooked_beef", "cooked_porkchop", "cooked_mutton",
    "cooked_chicken", "cooked_salmon", "cooked_cod",
    "bread", "baked_potato", "apple", "carrot", "melon_slice",
    "beef", "porkchop", "chicken",
  ];

  const food = priority
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

  store.connected   = false;
  store.connecting  = false;
  store.state       = "DISCONNECTED";
  store.health      = 20;
  store.food        = 20;
  store.ping        = 0;
  store.nearbyPlayers = 0;
  store.currentTarget = null;
  store.ownerOnline = false;
  store.position    = null;
  store.sneaking    = false;
  store.isSwimming  = false;
  lastAttackedEntityIds.clear();

  stopAI();
  clearTarget();
  stopStatusBroadcast();

  io.emit("bot:disconnected", { reason });
  io.emit("bot:status", getBotStatusData());

  bot = null;

  scheduleReconnect();
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

  store.connected   = false;
  store.connecting  = false;
  store.state       = "DISCONNECTED";
  store.position    = null;
  store.sneaking    = false;
  store.connectAttempts = 0;     // Reset so user can connect again immediately
  store.lastError = null;

  io.emit("bot:disconnected", { reason: "manual" });
  io.emit("bot:status", getBotStatusData());
  addLog("connection", "Disconnected manually");
}

export function reconnect(): void {
  const { serverHost, serverPort, username, version } = store;
  const owner = store.settings.owner;
  if (!serverHost) { addLog("warn", "No server configured"); return; }
  disconnect();
  setTimeout(() => connect(serverHost, serverPort, username, owner, version), 1500);
}

// ── Chat / Inventory ──────────────────────────────────────────────────────────

export function sendChat(message: string): { success: boolean; message: string } {
  if (!bot || !store.connected) return { success: false, message: "Bot not connected" };
  try {
    bot.chat(message);
    addLog("info", `[Sent] ${message}`);
    return { success: true, message: "Sent" };
  } catch (e) {
    return { success: false, message: `Failed: ${String(e)}` };
  }
}

export function getInventory() {
  if (!bot || !store.connected) return { items: [], equipped: [] };

  const equipped = [
    { slot: "mainhand", item: bot.heldItem },
    { slot: "head",     item: bot.inventory.slots[5] },
    { slot: "chest",    item: bot.inventory.slots[6] },
    { slot: "legs",     item: bot.inventory.slots[7] },
    { slot: "feet",     item: bot.inventory.slots[8] },
    { slot: "offhand",  item: bot.inventory.slots[45] },
  ].filter(e => e.item).map(e => ({
    name: e.item!.name,
    displayName: e.item!.displayName,
    count: e.item!.count,
    slot: -1,
    equippedAs: e.slot,
  }));

  const items = bot.inventory.items().map(item => ({
    name: item.name,
    displayName: item.displayName,
    count: item.count,
    slot: item.slot,
    durability: (item as unknown as { durabilityUsed?: number }).durabilityUsed ?? 0,
  }));

  return { items, equipped };
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
  if (!store.connected) return { success: false, message: "Bot not connected" };

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
      return { success: true, message: `Patrolling ${store.waypoints.length} waypoints` };

    case "stop":
      forceState("IDLE");
      clearTarget();
      lastAttackedEntityIds.clear();
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
        lastAttackedEntityIds.add(hostile.id);
        forceState("COMBAT");
        return { success: true, message: `Attacking ${hostile.name}` };
      }
      return { success: false, message: "No hostile nearby" };
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
        return { success: true, message: `Owner: ${value}` };
      }
      return { success: false, message: "No owner specified" };

    case "check_owner":
      if (bot) checkOwnerOnline(bot);
      return { success: true, message: `Owner online: ${store.ownerOnline}` };

    case "equip_weapon":
      if (bot) equipBestWeapon(bot);
      return { success: true, message: "Equipped best weapon" };

    case "equip_armor":
      if (bot) equipBestArmor(bot);
      return { success: true, message: "Equipped best armor" };

    default:
      return { success: false, message: `Unknown command: ${command}` };
  }
}
