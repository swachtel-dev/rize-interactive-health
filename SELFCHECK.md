# The self-check contract

An externally-hosted page can return HTTP 200 and still be useless to a student:
the prose renders, the graph never mounts, the practice questions grade everything
wrong. A link checker cannot see any of that. A self-check can.

**The contract is one function.** A healthy page exposes:

```js
window.__selfCheck()  // → { ok: boolean, checks: [{ name, ok, detail? }] }
```

The automated checker calls it, and any `ok: false` fails the run.

## Why the page author writes the checks

Only the person who built the page knows what "working" means for it. Pushing that
knowledge into the page, rather than into a central tool, is what keeps this from
becoming a system somebody has to maintain. The checker itself never learns anything
about calculus, or about any particular widget. It never changes.

## Writing them

Copy the `selfcheck.js` block out of `template/interactive-page-template.html`, then
register one check per thing that would leave a student stuck if it broke:

```js
SelfCheck.register('curve renders', () => {
  const d = document.getElementById('parabola').getAttribute('d') || '';
  return d.length > 100 || { ok: false, detail: 'parabola path is empty' };
});
```

A check may return:

| Return | Meaning |
|---|---|
| `true` or `undefined` | passed |
| `false` | failed, no detail |
| `{ ok, detail }` | failed with an explanation that lands in the status page |
| a Promise of any of the above | awaited |

A throw is a failure, reported with the error text.

## What to check

Check the things that fail silently. Roughly one per interactive element:

- **A visual mounted.** The SVG path has points, the canvas is not blank, the chart
  library actually drew something. This is the single highest-value check, because a
  missing graph looks like a design choice rather than a defect.
- **An input changes the output.** Drive the control programmatically and assert a
  known value. `h = 2` must give slope `4`. This catches a broken handler, which no
  amount of looking at the page will reveal.
- **Every comprehension check grades correctly.** Loop over the options, select each,
  grade it, and assert the right one is marked right and the wrong ones wrong. This is
  the check that catches an answer key edited into the wrong shape.
- **Content that comes from data is present.** If the page builds question cards from an
  array, assert the expected count. An array trimmed to zero renders a clean, empty page.

Do not check prose, styling, or anything a human would notice immediately. Those are not
the failures that survive to a live semester.

## Rules

1. **Leave no trace.** Checks run in a real browser on the live page. If a check clicks
   things, it resets what it touched (see the template's grading check).
2. **Cheap.** The whole `__selfCheck()` should finish well under a second. No network.
3. **Deterministic.** No randomness, no timing races, no dependence on viewport size.
   A check that fails one run in ten trains everyone to ignore red.
4. **Specific `detail`.** The text lands verbatim on the status board that instructors
   and Greg read. "expected slopes 4 and 2.05, got 4 and NaN" is a diagnosis. "failed"
   is not.

## Pages without a self-check

Still checked, just more shallowly: loads, renders visible text, scripts and stylesheets
resolve, no JavaScript errors, outbound links alive. That is a real floor and it catches
the common failures. Add a self-check when a page has an interactive part worth trusting.

To require one, set `"selfCheck": true` in that page's `expect` block in `manifest.json`;
the run then fails if the function is missing.

## Also: no CDNs

The checker warns about scripts loaded from a floating version (`mathjax@3`, `@latest`).
Vendor the library into the repo instead. A page with no external runtime dependency can
only break when somebody edits it, which the checker catches on the very next push.

## What a self-check cannot catch

A self-check verifies that the page does what its own code says it should. If the answer
key itself is wrong, the grading logic and the key agree with each other and every check
passes. The same goes for prose that is misleading but renders fine, and for a graph that
draws the wrong function correctly.

That is not a gap to engineer around. It is the line between mechanical health, which a
robot should own forever, and pedagogical correctness, which belongs to the ID and the
SME at build time. Do not let a green board stand in for a content review.
