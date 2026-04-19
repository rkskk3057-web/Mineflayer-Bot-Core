import mineflayer from "mineflayer";
import { addLog } from "./logger.js";
import type { CloneBot } from "./state.js";
import { v4 as uuidv4 } from "uuid";
import { io } from "../socket.js";

interface CloneInstance {
  meta: CloneBot;
  bot: ReturnType<typeof mineflayer.createBot> | null;
  attackCooldown: number;
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
  const instance: CloneInstance = { meta, bot: null, attackCooldown: 0 };
  clones.set(id, instance);
  emit();
  addLog("info", `Spawning clone bot: ${username}`);

  const bot = mineflayer.createBot({
    host,
    port,
    username,
    version: "1.20.4",
    auth: "offline",
    hideErrors: true,
  });

  instance.bot = bot;

  bot.once("spawn", () => {
    meta.status = "online";
    meta.state = "FOLLOW";
    addLog("info", `Clone ${username} spawned`);
    emit();
    loadPathfinder(bot, owner);
    setupClonePhysics(bot, meta);
    setupCloneCombat(bot, meta, instance);
  });

  bot.on("health", () => {
    meta.health = bot.health ?? 20;
    meta.food = bot.food ?? 20;
    emit();

    if ((bot.health ?? 20) <= 0) {
      setTimeout(() => {
        try { bot.respawn(); } catch { /* ignore */ }
      }, 2000);
    }
  });

  bot.on("death", () => {
    meta.state = "IDLE";
    addLog("warn", `Clone ${username} died`);
    emit();
    setTimeout(() => {
      try { bot.respawn(); } catch { /* ignore */ }
    }, 2000);
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

function loadPathfinder(bot: ReturnType<typeof mineflayer.createBot>, owner: string) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { pathfinder, Movements, goals } = globalThis.require?.("mineflayer-pathfinder") ?? {};
    if (!pathfinder) return;
    bot.loadPlugin(pathfinder);
    const movements = new Movements(bot);
    movements.canDig = false;
    movements.allowParkour = false;
    movements.allowSprinting = true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (bot.pathfinder as any).setMovements(movements);

    // Follow owner
    const followTick = () => {
      try {
        const ownerPlayer = Object.values(bot.players).find(
          (p) => p.username?.toLowerCase() === owner.toLowerCase()
        );
        if (ownerPlayer?.entity) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (bot.pathfinder as any).setGoal(new goals.GoalFollow(ownerPlayer.entity, 3), true);
        }
      } catch { /* ignore */ }
    };

    setInterval(followTick, 1000);
  } catch {
    /* pathfinder not loaded */
  }
}

function setupClonePhysics(bot: ReturnType<typeof mineflayer.createBot>, meta: CloneBot) {
  bot.on("physicsTick", () => {
    meta.health = bot.health ?? 20;
    meta.food = bot.food ?? 20;

    // Swim
    if (bot.isInWater) {
      bot.setControlState("jump", true);
    }

    // Auto eat
    if ((bot.food ?? 20) < 14) {
      tryEat(bot);
    }
  });
}

function setupCloneCombat(
  bot: ReturnType<typeof mineflayer.createBot>,
  meta: CloneBot,
  instance: CloneInstance
) {
  bot.on("entityHurt", (entity) => {
    if (entity !== bot.entity) return;
    // fight back
    attackNearestPlayer(bot, instance);
  });

  bot.on("physicsTick", () => {
    if (instance.attackCooldown > 0) {
      instance.attackCooldown--;
      return;
    }
    attackNearestPlayer(bot, instance);
  });
}

function attackNearestPlayer(bot: ReturnType<typeof mineflayer.createBot>, instance: CloneInstance) {
  if (!bot.entity?.position) return;
  let closest: { entity: object; dist: number } | null = null;
  for (const entity of Object.values(bot.entities)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const e = entity as any;
    if (!e || e === bot.entity || !e.position) continue;
    if (e.type !== "player") continue;
    const dist = bot.entity.position.distanceTo(e.position);
    if (dist > 10) continue;
    if (!closest || dist < closest.dist) closest = { entity: e, dist };
  }
  if (closest && closest.dist < 3) {
    try {
      bot.attack(closest.entity as Parameters<typeof bot.attack>[0]);
      instance.attackCooldown = 10;
    } catch { /* ignore */ }
  }
}

function tryEat(bot: ReturnType<typeof mineflayer.createBot>) {
  const foodItems = ["cooked_beef", "cooked_chicken", "cooked_pork", "bread", "apple"];
  for (const name of foodItems) {
    const item = bot.inventory.items().find((i) => i.name.includes(name));
    if (item) {
      try {
        bot.equip(item, "hand").catch(() => {});
      } catch { /* ignore */ }
      break;
    }
  }
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
