import { v4 as uuidv4 } from "uuid";
import { store } from "./store.js";
import { addLog } from "./logger.js";
import type { BotTask } from "./state.js";

export function addTask(type: BotTask["type"], params: Record<string, unknown>): BotTask {
  const task: BotTask = {
    id: uuidv4(),
    type,
    status: "pending",
    params,
  };
  store.tasks.push(task);
  addLog("info", `Task added: ${type}`);
  return task;
}

export function removeTask(taskId: string): boolean {
  const idx = store.tasks.findIndex((t) => t.type !== undefined && t.id === taskId);
  if (idx === -1) return false;
  store.tasks.splice(idx, 1);
  return true;
}

export function clearAllTasks(): void {
  store.tasks = [];
  addLog("info", "All tasks cleared");
}

export function getActiveTasks(): BotTask[] {
  return store.tasks;
}

export function pauseAllTasks(): void {
  for (const task of store.tasks) {
    if (task.status === "active") {
      task.status = "paused";
    }
  }
}

export function resumeTasks(): void {
  for (const task of store.tasks) {
    if (task.status === "paused") {
      task.status = "pending";
    }
  }
}

export function getNextPendingTask(): BotTask | null {
  return store.tasks.find((t) => t.status === "pending") || null;
}

export function setTaskActive(taskId: string): void {
  const task = store.tasks.find((t) => t.id === taskId);
  if (task) task.status = "active";
}

export function setTaskDone(taskId: string): void {
  const task = store.tasks.find((t) => t.id === taskId);
  if (task) {
    task.status = "done";
    addLog("info", `Task completed: ${task.type}`);
  }
}
