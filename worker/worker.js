// Usage log for the Idle Clans Toolkit. Runs as a Cloudflare Worker with a D1 database bound as DB.
// Stores only: time, a random visitor code made up by the visitor's browser, the character name they typed,
// what they did, and a short detail.
// It never stores IP addresses, cookies or browser details.
//
// Bindings and secrets (set in the Cloudflare dashboard, never in this file):
//   DB            D1 database binding
//   LOG_PASSWORD  secret; required to read the logs at /logs
//   ALLOW_IP      optional secret; comma-separated IPs allowed to read the logs (checked as well as the password)

const SITES = ['https://akschoeck.github.io']; // only pages on these origins may write events

let ready = false;
async function db(env) {
  if (!ready) {
    await env.DB.prepare('CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, name TEXT NOT NULL, event TEXT NOT NULL, detail TEXT NOT NULL)').run();
    await env.DB.prepare('CREATE INDEX IF NOT EXISTS events_name ON events (name, ts)').run();
    // Added later: older databases get the column here; the error when it already exists is expected.
    try { await env.DB.prepare("ALTER TABLE events ADD COLUMN visitor TEXT NOT NULL DEFAULT ''").run(); } catch (e) { /* column already there */ }
    await env.DB.prepare('CREATE INDEX IF NOT EXISTS events_visitor ON events (visitor, ts)').run();
    ready = true;
  }
  return env.DB;
}
const clip = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cors = (origin) => ({ 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', Vary: 'Origin' });

async function record(req, env) {
  const origin = req.headers.get('Origin') || '';
  if (!SITES.includes(origin)) return new Response('Forbidden', { status: 403 });
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: cors(origin) });
  let body;
  try { body = JSON.parse((await req.text()).slice(0, 2000)); } catch (e) { return new Response('Bad request', { status: 400, headers: cors(origin) }); }
  const name = clip(body.name, 40) || '(no character)', event = clip(body.event, 40), detail = clip(body.detail, 200);
  const visitor = /^v-[a-z0-9]{8}$/.test(body.visitor) ? body.visitor : '';
  if (!event) return new Response('Bad request', { status: 400, headers: cors(origin) });
  await (await db(env)).prepare('INSERT INTO events (ts, name, event, detail, visitor) VALUES (?, ?, ?, ?, ?)').bind(Date.now(), name, event, detail, visitor).run();
  return new Response(null, { status: 204, headers: cors(origin) });
}

function allowed(req, env) {
  if (!env.LOG_PASSWORD) return false; // refuse to show anything until a password is configured
  if (env.ALLOW_IP) {
    const ip = req.headers.get('CF-Connecting-IP') || '';
    if (!env.ALLOW_IP.split(',').map((s) => s.trim()).includes(ip)) return false;
  }
  const auth = req.headers.get('Authorization') || '';
  if (!auth.startsWith('Basic ')) return false;
  let pass = '';
  try { pass = atob(auth.slice(6)).split(':').slice(1).join(':'); } catch (e) { return false; }
  return pass === env.LOG_PASSWORD;
}

async function logs(req, env) {
  const priv = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' };
  if (!allowed(req, env)) return new Response('Not authorised', { status: 401, headers: Object.assign({ 'WWW-Authenticate': 'Basic realm="logs"' }, priv) });
  const url = new URL(req.url), who = clip(url.searchParams.get('name'), 40), vis = clip(url.searchParams.get('visitor'), 12);
  const d = await db(env);
  const people = (await d.prepare('SELECT name, COUNT(*) AS n, MIN(ts) AS first, MAX(ts) AS last FROM events GROUP BY name ORDER BY last DESC LIMIT 500').all()).results;
  const visitors = (await d.prepare("SELECT visitor, COUNT(*) AS n, MIN(ts) AS first, MAX(ts) AS last, GROUP_CONCAT(DISTINCT name) AS names FROM events WHERE visitor != '' GROUP BY visitor ORDER BY last DESC LIMIT 500").all()).results;
  const cols = 'SELECT ts, visitor, name, event, detail FROM events';
  const rows = vis ? (await d.prepare(cols + ' WHERE visitor = ? ORDER BY id DESC LIMIT 1000').bind(vis).all()).results
    : who ? (await d.prepare(cols + ' WHERE name = ? ORDER BY id DESC LIMIT 1000').bind(who).all()).results
    : (await d.prepare(cols + ' ORDER BY id DESC LIMIT 1000').all()).results;
  const vlink = (v) => (v ? `<a href="?visitor=${encodeURIComponent(v)}">${esc(v)}</a>` : '<span class="muted">–</span>');
  const when = (ts) => new Date(ts).toISOString().replace('T', ' ').slice(0, 19);
  const link = (n) => `<a href="?name=${encodeURIComponent(n)}">${esc(n)}</a>`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>Toolkit usage log</title><style>
body{font:14px/1.45 system-ui,sans-serif;margin:20px;background:#14171b;color:#e8eaee}a{color:#4fb79b}h1{font-size:20px}h2{font-size:16px;margin-top:24px}
table{border-collapse:collapse;width:100%;max-width:1100px}th,td{text-align:left;padding:5px 10px;border-bottom:1px solid #333a45;vertical-align:top}th{color:#a9b0bc;font-size:12px;text-transform:uppercase}
td.n{text-align:right;font-variant-numeric:tabular-nums}.muted{color:#a9b0bc}</style></head><body>
<h1>Toolkit usage log</h1><p class="muted">Times are UTC. A visitor is one browser, identified by a random code it made up. Names are whatever was typed as the character. No IP addresses are stored.</p>
<h2>Visitors (${visitors.length})</h2>
<table><tr><th>Visitor</th><th>Characters used</th><th>Events</th><th>First seen</th><th>Last seen</th></tr>
${visitors.map((v) => `<tr><td>${vlink(v.visitor)}</td><td>${String(v.names || '').split(',').map((n) => link(n)).join(', ')}</td><td class="n">${v.n}</td><td>${when(v.first)}</td><td>${when(v.last)}</td></tr>`).join('')}</table>
<h2>Characters (${people.length})</h2>
<table><tr><th>Character</th><th>Events</th><th>First seen</th><th>Last seen</th></tr>
${people.map((p) => `<tr><td>${link(p.name)}</td><td class="n">${p.n}</td><td>${when(p.first)}</td><td>${when(p.last)}</td></tr>`).join('')}</table>
<h2>${vis ? `Activity for visitor ${esc(vis)} (<a href="?">show everyone</a>)` : who ? `Activity for ${esc(who)} (<a href="?">show everyone</a>)` : 'Latest activity'} <span class="muted">newest first, up to 1000</span></h2>
<table><tr><th>Time</th><th>Visitor</th><th>Character</th><th>Action</th><th>Detail</th></tr>
${rows.map((r) => `<tr><td>${when(r.ts)}</td><td>${vlink(r.visitor)}</td><td>${link(r.name)}</td><td>${esc(r.event)}</td><td>${esc(r.detail)}</td></tr>`).join('')}</table>
</body></html>`;
  return new Response(html, { headers: Object.assign({ 'Content-Type': 'text/html; charset=utf-8' }, priv) });
}

export default {
  async fetch(req, env) {
    const path = new URL(req.url).pathname;
    try {
      if (path === '/e') return await record(req, env);
      if (path === '/logs') return await logs(req, env);
    } catch (e) {
      return new Response('Error', { status: 500 });
    }
    return new Response('Not found', { status: 404 });
  },
};
