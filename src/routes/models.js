import express from "express";
import { exec, query } from "../db.js";
import { safeJsonParse } from "../utils/validate.js";
import { evalExpression } from "../services/expression_engine.js";

const router = express.Router();
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.get(
  "/",
  ah(async (req, res) => {
    const materialId = Number(req.query.materialId || 0);
    const metric = String(req.query.metric || "");

    const where = [];
    const params = [];
    if (materialId) {
      where.push("mm.material_id=?");
      params.push(materialId);
    }
    if (metric) {
      where.push("mm.metric=?");
      params.push(metric);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const rows = await query(
      `SELECT mm.*, m.name AS material_name
       FROM material_models mm
       JOIN materials m ON m.id=mm.material_id
       ${whereSql}
       ORDER BY mm.updated_at DESC`,
      params
    );
    rows.forEach((r) => {
      r.params_json = safeJsonParse(r.params_json, {});
      r.variables_json = safeJsonParse(r.variables_json, ["r", "p"]);
    });
    res.json({ ok: true, data: rows });
  })
);

router.post(
  "/",
  ah(async (req, res) => {
    const b = req.body || {};
    if (!b.material_id || !b.metric || !b.expression) {
      return res.status(400).json({ ok: false, error: "material_id, metric, expression required" });
    }
    const { meta } = await exec(
      `INSERT INTO material_models
       (material_id, metric, expression, params_json, variables_json, version, is_active, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        Number(b.material_id),
        String(b.metric),
        String(b.expression),
        JSON.stringify(b.params_json || {}),
        JSON.stringify(b.variables_json || ["r", "p"]),
        b.version || "v1",
        b.is_active ? 1 : 0,
        b.notes || null,
      ]
    );
    res.json({ ok: true, data: { id: meta.insertId } });
  })
);

router.put(
  "/:id",
  ah(async (req, res) => {
    const id = Number(req.params.id);
    const b = req.body || {};
    await exec(
      `UPDATE material_models
       SET expression=?, params_json=?, variables_json=?, version=?, is_active=?, notes=?
       WHERE id=?`,
      [
        String(b.expression || ""),
        JSON.stringify(b.params_json || {}),
        JSON.stringify(b.variables_json || ["r", "p"]),
        b.version || "v1",
        b.is_active ? 1 : 0,
        b.notes || null,
        id,
      ]
    );
    res.json({ ok: true, data: { id } });
  })
);

router.put(
  "/:id/set-active",
  ah(async (req, res) => {
    const id = Number(req.params.id);
    const rows = await query(`SELECT material_id, metric FROM material_models WHERE id=?`, [id]);
    if (!rows.length) return res.status(404).json({ ok: false, error: "model not found" });
    const { material_id, metric } = rows[0];
    await exec(`UPDATE material_models SET is_active=0 WHERE material_id=? AND metric=?`, [material_id, metric]);
    await exec(`UPDATE material_models SET is_active=1 WHERE id=?`, [id]);
    res.json({ ok: true, data: { id } });
  })
);

router.post(
  "/test",
  ah(async (req, res) => {
    const b = req.body || {};
    const value = evalExpression(String(b.expression || "0"), {
      r: Number(b.r ?? 0),
      p: Number(b.p ?? 0.5),
      params: b.params_json || {},
    });
    res.json({ ok: true, data: { value } });
  })
);

export default router;
