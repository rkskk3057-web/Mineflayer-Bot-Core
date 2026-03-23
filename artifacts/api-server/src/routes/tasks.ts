import { Router, type IRouter } from "express";
import { addTask, removeTask, clearAllTasks, getActiveTasks } from "../bot/tasks.js";

const router: IRouter = Router();

// GET /tasks
router.get("/tasks", (_req, res) => {
  res.json({ tasks: getActiveTasks() });
});

// POST /tasks
router.post("/tasks", (req, res) => {
  const { type, params } = req.body as {
    type: "follow" | "guard_area" | "move_to";
    params: Record<string, unknown>;
  };

  if (!type) {
    res.status(400).json({ success: false, message: "type is required" });
    return;
  }

  addTask(type, params || {});
  res.json({ success: true, message: `Task ${type} added` });
});

// DELETE /tasks/:taskId
router.delete("/tasks/:taskId", (req, res) => {
  const { taskId } = req.params;
  const removed = removeTask(taskId);
  if (!removed) {
    res.status(404).json({ success: false, message: "Task not found" });
    return;
  }
  res.json({ success: true, message: "Task removed" });
});

// POST /tasks/clear
router.post("/tasks/clear", (_req, res) => {
  clearAllTasks();
  res.json({ success: true, message: "All tasks cleared" });
});

export default router;
