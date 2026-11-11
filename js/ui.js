// Shared UI helpers: sortable tables, status messages, dialog, item detail with price chart.
IC.ui = {};
const { esc, fmt } = IC;

IC.ui.status = function (msgs) {
  document.getElementById('status').innerHTML = (msgs || []).filter(Boolean).map((m) => `<div>${esc(m)}</div>`).join('');
};

IC.ui.itemLink = (id, label) => id === IC.GOLD ? 'Gold' : `<button class="link" data-item="${id}">${esc(label || IC.itemName(id))}</button>`;

// cols: [{ label, num, val(row) -> sortable value, html(row) -> cell html (defaults to formatted val), title }]
IC.ui.table = function (el, opts) {
  const state = { sort: opts.sort == null ? -1 : opts.sort, dir: opts.dir || -1, limit: opts.limit || 60 };
  function render() {
    let rows = opts.rows.slice();
    const c = opts.cols[state.sort];
    if (c && c.val) {
      rows.sort((a, b) => {
        const x = c.val(a), y = c.val(b);
        if (x == null && y == null) return 0;
        if (x == null) return 1; // unknowns always last
        if (y == null) return -1;
        return (typeof x === 'string' ? x.localeCompare(y) : x - y) * state.dir;
      });
    }
    const shown = rows.slice(0, state.limit);
    const head = opts.cols.map((col, i) => `<th class="${col.num ? 'num ' : ''}${col.val ? 'sortable ' : ''}${i === state.sort ? 'sorted' : ''}" data-i="${i}" ${col.val ? 'tabindex="0"' : ''} title="${esc(col.title || '')}">${esc(col.label)}${i === state.sort ? (state.dir < 0 ? ' ▼' : ' ▲') : ''}</th>`).join('');
    const body = shown.map((r) => `<tr class="${opts.rowClass ? opts.rowClass(r) : ''}">${opts.cols.map((col) => {
      const v = col.html ? col.html(r) : (col.num ? fmt.short(col.val(r)) : esc(col.val(r)));
      return `<td class="${col.num ? 'num' : ''}">${v}</td>`;
    }).join('')}</tr>`).join('');
    el.innerHTML = rows.length
      ? `<div class="tablewrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>${rows.length > shown.length ? `<div class="more"><button class="ghost" data-more>Show more (${rows.length - shown.length} hidden)</button></div>` : ''}</div>`
      : `<p class="muted">${esc(opts.empty || 'Nothing to show.')}</p>`;
  }
  function sortBy(i) {
    if (!opts.cols[i] || !opts.cols[i].val) return;
    if (state.sort === i) state.dir = -state.dir; else { state.sort = i; state.dir = opts.cols[i].num ? -1 : 1; }
    render();
  }
  el.onclick = (e) => {
    const th = e.target.closest('th'); if (th) return sortBy(+th.dataset.i);
    if (e.target.closest('[data-more]')) { state.limit += 100; render(); }
  };
  el.onkeydown = (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.tagName === 'TH') { e.preventDefault(); sortBy(+e.target.dataset.i); } };
  render();
  return { setRows(rows) { opts.rows = rows; render(); } };
};

// ---------- dialog ----------
IC.ui.dialog = function (html) {
  const d = document.getElementById('dialog');
  document.getElementById('dialogBody').innerHTML = html;
  if (!d.open) d.showModal();
  return document.getElementById('dialogBody');
};
document.addEventListener('click', (e) => {
  const d = document.getElementById('dialog');
  if (e.target === d || e.target.closest('[data-close]')) { d.close(); return; }
  const item = e.target.closest('[data-item]');
  if (item) IC.ui.itemDialog(+item.dataset.item);
});

// ---------- line chart (single series, hover crosshair) ----------
// points: [{ t: ms, v: number, extra: string }]
IC.ui.lineChart = function (el, points, label) {
  if (points.length < 2) { el.innerHTML = '<p class="muted">Not enough trades in this period to draw a chart.</p>'; return; }
  const W = 700, H = 220, L = 56, R = 12, T = 10, B = 24;
  const t0 = points[0].t, t1 = points[points.length - 1].t;
  let lo = Math.min(...points.map((p) => p.v)), hi = Math.max(...points.map((p) => p.v));
  if (lo === hi) { lo *= 0.9; hi = hi * 1.1 || 1; }
  const pad = (hi - lo) * 0.08; lo = Math.max(0, lo - pad); hi += pad;
  const x = (t) => L + ((t - t0) / (t1 - t0 || 1)) * (W - L - R), y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const ticks = [0, 1, 2, 3].map((i) => lo + ((hi - lo) * i) / 3);
  const day = (t) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  el.innerHTML = `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">
    ${ticks.map((v) => `<line class="grid-line" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="axis-label" x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${fmt.short(v)}</text>`).join('')}
    <text class="axis-label" x="${L}" y="${H - 6}">${day(t0)}</text><text class="axis-label" x="${W - R}" y="${H - 6}" text-anchor="end">${day(t1)}</text>
    <path class="line" d="${points.map((p, i) => (i ? 'L' : 'M') + x(p.t).toFixed(1) + ' ' + y(p.v).toFixed(1)).join(' ')}"/>
    <line class="cross" y1="${T}" y2="${H - B}" visibility="hidden"/><circle class="dot" r="5" visibility="hidden"/>
    <rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="transparent"/>
  </svg><div class="tip" hidden></div></div>`;
  const svg = el.querySelector('svg'), cross = el.querySelector('.cross'), dot = el.querySelector('.dot'), tip = el.querySelector('.tip');
  svg.addEventListener('pointermove', (e) => {
    const box = svg.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    let best = points[0];
    for (const p of points) if (Math.abs(x(p.t) - px) < Math.abs(x(best.t) - px)) best = p;
    const cx = x(best.t), cy = y(best.v);
    cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.setAttribute('visibility', 'visible');
    dot.setAttribute('cx', cx); dot.setAttribute('cy', cy); dot.setAttribute('visibility', 'visible');
    tip.hidden = false;
    tip.innerHTML = `<b>${fmt.int(best.v)}</b> gold · ${esc(best.extra || '')}<br><span class="muted">${new Date(best.t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric' })}</span>`;
    const left = (cx / W) * box.width;
    tip.style.left = Math.min(Math.max(left - tip.offsetWidth / 2, 0), box.width - tip.offsetWidth) + 'px';
    tip.style.top = Math.max((cy / H) * box.height - tip.offsetHeight - 12, 0) + 'px';
  });
  svg.addEventListener('pointerleave', () => { cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); tip.hidden = true; });
};

// ---------- item detail ----------
IC.ui.itemDialog = async function (id, period) {
  period = period || '7d';
  const it = IC.data.game.items[id] || {}, p = IC.data.prices.get(id) || {}, name = IC.itemName(id);
  const shopBuy = IC.data.game.shop[id];
  const watch = IC.store.get('watchlist', []).find((w) => w.id === id);
  const body = IC.ui.dialog(`
    <div class="dlg-head"><div><h2>${esc(name)}</h2><div class="muted small">Item #${id}${it.noTrade ? ' · not tradeable' : ''}${it.buyLimit ? ` · market buy limit ${fmt.int(it.buyLimit)}` : ''}</div></div><button class="ghost" data-close>Close</button></div>
    <div class="grid">
      <div class="stat"><div class="label">Lowest sell offer</div><div class="value">${fmt.int(p.lowestSellPrice || null)}</div><div class="muted small">${fmt.int(p.lowestPriceVolume || 0)} at this price</div></div>
      <div class="stat"><div class="label">Highest buy offer</div><div class="value">${fmt.int(p.highestBuyPrice || null)}</div><div class="muted small">${fmt.int(p.highestPriceVolume || 0)} wanted</div></div>
      <div class="stat"><div class="label">Game shop</div><div class="value">${it.noShop || !it.base ? '–' : fmt.int(it.base)}</div><div class="muted small">sells for${shopBuy ? ` · buy for ${fmt.int(shopBuy)}` : ''}</div></div>
    </div>
    <div class="controls"><b>Average trade price</b>
      <span class="subtabs" style="margin:0">${['1d', '7d', '30d', '1y'].map((x) => `<button data-period="${x}" aria-pressed="${x === period}">${x}</button>`).join('')}</span></div>
    <div id="itemChart"><p class="muted">Loading price history…</p></div>
    <div id="itemBook" class="cols" style="margin-top:12px"></div>
    <form id="watchForm" class="controls" style="margin-top:12px">
      <b>Price alert</b>
      <label>Tell me when the <select name="dir"><option value="below">lowest sell offer drops to</option><option value="above">highest buy offer rises to</option></select></label>
      <input name="price" type="number" min="1" step="1" required placeholder="gold" value="${watch ? watch.price : ''}">
      <button type="submit">${watch ? 'Update' : 'Watch'}</button>
      ${watch ? '<button type="button" class="ghost" id="unwatch">Remove</button>' : ''}
    </form>`);
  if (watch) body.querySelector('[name=dir]').value = watch.dir;
  body.querySelectorAll('[data-period]').forEach((b) => b.onclick = () => IC.ui.itemDialog(id, b.dataset.period));
  body.querySelector('#watchForm').onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const list = IC.store.get('watchlist', []).filter((w) => w.id !== id);
    list.push({ id, dir: f.get('dir'), price: +f.get('price') });
    IC.store.set('watchlist', list);
    document.getElementById('dialog').close();
    if (IC.onWatchlistChange) IC.onWatchlistChange();
  };
  const un = body.querySelector('#unwatch');
  if (un) un.onclick = () => { IC.store.set('watchlist', IC.store.get('watchlist', []).filter((w) => w.id !== id)); document.getElementById('dialog').close(); if (IC.onWatchlistChange) IC.onWatchlistChange(); };

  IC.api(`/PlayerMarket/items/prices/history/${id}?period=${period}`, { ttl: 10 * 60000 }).then((hist) => {
    const el = document.getElementById('itemChart'); if (!el) return;
    const pts = (hist || []).filter((h) => h.averagePrice > 0).map((h) => ({ t: Date.parse(h.timestamp), v: h.averagePrice, extra: fmt.short(h.tradeVolume) + ' traded' })).sort((a, b) => a.t - b.t);
    IC.ui.lineChart(el, pts, `${name} average price, last ${period}`);
    if (pts.length > 1) {
      const vol = pts.length && (hist || []).reduce((a, h) => a + (h.tradeVolume || 0), 0);
      el.insertAdjacentHTML('beforeend', `<div class="muted small">Low ${fmt.int(Math.min(...pts.map((x) => x.v)))} · high ${fmt.int(Math.max(...pts.map((x) => x.v)))} · ${fmt.short(vol)} traded in this period</div>`);
    }
  }).catch((e) => { const el = document.getElementById('itemChart'); if (el) el.innerHTML = `<p class="bad">${esc(e.message)}</p>`; });

  IC.api(`/PlayerMarket/items/prices/latest/comprehensive/${id}`, { ttl: 2 * 60000 }).then((c) => {
    const el = document.getElementById('itemBook'); if (!el) return;
    const book = (title, rows) => `<div><h3>${title}</h3>${rows && rows.length ? `<div class="tablewrap"><table><thead><tr><th class="num">Price</th><th class="num">Quantity</th></tr></thead><tbody>${rows.slice(0, 8).map((r) => `<tr><td class="num">${fmt.int(r.key)}</td><td class="num">${fmt.int(r.value)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">None right now.</p>'}</div>`;
    el.innerHTML = book('Sell offers (cheapest first)', c.lowestSellPricesWithVolume) + book('Buy offers (highest first)', c.highestBuyPricesWithVolume)
      + `<div><h3>Averages</h3><p>1 day: <b>${fmt.int(c.averagePrice1Day || null)}</b><br>7 days: <b>${fmt.int(c.averagePrice7Days || null)}</b><br>30 days: <b>${fmt.int(c.averagePrice30Days || null)}</b><br>Traded today: <b>${fmt.int(c.tradeVolume1Day || 0)}</b></p></div>`;
  }).catch(() => { const el = document.getElementById('itemBook'); if (el) el.innerHTML = '<p class="muted">No open orders found for this item.</p>'; });
};

// Small helpers used by several views
IC.ui.reqText = (missing) => missing.map((m) => `${IC.skillName(m.skill)} ${m.level}`).join(', ');
IC.ui.needUser = () => '<div class="note">Enter your in-game username at the top to tailor this page to your levels.</div>';
IC.ui.sellModeSelect = () => `<label>Sell price <select id="sellMode">
  <option value="avg">Daily average trade price</option><option value="instant">Instant sell (highest buy offer)</option>
  <option value="list">List at lowest sell offer</option><option value="shop">Game shop only</option></select></label>`;
IC.ui.bindSellMode = (root, rerender) => {
  const s = root.querySelector('#sellMode'); if (!s) return;
  s.value = IC.settings.sellMode;
  s.onchange = () => { IC.settings.sellMode = s.value; IC.saveSettings(); rerender(); };
};
