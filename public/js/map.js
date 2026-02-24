import { apiGet, apiPost } from "./api.js";

let points = [];
let selected = null;
let plotEl = null;
let selectedPointIndex = null;
let targetPoint = null;
let lastCandidates = [];
let loadingTimer = null;
let loadingTick = 0;

const INITIAL_CAMERA = {
  eye: { x: 1.6, y: 1.6, z: 1.2 },
  up: { x: 0, y: 0, z: 1 },
  center: { x: 0, y: 0, z: 0 },
};

function buildLayout() {
  return {
    paper_bgcolor: "#ffffff",
    plot_bgcolor: "#ffffff",
    scene: {
      dragmode: "turntable",
      camera: JSON.parse(JSON.stringify(INITIAL_CAMERA)),
      xaxis: {
        title: { text: "X 除臭", font: { color: "#cc0000" } },
        tickfont: { color: "#cc0000" },
        linecolor: "#cc0000",
        zerolinecolor: "#000000",
        gridcolor: "#000000",
        showline: true,
        showbackground: true,
        backgroundcolor: "#ffffff",
      },
      yaxis: {
        title: { text: "Y 吸水", font: { color: "#cc0000" } },
        tickfont: { color: "#cc0000" },
        linecolor: "#cc0000",
        zerolinecolor: "#000000",
        gridcolor: "#000000",
        showline: true,
        showbackground: true,
        backgroundcolor: "#ffffff",
      },
      zaxis: {
        title: { text: "Z z_crush（高=不碎）", font: { color: "#cc0000" } },
        tickfont: { color: "#cc0000" },
        linecolor: "#cc0000",
        zerolinecolor: "#000000",
        gridcolor: "#000000",
        showline: true,
        showbackground: true,
        backgroundcolor: "#ffffff",
      },
    },
    uirevision: "stable-camera",
    margin: { l: 0, r: 0, t: 0, b: 0 },
  };
}

function buildTraces() {
  const base = {
    type: "scatter3d",
    mode: "markers",
    x: points.map((p) => p.x),
    y: points.map((p) => p.y),
    z: points.map((p) => p.z),
    text: points.map((p) => p.name),
    hovertemplate: "<b>%{text}</b><br>X:%{x}<br>Y:%{y}<br>Z:%{z}<extra></extra>",
    marker: {
      size: 4,
      opacity: 0.9,
      color: "#111111",
      line: { color: "#000000", width: 1 },
    },
  };

  const traces = [base];

  if (targetPoint) {
    traces.push({
      type: "scatter3d",
      mode: "markers+text",
      x: [targetPoint.x],
      y: [targetPoint.y],
      z: [targetPoint.z],
      text: [`Target (${targetPoint.x}, ${targetPoint.y}, ${targetPoint.z})`],
      textposition: "top center",
      hovertemplate: "<b>%{text}</b><br>X:%{x}<br>Y:%{y}<br>Z:%{z}<extra></extra>",
      marker: {
        size: 8,
        opacity: 1,
        color: "#e10000",
        line: { color: "#8b0000", width: 1.5 },
        symbol: "diamond",
      },
    });
  }

  if (selectedPointIndex != null && points[selectedPointIndex]) {
    const p = points[selectedPointIndex];
    traces.push({
      type: "scatter3d",
      mode: "markers+text",
      x: [p.x],
      y: [p.y],
      z: [p.z],
      text: [`Selected: ${p.name}`],
      textposition: "top center",
      hovertemplate: "<b>%{text}</b><br>X:%{x}<br>Y:%{y}<br>Z:%{z}<extra></extra>",
      marker: {
        size: 7,
        opacity: 1,
        color: "#1e5dff",
        line: { color: "#0b2c96", width: 1.5 },
        symbol: "circle",
      },
    });
  }

  return traces;
}

function renderPlot() {
  const layout = buildLayout();
  const config = { responsive: true, doubleClick: false };

  if (!plotEl) {
    Plotly.newPlot("plot", buildTraces(), layout, config);
    plotEl = document.getElementById("plot");
    plotEl.on("plotly_click", (data) => {
      const idx = data?.points?.[0]?.pointNumber;
      const curve = data?.points?.[0]?.curveNumber;
      if (curve !== 0 || idx == null) return;
      selectedPointIndex = idx;
      selected = points[idx];
      Plotly.react(plotEl, buildTraces(), buildLayout(), config);
      renderSelectedSampleInfo(selected).catch((e) => {
        document.getElementById("sampleInfo").innerHTML = `
          <div><span class="badge">${selected.name}</span></div>
          <div>X 除臭：${selected.x}</div>
          <div>Y 吸水：${selected.y}</div>
          <div>Z 抗粉碎：${selected.z}（低=更碎）</div>
          <div class="small">BOM 載入失敗：${e.message}</div>`;
      });
    });
  } else {
    Plotly.react(plotEl, buildTraces(), buildLayout(), config);
  }
}

async function renderSelectedSampleInfo(sample) {
  const boms = await apiGet(`/api/boms/by-sample/${sample.id}`);
  const activeBom = (boms || []).find((b) => Number(b.is_active) === 1) || boms?.[0];
  let bomHtml = `<div class="small">此樣品尚無 BOM</div>`;
  if (activeBom?.id) {
    const items = await apiGet(`/api/boms/${activeBom.id}/items`);
    bomHtml = items?.length
      ? `<div class="small">BOM ${activeBom.version}${Number(activeBom.is_active) === 1 ? " (active)" : ""}</div>
         <table style="width:100%; border-collapse:collapse; margin-top:6px;">
           <thead>
             <tr>
               <th style="text-align:left; border-bottom:1px solid #2a2a2a; padding:4px;">材料</th>
               <th style="text-align:right; border-bottom:1px solid #2a2a2a; padding:4px;">比例(%)</th>
             </tr>
           </thead>
           <tbody>
             ${items
               .map(
                 (it) => `<tr>
                   <td style="padding:4px; border-bottom:1px solid #efefef;">${it.material}</td>
                   <td style="padding:4px; text-align:right; border-bottom:1px solid #efefef;">${it.ratio}</td>
                 </tr>`
               )
               .join("")}
           </tbody>
         </table>`
      : `<div class="small">BOM ${activeBom.version} 尚無材料項目</div>`;
  }

  document.getElementById("sampleInfo").innerHTML = `
    <div><span class="badge">${sample.name}</span></div>
    <div>X 除臭：${sample.x}</div>
    <div>Y 吸水：${sample.y}</div>
    <div>Z 抗粉碎：${sample.z}（低=更碎）</div>
    <hr />
    ${bomHtml}
  `;
}

function showTargetPoint(target) {
  targetPoint = target;
  renderPlot();
}

function resetView() {
  if (!plotEl) return;
  Plotly.relayout(plotEl, { "scene.camera": JSON.parse(JSON.stringify(INITIAL_CAMERA)) });
}

function clearCandidates() {
  const el = document.getElementById("candidates");
  el.innerHTML = `<div class="small">（等待新候選配方）</div>`;
  lastCandidates = [];
}

function renderCandidates(out) {
  const el = document.getElementById("candidates");
  el.innerHTML = "";
  const { candidates = [] } = out;
  lastCandidates = candidates;

  for (const c of candidates) {
    const mixHtml = (c.mix || []).map((m) => `${m.sample} × ${(m.weight * 100).toFixed(0)}%`).join("<br>");
    const bomHtml = (c.bom || [])
      .slice(0, 12)
      .map((b) => `${b.material}: ${b.ratio}%`)
      .join("<br>");

    const reasons = (c.reasons || []).map((x) => `<li>${x}</li>`).join("");
    const warnings = (c.warnings || []).map((x) => `<li>${x}</li>`).join("");

    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div class="small">混合樣品</div>
      <div>${mixHtml || "-"}</div>
      <hr />
      <div class="small">系統加權平均預期 XYZ</div>
      <div>X:${c.expectedXYZ?.x}　Y:${c.expectedXYZ?.y}　Z:${c.expectedXYZ?.z}</div>
      <hr />
      <div class="small">合成 BOM（前 12 項）</div>
      <div class="small">${bomHtml || "-"}</div>
      <hr />
      <div class="small">理由</div>
      <ul class="small">${reasons || "<li>-</li>"}</ul>
      <div class="small">風險/提醒</div>
      <ul class="small">${warnings || "<li>-</li>"}</ul>
    `;
    el.appendChild(card);
  }
}

function exportCandidatesCsv() {
  if (!lastCandidates.length) {
    alert("目前沒有候選配方可匯出，請先產生候選配方。");
    return;
  }
  const rows = [["idx", "mix", "expected_x", "expected_y", "expected_z", "bom", "reasons", "warnings"]];
  lastCandidates.forEach((c, idx) => {
    const mix = (c.mix || []).map((m) => `${m.sample}*${(m.weight * 100).toFixed(2)}%`).join(" | ");
    const bom = (c.bom || []).map((b) => `${b.material}:${b.ratio}%`).join(" | ");
    const reasons = (c.reasons || []).join(" / ");
    const warnings = (c.warnings || []).join(" / ");
    rows.push([
      String(idx + 1),
      mix,
      String(c.expectedXYZ?.x ?? ""),
      String(c.expectedXYZ?.y ?? ""),
      String(c.expectedXYZ?.z ?? ""),
      bom,
      reasons,
      warnings,
    ]);
  });

  const csv = rows
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n");

  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `candidates_${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function startLoadingStatus(statusEl) {
  clearInterval(loadingTimer);
  loadingTick = 0;
  statusEl.textContent = "開始產生新配方…";
  loadingTimer = setInterval(() => {
    loadingTick += 1;
    const dots = ".".repeat((loadingTick % 3) + 1);
    const step = loadingTick % 4;
    const text =
      step === 0
        ? `正在分析目標點${dots}`
        : step === 1
          ? `正在搜尋近鄰樣品${dots}`
          : step === 2
            ? `正在呼叫 LLM 產生候選${dots}`
            : `正在整理候選 BOM${dots}`;
    statusEl.textContent = text;
  }, 700);
}

function stopLoadingStatus() {
  clearInterval(loadingTimer);
  loadingTimer = null;
}

async function main() {
  points = await apiGet("/api/map/points");
  renderPlot();
  document.getElementById("btnResetView").addEventListener("click", resetView);
  document.getElementById("btnExportCandidates").addEventListener("click", exportCandidatesCsv);

  document.getElementById("btnReco").addEventListener("click", async () => {
    const status = document.getElementById("recoStatus");
    clearCandidates();
    startLoadingStatus(status);
    try {
      const target = {
        x: Number(document.getElementById("tx").value),
        y: Number(document.getElementById("ty").value),
        z: Number(document.getElementById("tz").value),
      };
      showTargetPoint(target);
      const k = Number(document.getElementById("k").value || 30);
      const maxMix = Number(document.getElementById("maxMix").value || 3);

      const out = await apiPost("/api/recommendations", { target, k, maxMix });
      stopLoadingStatus();
      status.textContent = `完成：已產生 ${(out?.candidates || []).length} 組候選配方`;
      renderCandidates(out);
    } catch (e) {
      stopLoadingStatus();
      status.textContent = "失敗：" + e.message;
    }
  });
}

main();
