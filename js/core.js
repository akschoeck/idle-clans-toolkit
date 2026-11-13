// Core: storage, API client with caching + rate limiting, formatting, level table.
const IC = {};
IC.API = 'https://query.idleclans.com/api';

// ---------- persistent settings (localStorage) ----------
IC.store = {
  get(key, fallback) {
    try { const v = localStorage.getItem('ic.' + key); return v == null ? fallback : JSON.parse(v); }
    catch (e) { return fallback; }
  },
  set(key, value) { try { localStorage.setItem('ic.' + key, JSON.stringify(value)); } catch (e) { /* storage unavailable */ } },
  remove(key) { try { localStorage.removeItem('ic.' + key); } catch (e) { /* ignore */ } },
};
IC.defaults = { sellMode: 'avg', speedBoost: 0, xpBoost: 0, killSeconds: 12, premium: false };
IC.settings = Object.assign({}, IC.defaults, IC.store.get('settings', {}));
IC.saveSettings = () => IC.store.set('settings', IC.settings);

// ---------- IndexedDB key/value cache (falls back to memory) ----------
IC.cache = (() => {
  const mem = new Map();
  let dbp = null;
  function db() {
    if (dbp) return dbp;
    dbp = new Promise((resolve) => {
      try {
        const req = indexedDB.open('ic-cache', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('kv');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch (e) { resolve(null); }
    });
    return dbp;
  }
  async function get(key) {
    if (mem.has(key)) return mem.get(key);
    const d = await db();
    if (!d) return null;
    return new Promise((resolve) => {
      try {
        const r = d.transaction('kv').objectStore('kv').get(key);
        r.onsuccess = () => { if (r.result) mem.set(key, r.result); resolve(r.result || null); };
        r.onerror = () => resolve(null);
      } catch (e) { resolve(null); }
    });
  }
  async function set(key, value) {
    const rec = { time: Date.now(), value };
    mem.set(key, rec);
    const d = await db();
    if (!d) return;
    try { d.transaction('kv', 'readwrite').objectStore('kv').put(rec, key); } catch (e) { /* ignore */ }
  }
  return { get, set, forget: (prefix) => { for (const k of [...mem.keys()]) if (k.startsWith(prefix)) mem.delete(k); } };
})();

// ---------- API client ----------
IC.staleKeys = new Set();
(() => {
  let chain = Promise.resolve();
  const inflight = new Map();
  const GAP = 350; // ms between requests; the API allows ~50/min overall
  function queued(fn) {
    const run = chain.then(fn, fn);
    chain = run.then(() => new Promise((r) => setTimeout(r, GAP)), () => new Promise((r) => setTimeout(r, GAP)));
    return run;
  }
  async function raw(path, asText) {
    const res = await fetch(IC.API + path, { headers: { Accept: 'application/json' } });
    if (res.status === 429) {
      const wait = res.headers.get('Retry-After');
      const err = new Error('Rate limited by the Idle Clans API' + (wait ? ` (retry in ${wait}s)` : '') + '.');
      err.status = 429; throw err;
    }
    if (!res.ok) { const err = new Error(`API returned ${res.status} for ${path.split('?')[0]}`); err.status = res.status; throw err; }
    return asText ? res.text() : res.json();
  }
  // opts: ttl (ms), force (skip cache), text (return raw text), transform (fn applied before caching)
  IC.api = function (path, opts = {}) {
    const key = 'api:' + path;
    if (inflight.has(key)) return inflight.get(key);
    const p = (async () => {
      const cached = await IC.cache.get(key);
      const ttl = opts.ttl == null ? 60000 : opts.ttl;
      if (cached && !opts.force && Date.now() - cached.time < ttl) return cached.value;
      try {
        let value = await queued(() => raw(path, opts.text));
        if (opts.transform) value = opts.transform(value);
        await IC.cache.set(key, value);
        IC.staleKeys.delete(key);
        return value;
      } catch (e) {
        // A 404 is an answer, not an outage: never serve an old copy for it.
        if (cached && e.status !== 404) { IC.staleKeys.add(key); return cached.value; }
        throw e;
      }
    })();
    inflight.set(key, p);
    p.then(() => inflight.delete(key), () => inflight.delete(key));
    return p;
  };
})();

// ---------- formatting ----------
IC.esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
IC.fmt = {
  int(n) { return n == null || !isFinite(n) ? '–' : Math.round(n).toLocaleString('en-US'); },
  // Compact: 1.2K / 3.4M / 5.6B
  short(n) {
    if (n == null || !isFinite(n)) return '–';
    const a = Math.abs(n);
    if (a >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (a >= 1e4) return (n / 1e3).toFixed(1) + 'K';
    return Math.round(n).toLocaleString('en-US');
  },
  dec(n, d = 2) { return n == null || !isFinite(n) ? '–' : n.toLocaleString('en-US', { maximumFractionDigits: d }); },
  pct(n, d = 1) { return n == null || !isFinite(n) ? '–' : (n * 100).toFixed(d) + '%'; },
  hours(h) {
    if (h == null || !isFinite(h)) return '–';
    if (h < 1 / 60) return '<1m';
    if (h < 1) return Math.round(h * 60) + 'm';
    if (h < 48) return h.toFixed(1) + 'h';
    return (h / 24).toFixed(1) + 'd';
  },
  ago(iso) {
    const t = Date.parse(iso); if (!t) return '';
    const m = (Date.now() - t) / 60000;
    return m < 1 ? 'just now' : m < 60 ? Math.round(m) + 'm ago' : m < 1440 ? Math.round(m / 60) + 'h ago' : Math.round(m / 1440) + 'd ago';
  },
  signed(n) { return n == null || !isFinite(n) ? '–' : (n > 0 ? '+' : '') + IC.fmt.short(n); },
};
IC.pretty = (key) => String(key || '').replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());

// ---------- skills & levels ----------
// Order matches the game's Skill enum (1-based ids).
IC.SKILLS = ['attack', 'strength', 'defence', 'archery', 'magic', 'health', 'crafting', 'woodcutting', 'carpentry', 'fishing', 'cooking',
  'mining', 'smithing', 'foraging', 'farming', 'agility', 'plundering', 'enchanting', 'brewing', 'exterminating', 'invocation'];
IC.skillById = (id) => IC.SKILLS[id - 1] || null;
IC.skillName = (key) => IC.pretty(key);
IC.MAX_LEVEL = 120;
// XP thresholds, LEVEL_XP[L] = total xp needed for level L. The API does not publish these; the table is
// the one on the community wiki (idleclans.wiki/w/XP_Table) and matches every skill of the character it was checked on.
IC.LEVEL_XP = [0, 0, 75, 151, 227, 303, 380, 531, 683, 836, 988, 1141, 1294, 1447, 1751, 2054, 2358, 2663, 2967, 3272, 3577,
  4182, 4788, 5393, 5999, 6606, 7212, 7819, 9026, 10233, 11441, 12648, 13856, 15065, 16273, 18682, 21091, 23500, 25910, 28319, 30729,
  33140, 37950, 42761, 47572, 52383, 57195, 62006, 66818, 76431, 86043, 95656, 105269, 114882, 124496, 134109, 153323, 172538, 191752, 210967, 230182,
  249397, 268613, 307028, 345444, 383861, 422277, 460694, 499111, 537528, 614346, 691163, 767981, 844800, 921618, 998437, 1075256, 1228875, 1382495, 1536114, 1689734,
  1843355, 1996975, 2150596, 2457817, 2765038, 3072260, 3379481, 3686703, 3993926, 4301148, 4915571, 5529994, 6144417, 6758841, 7373264, 7987688, 8602113, 9830937, 11059762, 12288587,
  13517412, 14746238, 15975063, 17203889, 19661516, 22119142, 24576769, 27034396, 29492023, 31949651, 34407278, 39322506, 44237735, 49152963, 54068192, 58983421, 63898650, 68813880, 78644309, 88474739];
IC.levelForXp = (xp) => { let L = 1; while (L < IC.MAX_LEVEL && IC.LEVEL_XP[L + 1] <= xp) L++; return L; };
IC.xpForLevel = (L) => IC.LEVEL_XP[Math.max(1, Math.min(IC.MAX_LEVEL, L))];
