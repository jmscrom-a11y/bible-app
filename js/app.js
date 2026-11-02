// 성경 웹앱 — reader + search + highlights/bookmarks/notes + reading plan + audio.
// No framework, no build step. Data is pre-split per book under data/<trans>/<nr>.json.

const DATA = "data";
const TRANS_ORDER = ["ko", "en", "parallel"];
const TRANS_FILE = { ko: "korean", en: "kjv" };       // parallel uses both
const TRANS_LABEL = { ko: "한", en: "EN", parallel: "한/영" };
const SPEAK_LANG = { ko: "ko-KR", en: "en-US" };

// ── persisted state ────────────────────────────────────────────────────────
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem("bible." + k)) ?? d; } catch { return d; } },
  set(k, v) { localStorage.setItem("bible." + k, JSON.stringify(v)); },
};
const state = {
  books: [],                              // manifest
  nr: store.get("pos", { nr: 43, ch: 3 }).nr,
  ch: store.get("pos", { nr: 43, ch: 3 }).ch,
  trans: store.get("trans", "ko"),
  highlights: store.get("highlights", {}),   // "nr:ch:v" -> color
  bookmarks: store.get("bookmarks", {}),     // "nr:ch:v" -> true
  notes: store.get("notes", {}),             // "nr:ch:v" -> text
  planDone: store.get("planDone", {}),       // dayIndex -> true
  fontIdx: store.get("fontIdx", 3),
  keepAwake: store.get("keepAwake", true),
  sheetKey: null,
};
const bookCache = new Map();   // "trans/nr" -> book json
const searchCache = new Map(); // trans -> [{nr,ch,v,t}]

const FONTS = [0.9, 1.0, 1.1, 1.15, 1.3, 1.5, 1.75];
const $ = (s) => document.querySelector(s);
const key = (nr, ch, v) => `${nr}:${ch}:${v}`;

// ── boot ─────────────────────────────────────────────────────────────────
async function boot() {
  applyTheme(store.get("theme", "light"));
  applyFont();
  state.books = await (await fetch(`${DATA}/books.json`)).json();
  wireUI();
  updateWakeLabel();
  acquireWakeLock();
  await render();
  registerSW();
}

function bookByNr(nr) { return state.books.find((b) => b.nr === nr); }
function bookName(nr) {
  const b = bookByNr(nr);
  if (!b) return "";
  return state.trans === "en" ? b.en : b.ko;
}

async function loadBook(trans, nr) {
  const ck = `${trans}/${nr}`;
  if (bookCache.has(ck)) return bookCache.get(ck);
  const j = await (await fetch(`${DATA}/${trans}/${nr}.json`)).json();
  bookCache.set(ck, j);
  return j;
}

function chapterVerses(book, ch) {
  const c = book.chapters.find((x) => x.chapter === ch);
  return c ? c.verses : [];
}

// ── reader render ──────────────────────────────────────────────────────────
async function render() {
  const b = bookByNr(state.nr);
  if (!b) return;
  if (state.ch < 1) state.ch = 1;
  if (state.ch > b.chapters) state.ch = b.chapters;

  $("#cur-ref").textContent = `${bookName(state.nr)} ${state.ch}`;
  $("#btn-trans").textContent = TRANS_LABEL[state.trans];
  document.title = `${bookName(state.nr)} ${state.ch} · 성경`;

  const koBook = state.trans !== "en" ? await loadBook("korean", state.nr) : null;
  const enBook = state.trans !== "ko" ? await loadBook("kjv", state.nr) : null;
  const primary = state.trans === "en" ? enBook : koBook;
  const verses = chapterVerses(primary, state.ch);
  const enVerses = enBook ? chapterVerses(enBook, state.ch) : [];

  const wrap = $("#verses");
  wrap.innerHTML = "";
  for (const vrow of verses) {
    const k = key(state.nr, state.ch, vrow.v);
    const el = document.createElement("div");
    el.className = "verse";
    el.dataset.key = k;
    el.dataset.v = vrow.v;
    const hl = state.highlights[k];
    if (hl) el.classList.add("hl-" + hl);
    if (state.trans === "parallel") el.classList.add("parallel");

    const badges =
      (state.bookmarks[k] ? '<span class="badge" title="북마크">★</span>' : "") +
      (state.notes[k] ? '<span class="badge" title="메모">✎</span>' : "");

    let html = `<span class="vn">${vrow.v}</span>${escapeHtml(vrow.t)}${badges}`;
    if (state.trans === "parallel") {
      const en = enVerses.find((x) => x.v === vrow.v);
      if (en) html += `<span class="vt-en">${escapeHtml(en.t)}</span>`;
    }
    el.innerHTML = html;
    el.addEventListener("click", () => openSheet(k, vrow.v));
    wrap.appendChild(el);
  }

  $("#btn-prev").disabled = (state.nr === 1 && state.ch === 1);
  $("#btn-next").disabled = (state.nr === 66 && state.ch === b.chapters);
  store.set("pos", { nr: state.nr, ch: state.ch });
  $("#reader").scrollTo?.(0, 0);
  window.scrollTo(0, 0);
}

function goChapter(nr, ch) {
  stopAudio();
  state.nr = nr; state.ch = ch;
  render();
}
function step(delta) {
  const b = bookByNr(state.nr);
  let { nr, ch } = state;
  ch += delta;
  if (ch < 1) {
    nr -= 1;
    if (nr < 1) return;
    ch = bookByNr(nr).chapters;
  } else if (ch > b.chapters) {
    nr += 1;
    if (nr > 66) return;
    ch = 1;
  }
  goChapter(nr, ch);
}

// ── TOC drawer ───────────────────────────────────────────────────────────
let tocTestament = "OT";
function openTOC() {
  buildBookGrid();
  $("#chapter-grid").classList.add("hidden");
  $("#book-grid").classList.remove("hidden");
  $("#drawer").classList.remove("hidden");
}
function buildBookGrid() {
  const grid = $("#book-grid");
  grid.innerHTML = "";
  state.books.filter((b) => b.testament === tocTestament).forEach((b) => {
    const cell = document.createElement("button");
    cell.className = "book-cell";
    cell.textContent = state.trans === "en" ? b.en : b.ko;
    cell.addEventListener("click", () => buildChapterGrid(b));
    grid.appendChild(cell);
  });
}
function buildChapterGrid(b) {
  const grid = $("#chapter-grid");
  grid.innerHTML = "";
  const back = document.createElement("button");
  back.className = "chap-back";
  back.innerHTML = "‹ 책 목록";
  back.addEventListener("click", () => {
    grid.classList.add("hidden"); $("#book-grid").classList.remove("hidden");
  });
  grid.appendChild(back);
  for (let c = 1; c <= b.chapters; c++) {
    const cell = document.createElement("button");
    cell.className = "chap-cell";
    cell.textContent = c;
    cell.addEventListener("click", () => { closeAll(); goChapter(b.nr, c); });
    grid.appendChild(cell);
  }
  $("#book-grid").classList.add("hidden");
  grid.classList.remove("hidden");
}

// ── verse action sheet ─────────────────────────────────────────────────────
function openSheet(k, v) {
  state.sheetKey = k;
  $("#sheet-ref").textContent = `${bookName(state.nr)} ${state.ch}:${v}`;
  $("#act-bookmark").classList.toggle("on", !!state.bookmarks[k]);
  $("#note-input").value = state.notes[k] || "";
  $("#note-input").classList.add("hidden");
  $("#note-save-row").classList.add("hidden");
  $("#act-note").classList.toggle("on", !!state.notes[k]);
  $("#sheet").classList.remove("hidden");
}
function setHighlight(color) {
  const k = state.sheetKey; if (!k) return;
  if (color === "none") delete state.highlights[k];
  else state.highlights[k] = color;
  store.set("highlights", state.highlights);
  closeAll(); render();
}
function toggleBookmark() {
  const k = state.sheetKey; if (!k) return;
  if (state.bookmarks[k]) delete state.bookmarks[k];
  else state.bookmarks[k] = true;
  store.set("bookmarks", state.bookmarks);
  $("#act-bookmark").classList.toggle("on", !!state.bookmarks[k]);
  render();
  toast(state.bookmarks[k] ? "북마크 추가" : "북마크 해제");
}
function saveNote() {
  const k = state.sheetKey; if (!k) return;
  const txt = $("#note-input").value.trim();
  if (txt) state.notes[k] = txt; else delete state.notes[k];
  store.set("notes", state.notes);
  closeAll(); render(); toast(txt ? "메모 저장" : "메모 삭제");
}
async function copyVerse() {
  const k = state.sheetKey; if (!k) return;
  const [nr, ch, v] = k.split(":").map(Number);
  const trans = state.trans === "en" ? "kjv" : "korean";
  const book = await loadBook(trans, nr);
  const vt = chapterVerses(book, ch).find((x) => x.v === v);
  const text = `${bookName(nr)} ${ch}:${v} ${vt ? vt.t : ""}`;
  try { await navigator.clipboard.writeText(text); toast("복사됨"); }
  catch { toast("복사 실패"); }
  closeAll();
}

// ── search (whole bible, lazy cache) ────────────────────────────────────────
async function ensureSearchIndex(trans) {
  if (searchCache.has(trans)) return searchCache.get(trans);
  const flat = [];
  for (const b of state.books) {
    $("#search-status").textContent = `색인 준비 중… ${b.nr}/66`;
    const book = await loadBook(trans, b.nr);
    for (const c of book.chapters)
      for (const vr of c.verses) flat.push({ nr: b.nr, ch: c.chapter, v: vr.v, t: vr.t });
  }
  searchCache.set(trans, flat);
  return flat;
}
let searchTimer = null;
function onSearchInput() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearch, 250);
}
async function runSearch() {
  const q = $("#search-input").value.trim();
  const out = $("#search-results");
  if (q.length < 2) { out.innerHTML = ""; $("#search-status").textContent = "두 글자 이상 입력"; return; }
  const trans = state.trans === "en" ? "kjv" : "korean";
  const idx = await ensureSearchIndex(trans);
  const ql = q.toLowerCase();
  const hits = [];
  for (const r of idx) {
    if (r.t.toLowerCase().includes(ql)) { hits.push(r); if (hits.length >= 300) break; }
  }
  $("#search-status").textContent = `${hits.length}${hits.length >= 300 ? "+" : ""}개 결과`;
  out.innerHTML = "";
  for (const r of hits) {
    const el = document.createElement("div");
    el.className = "result";
    const snip = escapeHtml(r.t).replace(new RegExp(escapeReg(q), "ig"), (m) => `<mark>${m}</mark>`);
    el.innerHTML = `<div class="r-ref">${bookName(r.nr)} ${r.ch}:${r.v}</div><div>${snip}</div>`;
    el.addEventListener("click", () => { closeAll(); goChapter(r.nr, r.ch); });
    out.appendChild(el);
  }
}

// ── bookmarks / highlights / notes list ─────────────────────────────────────
async function showSaved() {
  $("#list-title").textContent = "북마크 · 형광펜 · 메모";
  const body = $("#list-body");
  body.innerHTML = "";
  const keys = new Set([
    ...Object.keys(state.bookmarks),
    ...Object.keys(state.highlights),
    ...Object.keys(state.notes),
  ]);
  if (keys.size === 0) { body.innerHTML = '<p style="padding:1rem;color:var(--muted)">아직 저장된 항목이 없어요.</p>'; }
  const sorted = [...keys].sort((a, b) => {
    const [an, ac, av] = a.split(":").map(Number), [bn, bc, bv] = b.split(":").map(Number);
    return an - bn || ac - bc || av - bv;
  });
  for (const k of sorted) {
    const [nr, ch, v] = k.split(":").map(Number);
    const el = document.createElement("div");
    el.className = "list-item";
    const tags =
      (state.bookmarks[k] ? "★ " : "") +
      (state.highlights[k] ? "● " : "") +
      (state.notes[k] ? "✎ " : "");
    el.innerHTML =
      `<button class="r-del" title="삭제">&times;</button>` +
      `<div class="r-ref">${tags}${bookName(nr)} ${ch}:${v}</div>` +
      (state.notes[k] ? `<div class="r-note">${escapeHtml(state.notes[k])}</div>` : "");
    el.addEventListener("click", (e) => {
      if (e.target.classList.contains("r-del")) return;
      closeAll(); goChapter(nr, ch);
    });
    el.querySelector(".r-del").addEventListener("click", (e) => {
      e.stopPropagation();
      delete state.bookmarks[k]; delete state.highlights[k]; delete state.notes[k];
      store.set("bookmarks", state.bookmarks); store.set("highlights", state.highlights); store.set("notes", state.notes);
      el.remove(); render();
    });
    body.appendChild(el);
  }
  $("#list-panel").classList.remove("hidden");
}

// ── reading plan: 1-year sequential (chapters split across 365 days) ─────────
function buildPlan() {
  // All chapters in canonical order -> chunk into 365 near-equal days.
  const chapters = [];
  for (const b of state.books)
    for (let c = 1; c <= b.chapters; c++) chapters.push({ nr: b.nr, ch: c });
  const DAYS = 365;
  const per = chapters.length / DAYS;
  const plan = [];
  let i = 0;
  for (let d = 0; d < DAYS; d++) {
    const end = Math.round((d + 1) * per);
    plan.push(chapters.slice(i, end));
    i = end;
  }
  return plan;
}
function showPlan() {
  const plan = buildPlan();
  const done = state.planDone;
  const doneCount = Object.values(done).filter(Boolean).length;
  $("#list-title").textContent = `읽기 플랜 (1년 통독) · ${doneCount}/365`;
  const body = $("#list-body");
  body.innerHTML = `<div class="progress-wrap"><div class="progress-bar" style="width:${(doneCount / 365 * 100).toFixed(1)}%"></div></div>`;
  // jump near the first undone day
  const firstUndone = plan.findIndex((_, d) => !done[d]);
  plan.forEach((day, d) => {
    const label = day.length
      ? `${bookName(day[0].nr)} ${day[0].ch}${day.length > 1 ? "–" + (day[day.length - 1].nr === day[0].nr ? day[day.length - 1].ch : bookName(day[day.length - 1].nr) + " " + day[day.length - 1].ch) : ""}`
      : "";
    const row = document.createElement("div");
    row.className = "list-item plan-day" + (done[d] ? " done" : "");
    row.innerHTML =
      `<input type="checkbox" ${done[d] ? "checked" : ""}/>` +
      `<span class="pd-label"><b>Day ${d + 1}</b> · ${label}</span>`;
    row.querySelector("input").addEventListener("change", (e) => {
      if (e.target.checked) done[d] = true; else delete done[d];
      store.set("planDone", done);
      row.classList.toggle("done", e.target.checked);
      showPlan.refresh && showPlan.refresh();
    });
    row.querySelector(".pd-label").addEventListener("click", () => {
      closeAll(); goChapter(day[0].nr, day[0].ch);
    });
    body.appendChild(row);
  });
  $("#list-panel").classList.remove("hidden");
  // scroll to first undone
  if (firstUndone > 0) body.children[firstUndone + 1]?.scrollIntoView({ block: "center" });
}

// ── audio (Web Speech API) ──────────────────────────────────────────────────
let speaking = false;
function speakChapter() {
  if (!("speechSynthesis" in window)) { toast("이 브라우저는 음성 재생을 지원하지 않아요"); return; }
  if (speaking) { stopAudio(); return; }
  const lang = SPEAK_LANG[state.trans === "en" ? "en" : "ko"];
  const nodes = [...document.querySelectorAll("#verses .verse")];
  speaking = true;
  $("#btn-audio").innerHTML = "&#9632;"; // stop square
  let i = 0;
  const next = () => {
    if (!speaking || i >= nodes.length) { stopAudio(); return; }
    const node = nodes[i];
    nodes.forEach((n) => n.classList.remove("speaking"));
    node.classList.add("speaking");
    node.scrollIntoView({ block: "center", behavior: "smooth" });
    const text = node.childNodes[1]?.textContent || node.textContent;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang; u.rate = 0.95;
    u.onend = () => { i++; next(); };
    u.onerror = () => { i++; next(); };
    speechSynthesis.speak(u);
  };
  next();
}
function stopAudio() {
  speaking = false;
  try { speechSynthesis.cancel(); } catch {}
  $("#btn-audio").innerHTML = "&#9654;";
  document.querySelectorAll("#verses .verse.speaking").forEach((n) => n.classList.remove("speaking"));
}

// ── screen wake lock (화면 꺼짐 방지) ─────────────────────────────────────────
let wakeLock = null;
async function acquireWakeLock() {
  if (!state.keepAwake || !("wakeLock" in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request("screen");
    // The OS auto-releases the lock when the tab is hidden; re-acquire on
    // return (handled by the visibilitychange listener below).
    wakeLock.addEventListener("release", () => { wakeLock = null; });
  } catch { wakeLock = null; }
}
async function releaseWakeLock() {
  try { await wakeLock?.release(); } catch {}
  wakeLock = null;
}
function updateWakeLabel() {
  const b = $("#menu-wake");
  if (b) b.textContent = (state.keepAwake ? "☀ 화면 켜둠: 켜짐" : "☀ 화면 켜둠: 꺼짐");
}
async function toggleKeepAwake() {
  state.keepAwake = !state.keepAwake;
  store.set("keepAwake", state.keepAwake);
  updateWakeLabel();
  if (state.keepAwake) await acquireWakeLock(); else await releaseWakeLock();
  toast(state.keepAwake ? "화면이 꺼지지 않아요" : "화면 켜둠 해제");
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") acquireWakeLock();
});

// ── theme / font ────────────────────────────────────────────────────────────
function applyTheme(t) { document.documentElement.dataset.theme = t === "dark" ? "dark" : ""; store.set("theme", t); }
function toggleTheme() { applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"); }
function applyFont() {
  state.fontIdx = Math.max(0, Math.min(FONTS.length - 1, state.fontIdx));
  document.documentElement.style.setProperty("--reader-size", FONTS[state.fontIdx] + "rem");
  store.set("fontIdx", state.fontIdx);
}

// ── misc UI ─────────────────────────────────────────────────────────────────
function closeAll() {
  ["#drawer", "#search-panel", "#sheet", "#list-panel", "#menu", "#menu-scrim"].forEach((s) => $(s).classList.add("hidden"));
}
function toast(msg) {
  let t = $(".toast");
  if (!t) { t = document.createElement("div"); t.className = "toast"; document.body.appendChild(t); }
  t.textContent = msg; t.classList.add("show");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), 1500);
}
function escapeHtml(s) { return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
function escapeReg(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

function wireUI() {
  $("#btn-toc").onclick = openTOC;
  $("#btn-ref").onclick = openTOC;
  $("#toc-close").onclick = closeAll;
  document.querySelectorAll("[data-close]").forEach((e) => e.onclick = closeAll);
  document.querySelectorAll(".toc-tab").forEach((tab) => tab.onclick = () => {
    document.querySelectorAll(".toc-tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active"); tocTestament = tab.dataset.t; buildBookGrid();
    $("#chapter-grid").classList.add("hidden"); $("#book-grid").classList.remove("hidden");
  });

  $("#btn-prev").onclick = () => step(-1);
  $("#btn-next").onclick = () => step(1);

  $("#btn-trans").onclick = () => {
    const i = TRANS_ORDER.indexOf(state.trans);
    state.trans = TRANS_ORDER[(i + 1) % TRANS_ORDER.length];
    store.set("trans", state.trans); render();
  };

  $("#btn-search").onclick = () => { $("#search-panel").classList.remove("hidden"); $("#search-input").focus(); };
  $("#search-close").onclick = closeAll;
  $("#search-input").oninput = onSearchInput;

  // sheet
  document.querySelectorAll(".hl-swatch").forEach((b) => b.onclick = () => setHighlight(b.dataset.color));
  $("#act-bookmark").onclick = toggleBookmark;
  $("#act-note").onclick = () => { $("#note-input").classList.remove("hidden"); $("#note-save-row").classList.remove("hidden"); $("#note-input").focus(); };
  $("#note-save").onclick = saveNote;
  $("#act-copy").onclick = copyVerse;

  // audio
  $("#btn-audio").onclick = speakChapter;

  // menu
  $("#btn-menu").onclick = () => { $("#menu").classList.toggle("hidden"); $("#menu-scrim").classList.toggle("hidden"); };
  $("#list-close").onclick = closeAll;
  document.querySelectorAll("#menu button").forEach((b) => b.onclick = () => {
    const a = b.dataset.menu;
    $("#menu").classList.add("hidden"); $("#menu-scrim").classList.add("hidden");
    if (a === "bookmarks") showSaved();
    else if (a === "plan") showPlan();
    else if (a === "wake") toggleKeepAwake();
    else if (a === "dark") toggleTheme();
    else if (a === "font-up") { state.fontIdx++; applyFont(); render(); }
    else if (a === "font-down") { state.fontIdx--; applyFont(); render(); }
  });

  // keyboard nav (desktop)
  document.addEventListener("keydown", (e) => {
    if (document.querySelector(".panel:not(.hidden), .drawer:not(.hidden)")) return;
    if (e.key === "ArrowRight") step(1);
    if (e.key === "ArrowLeft") step(-1);
  });
}

function registerSW() {
  if ("serviceWorker" in navigator)
    navigator.serviceWorker.register("sw.js").catch(() => {});
}

boot();
