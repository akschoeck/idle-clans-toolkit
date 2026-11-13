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
    return {
      tot, weapon, style, type, weak, interval, hit, max, secs, kills, dps: isFinite(secs) ? m.hp / secs : 0, dmgHr: isFinite(dmgHr) ? dmgHr : 0,
      dodge: Math.min(L('agility'), 120) * 0.0018,
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

    const shop = IC.lootValue(m.loot, 'shop').total, market = IC.lootValue(m.loot).total;
    const key = m.keyId != null ? IC.buyCost(m.keyId) || 0 : 0;
    const row = (label, value, title) => `<tr title="${esc(title || '')}"><td class="muted">${label}</td><td class="num"><b>${value}</b></td></tr>`;
    const L = IC.levels;
    el.querySelector('#dOut').innerHTML = `<div class="cols">
      <div class="card"><h3>Your stats</h3><table><tbody>
        ${row('Hit chance', fmt.pct(r.hit, 2))}
        ${row('Dodge chance', fmt.pct(r.dodge, 2), '0.18% per Agility level')}
        ${row('Max hit', fmt.int(r.max) + (r.weak ? '<span class="tag good">weakness</span>' : ''))}
        ${row('DPS', fmt.dec(r.dps, 2), 'Damage per second including the respawn wait and damage wasted on the killing blow')}
        ${row('Estimated kills per hour', fmt.int(Math.floor(r.kills)), `${fmt.dec(r.secs, 1)} seconds per kill including respawn`)}
        ${row('Mixed exp per hour', fmt.int(r.dmgHr * 4 / 3), 'Per skill on the Mixed style. Total combat XP is 4 per damage, plus 1 per damage to Health.')}
        ${row('Total combat exp per hour', fmt.int(r.dmgHr * 4))}
        ${row('Health exp per hour', fmt.int(r.dmgHr))}
        ${row('Loot per hour, base sell value', fmt.int(shop * r.kills))}
        ${row('Loot per hour, player market', fmt.int((market - key) * r.kills), key ? `After ${fmt.short(key)} per kill for the key` : '')}
      </tbody></table>
      <p class="muted small">${esc(IC.pretty(r.type))} attack${r.weapon ? ` with ${esc(IC.itemName(r.weapon.id))}` : ', unarmed'} every ${fmt.dec(r.interval / 1000, 2)}s${r.style ? ` (${C.STYLE[r.style]})` : ''}. Levels used: Attack ${L.attack}, Strength ${L.strength}, Defence ${L.defence}, Archery ${L.archery}, Magic ${L.magic}, Agility ${L.agility}.</p></div>
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
