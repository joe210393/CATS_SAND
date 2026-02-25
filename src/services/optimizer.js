import { query } from "../db.js";
import { evaluateBomItems } from "./recipe_engine.js";

function randInt(min, max) {
  const lo = Math.ceil(min);
  const hi = Math.floor(max);
  return Math.floor(Math.random() * (hi - lo + 1)) + lo;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function distL2(xyz, target) {
  return Math.sqrt((xyz.x - target.x) ** 2 + (xyz.y - target.y) ** 2 + (xyz.z - target.z) ** 2);
}

function buildRandomSplit(total, count) {
  if (count <= 0) return [];
  const values = Array.from({ length: count }, () => Math.random() + 1e-6);
  const s = values.reduce((t, v) => t + v, 0);
  return values.map((v) => (v / s) * total);
}

function applyBounds(items, amountMap) {
  for (const it of items) {
    const ratio = amountMap.get(it.id) ?? 0;
    const min = Number(it.min_ratio ?? 0);
    const max = Number(it.max_ratio ?? 100);
    if (ratio < min - 1e-6 || ratio > max + 1e-6) return false;
  }
  return true;
}

async function loadCandidateMaterials(excludeIds = []) {
  const rows = await query(
    `SELECT m.id, m.name, m.function_tags, m.min_ratio, m.max_ratio,
            rc.role, rc.min_ratio AS rc_min_ratio, rc.max_ratio AS rc_max_ratio, rc.priority, rc.enabled
     FROM materials m
     LEFT JOIN recipe_constraints rc ON rc.material_id=m.id AND rc.enabled=1
     ORDER BY COALESCE(rc.priority, 0) DESC, m.id ASC`
  );
  const excluded = new Set((excludeIds || []).map((x) => Number(x)));
  return rows
    .map((r) => ({
      id: Number(r.id),
      name: r.name,
      min_ratio: r.rc_min_ratio != null ? Number(r.rc_min_ratio) : Number(r.min_ratio ?? 0),
      max_ratio: r.rc_max_ratio != null ? Number(r.rc_max_ratio) : Number(r.max_ratio ?? 100),
      role: r.role || "any",
      priority: Number(r.priority || 0),
    }))
    .filter((m) => !excluded.has(m.id));
}

export async function optimizeRecipe({
  mainMaterialId,
  mainRatioRange,
  targetXYZ,
  constraints = {},
  p = 0.5,
  topN = 10,
}) {
  const maxMaterials = Math.max(2, Number(constraints.maxMaterials || 6));
  const includeIds = (constraints.includeMaterialIds || []).map((x) => Number(x)).filter(Boolean);
  const excludeIds = (constraints.excludeMaterialIds || []).map((x) => Number(x)).filter(Boolean);

  const materials = await loadCandidateMaterials(excludeIds);
  const main = materials.find((m) => m.id === Number(mainMaterialId));
  if (!main) throw new Error("main material not found");

  const secondaryPool = materials.filter((m) => m.id !== Number(mainMaterialId));
  const candidates = [];
  const seen = new Set();
  const minMain = Number(mainRatioRange.min ?? 50);
  const maxMain = Number(mainRatioRange.max ?? 80);
  const step = Math.max(1, Number(mainRatioRange.step ?? 5));

  function candidateKey(bomItems) {
    return bomItems
      .map((b) => `${Number(b.material_id)}:${Number(b.ratioPercent).toFixed(2)}`)
      .sort()
      .join("|");
  }

  async function tryPushCandidate(mainRatio, picked, amountMap) {
    if (!applyBounds([main, ...picked], amountMap)) return;
    const bomItems = [{ material_id: main.id, ratioPercent: Number(mainRatio.toFixed(2)) }].concat(
      picked.map((m) => ({ material_id: m.id, ratioPercent: Number((amountMap.get(m.id) || 0).toFixed(2)) }))
    );
    const key = candidateKey(bomItems);
    if (seen.has(key)) return;
    seen.add(key);

    const out = await evaluateBomItems(bomItems, p);
    const distance = Number(distL2(out.xyz, targetXYZ).toFixed(4));
    candidates.push({
      bomItems,
      xyz: out.xyz,
      metrics: out.metrics,
      distance,
      notes: `主材比例 ${mainRatio.toFixed(1)}%，次材 ${picked.length} 種`,
    });
  }

  for (let mainRatio = minMain; mainRatio <= maxMain + 1e-6; mainRatio += step) {
    const tries = Math.max(180, Math.min(450, 120 + maxMaterials * 40));
    for (let t = 0; t < tries; t += 1) {
      const secCount = randInt(1, Math.max(1, maxMaterials - 1));
      const fixed = secondaryPool.filter((m) => includeIds.includes(m.id));
      const randomPool = shuffle(secondaryPool.filter((m) => !includeIds.includes(m.id)));
      const picked = [...fixed, ...randomPool.slice(0, Math.max(0, secCount - fixed.length))];
      if (!picked.length) continue;

      const remain = Math.max(0, 100 - mainRatio);
      const split = buildRandomSplit(remain, picked.length);
      const amountMap = new Map([[main.id, mainRatio]]);
      picked.forEach((m, idx) => amountMap.set(m.id, split[idx]));
      await tryPushCandidate(mainRatio, picked, amountMap);
    }
  }

  // Deterministic fallback: if random sampling misses all valid combos, force main+single-secondary scan.
  if (!candidates.length) {
    for (let mainRatio = minMain; mainRatio <= maxMain + 1e-6; mainRatio += step) {
      const remain = Math.max(0, 100 - mainRatio);
      if (remain <= 0) continue;
      for (const sec of secondaryPool) {
        const amountMap = new Map([
          [main.id, mainRatio],
          [sec.id, remain],
        ]);
        await tryPushCandidate(mainRatio, [sec], amountMap);
      }
    }
  }

  if (!candidates.length) {
    throw new Error(
      `無有效候選。請調整主材比例範圍（目前 ${minMain}-${maxMain}%），或到後台檢查材料 min/max 與 recipe_constraints 限制。`
    );
  }

  candidates.sort((a, b) => a.distance - b.distance);
  return candidates.slice(0, Math.max(1, Number(topN || 10)));
}
