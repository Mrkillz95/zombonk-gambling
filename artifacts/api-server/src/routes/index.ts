import { Router, type IRouter } from "express";
import healthRouter from "./health";
import playersRouter from "./players";
import gamesRouter from "./games";
import modRouter from "./mod";

const router: IRouter = Router();

router.use(healthRouter);
router.use(playersRouter);
router.use(gamesRouter);
router.use(modRouter);

export default router;
