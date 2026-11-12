// Small CSV helpers (handles quoted fields, commas and line breaks inside quotes).

export function parseCSV(text) {
  text = text.replace(/^﻿/, "");
  const out = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = ""; out.push(row); row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); out.push(row); }
  return out.filter((r) => r.some((x) => x.trim() !== ""));
}

export function toCSV(table) {
  const cell = (v) => {
    v = v == null ? "" : String(v);
    return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  };
  return "﻿" + table.map((r) => r.map(cell).join(",")).join("\r\n");
}
