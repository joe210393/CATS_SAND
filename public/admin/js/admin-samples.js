import { apiGet, apiPost } from "/js/api.js";

const listEl = document.getElementById("list");
const searchEl = document.getElementById("search");
const batchMsgEl = document.getElementById("batchMsg");
const selectedIds = new Set();

document.getElementById("btnNew").onclick = () => {
  window.location.href = "/admin/sample-edit.html";
};

async function load() {
  const q = searchEl.value.trim();
  const data = await apiGet(`/api/samples?search=${encodeURIComponent(q)}&page=1&pageSize=100`);
  listEl.innerHTML = data
    .map(
      (s) => `
    <div class="card">
      <div class="row" style="align-items:center;">
        <div style="flex:0 0 28px;">
          <input type="checkbox" class="sample-check" data-id="${s.id}" ${selectedIds.has(s.id) ? "checked" : ""} />
        </div>
        <div><span class="badge">${s.name}</span> <span class="small">(${s.status})</span></div>
      </div>
      <div class="small">X:${s.x_deodor}　Y:${s.y_absorb}　Z:${s.z_crush}</div>
      <div class="row">
        <button onclick="location.href='/admin/sample-edit.html?id=${s.id}'">編輯</button>
        <button onclick="location.href='/admin/bom-edit.html?sampleId=${s.id}'">BOM</button>
      </div>
    </div>
  `
    )
    .join("");

  listEl.querySelectorAll(".sample-check").forEach((el) => {
    el.addEventListener("change", (e) => {
      const id = Number(e.target.dataset.id);
      if (!id) return;
      if (e.target.checked) selectedIds.add(id);
      else selectedIds.delete(id);
      batchMsgEl.textContent = `已勾選 ${selectedIds.size} 筆`;
    });
  });
}

document.getElementById("btnDeleteSelected").onclick = async () => {
  if (!selectedIds.size) {
    batchMsgEl.textContent = "請先勾選要刪除的樣品";
    return;
  }
  if (!confirm(`確定刪除 ${selectedIds.size} 筆樣品？此動作不可還原。`)) return;

  batchMsgEl.textContent = "刪除中…";
  try {
    await apiPost("/api/samples/batch-delete", { ids: [...selectedIds] });
    selectedIds.clear();
    batchMsgEl.textContent = "刪除完成";
    await load();
  } catch (e) {
    batchMsgEl.textContent = `刪除失敗：${e.message}`;
  }
};

searchEl.addEventListener("input", () => load());
load();
