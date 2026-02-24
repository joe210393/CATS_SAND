import express from "express";
import { optimizeRecipe } from "../services/optimizer.js";

const router = express.Router();
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.post(
  "/",
  ah(async (req, res) => {
    const b = req.body || {};
    if (!b.mainMaterialId) return res.status(400).json({ ok: false, error: "mainMaterialId required" });
    if (!b.targetXYZ) return res.status(400).json({ ok: false, error: "targetXYZ required" });

    const candidates = await optimizeRecipe({
      mainMaterialId: Number(b.mainMaterialId),
      mainRatioRange: b.mainRatioRange || { min: 50, max: 80, step: 5 },
      targetXYZ: {
        x: Number(b.targetXYZ.x || 0),
        y: Number(b.targetXYZ.y || 0),
        z: Number(b.targetXYZ.z || 0),
      },
      constraints: b.constraints || {},
      p: Number(b.p ?? 0.5),
      topN: Number(b.topN || 10),
    });

    res.json({ ok: true, data: { candidates } });
  })
);

export default router;
