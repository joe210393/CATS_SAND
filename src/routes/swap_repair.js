import express from "express";
import { query } from "../db.js";
import { runSwapRepair } from "../services/swap_repair.js";

const router = express.Router();
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

async function loadBaseBomBySampleId(sampleId) {
  const bomRows = await query(`SELECT id FROM boms WHERE sample_id=? AND is_active=1 ORDER BY created_at DESC LIMIT 1`, [sampleId]);
  if (!bomRows.length) return [];
  const items = await query(`SELECT material_id, ratio AS ratioPercent FROM bom_items WHERE bom_id=? ORDER BY ratio DESC`, [bomRows[0].id]);
  return items.map((it) => ({ material_id: Number(it.material_id), ratioPercent: Number(it.ratioPercent) }));
}

router.post(
  "/",
  ah(async (req, res) => {
    const b = req.body || {};
    const baseBOM = Array.isArray(b.baseBOM) && b.baseBOM.length ? b.baseBOM : await loadBaseBomBySampleId(Number(b.baseSampleId));
    if (!baseBOM.length) return res.status(400).json({ ok: false, error: "baseBOM/baseSampleId required" });

    try {
      const result = await runSwapRepair({
        baseBOM,
        fromMainMaterialId: Number(b.fromMainMaterialId),
        toMainMaterialId: Number(b.toMainMaterialId),
        targetXYZ: {
          x: Number(b.targetXYZ?.x || 0),
          y: Number(b.targetXYZ?.y || 0),
          z: Number(b.targetXYZ?.z || 0),
        },
        p: Number(b.p ?? 0.5),
        topN: Number(b.topN || 5),
      });
      res.json({ ok: true, data: result });
    } catch (e) {
      res.status(400).json({ ok: false, error: e?.message || "swap-repair failed" });
    }
  })
);

export default router;
