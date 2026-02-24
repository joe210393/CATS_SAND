import { apiGet, apiPost, apiPut } from "/js/api.js";

const metricOptions = [
  ["deodor_rate", "除臭率"],
  ["absorption", "吸水性"],
  ["coagulation", "凝結性"],
  ["clump_quality", "結團性質"],
  ["clump_strength", "結團強度"],
  ["dissolve_score", "溶解/崩解性"],
  ["dust_score", "低粉塵分數"],
  ["granule_strength", "顆粒強度"],
  ["z_crush", "抗粉碎/完整度"],
];

const materialEl = document.getElementById("materialId");
const metricEl = document.getElementById("metric");
const expressionEl = document.getElementById("expression");
const paramsEl = document.getElementById("params");
const versionsEl = document.getElementById("versions");
const msgEl = document.getElementById("msg");

let currentRows = [];
let selectedId = null;

metricEl.innerHTML = metricOptions.map(([k, z]) => `<option value="${k}">${z} (${k})</option>`).join("");

function selectedMetric() {
  return metricEl.value;
}

function selectedMaterialId() {
  return Number(materialEl.value || 0);
}

function selectedPayload() {
  return {
    material_id: selectedMaterialId(),
    metric: selectedMetric(),
    expression: expressionEl.value.trim(),
    params_json: JSON.parse(paramsEl.value || "{}"),
    variables_json: ["r", "p"],
    version: document.getElementById("version").value || "v2",
    is_active: 0,
  };
}

async function loadMaterials() {
  const mats = await apiGet("/api/materials");
  materialEl.innerHTML = mats.map((m) => `<option value="${m.id}">${m.name}</option>`).join("");
}

async function loadModels() {
  const materialId = selectedMaterialId();
  const metric = selectedMetric();
  const rows = await apiGet(`/api/models?materialId=${materialId}&metric=${metric}`);
  currentRows = rows;
  selectedId = rows.find((r) => r.is_active)?.id || rows[0]?.id || null;
  if (rows.length) {
    const active = rows.find((r) => r.id === selectedId) || rows[0];
    expressionEl.value = active.expression;
    paramsEl.value = JSON.stringify(active.params_json || {}, null, 2);
  } else {
    expressionEl.value = "sat(A*(1-exp(-k*r))*(1-b*r))";
    paramsEl.value = JSON.stringify({ A: 0.7, k: 4, b: 0.25 }, null, 2);
  }
  versionsEl.innerHTML = rows
    .map(
      (r) =>
        `<div class="small">
          <label>
            <input type="radio" name="ver" value="${r.id}" ${r.id === selectedId ? "checked" : ""}/>
            #${r.id} ${r.version} ${r.is_active ? "[啟用中]" : ""}
          </label>
        </div>`
    )
    .join("");
  versionsEl.querySelectorAll("input[name='ver']").forEach((el) => {
    el.addEventListener("change", () => {
      selectedId = Number(el.value);
      const row = currentRows.find((r) => r.id === selectedId);
      if (!row) return;
      expressionEl.value = row.expression;
      paramsEl.value = JSON.stringify(row.params_json || {}, null, 2);
    });
  });
}

document.getElementById("btnTest").onclick = async () => {
  try {
    const out = await apiPost("/api/models/test", {
      expression: expressionEl.value,
      params_json: JSON.parse(paramsEl.value || "{}"),
      r: Number(document.getElementById("testR").value || 0),
      p: Number(document.getElementById("testP").value || 0.5),
    });
    msgEl.textContent = `測試結果：${Number(out.value).toFixed(4)}（0..1）`;
  } catch (e) {
    msgEl.textContent = `測試失敗：${e.message}`;
  }
};

document.getElementById("btnSurface").onclick = async () => {
  try {
    const rows = 26;
    const cols = 26;
    const xs = Array.from({ length: cols }, (_, i) => i / (cols - 1));
    const ys = Array.from({ length: rows }, (_, i) => i / (rows - 1));
    const z = [];
    const expression = expressionEl.value;
    const params = JSON.parse(paramsEl.value || "{}");
    for (let yi = 0; yi < ys.length; yi += 1) {
      const line = [];
      for (let xi = 0; xi < xs.length; xi += 1) {
        const out = await apiPost("/api/models/test", { expression, params_json: params, r: xs[xi], p: ys[yi] });
        line.push(out.value);
      }
      z.push(line);
    }
    Plotly.newPlot(
      "surfacePlot",
      [{ type: "surface", x: xs, y: ys, z }],
      { title: "公式 3D 曲面預覽（x=r, y=p, z=score）", margin: { l: 0, r: 0, t: 40, b: 0 } },
      { responsive: true }
    );
  } catch (e) {
    msgEl.textContent = `曲面預覽失敗：${e.message}`;
  }
};

document.getElementById("btnSave").onclick = async () => {
  try {
    const payload = selectedPayload();
    const out = await apiPost("/api/models", payload);
    msgEl.textContent = `已儲存新版本，ID=${out.id}`;
    await loadModels();
  } catch (e) {
    msgEl.textContent = `儲存失敗：${e.message}`;
  }
};

document.getElementById("btnSetActive").onclick = async () => {
  try {
    if (!selectedId) throw new Error("請先選擇版本");
    await apiPut(`/api/models/${selectedId}/set-active`, {});
    msgEl.textContent = `已設為啟用版本 #${selectedId}`;
    await loadModels();
  } catch (e) {
    msgEl.textContent = `設定失敗：${e.message}`;
  }
};

materialEl.addEventListener("change", loadModels);
metricEl.addEventListener("change", loadModels);

async function main() {
  await loadMaterials();
  await loadModels();
}

main();
