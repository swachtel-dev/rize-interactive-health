#!/usr/bin/env node
/**
 * Turns results.json into docs/index.html -- the human-readable status board.
 * This is the page linked from the instructor briefing folder, so it is written
 * for someone who has never seen the checker: plain language, no jargon, and a
 * clear instruction for what to do when something is red.
 *
 *   node scripts/render_status.mjs [--in results.json] [--out docs/index.html]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i === -1 ? d : process.argv[i + 1]; };
const IN = arg('in', 'results.json');
const OUT = arg('out', 'docs/index.html');
// Set HELPDESK_URL (repo variable) to turn this into a real link. Unset, it stays
// plain text rather than shipping a guessed URL to instructors.
const TICKET_URL = process.env.HELPDESK_URL || '';

const { summary, results } = JSON.parse(readFileSync(IN, 'utf8'));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const byCourse = new Map();
for (const r of results) {
  for (const c of (r.courses.length ? r.courses : ['Not referenced by a live course'])) {
    if (!byCourse.has(c)) byCourse.set(c, []);
    byCourse.get(c).push(r);
  }
}
const rank = { FAIL: 0, WARN: 1, OK: 2 };
const courses = [...byCourse.entries()].sort((a, b) => {
  const s = Math.min(...a[1].map((r) => rank[r.status])) - Math.min(...b[1].map((r) => rank[r.status]));
  return s || a[0].localeCompare(b[0]);
});

const when = new Date(summary.generated);
const stamp = when.toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short', timeZone: 'America/New_York' });

const headline = summary.fail
  ? `${summary.fail} page${summary.fail === 1 ? '' : 's'} need attention`
  : summary.warn
    ? 'Everything is working. Some pages have minor notes.'
    : 'Everything is working.';

const card = (r) => `
      <li class="page ${r.status.toLowerCase()}">
        <div class="page-head">
          <span class="dot" aria-hidden="true"></span>
          <a href="${esc(r.url)}">${esc(r.title || r.id)}</a>
          <span class="badge">${r.status === 'OK' ? 'Working' : r.status === 'WARN' ? 'Note' : 'Broken'}</span>
        </div>
        ${r.fails.length ? `<ul class="detail bad">${r.fails.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
        ${r.warns.length ? `<ul class="detail meh">${r.warns.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
      </li>`;

const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Rize interactive pages status</title>
<style>
  :root{color-scheme:light dark;
    --bg:#faf9f7; --card:#fff; --ink:#1b1a18; --muted:#6b6862; --line:#e5e1da;
    --ok:#3f8f5f; --warn:#b07d1a; --bad:#c0392b; --accent:#2c3e6b;}
  @media (prefers-color-scheme:dark){:root{
    --bg:#16161a; --card:#1f1f25; --ink:#eceaf0; --muted:#a09daa; --line:#32323c;
    --ok:#6fc48c; --warn:#e0ad4a; --bad:#ef7566; --accent:#9db2e8;}}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);
    font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;}
  .wrap{max-width:60rem;margin:0 auto;padding:2.5rem 1.25rem 4rem}
  h1{font-size:1.65rem;margin:0 0 .3rem;letter-spacing:-.01em}
  .stamp{color:var(--muted);font-size:.9rem;margin:0 0 1.75rem}
  .summary{background:var(--card);border:1px solid var(--line);border-radius:12px;
    padding:1.1rem 1.25rem;margin-bottom:1.5rem}
  .summary h2{margin:0 0 .5rem;font-size:1.1rem}
  .counts{display:flex;flex-wrap:wrap;gap:1.25rem;margin:.6rem 0 0;padding:0;list-style:none;font-size:.92rem}
  .counts b{font-variant-numeric:tabular-nums}
  .what{margin:1rem 0 0;padding-top:.9rem;border-top:1px solid var(--line);
    font-size:.92rem;color:var(--muted)}
  .what a{color:var(--accent)}
  h3{font-size:1rem;margin:2rem 0 .6rem;letter-spacing:.02em;text-transform:uppercase;color:var(--muted)}
  ul.pages{list-style:none;margin:0;padding:0;display:grid;gap:.6rem}
  .page{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:.8rem 1rem}
  .page-head{display:flex;align-items:center;gap:.6rem;flex-wrap:wrap}
  .page-head a{color:var(--ink);font-weight:600;text-decoration:none;word-break:break-word}
  .page-head a:hover{text-decoration:underline}
  .dot{width:.65rem;height:.65rem;border-radius:50%;flex:none}
  .ok .dot{background:var(--ok)} .warn .dot{background:var(--warn)} .fail .dot{background:var(--bad)}
  .badge{margin-left:auto;font-size:.76rem;letter-spacing:.04em;text-transform:uppercase;color:var(--muted)}
  .ok .badge{color:var(--ok)} .warn .badge{color:var(--warn)} .fail .badge{color:var(--bad)}
  .detail{margin:.55rem 0 0;padding-left:1.15rem;font-size:.87rem;line-height:1.45}
  .detail.bad{color:var(--bad)} .detail.meh{color:var(--muted)}
  footer{margin-top:3rem;padding-top:1rem;border-top:1px solid var(--line);
    color:var(--muted);font-size:.85rem}
</style></head><body><div class="wrap">

<h1>Rize interactive pages</h1>
<p class="stamp">Last checked ${esc(stamp)} Eastern. Checked automatically every week and before each term.</p>

<div class="summary">
  <h2>${esc(headline)}</h2>
  <ul class="counts">
    <li><b>${summary.ok}</b> working</li>
    <li><b>${summary.warn}</b> with notes</li>
    <li><b>${summary.fail}</b> broken</li>
    <li><b>${summary.total}</b> pages total</li>
  </ul>
  <p class="what"><strong>Instructors:</strong> you do not need to check anything on this page yourself.
  If a page below is marked <strong>Broken</strong>, or if a page looks wrong to you while teaching,
  ${TICKET_URL ? `<a href="${esc(TICKET_URL)}">file a helpdesk ticket</a>` : 'file a helpdesk ticket'} and say which page.
  Everything not marked Broken was confirmed working on the date above.</p>
</div>

${courses.map(([course, rs]) => `<h3>${esc(course)}</h3>
<ul class="pages">${rs.sort((a, b) => rank[a.status] - rank[b.status]).map(card).join('')}</ul>`).join('\n')}

<footer>
  Generated by <code>rize-interactive-health</code>. Each page is opened in a real browser and
  checked for: the page loading, its content rendering, its scripts and styles loading, its own
  built-in self-check passing, and its outward links still resolving.
  Source of truth for what gets checked is <code>manifest.json</code>.</p>
  <p><a href="guide.html">How this works, and how to set it up for another course</a>.
</footer>
</div></body></html>
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, html);
console.log(`Wrote ${OUT} (${summary.ok} OK / ${summary.warn} WARN / ${summary.fail} FAIL)`);
