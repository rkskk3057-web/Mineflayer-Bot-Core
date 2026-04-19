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
  tickStuckDetection,
  attackWithCrit,
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

// Cached pathfinder module
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
    if (bot.pathfinder) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bot.pathfinder as any).setGoal(goal, dynamic);
    }
  } catch { /* ignore */ }
}

function stopMovement(bot: Bot): void {
  try {
    if (bot.pathfinder) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bot.pathfinder as any).setGoal(null);
    }
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
  scheduleNextScan(bot);
  startStuckDetection(bot);
  addLog("info", "AI started");
}

export function stopAI(): void {
  if (scanTimer) { clearTimeout(scanTimer); scanTimer = null; }
  if (stuckTimer) { clearInterval(stuckTimer); stuckTimer = null; }
}

function scheduleNextScan(bot: Bot): void {
  const interval = getScanInterval();
  scanTimer = setTimeout(() => {
    if (store.connected) {
      try { runAITick(bot); } catch { /* suppress tick errors */ }
      scheduleNextScan(bot);
    }
  }, interval);
}

function runAITick(bot: Bot): void {
  if (!store.connected || store.state === "DISCONNECTED") return;

  syncOwnerOnline(bot);
  store.nearbyPlayers = countNearbyPlayers(bot);

  // Ability sub-ticks (all no-ops if disabled)
  tickAntiAfk(bot);
  tickLootPickup(bot);

  switch (store.state) {
    case "IDLE":       handleIdle(bot); break;
    case "FOLLOW":     handleFollow(bot); break;
    case "GUARD":      handleGuard(bot); break;
    case "COMBAT":     handleCombat(bot); break;
    case "AUTONOMOUS": handleAutonomous(bot); break;
    case "PATROL":     handlePatrol(bot); break;
  }
}

// ── IDLE ──────────────────────────────────────────────────────────────────────

function handleIdle(bot: Bot): void {
  const task = getNextPendingTask();
  if (task) { executeTask(bot, task.id, task.type, task.params); return; }

  if (!store.settings.combatEnabled) return;
  if (store.settings.aggressionLevel > 4 && canChangeState()) {
    const hostile = findNearestHostile(bot);
    if (hostile) {
      lockTarget(hostile.id);
      store.currentTarget = hostile.name;
      changeState("COMBAT");
      addLog("combat", `Engaging: ${hostile.name}`);
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
    if (store.autonomousMode && canChangeState()) {
      changeState("AUTONOMOUS");
      addLog("state", "Owner not visible — AUTONOMOUS");
    }
    return;
  }

  // Defend owner
  if (store.settings.combatEnabled && store.settings.aggressionLevel > 5 && canChangeState()) {
    const now = Date.now();
    if (now - lastCombatTriggerTime > COMBAT_TRIGGER_COOLDOWN_MS) {
      const hostile = findNearestHostile(bot);
      if (hostile) {
        lastCombatTriggerTime = now;
        lockTarget(hostile.id);
        store.currentTarget = hostile.name;
        changeState("COMBAT");
        addLog("combat", `Defending owner from: ${hostile.name}`);
        pauseAllTasks();
        return;
      }
    }
  }

  const ownerPos = ownerEntry.entity.position;
  const pf = getPF();
  if (pf && bot.pathfinder && ownerEntry.entity) {
    const ownerMoved = !lastOwnerPos || ownerPos.distanceTo(lastOwnerPos) > 1.5;
    if (ownerMoved) {
      lastOwnerPos = { x: ownerPos.x, y: ownerPos.y, z: ownerPos.z };
      const goal = new (pf.goals.GoalFollow as unknown as new (e: unknown, d: number) => unknown)(
        ownerEntry.entity,
        store.settings.followDistance,
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

  if (store.settings.aggressionLevel >= 8) {
    const untrusted = findNearestPlayer(bot, true);
    if (untrusted) {
      lastCombatTriggerTime = now;
      lockTarget(untrusted.id);
      store.currentTarget = untrusted.name;
      changeState("COMBAT");
      addLog("combat", `Guard: hostile player: ${untrusted.name}`);
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
    addLog("combat", "Target eliminated — IDLE");
    return;
  }
  if (!store.settings.combatEnabled) {
    clearTarget();
    changeState("IDLE");
    store.currentTarget = null;
    return;
  }
  attackTarget(bot, attackWithCrit);
}

// ── AUTONOMOUS ────────────────────────────────────────────────────────────────

function handleAutonomous(bot: Bot): void {
  if (store.ownerOnline) {
    stopMovement(bot);
    changeState("FOLLOW");
    addLog("state", "Owner online — FOLLOW");
    return;
  }

  // Fight back if attacked (always, regardless of aggressionLevel in auto mode)
  if (store.settings.combatEnabled) {
    const now = Date.now();
    if (now - lastCombatTriggerTime > COMBAT_TRIGGER_COOLDOWN_MS) {
      const hostile = findNearestHostile(bot);
      if (hostile && bot.entity) {
        const entity = bot.entities[hostile.id];
        if (entity?.position && bot.entity.position.distanceTo(entity.position) < 5) {
          lastCombatTriggerTime = now;
          lockTarget(hostile.id);
          store.currentTarget = hostile.name;
          changeState("COMBAT");
          return;
        }
      }
    }
  }

  // Gentle wander
  if (Math.random() < 0.015 && bot.entity) {
    const pos = bot.entity.position;
    const dx = (Math.random() - 0.5) * 12;
    const dz = (Math.random() - 0.5) * 12;
    const pf = getPF();
    if (pf && bot.pathfinder) {
      try {
        const wander = new (pf.goals.GoalXZ as unknown as new (x: number, z: number) => unknown)(
          Math.round(pos.x + dx), Math.round(pos.z + dz)
        );
        setGoal(bot, wander, false);
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

  // Switch back to FOLLOW when owner comes online
  if (store.ownerOnline) {
    changeState("FOLLOW");
    addLog("state", "Owner online — switching PATROL → FOLLOW");
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

  const idx = getPatrolIndex();
  const waypoint = store.waypoints[idx];
  if (!waypoint || !bot.entity?.position) return;

  const dist = bot.entity.position.distanceTo({ x: waypoint.x, y: waypoint.y, z: waypoint.z });

  if (dist < 2) {
    // Reached waypoint, move to next
    nextPatrolIndex(store.waypoints.length);
    addLog("info", `Patrol: reached ${waypoint.label} → next waypoint`);
  } else {
    // Navigate to waypoint
    const pf = getPF();
    if (pf && bot.pathfinder) {
      try {
        const goal = new (pf.goals.GoalBlock as unknown as new (x: number, y: number, z: number) => unknown)(
          Math.round(waypoint.x), Math.round(waypoint.y), Math.round(waypoint.z)
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
          const goal = new (pf.goals.GoalBlock as unknown as new (x: number, y: number, z: number) => unknown)(
            Math.round(x), Math.round(y), Math.round(z)
          );
          setGoal(bot, goal, false);
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
      return;
    }
    const pos = bot.entity.position;
    if (lastBotPos) {
      const moved = Math.abs(pos.x - lastBotPos.x) + Math.abs(pos.z - lastBotPos.z);
      if (moved < 0.15) {
        stuckCount++;
        if (stuckCount >= 3) {
          stopMovement(bot);
          lastOwnerPos = null;
          stuckCount = 0;
          // Try a jump to dislodge
          try {
            bot.setControlState("jump", true);
            setTimeout(() => bot.setControlState("jump", false), 300);
          } catch { /* ignore */ }
          addLog("warn", "Stuck — pathfinder reset + jump dislodge");
        }
      } else {
        stuckCount = 0;
      }
    }
    lastBotPos = { x: pos.x, z: pos.z };
  }, 5000);
}
