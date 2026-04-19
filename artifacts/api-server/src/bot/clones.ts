import mineflayer from "mineflayer";
import { addLog } from "./logger.js";
import type { CloneBot } from "./state.js";
import { v4 as uuidv4 } from "uuid";
import { io } from "../socket.js";
import { store } from "./store.js";

interface CloneInstance {
  meta: CloneBot;
  bot: ReturnType<typeof mineflayer.createBot> | null;
  attackCooldown: number;
  eatCooldown: boolean;
  waterJumping: boolean;
}

const clones = new Map<string, CloneInstance>();

function emit() {
  io.emit("clones:update", Array.from(clones.values()).map((c) => c.meta));
}

export function getClones(): CloneBot[] {
  return Array.from(clones.values()).map((c) => c.meta);
}

export function getCloneCount(): number {
  return Array.from(clones.values()).filter((c) => c.meta.status === "online").length;
}

export function spawnClone(host: string, port: number, baseUsername: string, owner: string): CloneBot {
  const id = uuidv4();
  const idx = clones.size + 1;
  const username = `${baseUsername}_c${idx}`;

  const meta: CloneBot = { id, username, status: "connecting", health: 20, food: 20, state: "IDLE", host, port };
  const instance: CloneInstance = { meta, bot: null, attackCooldown: 0, eatCooldown: false, waterJumping: false };
  clones.set(id, instance);
  emit();
  addLog("info", `Spawning clone: ${username}`);

  let bot: ReturnType<typeof mineflayer.createBot>;
  try {
    bot = mineflayer.createBot({
      host,
      port,
      username,
      auth: "offline",
      hideErrors: true,
    });
  } catch (e) {
    meta.status = "error";
    emit();
    addLog("error", `Clone create failed: ${e}`);
    return meta;
  }

  instance.bot = bot;

  bot.once("spawn", () => {
    meta.status = "online";
    meta.state = "FOLLOW";
    addLog("info", `Clone ${username} online (v${bot.version})`);
    emit();
    loadPathfinder(bot, owner);
    setupCloneEvents(bot, meta, instance);
  });

  bot.on("kicked", (reason) => {
    meta.status = "offline";
    meta.state = "offline";
    addLog("warn", `Clone ${username} kicked: ${reason}`);
    emit();
  });

  bot.on("error", () => {
    meta.status = "error";
    emit();
  });

  bot.on("end", () => {
    if (meta.status !== "offline") {
      meta.status = "offline";
      meta.state = "offline";
      emit();
    }
  });

  return meta;
}

function setupCloneEvents(
  bot: ReturnType<typeof mineflayer.createBot>,
  meta: CloneBot,
  instance: CloneInstance
): void {
  // ── Health tracking ──────────────────────────────────────────────────────
  bot.on("health", () => {
    meta.health = bot.health ?? 20;
    meta.food   = bot.food   ?? 20;
    emit();

    // Auto-eat
    if ((bot.food ?? 20) <= 14 && !instance.eatCooldown) {
      tryCloneEat(bot, instance);
    }
  });

  // ── Death / respawn ──────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (bot as any).on("death", () => {
    meta.health = 0;
    meta.state  = "IDLE";
    addLog("warn", `Clone ${meta.username} died`);
    emit();
    setTimeout(() => {
      try { bot.respawn(); addLog("info", `Clone ${meta.username} respawned`); } catch { /* ignore */ }
    }, 2000);
  });

  // ── Physics tick ─────────────────────────────────────────────────────────
  // IMPORTANT: bot.entity.isInWater is the correct mineflayer property.
  // bot.isInWater does NOT exist and is always undefined.
  bot.on("physicsTick", () => {
    // Swimming fix
    const inWater = (bot.entity as unknown as { isInWater?: boolean })?.isInWater === true;

    if (inWater) {
      instance.waterJumping = true;
      bot.setControlState("jump", true);
    } else if (instance.waterJumping) {
      instance.waterJumping = false;
      bot.setControlState("jump", false);
    }

    // Attack cooldown
    if (instance.attackCooldown > 0) {
      instance.attackCooldown--;
      return;
    }

    // Self-defence: attack hostiles that are very close
    if (bot.entity?.position) {
      const hostile = findNearestHostileClone(bot);
      if (hostile && hostile.dist < 3.5) {
        try {
          bot.lookAt(hostile.entity.position.offset(0, (hostile.entity as unknown as { height?: number }).height ?? 1.6, 0));
          bot.attack(hostile.entity as Parameters<typeof bot.attack>[0]);
          instance.attackCooldown = 12; // ~600ms
        } catch { /* ignore */ }
      }
    }
  });

  // ── If attacked, retaliate immediately ───────────────────────────────────
  bot.on("entityHurt", (entity) => {
    if (entity !== bot.entity) return;
    // Reset cooldown so we can attack right now
    instance.attackCooldown = 0;
  });
}

function findNearestHostileClone(bot: ReturnType<typeof mineflayer.createBot>): {
  entity: ReturnType<typeof mineflayer.createBot>["entities"][string];
  dist: number;
} | null {
  if (!bot.entity?.position) return null;

  const hostileMobs = new Set([
    "zombie", "skeleton", "creeper", "spider", "cave_spider",
    "blaze", "witch", "phantom", "drowned", "husk", "stray",
    "pillager", "vindicator", "ravager", "enderman", "slime",
    "magma_cube", "ghast", "wither_skeleton", "zombified_piglin",
    "piglin_brute", "zoglin", "hoglin", "vex", "silverfish",
  ]);

  let nearest: { entity: typeof bot.entities[string]; dist: number } | null = null;

  for (const entity of Object.values(bot.entities)) {
    if (!entity || entity === bot.entity || !entity.position) continue;
    const name = entity.name ?? entity.type ?? "";
    if (!hostileMobs.has(name)) continue;
    const dist = bot.entity.position.distanceTo(entity.position);
    if (dist > 8) continue;
    if (!nearest || dist < nearest.dist) nearest = { entity, dist };
  }

  return nearest;
}

function loadPathfinder(bot: ReturnType<typeof mineflayer.createBot>, owner: string) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pf = globalThis.require?.("mineflayer-pathfinder");
    if (!pf?.pathfinder || !pf?.Movements || !pf?.goals) return;

    bot.loadPlugin(pf.pathfinder);
    const movements = new pf.Movements(bot);
    movements.canDig         = false;
    movements.allowParkour   = false;
    movements.allowSprinting = true;
    movements.maxDropDown    = 4;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (bot.pathfinder as any).setMovements(movements);

    // Update follow goal every 1.5s (not every tick — reduces CPU)
    let lastOwnerPos: { x: number; y: number; z: number } | null = null;
    setInterval(() => {
      try {
        if (bot.entity?.position == null) return;
        // Respect owner setting from main store
        const ownerName = owner || store.settings.owner;
        const ownerPlayer = ownerName
          ? Object.values(bot.players).find(p => p.username?.toLowerCase() === ownerName.toLowerCase())
          : null;

        if (ownerPlayer?.entity?.position) {
          const op = ownerPlayer.entity.position;
          const moved = !lastOwnerPos ||
            Math.abs(op.x - lastOwnerPos.x) + Math.abs(op.z - lastOwnerPos.z) > 1.5;
          if (moved) {
            lastOwnerPos = { x: op.x, y: op.y, z: op.z };
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (bot.pathfinder as any).setGoal(
              new pf.goals.GoalFollow(ownerPlayer.entity, 3), true
            );
          }
        }
      } catch { /* ignore */ }
    }, 1500);

    addLog("info", `Clone ${bot.username} pathfinder loaded`);
  } catch (e) {
    addLog("warn", `Clone pathfinder failed: ${e}`);
  }
}

function tryCloneEat(bot: ReturnType<typeof mineflayer.createBot>, instance: CloneInstance): void {
  const priority = [
    "cooked_beef", "cooked_porkchop", "cooked_mutton",
    "cooked_chicken", "cooked_salmon", "cooked_cod",
    "bread", "baked_potato", "apple", "carrot",
  ];

  const food = priority
    .map(name => bot.inventory.items().find(i => i.name === name))
    .find(Boolean);

  if (!food) return;

  instance.eatCooldown = true;
  bot.equip(food, "hand")
    .then(() => bot.consume())
    .catch(() => {})
    .finally(() => setTimeout(() => { instance.eatCooldown = false; }, 3000));
}

export function killClone(id: string): boolean {
  const instance = clones.get(id);
  if (!instance) return false;
  try { instance.bot?.end(); } catch { /* ignore */ }
  instance.meta.status = "offline";
  clones.delete(id);
  addLog("info", `Clone ${instance.meta.username} terminated`);
  emit();
  return true;
}

export function killAllClones(): void {
  for (const [id] of clones) {
    killClone(id);
  }
}
