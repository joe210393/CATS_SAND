import express from "express";
import { evaluateBomItems } from "../services/recipe_engine.js";

const router = express.Router();
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.post(
  "/",
  ah(async (req, res) => {
    const bomItems = Array.isArray(req.body?.bomItems) ? req.body.bomItems : [];
    const p = Number(req.body?.p ?? 0.5);
    const out = await evaluateBomItems(bomItems, p);
    res.json({ ok: true, data: out });
  })
);

export default router;
