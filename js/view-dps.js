// DPS calculator: reproduces the game's premium "DPS" panel for any enemy and any gear set.
// The formulas were checked against in-game panels (12 enemies, one melee character): hit chance, max hit, DPS and
// kills per hour all matched. Archery and magic use the same formulas with their own stats but are unverified.
IC.combat = (() => {
  const T = Math.trunc;
  const STYLE = ['None', 'Stab', 'Slash', 'Pound', 'Crush', 'Archery', 'Magic', undefined, 'All']; // 8 = weak to every style
  const kind = (style) => (style === 5 ? 'archery' : style === 6 ? 'magic' : 'melee');
  // Accuracy and defence ratings: (bonus + 64) × (level + 8) / 10, truncated.
  const aug = (bonus, level) => T((bonus + 64) * (level + 8) / 10);
  const stage = (a, d) => (a < d ? (a - 1) / (2 * d) : 1 - (d + 1) / (2 * a));
  // The game runs its accuracy-vs-defence formula twice: once on the ratings, then again on the
  // whole-number percentage that comes out (percentage vs 100 − percentage).
  // Accuracy boosts (potions, enchantments, capes) multiply that whole-number percentage, per the wiki. Unverified in game.
  const chance = (acc, def, boostPct) => { let b = T(stage(acc, Math.max(def, 1)) * 100); if (boostPct) b = Math.min(100, T(b * (1 + boostPct / 100) + 1e-9)); return Math.min(1, Math.max(0, stage(b, 100 - b))); };
  const maxHit = (bonus, level) => Math.max(0, T((bonus / 8 + level + 13 + bonus * level / 64) / 10));
  // Enemy hit chances in the game come out at exactly 0.8712 of the formula. The reason is unknown.
  const ENEMY_HIT_FACTOR = 0.8712;
  // Expected attacks to kill: each attack hits with chance p for a whole number from min (normally 1) to max, capped by remaining HP.
  function attacksToKill(hp, p, max, min) {
    if (!(p > 0) || max < 1) return Infinity;
    min = Math.min(Math.max(1, min || 1), max);
    const E = [0], n = max - min + 1;
    for (let h = 1; h <= hp; h++) {
      let s = 0;
      for (let d = min; d <= max; d++) s += E[Math.max(0, h - d)];
      E[h] = (1 + (p / n) * s) / p;
    }
    return E[hp];
  }
  // Boosts read straight from the loaded profile: jewellery enchantments and owned combat upgrades.
  function auto() {
    const p = IC.data.profile || {}, u = p.upgrades || {};
    return { ench: p.enchantmentBoosts || {}, monsterHunter: u.monsterHunter > 0, bountyHunter: u.upgrade_bounty_hunter > 0, principles: u.upgrade_principles_of_combat > 0 };
  }
  const upgradeValue = (type, fallback) => { const u = IC.data.game.upgrades.find((x) => x.type === type); return (u && u.values[0]) || fallback; };
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
  // opts: the tick boxes on the DPS tab (quest, assign, purePower, greatSight, swiftness, resurrection, getUp, clanDmg).
  // Boosts that follow from the profile or the gear (enchantments, upgrades, capes, weapon bonuses) are always applied.
  // How boosts combine follows the wiki: weakness, enchantment, cape and potion damage add up into one factor; weapon
  // bonuses and upgrades multiply on top. Only weakness and Monster hunter have been checked against the game.
  function calc(gear, levels, m, opts) {
    const g = IC.data.game.settings, items = IC.data.game.items, { tot, weapon } = gearTotals(gear);
    const o = Object.assign(auto(), opts || {}), pot = g.potion || {}, notes = [];
    const L = (k) => levels[k] || 1;
    const style = weapon ? weapon.style : 0, type = kind(style);
    const cape = (gear.cape >= 0 && items[gear.cape] && items[gear.cape].cape) || {};
    const ench = (k) => +o.ench[k] || 0, capePct = (k) => cape[k] || 0;
    const accSkill = { melee: 'attack', archery: 'archery', magic: 'magic' }[type], dmgSkill = { melee: 'strength', archery: 'archery', magic: 'magic' }[type];
    const mine = { melee: [tot.acc, L('attack'), tot.str, L('strength')], archery: [tot.aAcc, L('archery'), tot.aStr, L('archery')], magic: [tot.mAcc, L('magic'), tot.mStr, L('magic')] }[type];
    const weak = style > 0 && (m.weak === style || m.weak === 8);
    const quest = !!o.quest && !m.event, assign = !!o.assign && o.bountyHunter && !m.event;
    let enemyDef = aug({ melee: m.s.defB, archery: m.s.aDefB, magic: m.s.mDefB }[type], m.s.def);
    if (weak) enemyDef = T(enemyDef * (1 - g.weakDef / 100));

    // Accuracy and damage boosts in percent; mult collects the factors that multiply on top of the damage pool.
    let accB = 0, dmgB = weak ? g.weakDmg : 0, mult = 1;
    const add = (label, acc, dmg) => { if (acc || dmg) { accB += acc; dmgB += dmg; notes.push(label); } };
    const times = (label, pct) => { if (pct) { mult *= 1 + pct / 100; notes.push(`${label} +${pct}% damage`); } };
    if (dmgSkill === accSkill) add(`Enchantments +${ench(accSkill)}% accuracy and damage`, ench(accSkill), ench(accSkill));
    else { add(`Enchantments +${ench(accSkill)}% accuracy`, ench(accSkill), 0); add(`Enchantments +${ench(dmgSkill)}% damage`, 0, ench(dmgSkill)); }
    if (type === 'melee') add(`Cape +${capePct('attack')}% accuracy`, capePct('attack'), 0);
    add(`Cape +${capePct(dmgSkill)}% damage`, 0, capePct(dmgSkill));
    if (o.purePower && type === 'melee') { const v = pot.potion_of_pure_power || 20; add(`Potion of pure power +${v}% accuracy and damage`, v, v); }
    if (o.greatSight && type === 'archery') { const v = pot.potion_of_great_sight || 10; add(`Potion of great sight +${v}% accuracy and damage`, v, v); }
    if (weapon && weapon.weakBoost && weak && !m.boss && !m.event) { accB += weapon.weakBoost; times(`${IC.itemName(weapon.id)} against a weak enemy: +${weapon.weakBoost}% accuracy,`, weapon.weakBoost); }
    for (const [slot, id] of Object.entries(gear)) {
      const it = id >= 0 ? items[id] : null;
      if (!it || !it.vs || (slot === 'leftHand' && weapon && weapon.twoHanded) || !it.vs.ids.includes(m.id)) continue;
      times(`${IC.itemName(id)} against this enemy`, it.vs.boost);
    }
    if (quest && o.monsterHunter) times('Monster hunter', questBoost());
    if (quest && weapon && weapon.questBoost) times(`${IC.itemName(weapon.id)} against a quest monster`, weapon.questBoost);
    if (assign) { const v = upgradeValue(53, 10); accB += v; times(`Bounty hunter +${v}% accuracy,`, v); }
    if (o.clanDmg) times('Clan quest buff', 10);

    let max = T(maxHit(mine[2], mine[3]) * (1 + dmgB / 100));
    if (mult !== 1) max = T(max * mult + 1e-9);
    const min = o.principles ? Math.max(1, T(max * upgradeValue(64, 5) / 100)) : 1;
    if (min > 1) notes.push(`Principles of combat: minimum hit ${min}`);
    let interval = m.fixedMs || (weapon && weapon.interval) || g.unarmedMs; // event bosses ignore weapon speed
    if (o.swiftness && !m.fixedMs) { const v = pot.potion_of_swiftness || 10; interval /= 1 + v / 100; notes.push(`Potion of swiftness +${v}% attack speed`); }
    const hit = chance(aug(mine[0], mine[1]), enemyDef, accB);
    let respawn = m.event ? 0 : (m.respawn || g.respawnMs) / 1000;
    if (o.getUp && respawn) { respawn *= 0.5; notes.push('Get Up! halves the respawn wait'); }
    if (o.resurrection && respawn) { const v = pot.potion_of_resurrection || 40; respawn *= 1 - v / 100; notes.push(`Potion of resurrection: respawn wait -${v}%`); }
    // Experience bonuses do not change the fight, only the XP rows.
    let xpMult = 1;
    if (o.clanXp && !m.event) { xpMult *= 1.1; notes.push('Strength in numbers +10% combat XP'); }
    if (o.dailyXp) { xpMult *= 1 + (g.dailyXp || 30) / 100; notes.push(`Daily boost +${g.dailyXp || 30}% XP`); }
    const secs = attacksToKill(m.hp, hit, max, min) * interval / 1000 + respawn;
    const kills = 3600 / secs, dmgHr = kills * m.hp;

    const eType = kind(m.style);
    const theirs = { melee: [m.s.accB, m.s.att, m.s.strB, m.s.str], archery: [m.s.aAccB, m.s.arch, m.s.aStrB, m.s.arch], magic: [m.s.mAccB, m.s.mag, m.s.mStrB, m.s.mag] }[eType];
    const defB = ench('defence') + capePct('defence');
    if (defB) notes.push(`Enchantments and cape +${defB}% defence`);
    const myDef = T(aug({ melee: tot.def, archery: tot.aDef, magic: tot.mDef }[eType], L('defence')) * (1 + defB / 100));
    const eHit = m.event ? 0 : chance(aug(theirs[0], theirs[1]), myDef) * ENEMY_HIT_FACTOR, eMax = maxHit(theirs[2], theirs[3]);
    const dodge = Math.min(L('agility'), 120) * 0.0018;
    // Damage you take: the enemy only attacks while it is alive, so the respawn wait is excluded.
    const fightShare = isFinite(secs) ? (secs - respawn) / secs : 1;
    const takenHr = fightShare * 3600 / (m.interval / 1000) * eHit * (1 - dodge) * eMax / 2;
    return {
      tot, weapon, style, type, weak, quest, assign, notes, min, xpMult, interval, hit, max, secs, respawn, kills: isFinite(kills) ? kills : 0, dps: isFinite(secs) ? m.hp / secs : 0, dmgHr: isFinite(dmgHr) ? dmgHr : 0,
      dodge, takenHr,
      enemy: { type: eType, hit: eHit, max: eMax, dps: eHit * eMax / 2 / (m.interval / 1000) },
    };
  }
  // Monster hunter (upgrade type 15): clan quest monsters take this much more damage. The API shows whether the
  // upgrade is owned but not which monsters the clan's quests currently target, so the player ticks a box.
  function questBoost() { return upgradeValue(15, 20); }
  const hasMonsterHunter = () => !!(IC.data.profile && (IC.data.profile.upgrades || {}).monsterHunter > 0);
  return { STYLE, kind, aug, chance, maxHit, attacksToKill, gearTotals, calc, questBoost, hasMonsterHunter, auto, upgradeValue };
})();

IC.views.dps = {
  label: 'DPS Calculator',
  blurb: 'Hit chance, max hit, DPS and kills per hour against any enemy, with your current gear or any gear you want to try.',
  SLOTS: ['rightHand', 'leftHand', 'head', 'body', 'legs', 'gloves', 'boots', 'cape', 'amulet', 'jewellery', 'bracelet', 'earrings', 'belt', 'ammunition', 'pet'],
  SLOT_LABEL: { rightHand: 'Weapon', leftHand: 'Off-hand', jewellery: 'Ring', ammunition: 'Ammunition' },
  state: { user: null, gear: null, monster: null },
  slotLabel(s) { return this.SLOT_LABEL[s] || IC.pretty(s); },
  worn() { return Object.assign({}, (IC.data.profile && IC.data.profile.equipment) || {}); },
  // The tick boxes in the Boosts card. own: profile upgrade key the box depends on (greyed out without it).
  BOOSTS: [
    { key: 'quest', group: 'Enemy', label: 'Clan quest monster', own: 'monsterHunter', what: 'Monster hunter: clan quest monsters take 20% more damage. Otherworldly weapons add their own 25%.', buy: 'the Monster hunter upgrade (Local market, 50K gold)' },
    { key: 'assign', group: 'Enemy', label: 'My Exterminating assignment', own: 'upgrade_bounty_hunter', what: 'Bounty hunter: +10% offensive stats against your Exterminating assignment.', buy: "the Bounty hunter upgrade (Local market: 10M gold, a Roc's talon, a Dire wolf fang, Crafting 90)" },
    { key: 'purePower', group: 'Potions', label: 'Potion of pure power', what: '+20% melee accuracy and damage.' },
    { key: 'greatSight', group: 'Potions', label: 'Potion of great sight', what: '+10% Archery accuracy and damage.' },
    { key: 'swiftness', group: 'Potions', label: 'Potion of swiftness', what: '+10% attack speed.' },
    { key: 'resurrection', group: 'Potions', label: 'Potion of resurrection', what: 'Enemies respawn 40% sooner.' },
    { key: 'getUp', group: 'Clan', label: 'Get Up! clan upgrade', what: 'Enemy respawn wait halved. The game does not publish which upgrades a clan owns.' },
    { key: 'clanXp', group: 'Clan', label: 'Strength in numbers clan upgrade', what: '+10% combat experience. Does not apply in clan combat events.' },
    { key: 'clanDmg', group: 'Clan', label: 'Clan quest damage buff', what: 'The temporary +10% damage buff from a completed clan quest, for the style you are using.' },
    { key: 'dailyXp', group: 'Experience', label: 'Daily experience boost', what: 'The +30% experience boost from the daily reward, while it is running.' },
  ],
  owns(b) { return !b.own || !!(IC.data.profile && (IC.data.profile.upgrades || {})[b.own] > 0); },
  // The quest box also drives otherworldly weapons, so it stays usable when one is equipped.
  usable(b, weapon) { return this.owns(b) || (b.key === 'quest' && !!weapon && weapon.questBoost > 0); },
  opts() {
    const saved = IC.store.get('dpsBoosts', {}), o = {}, items = IC.data.game.items, g = this.state.gear || {};
    const weapon = g.rightHand >= 0 ? items[g.rightHand] : null;
    for (const b of this.BOOSTS) o[b.key] = !!saved[b.key] && this.usable(b, weapon);
    return o;
  },
  boostsHtml(r) {
    const saved = IC.store.get('dpsBoosts', {}), name = IC.data.profile.username;
    const groups = [...new Set(this.BOOSTS.map((b) => b.group))];
    const box = (b) => {
      const ok = this.usable(b, r.weapon);
      return `<label style="display:block;margin:4px 0;${ok ? '' : 'opacity:.55;cursor:not-allowed'}" title="${esc(b.what)}"><input type="checkbox" data-boost="${b.key}" ${saved[b.key] && ok ? 'checked' : ''} ${ok ? '' : 'disabled'}> ${esc(b.label)} <span class="muted small">${esc(b.what)}${ok ? '' : ` ${esc(name)} does not own ${esc(b.buy)} yet.`}</span></label>`;
    };
    return `<div class="card"><h3>Boosts</h3>
      ${groups.map((gr) => `<h4 style="margin:8px 0 2px">${gr}</h4>${this.BOOSTS.filter((b) => b.group === gr).map(box).join('')}`).join('')}
      <p class="muted small"><b>Applied now:</b> ${[...(r.weak ? ['Enemy weakness'] : []), ...r.notes].map(esc).join(' · ') || 'nothing beyond gear and levels'}.</p>
      <p class="muted small">Enchanted jewellery, mastery capes, Principles of combat and weapons with a bonus against certain enemies are picked up automatically from ${esc(name)}'s profile and the gear chosen here. Enchantment boosts come from the jewellery ${esc(name)} is actually wearing and do not change when you swap jewellery on this page. Only enemy weakness and Monster hunter have been checked against the in-game panel; the rest follows the wiki's numbers.</p></div>`;
  },
  monster() { const ms = IC.data.game.monsters; return ms.find((m) => m.key === this.state.monster) || ms[0]; },
  // Gear the calculators should use: whatever is set up on this tab for the loaded character, else what is worn.
  gearFor() { const st = this.state, p = IC.data.profile; return st.gear && p && st.user === p.username ? st.gear : this.worn(); },
  gearChanged() { const g = this.gearFor(), w = this.worn(); return Object.keys(Object.assign({}, g, w)).some((k) => (g[k] == null ? -1 : g[k]) !== (w[k] == null ? -1 : w[k])); },
  loot(m, r) {
    const shop = IC.lootValue(m.loot, 'shop').total, market = IC.lootValue(m.loot).total, key = m.keyId != null ? IC.buyCost(m.keyId) || 0 : 0;
    const perHr = m.lootEvery ? r.dmgHr / m.lootEvery : r.kills; // event bosses roll loot per 500 damage, not per kill
    return { shop, market, key, shopHr: shop * perHr, marketHr: (market - key) * perHr };
  },
  // The two result cards ("Your stats" and the enemy), shared with the monster dialog on the Combat tab.
  statsHtml(r, m, lootLink) {
    const C = IC.combat, L = IC.levels, lv = this.loot(m, r);
    const row = (label, value, title) => `<tr title="${esc(title || '')}"><td class="muted">${label}</td><td class="num"><b>${value}</b></td></tr>`;
    const why = (label) => (lootLink && !m.event ? `<button class="link" data-lootinfo title="Show how this is worked out">${label}</button>` : label);
    return `<div class="cols">
      <div class="card"><h3>Your stats</h3><table><tbody>
        ${row('Hit chance', fmt.pct(r.hit, 2))}
        ${row('Dodge chance', fmt.pct(r.dodge, 2), '0.18% per Agility level')}
        ${row('Max hit', fmt.int(r.max) + (r.weak ? '<span class="tag good">weakness</span>' : '') + (r.notes.length ? '<span class="tag good">boosted</span>' : ''))}
        ${row('DPS', fmt.dec(r.dps, 2), 'Damage per second including the respawn wait and damage wasted on the killing blow')}
        ${row('Estimated kills per hour', fmt.int(Math.floor(r.kills)), `${fmt.dec(r.secs, 1)} seconds per kill including respawn`)}
        ${row('Average kill time', isFinite(r.secs) ? `${fmt.dec(r.secs - r.respawn, 1)}s` : '–', `Fighting time only. With the ${fmt.dec(r.respawn, 2)}s respawn wait it is ${fmt.dec(r.secs, 1)}s per kill. This is the number the Combat tab's "My average kill time" box expects.`)}
        ${row('Mixed exp per hour', fmt.int(r.dmgHr * r.xpMult * 4 / 3), 'Per skill on the Mixed style, as the game shows it. Total combat XP is 4 per damage, plus 1 per damage to Health.')}
        ${row('Total combat exp per hour', fmt.int(r.dmgHr * r.xpMult * 4))}
        ${row('Health exp per hour', fmt.int(r.dmgHr * r.xpMult))}
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
      if (m.lvl > maxLvl || m.event) continue;
      const special = m.boss || m.keyId != null || m.zone === 'invocation';
      const locked = m.zone === 'exterminating' && m.req > ext;
      if ((special || locked) && !st.topAll) { hidden++; continue; }
      const r = IC.combat.calc(st.gear, IC.levels, m, this.opts());
      if (!(r.kills > 0)) continue;
      const foodCost = food && foodPrice != null ? (r.takenHr / food.heal) * foodPrice : 0;
      rows.push({ m, r, xp: r.dmgHr * r.xpMult * 5, gold: this.loot(m, r).marketHr - foodCost, foodHr: food ? r.takenHr / food.heal : null, locked });
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
      <p class="muted small">Formulas were matched against the in-game DPS panel for melee. Archery and magic use the same formulas with their own stats and have not been checked. Boosts are set in the Boosts card. Not included: Potion of dark magic, Bullseye, Royal extermination, clan boss boosts, lifesteal and the daily XP boost. Loot per hour is a long-run average and ignores food, deaths and boss mechanics.</p>`;
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
    const r = IC.combat.calc(st.gear, IC.levels, m, this.opts()), C = IC.combat;
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
    out.innerHTML = this.statsHtml(r, m, true) + this.boostsHtml(r) + this.foodHtml(r, m) + this.bestHtml();
    out.onclick = (e) => {
      const go = e.target.closest('[data-goto-mon]');
      if (go) { st.monster = go.dataset.gotoMon; IC.store.set('dpsMonster', st.monster); el.querySelector('#dMon').value = st.monster; this.draw(el); el.querySelector('#dMon').scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      else if (e.target.closest('[data-lootinfo]')) IC.views.combat.lootDialog(m.key);
    };
    const tMax = out.querySelector('#dTopMax'), tAll = out.querySelector('#dTopAll');
    if (tMax) tMax.onchange = () => { st.topMax = tMax.value; this.draw(el); };
    if (tAll) tAll.onchange = () => { st.topAll = tAll.checked; this.draw(el); };
    out.querySelectorAll('[data-boost]').forEach((c) => { c.onchange = () => { const b = IC.store.get('dpsBoosts', {}); b[c.dataset.boost] = c.checked; IC.store.set('dpsBoosts', b); this.draw(el); }; });
    const food = out.querySelector('#dFood');
    if (food) food.onchange = () => { IC.store.set('dpsFood', +food.value); this.draw(el); };
  },
  // Dialog listing every item for a slot, ranked by the DPS it would give against the selected enemy.
  picker(el, slot) {
    const st = this.state, items = IC.data.game.items, m = this.monster(), cur = st.gear[slot];
    const base = IC.combat.calc(st.gear, IC.levels, m, this.opts());
    const rows = [{ id: -1, it: null }];
    for (const it of items) {
      if (!it || it.dead) continue;
      const meta = IC.data.names.get(it.id);
      if (meta && meta.equipmentSlot === slot) rows.push({ id: it.id, it });
    }
    for (const r of rows) {
      const c = IC.combat.calc(Object.assign({}, st.gear, { [slot]: r.id }), IC.levels, m, this.opts());
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
