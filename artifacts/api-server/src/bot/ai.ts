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
let lastPosition: { x: number; y: number; z: number } | null = null;
let stuckCount = 0;

// Lazy pathfinder module reference
let pathfinderGoals: { GoalFollow: new (entity: unknown, dist: number) => unknown; GoalBlock: new (x: number, y: number, z: number) => unknown; GoalXZ: new (x: number, z: number) => unknown; GoalInvert: new (goal: unknown) => unknown; GoalNear: new (x: number, y: number, z: number, r: number) => unknown } | null = null;

function getGoals() {
  if (!pathfinderGoals) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = globalThis.require?.("mineflayer-pathfinder");
      if (mod?.goals) {
        pathfinderGoals = mod.goals as typeof pathfinderGoals;
      }
    } catch {
      // pathfinder not available
    }
  }
  return pathfinderGoals;
}

export function startAI(bot: Bot): void {
  stopAI();
  scheduleNextScan(bot);
  startStuckDetection(bot);
  addLog("info", "AI system started");
}

export function stopAI(): void {
  if (scanTimer) {
    clearTimeout(scanTimer);
    scanTimer = null;
  }
  if (stuckTimer) {
    clearTimeout(stuckTimer);
    stuckTimer = null;
  }
}

function scheduleNextScan(bot: Bot): void {
  const interval = getScanInterval();
  scanTimer = setTimeout(() => {
    try {
      runAITick(bot);
    } catch {
      // ignore scan errors
    }
    if (store.connected) {
      scheduleNextScan(bot);
    }
  }, interval);
}

function runAITick(bot: Bot): void {
  if (!store.connected || store.state === "DISCONNECTED") return;

  // Update nearby player count
  store.nearbyPlayers = countNearbyPlayers(bot);

  // Update owner online status
  const ownerName = store.settings.owner;
  store.ownerOnline = ownerName ? ownerName in bot.players : false;

  // State machine
  switch (store.state) {
    case "IDLE":
      handleIdle(bot);
      break;
    case "FOLLOW":
      handleFollow(bot);
      break;
    case "GUARD":
      handleGuard(bot);
      break;
    case "COMBAT":
      handleCombat(bot);
      break;
    case "AUTONOMOUS":
      handleAutonomous(bot);
      break;
  }
}

function handleIdle(bot: Bot): void {
  const task = getNextPendingTask();
  if (task) {
    executeTask(bot, task.id, task.type, task.params);
    return;
  }

  if (store.settings.aggressionLevel > 3) {
    const hostile = findNearestHostile(bot);
    if (hostile) {
      lockTarget(hostile.id);
      store.currentTarget = hostile.name;
      store.state = "COMBAT";
      addLog("combat", `Engaging hostile: ${hostile.name}`);
      pauseAllTasks();
    }
  }
}

function handleFollow(bot: Bot): void {
  const ownerName = store.settings.owner;
  if (!ownerName) {
    store.state = "IDLE";
    return;
  }

  const ownerPlayer = bot.players[ownerName];
  if (!ownerPlayer?.entity) {
    if (store.autonomousMode) {
      store.state = "AUTONOMOUS";
      addLog("state", "Owner offline - switching to AUTONOMOUS");
    }
    return;
  }

  if (store.settings.aggressionLevel > 5) {
    const hostile = findNearestHostile(bot);
    if (hostile) {
      lockTarget(hostile.id);
      store.currentTarget = hostile.name;
      store.state = "COMBAT";
      addLog("combat", `Defending owner from: ${hostile.name}`);
      pauseAllTasks();
      return;
    }
  }

  try {
    const goals = getGoals();
    if (goals && bot.pathfinder && ownerPlayer.entity) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const goal = new (goals.GoalFollow as any)(ownerPlayer.entity, store.settings.followDistance);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bot.pathfinder as any).setGoal(goal, true);
    }
  } catch {
    // pathfinder not available
  }
}

function handleGuard(bot: Bot): void {
  const hostile = findNearestHostile(bot);
  if (hostile) {
    lockTarget(hostile.id);
    store.currentTarget = hostile.name;
    store.state = "COMBAT";
    addLog("combat", `Guard: engaging hostile ${hostile.name}`);
    pauseAllTasks();
    return;
  }

  const untrustedPlayer = findNearestPlayer(bot, true);
  if (untrustedPlayer && store.settings.aggressionLevel >= 8) {
    lockTarget(untrustedPlayer.id);
    store.currentTarget = untrustedPlayer.name;
    store.state = "COMBAT";
    addLog("combat", `Guard: untrusted player too close: ${untrustedPlayer.name}`);
    pauseAllTasks();
  }
}

function handleCombat(bot: Bot): void {
  if (!hasTarget()) {
    store.state = "IDLE";
    store.currentTarget = null;
    resumeTasks();
    addLog("combat", "Combat ended");
    return;
  }

  attackTarget(bot);
}

function handleAutonomous(bot: Bot): void {
  const ownerName = store.settings.owner;
  if (ownerName && ownerName in bot.players) {
    store.state = "FOLLOW";
    addLog("state", "Owner joined - switching to FOLLOW");
    return;
  }

  // Avoid hostiles - flee
  const hostile = findNearestHostile(bot);
  if (hostile && bot.entity && bot.entities[hostile.id]) {
    try {
      const goals = getGoals();
      const hostileEntity = bot.entities[hostile.id];
      if (goals && bot.pathfinder && hostileEntity?.position) {
        const fleeGoal = new (goals.GoalInvert as unknown as new (g: unknown) => unknown)(
          new (goals.GoalNear as unknown as new (x: number, y: number, z: number, r: number) => unknown)(
            hostileEntity.position.x,
            hostileEntity.position.y,
            hostileEntity.position.z,
            8
          )
        );
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (bot.pathfinder as any).setGoal(fleeGoal, true);
      }
    } catch {
      // ignore
    }
    return;
  }

  // Occasionally wander within small radius
  if (Math.random() < 0.05 && bot.entity) {
    const pos = bot.entity.position;
    const dx = (Math.random() - 0.5) * 10;
    const dz = (Math.random() - 0.5) * 10;
    try {
      const goals = getGoals();
      if (goals && bot.pathfinder) {
        const wanderGoal = new (goals.GoalXZ as unknown as new (x: number, z: number) => unknown)(
          Math.round(pos.x + dx),
          Math.round(pos.z + dz)
        );
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (bot.pathfinder as any).setGoal(wanderGoal, true);
      }
    } catch {
      // ignore
    }
  }
}

function executeTask(bot: Bot, taskId: string, type: string, params: Record<string, unknown>): void {
  setTaskActive(taskId);
  addLog("info", `Executing task: ${type}`);

  switch (type) {
    case "follow": {
      const target = params.target as string;
      if (target) {
        store.settings.owner = target;
        store.state = "FOLLOW";
      }
      break;
    }
    case "guard_area": {
      store.state = "GUARD";
      break;
    }
    case "move_to": {
      const x = params.x as number;
      const z = params.z as number;
      const y = (params.y as number) || 64;
      try {
        const goals = getGoals();
        if (goals && bot.pathfinder) {
          const moveGoal = new (goals.GoalBlock as unknown as new (x: number, y: number, z: number) => unknown)(
            Math.round(x), Math.round(y), Math.round(z)
          );
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (bot.pathfinder as any).setGoal(moveGoal, true);
        }
      } catch {
        // ignore
      }
      break;
    }
  }
}

function countNearbyPlayers(bot: Bot): number {
  if (!bot.entity) return 0;
  const radius = store.settings.detectionRadius;
  let count = 0;
  for (const player of Object.values(bot.players)) {
    if (!player.entity || player.entity === bot.entity) continue;
    if (!player.entity.position) continue;
    const dist = bot.entity.position.distanceTo(player.entity.position);
    if (dist <= radius) count++;
  }
  return count;
}

function startStuckDetection(bot: Bot): void {
  stuckTimer = setInterval(() => {
    if (!store.connected || !bot.entity) return;
    const pos = bot.entity.position;
    if (lastPosition) {
      const moved = Math.abs(pos.x - lastPosition.x) + Math.abs(pos.z - lastPosition.z);
      if (moved < 0.1 && (store.state === "FOLLOW" || store.state === "AUTONOMOUS")) {
        stuckCount++;
        if (stuckCount >= 3) {
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            if (bot.pathfinder) (bot.pathfinder as any).setGoal(null);
          } catch {
            // ignore
          }
          stuckCount = 0;
          addLog("warn", "Stuck detected - resetting pathfinding");
        }
      } else {
        stuckCount = 0;
      }
    }
    lastPosition = { x: pos.x, y: pos.y, z: pos.z };
  }, 5000);
}
