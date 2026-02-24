function hash01(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

function clampScore(v) {
  return Math.max(0, Math.min(100, Number(v)));
}

function gaussian(x, mu, sigma) {
  const z = (x - mu) / sigma;
  return Math.exp(-(z * z) / 2);
}

function tagBias(metric, tags) {
  const set = new Set((tags || []).map((x) => String(x)));
  let bias = 0;
  if (metric === "deodor_rate" && (set.has("除臭") || set.has("吸附"))) bias += 12;
  if (metric === "absorption" && set.has("吸水")) bias += 12;
  if (metric === "dust_score" && (set.has("抑塵") || set.has("結構"))) bias += 8;
  if (metric === "clump_strength" && (set.has("結團") || set.has("成型"))) bias += 12;
  if (metric === "z_crush" && (set.has("結構") || set.has("輕量"))) bias += 10;
  return bias;
}

function materialMetricValue(material, metric, p, r) {
  const key = `${material.name}|${metric}`;
  const h1 = hash01(key);
  const h2 = hash01(`${key}|g2`);
  const h3 = hash01(`${key}|p`);

  const base = 6 + 14 * h1 + tagBias(metric, material.function_tags);
  const linear = (25 + 25 * h2) * r;
  const quad = -(18 + 24 * h3) * r * r;
  const peak1 = (8 + 12 * h2) * gaussian(r, 0.12 + 0.25 * h1, 0.05 + 0.04 * h2);
  const peak2 = (4 + 8 * h3) * gaussian(r, 0.35 + 0.2 * h2, 0.08 + 0.05 * h1);
  const pEffect = (h1 - 0.5) * 8 * (p - 0.5) + (h3 - 0.5) * 6 * (p - 0.5) * (p - 0.5);

  return clampScore(base + linear + quad + peak1 + peak2 + pEffect);
}

function buildAxis(rMax, steps) {
  const safeSteps = Math.max(2, Number(steps || 31));
  const safeRMax = Math.max(0.01, Number(rMax || 0.3));
  const x = [];
  for (let i = 0; i < safeSteps; i += 1) {
    x.push(Number(((safeRMax * i) / (safeSteps - 1)).toFixed(4)));
  }
  return { x, safeSteps, safeRMax };
}

function recipeWithScan(recipe, scanMaterialName, scanR) {
  const out = recipe.map((x) => ({ ...x }));
  const idx = out.findIndex((x) => x.material === scanMaterialName);
  if (idx >= 0) out[idx].ratio = scanR;
  else out.push({ material: scanMaterialName, ratio: scanR });
  return out;
}

export function applyScanRule(recipe, scanMaterialName, scanR, rule = "A") {
  const raw = recipeWithScan(recipe, scanMaterialName, scanR);
  const others = raw.filter((x) => x.material !== scanMaterialName);
  const result = raw.map((x) => ({ ...x }));
  const safeRule = String(rule || "A").toUpperCase();

  if (safeRule === "A") {
    const remaining = Math.max(0, 1 - scanR);
    const sumOthers = others.reduce((t, x) => t + x.ratio, 0);
    for (const it of result) {
      if (it.material === scanMaterialName) {
        it.ratio = scanR;
      } else if (sumOthers > 0) {
        it.ratio = (it.ratio / sumOthers) * remaining;
      } else {
        it.ratio = 0;
      }
    }
  } else {
    const sum = result.reduce((t, x) => t + x.ratio, 0) || 1;
    for (const it of result) it.ratio = it.ratio / sum;
  }

  return result;
}

function evalRecipeMetric(materialMap, recipe, metric, p) {
  let total = 0;
  for (const it of recipe) {
    const mat = materialMap.get(it.material);
    if (!mat) continue;
    total += materialMetricValue(mat, metric, p, it.ratio);
  }
  return clampScore(total);
}

function evalRecipeXYZ(materialMap, recipe, p) {
  return {
    x: evalRecipeMetric(materialMap, recipe, "deodor_rate", p),
    y: evalRecipeMetric(materialMap, recipe, "absorption", p),
    z: evalRecipeMetric(materialMap, recipe, "z_crush", p),
  };
}

function detectR0(recipe, scanMaterialName) {
  const item = recipe.find((x) => x.material === scanMaterialName);
  return item ? Number(item.ratio) : 0;
}

export function evaluateSingleMaterialCurve(materialMeta, metric, p = 0.5, rMax = 0.3, steps = 31) {
  const { x } = buildAxis(rMax, steps);
  const y = x.map((r) => Number(materialMetricValue(materialMeta, metric, p, r).toFixed(2)));
  return { x, y };
}

export function evaluateContributions(materialMap, recipe, metric, scanMaterialName, p = 0.5, rValue = 0, rule = "A") {
  const normalized = applyScanRule(recipe, scanMaterialName, Number(rValue), rule);
  const parts = normalized
    .map((it) => {
      const mat = materialMap.get(it.material);
      if (!mat) return null;
      const value = Number(materialMetricValue(mat, metric, p, it.ratio).toFixed(2));
      return { material: it.material, value };
    })
    .filter(Boolean)
    .sort((a, b) => b.value - a.value);

  return { rValue: Number(rValue), parts };
}

export function evaluateMixedCurve(materialMap, recipe, metric, scanMaterialName, p = 0.5, rMax = 0.3, steps = 31, rule = "A") {
  const { x } = buildAxis(rMax, steps);
  const y = [];
  const xSeries = [];
  const ySeries = [];
  const zSeries = [];
  const r0 = detectR0(recipe, scanMaterialName);

  for (const scanR of x) {
    const normalized = applyScanRule(recipe, scanMaterialName, scanR, rule);
    y.push(Number(evalRecipeMetric(materialMap, normalized, metric, p).toFixed(2)));
    const xyz = evalRecipeXYZ(materialMap, normalized, p);
    xSeries.push(Number(xyz.x.toFixed(2)));
    ySeries.push(Number(xyz.y.toFixed(2)));
    zSeries.push(Number(xyz.z.toFixed(2)));
  }

  const nearestIdx = x.reduce((best, cur, idx) => (Math.abs(cur - r0) < Math.abs(x[best] - r0) ? idx : best), 0);
  const baseY = y[nearestIdx] ?? 0;
  const yDelta = y.map((v) => Number((v - baseY).toFixed(2)));

  return {
    x,
    y,
    yDelta,
    r0: Number(r0.toFixed(4)),
    xyzSeries: { x: xSeries, y: ySeries, z: zSeries },
  };
}
