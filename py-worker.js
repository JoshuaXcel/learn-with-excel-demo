/* Runs Python (Pyodide) off the main thread so the app stays smooth on cheap phones. */
var PYODIDE_URL = "https://cdn.jsdelivr.net/pyodide/v0.27.8/full/";
var pyodide = null;
var HARNESS = [
"import sys, traceback, json",
"class _Out:",
"    def __init__(self): self.disp = []; self.judge = []",
"    def write(self, s):",
"        s = str(s); self.disp.append(s); self.judge.append(s); return len(s)",
"    def flush(self): pass",
"def _lwe_run(code, inputs):",
"    out = _Out(); feed = list(inputs)",
"    def _input(prompt=''):",
"        prompt = str(prompt)",
"        if not feed:",
"            out.disp.append(prompt)",
"            raise EOFError('EOF when reading a line')",
"        v = feed.pop(0)",
"        out.disp.append(prompt + v + '\\n')",
"        return v",
"    g = {'__name__': '__main__', 'input': _input}",
"    old = sys.stdout, sys.stderr",
"    sys.stdout = out; sys.stderr = out",
"    err = None",
"    try:",
"        exec(compile(code, 'main.py', 'exec'), g)",
"    except SystemExit:",
"        pass",
"    except BaseException as e:",
"        err = {'type': type(e).__name__, 'msg': str(e), 'lineno': None, 'text': None}",
"        if isinstance(e, SyntaxError):",
"            err['msg'] = e.msg; err['lineno'] = e.lineno; err['text'] = e.text",
"        else:",
"            for fr in traceback.extract_tb(e.__traceback__):",
"                if fr.filename == 'main.py':",
"                    err['lineno'] = fr.lineno; err['text'] = fr.line",
"        err['trace'] = ''.join(traceback.format_exception_only(type(e), e)).strip()",
"    finally:",
"        sys.stdout, sys.stderr = old",
"    return json.dumps({'display': ''.join(out.disp), 'judge': ''.join(out.judge), 'error': err})"
].join("\n");

async function boot() {
  importScripts(PYODIDE_URL + "pyodide.js");
  pyodide = await loadPyodide({ indexURL: PYODIDE_URL });
  pyodide.runPython(HARNESS);
  return pyodide.runPython("import sys; sys.version.split()[0]");
}
var ready = null;
self.onmessage = async function (ev) {
  var d = ev.data;
  try {
    if (d.cmd === "init") {
      if (!ready) ready = boot();
      var ver = await ready;
      self.postMessage({ id: d.id, ok: true, version: ver });
    } else if (d.cmd === "run") {
      if (!ready) ready = boot();
      await ready;
      var fn = pyodide.globals.get("_lwe_run");
      var res = fn(d.code, pyodide.toPy(d.inputs || []));
      fn.destroy();
      self.postMessage({ id: d.id, ok: true, result: JSON.parse(res) });
    }
  } catch (err) {
    self.postMessage({ id: d.id, ok: false, error: String(err && err.message || err) });
  }
};
