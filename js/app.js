/* Learn with Excel · demo v3 (early user test). Static, no accounts, no server.
   Content: content/*.json. Engine: js/engine.js. Instant Python subset: js/minipy.js, real Python: Pyodide (lazy). */
(function () {
  "use strict";
  var WA_NUMBER = "2349064519858";
  var APP_VERSION = "demo-v3";
  var K = "lwe3.";
  var MASCOT = { // the ONLY place emojis are used: the mascot's reaction faces
    happy: { img: "icons/mascot-happy.svg", emo: "\u{1F604}" },
    celebrate: { img: "icons/mascot-celebrate.svg", emo: "\u{1F389}" },
    oops: { img: "icons/mascot-oops.svg", emo: "\u{1F914}" },
    sad: { img: "icons/mascot-sad.svg", emo: "\u{1F615}" },
    thinking: { img: "icons/mascot-thinking.svg", emo: "\u{1F9D0}" },
    wave: { img: "icons/mascot-wave.svg", emo: "\u{1F44B}" }
  };

  /* ---------- storage ---------- */
  function get(k, d) { try { var v = localStorage.getItem(K + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function put(k, v) { try { localStorage.setItem(K + k, JSON.stringify(v)); } catch (e) {} }
  var ST = get("state", null) || { age: null, mode: null, done: {}, activeMs: 0, first: Date.now(), pos: { where: "age" } };
  function saveST() { put("state", ST); }
  var LOG = get("log", []);
  function log(e, data) {
    var ev = { e: e, t: Date.now() };
    if (data) for (var k in data) ev[k] = data[k];
    LOG.push(ev);
    if (LOG.length > 700) LOG = LOG.slice(LOG.length - 700);
    put("log", LOG);
  }
  function setPos(p) { ST.pos = p; saveST(); }

  /* active time: only counts while the page is visible */
  var lastTick = Date.now();
  function tick() { var now = Date.now(); if (document.visibilityState === "visible") ST.activeMs += Math.min(now - lastTick, 60000); lastTick = now; saveST(); }
  setInterval(tick, 5000);
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") { tick(); log("hidden", { pos: ST.pos }); } else { lastTick = Date.now(); }
  });

  var engine = new Engine({ load: function () { return get("engine", null); }, save: function (s) { put("engine", s); } });

  /* ---------- helpers ---------- */
  var $main = document.getElementById("main");
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function md(s) { return esc(s).replace(/`([^`]+)`/g, "<code>$1</code>"); }
  function kids() { return ST.mode === "kids"; }
  function shuffle(a) { a = a.slice(); for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function face(kind, cls) { var m = MASCOT[kind]; return '<div class="face ' + (cls || "") + '"><img src="' + m.img + '" alt=""><span class="emo" aria-hidden="true">' + m.emo + "</span></div>"; }
  function toast(msg) { var d = document.createElement("div"); d.className = "toast"; d.textContent = msg; document.body.appendChild(d); setTimeout(function () { d.remove(); }, 2200); }
  function mins(ms) { return Math.max(1, Math.round(ms / 60000)); }
  function view(it) { // apply Kids overrides
    if (!kids() || !it.kids) return it;
    var v = JSON.parse(JSON.stringify(it)), k = it.kids;
    if (k.prompt) v.prompt = k.prompt;
    if (k.body) for (var f in k.body) v.body[f] = k.body[f];
    return v;
  }
  function tagFeedback(tag) {
    var m = CAT[tag]; if (!m) return "";
    return kids() ? m.feedback.kids : m.feedback.adults;
  }

  /* syntax colouring for small snippets */
  function hlCode(code, highlight) {
    var out = "", i = 0, n = code.length;
    while (i < n) {
      var c = code[i];
      if (c === "#") { var j = code.indexOf("\n", i); if (j < 0) j = n; out += '<span class="cm">' + esc(code.slice(i, j)) + "</span>"; i = j; continue; }
      if (c === '"' || c === "'") { var k = i + 1; while (k < n && code[k] !== c && code[k] !== "\n") k++; if (code[k] === c) k++; out += '<span class="st">' + esc(code.slice(i, k)) + "</span>"; i = k; continue; }
      var m = /^_{3,}/.exec(code.slice(i));
      if (m) { out += '<span class="blank" id="blank">?</span>'; i += m[0].length; continue; }
      m = /^print\b/.exec(code.slice(i));
      if (m) { out += '<span class="kw">print</span>'; i += 5; continue; }
      out += esc(c); i++;
    }
    if (highlight) {
      var h = hlCode(highlight).replace(/<span class="blank"[^>]*>\?<\/span>/g, "");
      var idx = out.lastIndexOf(h);
      if (idx >= 0) out = out.slice(0, idx) + '<span class="hl">' + h + "</span>" + out.slice(idx + h.length);
    }
    return out;
  }

  /* ---------- Python: instant subset first, real Python (Pyodide, lazy) if needed ---------- */
  var PY_CACHE = "lwe-python-0.27.8", PY_WASM = "https://cdn.jsdelivr.net/pyodide/v0.27.8/full/pyodide.asm.wasm";
  var Py = {
    worker: null, state: "idle", readyP: null, seq: 0, pending: {},
    spawn: function () {
      var self = this;
      this.worker = new Worker("py-worker.js");
      this.worker.onmessage = function (ev) { var p = self.pending[ev.data.id]; if (!p) return; delete self.pending[ev.data.id]; clearTimeout(p.t); ev.data.ok ? p.res(ev.data) : p.rej(new Error(ev.data.error)); };
      this.worker.onerror = function (ev) { if (ev.preventDefault) ev.preventDefault(); Object.keys(self.pending).forEach(function (k) { var p = self.pending[k]; clearTimeout(p.t); p.rej(new Error("Python worker failed")); }); self.pending = {}; };
    },
    call: function (msg, ms) {
      var self = this, id = ++this.seq; msg.id = id;
      return new Promise(function (res, rej) { var t = setTimeout(function () { delete self.pending[id]; rej(new Error("timeout")); }, ms); self.pending[id] = { res: res, rej: rej, t: t }; self.worker.postMessage(msg); });
    },
    init: function () {
      var self = this;
      if (this.readyP) return this.readyP;
      this.state = "loading"; this.spawn();
      this.readyP = this.call({ cmd: "init" }, 180000).then(function (r) { self.state = "ready"; log("python_ready"); return r; })
        .catch(function (e) { self.state = "error"; self.readyP = null; try { self.worker.terminate(); } catch (x) {} throw e; });
      return this.readyP;
    },
    run: function (code) {
      var self = this;
      return this.init().then(function () { return self.call({ cmd: "run", code: code, inputs: [] }, 8000); }).then(function (r) { r.result.engine = "pyodide"; return r.result; })
        .catch(function (e) {
          if (e.message === "timeout") { try { self.worker.terminate(); } catch (x) {} self.readyP = null; self.state = "idle"; return { display: "", judge: "", error: { type: "Timeout", msg: "Your code ran for more than 8 seconds." } }; }
          throw e;
        });
    }
  };
  function runPython(code, statusEl) {
    var r = MiniPy.run(code);
    if (!r.unsupported) return Promise.resolve(r);
    log("python_fallback", { why: r.why });
    if (statusEl) statusEl.innerHTML = '<div class="pystat">Starting full Python for this one (first time can take a minute on mobile data)…</div>';
    return Py.run(code).then(function (res) { if (statusEl) statusEl.innerHTML = ""; return res; }, function (e) {
      if (statusEl) statusEl.innerHTML = '<div class="pystat">Couldn\'t load full Python. Check your connection and try again.</div>';
      throw e;
    });
  }
  function outHTML(r) {
    var s = '<div class="out"><span class="lbl">Output</span>' + (r.display ? esc(r.display.replace(/\n$/, "")) : '<span class="muted">(nothing shown)</span>') + "</div>";
    if (r.error) s += '<div class="out err"><span class="lbl">Python says</span>' + esc((r.error.lineno ? "Line " + r.error.lineno + ": " : "") + r.error.type + ": " + r.error.msg) + "</div>";
    return s;
  }

  /* ---------- content ---------- */
  var COURSE = null, CAT = null, LESSONS = {}, ALL_ITEMS = [];
  function loadContent() {
    function j(u) { return fetch(u, { cache: "no-cache" }).then(function (r) { if (!r.ok) throw new Error(u + " " + r.status); return r.json(); }); }
    return Promise.all([j("content/course.json"), j("content/catalogue.json")]).then(function (a) {
      COURSE = a[0]; CAT = a[1].misconceptions;
      var ids = []; COURSE.units.forEach(function (u) { ids = ids.concat(u.lessons); });
      return Promise.all(ids.map(function (id) { return j("content/lessons/" + id + ".json"); }));
    }).then(function (ls) {
      ls.forEach(function (L) { LESSONS[L.id] = L; L.slots.forEach(function (s) { ALL_ITEMS = ALL_ITEMS.concat(s.candidates); }); });
    });
  }
  function lessonOrder() { var a = []; COURSE.units.forEach(function (u) { u.lessons.forEach(function (l) { a.push(l); }); }); return a; }
  function lessonNo(id) { return lessonOrder().indexOf(id) + 1; }
  function lessonTitle(L) { return kids() && L.kids_title ? L.kids_title : L.title; }

  /* ---------- top bar ---------- */
  document.getElementById("fbBtn").innerHTML = icon("tutor") + "<span>Give feedback</span>";
  document.addEventListener("click", function (ev) {
    var a = ev.target.closest("[data-act]"); if (!a) return;
    var act = a.getAttribute("data-act");
    if (act === "feedback") { ev.preventDefault(); if (RUN && !confirmLeave()) return; openFeedback("button"); }
    if (act === "home") { ev.preventDefault(); if (!ST.mode) return; if (RUN && !confirmLeave()) return; home(); }
  });
  function confirmLeave() {
    var ok = window.confirm("Leave this lesson? You can start it again later.");
    if (ok) quitLesson("left_for_" + "other_screen");
    return ok;
  }

  /* ---------- screens ---------- */
  function render(html) { $main.innerHTML = html; window.scrollTo(0, 0); }

  function ageScreen() {
    RUN = null; document.body.classList.remove("kids"); setPos({ where: "age" });
    render('<section class="age">' +
      '<img class="lockup" src="img/lockup-700.png" width="700" height="200" alt="Learn with Excel">' +
      '<div class="banner">' + icon("bell") + '<div><b>Early test.</b> Thanks for trying this! It\'s an early version, so tap <b>Give feedback</b> at the top any time, even if you stop halfway.</div></div>' +
      '<h1>How old are you?</h1>' +
      '<div class="age-btns">' +
      '<button class="age-btn" data-age="8-13"><span>8 to 13<small>years old</small></span><span class="arrow" aria-hidden="true">&rsaquo;</span></button>' +
      '<button class="age-btn" data-age="14+"><span>14 or older<small>years old</small></span><span class="arrow" aria-hidden="true">&rsaquo;</span></button>' +
      "</div>" +
      '<p class="privacy">We only keep your age group, on this phone. No birthday, no name, no account.</p>' +
      "</section>");
    Array.prototype.forEach.call($main.querySelectorAll("[data-age]"), function (b) {
      b.onclick = function () {
        ST.age = b.getAttribute("data-age"); ST.mode = ST.age === "8-13" ? "kids" : "adults"; saveST();
        log("age_group", { age: ST.age, mode: ST.mode });
        home();
      };
    });
  }

  function home() {
    RUN = null; document.body.classList.toggle("kids", kids()); setPos({ where: "home" });
    var order = lessonOrder(), html = "";
    html += '<div class="hello"><img src="' + MASCOT.wave.img + '" alt=""><div><h1>' + (kids() ? "Let's learn Python!" : "Learn Python, step by step") + '</h1><span class="chip">' + icon("profile") + (kids() ? "Kids mode" : "Adults mode") + '</span> <button class="linkbtn small" id="chAge">Change age</button></div></div>';
    html += '<div class="banner">' + icon("bell") + '<div><b>Early test:</b> 2 short lessons, about 10 minutes. There are no wrong answers for you here; we\'re testing the app. Tap <b>Give feedback</b> any time.</div></div>';
    COURSE.units.forEach(function (u, ui) {
      html += '<section class="unit"><div class="unit-h"><img src="icons/' + u.badge + '.svg" alt=""><div><div class="k">Unit ' + u.n + '</div><h2>' + esc(kids() && u.kids_title ? u.kids_title : u.title) + "</h2></div></div>";
      u.lessons.forEach(function (lid) {
        var L = LESSONS[lid], d = ST.done[lid], idx = order.indexOf(lid), prev = order[idx - 1];
        var unlocked = !prev || ST.done[prev];
        html += '<div class="lesson-row"><div class="meta"><div class="t">Lesson ' + (idx + 1) + ": " + esc(lessonTitle(L)) + '</div><div class="s">' + L.slots.length + " steps · about 5 min</div>" +
          (d ? '<div class="done">' + icon("check") + "Done · " + d.pct + "% right first try</div>" : "") + "</div>" +
          (unlocked ? '<button class="btn ' + (d ? "btn-sec" : "btn-primary") + '" data-start="' + lid + '">' + (d ? "Again" : "Start") + "</button>"
                    : '<span class="locked">' + icon("lock") + "Finish lesson " + idx + "</span>") + "</div>";
      });
      html += "</section>";
    });
    // skill levels
    html += '<section class="card skills"><h3>Your skills</h3>';
    COURSE.units.forEach(function (u) { Object.keys(u.skills).forEach(function (sid) {
      var s = engine.s.skills[sid], lv = engine.level(sid, ALL_ITEMS), p = s && s.n ? Math.round(Engine.P(s.theta, 0) * 100) : 0;
      html += '<div class="skill"><span>' + esc(u.skills[sid]) + '</span><span class="lv">' + lv.name + '</span><span class="bar"><i style="width:' + p + '%"></i></span></div>';
    }); });
    html += '<p class="small muted">Skills grow as you answer. "Strong" and "Mastered" only come from practice on different days.</p></section>';
    var allDone = order.every(function (l) { return ST.done[l]; });
    if (allDone) html += '<button class="btn btn-primary wide" data-act="feedback">' + icon("tutor") + "Tell Excel what you think</button>";
    if (/[?&]debug=1/.test(location.search)) html += '<pre class="debug">' + esc(JSON.stringify({ engine: engine.s, version: Engine.VERSION, log_events: LOG.length }, null, 1)) + "</pre>" +
      '<button class="btn btn-sec wide" id="resetAll">Reset this phone (testing)</button>';
    render(html);
    document.getElementById("chAge").onclick = function () { log("age_reset", { from: ST.age }); ST.age = null; ST.mode = null; saveST(); ageScreen(); };
    var ra = document.getElementById("resetAll"); if (ra) ra.onclick = function () { if (confirm("Erase all test data on this phone?")) { Object.keys(localStorage).forEach(function (k) { if (k.indexOf(K) === 0) localStorage.removeItem(k); }); location.reload(); } };
    Array.prototype.forEach.call($main.querySelectorAll("[data-start]"), function (b) { b.onclick = function () { startLesson(b.getAttribute("data-start")); }; });
  }

  /* ---------- lesson player ---------- */
  var RUN = null;
  var GRADED = { predict: 1, trace: 1, read_error: 1, fill: 1, parsons: 1, fix: 1, modify: 1, write: 1 };
  var BEAT = { learn: "Learn", predict: "Predict", investigate: "Investigate", modify: "Modify", make: "Make" };
  function startLesson(lid) {
    var L = LESSONS[lid];
    RUN = { L: L, i: 0, queue: L.slots.map(function (s) { return { slot: s, retry: false }; }), first: {}, retries: 0, t0: Date.now(), used: {}, hints: 0 };
    log("lesson_start", { l: lid, mode: ST.mode });
    step();
  }
  function quitLesson(why) {
    if (!RUN) return;
    var cur = RUN.queue[RUN.i];
    log("lesson_quit", { l: RUN.L.id, step: RUN.i + 1, of: RUN.queue.length, item: RUN.cur && RUN.cur.it.id, why: why, ms: Date.now() - RUN.t0 });
    RUN = null;
  }
  function step() {
    if (RUN.i >= RUN.queue.length) return finishLesson();
    var q = RUN.queue[RUN.i], sl = q.slot;
    var avoid = RUN.used[sl.slot] || [];
    var pick = engine.pick(sl.candidates, ST.mode, q.retry ? avoid : null);
    var it = pick.item;
    RUN.used[sl.slot] = avoid.concat([it.id]);
    RUN.cur = { q: q, it: it, v: view(it), p: pick.p, t: Date.now(), n: 0, hint: false, hintLv: 0, sel: null, finished: false };
    setPos({ where: "lesson", l: RUN.L.id, step: RUN.i + 1, of: RUN.queue.length, item: it.id });
    log("item_shown", { l: RUN.L.id, slot: sl.slot, item: it.id, p: +pick.p.toFixed(3), retry: q.retry || undefined });
    renderItem();
  }
  function header() {
    var pct = Math.round(RUN.i / RUN.queue.length * 100), v = RUN.cur.v, graded = GRADED[v.type];
    return '<div class="lbar"><button class="iconbtn" id="quit" aria-label="Leave lesson">' + icon("close") + '</button>' +
      '<div class="progress" role="progressbar" aria-valuenow="' + pct + '" aria-valuemin="0" aria-valuemax="100"><i style="width:' + pct + '%"></i></div>' +
      (graded && v.hints && v.hints.length ? '<button class="iconbtn hint" id="hintBtn">' + icon("hint") + "Hint</button>" : "") + "</div>" +
      '<div class="beat">' + (RUN.cur.q.retry ? "One more try" : BEAT[RUN.cur.q.slot.beat] || "") + " · step " + (RUN.i + 1) + " of " + RUN.queue.length + "</div>";
  }
  function foot(html, cls) {
    var f = document.getElementById("foot");
    if (!f) { f = document.createElement("div"); f.id = "foot"; document.body.appendChild(f); }
    f.className = "foot " + (cls || ""); f.innerHTML = '<div class="foot-in">' + html + "</div>";
    return f;
  }
  function clearFoot() { var f = document.getElementById("foot"); if (f) f.remove(); }

  function renderItem() {
    var c = RUN.cur, v = c.v, b = v.body, h = header();
    h += '<h2 class="q">' + md(v.prompt) + "</h2>";
    if (v.type === "worked") {
      h += '<p class="lead">' + md(b.text) + "</p>" + '<pre class="code">' + hlCode(v.code, b.highlight) + "</pre>" + '<div id="py"></div><div id="out"></div>';
      render(h);
      var ran = false;
      foot('<button class="btn btn-primary wide" id="go">' + icon("playground") + "Run</button>");
      document.getElementById("go").onclick = function () {
        if (ran) return nextItem(null);
        runPython(v.code, document.getElementById("py")).then(function (r) {
          document.getElementById("out").innerHTML = outHTML(r); ran = true;
          var g = document.getElementById("go"); g.innerHTML = "Continue"; log("run", { item: v.id });
        });
      };
    } else if (v.type === "analogy") {
      h += '<div class="analogy" id="card"><span class="k">Idea</span>' + esc(b.card) + "</div>" + '<div id="brk"></div>';
      render(h);
      foot('<button class="btn btn-primary wide" id="go">Where does this idea break?</button>');
      var flipped = false;
      document.getElementById("go").onclick = function () {
        if (flipped) return nextItem(null);
        flipped = true;
        document.getElementById("brk").innerHTML = '<div class="analogy flipped"><span class="k">Where it breaks</span>' + esc(b.breaks) + "</div>";
        this.textContent = "Continue";
      };
    } else if (v.type === "predict" || v.type === "trace" || v.type === "read_error") {
      if (v.code) h += '<pre class="code">' + hlCode(v.code) + "</pre>";
      if (b.error) h += '<div class="errbox">' + esc(b.error) + "</div>";
      if (c.hintLv) h += hintHTML();
      var opts = c.order || (c.order = shuffle(b.options));
      h += '<div class="opts" role="radiogroup">' + opts.map(function (o, i) {
        return '<button class="opt' + (b.output_options ? " mono" : "") + '" role="radio" aria-checked="false" data-i="' + i + '">' + esc(o.text) + "</button>";
      }).join("") + "</div><div id=\"py\"></div><div id=\"runout\"></div>";
      render(h); bindCommon();
      Array.prototype.forEach.call($main.querySelectorAll(".opt"), function (btn) {
        btn.onclick = function () {
          if (c.locked) return;
          Array.prototype.forEach.call($main.querySelectorAll(".opt"), function (x) { x.classList.remove("sel"); x.setAttribute("aria-checked", "false"); });
          btn.classList.add("sel"); btn.setAttribute("aria-checked", "true"); c.sel = opts[+btn.getAttribute("data-i")];
          document.getElementById("check").disabled = false;
        };
      });
      checkFoot(function () { var o = c.sel; grade(!!o.correct, o.tag, o.feedback, o.hint, o.text); });
    } else if (v.type === "fill") {
      h += '<pre class="code">' + hlCode(v.code) + "</pre>";
      if (c.hintLv) h += hintHTML();
      var bank = c.order || (c.order = shuffle(b.bank));
      h += '<div class="bank">' + bank.map(function (o, i) { return '<button class="tok" data-i="' + i + '">' + esc(o.text) + "</button>"; }).join("") + "</div>";
      h += '<p class="expect">Should show: <code>' + esc(b.expected_output).replace(/\n/g, "</code> then <code>") + "</code></p><div id=\"py\"></div><div id=\"runout\"></div>";
      render(h); bindCommon();
      Array.prototype.forEach.call($main.querySelectorAll(".tok"), function (btn) {
        btn.onclick = function () {
          if (c.locked) return;
          Array.prototype.forEach.call($main.querySelectorAll(".tok"), function (x) { x.classList.remove("sel"); });
          btn.classList.add("sel"); c.sel = bank[+btn.getAttribute("data-i")];
          var bl = document.getElementById("blank"); bl.textContent = c.sel.text; bl.classList.add("filled");
          document.getElementById("check").disabled = false;
        };
      });
      checkFoot(function () { var o = c.sel; grade(!!o.correct, o.tag, o.feedback, o.hint, o.text); });
    } else if (v.type === "parsons") {
      var pool = c.pool || (c.pool = shuffle(b.lines.map(function (t) { return { text: t, real: true }; })
        .concat(kids() && !b.kids_distractors ? [] : (b.distractors || []).map(function (d) { return { text: d.text, tag: d.tag }; }))));
      c.picked = c.picked || [];
      h += '<p class="lead">Tap the lines in the order they should run. Tap a line again to take it back.</p>';
      if (c.hintLv) h += hintHTML();
      h += '<div class="parsons-area" id="area"></div><div class="pool" id="pool"></div><div id="py"></div><div id="runout"></div>';
      render(h); bindCommon();
      var drawP = function () {
        var area = document.getElementById("area"), pl = document.getElementById("pool");
        area.innerHTML = c.picked.length ? c.picked.map(function (pi, k) { return '<button class="pline used" data-k="' + k + '"><span class="n">' + (k + 1) + "</span>" + esc(pool[pi].text) + "</button>"; }).join("") : '<div class="ph">Your program goes here</div>';
        pl.innerHTML = pool.map(function (o, i) { return c.picked.indexOf(i) >= 0 ? "" : '<button class="pline" data-i="' + i + '">' + esc(o.text) + "</button>"; }).join("");
        Array.prototype.forEach.call(area.querySelectorAll("[data-k]"), function (x) { x.onclick = function () { if (c.locked) return; c.picked.splice(+x.getAttribute("data-k"), 1); drawP(); }; });
        Array.prototype.forEach.call(pl.querySelectorAll("[data-i]"), function (x) { x.onclick = function () { if (c.locked) return; c.picked.push(+x.getAttribute("data-i")); drawP(); }; });
        var ch = document.getElementById("check"); if (ch) ch.disabled = c.picked.length !== b.lines.length;
      };
      checkFoot(function () {
        var chosen = c.picked.map(function (i) { return pool[i]; }), d = chosen.filter(function (x) { return !x.real; })[0];
        var ok = !d && chosen.map(function (x) { return x.text; }).join("\n") === b.lines.join("\n");
        grade(ok, ok ? null : (d ? d.tag : b.wrong_order_tag), null, null, chosen.map(function (x) { return x.text; }).join(" | "));
      });
      drawP();
    } else { // fix / modify / write
      var start = c.code != null ? c.code : (v.code || "");
      h += '<p class="expect">Should show: <code>' + esc(b.expected_output).replace(/\n/g, "</code> then <code>") + "</code></p>";
      if (c.hintLv) h += hintHTML();
      h += '<textarea class="editor" id="ed" spellcheck="false" autocapitalize="off" autocorrect="off" autocomplete="off" aria-label="Your code" placeholder="Type your code here">' + esc(start) + "</textarea>";
      h += '<div class="keybar" aria-label="Symbols">' + ['"', "(", ")", "=", "'", "_", ","].map(function (k) { return '<button class="key" data-k="' + esc(k) + '">' + esc(k) + "</button>"; }).join("") + "</div>";
      h += '<div id="py"></div><div id="runout"></div>';
      render(h); bindCommon();
      var ed = document.getElementById("ed");
      var norm = function () { // phones type curly quotes; Python needs straight ones
        var s = ed.value, t = s.replace(/[\u201C\u201D\u201E\u2033]/g, '"').replace(/[\u2018\u2019\u201A\u2032]/g, "'");
        if (t !== s) { var p = ed.selectionStart; ed.value = t; ed.setSelectionRange(p, p); if (!c.quoteNote) { c.quoteNote = true; log("curly_quotes_fixed", { item: v.id }); } }
        c.code = ed.value; document.getElementById("check").disabled = !ed.value.trim();
      };
      ed.addEventListener("input", norm);
      Array.prototype.forEach.call($main.querySelectorAll(".key"), function (k) {
        k.onmousedown = function (e) { e.preventDefault(); };
        k.onclick = function () { var s = ed.selectionStart, e2 = ed.selectionEnd, t = k.getAttribute("data-k"); ed.setRangeText(t, s, e2, "end"); ed.focus(); norm(); };
      });
      checkFoot(function () { gradeCode(ed.value); }, "Run & check");
      document.getElementById("check").disabled = !ed.value.trim();
    }
  }
  function hintHTML() {
    var v = RUN.cur.v, hs = v.hints || [], t = hs.slice(0, RUN.cur.hintLv).join(" ");
    return '<div class="hintbox">' + icon("hint") + "<span>" + md(t) + "</span></div>";
  }
  function bindCommon() {
    document.getElementById("quit").onclick = function () {
      if (window.confirm("Leave this lesson? You can start it again later.")) { quitLesson("close_button"); clearFoot(); home(); }
    };
    var hb = document.getElementById("hintBtn");
    if (hb) hb.onclick = function () {
      var c = RUN.cur, n = (c.v.hints || []).length;
      if (c.hintLv >= n) return;
      c.hintLv++; c.hint = true; RUN.hints++;
      log("hint", { item: c.it.id, level: c.hintLv });
      var box = $main.querySelector(".hintbox");
      var html = hintHTML();
      if (box) box.outerHTML = html;
      else { var anchor = $main.querySelector(".opts, .bank, .parsons-area, .lead, .expect"); if (anchor) anchor.insertAdjacentHTML("beforebegin", html); }
      if (c.hintLv >= n) hb.disabled = true;
    };
  }
  function checkFoot(fn, label) {
    foot('<button class="btn btn-primary wide" id="check" disabled>' + (label || "Check") + "</button>");
    document.getElementById("check").onclick = function () { if (!this.disabled) fn(); };
  }

  /* grading for code items: run, then the item's checks */
  function stripStr(src) { return src.replace(/#[^\n]*/g, "").replace(/("([^"\\\n]|\\.)*"|'([^'\\\n]|\\.)*')/g, "S"); }
  function gradeCode(src) {
    var c = RUN.cur, b = c.v.body, et = b.error_tags || {};
    var btn = document.getElementById("check"); btn.disabled = true; btn.textContent = "Running…";
    runPython(src, document.getElementById("py")).then(function (r) {
      document.getElementById("runout").innerHTML = outHTML(r);
      var tag = null, why = "", ok = true;
      var want = b.expected_output.split("\n").map(function (s) { return s.replace(/\s+$/, ""); });
      var got = (r.display || "").replace(/\n$/, "").split("\n").map(function (s) { return s.replace(/\s+$/, ""); });
      if (r.error) {
        ok = false;
        if (r.error.type === "NameError" && /'Print'|'PRINT'|'Prnt'|'prnt'/.test(r.error.msg)) tag = et.Print || "mc.syn.case_insensitive";
        else if (r.error.type === "NameError" && /Did you mean: '[a-z_]+'\?/.test(r.error.msg) && /name '[A-Z]/.test(r.error.msg)) tag = et.Print || "mc.syn.case_insensitive";
        else if (r.error.type === "NameError") tag = et.NameError || null;
        else if (/unterminated|never closed/.test(r.error.msg)) tag = et.unterminated || null;
        why = "Python stopped with an error.";
      } else if (got.join("\n") !== want.join("\n")) {
        ok = false;
        if (got.length > want.length && et.too_many_lines) tag = et.too_many_lines;
        else if (got.length === want.length && got.slice().sort().join("\n") === want.slice().sort().join("\n")) tag = et.wrong_order || "mc.order.any_order";
        else tag = et.wrong_output || null;
        why = "The output doesn't match yet.";
      } else {
        var bare = stripStr(src);
        (b.checks || []).forEach(function (ch) {
          if (!ok) return;
          if (ch.kind === "print_count") { var n = (bare.match(/\bprint\s*\(/g) || []).length; if (n !== ch.n) { ok = false; why = "Use exactly " + ch.n + " print line" + (ch.n > 1 ? "s" : "") + "."; tag = et.too_many_lines || null; } }
          if (ch.kind === "prints_name" && !new RegExp("print\\s*\\(\\s*" + ch.name + "\\s*\\)").test(bare)) { ok = false; why = "Use the variable " + ch.name + " inside print."; tag = et.bypass || "mc.var.bypasses_variable"; }
          if (ch.kind === "no_print_literal" && new RegExp("print\\s*\\(\\s*[\"']" + ch.text + "[\"']\\s*\\)").test(src)) { ok = false; why = "Print the variable, not the text " + ch.text + "."; tag = et.bypass || "mc.var.bypasses_variable"; }
          if (ch.kind === "assign_count") { var m = (src.match(new RegExp("^\\s*" + ch.name + "\\s*=(?!=)", "gm")) || []).length; if (m !== ch.n) { ok = false; why = "Give " + ch.name + " a value " + ch.n + " times (make it, then move it)."; tag = et.bypass || null; } }
        });
      }
      grade(ok, tag, null, null, src.slice(0, 200), why);
    }, function () { btn.disabled = false; btn.textContent = "Run & check"; });
  }

  function grade(ok, tag, fb, optHint, answer, why) {
    var c = RUN.cur, v = c.v, it = c.it;
    c.n++;
    var ms = Date.now() - c.t, rec = null;
    if (c.n === 1) {
      rec = engine.record(it, ok, c.hint);
      if (!RUN.cur.q.retry) RUN.first[RUN.cur.q.slot.slot] = { ok: ok, item: it.id, tag: tag };
    }
    log("attempt", { l: RUN.L.id, slot: c.q.slot.slot, item: it.id, skill: it.skill, correct: ok ? 1 : 0, attempt: c.n, hint: c.hint ? 1 : 0, ms: ms,
      tag: tag || undefined, answer: String(answer || "").slice(0, 60), retry: c.q.retry ? 1 : undefined, mode: ST.mode,
      p_predicted: rec ? rec.p_predicted : undefined, engine_version: Engine.VERSION, source: "client" });
    c.locked = true;
    // mark options
    Array.prototype.forEach.call($main.querySelectorAll(".opt"), function (x) {
      var o = c.order[+x.getAttribute("data-i")];
      if (o === c.sel) x.classList.add(ok ? "right" : "wrong");
      x.disabled = true;
    });
    var m = ok ? (kids() ? "celebrate" : "happy") : "oops";
    var title = ok ? pickOne(kids() ? ["Yes! You got it!", "Awesome!", "Great job!"] : ["Correct", "Nice work", "That's right"]) : (c.n >= 2 ? "Not yet" : "Not quite");
    var text = ok ? (fb || v.explain || "") : (why ? why + " " : "") + (tagFeedback(tag) || fb || "");
    var hintLine = !ok && (optHint || (tag && CAT[tag] && CAT[tag].hint)) ? '<p class="h">Hint: ' + esc(optHint || CAT[tag].hint) + "</p>" : "";
    var html = '<div class="sheet">' + face(m) + '<div><h3>' + esc(title) + "</h3><p>" + md(text) + "</p>" + hintLine + "</div></div>";
    var runBtn = ok && v.body.run_after && v.code ? '<button class="btn btn-sec" id="runIt">' + icon("playground") + "Run it</button>" : "";
    if (ok) html += runBtn ? '<div class="row2">' + runBtn + '<button class="btn btn-ok" id="next">Continue</button></div>' : '<button class="btn btn-ok wide" id="next">Continue</button>';
    else if (c.n >= 2) html += '<div class="row2"><button class="btn btn-sec" id="again">Try again</button><button class="btn btn-bad" id="reveal">Show answer</button></div>';
    else html += '<button class="btn btn-bad wide" id="again">Try again</button>';
    foot(html, ok ? "ok" : "bad");
    var nx = document.getElementById("next"); if (nx) nx.onclick = function () { nextItem(ok); };
    var ri = document.getElementById("runIt"); if (ri) ri.onclick = function () {
      runPython(v.code, document.getElementById("py")).then(function (r) { document.getElementById("runout").innerHTML = outHTML(r); ri.disabled = true; log("run", { item: v.id }); document.getElementById("runout").scrollIntoView({ block: "nearest" }); });
    };
    var ag = document.getElementById("again"); if (ag) ag.onclick = function () { c.locked = false; c.sel = null; c.t2 = Date.now(); clearFoot(); renderItem(); };
    var rv = document.getElementById("reveal"); if (rv) rv.onclick = function () { reveal(); };
  }
  function pickOne(a) { return a[Math.floor(Math.random() * a.length)]; }
  function reveal() {
    var c = RUN.cur, v = c.v, b = v.body, ans = "";
    if (b.options) ans = b.options.filter(function (o) { return o.correct; })[0].text;
    else if (b.bank) ans = b.bank.filter(function (o) { return o.correct; })[0].text;
    else if (b.lines) ans = b.lines.join("\n");
    else ans = b.solution;
    log("reveal", { item: c.it.id, attempts: c.n });
    foot('<div class="sheet">' + face("thinking") + '<div><h3>Here\'s one answer</h3><pre class="code" style="margin:6px 0 0;white-space:pre-wrap">' + esc(ans) + "</pre><p class=\"h\">" + md(v.explain || "") + '</p></div></div><button class="btn btn-primary wide" id="next">Continue</button>', "");
    document.getElementById("next").onclick = function () { nextItem(false); };
  }
  function nextItem(ok) {
    var c = RUN.cur, q = c.q;
    log("item_done", { item: c.it.id, attempts: c.n, ms: Date.now() - c.t, hint: c.hint ? 1 : 0 });
    // a first-try miss brings the same slot back once at the end, with the other candidate
    if (GRADED[c.v.type] && !q.retry && c.n > 0 && RUN.first[q.slot.slot] && !RUN.first[q.slot.slot].ok && RUN.retries < 3) {
      RUN.queue.push({ slot: q.slot, retry: true }); RUN.retries++;
    }
    clearFoot(); RUN.i++; step();
  }
  function finishLesson() {
    var L = RUN.L, f = RUN.first, keys = Object.keys(f), right = keys.filter(function (k) { return f[k].ok; }).length;
    var pct = keys.length ? Math.round(right / keys.length * 100) : 0, ms = Date.now() - RUN.t0;
    ST.done[L.id] = { pct: pct, right: right, n: keys.length, ms: ms, at: Date.now() }; saveST();
    log("lesson_finish", { l: L.id, pct: pct, right: right, n: keys.length, ms: ms, hints: RUN.hints, retries: RUN.retries });
    var order = lessonOrder(), nextL = order[order.indexOf(L.id) + 1], hints = RUN.hints;
    RUN = null; clearFoot(); setPos({ where: "lesson_done", l: L.id });
    var lastUnit = !nextL;
    render('<section class="done-hero">' + face("celebrate") + "<h1>" + (kids() ? "You did it!" : "Lesson complete") + '</h1><p class="lead">' + esc(kids() ? L.kids_summary : L.summary) + "</p></section>" +
      '<div class="stats"><div class="stat"><b>' + pct + '%</b><span>right first try</span></div><div class="stat"><b>' + mins(ms) + '</b><span>minute' + (mins(ms) > 1 ? "s" : "") + '</span></div><div class="stat"><b>' + hints + "</b><span>hint" + (hints === 1 ? "" : "s") + " used</span></div></div>" +
      (lastUnit ? '<div class="banner">' + icon("bell") + "<div><b>That's the whole test.</b> One last thing: tell Excel how it went. It takes 1 minute.</div></div>" +
        '<button class="btn btn-primary wide" id="toFb">Give feedback</button>'
      : '<button class="btn btn-primary wide" id="toNext">Next: ' + esc(lessonTitle(LESSONS[nextL])) + '</button><p class="center"><button class="linkbtn" id="toHome">Back to lessons</button></p>'));
    var b1 = document.getElementById("toFb"); if (b1) b1.onclick = function () { openFeedback("end_of_unit2"); };
    var b2 = document.getElementById("toNext"); if (b2) b2.onclick = function () { startLesson(nextL); };
    var b3 = document.getElementById("toHome"); if (b3) b3.onclick = home;
  }

  /* ---------- feedback ---------- */
  var FB = get("fb", { stars: 0, confused: "", keep: "", other: "" });
  function scrub(s) { // no emails or phone numbers leave the phone
    return String(s || "").replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, "[removed]").replace(/\+?\d[\d\s().-]{6,}\d/g, "[removed]").replace(/\s+/g, " ").trim();
  }
  function cut(s, n) { s = scrub(s); return s.length > n ? s.slice(0, n - 1) + "…" : s; }
  function shortId(id) { return id.replace(/^py\./, "").replace(/\.l\d+\./, " ").replace(/\.([ab])$/, "$1"); }
  function buildSummary() {
    var order = lessonOrder(), lines = [];
    lines.push("Learn with Excel test (" + APP_VERSION + ")");
    lines.push("Age group: " + (ST.age ? ST.age + " (" + (ST.mode === "kids" ? "Kids" : "Adults") + " mode)" : "not chosen"));
    lines.push("Stars: " + (FB.stars ? FB.stars + "/5" : "not given"));
    lines.push("Keep using it: " + (FB.keep || "not answered"));
    lines.push("Confused by: " + (cut(FB.confused, 300) || "-"));
    if (scrub(FB.other)) lines.push("Anything else: " + cut(FB.other, 240));
    var done = order.filter(function (l) { return ST.done[l]; });
    lines.push("Lessons completed: " + done.length + "/" + order.length);
    var atts = LOG.filter(function (e) { return e.e === "attempt"; });
    order.forEach(function (lid, i) {
      var d = ST.done[lid], name = "L" + (i + 1) + " " + LESSONS[lid].title;
      if (d) lines.push(name + ": " + d.pct + "% right first try (" + d.right + "/" + d.n + ")");
      else {
        var firsts = atts.filter(function (a) { return a.l === lid && a.attempt === 1 && !a.retry; });
        if (firsts.length) { var r = firsts.filter(function (a) { return a.correct; }).length; lines.push(name + ": not finished, " + Math.round(r / firsts.length * 100) + "% right so far (" + r + "/" + firsts.length + ")"); }
        else lines.push(name + ": not started");
      }
    });
    var wrong = {};
    atts.forEach(function (a) { if (!a.correct) { var w = wrong[a.item] || (wrong[a.item] = { n: 0, tags: {} }); w.n++; if (a.tag) w.tags[a.tag] = (w.tags[a.tag] || 0) + 1; } });
    var top = Object.keys(wrong).sort(function (a, b) { return wrong[b].n - wrong[a].n; }).slice(0, 3).map(function (id) {
      var w = wrong[id], t = Object.keys(w.tags).sort(function (a, b) { return w.tags[b] - w.tags[a]; })[0];
      return shortId(id) + " x" + w.n + (t ? " (" + t.replace(/^mc\./, "") + ")" : "");
    });
    lines.push("Most missed: " + (top.length ? top.join("; ") : "none"));
    var hints = atts.filter(function (a) { return a.hint && a.attempt === 1; }).length;
    lines.push("Hints used: " + hints);
    lines.push("Quit point: " + quitPoint());
    lines.push("Time spent: " + mins(ST.activeMs) + " min");
    lines.push("Screen: " + (window.screen && screen.width ? screen.width : window.innerWidth) + "px wide");
    lines.push("Engine: " + Engine.VERSION);
    var text = lines.join("\n");
    if (text.length > 1400) text = text.slice(0, 1399) + "…";
    return text;
  }
  function quitPoint() {
    var order = lessonOrder();
    if (order.every(function (l) { return ST.done[l]; })) return "finished all lessons";
    var last = null;
    for (var i = LOG.length - 1; i >= 0; i--) { if (LOG[i].e === "item_shown") { last = LOG[i]; break; } }
    if (!last) return ST.age ? "before starting a lesson" : "age screen";
    var fin = LOG.some(function (e) { return e.e === "lesson_finish" && e.l === last.l && e.t > last.t; });
    if (fin) return "after finishing L" + lessonNo(last.l);
    var stepN = 0; for (var j = LOG.length - 1; j >= 0; j--) { if (LOG[j].e === "lesson_start" && LOG[j].l === last.l) break; if (LOG[j].e === "item_shown" && LOG[j].l === last.l) stepN++; }
    return "L" + lessonNo(last.l) + " step " + stepN + " (" + shortId(last.item) + ")";
  }
  function waURL(text) { return "https://wa.me/" + WA_NUMBER + "?text=" + encodeURIComponent(text); }

  function openFeedback(from) {
    RUN = null; clearFoot(); setPos({ where: "feedback" });
    log("feedback_open", { from: from });
    var star = window.ICONS.star;
    var h = '<section class="fb"><h1>' + (from === "end_of_unit2" ? "You finished! How was it?" : "Tell Excel what you think") + "</h1>" +
      '<p class="muted">4 quick questions. Please don\'t type names, emails or phone numbers.</p>' +
      '<fieldset><legend>How was it?</legend><div class="stars" id="stars">' +
      [1, 2, 3, 4, 5].map(function (n) { return '<button class="star" data-s="' + n + '" aria-label="' + n + ' star' + (n > 1 ? "s" : "") + '"><svg viewBox="' + star.vb + '" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="miter" aria-hidden="true">' + star.inner + "</svg></button>"; }).join("") +
      "</div></fieldset>" +
      '<fieldset><legend><label for="fConf">What confused you?</label></legend><textarea id="fConf" maxlength="400" placeholder="A question, a word, a button… anything"></textarea></fieldset>' +
      '<fieldset><legend>Would you keep using it?</legend><div class="seg" id="keep"><button data-k="yes">Yes</button><button data-k="maybe">Maybe</button><button data-k="no">No</button></div></fieldset>' +
      '<fieldset><legend><label for="fOther">Anything else? <span class="muted small">(optional)</span></label></legend><textarea id="fOther" maxlength="300"></textarea></fieldset>' +
      '<a class="btn btn-wa wide" id="send" href="#" target="_blank" rel="noopener">' + icon("check") + "Send to Excel</a>" +
      '<p class="note">Opens WhatsApp with your answers and your progress already typed. You just tap send.</p>' +
      '<button class="btn btn-sec wide" id="copy" style="margin-top:12px">Copy results</button>' +
      '<p class="note">If WhatsApp doesn\'t open, copy your results and paste them to Excel any way you like.</p>' +
      '<details class="preview"><summary>See exactly what will be sent</summary><pre id="prev"></pre></details>' +
      (ST.mode ? '<p class="center"><button class="linkbtn" id="back">Back to lessons</button></p>' : '<p class="center"><button class="linkbtn" id="back">Back</button></p>') +
      "</section>";
    render(h);
    var conf = document.getElementById("fConf"), oth = document.getElementById("fOther"), send = document.getElementById("send");
    conf.value = FB.confused; oth.value = FB.other;
    function sync() {
      FB.confused = conf.value; FB.other = oth.value; put("fb", FB);
      Array.prototype.forEach.call($main.querySelectorAll(".star"), function (s) { s.classList.toggle("on", +s.getAttribute("data-s") <= FB.stars); });
      Array.prototype.forEach.call($main.querySelectorAll("#keep button"), function (b) { b.classList.toggle("on", b.getAttribute("data-k") === FB.keep); });
      var t = buildSummary(); send.href = waURL(t); document.getElementById("prev").textContent = t;
    }
    Array.prototype.forEach.call($main.querySelectorAll(".star"), function (s) { s.onclick = function () { FB.stars = +s.getAttribute("data-s"); sync(); }; });
    Array.prototype.forEach.call($main.querySelectorAll("#keep button"), function (b) { b.onclick = function () { FB.keep = b.getAttribute("data-k"); sync(); }; });
    conf.addEventListener("input", sync); oth.addEventListener("input", sync);
    send.addEventListener("click", function () { sync(); log("feedback_send", { via: "whatsapp", stars: FB.stars, keep: FB.keep }); });
    document.getElementById("copy").onclick = function () {
      sync(); var t = buildSummary();
      log("feedback_send", { via: "copy", stars: FB.stars, keep: FB.keep });
      copyText(t).then(function () { toast("Copied. Paste it to Excel."); }, function () { toast("Couldn't copy. Open 'See exactly what will be sent' and copy it from there."); });
    };
    document.getElementById("back").onclick = function () { ST.mode ? home() : ageScreen(); };
    sync();
  }
  function copyText(t) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(t);
    return new Promise(function (res, rej) {
      var ta = document.createElement("textarea"); ta.value = t; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.top = "-1000px"; document.body.appendChild(ta);
      ta.select(); ta.setSelectionRange(0, t.length); var ok = false; try { ok = document.execCommand("copy"); } catch (e) {} ta.remove(); ok ? res() : rej();
    });
  }

  /* expose for tests (read-only helpers) */
  window.LWE = { buildSummary: buildSummary, waURL: waURL, log: function () { return LOG; }, engine: engine, state: function () { return ST; } };

  /* ---------- boot ---------- */
  window.addEventListener("pagehide", function () { tick(); if (RUN) log("pagehide_in_lesson", { l: RUN.L.id, step: RUN.i + 1, item: RUN.cur && RUN.cur.it.id }); });
  log("session_start", { app: APP_VERSION, w: window.innerWidth, sw: window.screen ? screen.width : null, age: ST.age || undefined });
  loadContent().then(function () {
    if (!ST.mode) ageScreen(); else home();
  }, function (e) {
    $main.innerHTML = '<div class="card"><h2>Couldn\'t load the lessons</h2><p>Check your connection and reload the page.</p><p class="small muted">' + esc(e.message) + "</p></div>";
  });
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(function () {});
})();
