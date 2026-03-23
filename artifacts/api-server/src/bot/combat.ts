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

export async function attackTarget(bot: Bot): Promise<void> {
  if (!targetEntityId) return;

  const entity = bot.entities[targetEntityId];
  if (!entity) {
    clearTarget();
    return;
  }

  const now = Date.now();
  const delay = store.settings.attackDelay;
  if (now - lastAttackTime < delay) return;

  // Check distance
  if (bot.entity && entity.position) {
    const dist = bot.entity.position.distanceTo(entity.position);
    if (dist > 4) {
      // Move closer first
      try {
        if (bot.pathfinder) {
          const { goals } = await import("mineflayer-pathfinder");
          bot.pathfinder.setGoal(new goals.GoalFollow(entity, 2), true);
        }
      } catch {
        // pathfinder may not be available
      }
      return;
    }

    // Low HP retreat
    if (bot.health <= 5) {
      addLog("combat", "Low HP - retreating from combat");
      clearTarget();
      store.state = "IDLE";
      return;
    }

    try {
      bot.attack(entity);
      lastAttackTime = now;
    } catch {
      // entity may have despawned
      clearTarget();
    }
  }
}

export function findNearestHostile(bot: Bot): { id: number; name: string } | null {
  const radius = store.settings.detectionRadius;
  const hostileMobs = new Set([
    "zombie", "skeleton", "creeper", "spider", "cave_spider",
    "blaze", "witch", "phantom", "drowned", "husk", "stray",
    "pillager", "vindicator", "ravager", "enderman", "slime",
    "magma_cube", "ghast", "wither_skeleton", "zombie_piglin"
  ]);

  let nearest: { id: number; name: string; dist: number } | null = null;

  for (const entity of Object.values(bot.entities)) {
    if (!entity || entity === bot.entity) continue;
    if (!entity.position || !bot.entity) continue;

    const dist = bot.entity.position.distanceTo(entity.position);
    if (dist > radius) continue;

    const name = entity.name || entity.type || "";
    if (hostileMobs.has(name)) {
      if (!nearest || dist < nearest.dist) {
        nearest = { id: entity.id, name, dist };
      }
    }
  }

  return nearest ? { id: nearest.id, name: nearest.name } : null;
}

export function findNearestPlayer(bot: Bot, excludeOwner = false): { id: number; name: string } | null {
  const radius = store.settings.detectionRadius;
  let nearest: { id: number; name: string; dist: number } | null = null;

  for (const player of Object.values(bot.players)) {
    if (!player.entity || player.entity === bot.entity) continue;
    if (!player.entity.position || !bot.entity) continue;

    if (excludeOwner && player.username === store.settings.owner) continue;
    if (store.whitelist.has(player.username)) continue;

    const dist = bot.entity.position.distanceTo(player.entity.position);
    if (dist > radius) continue;

    if (!nearest || dist < nearest.dist) {
      nearest = { id: player.entity.id, name: player.username, dist };
    }
  }

  return nearest ? { id: nearest.id, name: nearest.name } : null;
}
