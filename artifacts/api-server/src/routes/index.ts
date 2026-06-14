import { Router, type IRouter } from "express";
import healthRouter from "./health";
import playersRouter from "./players";
import gamesRouter from "./games";
import roundsRouter from "./rounds";
import modRouter from "./mod";
import redemptionsRouter from "./redemptions";
import lobbiesRouter from "./lobbies";
import { modIpGate } from "../lib/mod-auth.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(playersRouter);
router.use(gamesRouter);
router.use(roundsRouter);
// Enforce the mod IP allowlist for every /mod/* route across all routers.
router.use("/mod", modIpGate);
router.use(modRouter);
router.use(redemptionsRouter);
router.use(lobbiesRouter);

export default router;
