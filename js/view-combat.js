// Combat: expected loot value per kill for every monster and boss.
IC.views.combat = {
  label: 'Combat',
  blurb: 'Expected gold and loot value per kill for every monster and boss, with full drop tables.',
  state: { zone: 'all', maxLvl: '' },
  render(el) {
    const st = this.state, g = IC.data.game;
    const zones = [...new Set(g.monsters.map((m) => m.zone).filter(Boolean))];
    el.innerHTML = `<h2>Loot value per kill</h2>
      <p class="muted">Each drop's chance × average quantity × sale value. The API has no combat simulator, so enter your own average kill time to get gold per hour. Boss rows subtract the price of the key.</p>
      <div class="controls">
        <label>Zone <select id="cZone"><option value="all">All zones</option>${zones.map((z) => `<option value="${esc(z)}">${esc(IC.pretty(z))}</option>`).join('')}</select></label>
        <label>My average kill time <input type="number" id="cKill" min="1" step="1" value="${IC.settings.killSeconds}"> seconds</label>
        <label title="Hide enemies above this level">Max level <input type="number" id="cMax" min="1" placeholder="any" value="${esc(st.maxLvl)}"></label>
        ${IC.ui.sellModeSelect()}
      </div><div id="cT"></div>
      <p class="muted small">Gold per hour adds the ${fmt.dec(g.settings.respawnMs / 1000, 2)}s respawn to your kill time. Rare drops dominate some rows, so hourly figures are long-run averages. Click a monster for its drop table, how its loot value is worked out, and your DPS against it.</p>`;
    el.querySelector('#cZone').value = st.zone;
    const draw = () => {
      const cycle = (IC.settings.killSeconds || 12) + g.settings.respawnMs / 1000;
      const maxLvl = +st.maxLvl || Infinity;
      const rows = g.monsters.filter((m) => (st.zone === 'all' || m.zone === st.zone) && m.lvl <= maxLvl).map((m) => {
        const v = IC.lootValue(m.loot);
        const key = m.keyId != null ? IC.buyCost(m.keyId) || 0 : 0;
        const top = m.loot.filter((l) => l.id !== IC.GOLD).map((l) => ({ l, ev: (IC.sellValue(l.id) || { value: 0 }).value * l.chance * l.avg })).sort((a, b) => b.ev - a.ev)[0];
        return { m, v, key, net: v.total - key, perHr: (v.total - key) * (3600 / cycle), top };
      });
      IC.ui.table(el.querySelector('#cT'), {
        rows, sort: 10, limit: 80, empty: 'No enemies at or below that level in this zone.',
        cols: [
          { label: 'Monster', val: (r) => IC.pretty(r.m.key), html: (r) => `<button class="link" data-mon="${r.m.key}">${esc(IC.pretty(r.m.key))}</button>${r.m.boss ? '<span class="tag">boss</span>' : ''}` },
          { label: 'Zone', val: (r) => IC.pretty(r.m.zone) },
          { label: 'Lvl', num: true, val: (r) => r.m.lvl, html: (r) => fmt.int(r.m.lvl), title: 'Enemy combat level as shown in game (calculated from its stats)' },
          { label: 'HP', num: true, val: (r) => r.m.hp, html: (r) => fmt.int(r.m.hp) },
          { label: 'Atk', num: true, val: (r) => r.m.atk, html: (r) => fmt.int(r.m.atk), title: 'Enemy attack level (its highest of melee, archery and magic)' },
          { label: 'Str', num: true, val: (r) => r.m.str || null, html: (r) => (r.m.str ? fmt.int(r.m.str) : '<span class="muted">–</span>'), title: 'Enemy strength level (melee attackers only)' },
          { label: 'Def', num: true, val: (r) => r.m.def, html: (r) => fmt.int(r.m.def), title: 'Enemy defence level' },
          { label: 'Gold/kill', num: true, val: (r) => r.v.gold, html: (r) => fmt.dec(r.v.gold, 1) },
          { label: 'Items/kill', num: true, val: (r) => r.v.items, html: (r) => fmt.short(r.v.items) },
          { label: 'Net/kill', num: true, val: (r) => r.net, html: (r) => `<b class="${r.net >= 0 ? 'good' : 'bad'}">${fmt.short(r.net)}</b>${r.key ? `<div class="muted small">key ${fmt.short(r.key)}</div>` : ''}` },
          { label: 'Gold/hr', num: true, val: (r) => r.perHr, html: (r) => `<span class="${r.perHr >= 0 ? 'good' : 'bad'}">${fmt.short(r.perHr)}</span>` },
          { label: 'Most valuable drop', val: (r) => (r.top ? r.top.ev : null), html: (r) => (r.top && r.top.ev > 0 ? `${IC.ui.itemLink(r.top.l.id)} <span class="muted">(${fmt.pct(r.top.l.chance, r.top.l.chance < 0.01 ? 2 : 1)})</span>` : '<span class="muted">–</span>') },
        ],
      });
    };
    el.querySelector('#cZone').onchange = (e) => { st.zone = e.target.value; draw(); };
    el.querySelector('#cMax').onchange = (e) => { st.maxLvl = e.target.value; draw(); };
    el.querySelector('#cKill').onchange = (e) => { IC.settings.killSeconds = Math.max(1, +e.target.value || 12); IC.saveSettings(); draw(); };
    el.querySelector('#cT').addEventListener('click', (e) => { const b = e.target.closest('[data-mon]'); if (b) this.lootDialog(b.dataset.mon); });
    IC.ui.bindSellMode(el, draw);
    draw();
  },
  // Drop table with the working for loot per kill and per hour, then the DPS panel for the loaded character.
  lootDialog(key) {
    const m = IC.data.game.monsters.find((x) => x.key === key); if (!m) return;
    const D = IC.views.dps, has = !!(IC.data.profile && IC.levels);
    const r = has ? IC.combat.calc(D.gearFor(), IC.levels, m) : null;
    const kills = r ? r.kills : 3600 / ((IC.settings.killSeconds || 12) + IC.data.game.settings.respawnMs / 1000);
    const rows = m.loot.map((l) => {
      const gold = l.id === IC.GOLD, v = gold ? { value: 1, src: 'gold' } : IC.sellValue(l.id), it = IC.data.game.items[l.id];
      const base = gold ? 1 : it && !it.noShop ? it.base || 0 : 0;
      return { l, src: v ? v.src : null, each: v ? v.value : null, ev: v ? v.value * l.chance * l.avg : 0, baseEv: base * l.chance * l.avg };
    });
    const total = rows.reduce((a, x) => a + x.ev, 0), baseTotal = rows.reduce((a, x) => a + x.baseEv, 0);
    const keyCost = m.keyId != null ? IC.buyCost(m.keyId) || 0 : 0;
    const mode = { avg: 'daily average trade price', instant: 'highest buy offer', list: 'lowest sell offer', shop: 'game shop price' }[IC.settings.sellMode] || 'chosen sell price';
    const body = IC.ui.dialog(`<div class="dlg-head"><div><h2>${esc(IC.pretty(m.key))}</h2><div class="muted small">${esc(IC.pretty(m.zone))} · level ${fmt.int(m.lvl)} · ${fmt.int(m.hp)} HP · attack ${fmt.int(m.atk)} · ${m.str ? 'strength ' + fmt.int(m.str) + ' · ' : ''}defence ${fmt.int(m.def)}${m.keyId != null ? ' · needs ' + esc(IC.itemName(m.keyId)) : ''}</div></div><button class="ghost" data-close>Close</button></div>
      <div id="lootT"></div>
      <div class="note" style="margin-top:10px">
        <b>How loot per hour is worked out.</b> Every kill gives exactly one line from the table above, picked by its chance. Value per kill is chance × average quantity × value each, and the lines add up to <b>${fmt.dec(total, 1)}</b> gold per kill${keyCost ? `, less <b>${fmt.int(keyCost)}</b> for the key` : ''}.
        At <b>${fmt.dec(kills, 1)}</b> kills per hour (${r ? `calculated for ${esc(IC.data.profile.username)}${D.gearChanged() ? ' with the gear set on the DPS Calculator tab' : ''}` : 'from your average kill time on the Combat tab'}) that is <b>${fmt.int((total - keyCost) * kills)}</b> gold per hour.
        <div class="muted small" style="margin-top:4px">"Value each" is the ${esc(mode)} after the ${IC.data.game.settings.tax}% market tax, or the game shop price when that pays more (marked shop). Selling everything to the game shop instead gives ${fmt.dec(baseTotal, 1)} per kill, ${fmt.int(baseTotal * kills)} per hour. Rare drops are averaged in, so an hour without one will come in lower.</div>
      </div>
      ${r ? `<div class="dps-layout" style="display:block;margin-top:12px">${D.statsHtml(r, m, false)}</div>` : '<p class="muted small">Enter your username at the top to see your DPS against this enemy.</p>'}`);
    IC.ui.table(body.querySelector('#lootT'), {
      rows, sort: 5, limit: 100,
      cols: [
        { label: 'Drop', val: (x) => IC.itemName(x.l.id), html: (x) => IC.ui.itemLink(x.l.id) + (x.src === 'shop' ? '<span class="tag">shop</span>' : '') },
        { label: 'Chance', num: true, val: (x) => x.l.chance, html: (x) => fmt.pct(x.l.chance, x.l.chance < 0.01 ? 2 : 1) },
        { label: 'Quantity', num: true, val: (x) => x.l.avg, html: (x) => (x.l.min === x.l.max ? fmt.int(x.l.min) : `${fmt.int(x.l.min)}–${fmt.int(x.l.max)}`) },
        { label: 'Value each', num: true, val: (x) => x.each },
        { label: 'Value/kill', num: true, val: (x) => x.ev, html: (x) => fmt.dec(x.ev, 1) },
        { label: 'Value/hour', num: true, val: (x) => x.ev * kills, html: (x) => fmt.int(x.ev * kills) },
        { label: 'Share', num: true, val: (x) => x.ev, html: (x) => (total > 0 ? fmt.pct(x.ev / total, 1) : '–'), title: 'Share of the total loot value' },
      ],
    });
  },
};
