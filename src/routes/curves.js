import express from "express";
import { query } from "../db.js";
import { mustNumber, safeJsonParse } from "../utils/validate.js";
import { evaluateMixedCurve, evaluateSingleMaterialCurve } from "../services/surfaces_demo.js";

const router = express.Router();
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const ALLOWED_METRICS = new Set(["deodor_rate", "absorption", "dust_score", "clump_strength", "z_crush"]);

async function getSampleActiveBom(sampleId) {
  const rows = await query(
    `SELECT s.id, s.name, s.x_deodor, s.y_absorb, s.z_crush, b.id AS bom_id, b.version
     FROM samples s
     LEFT JOIN boms b ON b.sample_id=s.id AND b.is_active=1
     WHERE s.id=?`,
    [sampleId]
  );
  if (!rows.length) return null;
  const base = rows[0];

  let bomItems = [];
  if (base.bom_id) {
    bomItems = await query(
      `SELECT m.name AS material, bi.ratio
       FROM bom_items bi
       JOIN materials m ON m.id=bi.material_id
       WHERE bi.bom_id=?
       ORDER BY bi.ratio DESC`,
      [base.bom_id]
    );
  }

  return {
    sample: {
      id: base.id,
      name: base.name,
      x: Number(base.x_deodor),
      y: Number(base.y_absorb),
      z: Number(base.z_crush),
    },
    bomId: base.bom_id || null,
    bomVersion: base.version || null,
    bomItems: bomItems.map((x) => ({ material: x.material, ratioPercent: Number(x.ratio) })),
  };
}

router.post(
  "/",
  ah(async (req, res) => {
    const b = req.body || {};
    const sampleId = Number(b.sampleId);
    const mode = String(b.mode || "single");
    const metric = String(b.metric || "deodor_rate");
    const p = Math.max(0, Math.min(1, mustNumber(b.p ?? 0.5, "p")));
    const rMax = Math.max(0.01, Math.min(1, mustNumber(b.rMax ?? 0.3, "rMax")));
    const steps = Math.max(5, Math.min(101, Number(b.steps || 31)));

    if (!sampleId) return res.status(400).json({ ok: false, error: "sampleId required" });
    if (!ALLOWED_METRICS.has(metric)) return res.status(400).json({ ok: false, error: "invalid metric" });
    if (!["single", "mix"].includes(mode)) return res.status(400).json({ ok: false, error: "invalid mode" });

    const sampleBom = await getSampleActiveBom(sampleId);
    if (!sampleBom) return res.status(404).json({ ok: false, error: "sample not found" });
    if (!sampleBom.bomItems.length) {
      return res.json({
        ok: true,
        data: { x: [], y: [], xyzSeries: { x: [], y: [], z: [] }, message: "此樣品尚未設定 BOM" },
      });
    }

    const mats = await query(`SELECT name, function_tags FROM materials`);
    const materialMap = new Map();
    for (const m of mats) {
      materialMap.set(m.name, { name: m.name, function_tags: safeJsonParse(m.function_tags, []) || [] });
    }

    if (mode === "single") {
      const materialName = String(b.materialName || "");
      const materialMeta = materialMap.get(materialName);
      if (!materialMeta) return res.status(400).json({ ok: false, error: "materialName not found" });
      const out = evaluateSingleMaterialCurve(materialMeta, metric, p, rMax, steps);
      return res.json({ ok: true, data: { ...out, xyzSeries: { x: [], y: [], z: [] } } });
    }

    const scanMaterialName = String(b.scanMaterialName || "");
    if (!materialMap.has(scanMaterialName)) return res.status(400).json({ ok: false, error: "scanMaterialName not found" });

    const recipe = sampleBom.bomItems.map((x) => ({ material: x.material, ratio: Number(x.ratioPercent) / 100 }));
    const sum = recipe.reduce((t, x) => t + x.ratio, 0) || 1;
    for (const it of recipe) it.ratio /= sum;

    const out = evaluateMixedCurve(materialMap, recipe, metric, scanMaterialName, p, rMax, steps);
    res.json({ ok: true, data: out });
  })
);

export default router;
