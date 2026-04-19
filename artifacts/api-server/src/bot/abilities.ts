import type { Bot } from "mineflayer";
import { store } from "./store.js";
import { addLog } from "./logger.js";

let afkTimer = 0;
let afkInterval = 0;
let lootCooldown = 0;
let stuckTimer = 0;
let lastPos = { x: 0, y: 0, z: 0 };

// ─── Anti-AFK ────────────────────────────────────────────────────────────────
export function tickAntiAfk(bot: Bot): void {
  if (!store.settings.antiAfk) return;
  if (store.state !== "IDLE" && store.state !== "GUARD") return;

  afkTimer++;
  if (afkTimer < afkInterval) return;
  afkTimer = 0;
  afkInterval = 150 + Math.floor(Math.random() * 150); // ~30–60 s at 5 tps

  const action = Math.floor(Math.random() * 4);
  try {
    switch (action) {
      case 0:
        bot.setControlState("jump", true);
        setTimeout(() => bot.setControlState("jump", false), 200);
        break;
      case 1:
        bot.look(Math.random() * Math.PI * 2, (Math.random() - 0.5) * 0.8, false);
        break;
      case 2:
        bot.setControlState("sneak", true);
        setTimeout(() => bot.setControlState("sneak", false), 500);
        break;
      case 3:
        // tiny step forward/back
        bot.setControlState("forward", true);
        setTimeout(() => bot.setControlState("forward", false), 300);
        break;
    }
  } catch { /* ignore */ }
}

// ─── Loot pickup ─────────────────────────────────────────────────────────────
export function tickLootPickup(bot: Bot): void {
  if (!store.settings.lootPickup) return;
  if (store.state === "COMBAT" || store.state === "FOLLOW") return;

  lootCooldown++;
  if (lootCooldown < 25) return; // check every ~5 s
  lootCooldown = 0;

  if (!bot.entity?.position) return;

  let nearest: { entity: object; dist: number } | null = null;
  for (const entity of Object.values(bot.entities)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const e = entity as any;
    if (!e || e === bot.entity || !e.position) continue;
    if (e.name !== "item" && e.objectType !== "item") continue;
    const dist = bot.entity.position.distanceTo(e.position);
    if (dist > 8) continue;
    if (!nearest || dist < nearest.dist) nearest = { entity: e, dist };
  }

  if (!nearest) return;

  try {
    const pf = globalThis.require?.("mineflayer-pathfinder");
    if (pf?.goals && bot.pathfinder) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bot.pathfinder as any).setGoal(new pf.goals.GoalBlock(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        Math.floor((nearest.entity as any).position.x),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        Math.floor((nearest.entity as any).position.y),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        Math.floor((nearest.entity as any).position.z),
      ));
      addLog("info", "Collecting nearby loot");
    }
  } catch { /* ignore */ }
}

// ─── Sneak follow ────────────────────────────────────────────────────────────
export function setSneaking(bot: Bot, sneak: boolean): void {
  store.sneaking = sneak;
  try {
    bot.setControlState("sneak", sneak);
  } catch { /* ignore */ }
}

// ─── Critical hits helper ────────────────────────────────────────────────────
export function attackWithCrit(bot: Bot, entity: object): void {
  if (!store.settings.criticalHits) {
    try { bot.attack(entity as Parameters<typeof bot.attack>[0]); } catch { /* ignore */ }
    return;
  }
  // Must be falling to deal a crit — jump then attack on way down
  try {
    bot.setControlState("jump", true);
    setTimeout(() => {
      bot.setControlState("jump", false);
      setTimeout(() => {
        try { bot.attack(entity as Parameters<typeof bot.attack>[0]); } catch { /* ignore */ }
      }, 180);
    }, 120);
  } catch {
    try { bot.attack(entity as Parameters<typeof bot.attack>[0]); } catch { /* ignore */ }
  }
}

// ─── Best weapon equip ───────────────────────────────────────────────────────
export function equipBestWeapon(bot: Bot): void {
  const priority = [
    "netherite_sword", "diamond_sword", "iron_sword", "stone_sword", "wooden_sword",
    "netherite_axe", "diamond_axe", "iron_axe", "stone_axe", "wooden_axe",
  ];
  for (const name of priority) {
    const item = bot.inventory.items().find((i) => i.name === name);
    if (item) {
      bot.equip(item, "hand").catch(() => {});
      return;
    }
  }
}

// ─── Stuck detection ─────────────────────────────────────────────────────────
export function tickStuckDetection(bot: Bot): void {
  stuckTimer++;
  if (stuckTimer < 50) return; // every 10 s
  stuckTimer = 0;

  const pos = bot.entity?.position;
  if (!pos) return;

  if (
    Math.abs(pos.x - lastPos.x) < 0.3 &&
    Math.abs(pos.z - lastPos.z) < 0.3 &&
    (store.state === "FOLLOW" || store.state === "COMBAT")
  ) {
    // Stuck — try a small jump to dislodge
    try {
      bot.setControlState("jump", true);
      setTimeout(() => bot.setControlState("jump", false), 250);
    } catch { /* ignore */ }
    addLog("warn", "Stuck detected — attempting to dislodge");
    // Reset pathfinder goal
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bot.pathfinder as any)?.setGoal(null);
    } catch { /* ignore */ }
  }

  lastPos = { x: pos.x, y: pos.y, z: pos.z };
}

// ─── Swim support ────────────────────────────────────────────────────────────
export function tickSwimming(bot: Bot): void {
  const inWater = bot.isInWater;
  store.isSwimming = inWater;

  if (inWater) {
    // Keep the bot swimming up so it doesn't drown
    bot.setControlState("jump", true);
    // If we are pathfinding, pathfinder will override this — that's fine
  }
}

// ─── Armor equip ─────────────────────────────────────────────────────────────
const armorSlots = ["helmet", "chestplate", "leggings", "boots"] as const;
const armorTypes = ["netherite", "diamond", "iron", "chainmail", "golden", "leather"];

export async function equipBestArmor(bot: Bot): Promise<void> {
  for (const slot of armorSlots) {
    const suffix = slot === "chestplate" ? "chestplate" : slot;
    for (const material of armorTypes) {
      const item = bot.inventory.items().find((i) => i.name === `${material}_${suffix}`);
      if (item) {
        try {
          await bot.equip(item, slot as "head" | "torso" | "legs" | "feet");
        } catch { /* ignore */ }
        break;
      }
    }
  }
}

// ─── Patrol waypoints ────────────────────────────────────────────────────────
let patrolIndex = 0;

export function getPatrolIndex(): number { return patrolIndex; }
export function nextPatrolIndex(total: number): void {
  patrolIndex = (patrolIndex + 1) % total;
}
export function resetPatrolIndex(): void {
  patrolIndex = 0;
}
