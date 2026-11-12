import { createClient } from "@supabase/supabase-js";
import { parseCSV, toCSV } from "./csv.js";
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
const SIZES = ["1–50", "51–200", "201–1,000", "1,001–5,000", "5,000+"];
const WEEK_GOAL = 20;
// [key (database column), label, width, type, options]
const COLS = [
  ["company", "Company", 170, "text"],
  ["role", "Role", 190, "text"],
  ["status", "Stage", 120, "select", STAGES],
  ["base", "Base $", 95, "number"],
  ["ote", "OTE $", 95, "number"],
  ["size", "Size", 115, "select", SIZES],
  ["rating", "Reviews /5", 90, "number"],
  ["founded", "Founded", 85, "number"],
  ["_age", "Age", 65, "calc"],
  ["funding", "Funding", 125, "select", ["Seed", "Series A", "Series B", "Series C+", "Public", "Private"]],
  ["location", "Location", 140, "text"],
  ["mode", "Work mode", 105, "select", ["Remote", "Hybrid", "On-site"]],
  ["link", "Posting link", 190, "link"],
  ["reviews", "Reviews link / notes", 190, "text"],
  ["applied", "Applied", 130, "date"],
  ["follow_up", "Follow up", 130, "date"],
  ["source", "Found via", 130, "select", ["LinkedIn", "Company site", "Referral", "Indeed", "Wellfound", "Recruiter", "Other"]],
  ["contact", "Contact", 170, "text"],
  ["resume", "Resume ver.", 105, "text"],
  ["fit", "Priority", 85, "select", ["1", "2", "3"]],
  ["notes", "Notes", 260, "text"],
];
const NUMBERS = new Set(["base", "ote", "rating", "founded"]);
const SORT_NUMERIC = new Set(["base", "ote", "rating", "founded", "fit"]);
const DATES = new Set(["applied", "follow_up"]);
const IN_PLAY = ["Applied", "Screen", "Interview"];

let rows = [], sortKey = "created_at", sortDir = "asc", query = "", stageFilter = "All";
let pendingRender = false, focusNew = null, signedInAs = null, loading = false;

/* ---------- Helpers ---------- */
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = (n) => String(n).padStart(2, "0");
const isoOf = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const today = () => isoOf(new Date());
const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return isoOf(d); };
const age = (y) => { y = +y; if (!y) return ""; const a = new Date().getFullYear() - y; return a < 1 ? "<1" : a + " yr"; };
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "");
function toast(m) { const t = $("toast"); t.textContent = m; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 2600); }
function safeLink(u) { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : null; } catch { return null; } }
function followClass(r) {
  if (!r.follow_up || !IN_PLAY.includes(r.status)) return "";
  const t = today();
  if (r.follow_up <= t) return "due";
  if (r.follow_up <= addDays(t, 2)) return "soon";
  return "";
}
const letter = (i) => { let s = ""; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
const editing = () => { const a = document.activeElement; return !!(a && a.closest && a.closest("#tbody") && (a.tagName === "INPUT" || a.tagName === "SELECT")); };

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
    err.textContent = error.status === 429 ? "Too many attempts. Wait a few minutes and try again." : "Wrong email or password.";
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
  if (!rows.length) $("tbody").innerHTML = '<tr><td class="empty" colspan="' + (COLS.length + 2) + '">Loading your sheet…</td></tr>';
  const { data, error } = await sb.from(TABLE).select("*").order("created_at", { ascending: true });
  loading = false;
  if (error) {
    if (!rows.length) $("tbody").innerHTML = '<tr><td class="empty" colspan="' + (COLS.length + 2) + '">Couldn\'t load your sheet. Reload to try again.</td></tr>';
    return;
  }
  rows = data.map((r) => ({ ...r, status: STAGES.includes(r.status) ? r.status : "Saved", fit: r.fit == null ? "" : String(r.fit) }));
  render();
}

async function save(id, patch) {
  const { error } = await sb.from(TABLE).update(patch).eq("id", id);
  if (error) { toast("Couldn't save that cell. Try again."); return false; }
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

/* ---------- Rendering ---------- */
$("cols").innerHTML = '<col style="width:40px">' + COLS.map((c) => '<col style="width:' + c[2] + 'px">').join("") + '<col style="width:56px">';
$("letters").innerHTML = '<th class="rn"></th>' + COLS.map((c, i) => '<th class="' + (c[0] === "company" ? "c-company" : "") + '">' + letter(i) + "</th>").join("") + "<th></th>";
$("tbl").style.width = 40 + 56 + COLS.reduce((a, c) => a + c[2], 0) + "px";
STAGES.forEach((s) => { const o = document.createElement("option"); o.value = s; o.textContent = s; $("stageFilter").appendChild(o); });

function renderHead() {
  $("names").innerHTML = '<th class="rn" data-sort="created_at" title="Original order">#</th>' + COLS.map((c) => {
    const arrow = sortKey === c[0] ? (sortDir === "asc" ? " ↑" : " ↓") : "";
    return '<th class="' + (c[0] === "company" ? "c-company" : "") + '" data-sort="' + c[0] + '">' + esc(c[1]) + arrow + "</th>";
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
  if (query) { const q = query.toLowerCase(); v = v.filter((r) => COLS.some((c) => String(r[c[0]] ?? "").toLowerCase().includes(q))); }
  const val = (r) => {
    if (sortKey === "_age") return +r.founded ? -+r.founded : null;
    if (sortKey === "status") return STAGES.indexOf(r.status);
    if (sortKey === "size") return r.size ? SIZES.indexOf(r.size) : null;
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
  } else if (type === "link") {
    const l = safeLink(v);
    inner = '<div class="linkcell"><input type="url"' + attrs + ' value="' + esc(v) + '" placeholder="https://">' +
      (l ? '<a href="' + esc(l) + '" target="_blank" rel="noopener noreferrer" aria-label="Open posting">↗</a>' : "") + "</div>";
  } else {
    const t = type === "number" ? ' type="number" inputmode="decimal"' + (k === "rating" ? ' step="0.1" min="0" max="5"' : "")
      : type === "date" ? ' type="date"' : ' type="text"';
    inner = "<input" + t + attrs + ' value="' + esc(v) + '">';
    if (k === "follow_up") cls += " " + followClass(r);
  }
  return '<td class="' + cls + '">' + inner + "</td>";
}

function render() {
  if (editing()) { pendingRender = true; stats(); return; }
  pendingRender = false;
  stats(); renderHead();
  const v = visible();
  let html = v.map((r, i) => '<tr><td class="rn">' + (i + 1) + "</td>" + COLS.map((c) => cell(r, c)).join("") +
    '<td><button class="del" type="button" data-del="' + esc(r.id) + '" aria-label="Delete row">✕</button></td></tr>').join("");
  if (!v.length) html = '<tr><td class="empty" colspan="' + (COLS.length + 2) + '">' +
    (rows.length ? "No rows match. Clear the search or stage filter." : "No applications yet. Add your first row below, or import a CSV from the old tracker.") + "</td></tr>";
  html += '<tr class="addrow"><td class="rn">+</td><td colspan="' + (COLS.length + 1) + '"><button type="button" id="addInline">+ New row</button></td></tr>';
  $("tbody").innerHTML = html;
  $("addInline").onclick = addRow;
  if (focusNew) { const el = document.getElementById("c-" + focusNew + "-company"); if (el) { el.focus(); focusNew = null; } }
}

/* ---------- Editing ---------- */
$("tbody").addEventListener("change", async (e) => {
  const el = e.target;
  if (!el.dataset || !el.dataset.k) return;
  const r = rows.find((x) => x.id === el.dataset.id);
  if (!r) return;
  const k = el.dataset.k;
  let v = el.value.trim();
  if (NUMBERS.has(k)) {
    v = v === "" ? null : Number(v);
    if (v !== null && !Number.isFinite(v)) { toast("That needs to be a number."); el.value = r[k] ?? ""; return; }
    if (k === "rating" && v !== null && (v < 0 || v > 5)) { toast("Reviews must be between 0 and 5."); el.value = r[k] ?? ""; return; }
  } else if (DATES.has(k)) {
    v = isDate(v) ? v : null;
  }
  if (String(r[k] ?? "") === String(v ?? "")) return;

  const patch = { [k]: v };
  if (k === "status" && v === "Applied" && !r.applied) { patch.applied = today(); if (!r.follow_up) patch.follow_up = addDays(patch.applied, 7); }
  if (k === "applied" && v && !r.follow_up) patch.follow_up = addDays(v, 7);

  const before = {};
  Object.keys(patch).forEach((p) => (before[p] = r[p]));
  Object.assign(r, patch);
  if (k === "status") { el.className = "stage s-" + v; el.parentElement.className = "c-status st-" + v; }
  // Show auto-filled dates right away.
  Object.keys(patch).forEach((p) => { if (p !== k) { const other = document.getElementById("c-" + r.id + "-" + p); if (other) other.value = patch[p] ?? ""; } });
  stats();

  const ok = await save(r.id, patch);
  if (!ok) Object.assign(r, before);
  render();
});

$("tbody").addEventListener("focusout", () => {
  setTimeout(() => { if (pendingRender && !editing()) render(); }, 0);
});

$("tbody").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.tagName === "INPUT") {
    e.preventDefault();
    const td = e.target.closest("td"), tr = td.parentElement, idx = [...tr.children].indexOf(td);
    const next = tr.nextElementSibling && tr.nextElementSibling.children[idx];
    const inp = next && next.querySelector("input,select");
    if (inp) inp.focus(); else e.target.blur();
  }
});

$("tbody").addEventListener("click", async (e) => {
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
  toast("Row deleted");
  render();
});

document.querySelector("thead").addEventListener("click", (e) => {
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

/* ---------- Export ---------- */
$("exportBtn").addEventListener("click", () => {
  const header = COLS.map((c) => c[1]);
  const body = visible().map((r) => COLS.map((c) => (c[0] === "_age" ? age(r.founded) : r[c[0]])));
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
  lookup["followup"] = lookup["follow_up"];
  const map = table[0].map((h) => lookup[h.trim().toLowerCase()] || null);
  if (!map.some((c) => c && c[0] === "company")) { toast("Couldn't find a Company column in that file."); return; }

  const records = [];
  for (const line of table.slice(1)) {
    const rec = {};
    map.forEach((c, i) => {
      if (!c || c[3] === "calc") return;
      const [k, , , type, opts] = c;
      const raw = (line[i] ?? "").trim();
      if (raw === "") return;
      if (NUMBERS.has(k)) { const n = Number(raw.replace(/[$,\s]/g, "")); if (Number.isFinite(n)) rec[k] = n; }
      else if (DATES.has(k)) { if (isDate(raw)) rec[k] = raw; }
      else if (type === "select" && k === "status") { if (STAGES.includes(raw)) rec[k] = raw; }
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
