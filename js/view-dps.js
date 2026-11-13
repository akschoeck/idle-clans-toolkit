// DPS calculator: reproduces the game's premium "DPS" panel for any enemy and any gear set.
// The formulas were checked against in-game panels (12 enemies, one melee character): hit chance, max hit, DPS and
// kills per hour all matched. Archery and magic use the same formulas with their own stats but are unverified.
IC.combat = (() => {
  const T = Math.trunc;
  const STYLE = ['None', 'Stab', 'Slash', 'Pound', 'Crush', 'Archery', 'Magic'];
  const kind = (style) => (style === 5 ? 'archery' : style === 6 ? 'magic' : 'melee');
  // Accuracy and defence ratings: (bonus + 64) × (level + 8) / 10, truncated.
  const aug = (bonus, level) => T((bonus + 64) * (level + 8) / 10);
  const stage = (a, d) => (a < d ? (a - 1) / (2 * d) : 1 - (d + 1) / (2 * a));
  // The game runs its accuracy-vs-defence formula twice: once on the ratings, then again on the
  // whole-number percentage that comes out (percentage vs 100 − percentage).
  const chance = (acc, def) => { const b = T(stage(acc, Math.max(def, 1)) * 100); return Math.min(1, Math.max(0, stage(b, 100 - b))); };
  const maxHit = (bonus, level) => Math.max(0, T((bonus / 8 + level + 13 + bonus * level / 64) / 10));
  // Enemy hit chances in the game come out at exactly 0.8712 of the formula. The reason is unknown.
  const ENEMY_HIT_FACTOR = 0.8712;
  // Expected attacks to kill: each attack hits with chance p for a whole number from 1 to max, capped by remaining HP.
  function attacksToKill(hp, p, max) {
    if (!(p > 0) || max < 1) return Infinity;
    const E = [0];
    for (let h = 1; h <= hp; h++) {
      let s = 0;
      for (let d = 1; d <= max; d++) s += E[Math.max(0, h - d)];
      E[h] = (1 + (p / max) * s) / p;
    }
    return E[hp];
  }
  // gear: { slot: itemId }. Returns summed bonuses plus the weapon. A two-handed weapon disables the off-hand.
  function gearTotals(gear) {
    const items = IC.data.game.items, tot = { str: 0, acc: 0, aStr: 0, aAcc: 0, mStr: 0, mAcc: 0, def: 0, aDef: 0, mDef: 0 };
    const weapon = gear.rightHand >= 0 ? items[gear.rightHand] : null;
    for (const [slot, id] of Object.entries(gear)) {
      const it = id >= 0 ? items[id] : null;
      if (!it || (slot === 'leftHand' && weapon && weapon.twoHanded)) continue;
      for (const k of Object.keys(tot)) tot[k] += it.stats[k] || 0;
    }
    return { tot, weapon };
  }
  // levels: { attack, strength, defence, archery, magic, agility }. m: monster from game data.
  function calc(gear, levels, m) {
    const g = IC.data.game.settings, { tot, weapon } = gearTotals(gear);
    const L = (k) => levels[k] || 1;
    const style = weapon ? weapon.style : 0, type = kind(style);
    const interval = (weapon && weapon.interval) || g.unarmedMs;
    const mine = { melee: [tot.acc, L('attack'), tot.str, L('strength')], archery: [tot.aAcc, L('archery'), tot.aStr, L('archery')], magic: [tot.mAcc, L('magic'), tot.mStr, L('magic')] }[type];
    const weak = style > 0 && m.weak === style;
    let enemyDef = aug({ melee: m.s.defB, archery: m.s.aDefB, magic: m.s.mDefB }[type], m.s.def);
    let max = maxHit(mine[2], mine[3]);
    if (weak) { enemyDef = T(enemyDef * (1 - g.weakDef / 100)); max = T(max * (1 + g.weakDmg / 100)); }
    const hit = chance(aug(mine[0], mine[1]), enemyDef);
    const respawn = (m.respawn || g.respawnMs) / 1000;
    const secs = attacksToKill(m.hp, hit, max) * interval / 1000 + respawn;
    const kills = 3600 / secs, dmgHr = kills * m.hp;

    const eType = kind(m.style);
    const theirs = { melee: [m.s.accB, m.s.att, m.s.strB, m.s.str], archery: [m.s.aAccB, m.s.arch, m.s.aStrB, m.s.arch], magic: [m.s.mAccB, m.s.mag, m.s.mStrB, m.s.mag] }[eType];
    const myDef = aug({ melee: tot.def, archery: tot.aDef, magic: tot.mDef }[eType], L('defence'));
    const eHit = chance(aug(theirs[0], theirs[1]), myDef) * ENEMY_HIT_FACTOR, eMax = maxHit(theirs[2], theirs[3]);
    const dodge = Math.min(L('agility'), 120) * 0.0018;
    // Damage you take: the enemy only attacks while it is alive, so the respawn wait is excluded.
    const fightShare = isFinite(secs) ? (secs - respawn) / secs : 1;
    const takenHr = fightShare * 3600 / (m.interval / 1000) * eHit * (1 - dodge) * eMax / 2;
    return {
      tot, weapon, style, type, weak, interval, hit, max, secs, respawn, kills: isFinite(kills) ? kills : 0, dps: isFinite(secs) ? m.hp / secs : 0, dmgHr: isFinite(dmgHr) ? dmgHr : 0,
      dodge, takenHr,
      enemy: { type: eType, hit: eHit, max: eMax, dps: eHit * eMax / 2 / (m.interval / 1000) },
    };
  }
  return { STYLE, kind, aug, chance, maxHit, attacksToKill, gearTotals, calc };
})();

IC.views.dps = {
  label: 'DPS Calculator',
  blurb: 'Hit chance, max hit, DPS and kills per hour against any enemy, with your current gear or any gear you want to try.',
  SLOTS: ['rightHand', 'leftHand', 'head', 'body', 'legs', 'gloves', 'boots', 'cape', 'amulet', 'jewellery', 'bracelet', 'earrings', 'belt', 'ammunition', 'pet'],
  SLOT_LABEL: { rightHand: 'Weapon', leftHand: 'Off-hand', jewellery: 'Ring', ammunition: 'Ammunition' },
  state: { user: null, gear: null, monster: null },
  slotLabel(s) { return this.SLOT_LABEL[s] || IC.pretty(s); },
  worn() { return Object.assign({}, (IC.data.profile && IC.data.profile.equipment) || {}); },
  monster() { const ms = IC.data.game.monsters; return ms.find((m) => m.key === this.state.monster) || ms[0]; },
  // Gear the calculators should use: whatever is set up on this tab for the loaded character, else what is worn.
  gearFor() { const st = this.state, p = IC.data.profile; return st.gear && p && st.user === p.username ? st.gear : this.worn(); },
  gearChanged() { const g = this.gearFor(), w = this.worn(); return Object.keys(Object.assign({}, g, w)).some((k) => (g[k] == null ? -1 : g[k]) !== (w[k] == null ? -1 : w[k])); },
  loot(m, r) {
    const shop = IC.lootValue(m.loot, 'shop').total, market = IC.lootValue(m.loot).total, key = m.keyId != null ? IC.buyCost(m.keyId) || 0 : 0;
    return { shop, market, key, shopHr: shop * r.kills, marketHr: (market - key) * r.kills };
  },
  // The two result cards ("Your stats" and the enemy), shared with the monster dialog on the Combat tab.
  statsHtml(r, m, lootLink) {
    const C = IC.combat, L = IC.levels, lv = this.loot(m, r);
    const row = (label, value, title) => `<tr title="${esc(title || '')}"><td class="muted">${label}</td><td class="num"><b>${value}</b></td></tr>`;
    const why = (label) => (lootLink ? `<button class="link" data-lootinfo title="Show how this is worked out">${label}</button>` : label);
    return `<div class="cols">
      <div class="card"><h3>Your stats</h3><table><tbody>
        ${row('Hit chance', fmt.pct(r.hit, 2))}
        ${row('Dodge chance', fmt.pct(r.dodge, 2), '0.18% per Agility level')}
        ${row('Max hit', fmt.int(r.max) + (r.weak ? '<span class="tag good">weakness</span>' : ''))}
        ${row('DPS', fmt.dec(r.dps, 2), 'Damage per second including the respawn wait and damage wasted on the killing blow')}
        ${row('Estimated kills per hour', fmt.int(Math.floor(r.kills)), `${fmt.dec(r.secs, 1)} seconds per kill including respawn`)}
        ${row('Average kill time', isFinite(r.secs) ? `${fmt.dec(r.secs - r.respawn, 1)}s` : '–', `Fighting time only. With the ${fmt.dec(r.respawn, 2)}s respawn wait it is ${fmt.dec(r.secs, 1)}s per kill. This is the number the Combat tab's "My average kill time" box expects.`)}
        ${row('Mixed exp per hour', fmt.int(r.dmgHr * 4 / 3), 'Per skill on the Mixed style. Total combat XP is 4 per damage, plus 1 per damage to Health.')}
        ${row('Total combat exp per hour', fmt.int(r.dmgHr * 4))}
        ${row('Health exp per hour', fmt.int(r.dmgHr))}
        ${row(why('Loot per hour, base sell value'), fmt.int(lv.shopHr))}
        ${row(why('Loot per hour, player market'), fmt.int(lv.marketHr), lv.key ? `After ${fmt.short(lv.key)} per kill for the key` : '')}
      </tbody></table>
      <p class="muted small">${esc(IC.pretty(r.type))} attack${r.weapon ? ` with ${esc(IC.itemName(r.weapon.id))}` : ', unarmed'} every ${fmt.dec(r.interval / 1000, 2)}s${r.style ? ` (${C.STYLE[r.style]})` : ''}. Levels used: Attack ${L.attack}, Strength ${L.strength}, Defence ${L.defence}, Archery ${L.archery}, Magic ${L.magic}, Agility ${L.agility}.${lootLink ? ' Click a loot line to see how it is worked out.' : ''}</p></div>
      <div class="card"><h3>${esc(IC.pretty(m.key))} <span class="muted small">Lvl ${m.lvl} · ${fmt.int(m.hp)} HP</span></h3><table><tbody>
        ${row('Hit chance', fmt.pct(r.enemy.hit, 2))}
        ${row('Max hit', fmt.int(r.enemy.max))}
        ${row('DPS', fmt.dec(r.enemy.dps, 4), 'Approximate, before your dodge chance')}
        ${row('Weakness', C.STYLE[m.weak] || 'None')}
        ${row('Attack style', esc(IC.pretty(r.enemy.type)))}
        ${row('Attack / Strength / Defence', `${m.s.att} / ${m.s.str} / ${m.s.def}`)}
        ${row('Archery / Magic', `${m.s.arch} / ${m.s.mag}`)}
      </tbody></table></div></div>`;
  },
  // Top 10 enemies by XP and by gold per hour for the gear currently set on this tab.
  bestHtml() {
    const st = this.state, foods = this.foods();
    const food = foods.find((f) => f.id === IC.store.get('dpsFood', null)) || foods[Math.floor(foods.length / 2)];
    const foodPrice = food && !food.noTrade ? IC.buyCost(food.id) : null;
    const maxLvl = +st.topMax || Infinity, ext = (IC.levels && IC.levels.exterminating) || 1;
    let hidden = 0;
    const rows = [];
    for (const m of IC.data.game.monsters) {
      if (m.lvl > maxLvl) continue;
      const special = m.boss || m.keyId != null || m.zone === 'invocation';
      const locked = m.zone === 'exterminating' && m.req > ext;
      if ((special || locked) && !st.topAll) { hidden++; continue; }
      const r = IC.combat.calc(st.gear, IC.levels, m);
      if (!(r.kills > 0)) continue;
      const foodCost = food && foodPrice != null ? (r.takenHr / food.heal) * foodPrice : 0;
      rows.push({ m, r, xp: r.dmgHr * 5, gold: this.loot(m, r).marketHr - foodCost, foodHr: food ? r.takenHr / food.heal : null, locked });
    }
    const list = (key, label, value) => {
      const top = rows.slice().sort((a, b) => b[key] - a[key]).slice(0, 10);
      return `<div><h4 style="margin:0 0 6px">${label}</h4><div class="tablewrap"><table><thead><tr><th>#</th><th>Enemy</th><th class="num">Lvl</th><th class="num">${value}</th><th class="num">Kills/hr</th><th class="num" title="Pieces of the selected food eaten per hour">Food/hr</th></tr></thead><tbody>
        ${top.map((x, i) => `<tr><td class="muted">${i + 1}</td><td><button class="link" data-goto-mon="${esc(x.m.key)}" title="Load this enemy above">${esc(IC.pretty(x.m.key))}</button>${x.m.key === this.monster().key ? '<span class="tag good">selected</span>' : ''}${x.locked ? `<span class="tag warn">Exterminating ${x.m.req}</span>` : ''}</td><td class="num">${x.m.lvl}</td><td class="num"><b>${fmt.int(x[key])}</b></td><td class="num">${fmt.int(Math.floor(x.r.kills))}</td><td class="num">${x.foodHr == null ? '–' : fmt.dec(x.foodHr, x.foodHr < 10 ? 1 : 0)}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">No enemies match.</td></tr>'}
      </tbody></table></div></div>`;
    };
    return `<div class="card"><h3>Best enemies with this gear</h3>
      <div class="controls"><label title="Hide enemies above this level">Max level <input type="number" id="dTopMax" min="1" placeholder="any" value="${esc(st.topMax || '')}"></label>
        <label><input type="checkbox" id="dTopAll" ${st.topAll ? 'checked' : ''}> Include bosses, Invocation enemies and Exterminating enemies I have not unlocked</label></div>
      <div class="cols">${list('xp', 'Top 10 by XP per hour', 'XP/hr')}${list('gold', 'Top 10 by gold per hour', 'Gold/hr')}</div>
      <p class="muted small">Recalculated whenever you change a piece of gear. XP is total combat plus Health XP (5 per damage). Gold is market loot at the sell price chosen above${food && foodPrice != null ? `, less the cost of ${esc(IC.itemName(food.id))} eaten` : ''}. Click an enemy to load it above.${hidden && !st.topAll ? ` ${hidden} bosses, Invocation and locked Exterminating enemies are hidden.` : ''} It does not check whether you can survive the fight: watch the Food/hr column and the enemy's max hit.</p></div>`;
  },
  foods() { return IC.data.game.items.filter((i) => i && i.heal > 0 && !i.dead).sort((a, b) => a.heal - b.heal); },
  foodHtml(r, m) {
    const foods = this.foods(); if (!foods.length) return '';
    const saved = IC.store.get('dpsFood', null), food = foods.find((f) => f.id === saved) || foods[Math.floor(foods.length / 2)];
    const perHr = r.takenHr / food.heal, price = food.noTrade ? null : IC.buyCost(food.id), lv = this.loot(m, r);
    const row = (label, value, title) => `<tr title="${esc(title || '')}"><td class="muted">${label}</td><td class="num"><b>${value}</b></td></tr>`;
    return `<div class="card"><h3>Food</h3>
      <div class="controls"><label>Food <select id="dFood">${foods.map((f) => `<option value="${f.id}" ${f.id === food.id ? 'selected' : ''}>${esc(IC.itemName(f.id))} (heals ${fmt.int(f.heal)})</option>`).join('')}</select></label></div>
      <table><tbody>
        ${row('Damage taken per hour', fmt.dec(r.takenHr, 1), 'Enemy hit chance × chance you fail to dodge × average hit × its attacks per hour while it is alive')}
        ${row(`${esc(IC.itemName(food.id))} eaten per hour`, fmt.dec(perHr, perHr < 10 ? 2 : 1), `Damage taken ÷ ${fmt.int(food.heal)} health per piece`)}
        ${row('One piece lasts', perHr > 0 ? IC.fmt.hours(1 / perHr) : '–')}
        ${row('Food cost per hour', price == null ? 'no price' : fmt.int(perHr * price), price == null ? '' : `${fmt.int(price)} gold each at the cheapest current offer`)}
        ${price == null ? '' : row('Market loot per hour after food', `<span class="${lv.marketHr - perHr * price >= 0 ? 'good' : 'bad'}">${fmt.int(lv.marketHr - perHr * price)}</span>`)}
      </tbody></table>
      <p class="muted small">Long-run average. It assumes every point of healing is used; eating at high health wastes some, so real use is a little higher. Enemy average damage is taken as half its max hit.</p></div>`;
  },
  render(el) {
    const p = IC.data.profile, st = this.state;
    if (!p) { el.innerHTML = `<h2>DPS calculator</h2>${IC.ui.needUser()}`; return; }
    if (!st.gear || st.user !== p.username) { st.gear = this.worn(); st.user = p.username; }
    if (!st.monster) st.monster = IC.store.get('dpsMonster', '') || IC.data.game.monsters[0].key;
    const zones = [...new Set(IC.data.game.monsters.map((m) => m.zone))];
    el.innerHTML = `<h2>DPS calculator</h2>
      <p class="muted">Starts from the gear ${esc(p.username)} is wearing right now. Click any piece to try a different one; the numbers update straight away.</p>
      <div class="dps-layout">
        <div class="card"><div class="dps-head"><b>Gear</b><button id="dReset" title="Re-load what you are actually wearing from the game">Reset all to worn gear</button></div><div id="dGear"></div></div>
        <div>
          <div class="controls"><label>Enemy <select id="dMon">${zones.map((z) => `<optgroup label="${esc(IC.pretty(z || 'Other'))}">${IC.data.game.monsters.filter((m) => m.zone === z).sort((a, b) => a.lvl - b.lvl).map((m) => `<option value="${esc(m.key)}">${esc(IC.pretty(m.key))} (Lvl ${m.lvl})</option>`).join('')}</optgroup>`).join('')}</select></label>${IC.ui.sellModeSelect()}</div>
          <div id="dOut"></div>
        </div>
      </div>
      <p class="muted small">Formulas were matched against the in-game DPS panel for melee. Archery and magic use the same formulas with their own stats and have not been checked. Not included: potions, enchantments, clan and upgrade boosts, special weapon effects and the daily XP boost. Loot per hour is a long-run average and ignores food, deaths and boss mechanics.</p>`;
    el.querySelector('#dMon').value = this.monster().key;
    el.querySelector('#dMon').onchange = (e) => { st.monster = e.target.value; IC.store.set('dpsMonster', st.monster); this.draw(el); };
    el.querySelector('#dReset').onclick = () => this.reset(el, null);
    el.querySelector('#dGear').onclick = (e) => {
      const pick = e.target.closest('[data-slot]'), re = e.target.closest('[data-reset]');
      if (re) this.reset(el, re.dataset.reset); else if (pick) this.picker(el, pick.dataset.slot);
    };
    IC.ui.bindSellMode(el, () => this.draw(el));
    this.draw(el);
  },
  // Re-fetch the profile, then restore one slot (or everything) to what is actually equipped.
  async reset(el, slot) {
    const st = this.state, name = IC.data.profile.username;
    try { await IC.loadProfile(name, true); } catch (e) { /* keep the copy we have */ }
    if (!IC.data.profile) return;
    const worn = this.worn();
    if (slot) st.gear[slot] = worn[slot]; else st.gear = worn;
    if (IC.currentView === 'dps') this.draw(el);
  },
  bonusText(it, type) {
    const s = it.stats, parts = [];
    const add = (label, v) => { if (v) parts.push(`${label} ${v > 0 ? '+' : ''}${v}`); };
    if (type === 'archery') { add('Str', s.aStr); add('Acc', s.aAcc); } else if (type === 'magic') { add('Str', s.mStr); add('Acc', s.mAcc); } else { add('Str', s.str); add('Acc', s.acc); }
    add('Def', s.def); add('Arch def', s.aDef); add('Mag def', s.mDef);
    return parts.join(' · ');
  },
  draw(el) {
    const st = this.state, items = IC.data.game.items, m = this.monster(), worn = this.worn();
    const r = IC.combat.calc(st.gear, IC.levels, m), C = IC.combat;
    const twoH = r.weapon && r.weapon.twoHanded;
    const slots = this.SLOTS.filter((s) => s in st.gear || s in worn).concat(Object.keys(st.gear).filter((s) => !this.SLOTS.includes(s)));
    el.querySelector('#dGear').innerHTML = `<div class="tablewrap"><table><tbody>${slots.map((slot) => {
      const id = st.gear[slot], it = id >= 0 ? items[id] : null, changed = (worn[slot] == null ? -1 : worn[slot]) !== (id == null ? -1 : id);
      const off = slot === 'leftHand' && twoH;
      return `<tr><td class="muted">${esc(this.slotLabel(slot))}</td>
        <td><button class="link" data-slot="${slot}" title="Choose a different item">${it ? esc(IC.itemName(id)) : '<span class="muted">empty</span>'}</button>${changed ? '<span class="tag warn">changed</span>' : ''}${off && it ? '<span class="tag">unused: two-handed weapon</span>' : ''}
          ${it ? `<div class="muted small">${esc(this.bonusText(it, r.type))}${it.interval && slot === 'rightHand' ? ` · ${fmt.dec(it.interval / 1000, 2)}s ${C.STYLE[it.style] || ''}` : ''}</div>` : ''}</td>
        <td class="num"><button class="ghost small" data-reset="${slot}" title="Set this slot back to what you are wearing" ${changed ? '' : 'disabled'}>Reset</button></td></tr>`;
    }).join('')}</tbody></table></div>
      <div class="dps-bonus"><div><b>Melee</b> Strength: ${r.tot.str} | Accuracy: ${r.tot.acc} | Defence: ${r.tot.def}</div>
      <div><b>Archery</b> Strength: ${r.tot.aStr} | Accuracy: ${r.tot.aAcc} | Defence: ${r.tot.aDef}</div>
      <div><b>Magic</b> Strength: ${r.tot.mStr} | Accuracy: ${r.tot.mAcc} | Defence: ${r.tot.mDef}</div></div>`;

    const out = el.querySelector('#dOut');
    out.innerHTML = this.statsHtml(r, m, true) + this.foodHtml(r, m) + this.bestHtml();
    out.onclick = (e) => {
      const go = e.target.closest('[data-goto-mon]');
      if (go) { st.monster = go.dataset.gotoMon; IC.store.set('dpsMonster', st.monster); el.querySelector('#dMon').value = st.monster; this.draw(el); el.querySelector('#dMon').scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      else if (e.target.closest('[data-lootinfo]')) IC.views.combat.lootDialog(m.key);
    };
    const tMax = out.querySelector('#dTopMax'), tAll = out.querySelector('#dTopAll');
    if (tMax) tMax.onchange = () => { st.topMax = tMax.value; this.draw(el); };
    if (tAll) tAll.onchange = () => { st.topAll = tAll.checked; this.draw(el); };
    const food = out.querySelector('#dFood');
    if (food) food.onchange = () => { IC.store.set('dpsFood', +food.value); this.draw(el); };
  },
  // Dialog listing every item for a slot, ranked by the DPS it would give against the selected enemy.
  picker(el, slot) {
    const st = this.state, items = IC.data.game.items, m = this.monster(), cur = st.gear[slot];
    const base = IC.combat.calc(st.gear, IC.levels, m);
    const rows = [{ id: -1, it: null }];
    for (const it of items) {
      if (!it || it.dead) continue;
      const meta = IC.data.names.get(it.id);
      if (meta && meta.equipmentSlot === slot) rows.push({ id: it.id, it });
    }
    for (const r of rows) {
      const c = IC.combat.calc(Object.assign({}, st.gear, { [slot]: r.id }), IC.levels, m);
      r.dps = c.dps; r.eHit = c.enemy.hit; r.type = c.type;
      r.unmet = !!(r.it && r.it.req && r.it.req.skill && (IC.levels[r.it.req.skill] || 1) < r.it.req.level);
      r.price = r.it && !r.it.noTrade ? IC.buyCost(r.id) : null;
    }
    const body = IC.ui.dialog(`<div class="dlg-head"><div><h2>${esc(this.slotLabel(slot))}</h2><div class="muted small">DPS shown is against ${esc(IC.pretty(m.key))} with the rest of your selected gear.</div></div><button class="ghost" data-close>Close</button></div>
      <div class="controls"><input type="search" id="pQ" placeholder="Search item…"><label><input type="checkbox" id="pCan" checked> Only items I meet the level for</label></div><div id="pT"></div>`);
    const show = () => {
      const q = body.querySelector('#pQ').value.trim().toLowerCase(), can = body.querySelector('#pCan').checked;
      IC.ui.table(body.querySelector('#pT'), {
        rows: rows.filter((r) => (!can || !r.unmet || r.id === cur) && (!q || (r.it ? IC.itemName(r.id).toLowerCase().includes(q) : 'empty'.includes(q)))),
        sort: 1, limit: 60, rowClass: (r) => (r.unmet ? 'locked' : ''), empty: 'No items match.',
        cols: [
          { label: 'Item', val: (r) => (r.it ? IC.itemName(r.id) : ''), html: (r) => `<button class="link" data-pick="${r.id}">${r.it ? esc(IC.itemName(r.id)) : 'Empty slot'}</button>${r.id === (cur == null ? -1 : cur) ? '<span class="tag good">selected</span>' : ''}${r.it && r.it.twoHanded ? '<span class="tag">2H</span>' : ''}${r.it && r.it.req ? `<span class="tag ${r.unmet ? 'warn' : ''}">${esc(IC.skillName(r.it.req.skill))} ${r.it.req.level}</span>` : ''}${r.it ? `<div class="muted small">${esc(this.bonusText(r.it, r.type))}</div>` : ''}` },
          { label: 'DPS', num: true, val: (r) => r.dps, html: (r) => `${fmt.dec(r.dps, 2)} <span class="small ${r.dps > base.dps + 1e-9 ? 'good' : r.dps < base.dps - 1e-9 ? 'bad' : 'muted'}">${r.dps - base.dps >= 0 ? '+' : ''}${fmt.dec(r.dps - base.dps, 2)}</span>` },
          { label: 'Enemy hit', num: true, val: (r) => r.eHit, html: (r) => fmt.pct(r.eHit, 2), title: 'Chance the enemy hits you with this item equipped' },
          { label: 'Price', num: true, val: (r) => r.price, html: (r) => (r.price == null ? '<span class="muted">–</span>' : fmt.short(r.price)) },
        ],
      });
    };
    body.querySelector('#pQ').oninput = show; body.querySelector('#pCan').onchange = show;
    body.querySelector('#pT').addEventListener('click', (e) => {
      const b = e.target.closest('[data-pick]'); if (!b) return;
      st.gear[slot] = +b.dataset.pick;
      document.getElementById('dialog').close();
      this.draw(el);
    });
    show();
  },
};
