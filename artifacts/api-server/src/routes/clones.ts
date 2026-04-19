import { Router, type IRouter } from "express";
import { spawnClone, killClone, killAllClones, getClones } from "../bot/clones.js";
import { store } from "../bot/store.js";

const router: IRouter = Router();

// GET /clones
router.get("/clones", (_req, res) => {
  res.json({ clones: getClones() });
});

// POST /clones — spawn a new clone
router.post("/clones", (req, res) => {
  const { username } = req.body as { username?: string };
  if (!store.connected) {
    res.status(400).json({ success: false, message: "Main bot must be connected first" });
    return;
  }
  if (getClones().filter(c => c.status !== "offline").length >= 5) {
    res.status(400).json({ success: false, message: "Max 5 active clones" });
    return;
  }
  const cloneUsername = username || store.username;
  const clone = spawnClone(store.serverHost, store.serverPort, cloneUsername, store.settings.owner);
  res.json({ success: true, message: `Clone spawned: ${clone.username}`, clone });
});

// DELETE /clones/all
router.delete("/clones/all", (_req, res) => {
  killAllClones();
  res.json({ success: true, message: "All clones terminated" });
});

// DELETE /clones/:id
router.delete("/clones/:id", (req, res) => {
  const { id } = req.params;
  const ok = killClone(id);
  if (!ok) {
    res.status(404).json({ success: false, message: "Clone not found" });
    return;
  }
  res.json({ success: true, message: "Clone terminated" });
});

export default router;
