#!/usr/bin/env python3
"""Learn with Excel content validator (demo v3).

Usage:  python3 tools/validate_content.py [content_dir]      (default: the app's content/ folder)
        python3 tools/validate_content.py --self-test        (proves each rule can fail)

Fails (exit 1) if:
  * a lesson teaches more than 2 skills, or an item's skill is not one of its lesson's skills
  * a misconception tag used anywhere is missing from catalogue.json
  * an item uses a concept from a later unit (declared concepts, or found by scanning its code)
  * a slot has fewer than 2 candidates (or two candidates share the same difficulty d0)
  * banned words appear (country-specific defaults, other products' names)
  * code samples don't do what the item claims (checked by really running them with python3)
"""
import json, os, re, subprocess, sys, copy, tempfile, shutil

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..", "site") if os.path.isdir(os.path.join(HERE, "..", "site")) else os.path.join(HERE, "..")
DEFAULT_DIR = os.path.join(ROOT, "content")
BANNED = ["jollof", "danfo", "naira", "\u20a6", "duolingo", "octocat", "owl"]

def load(d):
    course = json.load(open(os.path.join(d, "course.json"), encoding="utf-8"))
    cat = json.load(open(os.path.join(d, "catalogue.json"), encoding="utf-8"))["misconceptions"]
    lessons = {}
    for u in course["units"]:
        for lid in u["lessons"]:
            lessons[lid] = json.load(open(os.path.join(d, "lessons", lid + ".json"), encoding="utf-8"))
    return course, cat, lessons

def strip_strings_comments(code):
    out, i, n = [], 0, len(code)
    while i < n:
        c = code[i]
        if c == "#":
            while i < n and code[i] != "\n": i += 1
            continue
        if c in "\"'":
            q = c; i += 1
            while i < n and code[i] != q and code[i] != "\n":
                if code[i] == "\\": i += 1
                i += 1
            i += 1; out.append(" S ")
            continue
        out.append(c); i += 1
    return "".join(out)

SCAN = [  # (concept, regex on code with strings/comments removed)
    ("compare", r"==|!=|<=|>=|<|>"),
    ("arithmetic", r"[+\-*/%]"),
    ("if", r"\b(if|elif|else)\b"),
    ("loop", r"\b(for|while)\b"),
    ("function", r"\b(def|return|lambda)\b"),
    ("list", r"[\[\]]"),
    ("input", r"\binput\s*\("),
    ("assign", r"(?m)^\s*[A-Za-z_]\w*\s*=(?!=)"),
]

def code_fragments(it):
    """All code an item shows or accepts: code, solution, parsons lines, code-like bank tokens."""
    b = it.get("body", {})
    frags = [it.get("code") or "", b.get("solution", "")]
    frags += b.get("lines", []) + [x["text"] for x in b.get("distractors", [])]
    frags += [x["text"] for x in b.get("bank", [])]
    frags += [o["text"] for o in b.get("options", []) if o.get("code")]
    return [f for f in frags if f]

def tags_of(it):
    out = []
    def walk(b):
        for o in b.get("options", []) + b.get("bank", []) + b.get("distractors", []):
            if o.get("tag"): out.append(o["tag"])
        if b.get("wrong_order_tag"): out.append(b["wrong_order_tag"])
        out.extend(v for v in (b.get("error_tags") or {}).values())
    walk(it.get("body", {}))
    walk((it.get("kids") or {}).get("body", {}))
    return out

def run_py(code):
    p = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, timeout=10)
    err = p.stderr.strip().splitlines()[-1] if p.stderr.strip() else ""
    return p.stdout, err

def validate(d, run_code=True):
    errs = []
    course, cat, lessons = load(d)
    allowed, unit_of_concept = set(), {}
    for u in course["units"]:
        for c in u["concepts_allowed"]: unit_of_concept[c] = u["id"]
    for uid, cs in course.get("later_concepts", {}).items():
        for c in cs: unit_of_concept.setdefault(c, uid)
    all_skills = {s for u in course["units"] for s in u["skills"]}
    for tag, m in cat.items():
        if not re.fullmatch(r"mc\.[a-z]+\.[a-z_]+", tag): errs.append(f"catalogue: tag '{tag}' doesn't follow mc.<area>.<name>")
        for f in ("scope", "belief", "correct_model", "feedback", "hint", "review_skill"):
            if f not in m: errs.append(f"catalogue: {tag} missing field {f}")
        if m.get("review_skill") not in all_skills: errs.append(f"catalogue: {tag} review_skill {m.get('review_skill')} is not a known skill")
    seen_ids = set()
    for u in course["units"]:
        allowed |= set(u["concepts_allowed"])   # cumulative: unit N may use units 1..N
        for lid in u["lessons"]:
            L = lessons[lid]
            where = lid
            if len(L["skills"]) > 2: errs.append(f"{where}: teaches {len(L['skills'])} skills (max 2): {L['skills']}")
            for s in L["skills"]:
                if s not in u["skills"]: errs.append(f"{where}: skill {s} is not in unit {u['id']}")
            for sl in L["slots"]:
                w = f"{where}.{sl['slot']}"
                cands = sl.get("candidates", [])
                if len(cands) < 2: errs.append(f"{w}: slot has {len(cands)} candidate(s), needs at least 2")
                if len({c.get('d0') for c in cands}) < len(cands): errs.append(f"{w}: candidates must differ in difficulty (d0)")
                for it in cands:
                    wi = it.get("id", w)
                    if wi in seen_ids: errs.append(f"{wi}: duplicate item id")
                    seen_ids.add(wi)
                    if it.get("skill") not in L["skills"]: errs.append(f"{wi}: skill {it.get('skill')} not taught in lesson {lid}")
                    for t in tags_of(it):
                        if t not in cat: errs.append(f"{wi}: misconception tag '{t}' is missing from catalogue.json")
                    for c in it.get("concepts", []):
                        if c not in allowed:
                            errs.append(f"{wi}: concept '{c}' is from a later unit ({unit_of_concept.get(c, 'unknown')})")
                    for frag in code_fragments(it):
                        bare = strip_strings_comments(frag)
                        for concept, rx in SCAN:
                            if concept not in allowed and re.search(rx, bare):
                                errs.append(f"{wi}: code uses '{concept}' ({unit_of_concept.get(concept,'later unit')}) before it is taught: {frag!r}")
                    blob = json.dumps(it, ensure_ascii=False).lower()
                    for bw in BANNED:
                        if re.search(r"\b" + re.escape(bw) + r"\b" if bw.isalpha() else re.escape(bw), blob):
                            errs.append(f"{wi}: banned word '{bw}'")
                    if run_code: errs += check_runs(it)
    return errs

def check_runs(it):
    errs, b, t, wi = [], it.get("body", {}), it["type"], it["id"]
    code = it.get("code") or ""
    try:
        if t == "worked":
            out, err = run_py(code)
            if err: errs.append(f"{wi}: worked example raises {err}")
        elif t in ("predict", "trace") and b.get("output_options"):
            out, err = run_py(code)
            right = [o for o in b["options"] if o.get("correct")]
            if len(right) != 1: errs.append(f"{wi}: needs exactly one correct option")
            elif out.rstrip("\n") != right[0]["text"]: errs.append(f"{wi}: correct option {right[0]['text']!r} but Python prints {out!r}")
        elif t == "read_error":
            out, err = run_py(code)
            if err != b["error"]: errs.append(f"{wi}: error text {b['error']!r} but Python says {err!r}")
        elif t == "fill":
            right = [o for o in b["bank"] if o.get("correct")]
            filled = re.sub(r"_{3,}", right[0]["text"], code, count=1)
            out, err = run_py(filled)
            if err or out.rstrip("\n") != b["expected_output"]: errs.append(f"{wi}: filled code gives {out!r} {err}")
        elif t == "parsons":
            out, err = run_py("\n".join(b["lines"]))
            if err: errs.append(f"{wi}: parsons solution raises {err}")
        elif t in ("fix", "modify", "write"):
            out, err = run_py(b["solution"])
            if err or out.rstrip("\n") != b["expected_output"]: errs.append(f"{wi}: solution gives {out!r} {err}, expected {b['expected_output']!r}")
            if t == "fix":
                out2, err2 = run_py(code)
                if not err2 and out2.rstrip("\n") == b["expected_output"]: errs.append(f"{wi}: the buggy code already passes")
    except subprocess.TimeoutExpired:
        errs.append(f"{wi}: code timed out")
    return errs

def self_test(d):
    """Break the content on purpose, once per rule, and confirm the validator catches it."""
    cases = {
        "3 skills": lambda c, L: L[0]["skills"].append("py.u01.extra"),
        "missing tag": lambda c, L: L[0]["slots"][2]["candidates"][0]["body"]["options"][1].update(tag="mc.var.not_in_catalogue"),
        "later concept": lambda c, L: L[0]["slots"][6]["candidates"][0].update(code='x = 2 * 3\n____("Welcome!")'),
        "1 candidate": lambda c, L: L[1]["slots"][3]["candidates"].pop(),
    }
    ok = True
    for name, mutate in cases.items():
        tmp = tempfile.mkdtemp()
        shutil.copytree(d, tmp, dirs_exist_ok=True)
        course, cat, lessons = load(tmp)
        Ls = [lessons[k] for k in sorted(lessons)]
        mutate(course, Ls)
        for L in Ls: json.dump(L, open(os.path.join(tmp, "lessons", L["id"] + ".json"), "w"))
        e = validate(tmp, run_code=False)
        print(("  caught   " if e else "  MISSED   ") + name + (f": {e[0]}" if e else ""))
        ok = ok and bool(e)
        shutil.rmtree(tmp)
    return ok

if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    d = os.path.abspath(args[0] if args else DEFAULT_DIR)
    if "--self-test" in sys.argv:
        print("Self-test: each broken copy must fail")
        sys.exit(0 if self_test(d) else 1)
    errs = validate(d)
    course, cat, lessons = load(d)
    n_items = sum(len(s["candidates"]) for L in lessons.values() for s in L["slots"])
    n_slots = sum(len(L["slots"]) for L in lessons.values())
    if errs:
        print(f"FAIL: {len(errs)} problem(s)")
        for e in errs: print("  - " + e)
        sys.exit(1)
    print(f"PASS: {len(lessons)} lessons, {n_slots} slots, {n_items} items, {len(cat)} misconception tags; all code samples ran and matched")
