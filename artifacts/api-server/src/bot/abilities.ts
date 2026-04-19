import type { Bot } from "mineflayer";
import { store } from "./store.js";
import { addLog } from "./logger.js";

// ─── State flags ──────────────────────────────────────────────────────────────
let afkTimer = 0;
let afkInterval = 200;
let lootCooldown = 0;
let critPending = false;      // prevents double-crit on rapid ticks
let waterJumping = false;     // tracks whether WE set jump for swimming

// ─── Swimming fix ─────────────────────────────────────────────────────────────
// mineflayer stores isInWater on the entity, not directly on bot.
// We press jump while in water so the bot swims up instead of sinking.
// When the pathfinder is navigating, it handles its own control states;
// our jump signal is overridden by pathfinder automatically — that is fine.
export function tickSwimming(bot: Bot): void {
  const inWater = (bot.entity as unknown as { isInWater?: boolean })?.isInWater === true;
  store.isSwimming = inWater;

  if (inWater) {
    waterJumping = true;
    bot.setControlState("jump", true);
  } else if (waterJumping) {
    // We were the ones who set jump — clear it when leaving water
    waterJumping = false;
    bot.setControlState("jump", false);
  }
}

// ─── Anti-AFK ────────────────────────────────────────────────────────────────
export function tickAntiAfk(bot: Bot): void {
  if (!store.settings.antiAfk) return;
  // Only run when bot is not actively doing something
  if (store.state !== "IDLE" && store.state !== "GUARD") return;

  afkTimer++;
  if (afkTimer < afkInterval) return;
  afkTimer = 0;
  afkInterval = 200 + Math.floor(Math.random() * 200); // ~80–160 s at 400ms ticks

  try {
    const action = Math.floor(Math.random() * 4);
    switch (action) {
      case 0: {
        // Tiny look change — least disruptive
        const currentYaw = bot.entity?.yaw ?? 0;
        bot.look(currentYaw + (Math.random() - 0.5) * 0.5, 0, false);
        break;
      }
      case 1:
        // Quick sneak
        bot.setControlState("sneak", true);
        setTimeout(() => { try { bot.setControlState("sneak", false); } catch { /* */ } }, 400);
        break;
      case 2:
        // Quick step forward if not moving
        bot.setControlState("forward", true);
        setTimeout(() => { try { bot.setControlState("forward", false); } catch { /* */ } }, 250);
        break;
      case 3:
        // Crouch then stand
        bot.setControlState("sneak", true);
        setTimeout(() => { try { bot.setControlState("sneak", false); } catch { /* */ } }, 600);
        break;
    }
  } catch { /* ignore — bot might not be ready */ }
}

// ─── Loot pickup ─────────────────────────────────────────────────────────────
export function tickLootPickup(bot: Bot): void {
  if (!store.settings.lootPickup) return;
  if (store.state === "COMBAT" || store.state === "FOLLOW") return;

  lootCooldown++;
  if (lootCooldown < 25) return; // every ~10 s
  lootCooldown = 0;

  if (!bot.entity?.position) return;

  let nearest: { entity: unknown; dist: number } | null = null;
  for (const entity of Object.values(bot.entities)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const e = entity as any;
    if (!e || e === bot.entity || !e.position) continue;
    // Dropped items have objectType "item" or name "item"
    if (e.name !== "item" && e.type !== "object") continue;
    const dist = bot.entity.position.distanceTo(e.position);
    if (dist > 6) continue;
    if (!nearest || dist < nearest.dist) nearest = { entity: e, dist };
  }

  if (!nearest) return;

  try {
    const pf = globalThis.require?.("mineflayer-pathfinder");
    if (pf?.goals && bot.pathfinder) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pos = (nearest.entity as any).position;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bot.pathfinder as any).setGoal(
        new pf.goals.GoalBlock(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z))
      );
    }
  } catch { /* ignore */ }
}

// ─── Sneak control ───────────────────────────────────────────────────────────
export function setSneaking(bot: Bot, sneak: boolean): void {
  store.sneaking = sneak;
  try { bot.setControlState("sneak", sneak); } catch { /* ignore */ }
}

// ─── Critical hits ───────────────────────────────────────────────────────────
// Performs a crit by jumping and attacking at the peak (falling = crit window).
// Uses a flag to prevent stacking multiple crits on rapid AI ticks.
export function attackWithCrit(bot: Bot, entity: object): void {
  if (!store.settings.criticalHits || critPending) {
    // Fall back to normal attack
    try { bot.attack(entity as Parameters<typeof bot.attack>[0]); } catch { /* ignore */ }
    return;
  }

  // Only attempt crit if bot is on the ground (can actually jump)
  if (bot.entity?.onGround === false) {
    try { bot.attack(entity as Parameters<typeof bot.attack>[0]); } catch { /* ignore */ }
    return;
  }

  critPending = true;
  try {
    bot.setControlState("jump", true);
    // Attack slightly after jump peak (falling = crit frames in Minecraft)
    setTimeout(() => {
      try {
        bot.setControlState("jump", false);
        bot.attack(entity as Parameters<typeof bot.attack>[0]);
      } catch { /* ignore */ }
      critPending = false;
    }, 250);
  } catch {
    critPending = false;
    try { bot.attack(entity as Parameters<typeof bot.attack>[0]); } catch { /* ignore */ }
  }
}

// ─── Weapon equip ────────────────────────────────────────────────────────────
export function equipBestWeapon(bot: Bot): void {
  const priority = [
    "netherite_sword", "diamond_sword", "iron_sword", "stone_sword", "wooden_sword",
    "netherite_axe", "diamond_axe", "iron_axe", "stone_axe", "wooden_axe",
  ];
  for (const name of priority) {
    const item = bot.inventory.items().find(i => i.name === name);
    if (item) {
      bot.equip(item, "hand").catch(() => {});
      addLog("info", `Weapon equipped: ${name}`);
      return;
    }
  }
}

// ─── Armor equip ─────────────────────────────────────────────────────────────
export function equipBestArmor(bot: Bot): void {
  const slots: Array<{ suffix: string; dest: "head" | "torso" | "legs" | "feet" }> = [
    { suffix: "helmet",     dest: "head" },
    { suffix: "chestplate", dest: "torso" },
    { suffix: "leggings",   dest: "legs" },
    { suffix: "boots",      dest: "feet" },
  ];
  const materials = ["netherite", "diamond", "iron", "chainmail", "golden", "leather"];

  for (const { suffix, dest } of slots) {
    for (const mat of materials) {
      const item = bot.inventory.items().find(i => i.name === `${mat}_${suffix}`);
      if (item) {
        bot.equip(item, dest).catch(() => {});
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
export function resetPatrolIndex(): void { patrolIndex = 0; }

// ─── Reset all AFK/loot counters on reconnect ────────────────────────────────
export function resetAbilityTimers(): void {
  afkTimer = 0;
  afkInterval = 200;
  lootCooldown = 0;
  critPending = false;
  waterJumping = false;
}
