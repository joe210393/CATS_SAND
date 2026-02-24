import express from "express";
import { query } from "../db.js";
import { mustNumber, safeJsonParse } from "../utils/validate.js";
import { evaluateContributions } from "../services/surfaces_demo.js";

const router = express.Router();
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const ALLOWED_METRICS = new Set(["deodor_rate", "absorption", "dust_score", "clump_strength", "z_crush"]);

async function getRecipe(sampleId) {
  const bRows = await query(
    `SELECT id FROM boms WHERE sample_id=? AND is_active=1 ORDER BY created_at DESC LIMIT 1`,
    [sampleId]
  );
  if (!bRows.length) return [];
  const items = await query(
    `SELECT m.name AS material, bi.ratio AS ratioPercent
     FROM bom_items bi
     JOIN materials m ON m.id=bi.material_id
     WHERE bi.bom_id=?
     ORDER BY bi.ratio DESC`,
    [bRows[0].id]
  );
  const recipe = items.map((x) => ({ material: x.material, ratio: Number(x.ratioPercent) / 100 }));
  const sum = recipe.reduce((t, x) => t + x.ratio, 0) || 1;
  for (const it of recipe) it.ratio /= sum;
  return recipe;
}

router.post(
  "/",
  ah(async (req, res) => {
    const b = req.body || {};
    const sampleId = Number(b.sampleId);
    const metric = String(b.metric || "deodor_rate");
    const scanMaterialName = String(b.scanMaterialName || "");
    const p = Math.max(0, Math.min(1, mustNumber(b.p ?? 0.5, "p")));
    const rValue = Math.max(0, Math.min(1, mustNumber(b.rValue ?? 0, "rValue")));
    const rule = ["A", "B"].includes(String(b.rule || "A").toUpperCase()) ? String(b.rule || "A").toUpperCase() : "A";

    if (!sampleId) return res.status(400).json({ ok: false, error: "sampleId required" });
    if (!ALLOWED_METRICS.has(metric)) return res.status(400).json({ ok: false, error: "invalid metric" });
    if (!scanMaterialName) return res.status(400).json({ ok: false, error: "scanMaterialName required" });

    const recipe = await getRecipe(sampleId);
    if (!recipe.length) return res.json({ ok: true, data: { rValue, parts: [], message: "此樣品尚未設定 BOM" } });

    const mats = await query(`SELECT name, function_tags FROM materials`);
    const materialMap = new Map();
    for (const m of mats) materialMap.set(m.name, { name: m.name, function_tags: safeJsonParse(m.function_tags, []) || [] });

    const out = evaluateContributions(materialMap, recipe, metric, scanMaterialName, p, rValue, rule);
    res.json({ ok: true, data: out });
  })
);

export default router;
