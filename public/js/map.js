import { apiGet, apiPost } from "./api.js";

let points = [];
let selected = null;
let selectedBom = null;
let plotEl = null;
let lastCandidates = [];
let loadingTimer = null;
let loadingTick = 0;

const TARGET_TRACE_INDEX = 1;
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
      camera: INITIAL_CAMERA,
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

function renderPlot(inputPoints) {
  const trace = {
    type: "scatter3d",
    mode: "markers",
    x: inputPoints.map((p) => p.x),
    y: inputPoints.map((p) => p.y),
    z: inputPoints.map((p) => p.z),
    text: inputPoints.map((p) => p.name),
    hovertemplate: "<b>%{text}</b><br>X:%{x}<br>Y:%{y}<br>Z:%{z}<extra></extra>",
    marker: {
      size: 4,
      opacity: 0.9,
      color: "#111111",
      line: { color: "#000000", width: 1 },
    },
  };

  const targetTrace = {
    type: "scatter3d",
    mode: "markers+text",
    x: [],
    y: [],
    z: [],
    text: [],
    textposition: "top center",
    hovertemplate: "<b>%{text}</b><br>X:%{x}<br>Y:%{y}<br>Z:%{z}<extra></extra>",
    marker: { size: 8, opacity: 1, color: "#e10000", line: { color: "#8b0000", width: 1.5 }, symbol: "diamond" },
  };

  Plotly.newPlot("plot", [trace, targetTrace], buildLayout(), { responsive: true, doubleClick: false });
  plotEl = document.getElementById("plot");
  plotEl.on("plotly_click", async (data) => {
    const curve = data?.points?.[0]?.curveNumber;
    const idx = data?.points?.[0]?.pointNumber;
    if (curve !== 0 || idx == null) return;
    selected = points[idx];
    await renderSelectedSampleInfo(selected);
  });
}

function resetView() {
  if (!plotEl) return;
  Plotly.relayout(plotEl, { "scene.camera": INITIAL_CAMERA });
}

function showTargetPoint(target) {
  if (!plotEl) return;
  Plotly.restyle(
    plotEl,
    { x: [[target.x]], y: [[target.y]], z: [[target.z]], text: [[`Target (${target.x},${target.y},${target.z})`]] },
    [TARGET_TRACE_INDEX]
  );
}

function fillMaterialOptions(names) {
  const singleSel = document.getElementById("curveMaterial");
  const mixSel = document.getElementById("curveScanMaterial");
  const html = names.map((n) => `<option value="${n}">${n}</option>`).join("");
  singleSel.innerHTML = html;
  mixSel.innerHTML = html;
}

function renderSampleInfoHtml(sample, bomItems, message) {
  const bomTable = bomItems?.length
    ? `<table style="width:100%; border-collapse:collapse; margin-top:6px;">
         <thead>
           <tr>
             <th style="text-align:left; border-bottom:1px solid #2a2a2a; padding:4px;">材料</th>
             <th style="text-align:right; border-bottom:1px solid #2a2a2a; padding:4px;">比例(%)</th>
           </tr>
         </thead>
         <tbody>
           ${bomItems
             .map(
               (it) => `<tr>
                 <td style="padding:4px; border-bottom:1px solid #efefef;">${it.material}</td>
                 <td style="padding:4px; text-align:right; border-bottom:1px solid #efefef;">${it.ratioPercent}</td>
               </tr>`
             )
             .join("")}
         </tbody>
       </table>`
    : `<div class="small">${message || "此樣品尚未設定 BOM"}</div>`;

  return `
    <div><span class="badge">${sample.name}</span></div>
    <div>X 除臭：${sample.x}</div>
    <div>Y 吸水：${sample.y}</div>
    <div>Z 抗粉碎：${sample.z}（低=更碎）</div>
    <hr />
    ${bomTable}
  `;
}

async function renderSelectedSampleInfo(sample) {
  const infoEl = document.getElementById("sampleInfo");
  infoEl.innerHTML = `<div class="small">載入樣品資料中…</div>`;
  try {
    const out = await apiGet(`/api/samples/${sample.id}/active-bom`);
    selectedBom = out;
    infoEl.innerHTML = renderSampleInfoHtml(out.sample, out.bomItems, out.message);
    fillMaterialOptions((out.bomItems || []).map((x) => x.material));
    document.getElementById("curveStatus").textContent = out.bomItems?.length
      ? `已載入 ${out.sample.name} 的 BOM，請選擇模式並 Render`
      : "此樣品尚未設定 BOM";
  } catch (e) {
    infoEl.innerHTML = `<div class="small">樣品資料載入失敗：${e.message}</div>`;
  }
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
    const bomHtml = (c.bom || []).slice(0, 12).map((b) => `${b.material}: ${b.ratio}%`).join("<br>");
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
  if (!lastCandidates.length) return alert("目前沒有候選配方可匯出，請先產生候選配方。");
  const rows = [["idx", "mix", "expected_x", "expected_y", "expected_z", "bom", "reasons", "warnings"]];
  lastCandidates.forEach((c, idx) => {
    rows.push([
      String(idx + 1),
      (c.mix || []).map((m) => `${m.sample}*${(m.weight * 100).toFixed(2)}%`).join(" | "),
      String(c.expectedXYZ?.x ?? ""),
      String(c.expectedXYZ?.y ?? ""),
      String(c.expectedXYZ?.z ?? ""),
      (c.bom || []).map((b) => `${b.material}:${b.ratio}%`).join(" | "),
      (c.reasons || []).join(" / "),
      (c.warnings || []).join(" / "),
    ]);
  });
  const csv = rows.map((r) => r.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(",")).join("\n");
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
    const phase = ["正在分析目標點", "正在搜尋近鄰樣品", "正在呼叫 LLM 產生候選", "正在整理候選 BOM"][loadingTick % 4];
    statusEl.textContent = `${phase}${dots}`;
  }, 700);
}

function stopLoadingStatus() {
  clearInterval(loadingTimer);
  loadingTimer = null;
}

function toggleCurveModeRows() {
  const mode = document.getElementById("curveMode").value;
  document.getElementById("singleRow").style.display = mode === "single" ? "flex" : "none";
  document.getElementById("mixRow").style.display = mode === "mix" ? "flex" : "none";
}

async function renderCurve() {
  const status = document.getElementById("curveStatus");
  if (!selectedBom?.sample?.id) {
    status.textContent = "請先在 3D 圖點選一個樣品";
    return;
  }
  if (!selectedBom.bomItems?.length) {
    status.textContent = "此樣品尚未設定 BOM，無法繪製曲線";
    return;
  }

  const mode = document.getElementById("curveMode").value;
  const metric = document.getElementById("curveMetric").value;
  const p = Number(document.getElementById("curveP").value || 0.5);
  const rMax = Number(document.getElementById("curveRMax").value || 0.3);
  const steps = Number(document.getElementById("curveSteps").value || 31);
  const materialName = document.getElementById("curveMaterial").value;
  const scanMaterialName = document.getElementById("curveScanMaterial").value;

  status.textContent = "曲線計算中…";
  try {
    const out = await apiPost("/api/curves", {
      sampleId: selectedBom.sample.id,
      mode,
      metric,
      materialName,
      scanMaterialName,
      p,
      rMax,
      steps,
    });

    const traces = [
      {
        x: out.x || [],
        y: out.y || [],
        type: "scatter",
        mode: "lines",
        name: mode === "single" ? "single curve" : "mix curve",
        line: { color: "#1e5dff", width: 2 },
      },
    ];

    if (mode === "mix" && out.xyzSeries?.x?.length) {
      traces.push(
        { x: out.x, y: out.xyzSeries.x, type: "scatter", mode: "lines", name: "X", line: { dash: "dot" } },
        { x: out.x, y: out.xyzSeries.y, type: "scatter", mode: "lines", name: "Y", line: { dash: "dash" } },
        { x: out.x, y: out.xyzSeries.z, type: "scatter", mode: "lines", name: "Z", line: { dash: "solid" } }
      );
    }

    Plotly.newPlot(
      "curvePlot",
      traces,
      {
        margin: { l: 45, r: 10, t: 30, b: 40 },
        paper_bgcolor: "#ffffff",
        plot_bgcolor: "#ffffff",
        xaxis: { title: "ratio r" },
        yaxis: { title: "score (0~100)", range: [0, 100] },
        legend: { orientation: "h" },
      },
      { responsive: true }
    );

    status.textContent = out.message || "曲線繪製完成";
  } catch (e) {
    status.textContent = `曲線繪製失敗：${e.message}`;
  }
}

async function main() {
  points = await apiGet("/api/map/points");
  renderPlot(points);
  toggleCurveModeRows();

  document.getElementById("curveMode").addEventListener("change", toggleCurveModeRows);
  document.getElementById("curveP").addEventListener("input", (e) => {
    document.getElementById("curvePLabel").textContent = Number(e.target.value).toFixed(2);
  });
  document.getElementById("btnRenderCurve").addEventListener("click", renderCurve);
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
      const out = await apiPost("/api/recommendations", {
        target,
        k: Number(document.getElementById("k").value || 30),
        maxMix: Number(document.getElementById("maxMix").value || 3),
      });
      stopLoadingStatus();
      status.textContent = `完成：已產生 ${(out?.candidates || []).length} 組候選配方`;
      renderCandidates(out);
    } catch (e) {
      stopLoadingStatus();
      status.textContent = `失敗：${e.message}`;
    }
  });
}

main();
