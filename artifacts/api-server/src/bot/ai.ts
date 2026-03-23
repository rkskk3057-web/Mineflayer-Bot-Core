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

// Positions for stuck detection & follow optimization
let lastBotPos: { x: number; z: number } | null = null;
let lastOwnerPos: { x: number; y: number; z: number } | null = null;
let stuckCount = 0;

// Cooldown: prevents state flipping too fast
let lastStateChangeTime = 0;
const STATE_CHANGE_COOLDOWN_MS = 800;

// Combat detection dedup: prevent triggering combat twice for same event
let lastCombatTriggerTime = 0;
const COMBAT_TRIGGER_COOLDOWN_MS = 1500;

// Cached pathfinder module
let _pf: { goals: Record<string, new (...args: unknown[]) => unknown>; Movements: new (bot: Bot) => unknown } | null = null;

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

export function startAI(bot: Bot): void {
  stopAI();
  scheduleNextScan(bot);
  startStuckDetection(bot);
  addLog("info", "AI started");
}

export function stopAI(): void {
  if (scanTimer) { clearTimeout(scanTimer); scanTimer = null; }
  if (stuckTimer) { clearInterval(stuckTimer); stuckTimer = null; }
  // Reset positions
  lastBotPos = null;
  lastOwnerPos = null;
  stuckCount = 0;
}

function scheduleNextScan(bot: Bot): void {
  const interval = getScanInterval();
  scanTimer = setTimeout(() => {
    if (store.connected) {
      try { runAITick(bot); } catch { /* ignore tick errors */ }
      scheduleNextScan(bot);
    }
  }, interval);
}

function runAITick(bot: Bot): void {
  if (!store.connected || store.state === "DISCONNECTED") return;

  // Sync live stats
  store.nearbyPlayers = countNearbyPlayers(bot);
  const ownerName = store.settings.owner;
  store.ownerOnline = ownerName ? ownerName in bot.players : false;

  switch (store.state) {
    case "IDLE":    handleIdle(bot); break;
    case "FOLLOW":  handleFollow(bot); break;
    case "GUARD":   handleGuard(bot); break;
    case "COMBAT":  handleCombat(bot); break;
    case "AUTONOMOUS": handleAutonomous(bot); break;
  }
}

// ─── IDLE ────────────────────────────────────────────────────────────────────

function handleIdle(bot: Bot): void {
  // Try next queued task first
  const task = getNextPendingTask();
  if (task) {
    executeTask(bot, task.id, task.type, task.params);
    return;
  }

  // Only engage hostiles if aggression is high enough
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

// ─── FOLLOW ──────────────────────────────────────────────────────────────────

function handleFollow(bot: Bot): void {
  const ownerName = store.settings.owner;
  if (!ownerName) { changeState("IDLE"); return; }

  const ownerPlayer = bot.players[ownerName];
  if (!ownerPlayer?.entity) {
    // Owner offline
    if (store.autonomousMode && canChangeState()) {
      changeState("AUTONOMOUS");
    }
    return;
  }

  // Defend owner from hostiles (high aggression only)
  if (store.settings.aggressionLevel > 5 && canChangeState()) {
    const now = Date.now();
    if (now - lastCombatTriggerTime > COMBAT_TRIGGER_COOLDOWN_MS) {
      const hostile = findNearestHostile(bot);
      if (hostile) {
        lastCombatTriggerTime = now;
        lockTarget(hostile.id);
        store.currentTarget = hostile.name;
        changeState("COMBAT");
        addLog("combat", `Defending from: ${hostile.name}`);
        pauseAllTasks();
        return;
      }
    }
  }

  // Pathfind to owner — only update goal when owner has moved enough (avoids jitter)
  const ownerPos = ownerPlayer.entity.position;
  const pf = getPF();
  if (pf && bot.pathfinder) {
    const ownerMoved = !lastOwnerPos || ownerPos.distanceTo(lastOwnerPos) > 1.0;
    if (ownerMoved) {
      lastOwnerPos = { x: ownerPos.x, y: ownerPos.y, z: ownerPos.z };
      const goal = new (pf.goals.GoalFollow as unknown as new (e: unknown, d: number) => unknown)(
        ownerPlayer.entity, store.settings.followDistance
      );
      setGoal(bot, goal, true);
    }
  }
}

// ─── GUARD ───────────────────────────────────────────────────────────────────

function handleGuard(bot: Bot): void {
  const now = Date.now();
  if (!canChangeState()) return;
  if (now - lastCombatTriggerTime < COMBAT_TRIGGER_COOLDOWN_MS) return;

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

// ─── COMBAT ──────────────────────────────────────────────────────────────────

function handleCombat(bot: Bot): void {
  if (!hasTarget()) {
    // Combat done
    changeState("IDLE");
    store.currentTarget = null;
    resumeTasks();
    stopMovement(bot);
    addLog("combat", "Combat ended — target gone");
    return;
  }

  attackTarget(bot);
}

// ─── AUTONOMOUS ──────────────────────────────────────────────────────────────

function handleAutonomous(bot: Bot): void {
  // Owner joined — instant switch to FOLLOW
  const ownerName = store.settings.owner;
  if (ownerName && ownerName in bot.players) {
    stopMovement(bot);
    changeState("FOLLOW");
    addLog("state", "Owner joined — switching to FOLLOW");
    return;
  }

  // Flee from hostiles
  const hostile = findNearestHostile(bot);
  if (hostile && bot.entity) {
    const hostileEntity = bot.entities[hostile.id];
    if (hostileEntity?.position) {
      const pf = getPF();
      if (pf && bot.pathfinder) {
        try {
          const fleeGoal = new (pf.goals.GoalInvert as unknown as new (g: unknown) => unknown)(
            new (pf.goals.GoalNear as unknown as new (x: number, y: number, z: number, r: number) => unknown)(
              hostileEntity.position.x, hostileEntity.position.y, hostileEntity.position.z, 10
            )
          );
          setGoal(bot, fleeGoal, true);
        } catch { /* ignore */ }
      }
    }
    return;
  }

  // Controlled occasional wander — 2% chance per tick, small radius
  if (Math.random() < 0.02 && bot.entity) {
    const pos = bot.entity.position;
    const dx = (Math.random() - 0.5) * 8;
    const dz = (Math.random() - 0.5) * 8;
    const pf = getPF();
    if (pf && bot.pathfinder) {
      try {
        const wanderGoal = new (pf.goals.GoalXZ as unknown as new (x: number, z: number) => unknown)(
          Math.round(pos.x + dx), Math.round(pos.z + dz)
        );
        setGoal(bot, wanderGoal, false);
      } catch { /* ignore */ }
    }
  }
}

// ─── TASKS ───────────────────────────────────────────────────────────────────

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

// ─── HELPERS ─────────────────────────────────────────────────────────────────

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
  // Check every 6 seconds if bot hasn't moved while it should be moving
  stuckTimer = setInterval(() => {
    if (!store.connected || !bot.entity) return;
    if (store.state !== "FOLLOW" && store.state !== "AUTONOMOUS") {
      stuckCount = 0;
      return;
    }

    const pos = bot.entity.position;
    if (lastBotPos) {
      const moved = Math.abs(pos.x - lastBotPos.x) + Math.abs(pos.z - lastBotPos.z);
      if (moved < 0.2) {
        stuckCount++;
        if (stuckCount >= 2) {
          // Reset pathfinder goal to unstick
          stopMovement(bot);
          // Re-trigger on next tick
          lastOwnerPos = null;
          stuckCount = 0;
          addLog("warn", "Stuck — reset pathfinding");
        }
      } else {
        stuckCount = 0;
      }
    }
    lastBotPos = { x: pos.x, z: pos.z };
  }, 6000);
}

