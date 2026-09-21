# TRIAGE: a run failed, now what

You are probably here from a failure email or a run summary. Read this before
investigating anything; most of the work is already done for you.

**First: open the run summary, not the logs.** The failure email links to the run. The
summary at the top of that page states the failure class and, for a content failure,
names every broken page with its course and its diagnosis. You usually do not need the
logs at all.

There are exactly two failure classes and they need opposite responses.

---

## 🔴 CONTENT FAILURE: a page students use is broken

The summary says so, and `results.json` has `summary.fail > 0`.

This is real and it is student-facing. Someone is looking at a broken page right now, or
will be when the term starts.

1. **Read the diagnosis in the summary.** It is written to be a diagnosis, not a label:
   "Self-check 'curve renders' failed: parabola path is empty", not "failed".
2. **Open the page yourself and look at it.** These fail in ways that look fine. A page
   can render its title, its instructions and a running timer with zero questions on it.
   Do not conclude from the status code.
3. **Find the page's own repo.** The manifest entry's `url` gives it away: the path
   segment after the github.io host is the repo name. Clone that, not this one.
4. **Diff against a working sibling if there is one.** This is the fastest route by a
   wide margin. Two of the three defects found on day one were shape mismatches where an
   identical renderer sat beside working data in a sibling file. Compare the data, not
   just the code.
5. **Fix, verify locally, then push.** Verify by running this checker against the local
   file before pushing:
   `node scripts/check.mjs --manifest <(...) --no-links`, or at minimum load the page and
   exercise the thing that broke.
6. **Confirm green.** GitHub Pages takes a minute to redeploy. Then re-run this workflow
   (`gh workflow run "Check interactive pages" --repo swachtel-dev/rize-interactive-health`)
   and check the board.

### Failure modes seen so far, with their real causes

| Symptom in the summary | What it turned out to be |
|---|---|
| `JavaScript error on load: q.choices.forEach is not a function` | Generated question data stored `choices` as an object keyed A-E; the renderer needs an array. The renderer was byte-identical to a working sibling exam, so the fix was the data, not the code. |
| `JavaScript error on load: Cannot set properties of undefined (setting 'item-N')` | Per-item values assigned by inline `<script>` blocks in the body, which run long before the main script initialised the map. Every numeric question lost its expected answer, and the grader's null branch styled *every* answer green. Fixed by initialising the map in `<head>`. |
| `Page rendered only N characters of visible text` | The page loaded but its content never mounted. Usually an exception earlier in the same script. |
| `Page did not load (HTTP 404)` | Either the page moved and Sanity still points at the old URL, or a manifest entry is stale. Check which side is wrong before editing either. |

**Shape bugs in generated content are the pattern.** When a build script emits the data a
page renders, the two drift silently and nothing catches it until a student does.

---

## 🟠 INFRASTRUCTURE FAILURE: the pages are fine, the run is not

The summary says so: every checked page passed, and a step of the workflow itself failed.
**Nothing is student-facing here.** Do not go looking for a broken page; there isn't one.

Known cause, and the reason this class exists at all: **two runs publishing the status
board at once.** Run A checks 52 pages, which takes about 90 seconds; if anything else
pushes to `main` in that window, run A's `git push` is rejected as non-fast-forward and
the run fails with every page healthy. This happened on 2026-09-21 and sent a false
alarm. It is now mitigated two ways, so if you see it again both have failed:

- a `concurrency` group queues runs instead of overlapping them
- the publish step rebases and retries three times before giving up

Other things in this class: `npm ci` or the Playwright browser download failing (GitHub
or network flake, just re-run), or the checkout lacking write permission (Settings →
Actions → General → Workflow permissions → Read and write).

**Response:** re-run the workflow. If it passes, you are done and there is nothing to
report beyond noting the flake. If the same step fails twice, fix the workflow.

---

## Neither? Read the summary again

If `summary.fail` is 0 and no step failed, the run succeeded and the email was about
something else. WARN never fails a run, deliberately: third-party link rot is constant
and mostly not the course's fault, and a board that goes red every week gets ignored.

---

## Orientation, if you are new to this repo

- **What this is and what it checks:** [`README.md`](README.md)
- **What a page must do to pass:** [`SELFCHECK.md`](SELFCHECK.md)
- **Setting it up for another ID:** [`FOR-CLAUDES.md`](FOR-CLAUDES.md)
- **Whether an interactive page is allowed at all, and the rules for building one:**
  `standards/interactive-pages.md` in the Workbench repo
  (`~/Desktop/Mucking/projects/hacking/repos/coursedev/`). That is the governing
  standard; this repo is the enforcement.
- **Source of truth:** the working copy is `projects/coursedev/interactive-health/` on
  Samuel's machine; `swachtel-dev/rize-interactive-health` on GitHub is the published
  copy. Edit the local one and publish. Pathway:
  `coursedev/interactive-health-MAINTAINING.md`.

Two things that will waste your time if you do not know them:

- **Never use GROQ `match` on `markDefs` hrefs** when regenerating the manifest from
  Sanity. It returns true against the null hrefs in that array and silently selects every
  document in the dataset. Use `string::startsWith`. The correct query is
  `scripts/sanity_urls.groq`.
- **The manifest holds exact URLs, deep links and query strings included.** A deep link
  can 404 while the repo's home page is perfectly healthy, so checking repo roots proves
  nothing.
