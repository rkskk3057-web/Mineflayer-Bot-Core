import type { Bot } from "mineflayer";
import { store } from "./store.js";
import { addLog } from "./logger.js";

let lastAttackTime = 0;
let targetEntityId: number | null = null;

export function lockTarget(entityId: number): void {
  targetEntityId = entityId;
}

export function clearTarget(): void {
  targetEntityId = null;
  store.currentTarget = null;
}

export function hasTarget(): boolean {
  return targetEntityId !== null;
}

export function getTargetId(): number | null {
  return targetEntityId;
}

function getPathfinder() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return globalThis.require?.("mineflayer-pathfinder") ?? null;
  } catch {
    return null;
  }
}

// attackFn is injected so we can use criticalHits from abilities without circular deps
export function attackTarget(bot: Bot, attackFn?: (bot: Bot, entity: object) => void): void {
  if (!targetEntityId) return;

  const entity = bot.entities[targetEntityId];

  if (!entity || !entity.position) {
    clearTarget();
    return;
  }

  if (entity.type === "mob" || entity.type === "player") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hp = (entity as any).health;
    if (hp !== undefined && hp <= 0) {
      clearTarget();
      return;
    }
  }

  if (!bot.entity?.position) return;

  const dist = bot.entity.position.distanceTo(entity.position);

  // Low HP — retreat
  if ((bot.health ?? 20) <= 5) {
    addLog("combat", "Low HP — retreating");
    clearTarget();
    store.state = "IDLE";
    const pf = getPathfinder();
    if (pf && bot.pathfinder) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (bot.pathfinder as any).setGoal(null);
      } catch { /* ignore */ }
    }
    return;
  }

  // Too far — approach
  if (dist > 3.5) {
    const pf = getPathfinder();
    if (pf?.goals && bot.pathfinder) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (bot.pathfinder as any).setGoal(new pf.goals.GoalFollow(entity, 2), true);
      } catch { /* ignore */ }
    }
    return;
  }

  const now = Date.now();
  if (now - lastAttackTime < store.settings.attackDelay) return;

  try {
    bot.lookAt(entity.position.offset(0, entity.height ?? 1.6, 0));
    if (attackFn) {
      attackFn(bot, entity);
    } else {
      bot.attack(entity);
    }
    lastAttackTime = now;
  } catch {
    clearTarget();
  }
}

export function findNearestHostile(bot: Bot): { id: number; name: string } | null {
  if (!bot.entity?.position) return null;

  const radius = store.settings.detectionRadius;
  const hostileMobs = new Set([
    "zombie", "skeleton", "creeper", "spider", "cave_spider",
    "blaze", "witch", "phantom", "drowned", "husk", "stray",
    "pillager", "vindicator", "ravager", "enderman", "slime",
    "magma_cube", "ghast", "wither_skeleton", "zombified_piglin",
    "piglin_brute", "zoglin", "hoglin", "vex", "silverfish",
    "guardian", "elder_guardian", "shulker",
  ]);

  let nearest: { id: number; name: string; dist: number } | null = null;

  for (const entity of Object.values(bot.entities)) {
    if (!entity || entity === bot.entity) continue;
    if (!entity.position) continue;

    const name = entity.name ?? entity.type ?? "";
    if (!hostileMobs.has(name)) continue;

    const dist = bot.entity.position.distanceTo(entity.position);
    if (dist > radius) continue;

    if (!nearest || dist < nearest.dist) {
      nearest = { id: entity.id, name, dist };
    }
  }

  return nearest ? { id: nearest.id, name: nearest.name } : null;
}

export function findNearestPlayer(bot: Bot, excludeOwner = false): { id: number; name: string } | null {
  if (!bot.entity?.position) return null;

  const radius = store.settings.detectionRadius;
  let nearest: { id: number; name: string; dist: number } | null = null;

  for (const player of Object.values(bot.players)) {
    if (!player.entity || player.entity === bot.entity) continue;
    if (!player.entity.position) continue;
    if (excludeOwner && player.username.toLowerCase() === store.settings.owner.toLowerCase()) continue;
    if (store.whitelist.has(player.username)) continue;

    const dist = bot.entity.position.distanceTo(player.entity.position);
    if (dist > radius) continue;

    if (!nearest || dist < nearest.dist) {
      nearest = { id: player.entity.id, name: player.username, dist };
    }
  }

  return nearest ? { id: nearest.id, name: nearest.name } : null;
}
