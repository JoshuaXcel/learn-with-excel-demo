# Learn with Excel · demo v3 (early test build)

**Try it:** https://joshuaxcel.github.io/learn-with-excel-demo/

> **If github.io doesn't open on your network, use https://learnwithexcel.sites.tab.bot/**

Learn with Excel is a game-like app that teaches Python to complete beginners, with a Kids mode (ages 8–13) and an Adults mode (14+). This repo is a small **test build**: two short lessons, made to find out where real beginners get stuck before the backend is built.

## What's in it

- **Age screen first.** "How old are you?" → 8–13 goes to Kids mode, 14+ to Adults. Only the age group is stored, on the tester's phone. No names, birthdays or accounts.
- **Unit 1 (print and text) and Unit 2 (variables)**, one lesson each, 10 steps per lesson, loaded from static JSON in `content/`.
- **Lesson steps are slots.** Each step has 2 candidate items at different difficulty, and the engine picks one for each learner.
- **Adaptive engine in the browser** (`js/engine.js`): an Elo-style skill estimate plus memory half-life. Half-life only grows on a correct answer after a gap of 20+ hours. A hint means no mastery credit and no item-difficulty update. A new skill starts at the average of the skills already practised. Every attempt record carries `engine_version` and `source: "client"`.
- **Python runs on the phone.** Units 1–2 code runs instantly in a tiny built-in interpreter (`js/minipy.js`, which matches CPython's output and error messages for this subset). Anything outside that subset loads real Python (Pyodide) on demand.
- **Test logging, no backend.** Events (session, age group, lesson start/finish, every attempt with item id, correct, attempt number, hint, time, quit point, total time) are saved in the tester's `localStorage`.
- **Feedback screen** (at the end, and from the **Give feedback** button at any time): stars, "What confused you?", "Would you keep using it?" and an optional note. **Send to Excel** opens WhatsApp with a short summary already typed: age group, answers, lessons completed, % right per lesson, the 3 most-missed items, quit point, minutes spent and screen width. **Copy results** copies the same text. Emails and phone numbers typed into the answers are removed before sending.

## Check the content

```
python3 tools/validate_content.py              # must print PASS
python3 tools/validate_content.py --self-test  # breaks a copy on purpose; every rule must catch it
```

The validator fails if a lesson teaches more than 2 skills, a misconception tag is missing from `content/catalogue.json`, an item uses a concept from a later unit (declared, or found by scanning its code: arithmetic, comparisons, loops, etc.), or a slot has fewer than 2 candidates. It also runs every code sample with Python and checks that the answers match the real output and error messages.

Other tests: `node test/engine.test.js`, `node test/minipy.test.js` (compares the mini interpreter with real Python), and `python3 test/e2e.py <url>` (a Playwright play-through of both modes).

## Run it locally

```
python3 -m http.server 8000
```
Then open http://localhost:8000. All paths are relative, so it works from any folder or subpath.

## Debug

Add `?debug=1` to the URL to see the engine's state and a button that resets this phone's test data.

Early test build: content and engine numbers are estimates and will change.


## Content bundle
The app boots from `js/content.js` (generated, no network fetch needed). After editing any file in `content/`, run:

```
python3 tools/build_content.py
python3 tools/validate_content.py
```
