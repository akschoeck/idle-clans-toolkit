// Gear: upgrades you can equip, ranked by stat gain per gold. Plus your purchasable upgrades.
IC.STYLES = {
  melee: { label: 'Melee', score: (s) => s.str + s.acc },
  archery: { label: 'Archery', score: (s) => s.aStr + s.aAcc },
  magic: { label: 'Magic', score: (s) => s.mStr + s.mAcc },
  defence: { label: 'Defence', score: (s) => s.def + s.aDef + s.mDef },
};
// Player-profile keys for the gold upgrades, matched to the game's upgrade enum by order.
IC.UPGRADE_KEYS = { 0: 'housing', 1: 'keepItSpacious', 2: 'theLumberjack', 3: 'theFisherman', 4: 'autoEating', 5: 'autoLooting', 6: 'offlineProgress', 8: 'farmingTrickery', 9: 'powerForager', 10: 'smeltingMagic', 11: 'mostEfficientFisherman', 12: 'plankBargain', 13: 'ammo-saver', 15: 'monsterHunter', 24: 'teamwork' };

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
      <p class="muted small">Score is strength + accuracy bonus for the chosen style (or the three defence bonuses added together). It ignores attack speed, set effects and enchantments, so use it to shortlist, then compare in game. The two hands are scored together: a two-handed weapon such as a bow leaves no room for an off-hand item, so while you wear one, off-hand items are only offered as a pair with a one-handed weapon such as a crossbow, with both prices added and the gain measured against your current weapon. A two-handed upgrade has your off-hand item's bonus taken off its gain. Crossbows hit every 3.5 seconds against a bow's 2.5, which this score does not see; check a pair on the DPS Calculator tab before buying.</p>
      <h2 style="margin-top:18px">Your upgrades</h2><div id="uT"></div>
      <p class="muted small">Only the standard gold upgrades are listed; they are matched to your profile by the game's internal order. Tier values are the raw numbers from the game data.</p>`;
    el.querySelector('#gStyle').value = st.style;
    const draw = () => {
      const score = IC.STYLES[st.style].score, items = IC.data.game.items, budget = +st.budget || Infinity;
      const rows = [];
      // Candidates for a slot: items the player meets the level for and can buy within the budget.
      const options = (slot) => items.filter((it) => {
        if (!it || it.dead) return false;
        const meta = IC.data.names.get(it.id);
        if (!meta || meta.equipmentSlot !== slot) return false;
        return !(it.req && it.req.skill && IC.levels[it.req.skill] < it.req.level);
      }).map((it) => ({ it, price: it.noTrade ? null : IC.buyCost(it.id) })).filter((o) => o.price != null);
      // The two hands are one decision: a two-handed weapon (every bow, for one) leaves no room for an off-hand item,
      // while one-handed weapons (crossbows) allow one. So the hands are scored together.
      const eq = p.equipment || {}, weapon = eq.rightHand >= 0 ? items[eq.rightHand] : null, twoH = !!(weapon && weapon.twoHanded);
      const off = !twoH && eq.leftHand >= 0 ? items[eq.leftHand] : null;
      const wScore = weapon ? score(weapon.stats) : 0, offScore = off ? score(off.stats) : 0;
      for (const [slot, curId] of Object.entries(eq)) {
        if (slot === 'pet' || slot === 'ammunition') continue;
        if (slot === 'leftHand' && twoH) continue; // no off-hand with the weapon worn: offered as pairs below
        const cur = curId >= 0 ? items[curId] : null, curScore = cur ? score(cur.stats) : 0;
        for (const { it, price } of options(slot)) {
          if (it.id === curId || price > budget) continue;
          // A two-handed weapon also takes away whatever the off-hand item was adding.
          const drops = slot === 'rightHand' && it.twoHanded && off ? off : null;
          const gain = score(it.stats) - curScore - (drops ? offScore : 0);
          if (gain <= 0) continue;
          rows.push({ slot, cur, it, gain, price, per: price / gain, drops });
        }
      }
      if (twoH) {
        // Swapping the two-handed weapon for a one-handed one plus an off-hand item. Every combination is scored against
        // the weapon worn; kept are each weapon's and each off-hand item's cheapest pair per point gained.
        const pairs = [];
        const ws = options('rightHand').filter((o) => !o.it.twoHanded), os = options('leftHand');
        for (const w of ws) for (const o of os) {
          const gain = score(w.it.stats) + score(o.it.stats) - wScore, price = w.price + o.price;
          if (gain <= 0 || price > budget || score(o.it.stats) <= 0) continue;
          pairs.push({ slot: 'weapon + off-hand', cur: weapon, it: w.it, it2: o.it, gain, price, per: price / gain });
        }
        pairs.sort((x, y) => x.per - y.per);
        const seenW = new Set(), seenO = new Set();
        for (const x of pairs) {
          if (seenW.has(x.it.id) && seenO.has(x.it2.id)) continue;
          seenW.add(x.it.id); seenO.add(x.it2.id); rows.push(x);
        }
      }
      IC.ui.table(el.querySelector('#gT'), {
        rows, sort: 5, dir: 1, limit: 40, empty: 'No affordable upgrades found for this style. Try another style or a higher budget.',
        cols: [
          { label: 'Slot', val: (r) => IC.pretty(r.slot) },
          { label: 'Wearing', val: (r) => (r.cur ? IC.itemName(r.cur.id) : ''), html: (r) => (r.cur ? IC.ui.itemLink(r.cur.id) : '<span class="muted">empty</span>') },
          { label: 'Upgrade', val: (r) => IC.itemName(r.it.id), html: (r) => { const one = (it) => IC.ui.itemLink(it.id) + (it.twoHanded ? '<span class="tag">2H</span>' : '') + (it.req ? `<span class="tag">${IC.skillName(it.req.skill)} ${it.req.level}</span>` : ''); return one(r.it) + (r.it2 ? ' + ' + one(r.it2) : '') + (r.drops ? `<span class="tag warn" title="Two-handed: your ${esc(IC.itemName(r.drops.id))} could no longer be worn. The gain already has its bonus taken off.">replaces off-hand</span>` : ''); } },
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
