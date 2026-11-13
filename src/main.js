import { createClient } from "@supabase/supabase-js";
import { parseCSV, toCSV } from "./csv.js";
import { parseRange, fmtRange } from "./range.js";
import "./style.css";

/* ---------- Supabase ----------
   The URL and publishable key come from environment variables (.env.local locally,
   Vercel project settings in production). The publishable key is designed to be
   used in the browser; your data is protected by Row Level Security in Postgres
   (see supabase/schema.sql), not by hiding this key. Never put the secret /
   service_role key in this app. */
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const $ = (id) => document.getElementById(id);

if (!SUPABASE_URL || !SUPABASE_KEY) {
  $("boot").textContent = "Missing Supabase settings. Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY (see README).";
  throw new Error("Missing Supabase environment variables");
}
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
const TABLE = "applications";

/* ---------- Sheet definition ---------- */
const STAGES = ["Saved", "Applied", "Screen", "Interview", "Offer", "Rejected", "Ghosted"];
const WEEK_GOAL = 20;
// [key, label, default width, type, options]
// "range" columns are stored as <key>_min and <key>_max in the database; options = "money" | "count".
const COLS = [
  ["company", "Company", 170, "text"],
  ["role", "Role", 190, "text"],
  ["status", "Stage", 120, "select", STAGES],
  ["base", "Base $", 110, "range", "money"],
  ["ote", "OTE $", 110, "range", "money"],
  ["size", "Size", 120, "range", "count"],
  ["rating", "Reviews /5", 90, "number"],
  ["founded", "Founded", 85, "number"],
  ["_age", "Age", 65, "calc"],
  ["funding", "Funding", 125, "select", ["Seed", "Series A", "Series B", "Series C+", "Public", "Private"]],
  ["mode", "Work mode", 105, "select", ["Remote", "Hybrid", "On-site"]],
  ["location", "Location", 140, "text"],
  ["fit", "Priority", 85, "select", ["1", "2", "3"]],
  ["link", "Posting link", 190, "link"],
  ["source", "Found via", 130, "select", ["LinkedIn", "Company site", "Referral", "Indeed", "Wellfound", "Recruiter", "Other"]],
  ["applied", "Applied", 130, "date"],
  ["follow_up", "Follow up", 130, "date"],
  ["reviews", "Reviews link / notes", 190, "text"],
  ["contact", "Contact", 170, "text"],
  ["notes", "Notes", 260, "text"],
];
const COL = Object.fromEntries(COLS.map((c) => [c[0], c]));
const NUMBERS = new Set(["rating", "founded"]);
const SORT_NUMERIC = new Set(["rating", "founded", "fit"]);
const DATES = new Set(["applied", "follow_up"]);
const IN_PLAY = ["Applied", "Screen", "Interview"];
const DENSITIES = ["compact", "normal", "tall"];
const SELECT_COLUMNS = ["id", "created_at", "updated_at", ...COLS.flatMap((c) => c[3] === "calc" ? [] : c[3] === "range" ? [c[0] + "_min", c[0] + "_max"] : [c[0]])].join(",");

let rows = [], sortKey = "created_at", sortDir = "asc", query = "", stageFilter = "All";
const selected = new Set();
let editingLink = null; // row id whose posting link is being edited
let pendingRender = false, focusNew = null, signedInAs = null, loading = false, resizing = false;

/* ---------- View preferences (this browser only) ---------- */
function loadPref(key, fallback) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; } }
function savePref(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ } }
let widths = loadPref("jt.colWidths", {});
let density = loadPref("jt.density", "normal");
if (!DENSITIES.includes(density)) density = "normal";

/* ---------- Helpers ---------- */
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = (n) => String(n).padStart(2, "0");
const isoOf = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const today = () => isoOf(new Date());
const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return isoOf(d); };
const age = (y) => { y = +y; if (!y) return ""; const a = new Date().getFullYear() - y; return a < 1 ? "<1" : a + " yr"; };
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "");
function toast(m) { const t = $("toast"); t.textContent = m; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), m.length > 60 ? 7000 : 2600); }
function shortLink(u) {
  try { const x = new URL(u); const path = x.pathname.replace(/\/$/, ""); const s = x.hostname.replace(/^www\./, "") + path; return s.length > 42 ? s.slice(0, 40) + "…" : s; }
  catch { return u; }
}
function safeLink(u) { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : null; } catch { return null; } }
function followClass(r) {
  if (!r.follow_up || !IN_PLAY.includes(r.status)) return "";
  const t = today();
  if (r.follow_up <= t) return "due";
  if (r.follow_up <= addDays(t, 2)) return "soon";
  return "";
}
const letter = (i) => { let s = ""; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
const editing = () => { const a = document.activeElement; return !!(a && a.closest && a.closest("#tbody") && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName) && a.type !== "checkbox"); };
const W = (c) => widths[c[0]] || c[2];
// The text shown for a cell (used for search and CSV export).
function display(r, c) {
  const [k, , , type, opt] = c;
  if (type === "calc") return age(r.founded);
  if (type === "range") return fmtRange(r[k + "_min"], r[k + "_max"], opt);
  return r[k] == null ? "" : String(r[k]);
}

/* ---------- Views ---------- */
function showLogin() {
  $("boot").hidden = true; $("appView").hidden = true; $("loginView").hidden = false;
  rows = []; signedInAs = null;
  $("password").value = "";
  setTimeout(() => $("email").focus(), 0);
}
function showApp(session) {
  $("boot").hidden = true; $("loginView").hidden = true; $("appView").hidden = false;
  const email = session.user.email || "";
  $("whoami").textContent = email ? "Signed in as " + email : "";
  if (signedInAs !== session.user.id) { signedInAs = session.user.id; loadRows(); }
}

/* ---------- Auth ---------- */
$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("loginBtn"), err = $("loginErr");
  err.hidden = true; btn.disabled = true; btn.textContent = "Signing in…";
  const { error } = await sb.auth.signInWithPassword({ email: $("email").value.trim(), password: $("password").value });
  btn.disabled = false; btn.textContent = "Sign in";
  if (error) {
    const msg = String(error.message || "");
    err.textContent =
      error.status === 429 ? "Too many attempts. Wait a few minutes and try again."
      : /not confirmed/i.test(msg) ? "This account isn't confirmed yet. In Supabase, open Authentication → Users and confirm it (or recreate it with Auto Confirm ticked)."
      : /invalid login credentials/i.test(msg) ? "Wrong email or password."
      : "Sign-in failed: " + msg;
    err.hidden = false;
  }
});
$("logoutBtn").addEventListener("click", async () => { await sb.auth.signOut(); });

// Don't await Supabase calls inside this callback; defer them instead.
sb.auth.onAuthStateChange((_event, session) => {
  setTimeout(() => (session ? showApp(session) : showLogin()), 0);
});

/* ---------- Data ---------- */
async function loadRows() {
  if (loading) return;
  loading = true;
  if (!rows.length) $("tbody").innerHTML = '<tr><td class="empty" colspan="' + (COLS.length + 3) + '">Loading your sheet…</td></tr>';
  const { data, error } = await sb.from(TABLE).select(SELECT_COLUMNS).order("created_at", { ascending: true });
  loading = false;
  if (error) {
    const missing = /column/i.test(error.message || "");
    $("tbody").innerHTML = '<tr><td class="empty" colspan="' + (COLS.length + 3) + '">' +
      (missing ? "The database is missing columns this version needs. Run <b>supabase/migrations/002_ranges.sql</b> in Supabase (SQL Editor), then reload."
               : "Couldn't load your sheet. Reload to try again.") +
      '<br><small>Supabase said: ' + esc(error.message || "unknown error") + "</small></td></tr>";
    return;
  }
  const ids = new Set(data.map((r) => r.id));
  [...selected].forEach((id) => { if (!ids.has(id)) selected.delete(id); });
  rows = data.map((r) => ({ ...r, status: STAGES.includes(r.status) ? r.status : "Saved", fit: r.fit == null ? "" : String(r.fit) }));
  render();
}

async function save(id, patch) {
  const { error } = await sb.from(TABLE).update(patch).eq("id", id);
  if (error) {
    toast("Couldn't save that cell. Supabase said: " + (error.message || "unknown error"));
    return false;
  }
  return true;
}

async function addRow() {
  if (stageFilter !== "All" && stageFilter !== "Saved") { stageFilter = "All"; $("stageFilter").value = "All"; }
  query = ""; $("q").value = "";
  sortKey = "created_at"; sortDir = "asc";
  const { data, error } = await sb.from(TABLE).insert({ company: "", role: "", status: "Saved", fit: "2" }).select().single();
  if (error) { toast("Couldn't add a row. Try again."); return; }
  rows.push({ ...data, fit: String(data.fit ?? "") });
  focusNew = data.id;
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  render();
}

/* ---------- Layout: column widths and row height ---------- */
function applyWidths() {
  $("cols").innerHTML = '<col style="width:40px"><col style="width:34px">' + COLS.map((c) => '<col style="width:' + W(c) + 'px">').join("") + '<col style="width:56px">';
  $("tbl").style.width = 40 + 34 + 56 + COLS.reduce((a, c) => a + W(c), 0) + "px";
}
function applyDensity() {
  $("sheet").dataset.density = density;
  $("density").value = density;
}
$("letters").innerHTML = '<th class="rn"></th><th class="sel"></th>' + COLS.map((c, i) => '<th class="' + (c[0] === "company" ? "c-company" : "") + '">' + letter(i) + "</th>").join("") + "<th></th>";
STAGES.forEach((s) => { const o = document.createElement("option"); o.value = s; o.textContent = s; $("stageFilter").appendChild(o); });
applyWidths();
applyDensity();

$("density").addEventListener("change", (e) => {
  density = DENSITIES.includes(e.target.value) ? e.target.value : "normal";
  savePref("jt.density", density);
  applyDensity();
  render();
});
$("resetWidths").addEventListener("click", () => { widths = {}; savePref("jt.colWidths", widths); applyWidths(); toast("Column widths reset"); });

// Drag a column's right edge to resize it; double-click the edge to reset that column.
$("names").addEventListener("pointerdown", (e) => {
  const h = e.target.closest(".rz");
  if (!h) return;
  e.preventDefault(); e.stopPropagation();
  const k = h.dataset.k, c = COL[k], startX = e.clientX, w0 = W(c);
  resizing = true;
  h.classList.add("active");
  h.setPointerCapture(e.pointerId);
  const move = (ev) => { widths[k] = Math.max(50, Math.min(900, Math.round(w0 + ev.clientX - startX))); applyWidths(); };
  const up = () => {
    h.classList.remove("active");
    h.removeEventListener("pointermove", move); h.removeEventListener("pointerup", up); h.removeEventListener("pointercancel", up);
    savePref("jt.colWidths", widths);
    setTimeout(() => (resizing = false), 0);
  };
  h.addEventListener("pointermove", move); h.addEventListener("pointerup", up); h.addEventListener("pointercancel", up);
});
$("names").addEventListener("dblclick", (e) => {
  const h = e.target.closest(".rz");
  if (!h) return;
  delete widths[h.dataset.k];
  savePref("jt.colWidths", widths);
  applyWidths();
});

/* ---------- Rendering ---------- */
function renderHead() {
  $("names").innerHTML = '<th class="rn" data-sort="created_at" title="Original order">#</th><th class="sel"><input type="checkbox" id="selAll" aria-label="Select all rows"></th>' + COLS.map((c) => {
    const arrow = sortKey === c[0] ? (sortDir === "asc" ? " ↑" : " ↓") : "";
    return '<th class="' + (c[0] === "company" ? "c-company" : "") + '" data-sort="' + c[0] + '"><span class="th-label">' + esc(c[1]) + arrow +
      '</span><span class="rz" data-k="' + c[0] + '" title="Drag to resize · double-click to reset"></span></th>';
  }).join("") + "<th></th>";
}

function stats() {
  const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); const weekStart = isoOf(d);
  const wk = rows.filter((r) => r.applied && r.applied >= weekStart).length;
  $("wkNum").textContent = wk;
  $("wkBar").style.width = Math.min(100, (wk / WEEK_GOAL) * 100) + "%";
  $("activeNum").textContent = rows.filter((r) => IN_PLAY.includes(r.status)).length;
  const applied = rows.filter((r) => r.status && r.status !== "Saved").length;
  const responded = rows.filter((r) => ["Screen", "Interview", "Offer"].includes(r.status)).length;
  $("rateNum").textContent = applied ? Math.round((responded / applied) * 100) + "%" : "—";
  $("dueNum").textContent = rows.filter((r) => followClass(r) === "due").length;
}

function visible() {
  let v = rows.filter((r) => stageFilter === "All" || r.status === stageFilter);
  if (query) { const q = query.toLowerCase(); v = v.filter((r) => COLS.some((c) => display(r, c).toLowerCase().includes(q))); }
  const val = (r) => {
    if (sortKey === "_age") return +r.founded ? -+r.founded : null;
    if (sortKey === "status") return STAGES.indexOf(r.status);
    if (COL[sortKey] && COL[sortKey][3] === "range") {
      const lo = r[sortKey + "_min"], hi = r[sortKey + "_max"];
      return lo != null ? +lo : hi != null ? +hi : null;
    }
    const x = r[sortKey];
    if (x === "" || x == null) return null;
    return SORT_NUMERIC.has(sortKey) ? +x : String(x).toLowerCase();
  };
  return v.sort((a, b) => {
    const A = val(a), B = val(b);
    if (A == null && B != null) return 1;
    if (B == null && A != null) return -1;
    const c = A < B ? -1 : A > B ? 1 : 0;
    return sortDir === "asc" ? c : -c;
  });
}

function cell(r, c) {
  const [k, label, , type, opts] = c, v = r[k] == null ? "" : r[k];
  const attrs = ' id="c-' + esc(r.id) + "-" + k + '" data-id="' + esc(r.id) + '" data-k="' + k + '" aria-label="' + esc(label) + '"';
  let cls = "c-" + k, inner = "";
  if (type === "calc") return '<td class="calc">' + age(r.founded) + "</td>";
  if (type === "select") {
    inner = "<select" + attrs + (k === "status" ? ' class="stage s-' + esc(v) + '"' : "") + ">" + (k === "status" ? "" : "<option></option>") +
      opts.map((o) => "<option" + (String(o) === String(v) ? " selected" : "") + ">" + esc(o) + "</option>").join("") + "</select>";
    if (k === "status") cls += " st-" + esc(v);
  } else if (type === "range") {
    inner = '<input type="text" class="range"' + attrs + ' value="' + esc(display(r, c)) + '" title=""Enter one number or a range, e.g. ' + (opts === "money" ? "80k-95k" : "51-200 or 5000+") + '">';
    cls += " num";
  } else if (type === "link") {
    const l = safeLink(v);
    if (l && editingLink !== r.id) {
      // Saved link: click to open in a new tab, ✎ to change it.
      inner = '<div class="linkcell"><a class="linktext" href="' + esc(l) + '" target="_blank" rel="noopener noreferrer" title="' + esc(l) + '">' + esc(shortLink(l)) + "</a>" +
        '<button type="button" class="editlink" data-edit-link="' + esc(r.id) + '" aria-label="Edit posting link" title="Edit link">✎</button></div>';
    } else {
      inner = '<div class="linkcell"><input type="url"' + attrs + ' value="' + esc(v) + '" placeholder="https://"></div>';
    }
  } else if (type === "text" && density === "tall") {
    inner = "<textarea" + attrs + ' rows="2">' + esc(v) + "</textarea>";
  } else {
    const t = type === "number" ? ' type="text" inputmode="decimal" autocomplete="off"'
      : type === "date" ? ' type="date"' : ' type="text"';
    inner = "<input" + t + attrs + ' value="' + esc(v) + '">';
    if (k === "follow_up") cls += " " + followClass(r);
    if (type === "number") cls += " num";
  }
  return '<td class="' + cls + '">' + inner + "</td>";
}

function render() {
  if (editing()) { pendingRender = true; stats(); return; }
  pendingRender = false;
  stats(); renderHead();
  const v = visible();
  let html = v.map((r, i) => '<tr' + (selected.has(r.id) ? ' class="picked"' : "") + '><td class="rn">' + (i + 1) + "</td>" +
    '<td class="sel"><input type="checkbox" data-sel="' + esc(r.id) + '"' + (selected.has(r.id) ? " checked" : "") + ' aria-label="Select row"></td>' + COLS.map((c) => cell(r, c)).join("") +
    '<td><button class="del" type="button" data-del="' + esc(r.id) + '" aria-label="Delete row">✕</button></td></tr>').join("");
  if (!v.length) html = '<tr><td class="empty" colspan="' + (COLS.length + 3) + '">' +
    (rows.length ? "No rows match. Clear the search or stage filter." : "No applications yet. Add your first row below, or import a CSV from the old tracker.") + "</td></tr>";
  html += '<tr class="addrow"><td class="rn">+</td><td class="sel"></td><td colspan="' + (COLS.length + 2) + '"><button type="button" id="addInline">+ New row</button></td></tr>';
  $("tbody").innerHTML = html;
  $("addInline").onclick = addRow;
  syncSelection();
  if (focusNew) { const el = document.getElementById("c-" + focusNew + "-company"); if (el) { el.focus(); focusNew = null; } }
}

/* ---------- Editing ---------- */
$("tbody").addEventListener("change", async (e) => {
  const el = e.target;
  if (el.dataset && el.dataset.sel) {
    if (el.checked) selected.add(el.dataset.sel); else selected.delete(el.dataset.sel);
    el.closest("tr").classList.toggle("picked", el.checked);
    syncSelection();
    return;
  }
  if (!el.dataset || !el.dataset.k) return;
  const r = rows.find((x) => x.id === el.dataset.id);
  if (!r) return;
  const k = el.dataset.k, c = COL[k];
  let patch;

  if (c[3] === "range") {
    const p = parseRange(el.value);
    const current = fmtRange(r[k + "_min"], r[k + "_max"], c[4]);
    if (!p) { toast("Use a number or a range, like " + (c[4] === "money" ? "80k-95k" : "51-200") + "."); el.value = current; return; }
    if (p.min === (r[k + "_min"] == null ? null : +r[k + "_min"]) && p.max === (r[k + "_max"] == null ? null : +r[k + "_max"])) { el.value = current; return; }
    patch = { [k + "_min"]: p.min, [k + "_max"]: p.max };
    el.value = fmtRange(p.min, p.max, c[4]);
  } else {
    let v = el.value.trim();
    if (NUMBERS.has(k)) {
      v = v === "" ? null : Number(v.replace(/[,\s]/g, ""));
      if (v !== null && !Number.isFinite(v)) { toast("That needs to be a number."); el.value = r[k] ?? ""; return; }
      if (k === "rating" && v !== null && (v < 0 || v > 5)) { toast("Reviews must be between 0 and 5."); el.value = r[k] ?? ""; return; }
    } else if (DATES.has(k)) {
      v = isDate(v) ? v : null;
    }
    if (String(r[k] ?? "") === String(v ?? "")) return;
    patch = { [k]: v };
    if (k === "status" && v === "Applied" && !r.applied) { patch.applied = today(); if (!r.follow_up) patch.follow_up = addDays(patch.applied, 7); }
    if (k === "applied" && v && !r.follow_up) patch.follow_up = addDays(v, 7);
    if (k === "status") { el.className = "stage s-" + v; el.parentElement.className = "c-status st-" + v; }
  }

  const before = {};
  Object.keys(patch).forEach((p) => (before[p] = r[p]));
  Object.assign(r, patch);
  // Show auto-filled dates right away.
  Object.keys(patch).forEach((p) => { if (p !== k) { const other = document.getElementById("c-" + r.id + "-" + p); if (other) other.value = patch[p] ?? ""; } });
  stats();

  const ok = await save(r.id, patch);
  if (!ok) Object.assign(r, before);
  render();
});

$("tbody").addEventListener("focusout", (e) => {
  const leavingLink = e.target.dataset && e.target.dataset.k === "link";
  setTimeout(() => {
    if (leavingLink && editingLink) { editingLink = null; pendingRender = true; }
    if (pendingRender && !editing()) render();
  }, 0);
});

// Enter moves down a row (Shift+Enter adds a line break in tall rows).
$("tbody").addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  const tag = e.target.tagName;
  if ((tag !== "INPUT" || e.target.type === "checkbox") && !(tag === "TEXTAREA" && !e.shiftKey)) return;
  e.preventDefault();
  const td = e.target.closest("td"), tr = td.parentElement, idx = [...tr.children].indexOf(td);
  const next = tr.nextElementSibling && tr.nextElementSibling.children[idx];
  const inp = next && next.querySelector("input,select,textarea");
  if (inp) inp.focus(); else e.target.blur();
});

$("tbody").addEventListener("click", async (e) => {
  const ed = e.target.closest("[data-edit-link]");
  if (ed) {
    editingLink = ed.dataset.editLink;
    render();
    const inp = document.getElementById("c-" + editingLink + "-link");
    if (inp) { inp.focus(); inp.select(); }
    return;
  }
  const b = e.target.closest("[data-del]");
  if (!b) return;
  if (!b.classList.contains("armed")) {
    b.classList.add("armed"); b.textContent = "Delete?";
    setTimeout(() => { if (b.isConnected) { b.classList.remove("armed"); b.textContent = "✕"; } }, 3500);
    return;
  }
  const id = b.dataset.del;
  const { error } = await sb.from(TABLE).delete().eq("id", id);
  if (error) { toast("Couldn't delete. Try again."); return; }
  rows = rows.filter((r) => r.id !== id);
  selected.delete(id);
  toast("Row deleted");
  render();
});

document.querySelector("thead").addEventListener("click", (e) => {
  if (resizing || e.target.closest(".rz")) return;
  const th = e.target.closest("th[data-sort]");
  if (!th) return;
  const k = th.dataset.sort;
  if (sortKey === k) sortDir = sortDir === "asc" ? "desc" : "asc";
  else { sortKey = k; sortDir = ["ote", "base", "rating", "applied"].includes(k) ? "desc" : "asc"; }
  render();
});
$("q").addEventListener("input", (e) => { query = e.target.value.trim(); render(); });
$("stageFilter").addEventListener("change", (e) => { stageFilter = e.target.value; render(); });
$("addBtn").addEventListener("click", addRow);

// Pick up changes made on another device when you come back to the tab.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && signedInAs && !editing()) loadRows();
});

/* ---------- Select & bulk delete ---------- */
function syncSelection() {
  const v = visible(), n = selected.size;
  const shown = v.filter((r) => selected.has(r.id)).length;
  const all = $("selAll");
  if (all) { all.checked = v.length > 0 && shown === v.length; all.indeterminate = shown > 0 && shown < v.length; }
  $("delSel").hidden = n === 0;
  $("clearSel").hidden = n === 0;
  $("delSel").textContent = "Delete selected (" + n + ")";
}
document.querySelector("thead").addEventListener("change", (e) => {
  if (e.target.id !== "selAll") return;
  const v = visible();
  if (e.target.checked) v.forEach((r) => selected.add(r.id)); else v.forEach((r) => selected.delete(r.id));
  render();
});
$("clearSel").addEventListener("click", () => { selected.clear(); render(); });
$("delSel").addEventListener("click", async () => {
  const ids = [...selected];
  if (!ids.length) return;
  if (!confirm("Delete " + ids.length + " row" + (ids.length === 1 ? "" : "s") + "? This can't be undone.")) return;
  const btn = $("delSel"); btn.disabled = true;
  let deleted = 0, failed = false;
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const { error } = await sb.from(TABLE).delete().in("id", chunk);
    if (error) { failed = true; break; }
    deleted += chunk.length;
    const gone = new Set(chunk);
    rows = rows.filter((r) => !gone.has(r.id));
    chunk.forEach((id) => selected.delete(id));
  }
  btn.disabled = false;
  toast(failed ? "Deleted " + deleted + ", then something went wrong. Try again." : "Deleted " + deleted + " row" + (deleted === 1 ? "" : "s"));
  render();
});

/* ---------- Export ---------- */
$("exportBtn").addEventListener("click", () => {
  const header = COLS.map((c) => c[1]);
  const body = visible().map((r) => COLS.map((c) => display(r, c)));
  const blob = new Blob([toCSV([header, ...body])], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "tech-sales-applications-" + today() + ".csv";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

/* ---------- Import (e.g. the CSV exported from the old tracker) ---------- */
$("importBtn").addEventListener("click", () => $("importFile").click());
$("importFile").addEventListener("change", async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = "";
  if (!file) return;
  if (file.size > 2_000_000) { toast("That file is too big."); return; }

  const table = parseCSV(await file.text());
  if (table.length < 2) { toast("No rows found in that file."); return; }

  // Match columns by label ("Company", "Follow up", …) or by key ("follow_up").
  const lookup = {};
  COLS.forEach((c) => { lookup[c[1].toLowerCase()] = c; lookup[c[0]] = c; });
  lookup["followup"] = COL.follow_up;
  const map = table[0].map((h) => lookup[h.trim().toLowerCase()] || null);
  if (!map.some((c) => c && c[0] === "company")) { toast("Couldn't find a Company column in that file."); return; }

  const records = [];
  for (const line of table.slice(1)) {
    const rec = {};
    map.forEach((c, i) => {
      if (!c || c[3] === "calc") return;
      const [k, , , type] = c;
      const raw = (line[i] ?? "").trim();
      if (raw === "") return;
      if (type === "range") { const p = parseRange(raw); if (p) { rec[k + "_min"] = p.min; rec[k + "_max"] = p.max; } }
      else if (NUMBERS.has(k)) { const n = Number(raw.replace(/[$,\s]/g, "")); if (Number.isFinite(n)) rec[k] = n; }
      else if (DATES.has(k)) { if (isDate(raw)) rec[k] = raw; }
      else if (k === "status") { if (STAGES.includes(raw)) rec[k] = raw; }
      else rec[k] = raw.slice(0, 5000);
    });
    if (rec.rating != null && (rec.rating < 0 || rec.rating > 5)) delete rec.rating;
    if (rec.company || rec.role) records.push(rec);
  }
  if (!records.length) { toast("No usable rows in that file."); return; }
  if (!confirm("Import " + records.length + " row(s) into your tracker?")) return;

  for (let i = 0; i < records.length; i += 500) {
    const { error } = await sb.from(TABLE).insert(records.slice(i, i + 500));
    if (error) { toast("Import stopped partway. Some rows may not have been added."); await loadRows(); return; }
  }
  toast("Imported " + records.length + " row(s)");
  await loadRows();
});
