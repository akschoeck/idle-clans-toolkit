// Gear: upgrades you can equip, ranked by stat gain per gold. Plus your purchasable upgrades.
IC.STYLES = {
  melee: { label: 'Melee', score: (s) => s.str + s.acc },
  archery: { label: 'Archery', score: (s) => s.aStr + s.aAcc },
  magic: { label: 'Magic', score: (s) => s.mStr + s.mAcc },
  defence: { label: 'Defence', score: (s) => s.def + s.aDef + s.mDef },
};
// Player-profile keys for the gold upgrades, matched to the game's upgrade enum by order.
IC.UPGRADE_KEYS = { 0: 'housing', 1: 'keepItSpacious', 2: 'theLumberjack', 3: 'theFisherman', 4: 'autoEating', 5: 'autoLooting', 6: 'offlineProgress', 8: 'farmingTrickery', 9: 'powerForager', 10: 'smeltingMagic', 11: 'mostEfficientFisherman', 12: 'plankBargain', 13: 'ammo-saver', 15: 'teamwork' };

IC.views.gear = {
  label: 'Gear',
  blurb: 'Equipment upgrades you meet the level for, ranked by stat gain per gold, and your next upgrade costs.',
  state: { style: 'melee', budget: '' },
  render(el) {
    const p = IC.data.profile, st = this.state;
    if (!p) { el.innerHTML = `<h2>Gear advisor</h2>${IC.ui.needUser()}`; return; }
    el.innerHTML = `<h2>Gear advisor</h2>
      <p class="muted">Compares what you are wearing with every item for the same slot that you meet the level requirement for and that has a market or shop price.</p>
      <div class="controls">
        <label>Combat style <select id="gStyle">${Object.entries(IC.STYLES).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}</select></label>
        <label>Max price <input type="number" id="gBudget" min="0" placeholder="any" value="${esc(st.budget)}"></label>
      </div>
      <div id="gT"></div>
      <p class="muted small">Score is strength + accuracy bonus for the chosen style (or the three defence bonuses added together). It ignores attack speed, set effects and enchantments, so use it to shortlist, then compare in game.</p>
      <h2 style="margin-top:18px">Your upgrades</h2><div id="uT"></div>
      <p class="muted small">Only the standard gold upgrades are listed; they are matched to your profile by the game's internal order. Tier values are the raw numbers from the game data.</p>`;
    el.querySelector('#gStyle').value = st.style;
    const draw = () => {
      const score = IC.STYLES[st.style].score, items = IC.data.game.items, budget = +st.budget || Infinity;
      const rows = [];
      for (const [slot, curId] of Object.entries(p.equipment || {})) {
        if (slot === 'pet' || slot === 'ammunition') continue;
        const cur = curId >= 0 ? items[curId] : null, curScore = cur ? score(cur.stats) : 0;
        for (const it of items) {
          if (!it || it.dead || it.id === curId) continue;
          const meta = IC.data.names.get(it.id);
          if (!meta || meta.equipmentSlot !== slot) continue;
          if (it.req && it.req.skill && IC.levels[it.req.skill] < it.req.level) continue;
          const gain = score(it.stats) - curScore;
          if (gain <= 0) continue;
          const price = it.noTrade ? null : IC.buyCost(it.id);
          if (price == null || price > budget) continue;
          rows.push({ slot, cur, it, gain, price, per: price / gain });
        }
      }
      IC.ui.table(el.querySelector('#gT'), {
        rows, sort: 5, dir: 1, limit: 40, empty: 'No affordable upgrades found for this style. Try another style or a higher budget.',
        cols: [
          { label: 'Slot', val: (r) => IC.pretty(r.slot) },
          { label: 'Wearing', val: (r) => (r.cur ? IC.itemName(r.cur.id) : ''), html: (r) => (r.cur ? IC.ui.itemLink(r.cur.id) : '<span class="muted">empty</span>') },
          { label: 'Upgrade', val: (r) => IC.itemName(r.it.id), html: (r) => IC.ui.itemLink(r.it.id) + (r.it.twoHanded ? '<span class="tag">2H</span>' : '') + (r.it.req ? `<span class="tag">${IC.skillName(r.it.req.skill)} ${r.it.req.level}</span>` : '') },
          { label: 'Gain', num: true, val: (r) => r.gain, html: (r) => `<span class="good">+${fmt.int(r.gain)}</span>` },
          { label: 'Price', num: true, val: (r) => r.price },
          { label: 'Gold per point', num: true, val: (r) => r.per },
        ],
      });
    };
    el.querySelector('#gStyle').onchange = (e) => { st.style = e.target.value; draw(); };
    el.querySelector('#gBudget').onchange = (e) => { st.budget = e.target.value; draw(); };
    draw();

    const ups = IC.data.game.upgrades.filter((u) => IC.UPGRADE_KEYS[u.type] && u.costs.length).map((u) => {
      const key = IC.UPGRADE_KEYS[u.type], tier = (p.upgrades || {})[key] || 0;
      const max = u.bulk ? null : u.tiers || u.costs.length;
      const done = max != null && tier >= max;
      const cost = done ? null : u.costs[Math.min(tier, u.costs.length - 1)];
      const missing = done ? [] : u.reqs.map((r) => ({ skill: r.skill, level: r.levels[Math.min(tier, r.levels.length - 1)] || 0 })).filter((r) => r.skill && IC.levels[r.skill] < r.level);
      return { key, tier, max, done, cost, missing, next: done ? null : u.values[tier], name: !done && u.names[tier] ? u.names[tier] : null };
    });
    IC.ui.table(el.querySelector('#uT'), {
      rows: ups, sort: 2, dir: 1, limit: 40,
      cols: [
        { label: 'Upgrade', val: (r) => IC.pretty(r.key), html: (r) => esc(IC.pretty(r.key)) + (r.name ? ` <span class="muted">→ ${esc(IC.pretty(r.name))}</span>` : '') },
        { label: 'Your tier', num: true, val: (r) => r.tier, html: (r) => `${r.tier}${r.max != null ? ' / ' + r.max : ''}` },
        { label: 'Next tier cost', num: true, val: (r) => r.cost, html: (r) => (r.done ? '<span class="good">maxed</span>' : fmt.short(r.cost)) },
        { label: 'Next tier value', num: true, val: (r) => r.next, html: (r) => (r.next == null ? '–' : fmt.int(r.next)) },
        { label: 'Ready?', val: (r) => (r.done ? 2 : r.missing.length ? 0 : 1), html: (r) => (r.done ? '' : r.missing.length ? `<span class="warn">needs ${esc(IC.ui.reqText(r.missing))}</span>` : '<span class="good">levels met</span>') },
      ],
    });
  },
};
