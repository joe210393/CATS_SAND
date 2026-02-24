import { create, all } from "mathjs";

const math = create(all, {});

function clip(min, max, x) {
  const lo = Number(min);
  const hi = Number(max);
  const v = Number(x);
  return Math.max(lo, Math.min(hi, v));
}

function sigmoid(x) {
  const n = Number(x);
  return 1 / (1 + Math.exp(-n));
}

function step(x) {
  return Number(x) >= 0 ? 1 : 0;
}

function sat(x) {
  return clip(0, 1, Number(x));
}

function integral(exprStr, varName = "x", a = 0, b = 1, n = 60, outerScope = {}) {
  const expr = String(exprStr || "0");
  const key = String(varName || "x");
  const N = Math.max(2, Math.floor(Number(n) || 60));
  const aa = Number(a);
  const bb = Number(b);
  const f = math.compile(expr);
  const h = (bb - aa) / N;
  let sum = 0;
  for (let i = 0; i <= N; i += 1) {
    const x = aa + h * i;
    const scope = { ...outerScope, [key]: x, clip, sigmoid, step, sat };
    const y = Number(f.evaluate(scope)) || 0;
    sum += i === 0 || i === N ? y / 2 : y;
  }
  return sum * h;
}

function buildScope(r = 0, p = 0.5, params = {}) {
  const base = {
    r: Number(r),
    p: Number(p),
    clip,
    sigmoid,
    step,
    sat,
    exp: Math.exp,
    abs: Math.abs,
    pow: Math.pow,
    min: Math.min,
    max: Math.max,
  };
  const paramScope = params && typeof params === "object" ? params : {};
  return {
    ...base,
    ...paramScope,
    integral: (exprStr, varName, a, b, n) => integral(exprStr, varName, a, b, n, { ...base, ...paramScope }),
  };
}

export function evalExpression(expression, { r = 0, p = 0.5, params = {} } = {}) {
  const exprText = String(expression || "0");
  const compiled = math.compile(exprText);
  const value = Number(compiled.evaluate(buildScope(r, p, params))) || 0;
  return sat(value);
}

export const expressionFunctions = { clip, sigmoid, step, sat, integral };
