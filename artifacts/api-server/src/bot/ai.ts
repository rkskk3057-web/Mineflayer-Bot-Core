import type { Bot } from "mineflayer";
import { store, getScanInterval } from "./store.js";
import { addLog } from "./logger.js";
import {
  attackTarget,
  clearTarget,
  findNearestHostile,
  findNearestPlayer,
  hasTarget,
  lockTarget,
} from "./combat.js";
import { getNextPendingTask, pauseAllTasks, resumeTasks, setTaskActive } from "./tasks.js";
import {
  tickAntiAfk,
  tickLootPickup,
  attackWithCrit,
  setSneaking,
  getPatrolIndex,
  nextPatrolIndex,
} from "./abilities.js";

let scanTimer: NodeJS.Timeout | null = null;
let stuckTimer: NodeJS.Timeout | null = null;

let lastOwnerPos: { x: number; y: number; z: number } | null = null;
let lastBotPos: { x: number; z: number } | null = null;
let stuckCount = 0;

let lastStateChangeTime = 0;
const STATE_CHANGE_COOLDOWN_MS = 700;

let lastCombatTriggerTime = 0;
const COMBAT_TRIGGER_COOLDOWN_MS = 1500;

// Cached pathfinder module — loaded once, reused on every tick
let _pf: {
  goals: Record<string, new (...a: unknown[]) => unknown>;
  Movements: new (bot: Bot) => unknown;
} | null = null;

function getPF() {
  if (!_pf) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = globalThis.require?.("mineflayer-pathfinder");
      if (mod?.goals) _pf = mod;
    } catch { /* unavailable */ }
  }
  return _pf;
}

function setGoal(bot: Bot, goal: unknown, dynamic = false): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (bot.pathfinder) (bot.pathfinder as any).setGoal(goal, dynamic);
  } catch { /* ignore */ }
}

function stopMovement(bot: Bot): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (bot.pathfinder) (bot.pathfinder as any).setGoal(null);
  } catch { /* ignore */ }
}

function canChangeState(): boolean {
  return Date.now() - lastStateChangeTime > STATE_CHANGE_COOLDOWN_MS;
}

export function changeState(newState: typeof store.state): boolean {
  if (!canChangeState() && newState !== "DISCONNECTED") return false;
  if (store.state === newState) return false;
  const prev = store.state;
  store.state = newState;
  lastStateChangeTime = Date.now();
  addLog("state", `State: ${prev} → ${newState}`);
  return true;
}

// ── Owner helpers ─────────────────────────────────────────────────────────────

function findOwnerEntry(bot: Bot) {
  const owner = store.settings.owner;
  if (!owner) return null;
  if (bot.players[owner]) return bot.players[owner];
  const key = Object.keys(bot.players).find(k => k.toLowerCase() === owner.toLowerCase());
  return key ? bot.players[key] : null;
}

function syncOwnerOnline(bot: Bot): void {
  const entry = findOwnerEntry(bot);
  store.ownerOnline = entry !== null;
}

// ── AI lifecycle ──────────────────────────────────────────────────────────────

export function startAI(bot: Bot): void {
  stopAI();
  lastBotPos = null;
  lastOwnerPos = null;
  stuckCount = 0;
  _pf = null; // reset cached pathfinder module on reconnect
  scheduleNextScan(bot);
  startStuckDetection(bot);
  addLog("info", "AI started");
}

export function stopAI(): void {
  if (scanTimer)  { clearTimeout(scanTimer);   scanTimer = null; }
  if (stuckTimer) { clearInterval(stuckTimer); stuckTimer = null; }
}

function scheduleNextScan(bot: Bot): void {
  const interval = getScanInterval();
  scanTimer = setTimeout(() => {
    if (store.connected) {
      try { runAITick(bot); } catch { /* suppress — never let tick errors crash the server */ }
      scheduleNextScan(bot);
    }
  }, interval);
}

function runAITick(bot: Bot): void {
  if (!store.connected || store.state === "DISCONNECTED") return;

  // Always sync owner status on every tick (cheapest reliable detection)
  syncOwnerOnline(bot);
  store.nearbyPlayers = countNearbyPlayers(bot);

  // Optional ability sub-systems
  tickAntiAfk(bot);
  tickLootPickup(bot);

  switch (store.state) {
    case "IDLE":       handleIdle(bot);       break;
    case "FOLLOW":     handleFollow(bot);     break;
    case "GUARD":      handleGuard(bot);      break;
    case "COMBAT":     handleCombat(bot);     break;
    case "AUTONOMOUS": handleAutonomous(bot); break;
    case "PATROL":     handlePatrol(bot);     break;
  }
}

// ── IDLE ──────────────────────────────────────────────────────────────────────

function handleIdle(bot: Bot): void {
  // Run any queued tasks first
  const task = getNextPendingTask();
  if (task) { executeTask(bot, task.id, task.type, task.params); return; }

  if (!store.settings.combatEnabled) return;

  // High aggression: attack nearby hostiles even in IDLE
  if (store.settings.aggressionLevel > 6 && canChangeState()) {
    const hostile = findNearestHostile(bot);
    if (hostile) {
      lockTarget(hostile.id);
      store.currentTarget = hostile.name;
      changeState("COMBAT");
      addLog("combat", `Auto-engaging: ${hostile.name}`);
      pauseAllTasks();
    }
  }
}

// ── FOLLOW ────────────────────────────────────────────────────────────────────

function handleFollow(bot: Bot): void {
  const ownerName = store.settings.owner;
  if (!ownerName) { changeState("IDLE"); return; }

  const ownerEntry = findOwnerEntry(bot);
  if (!ownerEntry?.entity) {
    // Owner not visible
    if (store.autonomousMode && canChangeState()) {
      changeState("AUTONOMOUS");
      addLog("state", "Owner not visible — AUTONOMOUS");
    }
    return;
  }

  // Sneak follow: match owner's sneaking if enabled
  if (store.settings.sneakFollow && !store.sneaking) {
    setSneaking(bot, true);
  } else if (!store.settings.sneakFollow && store.sneaking && store.state === "FOLLOW") {
    setSneaking(bot, false);
  }

  // Defend owner from nearby hostiles (when aggression is set)
  if (store.settings.combatEnabled && store.settings.aggressionLevel > 4 && canChangeState()) {
    const now = Date.now();
    if (now - lastCombatTriggerTime > COMBAT_TRIGGER_COOLDOWN_MS) {
      const hostile = findNearestHostile(bot);
      if (hostile) {
        lastCombatTriggerTime = now;
        lockTarget(hostile.id);
        store.currentTarget = hostile.name;
        changeState("COMBAT");
        addLog("combat", `Defending owner — engaging: ${hostile.name}`);
        pauseAllTasks();
        return;
      }
    }
  }

  // Follow movement — only update pathfinder goal when owner moves 1.5+ blocks
  const ownerPos = ownerEntry.entity.position;
  const pf = getPF();
  if (pf && bot.pathfinder && ownerEntry.entity) {
    const ownerMoved = !lastOwnerPos || ownerPos.distanceTo(lastOwnerPos) > 1.5;
    if (ownerMoved) {
      lastOwnerPos = { x: ownerPos.x, y: ownerPos.y, z: ownerPos.z };
      // GoalFollow with dynamic=true: pathfinder continuously replans as entity moves
      const goal = new (pf.goals.GoalFollow as unknown as new (e: unknown, d: number) => unknown)(
        ownerEntry.entity, store.settings.followDistance,
      );
      setGoal(bot, goal, true);
    }
  }
}

// ── GUARD ─────────────────────────────────────────────────────────────────────

function handleGuard(bot: Bot): void {
  if (!canChangeState()) return;
  const now = Date.now();
  if (now - lastCombatTriggerTime < COMBAT_TRIGGER_COOLDOWN_MS) return;
  if (!store.settings.combatEnabled) return;

  const hostile = findNearestHostile(bot);
  if (hostile) {
    lastCombatTriggerTime = now;
    lockTarget(hostile.id);
    store.currentTarget = hostile.name;
    changeState("COMBAT");
    addLog("combat", `Guard: engaging ${hostile.name}`);
    pauseAllTasks();
    return;
  }

  // Very high aggression: attack any non-whitelisted player
  if (store.settings.aggressionLevel >= 9) {
    const threat = findNearestPlayer(bot, true);
    if (threat) {
      lastCombatTriggerTime = now;
      lockTarget(threat.id);
      store.currentTarget = threat.name;
      changeState("COMBAT");
      addLog("combat", `Guard: threat detected — ${threat.name}`);
      pauseAllTasks();
    }
  }
}

// ── COMBAT ────────────────────────────────────────────────────────────────────

function handleCombat(bot: Bot): void {
  if (!hasTarget()) {
    changeState("IDLE");
    store.currentTarget = null;
    resumeTasks();
    stopMovement(bot);
    addLog("combat", "No target — returning to IDLE");
    return;
  }
  if (!store.settings.combatEnabled) {
    clearTarget();
    changeState("IDLE");
    store.currentTarget = null;
    return;
  }
  // Use crit attack when possible
  attackTarget(bot, attackWithCrit);
}

// ── AUTONOMOUS ────────────────────────────────────────────────────────────────

function handleAutonomous(bot: Bot): void {
  // Return to owner immediately when they come online
  if (store.ownerOnline) {
    stopMovement(bot);
    changeState("FOLLOW");
    addLog("state", "Owner online — FOLLOW");
    return;
  }

  // Fight back if a hostile gets close (self-defense in auto mode)
  if (store.settings.combatEnabled) {
    const now = Date.now();
    if (now - lastCombatTriggerTime > COMBAT_TRIGGER_COOLDOWN_MS) {
      const hostile = findNearestHostile(bot);
      if (hostile && bot.entity?.position) {
        const entity = bot.entities[hostile.id];
        if (entity?.position && bot.entity.position.distanceTo(entity.position) < 6) {
          lastCombatTriggerTime = now;
          lockTarget(hostile.id);
          store.currentTarget = hostile.name;
          changeState("COMBAT");
          return;
        }
      }
    }
  }

  // Gentle wander: move to a random nearby point occasionally
  if (Math.random() < 0.015 && bot.entity) {
    const pos = bot.entity.position;
    const dx = (Math.random() - 0.5) * 16;
    const dz = (Math.random() - 0.5) * 16;
    const pf = getPF();
    if (pf && bot.pathfinder) {
      try {
        const goal = new (pf.goals.GoalXZ as unknown as new (x: number, z: number) => unknown)(
          Math.round(pos.x + dx), Math.round(pos.z + dz)
        );
        setGoal(bot, goal, false);
      } catch { /* ignore */ }
    }
  }
}

// ── PATROL ────────────────────────────────────────────────────────────────────

function handlePatrol(bot: Bot): void {
  if (store.waypoints.length === 0) {
    changeState("GUARD");
    return;
  }

  // Owner online → switch to FOLLOW
  if (store.ownerOnline && canChangeState()) {
    changeState("FOLLOW");
    addLog("state", "Owner online — FOLLOW");
    return;
  }

  // Engage hostiles during patrol
  if (store.settings.combatEnabled && canChangeState()) {
    const now = Date.now();
    if (now - lastCombatTriggerTime > COMBAT_TRIGGER_COOLDOWN_MS) {
      const hostile = findNearestHostile(bot);
      if (hostile) {
        lastCombatTriggerTime = now;
        lockTarget(hostile.id);
        store.currentTarget = hostile.name;
        changeState("COMBAT");
        addLog("combat", `Patrol: engaging ${hostile.name}`);
        return;
      }
    }
  }

  // Navigate to current waypoint
  const idx = getPatrolIndex();
  const wp = store.waypoints[idx];
  if (!wp || !bot.entity?.position) return;

  const dist = bot.entity.position.distanceTo({ x: wp.x, y: wp.y, z: wp.z });

  if (dist < 2) {
    nextPatrolIndex(store.waypoints.length);
    addLog("info", `Patrol: reached ${wp.label}`);
  } else {
    const pf = getPF();
    if (pf && bot.pathfinder) {
      try {
        const goal = new (pf.goals.GoalBlock as unknown as new (x: number, y: number, z: number) => unknown)(
          Math.round(wp.x), Math.round(wp.y), Math.round(wp.z)
        );
        setGoal(bot, goal, false);
      } catch { /* ignore */ }
    }
  }
}

// ── TASKS ─────────────────────────────────────────────────────────────────────

function executeTask(bot: Bot, taskId: string, type: string, params: Record<string, unknown>): void {
  setTaskActive(taskId);
  addLog("info", `Task: ${type}`);

  switch (type) {
    case "follow": {
      const target = params.target as string;
      if (target) { store.settings.owner = target; changeState("FOLLOW"); }
      break;
    }
    case "guard_area":
      changeState("GUARD");
      break;
    case "patrol":
      if (store.waypoints.length > 0) changeState("PATROL");
      break;
    case "move_to": {
      const x = Number(params.x ?? 0);
      const z = Number(params.z ?? 0);
      const y = Number(params.y ?? 64);
      const pf = getPF();
      if (pf && bot.pathfinder) {
        try {
          setGoal(bot, new (pf.goals.GoalBlock as unknown as new (x: number, y: number, z: number) => unknown)(
            Math.round(x), Math.round(y), Math.round(z)
          ), false);
        } catch { /* ignore */ }
      }
      break;
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function countNearbyPlayers(bot: Bot): number {
  if (!bot.entity?.position) return 0;
  const radius = store.settings.detectionRadius;
  let count = 0;
  for (const player of Object.values(bot.players)) {
    if (!player.entity || player.entity === bot.entity) continue;
    if (!player.entity.position) continue;
    if (bot.entity.position.distanceTo(player.entity.position) <= radius) count++;
  }
  return count;
}

function startStuckDetection(bot: Bot): void {
  stuckTimer = setInterval(() => {
    if (!store.connected || !bot.entity) return;
    if (store.state !== "FOLLOW" && store.state !== "AUTONOMOUS" && store.state !== "COMBAT" && store.state !== "PATROL") {
      stuckCount = 0;
      lastBotPos = null;
      return;
    }

    const pos = bot.entity.position;
    if (lastBotPos) {
      const moved = Math.abs(pos.x - lastBotPos.x) + Math.abs(pos.z - lastBotPos.z);
      if (moved < 0.2) {
        stuckCount++;
        if (stuckCount >= 4) {
          // Stuck for ~20s — reset pathfinder
          stopMovement(bot);
          lastOwnerPos = null; // force path recalculation
          stuckCount = 0;
          addLog("warn", "Stuck detected — resetting path");
        }
      } else {
        stuckCount = 0;
      }
    }
    lastBotPos = { x: pos.x, z: pos.z };
  }, 5000);
}
