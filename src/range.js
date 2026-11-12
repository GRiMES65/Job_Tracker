// Range helpers for Base $, OTE $ and Size.
// Accepts things like: "80k-95k", "80-95k", "$80,000 – $95,000", "85000", "5000+", "up to 120k", "1.2m".

function parseNum(s) {
  s = String(s).toLowerCase().replace(/[$,\s]/g, "");
  if (!s) return null;
  let mult = 1;
  if (s.endsWith("k")) { mult = 1e3; s = s.slice(0, -1); }
  else if (s.endsWith("m")) { mult = 1e6; s = s.slice(0, -1); }
  if (!/^\d+(\.\d+)?$/.test(s)) return NaN;
  return Math.round(parseFloat(s) * mult);
}

/** Returns {min, max} (either may be null), or null if the text can't be understood. */
export function parseRange(raw) {
  let s = String(raw ?? "").trim();
  if (!s) return { min: null, max: null };
  s = s.replace(/\b(employees?|people|staff|cad|usd|per year|a year|annually)\b|\/\s*(yr|year)/gi, "").trim();

  let plus = false, upTo = false;
  if (/\+\s*$/.test(s)) { plus = true; s = s.replace(/\+\s*$/, ""); }
  if (/^(up to|under|<=?|≤)\s*/i.test(s)) { upTo = true; s = s.replace(/^(up to|under|<=?|≤)\s*/i, ""); }

  const parts = s.split(/\s*(?:–|—|-|\bto\b)\s*/i).filter((p) => p !== "");
  if (!parts.length || parts.length > 2) return null;
  const nums = parts.map(parseNum);
  if (nums.some((n) => n == null || Number.isNaN(n))) return null;

  if (nums.length === 1) {
    const n = nums[0];
    if (plus) return { min: n, max: null };
    if (upTo) return { min: null, max: n };
    return { min: n, max: n };
  }
  // "80-95k": the suffix on the second number applies to the first too.
  const sfx = /([km])\s*$/i.exec(parts[1]);
  if (sfx && !/[km]\s*$/i.test(parts[0]) && nums[0] < 1000) nums[0] *= sfx[1].toLowerCase() === "k" ? 1e3 : 1e6;
  const [a, b] = nums;
  return { min: Math.min(a, b), max: Math.max(a, b) };
}

function fmtNum(n, kind) {
  if (kind === "money") {
    if (n >= 1e6) return +(n / 1e6).toFixed(2) + "m";
    if (n >= 1e3) return +(n / 1e3).toFixed(1) + "k";
    return String(n);
  }
  return Number(n).toLocaleString("en-US");
}

/** Formats a stored range back into text, e.g. "80k–95k", "5,000+", "up to 120k". */
export function fmtRange(min, max, kind) {
  const hasMin = min != null && min !== "", hasMax = max != null && max !== "";
  if (!hasMin && !hasMax) return "";
  if (hasMin && hasMax) return +min === +max ? fmtNum(+min, kind) : fmtNum(+min, kind) + "–" + fmtNum(+max, kind);
  if (hasMin) return fmtNum(+min, kind) + "+";
  return "up to " + fmtNum(+max, kind);
}
