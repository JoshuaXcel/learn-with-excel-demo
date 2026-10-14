#!/usr/bin/env python3
"""End-to-end play-through: age screen -> Kids lesson -> Adults lesson -> feedback -> wa.me URL.
Usage: python3 test/e2e.py BASE_URL [SHOT_PREFIX]"""
import sys, json, re, urllib.parse, time
from playwright.sync_api import sync_playwright
BASE = sys.argv[1].rstrip("/") + "/"
SHOT = sys.argv[2] if len(sys.argv) > 2 else None
errors = []

def lesson_items(page):
    return page.evaluate("""async () => { const c = await (await fetch('content/course.json')).json(); const out = {};
      for (const u of c.units) for (const l of u.lessons) { const L = await (await fetch('content/lessons/' + l + '.json')).json();
        for (const s of L.slots) for (const it of s.candidates) out[it.id] = it; } return out; }""")

def answer(page, items, wrong=False, use_hint=False, shot=None):
    """Answer the current step. Returns the item id."""
    pos = page.evaluate("LWE.state().pos")
    it = items[pos["item"]]
    kids = page.evaluate("LWE.state().mode") == "kids"
    b = dict(it["body"])
    if kids and it.get("kids", {}).get("body"): b.update(it["kids"]["body"])
    t = it["type"]
    if t == "worked":
        page.click("#go"); page.wait_for_selector(".out"); page.click("#go"); return it["id"]
    if t == "analogy":
        page.click("#go"); page.click("#go"); return it["id"]
    if use_hint and page.query_selector("#hintBtn"): page.click("#hintBtn"); page.wait_for_selector(".hintbox")
    if t in ("predict", "trace", "read_error"):
        target = [o for o in b["options"] if bool(o.get("correct")) != wrong][0]["text"]
        for btn in page.query_selector_all(".opt"):
            if btn.inner_text() == target: btn.click(); break
    elif t == "fill":
        target = [o for o in b["bank"] if bool(o.get("correct")) != wrong][0]["text"]
        for btn in page.query_selector_all(".tok"):
            if btn.inner_text() == target: btn.click(); break
    elif t == "parsons":
        lines = list(reversed(b["lines"])) if wrong else b["lines"]
        for ln in lines:
            for btn in page.query_selector_all("#pool .pline"):
                if btn.inner_text() == ln: btn.click(); break
    else:
        code = (it.get("code") or "") if wrong else b["solution"]
        if wrong and not code: code = 'print(Hello)'
        if wrong and code == b.get("solution"): code = code.replace('"', "")
        # type like a phone would: curly quotes get normalised by the app
        page.fill("#ed", code.replace('"', "\u201c", 1) if not wrong else code)
        page.dispatch_event("#ed", "input")
    if shot: page.screenshot(path=shot)
    page.click("#check")
    page.wait_for_selector(".foot.ok, .foot.bad", timeout=15000)
    ok = page.query_selector(".foot.ok") is not None
    if ok == wrong: errors.append(f"{it['id']}: expected {'wrong' if wrong else 'right'} but app said {'right' if ok else 'wrong'}")
    if not ok:
        if page.query_selector("#reveal"): page.click("#reveal")
        else:
            page.click("#again"); return answer(page, items, wrong=False)
    page.click("#next")
    return it["id"]

def play_lesson(page, items, wrong_steps=(), hint_steps=(), shot_step=None, shot_path=None):
    n = 0
    while True:
        page.wait_for_timeout(120)
        pos = page.evaluate("LWE.state().pos")
        if pos["where"] != "lesson": break
        n += 1
        answer(page, items, wrong=n in wrong_steps, use_hint=n in hint_steps, shot=shot_path if n == shot_step else None)
    return n

with sync_playwright() as p:
    br = p.chromium.launch()
    for mode, age in (("kids", "8-13"), ("adults", "14+")):
        ctx = br.new_context(viewport={"width": 375, "height": 812}, device_scale_factor=2, is_mobile=True, has_touch=True)
        page = ctx.new_page()
        page.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
        page.on("console", lambda m: m.type == "error" and errors.append("console: " + m.text))
        page.goto(BASE); page.wait_for_selector(".age-btn"); page.wait_for_load_state("networkidle")
        assert "Adults" not in page.inner_text("main"), "no Adults choice before age"
        if SHOT and mode == "kids": page.screenshot(path=SHOT + "age.png")
        page.click(f'[data-age="{age}"]'); page.wait_for_selector("[data-start]")
        if SHOT and mode == "adults": page.screenshot(path=SHOT + "home-adults.png", full_page=False)
        items = lesson_items(page)
        page.click("[data-start]")
        steps1 = play_lesson(page, items, wrong_steps=(3, 8) if mode == "adults" else (4,), hint_steps=(5,),
                             shot_step=3, shot_path=(SHOT + f"question-{mode}.png") if SHOT else None)
        if SHOT and mode == "kids": page.screenshot(path=SHOT + "lesson-done.png")
        page.click("#toNext")
        steps2 = play_lesson(page, items, wrong_steps=(4, 9) if mode == "adults" else (), shot_step=9 if mode == "adults" else None,
                             shot_path=(SHOT + "code-adults.png") if SHOT else None)
        page.click("#toFb"); page.wait_for_selector("#stars")
        page.click('[data-s="4"]'); page.fill("#fConf", "The name tag idea took me a minute to get.")
        page.click('[data-k="maybe"]'); page.fill("#fOther", "Nice colours"); page.dispatch_event("#fOther", "input")
        if SHOT and mode == "kids": page.screenshot(path=SHOT + "feedback.png")
        page.fill("#fConf", "The tag idea took me a minute. Email me at test@example.com or 08012345678"); page.dispatch_event("#fConf", "input")
        href = page.get_attribute("#send", "href")
        u = urllib.parse.urlparse(href); q = urllib.parse.parse_qs(u.query)
        text = q["text"][0]
        assert u.netloc == "wa.me" and u.path == "/2349064519858", href
        assert "test@example.com" not in text and "08012345678" not in text, "contact details must be scrubbed"
        assert len(text) < 1500, len(text)
        log = page.evaluate("LWE.log()")
        atts = [e for e in log if e["e"] == "attempt"]
        assert atts and all(a["engine_version"] and a["source"] == "client" for a in atts)
        print(f"--- {mode}: lesson steps {steps1}+{steps2}, {len(atts)} attempts logged, message {len(text)} chars, URL {len(href)} chars")
        print(text)
        ctx.close()
    # desktop smoke test
    ctx = br.new_context(viewport={"width": 1366, "height": 860}); page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append("desktop pageerror: " + str(e)))
    page.goto(BASE); page.wait_for_selector(".age-btn")
    if SHOT: page.screenshot(path=SHOT + "desktop-age.png")
    page.click('[data-age="14+"]'); page.wait_for_selector("[data-start]"); page.click("[data-start]"); page.wait_for_selector(".q")
    if SHOT: page.screenshot(path=SHOT + "desktop-lesson.png")
    # the feedback button works mid-lesson
    page.on("dialog", lambda d: d.accept())
    page.click("#fbBtn"); page.wait_for_selector("#stars")
    href = page.get_attribute("#send", "href"); t = urllib.parse.parse_qs(urllib.parse.urlparse(href).query)["text"][0]
    assert "Quit point: L1 step 1" in t, t
    print("--- desktop mid-lesson feedback OK:", [l for l in t.splitlines() if l.startswith("Quit")][0])
    br.close()
print("ERRORS:" if errors else "NO ERRORS", *errors, sep="\n  ")
sys.exit(1 if errors else 0)
