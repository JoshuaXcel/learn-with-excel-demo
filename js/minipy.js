/* minipy: a tiny, instant Python subset for Units 1-2 (print, text, numbers, variables).
   It answers in milliseconds with no download, so lessons work on slow mobile data.
   Anything outside the subset returns {unsupported:true} and the app falls back to real
   Python (Pyodide, loaded lazily). Error messages follow CPython 3.11/3.12 wording. */
(function (root) {
  var BUILTINS = ["abs", "aiter", "all", "anext", "any", "ascii", "bin", "bool", "breakpoint", "bytearray", "bytes", "callable", "chr", "classmethod", "compile", "complex", "copyright", "credits", "delattr", "dict", "dir", "display", "divmod", "enumerate", "eval", "exec", "execfile", "filter", "float", "format", "frozenset", "get_ipython", "getattr", "globals", "hasattr", "hash", "help", "hex", "id", "input", "int", "isinstance", "issubclass", "iter", "len", "license", "list", "locals", "map", "max", "memoryview", "min", "next", "object", "oct", "open", "ord", "pow", "print", "property", "range", "repr", "reversed", "round", "runfile", "set", "setattr", "slice", "sorted", "staticmethod", "str", "sum", "super", "tuple", "type", "vars", "zip"];
  var KEYWORDS = ["False","None","True","and","as","assert","async","await","break","class","continue","def","del","elif","else","except","finally","for","from","global","if","import","in","is","lambda","nonlocal","not","or","pass","raise","return","try","while","with","yield"];
  function Unsupported(why) { this.unsupported = true; this.why = why; }
  function PyErr(type, msg, lineno) { this.type = type; this.msg = msg; this.lineno = lineno; }

  function lexLine(src, ln) {
    var toks = [], i = 0, n = src.length;
    while (i < n) {
      var c = src[i];
      if (c === " " || c === "\t") { i++; continue; }
      if (c === "#") break;
      if (c === '"' || c === "'") {
        if (src.substr(i, 3) === c + c + c) throw new Unsupported("triple quotes");
        var j = i + 1, s = "";
        while (j < n && src[j] !== c) {
          if (src[j] === "\\") {
            var e = src[j + 1];
            if (e === undefined) { j++; break; }
            s += ({ n: "\n", t: "\t", "\\": "\\", "'": "'", '"': '"' })[e] !== undefined ? ({ n: "\n", t: "\t", "\\": "\\", "'": "'", '"': '"' })[e] : "\\" + e;
            j += 2; continue;
          }
          s += src[j]; j++;
        }
        if (j >= n) throw new PyErr("SyntaxError", "unterminated string literal (detected at line " + ln + ")", ln);
        toks.push({ k: "str", v: s }); i = j + 1; continue;
      }
      var m;
      if ((m = /^\d+(\.\d+)?/.exec(src.slice(i)))) {
        if (/^[A-Za-z_]/.test(src.slice(i + m[0].length))) throw new Unsupported("number+name");
        toks.push({ k: "num", v: m[0], f: !!m[1] }); i += m[0].length; continue;
      }
      if ((m = /^[A-Za-z_]\w*/.exec(src.slice(i)))) {
        if (KEYWORDS.indexOf(m[0]) >= 0) throw new Unsupported("keyword " + m[0]);
        toks.push({ k: "name", v: m[0] }); i += m[0].length; continue;
      }
      if (src.substr(i, 2) === "//") { toks.push({ k: "op", v: "//" }); i += 2; continue; }
      if (src.substr(i, 2) === "==" || src.substr(i, 2) === "**") throw new Unsupported("operator");
      if ("()=,+-*/%".indexOf(c) >= 0) { toks.push({ k: "op", v: c }); i++; continue; }
      if (/[\u201C\u201D\u2018\u2019]/.test(c)) throw new PyErr("SyntaxError", "invalid character '" + c + "' (U+" + c.charCodeAt(0).toString(16).toUpperCase() + ")", ln);
      throw new Unsupported("char " + c);
    }
    return toks;
  }

  function parseLine(toks, ln) {
    var p = 0;
    function peek() { return toks[p]; }
    function isOp(v) { return toks[p] && toks[p].k === "op" && toks[p].v === v; }
    var depth = 0;
    toks.forEach(function (t) { if (t.k === "op" && t.v === "(") depth++; if (t.k === "op" && t.v === ")") depth--; });
    if (depth > 0) throw new PyErr("SyntaxError", "'(' was never closed", ln);
    if (depth < 0) throw new PyErr("SyntaxError", "unmatched ')'", ln);
    function primary() {
      var t = toks[p];
      if (!t) throw new PyErr("SyntaxError", "invalid syntax", ln);
      if (t.k === "str") { p++; var s = t.v; while (toks[p] && toks[p].k === "str") { s += toks[p].v; p++; } return { k: "lit", v: { t: "str", v: s } }; }
      if (t.k === "num") { p++; return { k: "lit", v: t.f ? { t: "float", v: parseFloat(t.v) } : { t: "int", v: parseInt(t.v, 10) } }; }
      if (t.k === "name") {
        p++;
        if (isOp("(")) {
          p++; var args = [];
          if (!isOp(")")) {
            while (true) {
              if (toks[p] && toks[p].k === "name" && toks[p + 1] && toks[p + 1].k === "op" && toks[p + 1].v === "=") throw new Unsupported("keyword args");
              args.push(expr());
              if (isOp(",")) { p++; if (isOp(")")) break; continue; }
              break;
            }
          }
          if (!isOp(")")) {
            if (toks[p] && (toks[p].k === "name" || toks[p].k === "str" || toks[p].k === "num")) throw new PyErr("SyntaxError", "invalid syntax. Perhaps you forgot a comma?", ln);
            throw new PyErr("SyntaxError", "invalid syntax", ln);
          }
          p++;
          return { k: "call", f: t.v, args: args };
        }
        return { k: "name", v: t.v };
      }
      if (t.k === "op" && t.v === "(") { p++; var e = expr(); if (!isOp(")")) throw new PyErr("SyntaxError", "invalid syntax", ln); p++; return e; }
      throw new PyErr("SyntaxError", "invalid syntax", ln);
    }
    function unary() { if (isOp("-") || isOp("+")) { var o = toks[p].v; p++; return { k: "neg", o: o, e: unary() }; } return primary(); }
    function term() { var l = unary(); while (isOp("*") || isOp("/") || isOp("//") || isOp("%")) { var o = toks[p].v; p++; l = { k: "bin", o: o, l: l, r: unary() }; } return l; }
    function expr() { var l = term(); while (isOp("+") || isOp("-")) { var o = toks[p].v; p++; l = { k: "bin", o: o, l: l, r: term() }; } return l; }
    if (!toks.length) return null;
    // print "hi"  (Python 2 style)
    if (toks[0].k === "name" && toks[0].v === "print" && toks[1] && (toks[1].k === "str" || toks[1].k === "name" || toks[1].k === "num"))
      throw new PyErr("SyntaxError", "Missing parentheses in call to 'print'. Did you mean print(...)?", ln);
    var st;
    if (toks[0].k === "name" && toks[1] && toks[1].k === "op" && toks[1].v === "=") {
      p = 2; if (p >= toks.length) throw new PyErr("SyntaxError", "invalid syntax", ln);
      st = { k: "assign", n: toks[0].v, e: expr() };
    } else {
      if (toks.some(function (t) { return t.k === "op" && t.v === "="; })) {
        if (toks[0].k === "str" || toks[0].k === "num") throw new PyErr("SyntaxError", "cannot assign to literal here. Maybe you meant '==' instead of '='?", ln);
        throw new Unsupported("complex assignment");
      }
      st = { k: "expr", e: expr() };
    }
    if (p < toks.length) {
      var t = toks[p];
      if (t.k === "name" || t.k === "str" || t.k === "num") throw new PyErr("SyntaxError", "invalid syntax", ln);
      throw new PyErr("SyntaxError", "invalid syntax", ln);
    }
    st.ln = ln; return st;
  }

  // CPython's suggestion rule (Levenshtein, case-only change costs 1, other edits 2).
  function lev(a, b) {
    var MOVE = 2, CASE = 1, d = [];
    for (var i = 0; i <= a.length; i++) { d[i] = [i * MOVE]; }
    for (var j = 0; j <= b.length; j++) d[0][j] = j * MOVE;
    for (i = 1; i <= a.length; i++) for (j = 1; j <= b.length; j++) {
      var ca = a[i - 1], cb = b[j - 1], sub = ca === cb ? 0 : (ca.toLowerCase() === cb.toLowerCase() ? CASE : MOVE);
      d[i][j] = Math.min(d[i - 1][j] + MOVE, d[i][j - 1] + MOVE, d[i - 1][j - 1] + sub);
    }
    return d[a.length][b.length];
  }
  function suggest(name, env) {
    var cands = Object.keys(env).concat(BUILTINS), best = null, bestD = 1e9;
    cands.forEach(function (c) {
      if (c === name) return;
      var max = Math.floor((name.length + c.length + 3) * 2 / 6);
      var dd = lev(name, c);
      if (dd <= max && dd < bestD) { best = c; bestD = dd; }
    });
    return best;
  }
  function tname(v) { return v.t === "str" ? "str" : v.t === "int" ? "int" : v.t === "float" ? "float" : "NoneType"; }
  function repr(v) {
    if (v.t === "str") return v.v;
    if (v.t === "int") return String(v.v);
    if (v.t === "float") { if (!isFinite(v.v)) return v.v > 0 ? "inf" : "-inf"; var s = String(v.v); if (/e/.test(s)) return s.replace(/e([+-])(\d)$/, "e$10$2"); return /\./.test(s) ? s : s + ".0"; }
    return "None";
  }
  function num(v) { return v.t === "int" || v.t === "float"; }
  function evalE(e, env, ln) {
    if (e.k === "lit") return e.v;
    if (e.k === "name") {
      if (Object.prototype.hasOwnProperty.call(env, e.v)) return env[e.v];
      if (BUILTINS.indexOf(e.v) >= 0) throw new Unsupported("builtin as value");
      var s = suggest(e.v, env);
      throw new PyErr("NameError", "name '" + e.v + "' is not defined" + (s ? ". Did you mean: '" + s + "'?" : ""), ln);
    }
    if (e.k === "neg") { var x = evalE(e.e, env, ln); if (!num(x)) throw new PyErr("TypeError", "bad operand type for unary " + e.o + ": '" + tname(x) + "'", ln); return e.o === "-" ? { t: x.t, v: -x.v } : x; }
    if (e.k === "call") {
      if (e.f === "print") {
        if (Object.prototype.hasOwnProperty.call(env, "print")) throw new Unsupported("print reassigned");
        var parts = e.args.map(function (a) { return repr(evalE(a, env, ln)); });
        env.__out.push(parts.join(" ") + "\n");
        return { t: "None" };
      }
      if (Object.prototype.hasOwnProperty.call(env, e.f)) throw new Unsupported("call variable");
      if (BUILTINS.indexOf(e.f) >= 0) throw new Unsupported("builtin " + e.f);
      var sg = suggest(e.f, env);
      // arguments are not evaluated before the name lookup fails
      throw new PyErr("NameError", "name '" + e.f + "' is not defined" + (sg ? ". Did you mean: '" + sg + "'?" : ""), ln);
    }
    if (e.k === "bin") {
      var a = evalE(e.l, env, ln), b = evalE(e.r, env, ln), o = e.o;
      if (num(a) && num(b)) {
        var fl = a.t === "float" || b.t === "float";
        if ((o === "/" || o === "//" || o === "%") && b.v === 0) throw new PyErr("ZeroDivisionError", o === "/" ? "division by zero" : (o === "//" ? "integer division or modulo by zero" : "integer modulo by zero"), ln);
        var r;
        if (o === "+") r = a.v + b.v; else if (o === "-") r = a.v - b.v; else if (o === "*") r = a.v * b.v;
        else if (o === "/") return { t: "float", v: a.v / b.v };
        else if (o === "//") r = Math.floor(a.v / b.v);
        else if (o === "%") r = a.v - b.v * Math.floor(a.v / b.v);
        if (!fl && Math.abs(r) > 9007199254740991) throw new Unsupported("big int");
        return { t: fl ? "float" : "int", v: r };
      }
      if (o === "+" && a.t === "str" && b.t === "str") return { t: "str", v: a.v + b.v };
      if (o === "*" && ((a.t === "str" && b.t === "int") || (a.t === "int" && b.t === "str"))) {
        var s1 = a.t === "str" ? a.v : b.v, k = a.t === "int" ? a.v : b.v;
        if (k * s1.length > 100000) throw new Unsupported("huge string");
        return { t: "str", v: k > 0 ? new Array(k + 1).join(s1) : "" };
      }
      if (o === "+" && a.t === "str") throw new PyErr("TypeError", 'can only concatenate str (not "' + tname(b) + '") to str', ln);
      if (o === "%" && a.t === "str") throw new Unsupported("string formatting");
      var sym = o;
      if (o === "*" && (a.t === "str" || b.t === "str")) throw new PyErr("TypeError", "can't multiply sequence by non-int of type '" + tname(a.t === "str" ? b : a) + "'", ln);
      throw new PyErr("TypeError", "unsupported operand type(s) for " + sym + ": '" + tname(a) + "' and '" + tname(b) + "'", ln);
    }
    throw new Unsupported("expr");
  }

  function run(code) {
    var lines = String(code).replace(/\r\n?/g, "\n").split("\n"), stmts = [];
    try {
      for (var i = 0; i < lines.length; i++) {
        var ln = i + 1, raw = lines[i];
        if (/^\s*(#.*)?$/.test(raw)) continue;
        if (/^\s/.test(raw)) {
          if (i === 0 || stmts.length === 0) throw new PyErr("IndentationError", "unexpected indent", ln);
          throw new PyErr("IndentationError", "unexpected indent", ln);
        }
        var st = parseLine(lexLine(raw, ln), ln);
        if (st) stmts.push(st);
      }
    } catch (e) {
      if (e instanceof Unsupported) return { unsupported: true, why: e.why };
      if (e instanceof PyErr) return result([], e, lines);
      throw e;
    }
    var env = { __out: [] }, out = env.__out;
    try {
      stmts.forEach(function (st) {
        if (st.k === "assign") env[st.n] = evalE(st.e, env, st.ln);
        else evalE(st.e, env, st.ln);
      });
    } catch (e) {
      if (e instanceof Unsupported) return { unsupported: true, why: e.why };
      if (e instanceof PyErr) return result(out, e, lines);
      throw e;
    }
    return result(out, null, lines);
  }
  function result(out, e, lines) {
    var err = null;
    if (e) err = { type: e.type, msg: e.msg, lineno: e.lineno, text: lines[e.lineno - 1], trace: e.type + ": " + e.msg };
    var txt = out.join("");
    return { display: txt, judge: txt, error: err, engine: "mini" };
  }
  var api = { run: run };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.MiniPy = api;
})(this);
