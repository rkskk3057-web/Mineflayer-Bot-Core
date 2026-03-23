import { Router, type IRouter } from "express";
import { v4 as uuidv4 } from "uuid";
import { store } from "../bot/store.js";
import type { ServerConfig } from "../bot/state.js";

const router: IRouter = Router();

// GET /servers
router.get("/servers", (_req, res) => {
  res.json({ configs: store.serverConfigs });
});

// POST /servers
router.post("/servers", (req, res) => {
  const body = req.body as Omit<ServerConfig, "id">;
  if (!body.name || !body.host || !body.username) {
    res.status(400).json({ success: false, message: "name, host, and username are required" });
    return;
  }
  const config: ServerConfig = {
    id: uuidv4(),
    name: body.name,
    host: body.host,
    port: body.port || 25565,
    username: body.username,
    owner: body.owner || "",
  };
  store.serverConfigs.push(config);
  res.json({ success: true, message: "Server config saved" });
});

// DELETE /servers/:configId
router.delete("/servers/:configId", (req, res) => {
  const { configId } = req.params;
  const idx = store.serverConfigs.findIndex((c) => c.id === configId);
  if (idx === -1) {
    res.status(404).json({ success: false, message: "Config not found" });
    return;
  }
  store.serverConfigs.splice(idx, 1);
  res.json({ success: true, message: "Config deleted" });
});

export default router;
