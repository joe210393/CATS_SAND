import { apiGet, apiPost, apiPut } from "/js/api.js";

const mainMaterialEl = document.getElementById("mainMaterialId");
const resultsEl = document.getElementById("results");
const msgEl = document.getElementById("msg");
let materials = [];

async function loadMaterials() {
  materials = await apiGet("/api/materials");
  mainMaterialEl.innerHTML = materials.map((m) => `<option value="${m.id}">${m.name}</option>`).join("");
}

function materialNameById(id) {
  return materials.find((m) => Number(m.id) === Number(id))?.name || `#${id}`;
}

function parseIdList(text) {
  return String(text || "")
    .split(",")
    .map((x) => Number(x.trim()))
    .filter(Boolean);
}

async function saveAsDraft(candidate, idx) {
  const sampleName = `OPT_${Date.now()}_${idx + 1}`;
  const created = await apiPost("/api/samples", {
    name: sampleName,
    status: "draft",
    notes: `由 optimizer 產生，distance=${candidate.distance}`,
  });
  const sampleId = created.id;
  const bom = await apiPost("/api/boms", { sample_id: sampleId, version: "v2-opt" });
  const bomId = bom.id;
  await apiPut(`/api/boms/${bomId}/set-active`, {});
  await apiPut(`/api/boms/${bomId}/items`, {
    items: candidate.bomItems.map((it) => ({ material_id: it.material_id, ratio: it.ratioPercent, note: "optimizer" })),
  });
  return { sampleId, bomId, sampleName };
}

function renderCandidates(candidates) {
  if (!candidates.length) {
    resultsEl.innerHTML = `<div class="small">無候選結果</div>`;
    return;
  }
  resultsEl.innerHTML = candidates
    .map(
      (c, idx) => `
      <div class="card">
        <div><span class="badge">候選 #${idx + 1}</span> distance=${c.distance}</div>
        <div class="small">XYZ：X=${c.xyz.x} / Y=${c.xyz.y} / Z=${c.xyz.z}</div>
        <div class="small">BOM：${c.bomItems.map((b) => `${materialNameById(b.material_id)} ${Number(b.ratioPercent).toFixed(2)}%`).join("，")}</div>
        <button class="btn-save" data-idx="${idx}">存成新樣品草稿</button>
      </div>`
    )
    .join("");

  resultsEl.querySelectorAll(".btn-save").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const idx = Number(btn.dataset.idx);
      btn.disabled = true;
      btn.textContent = "存檔中…";
      try {
        const r = await saveAsDraft(candidates[idx], idx);
        btn.textContent = `已建立 ${r.sampleName}`;
      } catch (e) {
        btn.disabled = false;
        btn.textContent = "存成新樣品草稿";
        msgEl.textContent = `存檔失敗：${e.message}`;
      }
    });
  });
}

document.getElementById("btnRun").onclick = async () => {
  msgEl.textContent = "求解中…";
  try {
    const out = await apiPost("/api/optimize", {
      mainMaterialId: Number(mainMaterialEl.value),
      mainRatioRange: {
        min: Number(document.getElementById("mainMin").value || 50),
        max: Number(document.getElementById("mainMax").value || 80),
        step: Number(document.getElementById("mainStep").value || 5),
      },
      targetXYZ: {
        x: Number(document.getElementById("tx").value || 0),
        y: Number(document.getElementById("ty").value || 0),
        z: Number(document.getElementById("tz").value || 0),
      },
      constraints: {
        maxMaterials: Number(document.getElementById("maxMaterials").value || 6),
        excludeMaterialIds: parseIdList(document.getElementById("excludeIds").value),
      },
      p: Number(document.getElementById("p").value || 0.5),
      topN: Number(document.getElementById("topN").value || 10),
    });
    msgEl.textContent = `完成，共 ${out.candidates.length} 筆候選`;
    renderCandidates(out.candidates);
  } catch (e) {
    msgEl.textContent = `求解失敗：${e.message}`;
  }
};

loadMaterials();
