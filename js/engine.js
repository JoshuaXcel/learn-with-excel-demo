/* Learn with Excel adaptive engine (client copy, demo v3).
   Elo for difficulty (Pelanek 2016) + half-life memory (Settles & Meeder 2016), with the review fixes:
   1. Half-life only grows on a correct answer that comes >= 20h after the last counted answer on that
      skill. Same-session repeats still move the skill estimate (theta), not memory strength.
   2. Any hint used = no mastery credit (no theta gain, no half-life credit) and no item difficulty update.
      A wrong answer after a hint still lowers theta.
   3. A new skill starts at the average theta of the skills already practised (0 for a brand-new learner).
   4. Only the first try on an item updates anything; every attempt record carries engine_version + source. */
(function (root) {
  var ENGINE_VERSION = "lwe-client-0.3.0";
  var A = 1.0, B = 0.05;                       // K = A / (1 + B * n)
  var W0 = -1.4, WC = 2.9, WW = -2.7;          // half-life weights (estimates)
  var H_MIN = 0.01, H_MAX = 180;               // days
  var GAP_MS = 20 * 3600 * 1000;               // spacing gap that counts for memory
  var TARGET = { adults: 0.80, kids: 0.85 };   // target success rate per mode (estimates)
  var DAY = 86400000;

  function K(n) { return A / (1 + B * n); }
  function P(theta, d) { return 1 / (1 + Math.exp(-(theta - d))); }

  function Engine(store) {
    this.store = store || null;
    this.s = (store && store.load()) || { skills: {}, items: {} };
  }
  Engine.VERSION = ENGINE_VERSION;
  Engine.P = P;
  Engine.prototype.save = function () { if (this.store) this.store.save(this.s); };
  Engine.prototype.practised = function () {
    var sk = this.s.skills; return Object.keys(sk).filter(function (k) { return sk[k].n > 0; });
  };
  Engine.prototype.skill = function (id, now) {
    var s = this.s.skills[id];
    if (!s) {
      var pr = this.practised(), self = this;
      var start = pr.length ? pr.reduce(function (a, k) { return a + self.s.skills[k].theta; }, 0) / pr.length : 0;
      s = this.s.skills[id] = { theta: start, n: 0, correct: 0, wrong: 0, last_seen: null, last_mem: null, start: start };
    }
    return s;
  };
  Engine.prototype.itemD = function (it) {
    var r = this.s.items[it.id]; return r ? r.d : it.d0;
  };
  Engine.prototype.predict = function (it) { return P(this.skill(it.skill).theta, this.itemD(it)); };
  /* Pick one candidate for a lesson slot: the one whose predicted success is closest to the target. */
  Engine.prototype.pick = function (cands, mode, avoid) {
    var self = this, target = TARGET[mode] || 0.8;
    var pool = cands.filter(function (c) { return !c.modes || c.modes.indexOf(mode) >= 0; });
    if (!pool.length) pool = cands.slice();
    if (avoid && avoid.length) { var rest = pool.filter(function (c) { return avoid.indexOf(c.id) < 0; }); if (rest.length) pool = rest; }
    var best = null, bestScore = 1e9;
    pool.forEach(function (c) {
      var p = self.predict(c), sc = Math.abs(p - target) + Math.random() * 1e-6;
      if (sc < bestScore) { bestScore = sc; best = { item: c, p: p }; }
    });
    return best;
  };
  Engine.prototype.halfLife = function (id) {
    var s = this.skill(id);
    var h = Math.pow(2, W0 + WC * Math.sqrt(1 + s.correct) + WW * Math.sqrt(1 + s.wrong));
    return Math.min(H_MAX, Math.max(H_MIN, h));
  };
  Engine.prototype.recall = function (id, now) {
    var s = this.skill(id); if (!s.last_seen) return 0;
    return Math.pow(2, -((now || Date.now()) - s.last_seen) / DAY / this.halfLife(id));
  };
  /* Level shown to the learner (spec 6.4, thresholds are estimates). */
  Engine.prototype.level = function (id, items) {
    var s = this.skill(id), self = this;
    if (!s.n) return { n: 0, name: "New" };
    var ds = (items || []).filter(function (it) { return it.skill === id; }).map(function (it) { return self.itemD(it); }).sort(function (a, b) { return a - b; });
    var med = ds.length ? ds[Math.floor(ds.length / 2)] : 0, hard = ds.length ? ds[Math.floor(ds.length * 0.75)] : 0;
    var pMed = P(s.theta, med), pHard = P(s.theta, hard), h = this.halfLife(id);
    if (s.n < 5 || pMed < 0.7) return { n: 1, name: "Learning" };
    if (pHard >= 0.8 && h >= 14) return { n: 4, name: "Mastered" };
    if (h >= 3) return { n: 3, name: "Strong" };
    return { n: 2, name: "Practised" };
  };
  /* Record the FIRST try on an item. Returns the attempt facts the logger stores. */
  Engine.prototype.record = function (it, correct, hintUsed, now) {
    if (now == null) now = Date.now();
    var s = this.skill(it.skill), d = this.itemD(it), p = P(s.theta, d), before = s.theta;
    var item = this.s.items[it.id] || (this.s.items[it.id] = { d: it.d0, n: 0 });
    var c = correct ? 1 : 0, memCounted = false;
    if (!hintUsed) {
      s.theta += K(s.n) * (c - p);
      item.d += K(item.n) * (p - c);
      item.n++;
    } else if (!correct) {
      s.theta += K(s.n) * (0 - p);       // a miss still counts against the skill estimate
    }                                     // hinted + correct: no credit, no change
    s.n++;
    var spaced = s.last_mem == null || (now - s.last_mem) >= GAP_MS;
    if (spaced && !(hintUsed && correct)) {
      if (correct) s.correct++; else s.wrong++;
      s.last_mem = now; memCounted = true;
    }
    s.last_seen = now;
    this.save();
    return { engine_version: ENGINE_VERSION, source: "client", p_predicted: +p.toFixed(3), theta_before: +before.toFixed(3),
             theta_after: +s.theta.toFixed(3), d_before: +d.toFixed(3), item_updated: !hintUsed, memory_counted: memCounted };
  };
  Engine.prototype.reset = function () { this.s = { skills: {}, items: {} }; this.save(); };
  if (typeof module !== "undefined" && module.exports) module.exports = Engine; else root.Engine = Engine;
})(this);
