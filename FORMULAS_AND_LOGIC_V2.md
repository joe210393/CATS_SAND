# V2 公式、算法、邏輯總表

## 1) 公式引擎
- 運算器：`mathjs`（不使用 `eval`）。
- 變數：`r`（材料比例 0..1）、`p`（製程參數 0..1）。
- 參數：`params_json` 的 key 會注入計算範圍（例如 `A`, `k`, `b`）。
- 自訂函數：
  - `clip(min,max,x)`
  - `sigmoid(x)`
  - `step(x)`
  - `sat(x) = clip(0,1,x)`
  - `integral(expr, var, a, b, n)`（梯形法）

## 2) 預設單材公式
- 模板：`sat(A*(1-exp(-k*r))*(1-b*r))`
- 依 `function_tags` 產生 `A/k/b` 偏置：
  - 含「除臭/吸附」：`deodor_rate` 偏高
  - 含「吸水」：`absorption` 偏高
  - 含「凝結/結團」：`coagulation`, `clump_strength` 偏高
  - 含「強度/結構」：`z_crush`, `granule_strength` 偏高
  - 含「抑塵/低粉塵」：`dust_score` 偏高

## 3) 混合合成規則（0..1）
- `deodor_rate`: `D = 1 - Π(1 - c_m)`
- `absorption`: `A = sat(Σ c_m)`
- `coagulation`: `C = sigmoid(α(Σ c_m - τ))`，`α=8`, `τ=0.5`
- `clump_strength`: `S = C * sigmoid(β(Σ c_m - τs))`，`β=8`, `τs=0.5`
- `dust_score`: `DustScore = 1 - (1 - Π(1 - c_m))`
- `granule_strength`: `G = sat(Σ c_m)`
- `clump_quality`: `Q = sat(1 - (|A-0.7|+|C-0.7|+|S-0.7|)/3)`
- `dissolve_score`: `U = sigmoid(γ(Σ c_m - τu))`，`γ=8`, `τu=0.5`
- `z_crush`: `z_crush = sat((sum_z_crush + zInt)/2)`，`zInt = sat(0.7*G + 0.3*dust_score)`

## 4) XYZ 映射（0..100）
- `X = 100 * deodor_rate`
- `Y = 100 * absorption`
- `Z = 100 * zInt`，`zInt = sat(0.7*granule_strength + 0.3*dust_score)`

## 5) BOM 自動回寫邏輯
- 觸發點：
  - `PUT /api/boms/:bomId/items`
  - `PUT /api/boms/:bomId/set-active`
- 流程：
  1. 讀取 active BOM items
  2. 呼叫 `evaluateBomItems()`
  3. 更新 `samples.x_deodor / y_absorb / z_crush` 快取

## 6) 主次配方求解（/api/optimize）
- 固定主材比例掃描：`min..max`，每次 `step`
- 次材隨機分配剩餘比例（符合材料上下限）
- 每組配方 evaluate 得到 `xyz`
- 距離函數：`L2 = sqrt((x-x*)^2 + (y-y*)^2 + (z-z*)^2)`
- 取距離最小 `topN`

## 7) 換主材補救（/api/swap-repair）
- 先計算替換前後 `XYZ` 與 `deltaXYZ`
- 缺口：`gap = target - afterSwap`
- 對候選材料做 `+1%` 邊際測試（其他材料等比例縮小）
- 建議排序分數：
  - `score = gapX*ΔX + gapY*ΔY + gapZ*ΔZ`
- 取 Top5 建議後做局部搜尋，產出 `repairedCandidates`
