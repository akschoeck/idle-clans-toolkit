// Market: flips, dips and spikes, shop arbitrage, watchlist alerts, trade chat.
IC.watchHits = function () {
  return IC.store.get('watchlist', []).map((w) => {
    const p = IC.data.prices.get(w.id) || {};
    const now = w.dir === 'below' ? p.lowestSellPrice : p.highestBuyPrice;
    return Object.assign({}, w, { now, hit: now > 0 && (w.dir === 'below' ? now <= w.price : now >= w.price) });
  }).filter((w) => w.hit);
};

IC.views.market = {
  label: 'Market',
  blurb: 'Flip finder, price dips and spikes, shop arbitrage, price alerts and a trade chat scanner.',
  state: { sub: 'flips', minVol: 50, chatQ: '' },
  subs: { flips: 'Flips', dips: 'Dips & spikes', shop: 'Shop arbitrage', watch: 'Watchlist', chat: 'Trade chat' },
  render(el) {
    const st = this.state;
    el.innerHTML = `<h2>Market</h2>
      <div class="subtabs">${Object.entries(this.subs).map(([k, v]) => `<button data-sub="${k}" aria-pressed="${k === st.sub}">${v}</button>`).join('')}</div>
      <div id="mkBody"></div>`;
    el.querySelectorAll('[data-sub]').forEach((b) => b.onclick = () => { st.sub = b.dataset.sub; this.render(el); });
    IC.onWatchlistChange = () => { if (IC.currentView === 'market') this.render(el); };
    this[st.sub](el.querySelector('#mkBody'));
  },

  tradeable() {
    const out = [];
    for (const [id, p] of IC.data.prices) {
      const it = IC.data.game.items[id];
      if (!it || it.noTrade || id === IC.GOLD) continue;
      const s = IC.data.summary.get(id) || { vol7: 0, avg7: 0 };
      out.push({ id, it, p, volDay: s.vol7 / 7, avg7: s.avg7 });
    }
    return out;
  },
  volControl(body, rerender) {
    const st = this.state, i = body.querySelector('#mkVol');
    i.value = st.minVol; i.onchange = () => { st.minVol = Math.max(0, +i.value || 0); rerender(); };
  },

  flips(body) {
    const st = this.state, tax = IC.taxMult();
    body.innerHTML = `<p class="muted">Place a buy offer just above the highest current buy offer, then relist just under the lowest sell offer. Margin is after the ${IC.data.game.settings.tax}% sale tax.</p>
      <div class="controls"><label>Min. daily volume <input type="number" id="mkVol" min="0"></label></div><div id="mkT"></div>
      <p class="muted small">"Realistic per day" assumes you capture 10% of the average daily volume, capped by the item's market buy limit. Spreads close when others undercut, so treat these as leads, not guarantees. A sell offer far above the 7-day average usually means a stale listing.</p>`;
    const draw = () => {
      const rows = this.tradeable().filter((r) => r.p.highestBuyPrice > 0 && r.p.lowestSellPrice > r.p.highestBuyPrice && r.volDay >= st.minVol).map((r) => {
        const buy = r.p.highestBuyPrice + 1, sell = r.p.lowestSellPrice - 1;
        const margin = sell * tax - buy;
        const qty = Math.min(r.volDay * 0.1, r.it.buyLimit || Infinity);
        return Object.assign(r, { buy, sell, margin, roi: margin / buy, perDay: margin * qty, stale: r.avg7 > 0 && sell > r.avg7 * 1.5 });
      }).filter((r) => r.margin > 0);
      IC.ui.table(body.querySelector('#mkT'), {
        rows, sort: 6, limit: 50, empty: 'No profitable spreads at this volume. Try lowering the minimum.',
        cols: [
          { label: 'Item', val: (r) => IC.itemName(r.id), html: (r) => IC.ui.itemLink(r.id) + (r.stale ? '<span class="tag warn" title="Sell offer is over 1.5× the 7-day average price">stale ask?</span>' : '') },
          { label: 'Buy at', num: true, val: (r) => r.buy, html: (r) => fmt.int(r.buy) },
          { label: 'Sell at', num: true, val: (r) => r.sell, html: (r) => fmt.int(r.sell) },
          { label: 'Margin', num: true, val: (r) => r.margin, html: (r) => `<span class="good">${fmt.short(r.margin)}</span>`, title: 'Profit per unit after tax' },
          { label: 'ROI', num: true, val: (r) => r.roi, html: (r) => fmt.pct(r.roi) },
          { label: 'Vol/day', num: true, val: (r) => r.volDay, title: 'Average units traded per day over the last week' },
          { label: 'Realistic per day', num: true, val: (r) => r.perDay, html: (r) => `<b class="good">${fmt.short(r.perDay)}</b>` },
          { label: '7d avg', num: true, val: (r) => r.avg7 || null, html: (r) => fmt.int(r.avg7 || null) },
        ],
      });
    };
    this.volControl(body, draw); draw();
  },

  dips(body) {
    const st = this.state;
    body.innerHTML = `<p class="muted">Compares current offers with the volume-weighted average trade price of the last 7 days. A dip is a sell offer well below average (buy candidate). A spike is a buy offer well above average (sell candidate).</p>
      <div class="controls"><label>Min. daily volume <input type="number" id="mkVol" min="0"></label></div>
      <div class="cols"><div><h3>Dips: cheap to buy now</h3><div id="mkDips"></div></div><div><h3>Spikes: good time to sell</h3><div id="mkSpikes"></div></div></div>`;
    const draw = () => {
      const base = this.tradeable().filter((r) => r.avg7 > 0 && r.volDay >= st.minVol);
      const dips = base.filter((r) => r.p.lowestSellPrice > 0).map((r) => Object.assign({}, r, { now: r.p.lowestSellPrice, d: r.p.lowestSellPrice / r.avg7 - 1, qty: r.p.lowestPriceVolume })).filter((r) => r.d <= -0.1);
      const spikes = base.filter((r) => r.p.highestBuyPrice > 0).map((r) => Object.assign({}, r, { now: r.p.highestBuyPrice, d: r.p.highestBuyPrice / r.avg7 - 1, qty: r.p.highestPriceVolume })).filter((r) => r.d >= 0.1);
      const cols = (word) => [
        { label: 'Item', val: (r) => IC.itemName(r.id), html: (r) => IC.ui.itemLink(r.id) },
        { label: word, num: true, val: (r) => r.now, html: (r) => fmt.int(r.now) },
        { label: '7d avg', num: true, val: (r) => r.avg7, html: (r) => fmt.int(r.avg7) },
        { label: 'vs avg', num: true, val: (r) => r.d, html: (r) => `<span class="${r.d < 0 ? 'good' : 'warn'}">${r.d > 0 ? '+' : ''}${fmt.pct(r.d, 0)}</span>` },
        { label: 'Qty', num: true, val: (r) => r.qty, title: 'Units available at this price' },
      ];
      IC.ui.table(body.querySelector('#mkDips'), { rows: dips, sort: 3, dir: 1, limit: 25, cols: cols('Sell offer'), empty: 'No dips of 10% or more right now.' });
      IC.ui.table(body.querySelector('#mkSpikes'), { rows: spikes, sort: 3, dir: -1, limit: 25, cols: cols('Buy offer'), empty: 'No spikes of 10% or more right now.' });
    };
    this.volControl(body, draw); draw();
  },

  shop(body) {
    const tax = IC.taxMult(), g = IC.data.game;
    const under = [], over = [];
    for (const r of this.tradeable()) {
      if (!r.it.noShop && r.it.base > 0 && r.p.lowestSellPrice > 0 && r.p.lowestSellPrice < r.it.base) {
        const per = r.it.base - r.p.lowestSellPrice;
        under.push(Object.assign({}, r, { per, qty: r.p.lowestPriceVolume || 0, total: per * (r.p.lowestPriceVolume || 0) }));
      }
      const cost = g.shop[r.id];
      if (cost && r.p.highestBuyPrice * tax > cost) {
        const per = r.p.highestBuyPrice * tax - cost;
        over.push(Object.assign({}, r, { cost, per, qty: r.p.highestPriceVolume || 0, total: per * (r.p.highestPriceVolume || 0) }));
      }
    }
    body.innerHTML = `<p class="muted">Risk-free trades between the player market and the game shop, when they exist. This assumes the game shop pays an item's full base value; check one sale in game before buying in bulk.</p>
      <h3>Listed below shop value: buy on market, sell to shop</h3><div id="mkUnder"></div>
      <h3 style="margin-top:14px">Buy offers above shop price: buy from shop, sell to the offer</h3><div id="mkOver"></div>`;
    IC.ui.table(body.querySelector('#mkUnder'), {
      rows: under, sort: 5, limit: 40, empty: 'Nothing is listed below its shop value right now.',
      cols: [
        { label: 'Item', val: (r) => IC.itemName(r.id), html: (r) => IC.ui.itemLink(r.id) },
        { label: 'Market price', num: true, val: (r) => r.p.lowestSellPrice, html: (r) => fmt.int(r.p.lowestSellPrice) },
        { label: 'Shop pays', num: true, val: (r) => r.it.base, html: (r) => fmt.int(r.it.base) },
        { label: 'Profit each', num: true, val: (r) => r.per, html: (r) => fmt.int(r.per) },
        { label: 'Qty at price', num: true, val: (r) => r.qty },
        { label: 'Total profit', num: true, val: (r) => r.total, html: (r) => `<b class="good">${fmt.short(r.total)}</b>` },
      ],
    });
    IC.ui.table(body.querySelector('#mkOver'), {
      rows: over, sort: 5, limit: 40, empty: 'No buy offers currently beat the shop price.',
      cols: [
        { label: 'Item', val: (r) => IC.itemName(r.id), html: (r) => IC.ui.itemLink(r.id) },
        { label: 'Shop price', num: true, val: (r) => r.cost, html: (r) => fmt.int(r.cost) },
        { label: 'Buy offer', num: true, val: (r) => r.p.highestBuyPrice, html: (r) => fmt.int(r.p.highestBuyPrice) },
        { label: 'Profit each', num: true, val: (r) => r.per, html: (r) => fmt.dec(r.per, 1) },
        { label: 'Qty wanted', num: true, val: (r) => r.qty },
        { label: 'Total profit', num: true, val: (r) => r.total, html: (r) => `<b class="good">${fmt.short(r.total)}</b>` },
      ],
    });
  },

  watch(body) {
    const list = IC.store.get('watchlist', []);
    const names = [...IC.data.prices.keys()].filter((id) => IC.data.game.items[id]).map((id) => ({ id, name: IC.itemName(id) })).sort((a, b) => a.name.localeCompare(b.name));
    const canNotify = 'Notification' in window;
    body.innerHTML = `<p class="muted">Set a target price per item. Prices refresh every 5 minutes while this page is open; hits show here, on Home, and as a desktop notification if you allow it.</p>
      <form id="wAdd" class="controls">
        <input name="item" list="wItems" placeholder="Item name" required><datalist id="wItems">${names.map((n) => `<option value="${esc(n.name)}">`).join('')}</datalist>
        <select name="dir"><option value="below">sell offer drops to</option><option value="above">buy offer rises to</option></select>
        <input name="price" type="number" min="1" required placeholder="gold">
        <button type="submit">Add alert</button>
        ${canNotify && Notification.permission !== 'granted' ? '<button type="button" class="ghost" id="wNotify">Enable desktop notifications</button>' : ''}
      </form><div id="wT"></div>`;
    const rows = list.map((w) => {
      const p = IC.data.prices.get(w.id) || {};
      const now = w.dir === 'below' ? p.lowestSellPrice : p.highestBuyPrice;
      return Object.assign({}, w, { now: now || null, hit: now > 0 && (w.dir === 'below' ? now <= w.price : now >= w.price) });
    });
    IC.ui.table(body.querySelector('#wT'), {
      rows, limit: 100, empty: 'No alerts yet. Add one above, or click any item name in the app.',
      cols: [
        { label: 'Item', val: (r) => IC.itemName(r.id), html: (r) => IC.ui.itemLink(r.id) },
        { label: 'Alert when', val: (r) => r.dir, html: (r) => (r.dir === 'below' ? 'sell offer ≤ ' : 'buy offer ≥ ') + fmt.int(r.price) },
        { label: 'Now', num: true, val: (r) => r.now, html: (r) => fmt.int(r.now) },
        { label: 'Status', val: (r) => (r.hit ? 1 : 0), html: (r) => (r.hit ? '<b class="good">Target hit</b>' : '<span class="muted">waiting</span>') },
        { label: '', html: (r) => `<button class="ghost" data-del="${r.id}">Remove</button>` },
      ],
    });
    body.querySelector('#wT').addEventListener('click', (e) => { const b = e.target.closest('[data-del]'); if (b) { IC.store.set('watchlist', list.filter((w) => w.id !== +b.dataset.del)); this.watch(body); } });
    body.querySelector('#wAdd').onsubmit = (e) => {
      e.preventDefault();
      const f = new FormData(e.target), q = String(f.get('item')).trim().toLowerCase();
      const found = names.find((n) => n.name.toLowerCase() === q) || names.find((n) => n.name.toLowerCase().includes(q));
      if (!found) { e.target.item.setCustomValidity('No tradeable item with that name'); e.target.item.reportValidity(); return; }
      IC.store.set('watchlist', list.filter((w) => w.id !== found.id).concat({ id: found.id, dir: f.get('dir'), price: +f.get('price') }));
      this.watch(body);
    };
    body.querySelector('[name=item]').oninput = (e) => e.target.setCustomValidity('');
    const nb = body.querySelector('#wNotify');
    if (nb) nb.onclick = () => Notification.requestPermission().then(() => this.watch(body));
  },

  chat(body) {
    const st = this.state;
    body.innerHTML = `<p class="muted">The last hour of the in-game Trade channel. Items on your watchlist are highlighted.</p>
      <div class="controls"><input type="search" id="cQ" placeholder="Filter messages…" value="${esc(st.chatQ)}"><button class="ghost" id="cReload">Reload</button></div><div id="cList"><p class="muted">Loading…</p></div>`;
    const watched = IC.store.get('watchlist', []).map((w) => IC.itemName(w.id).toLowerCase());
    let msgs = [];
    const draw = () => {
      const q = st.chatQ.trim().toLowerCase();
      const shown = msgs.filter((m) => !q || m.Message.toLowerCase().includes(q));
      body.querySelector('#cList').innerHTML = shown.length ? shown.map((m) => {
        let text = esc(m.Message.replace(/^\[\d\d:\d\d:\d\d\]\s*/, ''));
        for (const w of watched) { const i = text.toLowerCase().indexOf(w); if (i >= 0) text = text.slice(0, i) + '<mark>' + text.slice(i, i + w.length) + '</mark>' + text.slice(i + w.length); }
        return `<div class="chat-msg"><span class="muted small">${fmt.ago(m.Timestamp)}</span> ${text}</div>`;
      }).join('') : '<p class="muted">No trade messages match.</p>';
    };
    const load = (force) => IC.api('/Chat/recent?generalDisabled=true&helpDisabled=true&clanHubDisabled=true&combatLFGDisabled=true&raidLFGDisabled=true&minutes=60', { ttl: 60000, force })
      .then((c) => { msgs = ((c && c.Trade) || []).filter((m) => !m.Hidden).sort((a, b) => Date.parse(b.Timestamp) - Date.parse(a.Timestamp)); draw(); })
      .catch((e) => { body.querySelector('#cList').innerHTML = `<p class="bad">${esc(e.message)}</p>`; });
    body.querySelector('#cQ').oninput = (e) => { st.chatQ = e.target.value; draw(); };
    body.querySelector('#cReload').onclick = () => load(true);
    load(false);
  },
};
