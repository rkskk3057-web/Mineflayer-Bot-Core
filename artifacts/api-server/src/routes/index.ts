import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import botRouter from "./bot.js";
import settingsRouter from "./settings.js";
import tasksRouter from "./tasks.js";
import serversRouter from "./servers.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(botRouter);
router.use(settingsRouter);
router.use(tasksRouter);
router.use(serversRouter);

export default router;
