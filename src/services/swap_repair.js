import { query } from "../db.js";
import { evaluateBomItems } from "./recipe_engine.js";

function normalizeTo100(items) {
  const sum = items.reduce((t, it) => t + Number(it.ratioPercent || 0), 0) || 1;
  return items.map((it) => ({ ...it, ratioPercent: (Number(it.ratioPercent || 0) / sum) * 100 }));
}

function l2Gap(gap) {
  return Math.sqrt(gap.x ** 2 + gap.y ** 2 + gap.z ** 2);
}

function asKey(id) {
  return Number(id);
}

function cloneBom(bom) {
  return bom.map((it) => ({ material_id: Number(it.material_id), ratioPercent: Number(it.ratioPercent) }));
}

async function loadTagsByIds(ids) {
  const placeholders = ids.map(() => "?").join(",");
  const rows = await query(`SELECT id, name FROM materials WHERE id IN (${placeholders})`, ids);
  return rows.map((r) => ({ id: Number(r.id), name: r.name }));
}

export async function runSwapRepair({
  baseBOM,
  fromMainMaterialId,
  toMainMaterialId,
  targetXYZ,
  p = 0.5,
  topN = 5,
}) {
  const base = normalizeTo100(cloneBom(baseBOM));
  const before = await evaluateBomItems(base, p);

  const fromId = asKey(fromMainMaterialId);
  const toId = asKey(toMainMaterialId);
  const fromItem = base.find((it) => it.material_id === fromId);
  if (!fromItem) throw new Error("fromMainMaterialId not in base BOM");

  const afterSwapBom = base
    .filter((it) => it.material_id !== fromId && it.material_id !== toId)
    .concat([{ material_id: toId, ratioPercent: fromItem.ratioPercent }]);
  const afterSwap = await evaluateBomItems(normalizeTo100(afterSwapBom), p);

  const deltaXYZ = {
    x: Number((afterSwap.xyz.x - before.xyz.x).toFixed(2)),
    y: Number((afterSwap.xyz.y - before.xyz.y).toFixed(2)),
    z: Number((afterSwap.xyz.z - before.xyz.z).toFixed(2)),
  };
  const gap = {
    x: Number(targetXYZ.x) - Number(afterSwap.xyz.x),
    y: Number(targetXYZ.y) - Number(afterSwap.xyz.y),
    z: Number(targetXYZ.z) - Number(afterSwap.xyz.z),
  };

  const existingIds = afterSwapBom.map((x) => x.material_id);
  const candidates = await query(`SELECT id FROM materials WHERE id NOT IN (${existingIds.map(() => "?").join(",")})`, existingIds);

  const suggestions = [];
  for (const row of candidates.slice(0, 20)) {
    const matId = Number(row.id);
    const trial = normalizeTo100(
      afterSwapBom.map((it) => ({ ...it, ratioPercent: it.ratioPercent * 0.99 })).concat([{ material_id: matId, ratioPercent: 1 }])
    );
    const trialEval = await evaluateBomItems(trial, p);
    const d = {
      x: trialEval.xyz.x - afterSwap.xyz.x,
      y: trialEval.xyz.y - afterSwap.xyz.y,
      z: trialEval.xyz.z - afterSwap.xyz.z,
    };
    const score = gap.x * d.x + gap.y * d.y + gap.z * d.z;
    suggestions.push({
      action: "increase",
      material_id: matId,
      reason: "依據缺口方向計算 +1% 邊際改善",
      expectedDeltaXYZPer1Percent: {
        x: Number(d.x.toFixed(2)),
        y: Number(d.y.toFixed(2)),
        z: Number(d.z.toFixed(2)),
      },
      score: Number(score.toFixed(4)),
    });
  }
  suggestions.sort((a, b) => b.score - a.score);
  const topSuggestions = suggestions.slice(0, 5);

  const repairedCandidates = [];
  for (const sug of topSuggestions) {
    for (let add = 1; add <= 8; add += 1) {
      const trial = normalizeTo100(
        afterSwapBom.map((it) => ({ ...it, ratioPercent: it.ratioPercent * ((100 - add) / 100) })).concat([
          { material_id: sug.material_id, ratioPercent: add },
        ])
      );
      const trialEval = await evaluateBomItems(trial, p);
      const distance = Number(
        l2Gap({
          x: targetXYZ.x - trialEval.xyz.x,
          y: targetXYZ.y - trialEval.xyz.y,
          z: targetXYZ.z - trialEval.xyz.z,
        }).toFixed(4)
      );
      repairedCandidates.push({
        bomItems: trial,
        xyz: trialEval.xyz,
        metrics: trialEval.metrics,
        distance,
        notes: `補強材料 ${sug.material_id} +${add}%`,
      });
    }
  }

  repairedCandidates.sort((a, b) => a.distance - b.distance);
  const materialNames = await loadTagsByIds(
    [...new Set(topSuggestions.map((s) => s.material_id).concat(repairedCandidates.flatMap((c) => c.bomItems.map((b) => b.material_id))))]
      .filter(Boolean)
  );
  const nameMap = new Map(materialNames.map((m) => [m.id, m.name]));
  topSuggestions.forEach((s) => {
    s.material_name = nameMap.get(s.material_id) || String(s.material_id);
  });
  repairedCandidates.forEach((c) => {
    c.bomItems = c.bomItems.map((b) => ({ ...b, material: nameMap.get(b.material_id) || String(b.material_id) }));
  });

  return {
    before,
    afterSwap: { ...afterSwap, deltaXYZ },
    suggestions: topSuggestions,
    repairedCandidates: repairedCandidates.slice(0, Math.max(1, Number(topN || 5))),
  };
}
