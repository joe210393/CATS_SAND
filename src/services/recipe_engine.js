import { exec, query } from "../db.js";
import { safeJsonParse } from "../utils/validate.js";
import { evalExpression } from "./expression_engine.js";

export const METRICS = [
  "deodor_rate",
  "absorption",
  "clump_strength",
  "dust_score",
  "z_crush",
  "coagulation",
  "clump_quality",
  "dissolve_score",
  "granule_strength",
];

const DEFAULT_EXPR = "sat(A*(1-exp(-k*r))*(1-b*r))";

function sat(v) {
  return Math.max(0, Math.min(1, Number(v) || 0));
}

function sigmoid(v) {
  const x = Number(v) || 0;
  return 1 / (1 + Math.exp(-x));
}

function hasTag(tags, keywordList) {
  const s = new Set((tags || []).map((t) => String(t)));
  return keywordList.some((k) => s.has(k));
}

function makeParamsByTags(metric, tags) {
  let A = 0.45;
  let k = 3.2;
  let b = 0.25;

  if (metric === "deodor_rate" && hasTag(tags, ["除臭", "吸附"])) {
    A = 0.9;
    k = 7.5;
    b = 0.2;
  } else if (metric === "absorption" && hasTag(tags, ["吸水"])) {
    A = 0.9;
    k = 7.2;
    b = 0.2;
  } else if (["coagulation", "clump_strength"].includes(metric) && hasTag(tags, ["凝結", "結團"])) {
    A = 0.85;
    k = 6.5;
    b = 0.22;
  } else if (["z_crush", "granule_strength"].includes(metric) && hasTag(tags, ["強度", "結構"])) {
    A = 0.88;
    k = 5.8;
    b = 0.2;
  } else if (metric === "dust_score" && hasTag(tags, ["抑塵", "低粉塵"])) {
    A = 0.86;
    k = 6.2;
    b = 0.18;
  } else {
    A = 0.5;
    k = 3.5;
    b = 0.3;
  }

  return { A, k, b };
}

export async function ensureDefaultModels(materialId, functionTags = []) {
  for (const metric of METRICS) {
    const rows = await query(
      `SELECT id FROM material_models
       WHERE material_id=? AND metric=? AND is_active=1
       LIMIT 1`,
      [materialId, metric]
    );
    if (rows.length) continue;

    await exec(
      `INSERT INTO material_models
       (material_id, metric, expression, params_json, variables_json, version, is_active, notes)
       VALUES (?, ?, ?, ?, ?, 'v1', 1, ?)`,
      [
        materialId,
        metric,
        DEFAULT_EXPR,
        JSON.stringify(makeParamsByTags(metric, functionTags)),
        JSON.stringify(["r", "p"]),
        "auto-generated default model",
      ]
    );
  }
}

export async function loadActiveModel(materialId, metric) {
  const rows = await query(
    `SELECT id, expression, params_json, variables_json
     FROM material_models
     WHERE material_id=? AND metric=? AND is_active=1
     ORDER BY updated_at DESC
     LIMIT 1`,
    [materialId, metric]
  );
  return rows[0] || null;
}

function normalizeBomItems(bomItems = []) {
  const items = (bomItems || [])
    .map((it) => ({
      material_id: Number(it.material_id),
      ratioPercent: Number(it.ratioPercent ?? it.ratio ?? 0),
    }))
    .filter((it) => it.material_id && Number.isFinite(it.ratioPercent) && it.ratioPercent > 0);
  const sum = items.reduce((t, it) => t + it.ratioPercent, 0) || 1;
  return items.map((it) => ({ ...it, r: it.ratioPercent / sum }));
}

function combineMetrics(contribByMetric) {
  const alpha = 8;
  const beta = 8;
  const gamma = 8;
  const tau = 0.5;
  const tauS = 0.5;
  const tauU = 0.5;

  const sumFor = (metric) => (contribByMetric[metric] || []).reduce((t, v) => t + v, 0);
  const productOneMinus = (metric) => (contribByMetric[metric] || []).reduce((t, v) => t * (1 - sat(v)), 1);

  const D = sat(1 - productOneMinus("deodor_rate"));
  const A = sat(sumFor("absorption"));
  const C = sat(sigmoid(alpha * (sumFor("coagulation") - tau)));
  const S = sat(C * sigmoid(beta * (sumFor("clump_strength") - tauS)));
  const dustRisk = sat(1 - productOneMinus("dust_score"));
  const dustScore = sat(1 - dustRisk);
  const G = sat(sumFor("granule_strength"));
  const Q = sat(1 - (Math.abs(A - 0.7) + Math.abs(C - 0.7) + Math.abs(S - 0.7)) / 3);
  const U = sat(sigmoid(gamma * (sumFor("dissolve_score") - tauU)));
  const zInt = sat(0.7 * G + 0.3 * dustScore);
  const zCrush = sat((sumFor("z_crush") + zInt) / 2);

  return {
    deodor_rate: D,
    absorption: A,
    coagulation: C,
    clump_strength: S,
    dust_score: dustScore,
    granule_strength: G,
    clump_quality: Q,
    dissolve_score: U,
    z_crush: zCrush,
  };
}

function metrics01To100(metrics) {
  const out = {};
  for (const [k, v] of Object.entries(metrics)) out[k] = Number((sat(v) * 100).toFixed(2));
  return out;
}

function mapToXYZ(metrics01) {
  const D = sat(metrics01.deodor_rate);
  const A = sat(metrics01.absorption);
  const G = sat(metrics01.granule_strength);
  const dustScore = sat(metrics01.dust_score);
  const zInt = sat(0.7 * G + 0.3 * dustScore);
  return {
    x: Number((D * 100).toFixed(2)),
    y: Number((A * 100).toFixed(2)),
    z: Number((zInt * 100).toFixed(2)),
  };
}

export async function evaluateBomItems(bomItems = [], p = 0.5) {
  const normalized = normalizeBomItems(bomItems);
  if (!normalized.length) {
    const zero = Object.fromEntries(METRICS.map((m) => [m, 0]));
    return { metrics: zero, xyz: { x: 0, y: 0, z: 0 } };
  }

  const ids = [...new Set(normalized.map((x) => x.material_id))];
  const placeholders = ids.map(() => "?").join(",");
  const mats = await query(`SELECT id, function_tags FROM materials WHERE id IN (${placeholders})`, ids);
  const tagMap = new Map(mats.map((m) => [m.id, safeJsonParse(m.function_tags, []) || []]));

  for (const id of ids) {
    await ensureDefaultModels(id, tagMap.get(id) || []);
  }

  const contribByMetric = Object.fromEntries(METRICS.map((m) => [m, []]));
  for (const item of normalized) {
    for (const metric of METRICS) {
      const model = await loadActiveModel(item.material_id, metric);
      const value = model
        ? evalExpression(model.expression, { r: item.r, p: Number(p), params: safeJsonParse(model.params_json, {}) || {} })
        : 0;
      contribByMetric[metric].push(value);
    }
  }

  const metrics01 = combineMetrics(contribByMetric);
  return { metrics: metrics01To100(metrics01), xyz: mapToXYZ(metrics01) };
}

export async function getActiveBomItemsBySampleId(sampleId) {
  const bomRows = await query(
    `SELECT id FROM boms WHERE sample_id=? AND is_active=1 ORDER BY created_at DESC LIMIT 1`,
    [sampleId]
  );
  if (!bomRows.length) return [];
  const items = await query(
    `SELECT bi.material_id, m.name AS material, bi.ratio AS ratioPercent
     FROM bom_items bi
     JOIN materials m ON m.id=bi.material_id
     WHERE bi.bom_id=?
     ORDER BY bi.ratio DESC`,
    [bomRows[0].id]
  );
  return items.map((it) => ({
    material_id: Number(it.material_id),
    material: it.material,
    ratioPercent: Number(it.ratioPercent),
  }));
}

export async function refreshSampleXYZCache(sampleId, p = 0.5) {
  const bomItems = await getActiveBomItemsBySampleId(sampleId);
  const out = await evaluateBomItems(bomItems, p);
  await exec(
    `UPDATE samples
     SET x_deodor=?, y_absorb=?, z_crush=?, notes=CONCAT(COALESCE(notes, ''), ?)
     WHERE id=?`,
    [out.xyz.x, out.xyz.y, out.xyz.z, `\n[V2 compute] ${new Date().toISOString()}`, sampleId]
  );
  return out;
}
