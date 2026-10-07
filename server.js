// Wisp Division – zero-dependency Node.js server (Node 18+). Run: node server.js
const http = require('http'), fs = require('fs'), path = require('path');
const db = require('./lib/db'), auth = require('./lib/auth'), SEED = require('./lib/seed');
const PORT = process.env.PORT || 3000, PUB = path.join(__dirname, 'public');
let FILE = {}; try { FILE = require(process.env.ADMIN_CONFIG || './admin.local'); } catch {}   // admin ID + password come from admin.local.js (or env vars)
const A_ID = String(process.env.ADMIN_ID || FILE.id || '').toLowerCase(), A_KEY = process.env.ADMIN_KEY || FILE.password || '', SETUP = require('crypto').randomBytes(4).toString('hex');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const SEC = { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'" };

// ---- Collections: whitelist of fields + limits. Anything else sent by a client is dropped. ----
const ST3 = ['Pending', 'Selected', 'Not Selected'];
const S = {
  settings: { name: 60, tagline: 300, about: 1200, discord: 200, instagram: 200, youtube: 200, contact: 300, webhook: 300, trials: ['open', 'closed'] },
  games: { n: 60, s: ['live', 'soon'], d: 300 },
  roster: { n: 60, r: 40, t: ['Players', 'Staff'] },
  matches: { d: 10, t: 5, vs: 60, ev: 60, r: ['Upcoming', 'Win', 'Loss', 'Draw'], s: 40 },
  faq: { q: 200, a: 1500 },
  payments: { week: 40, cur: 5, pool: 'num', ord: 'num', rows: 'rows' },
  apps: { ign: 40, uid: 30, game: 60, role: ['Rusher', 'Secondary Rusher', 'Nader', 'Sniper'], igl: ['No', 'Yes'], mobile: 15, age: 3, exp: 600, status: ST3, note: 300, at: 'num' },
  results: { name: 40, game: 60, role: 30, status: ST3, note: 300, at: 'num' },
  news: { title: 120, body: 2000, date: 10, pin: ['no', 'yes'] },
  ach: { title: 100, ev: 100, place: 30, date: 10 },
  messages: { name: 60, contact: 100, msg: 1000, at: 'num' }
};
const PUBLIC = ['settings', 'games', 'roster', 'matches', 'faq', 'results', 'news', 'ach'];
const str = (v, n) => String(v ?? '').trim().slice(0, n);
function clean(c, b) {
  const o = {};
  for (const [k, r] of Object.entries(S[c])) {
    const v = b[k];
    if (Array.isArray(r)) o[k] = r.includes(v) ? v : r[0];
    else if (r === 'num') o[k] = Number.isFinite(+v) ? +v : 0;
    else if (r === 'rows') o[k] = (Array.isArray(v) ? v : []).slice(0, 30).map(x => ({ n: str(x.n, 60), role: str(x.role, 40), pct: Math.min(100, Math.max(0, +x.pct || 0)), paid: !!x.paid }));
    else o[k] = str(v, r);
  }
  if (c === 'settings' && o.webhook && !/^https:\/\/discord(app)?\.com\/api\/webhooks\//.test(o.webhook)) o.webhook = '';
  if (c === 'settings') for (const k of ['discord', 'instagram', 'youtube']) if (o[k] && !/^https?:\/\//.test(o[k])) o[k] = '';
  return o;
}

// ---- Storage (JSON files in /data) ----
const C = {}; for (const c of Object.keys(S)) C[c] = db.load(c, {});
const users = db.load('users', {});
if (!Object.keys(C.settings).length) {
  C.settings.main = clean('settings', SEED.settings);
  for (const c of ['games', 'roster', 'matches', 'faq', 'payments', 'news', 'ach']) (SEED[c] || []).forEach(x => { C[c][auth.rid()] = clean(c, x); });
  Object.keys(C).forEach(db.save);
}
const hasAdmin = () => Object.values(users).some(u => u.role === 'admin');
if (A_ID && A_KEY) {   // configured admin is always kept in sync with the config
  let a = Object.values(users).find(u => u.role === 'admin'); if (!a) a = users.u0 = { id: 'u0', name: 'Admin', role: 'admin', created: Date.now() };
  if (a.adminId !== A_ID || !a.pw || !auth.verify(A_KEY, a.pw)) { a.adminId = A_ID; a.pw = auth.hash(A_KEY); db.save('users'); }
}

// ---- helpers ----
const send = (res, c, o, h = {}) => { res.writeHead(c, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SEC, ...h }); res.end(JSON.stringify(o)); };
const body = req => new Promise(r => { let d = ''; req.on('data', c => { d += c; if (d.length > 1e5) req.destroy(); });
  req.on('end', () => { try { const j = JSON.parse(d || '{}'); r(j && typeof j === 'object' && !Array.isArray(j) ? j : {}); } catch { r({}); } }); });
const hits = new Map(); setInterval(() => hits.clear(), 6e5).unref();
const limited = (k, max, ms) => { const n = (hits.get(k) || []).filter(t => Date.now() - t < ms); n.push(Date.now()); hits.set(k, n); return n.length > max; };
const ME = req => { const id = auth.who(req); return id && users[id] || null; };
const pubU = u => ({ id: u.id, name: u.name, email: u.email, role: u.role, created: u.created });
const view = (c, id, it, adm) => c === 'users' ? pubU(it) : c === 'settings' && !adm ? { id, ...it, webhook: '' } : { id, ...it };
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const notify = (id, a) => { const wh = (C.settings.main || {}).webhook; if (!wh) return;
  fetch(wh, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ allowed_mentions: { parse: [] },
    content: `**New application ${id}**\nIGN: ${a.ign} | UID: ${a.uid} | ${a.game} | ${a.role} | IGL: ${a.igl}` }) }).catch(() => {}); };
const session = (res, u, code = 200) => send(res, code, { ok: true, user: pubU(u) },
  { 'Set-Cookie': `sid=${auth.make(u.id)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${process.env.COOKIE_SECURE === '1' ? '; Secure' : ''}` });

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x'), u = url.pathname, ip = (process.env.TRUST_PROXY === '1' && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress, M = req.method;   // behind a proxy (Render) use the real visitor IP
  try {
    if (u.startsWith('/api/')) {
      // CSRF guard: every state-changing call must carry a custom header (browsers block it cross-site)
      if (M !== 'GET' && req.headers['x-requested-with'] !== 'wisp') return send(res, 403, { error: 'csrf' });
      if (u === '/api/health') return send(res, 200, { ok: true });
      // ---- admin ID + password (first run asks for it; setup code is printed in the server console) ----
      if (u === '/api/setup' && M === 'GET') return send(res, 200, { needed: !hasAdmin() });
      if (u === '/api/setup' && M === 'POST') {
        if (hasAdmin()) return send(res, 409, { error: 'done' }); if (limited('set' + ip, 5, 6e4)) return send(res, 429, { error: 'rate' });
        const b = await body(req), id = str(b.id, 20).toLowerCase(), pw = String(b.password || '');
        if (b.code !== SETUP) return send(res, 403, { error: 'code' }); if (!/^[a-z0-9_]{4,20}$/.test(id)) return send(res, 400, { error: 'id' }); if (pw.length < 10 || pw.length > 100) return send(res, 400, { error: 'pw' });
        users.u0 = { id: 'u0', name: 'Admin', adminId: id, role: 'admin', pw: auth.hash(pw), created: Date.now() }; db.save('users'); return session(res, users.u0, 201);
      }
      // ---- accounts ----
      if (u === '/api/register' && M === 'POST') {
        if (limited('reg' + ip, 6, 36e5)) return send(res, 429, { error: 'rate' });
        const b = await body(req), name = str(b.name, 30), email = str(b.email, 254).toLowerCase(), pw = String(b.password || '');
        if (!name) return send(res, 400, { error: 'name' }); if (!EMAIL.test(email)) return send(res, 400, { error: 'email' });
        if (pw.length < 8 || pw.length > 100) return send(res, 400, { error: 'pw' });
        if (Object.values(users).some(x => x.email === email)) return send(res, 409, { error: 'exists' });
        const id = 'u' + auth.rid(); users[id] = { id, name, email, role: 'pending', pw: auth.hash(pw), created: Date.now() }; db.save('users');
        return session(res, users[id], 201);
      }
      if (u === '/api/login' && M === 'POST') {
        if (limited('log' + ip, 10, 6e4)) return send(res, 429, { error: 'rate' });
        const b = await body(req), idf = str(b.email, 254).toLowerCase(), x = Object.values(users).find(v => v.role === 'admin' ? v.adminId === idf : v.email === idf);   // email OR admin ID
        if (limited('lid' + idf, 30, 9e5)) return send(res, 429, { error: 'rate' });   // also cap guesses per account, even if the IP is spoofed
        if (!x || !auth.verify(String(b.password || ''), x.pw)) return send(res, 401, { error: 'creds' });
        return session(res, x);
      }
      if (u === '/api/logout' && M === 'POST') { auth.sessions.delete(auth.cookies(req).sid); return send(res, 200, { ok: true }, { 'Set-Cookie': 'sid=; HttpOnly; Path=/; Max-Age=0' }); }
      if (u === '/api/me' && M === 'GET') { const x = ME(req); return send(res, 200, { user: x ? pubU(x) : null }); }

      // ---- data API: /api/c/:collection[/:id] ----
      const m = u.match(/^\/api\/c\/([a-z]+)(?:\/([\w-]{1,40}))?$/);
      if (!m || (!S[m[1]] && m[1] !== 'users')) return send(res, 404, { error: 'none' });
      const [, c, id] = m, me = ME(req), r = me ? me.role : 'guest', adm = r === 'admin', store = c === 'users' ? users : C[c];
      const readable = adm || PUBLIC.includes(c) || (c === 'payments' && r === 'member');
      if (M === 'GET') {
        if (id) {
          if (!readable) return send(res, me ? 403 : 401, { error: 'auth' });
          if (c === 'results' && !adm && limited('res' + ip, 30, 6e4)) return send(res, 429, { error: 'rate' });
          return store[id] ? send(res, 200, { item: view(c, id, store[id], adm) }) : send(res, 404, { error: 'none' });
        }
        if (!readable) return send(res, me ? 403 : 401, { error: 'auth' });
        const items = Object.entries(store).filter(([, v]) => c !== 'users' || v.role !== 'admin').map(([k, v]) => view(c, k, v, adm));
        if (c === 'results' && !adm) items.forEach(x => delete x.id);   // public board never exposes application IDs
        return send(res, 200, { items });
      }
      if (!['PUT', 'POST', 'DELETE'].includes(M)) return send(res, 405, { error: 'method' });
      // Public: anyone may submit one new Pending application with an ID like WD-AB12C
      if (c === 'apps' && M === 'PUT' && !adm) {
        if (!/^WD-[A-Z0-9]{5}$/.test(id || '')) return send(res, 400, { error: 'id' }); if (store[id]) return send(res, 409, { error: 'exists' });
        if (limited('app' + ip, 5, 36e5)) return send(res, 429, { error: 'rate' });
        if ((C.settings.main || {}).trials === 'closed') return send(res, 403, { error: 'closed' });
        const a = clean('apps', await body(req)); if (!a.ign || !a.uid) return send(res, 400, { error: 'missing' });
        a.mobile = a.mobile.replace(/[\s+-]/g, '').replace(/^91(?=\d{10}$)/, ''); if (!/^[6-9]\d{9}$/.test(a.mobile)) return send(res, 400, { error: 'mobile' });
        Object.assign(a, { status: 'Pending', note: '', at: Date.now() }); store[id] = a; db.save('apps'); C.results[id] = { name: a.ign, game: a.game, role: a.role, status: 'Pending', note: '', at: a.at }; db.save('results'); notify(id, a); return send(res, 200, { ok: true, id });
      }
      if (c === 'messages' && M === 'POST' && !adm) {   // public contact form
        if (limited('msg' + ip, 3, 36e5)) return send(res, 429, { error: 'rate' });
        const mg = clean('messages', await body(req)); if (!mg.name || !mg.msg) return send(res, 400, { error: 'missing' });
        mg.at = Date.now(); store[auth.rid()] = mg; db.save('messages'); return send(res, 200, { ok: true });
      }
      if (!adm) return send(res, me ? 403 : 401, { error: 'auth' });
      if (c === 'users') {   // admin can only change roles
        if (M !== 'PUT' || !users[id]) return send(res, 404, { error: 'none' });
        const nr = (await body(req)).role; if (users[id].role === 'admin' || !['pending', 'member'].includes(nr)) return send(res, 400, { error: 'role' });
        users[id].role = nr; db.save('users'); return send(res, 200, { ok: true });
      }
      if (M === 'DELETE') { if (!id || !store[id]) return send(res, 404, { error: 'none' }); delete store[id]; db.save(c); return send(res, 200, { ok: true }); }
      const doc = clean(c, await body(req));
      if ((c === 'apps' || c === 'results') && doc.status !== 'Pending' && doc.note.length < 5) return send(res, 400, { error: 'reason' });   // result needs a public reason
      if (c === 'settings' && (M === 'POST' || id !== 'main')) return send(res, 400, { error: 'id' });
      if (M === 'POST') { const nid = auth.rid(); store[nid] = doc; db.save(c); return send(res, 200, { ok: true, id: nid }); }
      if (!id) return send(res, 400, { error: 'id' });
      if (c === 'apps' && store[id]) doc.at = store[id].at || doc.at;
      store[id] = doc; db.save(c); return send(res, 200, { ok: true, id });
    }
    // ---- static files ----
    const f = path.normalize(path.join(PUB, u === '/' ? 'index.html' : u));
    if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404, SEC); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', ...SEC }); fs.createReadStream(f).pipe(res);
  } catch (e) { send(res, 500, { error: 'server' }); }
}).listen(PORT, () => console.log(`\n⚡ Wisp Division running → http://localhost:${PORT}\n` + (hasAdmin() ? '   Admin account ready.\n' : `   FIRST-TIME SETUP: open the site and create your admin ID + password.\n   Setup code: ${SETUP}\n`)));
process.on('SIGINT', () => { db.flush(); process.exit(); }); process.on('SIGTERM', () => { db.flush(); process.exit(); });
