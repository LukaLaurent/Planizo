(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const SVGNS = "http://www.w3.org/2000/svg";

  const FORMAT = "site-plan";
  const VERSION = 1;
  const MIN_SIZE = 200;
  const MAX_SIZE = 10000;
  const SNAP = 10;
  const HISTORY_MAX = 60;
  const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
  const IMAGE_RE = /^data:image\/(png|jpeg|gif|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/;
  const COLOR_RE = /^#[0-9a-f]{6}$/i;
  const ID_RE = /^[\w-]{1,40}$/;
  const DRAW_TOOLS = ["pencil", "rect", "ellipse", "line"];
  const OBJECT_TYPES = ["path", "rect", "ellipse", "line", "text", "image"];
  const DEG = Math.PI / 180;

  const state = {
    lang: "fr",
    mode: "home",
    plan: null,
    fileName: null,
    fileHandle: null,
    dirty: false,
    tool: "select",
    selection: [],
    panelOpen: true,
    style: { stroke: "#1f2b33", fill: "#e8a317", fillOn: false, width: 2, fontSize: 18 },
    undo: [],
    redo: [],
    view: { z: 1, x: 0, y: 0 },
    viewVisible: new Map(),
    prefs: { highlight: true, tooltips: true, pin: true, bg: null }
  };

  const uuid = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID() : newId("p"));

  let idCounter = 0;
  function newId(prefix) {
    idCounter += 1;
    return prefix + Date.now().toString(36) + idCounter.toString(36);
  }

  const round = (n) => Math.round(n * 10) / 10;
  const isNum = (v) => typeof v === "number" && Number.isFinite(v);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const fmt = (n) => String(Math.round(n));

  function t(key, vars) {
    let s = (I18N[state.lang] && I18N[state.lang][key]) || I18N.fr[key] || key;
    if (vars) Object.keys(vars).forEach((k) => { s = s.split("{" + k + "}").join(String(vars[k])); });
    return s;
  }

  function typeLabel(o) {
    return t("type_" + o.type);
  }

  function applyLang() {
    document.documentElement.lang = state.lang;
    document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
    document.querySelectorAll("[data-i18n-title]").forEach((el) => {
      el.title = t(el.dataset.i18nTitle);
      el.setAttribute("aria-label", el.title);
    });
    document.querySelectorAll("[data-i18n-aria]").forEach((el) => el.setAttribute("aria-label", t(el.dataset.i18nAria)));
    document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });
    $("langSwitch").setAttribute("aria-checked", String(state.lang === "en"));
    renderPlanName();
    if (state.plan) {
      renderLayers();
      renderViewLayers();
      renderMarkers();
      renderStatus();
    }
  }

  function initLang() {
    let saved = null;
    try { saved = localStorage.getItem("lang"); } catch (e) {}
    if (saved === "fr" || saved === "en") state.lang = saved;
    else state.lang = (navigator.language || "fr").toLowerCase().startsWith("fr") ? "fr" : "en";
    applyLang();
  }

  function applyTheme(dark) {
    document.body.classList.toggle("dark", dark);
    $("themeSwitch").setAttribute("aria-checked", String(dark));
  }
  function initTheme() {
    let saved = null;
    try { saved = localStorage.getItem("planizo:theme"); } catch (e) {}
    const dark = saved ? saved === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
    applyTheme(dark);
  }
  $("themeSwitch").addEventListener("click", () => {
    const dark = !document.body.classList.contains("dark");
    applyTheme(dark);
    try { localStorage.setItem("planizo:theme", dark ? "dark" : "light"); } catch (e) {}
  });

  $("langSwitch").addEventListener("click", () => {
    state.lang = state.lang === "fr" ? "en" : "fr";
    try { localStorage.setItem("lang", state.lang); } catch (e) {}
    applyLang();
  });

  let toastTimer = null;
  function toast(msg) {
    const el = $("toast");
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 4500);
  }

  function setMode(mode) {
    closeTextInput(true);
    closeContextMenu();
    hideHover();
    state.mode = mode;
    document.body.classList.remove("mode-home", "mode-edit", "mode-view");
    document.body.classList.add("mode-" + mode);
    $("home").hidden = mode !== "home";
    $("editor").hidden = mode === "home";
    $("tools").hidden = mode === "home";
    if (mode === "view" && state.plan) {
      state.viewVisible = new Map(state.plan.layers.map((l) => [l.id, l.visible]));
    }
    renderPlanName();
    if (mode !== "home") {
      state.selection = [];
      setTool("select");
      renderAll();
      applyView();
    }
  }

  function renderPlanName() {
    const el = $("planName");
    const name = state.plan && state.plan.name;
    el.textContent = name || t("untitled");
    el.classList.toggle("untitled", !name);
    el.title = state.mode === "edit" ? t("renamePlan") : "";
    document.title = state.plan && state.mode !== "home" ? (name || t("untitled")) + " · Planizo" : "Planizo";
  }

  $("planName").addEventListener("click", () => {
    if (state.mode !== "edit" || !state.plan) return;
    const btn = $("planName");
    const input = document.createElement("input");
    input.type = "text";
    input.className = "plan-name-input";
    input.value = state.plan.name || "";
    input.placeholder = t("untitled");
    input.maxLength = 80;
    input.setAttribute("aria-label", t("renamePlan"));
    btn.hidden = true;
    btn.after(input);
    input.focus();
    input.select();

    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      const value = input.value.trim().slice(0, 80);
      input.remove();
      btn.hidden = false;
      if (save && value && value !== state.plan.name) {
        const before = snapshot();
        state.plan.name = value;
        pushHistory(before);
      }
      renderPlanName();
      btn.focus();
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); finish(true); }
      else if (e.key === "Escape") { e.preventDefault(); finish(false); }
    });
    input.addEventListener("blur", () => finish(true));
  });

  function layerShown(layer) {
    if (state.mode !== "view" || layer.toggleable === false) return layer.visible;
    return state.viewVisible.get(layer.id) !== false;
  }

  function resetCanvas() {
    canvas.replaceChildren();
    elCache.clear();
    groupCache.clear();
  }

  function goHome() {
    if (state.dirty && !confirm(t("confirmLeave"))) return;
    closeTextInput(false);
    state.plan = null;
    state.fileName = null;
    state.fileHandle = null;
    state.dirty = false;
    state.undo = [];
    state.redo = [];
    resetCanvas();
    hideError();
    clearLink();
    setMode("home");
  }

  $("brand").addEventListener("click", () => { if (state.mode !== "home") goHome(); });
  $("previewBtn").addEventListener("click", () => setMode("view"));
  $("editBtn").addEventListener("click", () => setMode("edit"));

  window.addEventListener("beforeunload", (e) => {
    if (state.dirty) { e.preventDefault(); e.returnValue = ""; }
  });

  function setPanel(open) {
    state.panelOpen = open;
    $("sidebarWrap").hidden = !open;
    $("sidebarOpen").hidden = open;
    $("panelToggle").setAttribute("aria-pressed", String(open));
    renderLayerDock();
  }
  $("panelToggle").addEventListener("click", () => setPanel(!state.panelOpen));
  $("sidebarClose").addEventListener("click", () => setPanel(false));
  $("sidebarOpen").addEventListener("click", () => setPanel(true));

  function activeIndex() {
    return state.plan.layers.findIndex((l) => l.id === state.plan.activeLayerId);
  }
  function activeLayer() {
    return state.plan.layers[activeIndex()] || null;
  }
  function findObject(id) {
    if (!id || !state.plan) return null;
    for (const layer of state.plan.layers) {
      const index = layer.objects.findIndex((o) => o.id === id);
      if (index >= 0) return { layer, obj: layer.objects[index], index };
    }
    return null;
  }

  function nextLayerName() {
    const base = t("layerDefault");
    const names = new Set(state.plan.layers.map((l) => l.name));
    let n = 1;
    while (names.has(base + " " + n)) n += 1;
    return base + " " + n;
  }

  function addLayer(name, atBottom) {
    const layer = { id: newId("l"), name: name || nextLayerName(), visible: true, locked: false, objects: [] };
    const layers = state.plan.layers;
    if (atBottom) layers.push(layer);
    else layers.splice(Math.max(0, activeIndex()), 0, layer);
    state.plan.activeLayerId = layer.id;
    return layer;
  }

  function requireDrawableLayer() {
    let layer = activeLayer();
    if (!layer) {
      if (state.plan.layers.length) {
        layer = state.plan.layers[0];
        state.plan.activeLayerId = layer.id;
      } else {
        layer = addLayer();
      }
    }
    if (!layer.visible) { toast(t("layerHidden")); return null; }
    if (layer.locked) { toast(t("layerLocked")); return null; }
    return layer;
  }

  function cloneObj(o) {
    const c = { ...o };
    if (o.points) c.points = o.points.map((p) => p.slice());
    return c;
  }

  function snapshot() {
    const p = state.plan;
    return {
      name: p.name,
      width: p.width,
      height: p.height,
      activeLayerId: p.activeLayerId,
      layers: p.layers.map((l) => ({ ...l, objects: l.objects.map(cloneObj) }))
    };
  }

  function pushHistory(before) {
    state.undo.push(before);
    if (state.undo.length > HISTORY_MAX) state.undo.shift();
    state.redo = [];
    state.dirty = true;
    renderHistoryButtons();
  }

  function restore(snap) {
    const current = new Map(state.plan.layers.map((l) => [l.id, l]));
    snap.layers.forEach((l) => {
      const c = current.get(l.id);
      if (c) { l.visible = c.visible; l.locked = c.locked; }
    });
    state.plan.name = snap.name;
    renderPlanName();
    state.plan.width = snap.width;
    state.plan.height = snap.height;
    state.plan.activeLayerId = snap.activeLayerId;
    state.plan.layers = snap.layers;
    state.dirty = true;
    renderAll();
  }

  function undo() {
    if (!state.undo.length) return;
    closeTextInput(false);
    state.redo.push(snapshot());
    restore(state.undo.pop());
  }
  function redo() {
    if (!state.redo.length) return;
    closeTextInput(false);
    state.undo.push(snapshot());
    restore(state.redo.pop());
  }

  $("undoBtn").addEventListener("click", undo);
  $("redoBtn").addEventListener("click", redo);

  function clampSize(v) {
    const n = Math.round(Number(v) / SNAP) * SNAP;
    if (!Number.isFinite(n)) return null;
    return clamp(n, MIN_SIZE, MAX_SIZE);
  }

  const rot = (o) => o.rotation || 0;
  const centerOf = (b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

  function rotatePoint(p, c, deg) {
    const a = deg * DEG, cos = Math.cos(a), sin = Math.sin(a);
    const dx = p.x - c.x, dy = p.y - c.y;
    return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
  }

  function normalizeAngle(deg) {
    const r = ((deg % 360) + 540) % 360 - 180;
    return Math.round(r * 10) / 10;
  }

  function setRotation(o, deg) {
    const r = normalizeAngle(deg);
    if (r === 0) delete o.rotation;
    else o.rotation = r;
  }

  function getBox(o) {
    switch (o.type) {
      case "rect":
      case "ellipse":
      case "image":
        return { x: o.x, y: o.y, w: o.w, h: o.h };
      case "line":
        return { x: Math.min(o.x1, o.x2), y: Math.min(o.y1, o.y2), w: Math.abs(o.x2 - o.x1), h: Math.abs(o.y2 - o.y1) };
      case "path": {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const [x, y] of o.points) {
          if (x < x0) x0 = x; if (y < y0) y0 = y;
          if (x > x1) x1 = x; if (y > y1) y1 = y;
        }
        return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
      }
      case "text": {
        const el = elCache.get(o.id);
        if (el && el.isConnected) {
          try {
            const b = el.getBBox();
            if (b.width || b.height) return { x: b.x, y: b.y, w: b.width, h: b.height };
          } catch (e) {}
        }
        return { x: o.x, y: o.y, w: o.text.length * o.size * 0.55, h: o.size * 1.2 };
      }
    }
    return { x: 0, y: 0, w: 0, h: 0 };
  }

  function worldBox(o) {
    const b = getBox(o);
    const r = rot(o);
    if (!r) return b;
    const c = centerOf(b);
    const pts = [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]]
      .map(([x, y]) => rotatePoint({ x, y }, c, r));
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const x = Math.min(...xs), y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }

  function isOffSheet(o) {
    const b = worldBox(o);
    const P = state.plan;
    return b.x + b.w < 0 || b.y + b.h < 0 || b.x > P.width || b.y > P.height;
  }

  function distToSegment(p, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const len = dx * dx + dy * dy;
    let u = len ? ((p.x - ax) * dx + (p.y - ay) * dy) / len : 0;
    u = clamp(u, 0, 1);
    return Math.hypot(ax + u * dx - p.x, ay + u * dy - p.y);
  }

  function hitObject(o, point) {
    const tol = 6;
    const b = getBox(o);
    const p = rot(o) ? rotatePoint(point, centerOf(b), -rot(o)) : point;
    if (o.type === "line") {
      return distToSegment(p, o.x1, o.y1, o.x2, o.y2) <= Math.max(tol, o.width / 2 + 3);
    }
    if (o.type === "path") {
      const pts = o.points;
      const limit = Math.max(tol, o.width / 2 + 3);
      if (pts.length === 1) return Math.hypot(pts[0][0] - p.x, pts[0][1] - p.y) <= limit;
      for (let i = 1; i < pts.length; i++) {
        if (distToSegment(p, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]) <= limit) return true;
      }
      return false;
    }
    return p.x >= b.x - tol && p.x <= b.x + b.w + tol && p.y >= b.y - tol && p.y <= b.y + b.h + tol;
  }

  function hitTest(p) {
    for (const layer of state.plan.layers) {
      if (!layer.visible || layer.locked) continue;
      for (let i = layer.objects.length - 1; i >= 0; i--) {
        const o = layer.objects[i];
        if (!isOffSheet(o) && hitObject(o, p)) return { layer, obj: o };
      }
    }
    return null;
  }

  function hitInfo(p) {
    for (const layer of state.plan.layers) {
      if (!layerShown(layer)) continue;
      for (let i = layer.objects.length - 1; i >= 0; i--) {
        const o = layer.objects[i];
        if ((o.name || o.note) && !isOffSheet(o) && hitObject(o, p)) return o;
      }
    }
    return null;
  }

  function translateObj(o, orig, dx, dy) {
    switch (o.type) {
      case "rect": case "ellipse": case "image": case "text":
        o.x = round(orig.x + dx); o.y = round(orig.y + dy); break;
      case "line":
        o.x1 = round(orig.x1 + dx); o.y1 = round(orig.y1 + dy);
        o.x2 = round(orig.x2 + dx); o.y2 = round(orig.y2 + dy); break;
      case "path":
        o.points = orig.points.map(([x, y]) => [round(x + dx), round(y + dy)]); break;
    }
  }

  function scaleObj(o, orig, b0, b1) {
    const sx = b0.w ? b1.w / b0.w : 1;
    const sy = b0.h ? b1.h / b0.h : 1;
    const mx = (x) => round(b1.x + (x - b0.x) * sx);
    const my = (y) => round(b1.y + (y - b0.y) * sy);
    switch (o.type) {
      case "rect": case "ellipse": case "image":
        o.x = round(b1.x); o.y = round(b1.y); o.w = round(b1.w); o.h = round(b1.h); break;
      case "line":
        o.x1 = mx(orig.x1); o.y1 = my(orig.y1); o.x2 = mx(orig.x2); o.y2 = my(orig.y2); break;
      case "path":
        o.points = orig.points.map(([x, y]) => [mx(x), my(y)]); break;
      case "text":
        o.size = Math.max(4, Math.round(orig.size * sy));
        o.x = round(orig.x + (b1.x - b0.x));
        o.y = round(orig.y + (b1.y - b0.y));
        break;
    }
  }

  const canvas = $("canvas");
  const elCache = new Map();
  const groupCache = new Map();

  function setAttrs(el, attrs) {
    for (const k in attrs) el.setAttribute(k, attrs[k]);
  }

  function pathData(pts) {
    if (!pts.length) return "";
    let d = "M" + pts[0][0] + " " + pts[0][1];
    if (pts.length === 1) d += " L" + pts[0][0] + " " + pts[0][1];
    for (let i = 1; i < pts.length; i++) d += " L" + pts[i][0] + " " + pts[i][1];
    return d;
  }

  function createEl(o) {
    const el = document.createElementNS(SVGNS, o.type);
    if (o.type === "path" || o.type === "line") {
      setAttrs(el, { "stroke-linecap": "round", "stroke-linejoin": "round", fill: "none" });
    } else if (o.type === "text") {
      setAttrs(el, { "dominant-baseline": "hanging", "font-family": getComputedStyle(document.body).fontFamily });
    } else if (o.type === "image") {
      el.setAttribute("preserveAspectRatio", "none");
    }
    return el;
  }

  function updateEl(el, o) {
    switch (o.type) {
      case "path":
        setAttrs(el, { d: pathData(o.points), stroke: o.stroke, "stroke-width": o.width }); break;
      case "rect":
        setAttrs(el, { x: o.x, y: o.y, width: o.w, height: o.h, stroke: o.stroke, "stroke-width": o.width, fill: o.fill || "none" }); break;
      case "ellipse":
        setAttrs(el, { cx: o.x + o.w / 2, cy: o.y + o.h / 2, rx: o.w / 2, ry: o.h / 2, stroke: o.stroke, "stroke-width": o.width, fill: o.fill || "none" }); break;
      case "line":
        setAttrs(el, { x1: o.x1, y1: o.y1, x2: o.x2, y2: o.y2, stroke: o.stroke, "stroke-width": o.width }); break;
      case "text":
        setAttrs(el, { x: o.x, y: o.y, "font-size": o.size, fill: o.color });
        if (el.textContent !== o.text) el.textContent = o.text;
        break;
      case "image":
        setAttrs(el, { x: o.x, y: o.y, width: o.w, height: o.h });
        if (el.__src !== o.src) { el.__src = o.src; el.setAttribute("href", o.src); }
        break;
    }
    const r = rot(o);
    if (r) {
      const c = centerOf(getBox(o));
      el.setAttribute("transform", "rotate(" + r + " " + round(c.x) + " " + round(c.y) + ")");
    } else {
      el.removeAttribute("transform");
    }
  }

  function placeChild(parent, child, index) {
    if (parent.childNodes[index] !== child) parent.insertBefore(child, parent.childNodes[index] || null);
  }

  function renderCanvas() {
    const liveObjects = new Set();
    const liveLayers = new Set();
    const layers = state.plan.layers;
    let gIndex = 0;

    for (let i = layers.length - 1; i >= 0; i--) {
      const layer = layers[i];
      liveLayers.add(layer.id);
      let g = groupCache.get(layer.id);
      if (!g) { g = document.createElementNS(SVGNS, "g"); groupCache.set(layer.id, g); }
      g.style.display = layerShown(layer) ? "" : "none";
      placeChild(canvas, g, gIndex++);

      layer.objects.forEach((o, j) => {
        let el = elCache.get(o.id);
        if (!el) { el = createEl(o); elCache.set(o.id, el); }
        placeChild(g, el, j);
        updateEl(el, o);
        liveObjects.add(o.id);
      });
    }

    for (const [id, el] of elCache) if (!liveObjects.has(id)) { el.remove(); elCache.delete(id); }
    for (const [id, g] of groupCache) if (!liveLayers.has(id)) { g.remove(); groupCache.delete(id); }

    renderSelection();
    renderMarkers();
  }

  let renderQueued = false;
  function requestRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      if (state.plan) renderCanvas();
    });
  }

  function placeBox(box, o, pad) {
    const b = getBox(o);
    box.style.left = (b.x - pad) + "px";
    box.style.top = (b.y - pad) + "px";
    box.style.width = (b.w + pad * 2) + "px";
    box.style.height = (b.h + pad * 2) + "px";
    box.style.transform = rot(o) ? "rotate(" + rot(o) + "deg)" : "";
  }

  function renderSelection() {
    const box = $("selection");
    const fs = state.plan ? selectionFound() : [];
    state.selection = fs.map((f) => f.obj.id);
    if (!fs.length || state.mode !== "edit") {
      box.hidden = true;
      renderStatus();
      return;
    }
    if (fs.length === 1) {
      placeBox(box, fs[0].obj, 4 + (fs[0].obj.width ? fs[0].obj.width / 2 : 0));
    } else {
      const u = unionBox(fs.map((f) => f.obj));
      const pad = 6;
      box.style.left = (u.x - pad) + "px";
      box.style.top = (u.y - pad) + "px";
      box.style.width = (u.w + pad * 2) + "px";
      box.style.height = (u.h + pad * 2) + "px";
      box.style.transform = "";
    }
    box.classList.toggle("multi", fs.length > 1);
    box.hidden = false;
    renderStatus();
  }

  const ARROWS = { "-1,-1": "↖", "0,-1": "↑", "1,-1": "↗", "-1,0": "←", "1,0": "→", "-1,1": "↙", "0,1": "↓", "1,1": "↘" };

  const markerEls = new Map();

  function renderMarkers() {
    const box = $("markers");
    const live = new Set();
    if (state.mode === "edit" && state.plan) {
      const W = state.plan.width, H = state.plan.height;
      state.plan.layers.forEach((layer) => {
        if (!layer.visible || layer.locked) return;
        layer.objects.forEach((o) => {
          if (!isOffSheet(o)) return;
          const c = centerOf(worldBox(o));
          const sx = c.x < 0 ? -1 : c.x > W ? 1 : 0;
          const sy = c.y < 0 ? -1 : c.y > H ? 1 : 0;
          let m = markerEls.get(o.id);
          if (!m) {
            m = document.createElement("button");
            m.type = "button";
            m.dataset.id = o.id;
            markerEls.set(o.id, m);
            box.appendChild(m);
          }
          live.add(o.id);
          m.className = "marker" + (isSelected(o.id) ? " selected" : "");
          m.textContent = (ARROWS[sx + "," + sy] || "•") + " " + (o.name || typeLabel(o));
          m.title = t("markerTitle", { layer: layer.name });
          m.style.left = clamp(c.x, 4, W - 4) + "px";
          m.style.top = clamp(c.y, 4, H - 4) + "px";
          m.style.transform = "translate(" + (sx < 0 ? "0" : sx > 0 ? "-100%" : "-50%") + "," + (sy < 0 ? "0" : sy > 0 ? "-100%" : "-50%") + ")";
        });
      });
    }
    for (const [id, m] of markerEls) if (!live.has(id)) { m.remove(); markerEls.delete(id); }
  }

  $("markers").addEventListener("click", (e) => {
    const m = e.target.closest(".marker");
    if (m) selectObject(m.dataset.id, e.ctrlKey || e.metaKey || e.shiftKey);
  });
  $("markers").addEventListener("dblclick", (e) => {
    const m = e.target.closest(".marker");
    if (m) { selectObject(m.dataset.id); bringBack(); }
  });
  $("markers").addEventListener("contextmenu", (e) => {
    const m = e.target.closest(".marker");
    if (!m) return;
    e.preventDefault();
    openContextMenu(m.dataset.id, e.clientX, e.clientY);
  });

  function renderSheet() {
    const p = state.plan;
    const sheet = $("sheet");
    sheet.style.width = p.width + "px";
    sheet.style.height = p.height + "px";
    setAttrs(canvas, { width: p.width, height: p.height, viewBox: "0 0 " + p.width + " " + p.height });
    $("gridOverlay").hidden = !p.grid || state.mode === "view";
    $("gridToggle").checked = p.grid;
  }

  function renderHistoryButtons() {
    $("undoBtn").disabled = !state.undo.length;
    $("redoBtn").disabled = !state.redo.length;
  }

  function renderAll() {
    renderSheet();
    renderCanvas();
    renderLayers();
    renderViewLayers();
    renderHistoryButtons();
  }

  function statusPart(label, value) {
    const span = document.createElement("span");
    const k = document.createElement("span");
    k.className = "k";
    k.textContent = label;
    span.append(k, value);
    return span;
  }

  function renderStatus() {
    if (!state.plan) return;
    $("statusSheet").textContent = t("statusSheet", { w: state.plan.width, h: state.plan.height });

    const sel = $("statusSel");
    sel.replaceChildren();
    const fs = selectionFound();
    if (!fs.length || state.mode !== "edit") return;
    if (fs.length > 1) {
      const u = unionBox(fs.map((f) => f.obj));
      const g = fs[0].obj.group;
      const title = document.createElement("b");
      title.textContent = t(g && fs.every((f) => f.obj.group === g) ? "statusGroup" : "statusMulti", { n: fs.length });
      sel.append(
        title,
        statusPart(t("statusPos"), "x " + fmt(u.x) + "  y " + fmt(u.y)),
        statusPart(t("statusSize"), fmt(u.w) + " × " + fmt(u.h))
      );
      return;
    }
    const found = fs[0];
    const o = found.obj;
    const b = getBox(o);
    const title = document.createElement("b");
    title.textContent = o.name ? o.name + " (" + typeLabel(o) + ")" : typeLabel(o);
    sel.append(
      title,
      statusPart(t("statusPos"), "x " + fmt(b.x) + "  y " + fmt(b.y)),
      statusPart(t("statusSize"), fmt(b.w) + " × " + fmt(b.h))
    );
    if (rot(o)) sel.append(statusPart(t("statusRotation"), rot(o) + "°"));
    sel.append(statusPart(t("statusLayer"), found.layer.name));
  }

  $("workspace").addEventListener("pointermove", (e) => {
    if (!state.plan) return;
    const p = toSheet(e);
    $("statusMouse").textContent = t("statusMouse", { x: fmt(p.x), y: fmt(p.y) });
  });
  $("workspace").addEventListener("pointerleave", () => { $("statusMouse").textContent = ""; });

  const ICONS = {
    eye: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    eyeOff: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><path d="M4 4l16 16"/></svg>',
    lock: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="1"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
    toggle: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="m8 12 3 3 5-6"/></svg>',
    pinned: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4h6l-1 6 3 3H7l3-3zM12 13v7"/></svg>'
  };

  function iconButton(svg, label, action, pressed) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "icon-btn " + action;
    b.dataset.action = action;
    b.innerHTML = svg;
    b.title = label;
    b.setAttribute("aria-label", label);
    b.setAttribute("aria-pressed", String(pressed));
    return b;
  }

  function renderLayers() {
    if (!state.plan) return;
    const list = $("layerList");
    list.replaceChildren();
    const layers = state.plan.layers;

    if (!layers.length) {
      const li = document.createElement("li");
      li.className = "layer-empty";
      li.textContent = t("noLayers");
      list.appendChild(li);
    }

    layers.forEach((layer) => {
      const li = document.createElement("li");
      li.className = "layer" + (layer.id === state.plan.activeLayerId ? " active" : "") + (layer.visible ? "" : " hidden-layer");
      li.dataset.id = layer.id;

      const vis = iconButton(layer.visible ? ICONS.eye : ICONS.eyeOff, t("showLayer"), "vis", layer.visible);
      const tog = layer.toggleable !== false;
      const view = iconButton(tog ? ICONS.toggle : ICONS.pinned, t(tog ? "toggleableOn" : "toggleableOff"), "toggleable", tog);

      const name = document.createElement("button");
      name.type = "button";
      name.className = "layer-name";
      name.dataset.action = "activate";
      name.textContent = layer.name;
      name.title = layer.name;

      const count = document.createElement("span");
      count.className = "layer-count";
      count.textContent = layer.objects.length;
      count.title = t("objectCount", { n: layer.objects.length });

      li.append(vis, view, name);
      if (layer.locked) {
        const lk = document.createElement("span");
        lk.className = "layer-lock";
        lk.innerHTML = ICONS.lock;
        lk.title = t("lockedBadge");
        li.appendChild(lk);
      }
      li.appendChild(count);
      list.appendChild(li);
    });

    const idx = activeIndex();
    $("layerUpBtn").disabled = idx <= 0;
    $("layerDownBtn").disabled = idx < 0 || idx >= layers.length - 1;
    $("layerRenameBtn").disabled = idx < 0;
    $("layerDeleteBtn").disabled = idx < 0;
  }

  $("layerList").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    const li = e.target.closest("li[data-id]");
    if (!btn || !li) return;
    const layer = state.plan.layers.find((l) => l.id === li.dataset.id);
    if (!layer) return;

    if (btn.dataset.action === "vis") {
      layer.visible = !layer.visible;
      state.dirty = true;
      renderCanvas();
    } else if (btn.dataset.action === "toggleable") {
      const before = snapshot();
      if (layer.toggleable === false) delete layer.toggleable;
      else layer.toggleable = false;
      pushHistory(before);
    } else if (btn.dataset.action === "activate") {
      state.plan.activeLayerId = layer.id;
    }
    renderLayers();
  });

  function toggleLock(layer) {
    layer.locked = !layer.locked;
    state.dirty = true;
    renderSelection();
    renderMarkers();
    renderLayers();
  }

  $("layerList").addEventListener("contextmenu", (e) => {
    const li = e.target.closest("li[data-id]");
    if (!li) return;
    e.preventDefault();
    const layer = state.plan.layers.find((l) => l.id === li.dataset.id);
    if (!layer) return;
    state.plan.activeLayerId = layer.id;
    renderLayers();
    const tog = layer.toggleable !== false;
    openMenu([
      { label: t("rename"), fn: () => startRename(layer.id) },
      { label: t(layer.locked ? "unlockLayer" : "lockLayerAction"), fn: () => toggleLock(layer) },
      { label: t(tog ? "makePinned" : "makeToggleable"), fn: () => {
        const before = snapshot();
        if (tog) layer.toggleable = false; else delete layer.toggleable;
        pushHistory(before);
        renderLayers();
      } },
      "sep",
      { label: t("moveUp"), fn: () => moveLayer(-1), disabled: activeIndex() <= 0 },
      { label: t("moveDown"), fn: () => moveLayer(1), disabled: activeIndex() >= state.plan.layers.length - 1 },
      "sep",
      { label: t("deleteLayer"), fn: () => $("layerDeleteBtn").click(), danger: true }
    ], e.clientX, e.clientY);
  });

  $("layerList").addEventListener("dblclick", (e) => {
    const li = e.target.closest("li[data-id]");
    if (li && e.target.closest(".layer-name")) startRename(li.dataset.id);
  });

  function startRename(layerId) {
    const layer = state.plan.layers.find((l) => l.id === layerId);
    const li = $("layerList").querySelector('li[data-id="' + layerId + '"]');
    if (!layer || !li) return;
    const nameBtn = li.querySelector(".layer-name");
    const input = document.createElement("input");
    input.type = "text";
    input.className = "layer-rename";
    input.value = layer.name;
    input.maxLength = 60;
    nameBtn.replaceWith(input);
    input.focus();
    input.select();

    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      const value = input.value.trim();
      if (save && value && value !== layer.name) {
        const before = snapshot();
        layer.name = value;
        pushHistory(before);
      }
      renderLayers();
      renderStatus();
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") finish(true);
      else if (e.key === "Escape") finish(false);
    });
    input.addEventListener("blur", () => finish(true));
  }

  $("addLayerBtn").addEventListener("click", () => {
    const before = snapshot();
    addLayer();
    pushHistory(before);
    renderLayers();
  });

  function moveLayer(delta) {
    const layers = state.plan.layers;
    const i = activeIndex();
    const j = i + delta;
    if (i < 0 || j < 0 || j >= layers.length) return;
    const before = snapshot();
    [layers[i], layers[j]] = [layers[j], layers[i]];
    pushHistory(before);
    renderCanvas();
    renderLayers();
  }
  $("layerUpBtn").addEventListener("click", () => moveLayer(-1));
  $("layerDownBtn").addEventListener("click", () => moveLayer(1));
  $("layerRenameBtn").addEventListener("click", () => {
    const layer = activeLayer();
    if (layer) startRename(layer.id);
  });

  $("layerDeleteBtn").addEventListener("click", () => {
    const i = activeIndex();
    if (i < 0) return;
    const layer = state.plan.layers[i];
    if (layer.objects.length && !confirm(t("confirmDeleteLayer", { name: layer.name, n: layer.objects.length }))) return;
    const before = snapshot();
    state.plan.layers.splice(i, 1);
    const next = state.plan.layers[Math.min(i, state.plan.layers.length - 1)];
    state.plan.activeLayerId = next ? next.id : null;
    pushHistory(before);
    renderCanvas();
    renderLayers();
  });

  function renderViewLayers() {
    if (!state.plan) return;
    const list = $("viewLayerList");
    list.replaceChildren();
    const layers = state.plan.layers.filter((l) => l.toggleable !== false);
    if (!layers.length) {
      const li = document.createElement("li");
      li.className = "view-empty";
      li.textContent = t("noToggleable");
      list.appendChild(li);
    }
    layers.forEach((layer) => {
      const li = document.createElement("li");
      const label = document.createElement("label");
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = layerShown(layer);
      box.dataset.id = layer.id;
      const name = document.createElement("span");
      name.textContent = layer.name;
      label.append(box, name);
      li.appendChild(label);
      list.appendChild(li);
    });
    renderLayerDock();
  }

  function renderLayerDock() {
    const dock = $("layerDock");
    const layers = state.plan ? state.plan.layers.filter((l) => l.toggleable !== false) : [];
    const show = state.mode === "view" && !state.panelOpen && state.prefs.pin && layers.length > 0;
    dock.hidden = !show;
    dock.replaceChildren();
    if (!show) return;
    layers.slice().reverse().forEach((layer) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "dock-btn";
      b.dataset.id = layer.id;
      b.title = layer.name;
      b.setAttribute("aria-pressed", String(layerShown(layer)));
      const name = document.createElement("span");
      name.textContent = layer.name;
      b.appendChild(name);
      dock.appendChild(b);
    });
  }

  $("layerDock").addEventListener("click", (e) => {
    const b = e.target.closest(".dock-btn");
    if (!b) return;
    const layer = state.plan.layers.find((l) => l.id === b.dataset.id);
    if (!layer) return;
    state.viewVisible.set(layer.id, !layerShown(layer));
    hideHover();
    renderCanvas();
    renderViewLayers();
  });

  $("viewLayerList").addEventListener("change", (e) => {
    const layer = state.plan.layers.find((l) => l.id === e.target.dataset.id);
    if (!layer) return;
    state.viewVisible.set(layer.id, e.target.checked);
    hideHover();
    renderCanvas();
    renderLayerDock();
  });

  function setAllVisible(on) {
    state.plan.layers.forEach((l) => { if (l.toggleable !== false) state.viewVisible.set(l.id, on); });
    hideHover();
    renderCanvas();
    renderViewLayers();
  }
  $("showAllBtn").addEventListener("click", () => setAllVisible(true));
  $("hideAllBtn").addEventListener("click", () => setAllVisible(false));

  const tooltip = $("tooltip");
  let hoveredId = null;

  function hideHover() {
    hoveredId = null;
    tooltip.hidden = true;
    $("hoverBox").hidden = true;
  }

  function updateHover(e) {
    const prefs = state.prefs;
    const o = (prefs.highlight || prefs.tooltips) && !action ? hitInfo(toSheet(e)) : null;
    if (!o) { hideHover(); return; }
    if (o.id !== hoveredId) {
      hoveredId = o.id;
      $("tooltipName").textContent = o.name || typeLabel(o);
      $("tooltipNote").textContent = o.note || "";
      placeBox($("hoverBox"), o, 4);
      $("hoverBox").hidden = !prefs.highlight;
      tooltip.hidden = !prefs.tooltips;
    }
    if (!prefs.tooltips) return;
    const w = tooltip.offsetWidth, h = tooltip.offsetHeight;
    let x = e.clientX + 16, y = e.clientY + 16;
    if (x + w > window.innerWidth - 8) x = e.clientX - w - 12;
    if (y + h > window.innerHeight - 8) y = e.clientY - h - 12;
    tooltip.style.left = x + "px";
    tooltip.style.top = y + "px";
  }

  canvas.addEventListener("pointerleave", () => { if (state.mode === "view") hideHover(); });

  $("legalBtn").addEventListener("click", () => $("legalDialog").showModal());
  $("legalClose").addEventListener("click", () => $("legalDialog").close());

  function loadPrefs() {
    try {
      const saved = JSON.parse(localStorage.getItem("planizo:view") || "{}");
      if (typeof saved.highlight === "boolean") state.prefs.highlight = saved.highlight;
      if (typeof saved.tooltips === "boolean") state.prefs.tooltips = saved.tooltips;
      if (typeof saved.pin === "boolean") state.prefs.pin = saved.pin;
      if (typeof saved.bg === "string" && COLOR_RE.test(saved.bg)) state.prefs.bg = saved.bg;
    } catch (e) {}
    applyPrefs();
  }
  function savePrefs() {
    try { localStorage.setItem("planizo:view", JSON.stringify(state.prefs)); } catch (e) {}
  }
  function applyPrefs() {
    const p = state.prefs;
    $("optHighlight").checked = p.highlight;
    $("optTooltips").checked = p.tooltips;
    $("optPin").checked = p.pin;
    $("optBg").value = p.bg || "#e7eaed";
    if (p.bg) document.body.style.setProperty("--view-bg", p.bg);
    else document.body.style.removeProperty("--view-bg");
  }
  $("optHighlight").addEventListener("change", (e) => { state.prefs.highlight = e.target.checked; hideHover(); savePrefs(); });
  $("optTooltips").addEventListener("change", (e) => { state.prefs.tooltips = e.target.checked; hideHover(); savePrefs(); });
  $("optPin").addEventListener("change", (e) => { state.prefs.pin = e.target.checked; renderLayerDock(); savePrefs(); });
  $("optBg").addEventListener("input", (e) => { state.prefs.bg = e.target.value; applyPrefs(); });
  $("optBg").addEventListener("change", savePrefs);
  $("optBgReset").addEventListener("click", () => { state.prefs.bg = null; applyPrefs(); savePrefs(); });

  function setTool(tool) {
    closeTextInput(true);
    state.tool = tool;
    document.querySelectorAll(".tool[data-tool]").forEach((b) => {
      b.setAttribute("aria-pressed", String(b.dataset.tool === tool));
    });
    $("sheet").dataset.tool = state.mode === "edit" ? tool : "view";
    if (tool !== "select") select(null);
  }

  document.querySelectorAll(".tool[data-tool]").forEach((b) => {
    b.addEventListener("click", () => setTool(b.dataset.tool));
  });

  function syncStyleInputs() {
    const s = state.style;
    $("strokeColor").value = s.stroke;
    $("fillOn").checked = s.fillOn;
    $("fillColor").value = s.fill;
    $("strokeWidth").value = s.width;
    $("strokeWidthOut").textContent = s.width;
    $("fontSize").value = s.fontSize;
  }

  function loadStyleFrom(o) {
    const s = state.style;
    if (o.type === "text") {
      s.stroke = o.color;
      s.fontSize = o.size;
    } else if (o.type !== "image") {
      s.stroke = o.stroke;
      s.width = o.width;
      if (o.type === "rect" || o.type === "ellipse") {
        s.fillOn = !!o.fill;
        if (o.fill) s.fill = o.fill;
      }
    }
    syncStyleInputs();
  }

  const isSelected = (id) => state.selection.includes(id);

  function selectionFound() {
    const out = [];
    if (!state.plan) return out;
    for (let li = state.plan.layers.length - 1; li >= 0; li--) {
      const layer = state.plan.layers[li];
      if (!layer.visible || layer.locked) continue;
      layer.objects.forEach((obj, index) => {
        if (state.selection.includes(obj.id)) out.push({ layer, obj, index });
      });
    }
    return out;
  }

  function groupMembers(id) {
    const f = findObject(id);
    if (!f || !f.obj.group) return f ? [id] : [];
    const ids = [];
    state.plan.layers.forEach((l) => l.objects.forEach((o) => { if (o.group === f.obj.group) ids.push(o.id); }));
    return ids;
  }

  function unionBox(objs) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    objs.forEach((o) => {
      const b = worldBox(o);
      x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y);
      x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h);
    });
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  function setSelection(ids) {
    const set = new Set();
    ids.forEach((id) => groupMembers(id).forEach((m) => set.add(m)));
    state.selection = Array.from(set);
    const fs = selectionFound();
    if (fs.length) loadStyleFrom(fs[fs.length - 1].obj);
    renderSelection();
    renderMarkers();
  }

  function select(id) {
    setSelection(id ? [id] : []);
  }

  function selectObject(id, additive) {
    const found = findObject(id);
    if (!found) return;
    if (state.tool !== "select") setTool("select");
    if (additive) {
      const members = groupMembers(id);
      const already = members.every((m) => isSelected(m));
      setSelection(already ? state.selection.filter((x) => !members.includes(x)) : state.selection.concat(members));
      return;
    }
    if (state.plan.activeLayerId !== found.layer.id) {
      state.plan.activeLayerId = found.layer.id;
      renderLayers();
    }
    select(id);
  }

  function readStyleInputs() {
    const s = state.style;
    const c = $("strokeColor").value;
    if (COLOR_RE.test(c)) s.stroke = c;
    const f = $("fillColor").value;
    if (COLOR_RE.test(f)) s.fill = f;
    s.fillOn = $("fillOn").checked;
    s.width = clamp(Number($("strokeWidth").value) || 2, 1, 20);
    const fs = Math.round(Number($("fontSize").value));
    if (fs >= 6 && fs <= 400) s.fontSize = fs;
    syncStyleInputs();
  }

  function applyStyleToSelected() {
    const fs = selectionFound();
    if (!fs.length) return;
    const s = state.style;
    const before = snapshot();
    let changed = false;
    fs.forEach(({ obj: o }) => {
      const set = (k, v) => { if (o[k] !== v) { o[k] = v; changed = true; } };
      if (o.type === "text") {
        set("color", s.stroke);
        set("size", s.fontSize);
      } else if (o.type !== "image") {
        set("stroke", s.stroke);
        set("width", s.width);
        if (o.type === "rect" || o.type === "ellipse") set("fill", s.fillOn ? s.fill : null);
      }
    });
    if (changed) {
      pushHistory(before);
      renderCanvas();
    }
  }

  ["strokeColor", "fillOn", "fillColor", "strokeWidth", "fontSize"].forEach((id) => {
    $(id).addEventListener("change", () => { readStyleInputs(); applyStyleToSelected(); });
  });
  $("strokeWidth").addEventListener("input", (e) => { $("strokeWidthOut").textContent = e.target.value; });

  function mutate(id, fn) {
    const found = findObject(id);
    if (!found) return null;
    const before = snapshot();
    if (fn(found) === false) return found;
    pushHistory(before);
    renderCanvas();
    renderLayers();
    return found;
  }

  function mutateSelection(fn) {
    const fs = selectionFound();
    if (!fs.length) return false;
    const before = snapshot();
    if (fn(fs) === false) return false;
    pushHistory(before);
    renderCanvas();
    renderLayers();
    return true;
  }

  function removeFromLayer(f) {
    const i = f.layer.objects.indexOf(f.obj);
    if (i >= 0) f.layer.objects.splice(i, 1);
  }

  function deleteSelection() {
    mutateSelection((fs) => fs.forEach(removeFromLayer));
    select(null);
  }

  function nudgeSelection(dx, dy) {
    mutateSelection((fs) => fs.forEach((f) => translateObj(f.obj, cloneObj(f.obj), dx, dy)));
  }

  function rotateItems(items, center, deg) {
    items.forEach((it) => {
      const nc = rotatePoint(it.c0, center, deg);
      translateObj(it.obj, it.orig, nc.x - it.c0.x, nc.y - it.c0.y);
      setRotation(it.obj, rot(it.orig) + deg);
    });
  }
  function rotateSelection(deg) {
    mutateSelection((fs) => {
      if (fs.length === 1) { setRotation(fs[0].obj, rot(fs[0].obj) + deg); return; }
      const c = centerOf(unionBox(fs.map((f) => f.obj)));
      rotateItems(fs.map((f) => ({ obj: f.obj, orig: cloneObj(f.obj), c0: centerOf(getBox(f.obj)) })), c, deg);
    });
  }
  function resetRotation() {
    mutateSelection((fs) => fs.forEach((f) => { delete f.obj.rotation; }));
  }

  function reorderSelection(toFront) {
    mutateSelection((fs) => {
      const byLayer = new Map();
      fs.forEach((f) => {
        if (!byLayer.has(f.layer)) byLayer.set(f.layer, []);
        byLayer.get(f.layer).push(f.obj);
      });
      byLayer.forEach((objs, layer) => {
        layer.objects = layer.objects.filter((o) => !objs.includes(o));
        layer.objects = toFront ? layer.objects.concat(objs) : objs.concat(layer.objects);
      });
    });
  }

  function sendToLayer(layerId) {
    let target = null;
    const ids = state.selection.slice();
    mutateSelection((fs) => {
      target = layerId ? state.plan.layers.find((l) => l.id === layerId) : addLayer();
      if (!target || fs.every((f) => f.layer === target)) return false;
      fs.forEach((f) => { if (f.layer !== target) { removeFromLayer(f); target.objects.push(f.obj); } });
    });
    if (!target) return;
    if (target.visible && !target.locked) {
      state.plan.activeLayerId = target.id;
      setSelection(ids);
    } else {
      select(null);
    }
    renderLayers();
    toast(t("movedTo", { name: target.name }));
  }

  function bringBack() {
    mutateSelection((fs) => {
      const b = unionBox(fs.map((f) => f.obj));
      const W = state.plan.width, H = state.plan.height;
      const dx = clamp(b.x, 0, Math.max(0, W - b.w)) - b.x;
      const dy = clamp(b.y, 0, Math.max(0, H - b.h)) - b.y;
      if (!dx && !dy) return false;
      fs.forEach((f) => translateObj(f.obj, cloneObj(f.obj), dx, dy));
    });
    renderSelection();
  }

  function groupSelection() {
    const fs = selectionFound();
    if (fs.length < 2) return;
    const gid = newId("g");
    mutateSelection(() => {
      const target = fs.some((f) => f.layer.id === state.plan.activeLayerId) ? activeLayer() : fs[fs.length - 1].layer;
      const objs = fs.map((f) => f.obj);
      const lastIndex = Math.max(...fs.filter((f) => f.layer === target).map((f) => f.index));
      const anchor = target.objects[lastIndex + 1] || null;
      fs.forEach(removeFromLayer);
      const at = anchor ? target.objects.indexOf(anchor) : target.objects.length;
      target.objects.splice(at, 0, ...objs);
      objs.forEach((o) => { o.group = gid; });
      state.plan.activeLayerId = target.id;
    });
    setSelection(fs.map((f) => f.obj.id));
    toast(t("grouped", { n: fs.length }));
  }

  function ungroupSelection() {
    const ids = state.selection.slice();
    const done = mutateSelection((fs) => {
      if (!fs.some((f) => f.obj.group)) return false;
      fs.forEach((f) => { delete f.obj.group; });
    });
    if (done) { setSelection(ids); toast(t("ungrouped")); }
  }

  let clipboard = null;
  let pasteCount = 0;

  function copySelection(silent) {
    const fs = selectionFound();
    if (!fs.length) return false;
    clipboard = { items: fs.map((f) => cloneObj(f.obj)), box: unionBox(fs.map((f) => f.obj)) };
    pasteCount = 0;
    if (!silent) toast(t("copied", { n: fs.length }));
    return true;
  }

  function cutSelection() {
    if (!copySelection(true)) return;
    pasteCount = -1;
    deleteSelection();
    toast(t("cut", { n: clipboard.items.length }));
  }

  function insertCopies(items, dx, dy) {
    const before = snapshot();
    const layer = requireDrawableLayer();
    if (!layer) return;
    const groupMap = new Map();
    const ids = items.map((src) => {
      const o = cloneObj(src);
      o.id = newId("o");
      if (o.group) {
        if (!groupMap.has(o.group)) groupMap.set(o.group, newId("g"));
        o.group = groupMap.get(o.group);
      }
      translateObj(o, cloneObj(o), dx, dy);
      layer.objects.push(o);
      return o.id;
    });
    pushHistory(before);
    renderCanvas();
    renderLayers();
    setSelection(ids);
  }

  function paste(at) {
    if (!clipboard) return;
    if (state.tool !== "select") setTool("select");
    let dx, dy;
    if (at) {
      dx = at.x - clipboard.box.x;
      dy = at.y - clipboard.box.y;
    } else {
      pasteCount += 1;
      dx = dy = 20 * pasteCount;
    }
    insertCopies(clipboard.items, round(dx), round(dy));
  }

  function duplicateSelection() {
    const fs = selectionFound();
    if (fs.length) insertCopies(fs.map((f) => f.obj), 20, 20);
  }

  function selectAll() {
    const layer = activeLayer();
    if (!layer || !layer.visible || layer.locked) return;
    if (state.tool !== "select") setTool("select");
    setSelection(layer.objects.map((o) => o.id));
  }

  const ctxMenu = $("ctxMenu");

  function closeContextMenu() {
    if (ctxMenu.hidden) return;
    ctxMenu.hidden = true;
    ctxMenu.replaceChildren();
  }

  function openMenu(entries, clientX, clientY) {
    closeTextInput(true);
    ctxMenu.replaceChildren();
    entries.forEach((en) => {
      if (en === "sep") {
        const d = document.createElement("div");
        d.className = "ctx-sep";
        ctxMenu.appendChild(d);
        return;
      }
      if (en.head) {
        const d = document.createElement("div");
        d.className = "ctx-head";
        d.textContent = en.head;
        ctxMenu.appendChild(d);
        return;
      }
      const b = document.createElement("button");
      b.type = "button";
      b.className = "ctx-item" + (en.sub ? " sub" : "") + (en.danger ? " danger" : "");
      b.setAttribute("role", "menuitem");
      b.disabled = !!en.disabled;
      const text = document.createElement("span");
      text.textContent = en.label;
      b.appendChild(text);
      if (en.key) {
        const k = document.createElement("span");
        k.className = "ctx-key";
        k.textContent = en.key;
        b.appendChild(k);
      }
      b.addEventListener("click", () => { closeContextMenu(); en.fn(); });
      ctxMenu.appendChild(b);
    });

    ctxMenu.hidden = false;
    const w = ctxMenu.offsetWidth, h = ctxMenu.offsetHeight;
    ctxMenu.style.left = Math.min(clientX, window.innerWidth - w - 8) + "px";
    ctxMenu.style.top = Math.max(8, Math.min(clientY, window.innerHeight - h - 8)) + "px";
    const first = ctxMenu.querySelector(".ctx-item:not(:disabled)");
    if (first) first.focus();
  }

  function openContextMenu(id, clientX, clientY) {
    if (!findObject(id) || state.mode !== "edit") return;
    closeTextInput(true);
    if (!isSelected(id)) selectObject(id);
    const fs = selectionFound();
    if (!fs.length) return;
    const single = fs.length === 1 ? fs[0].obj : null;
    const layersOf = new Set(fs.map((f) => f.layer));
    const entries = [];

    if (single) {
      entries.push({ label: single.name || single.note ? t("ctxEditInfo") : t("ctxAddInfo"), fn: () => openNoteDialog(single.id), key: "I" });
      if (single.type === "text") entries.push({ label: t("ctxEditText"), fn: () => openTextInput({ x: single.x, y: single.y }, single) });
      entries.push("sep");
    } else {
      entries.push({ head: t("statusMulti", { n: fs.length }) });
    }

    const grouped = fs.some((f) => f.obj.group);
    const oneGroup = grouped && fs.every((f) => f.obj.group === fs[0].obj.group);
    if (fs.length > 1 && !oneGroup) entries.push({ label: t("ctxGroup"), fn: groupSelection, key: "Ctrl+G" });
    if (grouped) entries.push({ label: t("ctxUngroup"), fn: ungroupSelection, key: t("keyUngroup") });
    if (fs.length > 1 || grouped) entries.push("sep");

    entries.push(
      { label: t("ctxCopy"), fn: () => copySelection(), key: "Ctrl+C" },
      { label: t("ctxCut"), fn: cutSelection, key: "Ctrl+X" },
      { label: t("ctxPaste"), fn: () => paste(), key: "Ctrl+V", disabled: !clipboard },
      { label: t("ctxDuplicate"), fn: duplicateSelection, key: "Ctrl+D" },
      "sep",
      { head: t("ctxSendTo") }
    );
    state.plan.layers.forEach((layer) => {
      if (!(layersOf.size === 1 && layersOf.has(layer))) entries.push({ label: layer.name, fn: () => sendToLayer(layer.id), sub: true });
    });
    entries.push({ label: t("ctxNewLayer"), fn: () => sendToLayer(null), sub: true });
    entries.push("sep",
      { label: t("ctxRotateRight"), fn: () => rotateSelection(90), key: "]" },
      { label: t("ctxRotateLeft"), fn: () => rotateSelection(-90), key: "[" });
    if (fs.some((f) => rot(f.obj))) entries.push({ label: t("ctxResetRotation"), fn: resetRotation });
    entries.push("sep",
      { label: t("ctxFront"), fn: () => reorderSelection(true) },
      { label: t("ctxBack"), fn: () => reorderSelection(false) });
    if (fs.some((f) => isOffSheet(f.obj))) entries.push({ label: t("ctxBringBack"), fn: bringBack });
    entries.push("sep", { label: t("ctxDelete"), fn: deleteSelection, danger: true, key: t("keyDelete") });

    openMenu(entries, clientX, clientY);
  }

  ctxMenu.addEventListener("keydown", (e) => {
    const items = Array.from(ctxMenu.querySelectorAll(".ctx-item:not(:disabled)"));
    const i = items.indexOf(document.activeElement);
    if (e.key === "ArrowDown") { e.preventDefault(); items[(i + 1) % items.length].focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
    else if (e.key === "Escape") { e.preventDefault(); closeContextMenu(); }
  });

  document.addEventListener("pointerdown", (e) => {
    if (!ctxMenu.hidden && !ctxMenu.contains(e.target)) closeContextMenu();
  }, true);
  window.addEventListener("resize", closeContextMenu);
  window.addEventListener("blur", closeContextMenu);
  $("workspace").addEventListener("scroll", closeContextMenu);

  canvas.addEventListener("contextmenu", (e) => {
    if (state.mode !== "edit") return;
    e.preventDefault();
    const p = toSheet(e);
    const hit = hitTest(p);
    if (hit) openContextMenu(hit.obj.id, e.clientX, e.clientY);
    else if (clipboard) openMenu([{ label: t("ctxPasteHere"), fn: () => paste(p), key: "Ctrl+V" }], e.clientX, e.clientY);
    else closeContextMenu();
  });

  const noteDialog = $("noteDialog");
  let noteTarget = null;

  function openNoteDialog(id) {
    const found = findObject(id);
    if (!found) return;
    noteTarget = id;
    $("noteName").value = found.obj.name || "";
    $("noteText").value = found.obj.note || "";
    noteDialog.showModal();
    $("noteName").focus();
  }

  $("noteSave").addEventListener("click", () => {
    const name = $("noteName").value.trim().slice(0, 80);
    const note = $("noteText").value.trim().slice(0, 2000);
    mutate(noteTarget, (f) => {
      if ((f.obj.name || "") === name && (f.obj.note || "") === note) return false;
      if (name) f.obj.name = name; else delete f.obj.name;
      if (note) f.obj.note = note; else delete f.obj.note;
    });
    noteDialog.close();
    renderStatus();
  });
  $("noteCancel").addEventListener("click", () => noteDialog.close());
  noteDialog.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) $("noteSave").click();
  });

  let action = null;

  function toSheet(e) {
    const r = canvas.getBoundingClientRect();
    const z = state.view.z;
    return { x: round((e.clientX - r.left) / z), y: round((e.clientY - r.top) / z) };
  }

  function newShape(tool, p) {
    const s = state.style;
    const id = newId("o");
    switch (tool) {
      case "pencil": return { id, type: "path", points: [[p.x, p.y]], stroke: s.stroke, width: s.width };
      case "rect": return { id, type: "rect", x: p.x, y: p.y, w: 0, h: 0, stroke: s.stroke, width: s.width, fill: s.fillOn ? s.fill : null };
      case "ellipse": return { id, type: "ellipse", x: p.x, y: p.y, w: 0, h: 0, stroke: s.stroke, width: s.width, fill: s.fillOn ? s.fill : null };
      case "line": return { id, type: "line", x1: p.x, y1: p.y, x2: p.x, y2: p.y, stroke: s.stroke, width: s.width };
    }
    return null;
  }

  function updateShape(o, start, p, constrain) {
    if (o.type === "path") {
      const last = o.points[o.points.length - 1];
      if (Math.hypot(p.x - last[0], p.y - last[1]) >= 1.5) o.points.push([p.x, p.y]);
    } else if (o.type === "rect" || o.type === "ellipse") {
      let w = p.x - start.x;
      let h = p.y - start.y;
      if (constrain) {
        const size = Math.max(Math.abs(w), Math.abs(h));
        w = Math.sign(w || 1) * size;
        h = Math.sign(h || 1) * size;
      }
      o.x = round(Math.min(start.x, start.x + w));
      o.y = round(Math.min(start.y, start.y + h));
      o.w = round(Math.abs(w));
      o.h = round(Math.abs(h));
    } else if (o.type === "line") {
      let x = p.x, y = p.y;
      if (constrain) {
        const angle = Math.round(Math.atan2(y - start.y, x - start.x) / (Math.PI / 4)) * (Math.PI / 4);
        const len = Math.hypot(x - start.x, y - start.y);
        x = round(start.x + Math.cos(angle) * len);
        y = round(start.y + Math.sin(angle) * len);
      }
      o.x2 = x;
      o.y2 = y;
    }
  }

  function isDegenerate(o) {
    if (o.type === "rect" || o.type === "ellipse") return o.w < 3 && o.h < 3;
    if (o.type === "line") return Math.hypot(o.x2 - o.x1, o.y2 - o.y1) < 3;
    return false;
  }

  canvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || !state.plan || state.mode !== "edit") return;
    const p = toSheet(e);

    if (state.tool === "text") {
      e.preventDefault();
      openTextInput(p, null);
      return;
    }

    if (state.tool === "select") {
      const hit = hitTest(p);
      const additive = e.ctrlKey || e.metaKey || e.shiftKey;
      if (!hit) { if (!additive) select(null); startPan(e); return; }
      let collapseTo = null;
      if (additive) {
        selectObject(hit.obj.id, true);
        if (!isSelected(hit.obj.id)) return;
      } else if (!isSelected(hit.obj.id)) {
        selectObject(hit.obj.id);
      } else {
        collapseTo = hit.obj.id;
      }
      const items = selectionFound().map((f) => ({ obj: f.obj, orig: cloneObj(f.obj) }));
      action = { kind: "move", items, start: p, before: snapshot(), changed: false, collapseTo };
    } else if (DRAW_TOOLS.includes(state.tool)) {
      const before = snapshot();
      const layer = requireDrawableLayer();
      if (!layer) return;
      const obj = newShape(state.tool, p);
      layer.objects.push(obj);
      action = { kind: "draw", obj, layer, start: p, before };
      renderCanvas();
      renderLayers();
    } else {
      return;
    }
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener("pointermove", (e) => {
    if (state.mode === "view") { updateHover(e); return; }
    if (!action) return;
    const p = toSheet(e);
    if (action.kind === "move") {
      const dx = p.x - action.start.x;
      const dy = p.y - action.start.y;
      if (!action.changed && Math.hypot(dx, dy) < 2) return;
      action.changed = true;
      action.items.forEach((it) => translateObj(it.obj, it.orig, dx, dy));
    } else if (action.kind === "draw") {
      updateShape(action.obj, action.start, p, e.shiftKey);
    }
    requestRender();
  });

  function endAction() {
    if (!action) return;
    const a = action;
    action = null;
    document.body.classList.remove("resizing");
    if (a.kind === "pan") { $("workspace").classList.remove("panning"); return; }

    if (a.kind === "move" && !a.changed && a.collapseTo) {
      selectObject(a.collapseTo);
    } else if (a.kind === "move" || a.kind === "scale" || a.kind === "rotate") {
      if (a.changed) pushHistory(a.before);
    } else if (a.kind === "draw") {
      if (isDegenerate(a.obj)) a.layer.objects = a.layer.objects.filter((o) => o !== a.obj);
      else pushHistory(a.before);
    } else if (a.kind === "sheet") {
      finishSheetResize(a);
      return;
    }
    renderCanvas();
    renderLayers();
  }

  canvas.addEventListener("pointerup", endAction);
  canvas.addEventListener("pointercancel", endAction);

  canvas.addEventListener("dblclick", (e) => {
    if (state.mode !== "edit" || state.tool !== "select") return;
    const hit = hitTest(toSheet(e));
    if (!hit) return;
    if (hit.obj.type === "text") openTextInput({ x: hit.obj.x, y: hit.obj.y }, hit.obj);
    else openNoteDialog(hit.obj.id);
  });

  const selHandle = $("selHandle");
  selHandle.addEventListener("pointerdown", (e) => {
    const fs = selectionFound();
    if (!fs.length || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    selHandle.setPointerCapture(e.pointerId);
    const start = { x: e.clientX, y: e.clientY };
    if (fs.length === 1) {
      action = {
        kind: "scale", obj: fs[0].obj, orig: cloneObj(fs[0].obj), b0: getBox(fs[0].obj),
        start, before: snapshot(), changed: false
      };
    } else {
      action = {
        kind: "scale", multi: true, u0: unionBox(fs.map((f) => f.obj)), start, before: snapshot(), changed: false,
        items: fs.map((f) => ({ obj: f.obj, orig: cloneObj(f.obj), b0: getBox(f.obj) }))
      };
    }
  });
  selHandle.addEventListener("pointermove", (e) => {
    if (!action || action.kind !== "scale") return;
    const a = action;
    if (a.multi) {
      const z = state.view.z;
      const u = a.u0;
      const k = Math.max(0.05,
        u.w ? (u.w + (e.clientX - a.start.x) / z) / u.w : 0,
        u.h ? (u.h + (e.clientY - a.start.y) / z) / u.h : 0);
      a.items.forEach((it) => {
        const c0 = centerOf(it.b0);
        const c1 = { x: u.x + (c0.x - u.x) * k, y: u.y + (c0.y - u.y) * k };
        const w = it.b0.w * k, h = it.b0.h * k;
        scaleObj(it.obj, it.orig, it.b0, { x: c1.x - w / 2, y: c1.y - h / 2, w, h });
      });
      a.changed = true;
      requestRender();
      return;
    }
    const r = rot(a.obj);
    const z = state.view.z;
    const d = rotatePoint({ x: (e.clientX - a.start.x) / z, y: (e.clientY - a.start.y) / z }, { x: 0, y: 0 }, -r);
    let w = a.b0.w ? Math.max(4, a.b0.w + d.x) : 0;
    let h = a.b0.h ? Math.max(4, a.b0.h + d.y) : 0;
    const keepRatio = (a.obj.type === "image" || a.obj.type === "text") ? !e.shiftKey : e.shiftKey;
    if (keepRatio && a.b0.w && a.b0.h) {
      const k = Math.max(w / a.b0.w, h / a.b0.h);
      w = a.b0.w * k;
      h = a.b0.h * k;
    }
    const c0 = centerOf(a.b0);
    const corner = rotatePoint({ x: a.b0.x, y: a.b0.y }, c0, r);
    const half = rotatePoint({ x: w / 2, y: h / 2 }, { x: 0, y: 0 }, r);
    const c1 = { x: corner.x + half.x, y: corner.y + half.y };
    a.changed = true;
    scaleObj(a.obj, a.orig, a.b0, { x: c1.x - w / 2, y: c1.y - h / 2, w, h });
    requestRender();
  });
  selHandle.addEventListener("pointerup", endAction);
  selHandle.addEventListener("pointercancel", endAction);

  const rotHandle = $("rotHandle");
  rotHandle.addEventListener("pointerdown", (e) => {
    const fs = selectionFound();
    if (!fs.length || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    rotHandle.setPointerCapture(e.pointerId);
    const c = fs.length === 1 ? centerOf(getBox(fs[0].obj)) : centerOf(unionBox(fs.map((f) => f.obj)));
    const p = toSheet(e);
    action = {
      kind: "rotate", c, a0: Math.atan2(p.y - c.y, p.x - c.x), before: snapshot(), changed: false,
      items: fs.map((f) => ({ obj: f.obj, orig: cloneObj(f.obj), c0: centerOf(getBox(f.obj)) }))
    };
  });
  rotHandle.addEventListener("pointermove", (e) => {
    if (!action || action.kind !== "rotate") return;
    const a = action;
    const p = toSheet(e);
    let d = (Math.atan2(p.y - a.c.y, p.x - a.c.x) - a.a0) / DEG;
    if (a.items.length === 1) {
      const r0 = rot(a.items[0].orig);
      d = (e.shiftKey ? Math.round((r0 + d) / 15) * 15 : Math.round(r0 + d)) - r0;
    } else {
      d = e.shiftKey ? Math.round(d / 15) * 15 : Math.round(d);
    }
    a.changed = true;
    rotateItems(a.items, a.c, d);
    requestRender();
  });
  rotHandle.addEventListener("pointerup", endAction);
  rotHandle.addEventListener("pointercancel", endAction);

  const workspace = $("workspace");
  const stage = $("stage");
  const MIN_ZOOM = 0.05, MAX_ZOOM = 8;
  let spaceDown = false;

  function applyView() {
    const v = state.view;
    stage.style.transform = "translate(" + v.x + "px," + v.y + "px) scale(" + v.z + ")";
    $("sheet").style.setProperty("--iz", String(1 / v.z));
    $("zoomFit").textContent = Math.round(v.z * 100) + " %";
  }

  function fitView() {
    if (!state.plan) return;
    const r = workspace.getBoundingClientRect();
    const pad = 48;
    const z = clamp(Math.min(1, (r.width - pad * 2) / state.plan.width, (r.height - pad * 2) / state.plan.height), MIN_ZOOM, 1);
    state.view.z = z;
    state.view.x = Math.round((r.width - state.plan.width * z) / 2);
    state.view.y = Math.round((r.height - state.plan.height * z) / 2);
    applyView();
  }

  function zoomAt(clientX, clientY, factor) {
    const v = state.view;
    const r = workspace.getBoundingClientRect();
    const mx = clientX - r.left, my = clientY - r.top;
    const sx = (mx - v.x) / v.z, sy = (my - v.y) / v.z;
    const z = clamp(v.z * factor, MIN_ZOOM, MAX_ZOOM);
    v.x = mx - sx * z;
    v.y = my - sy * z;
    v.z = z;
    applyView();
    closeContextMenu();
  }

  function zoomCenter(factor) {
    const r = workspace.getBoundingClientRect();
    zoomAt(r.left + r.width / 2, r.top + r.height / 2, factor);
  }

  workspace.addEventListener("wheel", (e) => {
    if (!state.plan) return;
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 0.05 : 0.0015;
    zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * unit));
  }, { passive: false });

  $("zoomIn").addEventListener("click", () => zoomCenter(1.25));
  $("zoomOut").addEventListener("click", () => zoomCenter(0.8));
  $("zoomFit").addEventListener("click", fitView);

  function startPan(e) {
    closeTextInput(true);
    closeContextMenu();
    hideHover();
    action = { kind: "pan", sx: e.clientX, sy: e.clientY, x0: state.view.x, y0: state.view.y };
    workspace.setPointerCapture(e.pointerId);
    workspace.classList.add("panning");
  }

  workspace.addEventListener("pointerdown", (e) => {
    if (!state.plan || action || e.target.closest(".zoom-ctl, .layer-dock")) return;
    const left = e.button === 0;
    if (e.button === 1 || (left && (spaceDown || state.mode === "view"))) {
      e.preventDefault();
      e.stopPropagation();
      startPan(e);
    }
  }, true);

  workspace.addEventListener("pointerdown", (e) => {
    if (!state.plan || action || e.button !== 0) return;
    if (e.target === workspace || e.target === stage) {
      select(null);
      startPan(e);
    }
  });

  workspace.addEventListener("mousedown", (e) => { if (e.button === 1) e.preventDefault(); });

  workspace.addEventListener("pointermove", (e) => {
    if (!action || action.kind !== "pan") return;
    state.view.x = action.x0 + (e.clientX - action.sx);
    state.view.y = action.y0 + (e.clientY - action.sy);
    applyView();
  });
  workspace.addEventListener("pointerup", endAction);
  workspace.addEventListener("pointercancel", endAction);

  document.addEventListener("keydown", (e) => {
    if (e.code !== "Space" || spaceDown || isTyping(e.target) || state.mode === "home") return;
    if (e.target.tagName === "BUTTON") return;
    e.preventDefault();
    spaceDown = true;
    workspace.classList.add("space-pan");
  });
  document.addEventListener("keyup", (e) => {
    if (e.code !== "Space") return;
    spaceDown = false;
    workspace.classList.remove("space-pan");
  });
  window.addEventListener("blur", () => { spaceDown = false; workspace.classList.remove("space-pan"); });

  const textInput = $("textInput");
  let textEdit = null;

  function sizeTextInput() {
    textInput.size = Math.max(6, textInput.value.length + 2);
  }

  function openTextInput(p, obj) {
    closeTextInput(true);
    if (!obj) {
      const layer = activeLayer();
      if (layer && !layer.visible) { toast(t("layerHidden")); return; }
      if (layer && layer.locked) { toast(t("layerLocked")); return; }
    }
    textEdit = { p, obj };
    textInput.value = obj ? obj.text : "";
    textInput.style.left = p.x + "px";
    textInput.style.top = p.y + "px";
    textInput.style.fontSize = (obj ? obj.size : state.style.fontSize) + "px";
    textInput.style.color = obj ? obj.color : state.style.stroke;
    sizeTextInput();
    textInput.hidden = false;
    if (obj) {
      const el = elCache.get(obj.id);
      if (el) el.style.visibility = "hidden";
      $("selection").hidden = true;
    }
    textInput.focus();
    textInput.select();
  }

  function closeTextInput(save) {
    if (!textEdit) return;
    const te = textEdit;
    textEdit = null;
    textInput.hidden = true;
    const value = textInput.value.trim().slice(0, 500);

    if (te.obj) {
      const el = elCache.get(te.obj.id);
      if (el) el.style.visibility = "";
    }
    if (save && state.plan) {
      const before = snapshot();
      if (te.obj) {
        const found = findObject(te.obj.id);
        if (found && !value) {
          found.layer.objects.splice(found.index, 1);
          pushHistory(before);
        } else if (found && value !== found.obj.text) {
          found.obj.text = value;
          pushHistory(before);
        }
      } else if (value) {
        const layer = requireDrawableLayer();
        if (layer) {
          layer.objects.push({
            id: newId("o"), type: "text", x: te.p.x, y: te.p.y, text: value,
            size: state.style.fontSize, color: state.style.stroke
          });
          pushHistory(before);
        }
      }
    }
    if (state.plan) { renderCanvas(); renderLayers(); }
  }

  textInput.addEventListener("input", sizeTextInput);
  textInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); closeTextInput(true); }
    else if (e.key === "Escape") { e.preventDefault(); closeTextInput(false); }
  });
  textInput.addEventListener("blur", () => closeTextInput(true));

  document.querySelectorAll(".sheet-handle").forEach((handle) => {
    handle.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || !state.plan || state.mode !== "edit") return;
      e.preventDefault();
      closeTextInput(true);
      handle.setPointerCapture(e.pointerId);
      action = {
        kind: "sheet", dir: handle.dataset.dir, start: { x: e.clientX, y: e.clientY },
        w0: state.plan.width, h0: state.plan.height, w: state.plan.width, h: state.plan.height
      };
      document.body.classList.add("resizing");
      updateSheetPreview(action);
      $("resizePreview").hidden = false;
    });

    handle.addEventListener("pointermove", (e) => {
      if (!action || action.kind !== "sheet") return;
      const a = action;
      const dx = (e.clientX - a.start.x) / state.view.z;
      const dy = (e.clientY - a.start.y) / state.view.z;
      let w = a.w0, h = a.h0;
      if (a.dir.includes("e")) w = a.w0 + dx;
      if (a.dir.includes("w")) w = a.w0 - dx;
      if (a.dir.includes("s")) h = a.h0 + dy;
      if (a.dir.includes("n")) h = a.h0 - dy;
      a.w = clampSize(w);
      a.h = clampSize(h);
      updateSheetPreview(a);
    });

    handle.addEventListener("pointerup", endAction);
    handle.addEventListener("pointercancel", endAction);
  });

  function updateSheetPreview(a) {
    const prev = $("resizePreview");
    prev.style.left = (a.dir.includes("w") ? a.w0 - a.w : 0) + "px";
    prev.style.top = (a.dir.includes("n") ? a.h0 - a.h : 0) + "px";
    prev.style.width = a.w + "px";
    prev.style.height = a.h + "px";
    $("resizeLabel").textContent = a.w + " × " + a.h + " px";
  }

  function finishSheetResize(a) {
    $("resizePreview").hidden = true;
    if (a.w === a.w0 && a.h === a.h0) return;
    const before = snapshot();
    const dx = a.dir.includes("w") ? a.w - a.w0 : 0;
    const dy = a.dir.includes("n") ? a.h - a.h0 : 0;
    if (dx || dy) state.plan.layers.forEach((l) => l.objects.forEach((o) => translateObj(o, cloneObj(o), dx, dy)));
    state.plan.width = a.w;
    state.plan.height = a.h;
    state.view.x -= dx * state.view.z;
    state.view.y -= dy * state.view.z;
    applyView();
    pushHistory(before);
    renderSheet();
    renderCanvas();
  }

  $("gridToggle").addEventListener("change", (e) => {
    state.plan.grid = e.target.checked;
    if (state.mode === "edit") state.dirty = true;
    renderSheet();
  });

  $("imageBtn").addEventListener("click", () => {
    closeTextInput(true);
    $("imageInput").click();
  });

  $("imageInput").addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file || !state.plan) return;
    if (file.size > MAX_IMAGE_BYTES) { toast(t("imageTooBig")); return; }

    const reader = new FileReader();
    reader.onerror = () => toast(t("imageInvalid"));
    reader.onload = () => {
      const src = String(reader.result);
      if (!IMAGE_RE.test(src)) { toast(t("imageInvalid")); return; }
      const img = new Image();
      img.onerror = () => toast(t("imageInvalid"));
      img.onload = () => insertImage(src, img.naturalWidth, img.naturalHeight, file.name);
      img.src = src;
    };
    reader.readAsDataURL(file);
  });

  function insertImage(src, nw, nh, fileName) {
    if (!nw || !nh) { nw = 800; nh = 600; }
    const p = state.plan;
    const before = snapshot();
    const isEmpty = p.layers.every((l) => l.objects.length === 0);
    let fitted = false;

    if (isEmpty) {
      const w = clampSize(nw), h = clampSize(nh);
      fitted = w !== p.width || h !== p.height;
      p.width = w;
      p.height = h;
    }
    const margin = isEmpty ? 1 : 0.9;
    const ratio = Math.min(isEmpty ? Infinity : 1, (p.width * margin) / nw, (p.height * margin) / nh);
    const w = nw * ratio, h = nh * ratio;

    const name = fileName.replace(/\.[^.]+$/, "").trim().slice(0, 60) || nextLayerName();
    const previousActive = p.activeLayerId;
    const layer = addLayer(name, isEmpty);
    const obj = { id: newId("o"), type: "image", x: round((p.width - w) / 2), y: round((p.height - h) / 2), w: round(w), h: round(h), src };
    layer.objects.push(obj);

    if (isEmpty) {
      layer.locked = true;
      layer.toggleable = false;
      if (previousActive) p.activeLayerId = previousActive;
    }
    pushHistory(before);

    setTool("select");
    if (fitted) fitView();
    renderAll();
    if (isEmpty) {
      toast(t("baseAdded", { name: layer.name }) + (fitted ? " " + t("sheetFitted") : ""));
    } else {
      select(obj.id);
      toast(t("imageAdded", { name: layer.name }));
    }
  }

  function isTyping(el) {
    if (!el || !el.tagName) return false;
    if (el.tagName === "TEXTAREA" || el.isContentEditable) return true;
    return el.tagName === "INPUT" && ["text", "number", "search", "email", "url", ""].includes(el.type);
  }

  const SHORTCUTS = { v: "select", p: "pencil", t: "text", r: "rect", e: "ellipse", l: "line" };

  document.addEventListener("keydown", (e) => {
    if (noteDialog.open || nameDialog.open || !ctxMenu.hidden) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();

    if (mod && key === "s") {
      if (state.plan && state.mode === "edit") { e.preventDefault(); savePlan(); }
      return;
    }
    if (state.mode === "home" || isTyping(e.target)) return;
    if (mod && key === "0") { e.preventDefault(); fitView(); return; }
    if (mod && (key === "+" || key === "=")) { e.preventDefault(); zoomCenter(1.25); return; }
    if (mod && key === "-") { e.preventDefault(); zoomCenter(0.8); return; }
    if (state.mode !== "edit") return;

    if (mod) {
      if (key === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      else if (key === "y" || (key === "z" && e.shiftKey)) { e.preventDefault(); redo(); }
      else if (key === "c") { if (copySelection()) e.preventDefault(); }
      else if (key === "x") { e.preventDefault(); cutSelection(); }
      else if (key === "v") { if (clipboard) { e.preventDefault(); paste(); } }
      else if (key === "d") { e.preventDefault(); duplicateSelection(); }
      else if (key === "a") { e.preventDefault(); selectAll(); }
      else if (key === "g" && e.shiftKey) { e.preventDefault(); ungroupSelection(); }
      else if (key === "g") { e.preventDefault(); groupSelection(); }
      return;
    }
    if (e.altKey) return;

    if (SHORTCUTS[key]) { e.preventDefault(); setTool(SHORTCUTS[key]); return; }
    if (e.key === "Escape") { select(null); return; }
    if (!state.selection.length) return;

    if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); deleteSelection(); return; }
    if (key === "i" && state.selection.length === 1) { e.preventDefault(); openNoteDialog(state.selection[0]); return; }
    if (e.key === "]") { rotateSelection(90); return; }
    if (e.key === "[") { rotateSelection(-90); return; }
    if (e.key === "ContextMenu") {
      const r = $("selection").getBoundingClientRect();
      openContextMenu(state.selection[0], r.left + r.width / 2, r.top + r.height / 2);
      e.preventDefault();
      return;
    }

    const step = e.shiftKey ? 10 : 1;
    const arrows = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (arrows[e.key]) {
      e.preventDefault();
      nudgeSelection(arrows[e.key][0], arrows[e.key][1]);
    }
  });

  function openPlan(plan, mode, fileName, handle) {
    resetCanvas();
    state.plan = plan;
    state.fileName = fileName || null;
    state.fileHandle = handle || null;
    state.dirty = false;
    state.selection = [];
    state.undo = [];
    state.redo = [];
    hideError();
    setMode(mode);
    fitView();
    if (handle) rememberHandle(handle);
  }

  $("newBtn").addEventListener("click", () => {
    const plan = { id: uuid(), idFromFile: false, name: "", width: 1600, height: 1000, grid: true, layers: [], activeLayerId: null };
    state.plan = plan;
    const layer = { id: newId("l"), name: nextLayerName(), visible: true, locked: false, objects: [] };
    plan.layers.push(layer);
    plan.activeLayerId = layer.id;
    openPlan(plan, "edit", null, null);
  });

  function serialize() {
    const p = state.plan;
    return JSON.stringify({
      format: FORMAT,
      version: VERSION,
      id: p.id,
      name: p.name || undefined,
      sheet: { width: p.width, height: p.height },
      grid: p.grid,
      activeLayerId: p.activeLayerId,
      layers: p.layers.map((l) => ({
        id: l.id, name: l.name, visible: l.visible, locked: l.locked,
        toggleable: l.toggleable === false ? false : undefined,
        objects: l.objects
      }))
    });
  }

  const fileNameFor = (name) => (name.replace(/[\\/:*?"<>|]+/g, "-").trim() || "planizo") + ".json";
  const canPickFiles = typeof window.showOpenFilePicker === "function" && typeof window.showSaveFilePicker === "function";
  const FILE_TYPES = [{ description: "Plan Planizo", accept: { "application/json": [".json"] } }];

  async function writeToHandle(handle, text) {
    const w = await handle.createWritable();
    await w.write(text);
    await w.close();
  }

  function download(text, fileName) {
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  let saving = false;
  async function savePlan() {
    if (!state.plan || saving) return;
    closeTextInput(true);
    const isNew = !state.fileName && !state.fileHandle;
    if (isNew && !state.plan.name) {
      const name = await askPlanName(state.plan.name);
      if (!name) return;
      state.plan.name = name;
      renderPlanName();
    }
    saving = true;
    try {
      const text = serialize();
      if (state.fileHandle) {
        await writeToHandle(state.fileHandle, text);
      } else if (isNew && canPickFiles) {
        let handle;
        try {
          handle = await window.showSaveFilePicker({ suggestedName: fileNameFor(state.plan.name), types: FILE_TYPES });
        } catch (err) {
          if (err && err.name === "AbortError") return;
          throw err;
        }
        await writeToHandle(handle, text);
        state.fileHandle = handle;
        state.fileName = handle.name;
      } else {
        state.fileName = state.fileName || fileNameFor(state.plan.name);
        download(text, state.fileName);
        state.dirty = false;
        state.plan.idFromFile = true;
        toast(t("savedDownload", { name: state.fileName }));
        return;
      }
      state.dirty = false;
      state.plan.idFromFile = true;
      rememberHandle(state.fileHandle);
      toast(t("saved", { name: state.fileName || state.fileHandle.name }));
    } catch (err) {
      const fallback = state.fileName || fileNameFor(state.plan.name || "planizo");
      download(serialize(), fallback);
      state.dirty = false;
      toast(t("savedDownload", { name: fallback }));
    } finally {
      saving = false;
    }
  }

  $("saveBtn").addEventListener("click", savePlan);

  const nameDialog = $("nameDialog");
  let nameResolve = null;

  function askPlanName(current) {
    return new Promise((resolve) => {
      nameResolve = resolve;
      $("planNameInput").value = current || "";
      nameDialog.showModal();
      $("planNameInput").focus();
    });
  }
  function closeNameDialog(value) {
    if (nameDialog.open) nameDialog.close();
    if (nameResolve) { const r = nameResolve; nameResolve = null; r(value); }
  }
  $("nameOk").addEventListener("click", () => {
    const v = $("planNameInput").value.trim().slice(0, 80);
    if (!v) { $("planNameInput").focus(); return; }
    closeNameDialog(v);
  });
  $("nameCancel").addEventListener("click", () => closeNameDialog(null));
  nameDialog.addEventListener("cancel", () => closeNameDialog(null));
  $("planNameInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); $("nameOk").click(); }
  });

  function showError(key) {
    const el = $("homeError");
    el.dataset.i18n = key;
    el.textContent = t(key);
    el.hidden = false;
  }
  function hideError() {
    const el = $("homeError");
    el.hidden = true;
    delete el.dataset.i18n;
  }

  const safeColor = (v, fallback) => (typeof v === "string" && COLOR_RE.test(v) ? v : fallback);

  function sanitizeObject(o, ids) {
    if (!o || typeof o !== "object" || !OBJECT_TYPES.includes(o.type)) return null;
    const id = typeof o.id === "string" && ID_RE.test(o.id) && !ids.has(o.id) ? o.id : newId("o");
    ids.add(id);
    const width = isNum(o.width) && o.width > 0 ? Math.min(o.width, 100) : 2;
    const stroke = safeColor(o.stroke, "#1f2b33");
    let out = null;

    switch (o.type) {
      case "path": {
        if (!Array.isArray(o.points)) return null;
        const points = o.points
          .filter((pt) => Array.isArray(pt) && isNum(pt[0]) && isNum(pt[1]))
          .map((pt) => [pt[0], pt[1]]);
        if (points.length) out = { id, type: "path", points, stroke, width };
        break;
      }
      case "rect":
      case "ellipse":
        if ([o.x, o.y, o.w, o.h].every(isNum)) {
          out = { id, type: o.type, x: o.x, y: o.y, w: Math.abs(o.w), h: Math.abs(o.h), stroke, width, fill: safeColor(o.fill, null) };
        }
        break;
      case "line":
        if ([o.x1, o.y1, o.x2, o.y2].every(isNum)) out = { id, type: "line", x1: o.x1, y1: o.y1, x2: o.x2, y2: o.y2, stroke, width };
        break;
      case "text":
        if (isNum(o.x) && isNum(o.y) && typeof o.text === "string" && o.text.trim()) {
          out = {
            id, type: "text", x: o.x, y: o.y, text: o.text.slice(0, 500),
            size: isNum(o.size) && o.size > 0 ? Math.min(o.size, 1000) : 18,
            color: safeColor(o.color, "#1f2b33")
          };
        }
        break;
      case "image":
        if ([o.x, o.y, o.w, o.h].every(isNum) && typeof o.src === "string" && IMAGE_RE.test(o.src)) {
          out = { id, type: "image", x: o.x, y: o.y, w: Math.abs(o.w), h: Math.abs(o.h), src: o.src };
        }
        break;
    }
    if (!out) return null;
    if (isNum(o.rotation)) setRotation(out, o.rotation);
    if (typeof o.name === "string" && o.name.trim()) out.name = o.name.trim().slice(0, 80);
    if (typeof o.note === "string" && o.note.trim()) out.note = o.note.trim().slice(0, 2000);
    if (typeof o.group === "string" && ID_RE.test(o.group)) out.group = o.group;
    return out;
  }

  function parsePlan(obj) {
    if (!obj || obj.format !== FORMAT || typeof obj.sheet !== "object" || obj.sheet === null) return null;
    const w = clampSize(obj.sheet.width);
    const h = clampSize(obj.sheet.height);
    if (w === null || h === null) return null;

    const layerIds = new Set();
    const objectIds = new Set();
    const layers = (Array.isArray(obj.layers) ? obj.layers : [])
      .filter((l) => l && typeof l === "object")
      .map((l) => {
        const id = typeof l.id === "string" && ID_RE.test(l.id) && !layerIds.has(l.id) ? l.id : newId("l");
        layerIds.add(id);
        return {
          id,
          name: typeof l.name === "string" && l.name.trim() ? l.name.trim().slice(0, 60) : t("layerDefault"),
          visible: l.visible !== false,
          locked: l.locked === true,
          ...(l.toggleable === false ? { toggleable: false } : {}),
          objects: Array.isArray(l.objects) ? l.objects.map((o) => sanitizeObject(o, objectIds)).filter(Boolean) : []
        };
      });

    if (!layers.length) layers.push({ id: newId("l"), name: t("layerDefault") + " 1", visible: true, locked: false, objects: [] });
    const activeLayerId = layers.some((l) => l.id === obj.activeLayerId) ? obj.activeLayerId : layers[0].id;
    const name = typeof obj.name === "string" ? obj.name.trim().slice(0, 80) : "";
    const hasId = typeof obj.id === "string" && ID_RE.test(obj.id);
    return { id: hasId ? obj.id : uuid(), idFromFile: hasId, name, width: w, height: h, grid: obj.grid !== false, layers, activeLayerId };
  }

  async function loadFile(file, mode, handle, link) {
    if (!file) return;
    let obj;
    try {
      obj = JSON.parse(await file.text());
    } catch (err) {
      showError("errRead");
      return;
    }
    const plan = parsePlan(obj);
    if (!plan) { showError("errInvalid"); return; }
    if (!plan.name) plan.name = file.name.replace(/\.json$/i, "");
    openPlan(plan, mode, file.name, handle);
    if (link) applyLinkLayers(link);
    if (link && link.plan && plan.idFromFile && link.plan !== plan.id) toast(t("linkMismatch"));
  }

  async function pickAndLoad(mode) {
    const picked = await pickFile();
    if (picked) loadFile(picked.file, mode, picked.handle);
  }
  $("openBtn").addEventListener("click", () => pickAndLoad("edit"));
  $("viewBtn").addEventListener("click", () => pickAndLoad("view"));
  $("fileInput").addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (inputResolve) { const r = inputResolve; inputResolve = null; r(file ? { file, handle: null } : null); }
  });

  const DB_NAME = "planizo", DB_STORE = "handles";

  function idb(mode, fn) {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) { reject(new Error("no-idb")); return; }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(DB_STORE, mode);
        const r = fn(tx.objectStore(DB_STORE));
        tx.oncomplete = () => { db.close(); resolve(r && r.result); };
        tx.onerror = () => { db.close(); reject(tx.error); };
      };
    });
  }

  function rememberHandle(handle) {
    if (!handle || !state.plan) return;
    const entry = { handle, name: state.plan.name, fileName: handle.name };
    idb("readwrite", (store) => {
      if (state.plan.idFromFile) store.put(entry, "id:" + state.plan.id);
      store.put(entry, "file:" + handle.name);
    }).catch(() => {});
  }

  async function findHandle(link) {
    try {
      if (link.plan) {
        const e = await idb("readonly", (store) => store.get("id:" + link.plan));
        if (e) return e.handle;
      }
      if (link.file) {
        const e = await idb("readonly", (store) => store.get("file:" + link.file));
        if (e) return e.handle;
      }
    } catch (err) {}
    return null;
  }

  function parseLink() {
    const hash = location.hash.replace(/^#/, "");
    if (!hash) return null;
    const q = new URLSearchParams(hash);
    const plan = q.get("plan"), file = q.get("file");
    if (!plan && !file) return null;
    return {
      plan: plan && ID_RE.test(plan) ? plan : null,
      file: file ? file.slice(0, 200) : null,
      name: (q.get("name") || "").slice(0, 80),
      mode: q.get("mode") === "edit" ? "edit" : "view",
      layers: q.has("layers") ? q.get("layers").split("|").filter(Boolean) : null
    };
  }

  function clearLink() {
    if (location.hash) history.replaceState(null, "", location.pathname + location.search);
    $("linkCard").hidden = true;
  }

  function applyLinkLayers(link) {
    if (!link.layers || state.mode !== "view") return;
    const wanted = new Set(link.layers.map((n) => n.toLowerCase()));
    state.plan.layers.forEach((l) => {
      if (l.toggleable !== false) state.viewVisible.set(l.id, wanted.has(l.name.toLowerCase()));
    });
    renderCanvas();
    renderViewLayers();
  }

  function buildLink() {
    const p = state.plan;
    const q = new URLSearchParams();
    q.set("mode", "view");
    if (p.idFromFile) q.set("plan", p.id);
    if (state.fileName) q.set("file", state.fileName);
    if (p.name) q.set("name", p.name);
    const shown = p.layers.filter((l) => l.toggleable !== false && layerShown(l)).map((l) => l.name);
    q.set("layers", shown.join("|"));
    return location.origin + location.pathname + "#" + q.toString().replace(/\+/g, "%20");
  }

  $("shareBtn").addEventListener("click", async () => {
    if (!state.fileName && !state.plan.idFromFile) { toast(t("linkNeedsSave")); return; }
    const url = buildLink();
    try {
      await navigator.clipboard.writeText(url);
      toast(t("linkCopied"));
    } catch (err) {
      $("shareInput").value = url;
      $("shareDialog").showModal();
      $("shareInput").select();
    }
  });
  $("shareClose").addEventListener("click", () => $("shareDialog").close());

  function pickFile() {
    if (canPickFiles) {
      return window.showOpenFilePicker({ types: FILE_TYPES, multiple: false })
        .then(async ([handle]) => ({ file: await handle.getFile(), handle }))
        .catch((err) => (err && err.name === "AbortError" ? null : pickWithInput()));
    }
    return pickWithInput();
  }
  let inputResolve = null;
  function pickWithInput() {
    return new Promise((resolve) => {
      inputResolve = resolve;
      $("fileInput").click();
    });
  }

  async function handleLink() {
    const link = parseLink();
    if (!link) return;
    const label = link.name || link.file || t("untitled");
    const handle = await findHandle(link);

    if (handle) {
      let perm = "prompt";
      try { perm = await handle.queryPermission({ mode: "read" }); } catch (e) {}
      if (perm === "granted") {
        try { await loadFile(await handle.getFile(), link.mode, handle, link); return; } catch (e) {}
      }
      showLinkCard(t("linkOpenTitle", { name: label }), t("linkKnown"), t("linkOpenBtn"), async () => {
        try {
          if ((await handle.requestPermission({ mode: "read" })) !== "granted") return;
          await loadFile(await handle.getFile(), link.mode, handle, link);
        } catch (e) {
          showPickCard(link, label);
        }
      });
      return;
    }
    showPickCard(link, label);
  }

  function showPickCard(link, label) {
    const text = link.file ? t("linkPick", { file: link.file }) : t("linkPickNoFile");
    showLinkCard(t("linkOpenTitle", { name: label }), text, t("linkPickBtn"), async () => {
      const picked = await pickFile();
      if (picked) loadFile(picked.file, link.mode, picked.handle, link);
    });
  }

  let linkAction = null;
  function showLinkCard(title, text, button, onOpen) {
    $("linkTitle").textContent = title;
    $("linkText").textContent = text;
    $("linkOpen").textContent = button;
    linkAction = onOpen;
    $("linkCard").hidden = false;
    $("linkOpen").focus();
  }
  $("linkOpen").addEventListener("click", () => { if (linkAction) linkAction(); });
  $("linkCancel").addEventListener("click", clearLink);

  window.addEventListener("hashchange", () => {
    if (!parseLink()) return;
    if (state.mode !== "home") {
      if (state.dirty && !confirm(t("confirmLeave"))) return;
      state.dirty = false;
      const hash = location.hash;
      goHome();
      history.replaceState(null, "", location.pathname + location.search + hash);
    }
    handleLink();
  });

  document.querySelectorAll(".action[data-drop]").forEach((card) => {
    card.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      card.classList.add("drop-target");
    });
    card.addEventListener("dragleave", () => card.classList.remove("drop-target"));
    card.addEventListener("drop", async (e) => {
      e.preventDefault();
      card.classList.remove("drop-target");
      const item = e.dataTransfer.items && e.dataTransfer.items[0];
      const handlePromise = item && item.kind === "file" && item.getAsFileSystemHandle ? item.getAsFileSystemHandle() : null;
      const file = e.dataTransfer.files && e.dataTransfer.files[0];
      let handle = null;
      try { handle = handlePromise ? await handlePromise : null; } catch (err) { handle = null; }
      if (handle && handle.kind !== "file") handle = null;
      loadFile(file, card.dataset.drop, handle);
    });
  });
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => e.preventDefault());

  initTheme();
  initLang();
  loadPrefs();
  syncStyleInputs();
  setPanel(true);
  setMode("home");
  requestAnimationFrame(() => document.body.classList.add("ready"));
  handleLink();
})();
