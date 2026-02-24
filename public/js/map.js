import { apiGet, apiPost } from "./api.js";

const BASE_TRACE_INDEX = 0;
const TARGET_TRACE_INDEX = 1;
const SELECTED_TRACE_INDEX = 2;

let points = [];
let selected = null;
let selectedBom = null;
let plotEl = null;
let lastCandidates = [];
let lastCurve = null;
let loadingTimer = null;
let loadingTick = 0;
let allMaterialNames = [];
let allMaterials = [];
let isMapPlotBusy = false;
let contribReqSeq = 0;

const INITIAL_CAMERA = {
  eye: { x: 1.6, y: 1.6, z: 1.2 },
  up: { x: 0, y: 0, z: 1 },
  center: { x: 0, y: 0, z: 0 },
};

const METRIC_LABEL = {
  deodor_rate: "除臭率",
  absorption: "吸水性",
  coagulation: "凝結性",
  clump_quality: "結團性質",
  dust_score: "低粉塵分數",
  clump_strength: "結團強度",
  dissolve_score: "溶解/崩解性",
  granule_strength: "顆粒強度",
  z_crush: "抗粉碎/完整度",
};

function buildMapLayout() {
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
    uirevision: "map-stable",
    margin: { l: 0, r: 0, t: 0, b: 0 },
  };
}

function renderMap(inputPoints) {
  if (isMapPlotBusy) return;
  isMapPlotBusy = true;
  Plotly.purge("plot");
  const base = {
    type: "scatter3d",
    mode: "markers",
    x: inputPoints.map((p) => p.x),
    y: inputPoints.map((p) => p.y),
    z: inputPoints.map((p) => p.z),
    text: inputPoints.map((p) => p.name),
    hovertemplate: "<b>%{text}</b><br>X:%{x}<br>Y:%{y}<br>Z:%{z}<extra></extra>",
    marker: { size: 4, opacity: 0.9, color: "#111111", line: { color: "#000000", width: 1 } },
  };
  const target = {
    type: "scatter3d",
    mode: "markers+text",
    x: [],
    y: [],
    z: [],
    text: [],
    textposition: "top center",
    marker: { size: 8, color: "#e10000", line: { color: "#8b0000", width: 1.5 }, symbol: "diamond" },
  };
  const selectedTrace = {
    type: "scatter3d",
    mode: "markers+text",
    x: [],
    y: [],
    z: [],
    text: [],
    textposition: "top center",
    marker: { size: 8, color: "#1e5dff", line: { color: "#0b2c96", width: 1.5 } },
  };

  Plotly.newPlot("plot", [base, target, selectedTrace], buildMapLayout(), { responsive: true, doubleClick: false })
    .catch((e) => console.warn("plot render failed:", e?.message || e))
    .finally(() => {
      isMapPlotBusy = false;
    });
  plotEl = document.getElementById("plot");

  plotEl.on("plotly_click", async (data) => {
    if (isMapPlotBusy) return;
    const idx = data?.points?.[0]?.pointNumber;
    const curve = data?.points?.[0]?.curveNumber;
    if (curve !== BASE_TRACE_INDEX || idx == null) return;
    selected = points[idx];
    Plotly.restyle(
      plotEl,
      {
        x: [[selected.x]],
        y: [[selected.y]],
        z: [[selected.z]],
        text: [[`Selected: ${selected.name}`]],
      },
      [SELECTED_TRACE_INDEX]
    );
    await renderSelectedSampleInfo(selected);
  });
}

function resetView() {
  if (!plotEl) return;
  Plotly.relayout(plotEl, { "scene.camera": INITIAL_CAMERA });
}

function showTargetPoint(target) {
  if (!plotEl || isMapPlotBusy) return;
  Plotly.restyle(
    plotEl,
    {
      x: [[target.x]],
      y: [[target.y]],
      z: [[target.z]],
      text: [[`Target (${target.x}, ${target.y}, ${target.z})`]],
    },
    [TARGET_TRACE_INDEX]
  );
}

function fillMaterialOptions(names) {
  const merged = [...new Set([...(names || []), ...allMaterialNames].filter(Boolean))];
  const html = merged.map((n) => `<option value="${n}">${n}</option>`).join("");
  const singleSel = document.getElementById("curveMaterial");
  const scanSel = document.getElementById("curveScanMaterial");
  const prevSingle = singleSel.value;
  const prevScan = scanSel.value;
  singleSel.innerHTML = html;
  scanSel.innerHTML = html;
  if (merged.includes(prevSingle)) singleSel.value = prevSingle;
  if (merged.includes(prevScan)) scanSel.value = prevScan;
}

function fillV2MapSelectors() {
  const materialOptions = allMaterials.map((m) => `<option value="${m.id}">${m.name}</option>`).join("");
  const sampleOptions = points.map((p) => `<option value="${p.id}">${p.name}</option>`).join("");
  const mainSel = document.getElementById("mapMainMaterial");
  const fromSel = document.getElementById("mapSwapFrom");
  const toSel = document.getElementById("mapSwapTo");
  const sampleSel = document.getElementById("mapBaseSample");
  const oldMain = mainSel.value;
  const oldFrom = fromSel.value;
  const oldTo = toSel.value;
  const oldSample = sampleSel.value;
  mainSel.innerHTML = materialOptions;
  fromSel.innerHTML = materialOptions;
  toSel.innerHTML = materialOptions;
  sampleSel.innerHTML = sampleOptions;
  if ([...mainSel.options].some((o) => o.value === oldMain)) mainSel.value = oldMain;
  if ([...fromSel.options].some((o) => o.value === oldFrom)) fromSel.value = oldFrom;
  if ([...toSel.options].some((o) => o.value === oldTo)) toSel.value = oldTo;
  if ([...sampleSel.options].some((o) => o.value === oldSample)) sampleSel.value = oldSample;
}

function sampleInfoHtml(sample, bomItems, message, metrics = null, xyz = null) {
  if (!bomItems?.length) {
    return `
      <div><span class="badge">${sample.name}</span></div>
      <div>X 除臭：${xyz?.x ?? sample.x ?? "-"}</div>
      <div>Y 吸水：${xyz?.y ?? sample.y ?? "-"}</div>
      <div>Z 抗粉碎：${xyz?.z ?? sample.z ?? "-"}（高=不碎）</div>
      <hr />
      <div class="small">${message || "此樣品尚未設定 BOM"}</div>`;
  }

  const metricsHtml = metrics
    ? `<hr />
       <div class="small">8 指標（系統計算）</div>
       ${Object.entries(METRIC_LABEL)
         .map(([k, zh]) => `<div class="small">${zh}：${metrics[k] ?? "-"}（↑越好）</div>`)
         .join("")}`
    : "";

  return `
    <div><span class="badge">${sample.name}</span></div>
    <div>X 除臭：${xyz?.x ?? sample.x ?? "-"}</div>
    <div>Y 吸水：${xyz?.y ?? sample.y ?? "-"}</div>
    <div>Z 抗粉碎：${xyz?.z ?? sample.z ?? "-"}（高=不碎）</div>
    <hr />
    <table style="width:100%; border-collapse:collapse;">
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
    </table>
    ${metricsHtml}`;
}

async function renderSelectedSampleInfo(sample) {
  const infoEl = document.getElementById("sampleInfo");
  infoEl.innerHTML = `<div class="small">載入樣品資料中…</div>`;
  try {
    const out = await apiGet(`/api/samples/${sample.id}/active-bom-with-scores`);
    selectedBom = out;
    infoEl.innerHTML = sampleInfoHtml(out.sample, out.bomItems, out.message, out.metrics, out.xyz);
    fillMaterialOptions((out.bomItems || []).map((x) => x.material));
    if (out.xyz) {
      document.getElementById("tx").value = Number(out.xyz.x || 0).toFixed(2);
      document.getElementById("ty").value = Number(out.xyz.y || 0).toFixed(2);
      document.getElementById("tz").value = Number(out.xyz.z || 0).toFixed(2);
      showTargetPoint(out.xyz);
    }
    const baseSampleSel = document.getElementById("mapBaseSample");
    if (baseSampleSel) baseSampleSel.value = String(sample.id);
    if (out.bomItems?.length) {
      const idByName = new Map(allMaterials.map((m) => [m.name, String(m.id)]));
      const firstMatId = idByName.get(out.bomItems[0].material);
      if (firstMatId) {
        document.getElementById("mapMainMaterial").value = firstMatId;
        document.getElementById("mapSwapFrom").value = firstMatId;
      }
    }
    document.getElementById("curveStatus").textContent = out.bomItems?.length
      ? `已載入 ${out.sample.name} 的 BOM。baseline r0 會顯示在曲線圖上。`
      : "此樣品尚未設定 BOM";
  } catch (e) {
    selectedBom = null;
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
  if (!lastCandidates.length) {
    alert("目前沒有候選配方可匯出，請先產生候選配方。");
    return;
  }
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
  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
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

function activeScanRule() {
  return document.querySelector("input[name='scanRule']:checked")?.value || "A";
}

function toggleCurveModeRows() {
  const mode = document.getElementById("curveMode").value;
  document.getElementById("singleRow").style.display = mode === "single" ? "flex" : "none";
  document.getElementById("mixRow").style.display = mode === "mix" ? "flex" : "none";
}

function updateContribSlider(rMax, steps, r0) {
  const slider = document.getElementById("contribR");
  const step = Math.max(0.001, rMax / Math.max(steps - 1, 1));
  slider.min = "0";
  slider.max = String(rMax);
  slider.step = String(Number(step.toFixed(4)));
  slider.value = String(Math.max(0, Math.min(rMax, r0 ?? 0)));
  document.getElementById("contribRLabel").textContent = `r=${Number(slider.value).toFixed(4)}`;
}

async function renderContributions(rValue) {
  const seq = ++contribReqSeq;
  const metric = document.getElementById("curveMetric").value;
  const p = Number(document.getElementById("curveP").value || 0.5);
  const scanMaterialName = document.getElementById("curveScanMaterial").value;
  const rule = activeScanRule();
  if (!selectedBom?.sample?.id) return;

  try {
    const out = await apiPost("/api/contributions", {
      sampleId: selectedBom.sample.id,
      metric,
      scanMaterialName,
      p,
      rValue,
      rule,
    });
    const parts = out.parts || [];
    const topN = 8;
    const top = parts.slice(0, topN);
    const others = parts.slice(topN).reduce((t, x) => t + x.value, 0);
    const labels = top.map((x) => x.material);
    const values = top.map((x) => x.value);
    if (others > 0) {
      labels.push("Others");
      values.push(Number(others.toFixed(2)));
    }

    if (seq !== contribReqSeq) return;
    Plotly.react(
      "contribPlot",
      [{ type: "bar", x: labels, y: values, marker: { color: "#3f6df6" } }],
      {
        margin: { l: 40, r: 10, t: 30, b: 70 },
        paper_bgcolor: "#ffffff",
        plot_bgcolor: "#ffffff",
        xaxis: { tickangle: -25 },
        yaxis: { title: "contribution" },
        title: `材料貢獻拆解（${METRIC_LABEL[metric] || metric}）`,
      },
      { responsive: true }
    );
  } catch (e) {
    document.getElementById("curveStatus").textContent = `貢獻拆解失敗：${e.message}`;
  }
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
  const materialName = document.getElementById("curveMaterial").value;
  const scanMaterialName = document.getElementById("curveScanMaterial").value;
  const p = Number(document.getElementById("curveP").value || 0.5);
  const rMax = Number(document.getElementById("curveRMax").value || 0.3);
  const steps = Number(document.getElementById("curveSteps").value || 31);
  const rule = activeScanRule();
  const showDelta = document.getElementById("chkDelta").checked;
  const showXYZ = document.getElementById("chkXYZ").checked;

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
      rule,
    });
    lastCurve = out;

    if (!out.x?.length) {
      status.textContent = out.message || "無可用曲線資料";
      Plotly.react(
        "curvePlot",
        [],
        { paper_bgcolor: "#ffffff", plot_bgcolor: "#ffffff", xaxis: { title: "ratio r" }, yaxis: { title: "score" } },
        { responsive: true }
      );
      return;
    }

    const yMain = mode === "mix" && showDelta ? out.yDelta || out.y : out.y;
    const traces = [
      {
        x: out.x,
        y: yMain,
        type: "scatter",
        mode: "lines",
        name: mode === "mix" ? (showDelta ? "Δy 曲線" : "混合曲線 y") : "單材曲線 y",
        line: { color: "#1e5dff", width: 2 },
      },
    ];

    if (mode === "mix" && showXYZ && out.xyzSeries?.x?.length) {
      traces.push(
        { x: out.x, y: out.xyzSeries.x, type: "scatter", mode: "lines", name: "X 除臭", line: { dash: "dot" } },
        { x: out.x, y: out.xyzSeries.y, type: "scatter", mode: "lines", name: "Y 吸水", line: { dash: "dash" } },
        { x: out.x, y: out.xyzSeries.z, type: "scatter", mode: "lines", name: "Z 抗粉碎", line: { dash: "solid" } }
      );
    }

    const shapes = [];
    const annotations = [];
    if (mode === "mix" && Number.isFinite(out.r0)) {
      shapes.push({
        type: "line",
        x0: out.r0,
        x1: out.r0,
        y0: 0,
        y1: 1,
        xref: "x",
        yref: "paper",
        line: { color: "#ff7a00", width: 1.5, dash: "dash" },
      });
      annotations.push({
        x: out.r0,
        y: 1,
        xref: "x",
        yref: "paper",
        yanchor: "bottom",
        text: `baseline r0=${(out.r0 * 100).toFixed(2)}%`,
        showarrow: false,
        font: { size: 11, color: "#ff7a00" },
      });
    }

    Plotly.react(
      "curvePlot",
      traces,
      {
        margin: { l: 45, r: 10, t: 40, b: 45 },
        paper_bgcolor: "#ffffff",
        plot_bgcolor: "#ffffff",
        xaxis: { title: "ratio r" },
        yaxis: { title: showDelta ? "Δscore" : "score (0~100)" },
        legend: { orientation: "h" },
        shapes,
        annotations,
      },
      { responsive: true }
    );

    if (mode === "mix") {
      updateContribSlider(rMax, steps, out.r0 ?? 0);
      await renderContributions(Number(document.getElementById("contribR").value));
      status.textContent = `曲線完成（規則 ${rule}）`;
    } else {
      status.textContent = "單一材料曲線完成";
      Plotly.react(
        "contribPlot",
        [],
        { paper_bgcolor: "#ffffff", plot_bgcolor: "#ffffff", xaxis: { title: "" }, yaxis: { title: "" } },
        { responsive: true }
      );
    }
  } catch (e) {
    status.textContent = `曲線繪製失敗：${e.message}`;
  }
}

function renderMapOptimizeResults(candidates = []) {
  const el = document.getElementById("mapOptimizeResults");
  if (!candidates.length) {
    el.innerHTML = `<div class="small">無候選結果</div>`;
    return;
  }
  const idToName = new Map(allMaterials.map((m) => [Number(m.id), m.name]));
  el.innerHTML = candidates
    .slice(0, 10)
    .map((c, idx) => {
      const bom = (c.bomItems || [])
        .map((b) => `${idToName.get(Number(b.material_id)) || `#${b.material_id}`} ${Number(b.ratioPercent).toFixed(2)}%`)
        .join("，");
      return `<div class="small">#${idx + 1} dist=${c.distance} ｜ XYZ(${c.xyz?.x}, ${c.xyz?.y}, ${c.xyz?.z})<br/>${bom}</div><hr/>`;
    })
    .join("");
}

function renderMapSwapResults(out) {
  const resultEl = document.getElementById("mapSwapResults");
  if (!out) {
    resultEl.innerHTML = `<div class="small">無結果</div>`;
    return;
  }
  const suggest = (out.suggestions || [])
    .map(
      (s, idx) =>
        `<div class="small">${idx + 1}. ${s.material_name || s.material_id}：ΔX ${s.expectedDeltaXYZPer1Percent?.x}, ΔY ${s.expectedDeltaXYZPer1Percent?.y}, ΔZ ${s.expectedDeltaXYZPer1Percent?.z}</div>`
    )
    .join("");
  const repaired = (out.repairedCandidates || [])
    .map((c, idx) => `<div class="small">補救 #${idx + 1} dist=${c.distance} XYZ(${c.xyz?.x}, ${c.xyz?.y}, ${c.xyz?.z})</div>`)
    .join("");
  resultEl.innerHTML = `
    <div class="small">替換前 XYZ：${out.before?.xyz?.x}/${out.before?.xyz?.y}/${out.before?.xyz?.z}</div>
    <div class="small">替換後 XYZ：${out.afterSwap?.xyz?.x}/${out.afterSwap?.xyz?.y}/${out.afterSwap?.xyz?.z}</div>
    <div class="small">下降量 ΔXYZ：${out.afterSwap?.deltaXYZ?.x}/${out.afterSwap?.deltaXYZ?.y}/${out.afterSwap?.deltaXYZ?.z}</div>
    <hr />
    <div class="small">補強建議</div>
    ${suggest || '<div class="small">無</div>'}
    <hr />
    <div class="small">補救候選</div>
    ${repaired || '<div class="small">無</div>'}
  `;
}

async function refreshMapData() {
  points = await apiGet("/api/map/points");
  renderMap(points);
  fillV2MapSelectors();
}

async function renderSampleRatioSurface() {
  const status = document.getElementById("sampleSurfaceStatus");
  if (!selectedBom?.sample?.id) {
    status.textContent = "請先點選一個樣品";
    return;
  }
  status.textContent = "生成中…";
  try {
    const out = await apiPost(`/api/samples/${selectedBom.sample.id}/ratio-surface`, {
      points: Number(document.getElementById("surfacePoints").value || 180),
      strength: Number(document.getElementById("surfaceStrength").value || 0.35),
      p: Number(document.getElementById("surfaceP").value || 0.5),
    });
    const pts = out.points || [];
    if (!pts.length) {
      status.textContent = out.message || "無資料";
      return;
    }
    const xs = pts.map((p) => p.xyz.x);
    const ys = pts.map((p) => p.xyz.y);
    const zs = pts.map((p) => p.xyz.z);
    const base = out.base?.xyz || pts[0].xyz;
    const traces = [
      {
        type: "mesh3d",
        x: xs,
        y: ys,
        z: zs,
        opacity: 0.15,
        color: "#6f9fff",
        alphahull: 8,
        name: "比例掃描包絡",
      },
      {
        type: "scatter3d",
        mode: "markers",
        x: xs,
        y: ys,
        z: zs,
        marker: { size: 3, color: "#222" },
        name: "不同配比點",
      },
      {
        type: "scatter3d",
        mode: "markers+text",
        x: [base.x],
        y: [base.y],
        z: [base.z],
        text: ["基準配比"],
        marker: { size: 7, color: "#d30000", symbol: "diamond" },
        name: "基準樣品",
      },
    ];
    Plotly.react(
      "sampleSurfacePlot",
      traces,
      {
        margin: { l: 0, r: 0, t: 24, b: 0 },
        scene: {
          xaxis: { title: "X 除臭" },
          yaxis: { title: "Y 吸水" },
          zaxis: { title: "Z 抗粉碎" },
        },
        paper_bgcolor: "#ffffff",
        plot_bgcolor: "#ffffff",
      },
      { responsive: true }
    );
    status.textContent = `完成：共 ${pts.length} 個配比點`;
  } catch (e) {
    status.textContent = `失敗：${e.message}`;
  }
}

async function main() {
  try {
    const mats = await apiGet("/api/materials?page=1&pageSize=500");
    allMaterials = Array.isArray(mats) ? mats : [];
    allMaterialNames = allMaterials.map((m) => m.name).filter(Boolean);
  } catch (_e) {
    allMaterials = [];
    allMaterialNames = [];
  }
  fillMaterialOptions([]);
  await refreshMapData();
  toggleCurveModeRows();

  document.getElementById("btnResetView").addEventListener("click", resetView);
  document.getElementById("btnExportCandidates").addEventListener("click", exportCandidatesCsv);
  document.getElementById("curveMode").addEventListener("change", toggleCurveModeRows);
  document.getElementById("curveP").addEventListener("input", (e) => {
    document.getElementById("curvePLabel").textContent = Number(e.target.value).toFixed(2);
  });
  document.getElementById("btnRenderCurve").addEventListener("click", renderCurve);
  document.getElementById("contribR").addEventListener("input", async (e) => {
    const rValue = Number(e.target.value || 0);
    document.getElementById("contribRLabel").textContent = `r=${rValue.toFixed(4)}`;
    if (document.getElementById("curveMode").value === "mix" && selectedBom?.sample?.id) {
      await renderContributions(rValue);
    }
  });

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

  document.getElementById("btnRecomputeAll").addEventListener("click", async () => {
    const status = document.getElementById("recomputeStatus");
    status.textContent = "重算中…";
    try {
      const out = await apiPost("/api/samples/recompute-scores", { p: 0.5 });
      status.textContent = `重算完成：${out.updated}/${out.total}`;
      await refreshMapData();
      if (selected?.id) {
        const latest = points.find((p) => Number(p.id) === Number(selected.id));
        if (latest) await renderSelectedSampleInfo(latest);
      }
    } catch (e) {
      status.textContent = `重算失敗：${e.message}`;
    }
  });

  document.getElementById("btnMapOptimize").addEventListener("click", async () => {
    const status = document.getElementById("mapOptimizeStatus");
    status.textContent = "主次求解中…";
    try {
      const out = await apiPost("/api/optimize", {
        mainMaterialId: Number(document.getElementById("mapMainMaterial").value),
        mainRatioRange: {
          min: Number(document.getElementById("mapMainMin").value || 50),
          max: Number(document.getElementById("mapMainMax").value || 80),
          step: Number(document.getElementById("mapMainStep").value || 5),
        },
        targetXYZ: {
          x: Number(document.getElementById("tx").value || 0),
          y: Number(document.getElementById("ty").value || 0),
          z: Number(document.getElementById("tz").value || 0),
        },
        constraints: {
          maxMaterials: Number(document.getElementById("mapMaxMaterials").value || 6),
        },
        p: Number(document.getElementById("mapP").value || 0.5),
        topN: Number(document.getElementById("mapTopN").value || 5),
      });
      status.textContent = `完成：${(out.candidates || []).length} 筆`;
      renderMapOptimizeResults(out.candidates || []);
    } catch (e) {
      status.textContent = `失敗：${e.message}`;
    }
  });

  document.getElementById("btnMapSwapRepair").addEventListener("click", async () => {
    const status = document.getElementById("mapSwapStatus");
    status.textContent = "換主材補救分析中…";
    try {
      const out = await apiPost("/api/swap-repair", {
        baseSampleId: Number(document.getElementById("mapBaseSample").value),
        fromMainMaterialId: Number(document.getElementById("mapSwapFrom").value),
        toMainMaterialId: Number(document.getElementById("mapSwapTo").value),
        targetXYZ: {
          x: Number(document.getElementById("tx").value || 0),
          y: Number(document.getElementById("ty").value || 0),
          z: Number(document.getElementById("tz").value || 0),
        },
        p: Number(document.getElementById("mapSwapP").value || 0.5),
        topN: Number(document.getElementById("mapSwapTopN").value || 3),
      });
      status.textContent = "完成";
      renderMapSwapResults(out);
    } catch (e) {
      status.textContent = `失敗：${e.message}`;
    }
  });
  document.getElementById("btnRenderSampleSurface").addEventListener("click", renderSampleRatioSurface);
}

main();
