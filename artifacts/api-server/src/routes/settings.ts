import { Router, type IRouter } from "express";
import { store } from "../bot/store.js";
import { addLog } from "../bot/logger.js";
import type { BotSettings } from "../bot/state.js";

const router: IRouter = Router();

// GET /settings
router.get("/settings", (_req, res) => {
  res.json(store.settings);
});

// PUT /settings
router.put("/settings", (req, res) => {
  const body = req.body as Partial<BotSettings>;
  Object.assign(store.settings, body);
  addLog("info", "Settings updated");
  res.json(store.settings);
});

// GET /settings/whitelist
router.get("/settings/whitelist", (_req, res) => {
  res.json({ whitelist: Array.from(store.whitelist) });
});

// POST /settings/whitelist
router.post("/settings/whitelist", (req, res) => {
  const { username } = req.body as { username: string };
  if (!username) {
    res.status(400).json({ success: false, message: "username is required" });
    return;
  }
  store.whitelist.add(username);
  addLog("info", `Added to whitelist: ${username}`);
  res.json({ success: true, message: `${username} added to whitelist` });
});

// DELETE /settings/whitelist/:username
router.delete("/settings/whitelist/:username", (req, res) => {
  const { username } = req.params;
  store.whitelist.delete(username);
  addLog("info", `Removed from whitelist: ${username}`);
  res.json({ success: true, message: `${username} removed from whitelist` });
});

export default router;
