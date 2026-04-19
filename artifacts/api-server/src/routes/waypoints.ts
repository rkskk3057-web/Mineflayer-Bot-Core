import { Router, type IRouter } from "express";
import { store } from "../bot/store.js";
import { addLog } from "../bot/logger.js";
import { resetPatrolIndex } from "../bot/abilities.js";
import { v4 as uuidv4 } from "uuid";

const router: IRouter = Router();

// GET /waypoints
router.get("/waypoints", (_req, res) => {
  res.json({ waypoints: store.waypoints });
});

// POST /waypoints — add a waypoint
router.post("/waypoints", (req, res) => {
  const { label, x, y, z } = req.body as { label: string; x: number; y: number; z: number };
  if (x === undefined || y === undefined || z === undefined) {
    res.status(400).json({ success: false, message: "x, y, z required" });
    return;
  }
  const wp = { id: uuidv4(), label: label || `WP${store.waypoints.length + 1}`, x, y, z };
  store.waypoints.push(wp);
  addLog("info", `Waypoint added: ${wp.label} (${x},${y},${z})`);
  res.json({ success: true, message: "Waypoint added", waypoint: wp });
});

// DELETE /waypoints/all
router.delete("/waypoints/all", (_req, res) => {
  store.waypoints = [];
  resetPatrolIndex();
  addLog("info", "All waypoints cleared");
  res.json({ success: true, message: "Waypoints cleared" });
});

// DELETE /waypoints/:id
router.delete("/waypoints/:id", (req, res) => {
  const idx = store.waypoints.findIndex(w => w.id === req.params.id);
  if (idx === -1) {
    res.status(404).json({ success: false, message: "Waypoint not found" });
    return;
  }
  store.waypoints.splice(idx, 1);
  resetPatrolIndex();
  res.json({ success: true, message: "Waypoint removed" });
});

export default router;
