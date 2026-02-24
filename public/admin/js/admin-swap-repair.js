import { apiGet, apiPost } from "/js/api.js";

const baseSampleEl = document.getElementById("baseSampleId");
const fromMainEl = document.getElementById("fromMainMaterialId");
const toMainEl = document.getElementById("toMainMaterialId");
const msgEl = document.getElementById("msg");
const compareEl = document.getElementById("compare");
const suggestionsEl = document.getElementById("suggestions");
const repairedEl = document.getElementById("repaired");

let materials = [];

async function loadOptions() {
  const [samples, mats] = await Promise.all([apiGet("/api/samples?page=1&pageSize=200"), apiGet("/api/materials")]);
  materials = mats;
  baseSampleEl.innerHTML = samples.map((s) => `<option value="${s.id}">${s.name}</option>`).join("");
  const matOptions = mats.map((m) => `<option value="${m.id}">${m.name}</option>`).join("");
  fromMainEl.innerHTML = matOptions;
  toMainEl.innerHTML = matOptions;
}

function materialNameById(id) {
  return materials.find((m) => Number(m.id) === Number(id))?.name || `#${id}`;
}

function renderResult(out) {
  compareEl.innerHTML = `
    <div class="small">替換前 XYZ：X=${out.before.xyz.x} / Y=${out.before.xyz.y} / Z=${out.before.xyz.z}</div>
    <div class="small">替換後 XYZ：X=${out.afterSwap.xyz.x} / Y=${out.afterSwap.xyz.y} / Z=${out.afterSwap.xyz.z}</div>
    <div class="small">下降/變化 ΔXYZ：X=${out.afterSwap.deltaXYZ.x} / Y=${out.afterSwap.deltaXYZ.y} / Z=${out.afterSwap.deltaXYZ.z}</div>
  `;

  suggestionsEl.innerHTML = (out.suggestions || [])
    .map(
      (s, i) => `<div class="small">
      ${i + 1}. 建議補強 ${s.material_name || materialNameById(s.material_id)}（+1% 預估 ΔX=${s.expectedDeltaXYZPer1Percent.x}、ΔY=${s.expectedDeltaXYZPer1Percent.y}、ΔZ=${s.expectedDeltaXYZPer1Percent.z}）
    </div>`
    )
    .join("");

  repairedEl.innerHTML = (out.repairedCandidates || [])
    .map(
      (c, i) => `<div class="card">
      <div><span class="badge">補救候選 #${i + 1}</span> distance=${c.distance}</div>
      <div class="small">XYZ：X=${c.xyz.x} / Y=${c.xyz.y} / Z=${c.xyz.z}</div>
      <div class="small">${c.bomItems.map((b) => `${b.material || materialNameById(b.material_id)} ${Number(b.ratioPercent).toFixed(2)}%`).join("，")}</div>
    </div>`
    )
    .join("");
}

document.getElementById("btnRun").onclick = async () => {
  msgEl.textContent = "分析中…";
  try {
    const out = await apiPost("/api/swap-repair", {
      baseSampleId: Number(baseSampleEl.value),
      fromMainMaterialId: Number(fromMainEl.value),
      toMainMaterialId: Number(toMainEl.value),
      targetXYZ: {
        x: Number(document.getElementById("tx").value || 0),
        y: Number(document.getElementById("ty").value || 0),
        z: Number(document.getElementById("tz").value || 0),
      },
      p: 0.5,
      topN: Number(document.getElementById("topN").value || 5),
    });
    msgEl.textContent = "完成";
    renderResult(out);
  } catch (e) {
    msgEl.textContent = `失敗：${e.message}`;
  }
};

loadOptions();
