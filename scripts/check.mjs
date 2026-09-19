#!/usr/bin/env node
/**
 * Rize interactive-health checker.
 *
 * Opens every page in manifest.json in a real headless browser and decides
 * whether a student would see a working page. Writes results.json.
 *
 * Exit code 1 if anything is FAIL, 0 otherwise (WARNs never fail the run --
 * a check that cries wolf gets ignored, and then it is worth nothing).
 *
 *   node scripts/check.mjs [--manifest manifest.json] [--out results.json]
 *                          [--concurrency 6] [--only <substring>] [--no-links]
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? dflt : process.argv[i + 1];
};
const flag = (name) => process.argv.includes(`--${name}`);

const MANIFEST = arg('manifest', 'manifest.json');
const OUT = arg('out', 'results.json');
const CONCURRENCY = Number(arg('concurrency', 6));
const ONLY = arg('only', null);
const CHECK_LINKS = !flag('no-links');
const PAGE_TIMEOUT = 35_000;

// Hosts whose failure is never the course's problem. Analytics and font CDNs
// degrade invisibly; a blocked tracker is not a broken page.
const IGNORE_HOSTS = [
  'googletagmanager.com', 'google-analytics.com', 'analytics.google.com',
  'doubleclick.net', 'clarity.ms',
];
// Link targets that legitimately refuse robots. A 403 from these is not rot.
const LINK_UNVERIFIABLE = [
  'linkedin.com', 'x.com', 'twitter.com', 'facebook.com', 'instagram.com',
  'reddit.com', 'bloomberg.com', 'wsj.com', 'ft.com', 'nytimes.com',
];
const ignored = (url) => IGNORE_HOSTS.some((h) => url.includes(h));

/** A CDN URL pinned to a floating major tag ("mathjax@3") will change under us. */
function unpinnedCdn(url) {
  if (!/cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|unpkg\.com/.test(url)) return false;
  if (/@latest|@\d+\/|@\d+$/.test(url)) return true;      // @3/ or @latest
  return !/@\d+\.\d+/.test(url);                           // no minor version at all
}

async function checkPage(browser, entry) {
  const result = {
    id: entry.id, url: entry.url, courses: entry.courses || [],
    title: entry.title || entry.id,
    status: 'OK', fails: [], warns: [], selfCheck: null, links: [],
    checkedAt: new Date().toISOString(),
  };
  const ctx = await browser.newContext({ ignoreHTTPSErrors: false });
  const page = await ctx.newPage();

  const subresourceProblems = [];
  const consoleErrors = [];
  const pageErrors = [];

  page.on('requestfailed', (req) => {
    const u = req.url();
    if (ignored(u) || u === entry.url) return;
    subresourceProblems.push({ url: u, type: req.resourceType(), why: req.failure()?.errorText || 'request failed' });
  });
  page.on('response', (res) => {
    const u = res.url();
    if (ignored(u) || u === entry.url || res.status() < 400) return;
    subresourceProblems.push({ url: u, type: res.request().resourceType(), why: `HTTP ${res.status()}` });
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !ignored(msg.location()?.url || '')) consoleErrors.push(msg.text().slice(0, 300));
  });
  page.on('pageerror', (err) => pageErrors.push(String(err).slice(0, 300)));

  try {
    const resp = await page.goto(entry.url, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT });
    const httpStatus = resp ? resp.status() : 0;
    result.httpStatus = httpStatus;
    if (!resp || httpStatus >= 400) {
      result.fails.push(`Page did not load (HTTP ${httpStatus || 'no response'}).`);
      result.status = 'FAIL';
      await ctx.close();
      return result;
    }
    // Let libraries typeset / widgets mount. networkidle is flaky on pages with
    // polling, so cap it and move on rather than failing a healthy page.
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(600);

    // The page's own <title> reads far better on the status board than a URL slug.
    result.title = (await page.title().catch(() => '')).trim() || entry.id;

    // --- 1. Did anything actually render? -------------------------------
    const visibleText = await page.evaluate(() => (document.body?.innerText || '').trim().length);
    result.visibleText = visibleText;
    const floor = entry.expect?.minVisibleText ?? 300;
    if (visibleText < floor) {
      result.fails.push(`Page rendered only ${visibleText} characters of visible text (expected at least ${floor}). Usually means the page loaded but its content never mounted.`);
    }

    // --- 2. Required elements -------------------------------------------
    for (const sel of entry.expect?.selectors || []) {
      const n = await page.locator(sel).count();
      if (n === 0) result.fails.push(`Expected element "${sel}" is not on the page.`);
    }

    // --- 3. The page's own self-check ------------------------------------
    const sc = await page.evaluate(async () => {
      if (typeof window.__selfCheck !== 'function') return null;
      try { return await window.__selfCheck(); }
      catch (e) { return { ok: false, checks: [{ name: '__selfCheck threw', ok: false, detail: String(e) }] }; }
    }).catch((e) => ({ ok: false, checks: [{ name: '__selfCheck unreachable', ok: false, detail: String(e) }] }));
    result.selfCheck = sc;
    if (sc && sc.ok === false) {
      for (const c of (sc.checks || []).filter((c) => !c.ok)) {
        result.fails.push(`Self-check "${c.name}" failed${c.detail ? `: ${c.detail}` : ''}.`);
      }
      if (!(sc.checks || []).some((c) => !c.ok)) result.fails.push('Self-check reported failure.');
    }
    if (sc === null && entry.expect?.selfCheck === true) {
      result.fails.push('Page is declared as self-checking but exposes no window.__selfCheck().');
    }

    // --- 4. Script and stylesheet failures --------------------------------
    for (const p of subresourceProblems) {
      const msg = `${p.type} failed to load (${p.why}): ${p.url}`;
      if (p.type === 'script' || p.type === 'stylesheet') result.fails.push(msg);
      else result.warns.push(msg);
    }
    if (pageErrors.length) result.fails.push(`JavaScript error on load: ${pageErrors[0]}`);
    for (const c of consoleErrors.slice(0, 3)) result.warns.push(`Console error: ${c}`);

    // --- 5. Rot risk: floating CDN versions --------------------------------
    const srcs = await page.evaluate(() =>
      [...document.querySelectorAll('script[src],link[href]')].map((e) => e.src || e.href));
    for (const s of srcs.filter(unpinnedCdn)) {
      result.warns.push(`Depends on an unpinned CDN version, which can change without notice: ${s}`);
    }

    // --- 6. Outbound links -------------------------------------------------
    if (CHECK_LINKS) {
      const origin = new URL(entry.url).origin;
      result.links = await page.evaluate((o) =>
        [...new Set([...document.querySelectorAll('a[href^="http"]')]
          .map((a) => a.href).filter((h) => !h.startsWith(o)))], origin);
    }
  } catch (e) {
    result.fails.push(`Check could not complete: ${String(e).slice(0, 300)}`);
  } finally {
    await ctx.close().catch(() => {});
  }

  result.status = result.fails.length ? 'FAIL' : result.warns.length ? 'WARN' : 'OK';
  return result;
}

/** HEAD, falling back to GET. Distinguishes dead from merely bot-hostile. */
async function checkLink(url) {
  const unverifiable = LINK_UNVERIFIABLE.some((h) => url.includes(h));
  for (const method of ['HEAD', 'GET']) {
    try {
      const r = await fetch(url, {
        method, redirect: 'follow', signal: AbortSignal.timeout(15_000),
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; rize-interactive-health/1.0)' },
      });
      if (r.ok) return { url, ok: true, status: r.status };
      if ([403, 405, 429, 503].includes(r.status)) {
        if (method === 'GET') return { url, ok: true, status: r.status, note: 'refused automated check' };
        continue;
      }
      return { url, ok: false, status: r.status };
    } catch (e) {
      if (method === 'GET') return unverifiable
        ? { url, ok: true, note: 'refused automated check' }
        : { url, ok: false, status: 0, note: String(e).slice(0, 120) };
    }
  }
  return { url, ok: true, note: 'unverified' };
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
let pages = manifest.pages;
if (ONLY) pages = pages.filter((p) => p.id.includes(ONLY) || p.url.includes(ONLY));
console.log(`Checking ${pages.length} page(s) with concurrency ${CONCURRENCY}...`);

// Prefer Playwright's pinned Chromium. Fall back to the Chrome already on the
// machine, so a local run works before the (slow, occasionally stalling) browser
// download finishes. CI always installs the pinned build.
async function launch() {
  try {
    return await chromium.launch();
  } catch (e) {
    console.warn('Bundled Chromium unavailable, falling back to installed Chrome.');
    return await chromium.launch({ channel: 'chrome' });
  }
}

const browser = await launch();
const results = await pool(pages, CONCURRENCY, async (p) => {
  const r = await checkPage(browser, p);
  console.log(`  ${r.status.padEnd(4)} ${r.id}`);
  return r;
});
await browser.close();

// Outbound links are checked once globally, not per page, so a shared
// reference is not hammered or reported ten times.
let linkReport = [];
if (CHECK_LINKS) {
  const all = [...new Set(results.flatMap((r) => r.links))];
  console.log(`Checking ${all.length} distinct outbound link(s)...`);
  linkReport = (await pool(all, 8, checkLink)).filter((l) => !l.ok);
  const dead = new Map(linkReport.map((l) => [l.url, l]));
  for (const r of results) {
    for (const u of r.links) {
      if (dead.has(u)) {
        r.warns.push(`Outbound link is dead (HTTP ${dead.get(u).status}): ${u}`);
        if (r.status === 'OK') r.status = 'WARN';
      }
    }
  }
}

const summary = {
  generated: new Date().toISOString(),
  total: results.length,
  fail: results.filter((r) => r.status === 'FAIL').length,
  warn: results.filter((r) => r.status === 'WARN').length,
  ok: results.filter((r) => r.status === 'OK').length,
  deadLinks: linkReport.length,
};
writeFileSync(OUT, JSON.stringify({ summary, results }, null, 2));
console.log(`\n${summary.ok} OK  ${summary.warn} WARN  ${summary.fail} FAIL  (${summary.deadLinks} dead outbound links)`);
process.exit(summary.fail > 0 ? 1 : 0);
