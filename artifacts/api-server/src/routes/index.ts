import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import botRouter from "./bot.js";
import settingsRouter from "./settings.js";
import tasksRouter from "./tasks.js";
import serversRouter from "./servers.js";
import clonesRouter from "./clones.js";
import waypointsRouter from "./waypoints.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(botRouter);
router.use(settingsRouter);
router.use(tasksRouter);
router.use(serversRouter);
router.use(clonesRouter);
router.use(waypointsRouter);

export default router;
