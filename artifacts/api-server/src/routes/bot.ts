import { Router, type IRouter } from "express";
import {
  connect,
  disconnect,
  reconnect,
  sendCommand,
  getCurrentStatus,
} from "../bot/index.js";
import { getLogs } from "../bot/logger.js";
import { store } from "../bot/store.js";

const router: IRouter = Router();

// GET /bot/status
router.get("/bot/status", (_req, res) => {
  res.json(getCurrentStatus());
});

// POST /bot/connect
router.post("/bot/connect", (req, res) => {
  const { host, port, username, owner } = req.body as {
    host: string;
    port: number;
    username: string;
    owner: string;
  };

  if (!host || !username) {
    res.status(400).json({ success: false, message: "host and username are required" });
    return;
  }

  connect(host, port || 25565, username, owner || "");
  res.json({ success: true, message: `Connecting to ${host}:${port || 25565}` });
});

// POST /bot/disconnect
router.post("/bot/disconnect", (_req, res) => {
  disconnect();
  res.json({ success: true, message: "Disconnected" });
});

// POST /bot/reconnect
router.post("/bot/reconnect", (_req, res) => {
  reconnect();
  res.json({ success: true, message: "Reconnecting..." });
});

// POST /bot/command
router.post("/bot/command", (req, res) => {
  const { command, value } = req.body as { command: string; value?: string };
  if (!command) {
    res.status(400).json({ success: false, message: "command is required" });
    return;
  }
  const result = sendCommand(command, value ?? undefined);
  res.json(result);
});

// GET /bot/logs
router.get("/bot/logs", (req, res) => {
  const limit = parseInt(String(req.query.limit)) || 200;
  res.json({ logs: getLogs(limit) });
});

export default router;
