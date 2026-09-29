// Exploratory QA run against the local RealWorld (Conduit) app.
// Usage: node qa.js   (frontend on :4100, API on :3000)
const { chromium } = require('playwright');
const fs = require('fs');

const APP = 'http://localhost:4100';
const API = 'http://localhost:3000/api';
const SHOTS = 'screenshots';
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const log = (id, title, status, detail) => {
  results.push({ id, title, status, detail });
  console.log(`[${status}] ${id} ${title} :: ${detail}`);
};
const uid = Date.now().toString().slice(-6);
const u1 = { username: `qa1_${uid}`, email: `qa1_${uid}@test.com`, password: 'Password123!' };
const u2 = { username: `qa2_${uid}`, email: `qa2_${uid}@test.com`, password: 'Password123!' };

async function api(method, path, body, token) {
  const t0 = Date.now();
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Token ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json, ms: Date.now() - t0 };
}

async function signUp(page, u) {
  await page.goto(`${APP}/register`);
  await page.fill('input[placeholder="Username"]', u.username);
  await page.fill('input[placeholder="Email"]', u.email);
  await page.fill('input[placeholder="Password"]', u.password);
  await page.click('button:has-text("Sign up")');
}
async function logIn(page, u) {
  await page.goto(`${APP}/login`);
  await page.fill('input[placeholder="Email"]', u.email);
  await page.fill('input[placeholder="Password"]', u.password);
  await page.click('button:has-text("Sign in")');
}
async function check(id, title, fn) {
  try { await fn(); } catch (e) { log(id, title, 'ERROR', e.message.split('\n')[0]); }
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('console', m => m.type() === 'error' && consoleErrors.push(m.text()));
  page.on('pageerror', e => consoleErrors.push('PAGEERROR ' + e.message));
  const dialogs = [];
  page.on('dialog', async d => { dialogs.push(d.message()); await d.dismiss(); });

  // ---------- SIGN UP ----------
  await check('S1', 'Happy-path sign up', async () => {
    await signUp(page, u1);
    await page.waitForTimeout(2000);
    const loggedIn = await page.locator(`a:has-text("${u1.username}")`).count();
    await page.screenshot({ path: `${SHOTS}/S1_signup.png` });
    log('S1', 'Happy-path sign up', loggedIn ? 'PASS' : 'FAIL', `url=${page.url()}`);
  });

  await check('S2', 'Weak password accepted', async () => {
    const r = await api('POST', '/users', { user: { username: `weak_${uid}`, email: `weak_${uid}@t.com`, password: '1' } });
    log('S2', 'Weak password (1 char) accepted', r.status < 300 ? 'BUG' : 'PASS', `HTTP ${r.status}`);
  });

  await check('S3', 'Invalid email format accepted', async () => {
    const r = await api('POST', '/users', { user: { username: `bad_${uid}`, email: `notanemail${uid}`, password: 'Password123!' } });
    log('S3', 'Invalid email format accepted', r.status < 300 ? 'BUG' : 'PASS', `HTTP ${r.status} ${JSON.stringify(r.json).slice(0, 150)}`);
  });

  await check('S4', 'Duplicate email error message (UI)', async () => {
    const p = await ctx.browser().newPage();
    await signUp(p, { ...u1, username: `dup_${uid}` });
    await p.waitForTimeout(2000);
    const errs = await p.locator('.error-messages').innerText().catch(() => '');
    await p.screenshot({ path: `${SHOTS}/S4_duplicate_email.png` });
    log('S4', 'Duplicate email shows clear error', errs ? 'INFO' : 'BUG', `shown: "${errs.replace(/\n/g, ' | ')}"`);
    await p.close();
  });

  await check('S5', 'Empty sign-up form', async () => {
    const p = await ctx.browser().newPage();
    await p.goto(`${APP}/register`);
    await p.click('button:has-text("Sign up")');
    await p.waitForTimeout(1500);
    const errs = await p.locator('.error-messages').innerText().catch(() => '');
    await p.screenshot({ path: `${SHOTS}/S5_empty_signup.png` });
    log('S5', 'Empty sign-up form validation', 'INFO', `shown: "${errs.replace(/\n/g, ' | ')}"`);
    await p.close();
  });

  await check('S6', 'Whitespace / very long username', async () => {
    const r = await api('POST', '/users', { user: { username: '   ', email: `ws_${uid}@t.com`, password: 'Password123!' } });
    const r2 = await api('POST', '/users', { user: { username: 'x'.repeat(5000), email: `long_${uid}@t.com`, password: 'Password123!' } });
    log('S6', 'Whitespace-only username / 5000-char username', (r.status < 300 || r2.status < 300) ? 'BUG' : 'PASS', `whitespace HTTP ${r.status}, long HTTP ${r2.status}`);
  });

  // ---------- LOGIN / SESSION ----------
  let token;
  await check('L1', 'JWT stored in localStorage', async () => {
    const ls = await page.evaluate(() => Object.assign({}, window.localStorage));
    token = ls.jwt;
    log('L1', 'JWT readable from localStorage', token ? 'BUG' : 'PASS', `keys=${Object.keys(ls).join(',')}`);
  });

  await check('L2', 'Wrong password message', async () => {
    const p = await ctx.browser().newPage();
    await logIn(p, { ...u1, password: 'wrong' });
    await p.waitForTimeout(2000);
    const errs = await p.locator('.error-messages').innerText().catch(() => '');
    await p.screenshot({ path: `${SHOTS}/L2_wrong_password.png` });
    log('L2', 'Wrong password shows message', errs ? 'INFO' : 'BUG', `shown: "${errs.replace(/\n/g, ' | ')}"`);
    await p.close();
  });

  await check('L3', 'Brute force / rate limit', async () => {
    const codes = [];
    for (let i = 0; i < 20; i++) codes.push((await api('POST', '/users/login', { user: { email: u1.email, password: 'bad' + i } })).status);
    log('L3', 'No rate limiting on login (20 bad attempts)', codes.includes(429) ? 'PASS' : 'BUG', `codes=${[...new Set(codes)].join(',')}`);
  });

  await check('L4', 'Token expiry', async () => {
    if (!token) throw new Error('no token');
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    const days = payload.exp ? ((payload.exp * 1000 - Date.now()) / 86400000).toFixed(1) : 'never';
    log('L4', 'JWT lifetime', 'INFO', `payload=${JSON.stringify(payload)} expiresIn(days)=${days}`);
  });

  // ---------- ARTICLES ----------
  let slug;
  await check('A1', 'Create article (happy path)', async () => {
    await page.goto(`${APP}/editor`);
    await page.fill('input[placeholder="Article Title"]', `QA article ${uid}`);
    await page.fill('input[placeholder="What\'s this article about?"]', 'desc');
    await page.fill('textarea[placeholder="Write your article (in markdown)"]', '# Hello\nBody text');
    await page.click('button:has-text("Publish Article")');
    await page.waitForTimeout(2500);
    slug = page.url().includes('/article/') ? page.url().split('/article/')[1] : null;
    await page.screenshot({ path: `${SHOTS}/A1_create_article.png` });
    log('A1', 'Create article', slug ? 'PASS' : 'FAIL', `url=${page.url()}`);
  });

  await check('A2', 'XSS in article body', async () => {
    const r = await api('POST', '/articles', { article: { title: `XSS ${uid}`, description: 'x', body: '<img src=x onerror="window.__xss=1;alert(\'xss\')"> <script>window.__xss2=1</script>', tagList: [] } }, token);
    const s = r.json?.article?.slug;
    dialogs.length = 0;
    await page.goto(`${APP}/article/${s}`);
    await page.waitForTimeout(2500);
    const fired = await page.evaluate(() => !!window.__xss || !!window.__xss2);
    await page.screenshot({ path: `${SHOTS}/A2_xss.png` });
    log('A2', 'Stored XSS via article markdown', (fired || dialogs.length) ? 'BUG' : 'PASS', `HTTP ${r.status} scriptRan=${fired} dialogs=${JSON.stringify(dialogs)}`);
  });

  await check('A3', 'Very long title', async () => {
    const r = await api('POST', '/articles', { article: { title: 'L'.repeat(10000) + uid, description: 'd', body: 'b', tagList: [] } }, token);
    if (r.status < 300) {
      await page.goto(`${APP}/article/${r.json.article.slug}`);
      await page.waitForTimeout(2000);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      await page.screenshot({ path: `${SHOTS}/A3_long_title.png` });
      log('A3', '10,000-char title accepted', 'BUG', `HTTP ${r.status}, slug length=${r.json.article.slug.length}, horizontal overflow=${overflow}`);
    } else log('A3', '10,000-char title', 'PASS', `HTTP ${r.status}`);
  });

  await check('A4', 'Empty title/body', async () => {
    const r = await api('POST', '/articles', { article: { title: '', description: '', body: '', tagList: [] } }, token);
    const p = await ctx.browser().newPage();
    await p.goto(`${APP}/editor`);
    await p.click('button:has-text("Publish Article")');
    await p.waitForTimeout(1500);
    const errs = await p.locator('.error-messages').innerText().catch(() => '');
    await p.screenshot({ path: `${SHOTS}/A4_empty_article.png` });
    log('A4', 'Empty article validation', 'INFO', `API HTTP ${r.status} ${JSON.stringify(r.json).slice(0, 120)} | UI: "${errs.replace(/\n/g, ' | ')}"`);
    await p.close();
  });

  await check('A5', 'Special characters in title / slug', async () => {
    const r = await api('POST', '/articles', { article: { title: `Ünïcødé 🚀 ' " <b>x</b> ${uid}`, description: 'd', body: 'b', tagList: [] } }, token);
    const s = r.json?.article?.slug;
    let status = 'n/a';
    if (s) { await page.goto(`${APP}/article/${s}`); await page.waitForTimeout(2000); status = await page.locator('h1').first().innerText().catch(() => 'NO H1'); await page.screenshot({ path: `${SHOTS}/A5_special_chars.png` }); }
    log('A5', 'Special chars title/slug', 'INFO', `HTTP ${r.status} slug="${s}" rendered h1="${status}"`);
  });

  await check('A6', 'Duplicate title', async () => {
    const t = `Same title ${uid}`;
    const a = await api('POST', '/articles', { article: { title: t, description: 'd', body: 'b', tagList: [] } }, token);
    const b = await api('POST', '/articles', { article: { title: t, description: 'd', body: 'b', tagList: [] } }, token);
    log('A6', 'Two articles with same title', b.status >= 500 ? 'BUG' : 'INFO', `1st HTTP ${a.status}, 2nd HTTP ${b.status} ${JSON.stringify(b.json).slice(0, 150)}`);
  });

  await check('A7', 'Double-click publish (slow network)', async () => {
    const p = await ctx.newPage();
    const cdp = await ctx.newCDPSession(p);
    await p.goto(`${APP}/editor`);
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 1500, downloadThroughput: 50000, uploadThroughput: 50000 });
    const title = `Double ${uid}`;
    await p.fill('input[placeholder="Article Title"]', title);
    await p.fill('input[placeholder="What\'s this article about?"]', 'd');
    await p.fill('textarea[placeholder="Write your article (in markdown)"]', 'b');
    const btn = p.locator('button:has-text("Publish Article")');
    await btn.click(); const disabled = await btn.isDisabled().catch(() => 'gone'); await btn.click({ timeout: 1000 }).catch(() => {});
    await p.waitForTimeout(8000);
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    const list = await api('GET', `/articles?author=${u1.username}&limit=100`, null, token);
    const n = list.json.articles.filter(a => a.title === title).length;
    await p.screenshot({ path: `${SHOTS}/A7_double_submit.png` });
    log('A7', 'Double submit on slow network', n > 1 ? 'BUG' : 'INFO', `button disabled after 1st click=${disabled}, articles created=${n}`);
    await p.close();
  });

  // ---------- EDIT ----------
  await check('E1', 'Edit own article', async () => {
    await page.goto(`${APP}/editor/${slug}`);
    await page.waitForTimeout(1500);
    await page.fill('input[placeholder="Article Title"]', `QA article EDITED ${uid}`);
    await page.click('button:has-text("Publish Article")');
    await page.waitForTimeout(2500);
    const newUrl = page.url();
    await page.screenshot({ path: `${SHOTS}/E1_edit.png` });
    const old = await api('GET', `/articles/${slug}`);
    log('E1', 'Edit own article (title change)', 'INFO', `new url=${newUrl}; old slug GET -> HTTP ${old.status}`);
    if (newUrl.includes('/article/')) slug = newUrl.split('/article/')[1];
  });

  let token2;
  await check('E2', 'Edit someone else\'s article', async () => {
    const r = await api('POST', '/users', { user: u2 });
    token2 = r.json?.user?.token;
    const put = await api('PUT', `/articles/${slug}`, { article: { title: `HACKED ${uid}` } }, token2);
    const del = await api('DELETE', `/articles/${slug}`, null, token2);
    log('E2', 'Other user can PUT/DELETE my article', (put.status < 300 || del.status < 300) ? 'BUG' : 'PASS', `PUT HTTP ${put.status}, DELETE HTTP ${del.status}`);
    // UI: can user2 open the editor for user1's article?
    const c2 = await browser.newContext(); const p2 = await c2.newPage();
    await logIn(p2, u2); await p2.waitForTimeout(2000);
    await p2.goto(`${APP}/editor/${slug}`); await p2.waitForTimeout(2000);
    const val = await p2.inputValue('input[placeholder="Article Title"]').catch(() => '');
    await p2.screenshot({ path: `${SHOTS}/E2_other_user_editor.png` });
    log('E2b', 'Other user can open editor for my article (UI)', val ? 'BUG' : 'PASS', `title field prefilled="${val.slice(0, 60)}"`);
    await c2.close();
  });

  // ---------- COMMENTS ----------
  await check('C1', 'Empty comment', async () => {
    const r = await api('POST', `/articles/${slug}/comments`, { comment: { body: '' } }, token);
    log('C1', 'Empty comment accepted', r.status < 300 ? 'BUG' : 'PASS', `HTTP ${r.status}`);
  });

  // ---------- DELETE ----------
  await check('D1', 'Delete confirmation', async () => {
    dialogs.length = 0;
    await page.goto(`${APP}/article/${slug}`);
    await page.waitForTimeout(1500);
    await page.click('button:has-text("Delete Article")');
    await page.waitForTimeout(2000);
    const gone = (await api('GET', `/articles/${slug}`)).status;
    await page.screenshot({ path: `${SHOTS}/D1_delete.png` });
    log('D1', 'Delete without confirmation', dialogs.length ? 'PASS' : 'BUG', `confirm dialogs=${dialogs.length}, article GET after delete=HTTP ${gone}, landed on ${page.url()}`);
    await page.goBack(); await page.waitForTimeout(1500);
    await page.screenshot({ path: `${SHOTS}/D1b_back_after_delete.png` });
    const body = (await page.locator('body').innerText()).slice(0, 150).replace(/\n/g, ' ');
    log('D1b', 'Back button after delete', 'INFO', `page shows: "${body}"`);
  });

  await check('D2', 'Delete non-existent article', async () => {
    const r = await api('DELETE', `/articles/does-not-exist-${uid}`, null, token);
    log('D2', 'DELETE non-existent slug', r.status >= 500 ? 'BUG' : 'INFO', `HTTP ${r.status} ${JSON.stringify(r.json).slice(0, 150)}`);
  });

  await check('D3', 'Non-existent article page', async () => {
    await page.goto(`${APP}/article/nope-${uid}`);
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${SHOTS}/D3_404_article.png` });
    const body = (await page.locator('body').innerText()).slice(0, 150).replace(/\n/g, ' ');
    log('D3', 'Unknown article URL', 'INFO', `page shows: "${body}"`);
  });

  // ---------- LOGOUT ----------
  await check('O1', 'Token still valid after logout', async () => {
    await page.goto(`${APP}/settings`);
    await page.waitForTimeout(1500);
    await page.click('button:has-text("logout")');
    await page.waitForTimeout(1500);
    const r = await api('GET', '/user', null, token);
    await page.screenshot({ path: `${SHOTS}/O1_logout.png` });
    log('O1', 'Old JWT still works after logout', r.status === 200 ? 'BUG' : 'PASS', `GET /user with old token -> HTTP ${r.status}`);
  });

  await check('O2', 'Protected page after logout', async () => {
    await page.goto(`${APP}/editor`);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${SHOTS}/O2_editor_logged_out.png` });
    const hasForm = await page.locator('input[placeholder="Article Title"]').count();
    log('O2', 'Editor reachable when logged out', hasForm ? 'BUG' : 'PASS', `form visible=${!!hasForm} url=${page.url()}`);
  });

  // ---------- API ROBUSTNESS / MISC ----------
  await check('M1', 'Malformed JSON', async () => {
    const res = await fetch(API + '/users/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad json' });
    const t = await res.text();
    log('M1', 'Malformed JSON body', res.status >= 500 || /at .*\(/.test(t) ? 'BUG' : 'INFO', `HTTP ${res.status} ${t.slice(0, 200).replace(/\n/g, ' ')}`);
  });

  await check('M2', 'Invalid token', async () => {
    const r = await api('GET', '/user', null, 'garbage.token.here');
    log('M2', 'Invalid JWT', r.status >= 500 ? 'BUG' : 'INFO', `HTTP ${r.status} ${JSON.stringify(r.json).slice(0, 150)}`);
  });

  await check('M3', 'Pagination abuse', async () => {
    const r = await api('GET', '/articles?limit=100000&offset=-5');
    log('M3', 'limit=100000&offset=-5', r.status >= 500 ? 'BUG' : 'INFO', `HTTP ${r.status} ms=${r.ms} count=${r.json?.articles?.length}`);
  });

  await check('M4', 'Response times', async () => {
    const t = [];
    for (let i = 0; i < 5; i++) t.push((await api('GET', '/articles')).ms);
    log('M4', 'GET /articles latency (5 runs)', Math.max(...t) > 1000 ? 'BUG' : 'INFO', `ms=${t.join(',')}`);
  });

  await check('M5', 'Security headers / CORS', async () => {
    const res = await fetch(API + '/tags', { headers: { Origin: 'https://evil.example' } });
    const h = Object.fromEntries(res.headers);
    log('M5', 'CORS + security headers', 'INFO', `ACAO=${h['access-control-allow-origin']} x-powered-by=${h['x-powered-by']} csp=${h['content-security-policy'] || 'none'} xfo=${h['x-frame-options'] || 'none'}`);
  });

  await check('M6', 'Accessibility basics', async () => {
    await page.goto(`${APP}/register`);
    const a11y = await page.evaluate(() => {
      const inputs = [...document.querySelectorAll('input,textarea')];
      const unlabeled = inputs.filter(i => !i.getAttribute('aria-label') && !(i.id && document.querySelector(`label[for="${i.id}"]`)) && !i.closest('label')).length;
      return { inputs: inputs.length, unlabeled, lang: document.documentElement.lang || 'missing', imgsNoAlt: [...document.images].filter(i => !i.alt).length };
    });
    log('M6', 'Register page a11y', a11y.unlabeled ? 'BUG' : 'PASS', JSON.stringify(a11y));
  });

  await check('M7', 'Mobile layout', async () => {
    const c = await browser.newContext({ viewport: { width: 375, height: 700 } }); const p = await c.newPage();
    await p.goto(APP); await p.waitForTimeout(2000);
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    await p.screenshot({ path: `${SHOTS}/M7_mobile.png`, fullPage: true });
    log('M7', 'Mobile 375px horizontal overflow', overflow ? 'BUG' : 'PASS', `overflow=${overflow}`);
    await c.close();
  });

  log('X1', 'Browser console errors during run', consoleErrors.length ? 'INFO' : 'PASS', consoleErrors.slice(0, 8).join(' || ').slice(0, 800));

  fs.writeFileSync('results.json', JSON.stringify(results, null, 2));
  await browser.close();
})();
