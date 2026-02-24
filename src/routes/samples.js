import express from "express";
import { exec, query } from "../db.js";
import { safeJsonParse } from "../utils/validate.js";
import { evaluateBomItems, getActiveBomItemsBySampleId, recomputeAllSampleScores } from "../services/recipe_engine.js";

const router = express.Router();
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function randn() {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function normalizeBom(items) {
  const positive = items.map((it) => ({
    material_id: Number(it.material_id),
    ratioPercent: Math.max(0.001, Number(it.ratioPercent || 0)),
    material: it.material,
  }));
  const sum = positive.reduce((t, it) => t + it.ratioPercent, 0) || 1;
  return positive.map((it) => ({ ...it, ratioPercent: (it.ratioPercent / sum) * 100 }));
}

router.get(
  "/",
  ah(async (req, res) => {
  const search = (req.query.search || "").toString().trim();
  const page = Math.max(1, Number.parseInt(String(req.query.page || 1), 10));
  const pageSize = Math.min(200, Math.max(10, Number.parseInt(String(req.query.pageSize || 50), 10)));
  const offset = (page - 1) * pageSize;

  const where = search ? "WHERE name LIKE ?" : "";
  const limitSql = `LIMIT ${pageSize} OFFSET ${offset}`;
  const params = search ? [`%${search}%`] : [];

  const rows = await query(
    `SELECT id, name, x_deodor, y_absorb, z_crush, tags, status, updated_at
     FROM samples ${where}
     ORDER BY updated_at DESC
     ${limitSql}`,
    params
  );

  rows.forEach((r) => {
    r.tags = safeJsonParse(r.tags, []);
  });

  res.json({ ok: true, data: rows, page, pageSize });
})
);

router.post(
  "/recompute-scores",
  ah(async (req, res) => {
    const p = Number(req.body?.p ?? 0.5);
    const out = await recomputeAllSampleScores(p);
    res.json({ ok: true, data: out });
  })
);

router.post(
  "/:id/ratio-surface",
  ah(async (req, res) => {
    const id = Number(req.params.id);
    const p = Number(req.body?.p ?? 0.5);
    const pointsCount = Math.min(450, Math.max(30, Number(req.body?.points || 180)));
    const strength = Math.max(0.05, Math.min(1.2, Number(req.body?.strength || 0.35)));
    const baseItems = await getActiveBomItemsBySampleId(id);
    if (!baseItems.length) {
      return res.json({ ok: true, data: { points: [], base: null, message: "此樣品尚未設定 BOM" } });
    }

    const baseEval = await evaluateBomItems(baseItems, p);
    const points = [
      {
        xyz: baseEval.xyz,
        metrics: baseEval.metrics,
        bomItems: baseItems,
        isBase: true,
      },
    ];

    for (let i = 0; i < pointsCount; i += 1) {
      const mutated = normalizeBom(
        baseItems.map((it) => ({
          ...it,
          ratioPercent: Number(it.ratioPercent) * (1 + randn() * strength),
        }))
      );
      const out = await evaluateBomItems(mutated, p);
      points.push({
        xyz: out.xyz,
        metrics: out.metrics,
        bomItems: mutated,
        isBase: false,
      });
    }

    res.json({
      ok: true,
      data: {
        base: points[0],
        points,
        message: "同材料組合比例掃描完成",
      },
    });
  })
);

router.post(
  "/",
  ah(async (req, res) => {
  const { name, tags, status, notes } = req.body || {};
  if (!name) return res.status(400).json({ ok: false, error: "name required" });

  const tagsJson = JSON.stringify(Array.isArray(tags) ? tags : []);
  const st = ["draft", "tested", "archived"].includes(status) ? status : "draft";

  const { meta } = await exec(
    `INSERT INTO samples (name, x_deodor, y_absorb, z_crush, tags, status, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [name, 0, 0, 0, tagsJson, st, notes || null]
  );

  res.json({ ok: true, id: meta.insertId });
})
);

router.get(
  "/:id",
  ah(async (req, res) => {
  const id = Number(req.params.id);
  const rows = await query(`SELECT * FROM samples WHERE id=?`, [id]);
  if (!rows.length) return res.status(404).json({ ok: false, error: "not found" });
  const sample = rows[0];
  sample.tags = safeJsonParse(sample.tags, []);
  res.json({ ok: true, data: sample });
})
);

router.get(
  "/:id/active-bom",
  ah(async (req, res) => {
    const id = Number(req.params.id);
    const sRows = await query(`SELECT id, name, x_deodor, y_absorb, z_crush FROM samples WHERE id=?`, [id]);
    if (!sRows.length) return res.status(404).json({ ok: false, error: "sample not found" });
    const s = sRows[0];

    const bRows = await query(
      `SELECT id, version, is_active FROM boms WHERE sample_id=? AND is_active=1 ORDER BY created_at DESC LIMIT 1`,
      [id]
    );
    if (!bRows.length) {
      return res.json({
        ok: true,
        data: {
          sample: { id: s.id, name: s.name, x: Number(s.x_deodor), y: Number(s.y_absorb), z: Number(s.z_crush) },
          bomItems: [],
          message: "此樣品尚未設定 BOM",
        },
      });
    }

    const bomId = bRows[0].id;
    const items = await query(
      `SELECT m.name AS material, bi.ratio AS ratioPercent
       FROM bom_items bi
       JOIN materials m ON m.id=bi.material_id
       WHERE bi.bom_id=?
       ORDER BY bi.ratio DESC`,
      [bomId]
    );

    res.json({
      ok: true,
      data: {
        sample: { id: s.id, name: s.name, x: Number(s.x_deodor), y: Number(s.y_absorb), z: Number(s.z_crush) },
        bomVersion: bRows[0].version,
        bomItems: items.map((x) => ({ material: x.material, ratioPercent: Number(x.ratioPercent) })),
      },
    });
  })
);

router.get(
  "/:id/active-bom-with-scores",
  ah(async (req, res) => {
    const id = Number(req.params.id);
    const sRows = await query(`SELECT id, name, x_deodor, y_absorb, z_crush FROM samples WHERE id=?`, [id]);
    if (!sRows.length) return res.status(404).json({ ok: false, error: "sample not found" });
    const s = sRows[0];

    const bomItems = await getActiveBomItemsBySampleId(id);
    if (!bomItems.length) {
      return res.json({
        ok: true,
        data: {
          sample: { id: s.id, name: s.name },
          bomItems: [],
          metrics: {},
          xyz: { x: Number(s.x_deodor), y: Number(s.y_absorb), z: Number(s.z_crush) },
          message: "此樣品尚未設定 BOM",
        },
      });
    }
    const out = await evaluateBomItems(bomItems, 0.5);
    res.json({
      ok: true,
      data: {
        sample: { id: s.id, name: s.name },
        bomItems: bomItems.map((it) => ({ material: it.material, ratioPercent: it.ratioPercent, material_id: it.material_id })),
        metrics: out.metrics,
        xyz: out.xyz,
      },
    });
  })
);

router.put(
  "/:id",
  ah(async (req, res) => {
  const id = Number(req.params.id);
  const { name, tags, status, notes } = req.body || {};

  const tagsJson = JSON.stringify(Array.isArray(tags) ? tags : []);
  const st = ["draft", "tested", "archived"].includes(status) ? status : "draft";

  await exec(
    `UPDATE samples
     SET name=?, tags=?, status=?, notes=?
     WHERE id=?`,
    [name, tagsJson, st, notes || null, id]
  );

  res.json({ ok: true });
})
);

router.delete(
  "/:id",
  ah(async (req, res) => {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ ok: false, error: "invalid id" });
    await exec(`DELETE FROM samples WHERE id=?`, [id]);
    res.json({ ok: true });
  })
);

router.post(
  "/batch-delete",
  ah(async (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map((x) => Number(x)).filter(Boolean) : [];
    if (!ids.length) return res.status(400).json({ ok: false, error: "ids required" });
    const placeholders = ids.map(() => "?").join(",");
    await exec(`DELETE FROM samples WHERE id IN (${placeholders})`, ids);
    res.json({ ok: true, deleted: ids.length });
  })
);

export default router;
