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

let scanTimer: NodeJS.Timeout | null = null;
let stuckTimer: NodeJS.Timeout | null = null;

let lastBotPos: { x: number; z: number } | null = null;
let lastOwnerPos: { x: number; y: number; z: number } | null = null;
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

/** Find the owner's player entry with case-insensitive matching */
function findOwnerEntry(bot: Bot) {
  const owner = store.settings.owner;
  if (!owner) return null;
  if (bot.players[owner]) return bot.players[owner];
  const key = Object.keys(bot.players).find(k => k.toLowerCase() === owner.toLowerCase());
  return key ? bot.players[key] : null;
}

/** Check if owner is online and update store */
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

  // Sync owner status every tick (cheapest reliable fix)
  syncOwnerOnline(bot);

  // Count nearby players
  store.nearbyPlayers = countNearbyPlayers(bot);

  switch (store.state) {
    case "IDLE":       handleIdle(bot); break;
    case "FOLLOW":     handleFollow(bot); break;
    case "GUARD":      handleGuard(bot); break;
    case "COMBAT":     handleCombat(bot); break;
    case "AUTONOMOUS": handleAutonomous(bot); break;
  }
}

// ── IDLE ──────────────────────────────────────────────────────────────────────

function handleIdle(bot: Bot): void {
  const task = getNextPendingTask();
  if (task) { executeTask(bot, task.id, task.type, task.params); return; }

  // Auto-follow if owner is online and aggression warrants it
  if (store.ownerOnline && store.settings.aggressionLevel >= 0) {
    // No-op — idle stays idle until user issues follow command
  }

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
    // Owner not visible — wait; switch to autonomous if mode enabled
    if (store.autonomousMode && canChangeState()) {
      changeState("AUTONOMOUS");
      addLog("state", "Owner not visible — switching to AUTONOMOUS");
    }
    return;
  }

  // Defend owner from hostiles (when aggression is high)
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

  // ── Follow movement ──────────────────────────────────────────────────────
  // Only update pathfinder goal when owner has moved more than 1.5 blocks
  // This prevents jitter from re-issuing goals every single tick
  const ownerPos = ownerEntry.entity.position;
  const pf = getPF();
  if (pf && bot.pathfinder && ownerEntry.entity) {
    const ownerMoved = !lastOwnerPos || ownerPos.distanceTo(lastOwnerPos) > 1.5;
    if (ownerMoved) {
      lastOwnerPos = { x: ownerPos.x, y: ownerPos.y, z: ownerPos.z };
      // GoalFollow dynamically tracks the entity — the pathfinder recalculates
      // continuously, so we don't need to call setGoal on every tick
      const goal = new (pf.goals.GoalFollow as unknown as new (e: unknown, d: number) => unknown)(
        ownerEntry.entity,
        store.settings.followDistance,
      );
      setGoal(bot, goal, true); // dynamic=true: pathfinder replans as entity moves
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
      addLog("combat", `Guard: untrusted player: ${untrusted.name}`);
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
    addLog("combat", "Target eliminated — returning to IDLE");
    return;
  }
  if (!store.settings.combatEnabled) {
    clearTarget();
    changeState("IDLE");
    store.currentTarget = null;
    return;
  }
  attackTarget(bot);
}

// ── AUTONOMOUS ────────────────────────────────────────────────────────────────

function handleAutonomous(bot: Bot): void {
  // Switch back to FOLLOW the moment the owner is online
  if (store.ownerOnline) {
    stopMovement(bot);
    changeState("FOLLOW");
    addLog("state", "Owner online — switching to FOLLOW");
    return;
  }

  // Flee from hostiles
  const hostile = findNearestHostile(bot);
  if (hostile && bot.entity) {
    const entity = bot.entities[hostile.id];
    if (entity?.position) {
      const pf = getPF();
      if (pf && bot.pathfinder) {
        try {
          const flee = new (pf.goals.GoalInvert as unknown as new (g: unknown) => unknown)(
            new (pf.goals.GoalNear as unknown as new (x: number, y: number, z: number, r: number) => unknown)(
              entity.position.x, entity.position.y, entity.position.z, 10
            )
          );
          setGoal(bot, flee, true);
        } catch { /* ignore */ }
      }
    }
    return;
  }

  // Gentle occasional wander (2% per tick)
  if (Math.random() < 0.02 && bot.entity) {
    const pos = bot.entity.position;
    const dx = (Math.random() - 0.5) * 8;
    const dz = (Math.random() - 0.5) * 8;
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
    if (store.state !== "FOLLOW" && store.state !== "AUTONOMOUS" && store.state !== "COMBAT") {
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
          lastOwnerPos = null; // force path recalculation
          stuckCount = 0;
          addLog("warn", "Stuck detected — pathfinder reset");
        }
      } else {
        stuckCount = 0;
      }
    }
    lastBotPos = { x: pos.x, z: pos.z };
  }, 5000);
}
