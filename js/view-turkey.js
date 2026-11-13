// Turkey: finds the gear set with the highest damage against the Big ol' Turkey, the clan combat event boss.
// The search itself is generic: IC.combat.bestGear works for any enemy.
IC.combat.bestGear = function (levels, m, opts) {
  const items = IC.data.game.items, worn = opts.worn || {}, EPS = 1e-9;
  const bySlot = {};
  for (const it of items) {
    if (!it || it.dead) continue;
    const meta = IC.data.names.get(it.id), slot = meta && meta.equipmentSlot;
    if (!slot || !(slot in worn)) continue;
    if (Object.values(it.stats).some((v) => Math.abs(v) > 5000)) continue; // developer test items
    if (it.req && it.req.skill && (levels[it.req.skill] || 1) < it.req.level) continue;
    if (worn[slot] !== it.id && !opts.allow(it)) continue;
    (bySlot[slot] = bySlot[slot] || []).push(it);
  }
  const price = (id) => (id < 0 ? 0 : worn && Object.values(worn).includes(id) ? 0 : (IC.buyCost(id) == null ? Infinity : IC.buyCost(id)));
  const keys = { melee: ['str', 'acc'], archery: ['aStr', 'aAcc'], magic: ['mStr', 'mAcc'] };
  // Per attack type, only items not beaten on both strength and accuracy by another item can ever be the best choice.
  const shortlist = (slot, type) => {
    const [a, b] = keys[type], list = (bySlot[slot] || []).filter((it) => it.stats[a] > 0 || it.stats[b] > 0 || worn[slot] === it.id);
    return list.filter((x) => worn[slot] === x.id || !list.some((y) => y !== x && y.stats[a] >= x.stats[a] && y.stats[b] >= x.stats[b] && (y.stats[a] > x.stats[a] || y.stats[b] > x.stats[b] || price(y.id) < price(x.id) || (price(y.id) === price(x.id) && y.id < x.id))))
      .map((it) => it.id).concat(-1);
  };
  const others = Object.keys(worn).filter((s) => s !== 'rightHand' && s !== 'pet');
  const results = [];
  for (const w of (bySlot.rightHand || []).filter((it) => it.interval > 0)) {
    const type = IC.combat.kind(w.style), [a, b] = keys[type];
    const cands = {};
    for (const s of others) cands[s] = w.twoHanded && s === 'leftHand' ? [-1] : shortlist(s, type);
    const dps = (gear) => IC.combat.calc(gear, levels, m).dps;
    const climb = (gear) => {
      let cur = dps(gear);
      for (let pass = 0; pass < 5; pass++) {
        let moved = false;
        for (const s of others) {
          let best = gear[s], bestD = cur;
          for (const id of cands[s]) {
            if (id === best) continue;
            const d = dps(Object.assign({}, gear, { [s]: id }));
            // Strictly better wins. On a tie keep what is worn, otherwise take the cheaper option.
            const tieWin = Math.abs(d - bestD) <= EPS && best !== worn[s] && (id === worn[s] || price(id) < price(best));
            if (d > bestD + EPS || tieWin) { best = id; bestD = d; }
          }
          if (best !== gear[s]) { gear[s] = best; cur = bestD; moved = true; }
        }
        if (!moved) break;
      }
      return { gear, dps: cur };
    };
    const fromWorn = { rightHand: w.id }, fromMax = { rightHand: w.id };
    for (const s of others) {
      fromWorn[s] = cands[s].includes(worn[s]) ? worn[s] : -1;
      fromMax[s] = cands[s].slice().sort((x, y) => (y < 0 ? -1 : items[y].stats[a] + items[y].stats[b]) - (x < 0 ? -1 : items[x].stats[a] + items[x].stats[b]))[0];
    }
    if ('pet' in worn) { fromWorn.pet = worn.pet; fromMax.pet = worn.pet; }
    const r1 = climb(fromWorn), r2 = climb(fromMax), pick = r2.dps > r1.dps + EPS ? r2 : r1;
    const cost = Object.entries(pick.gear).reduce((sum, [s, id]) => sum + (id >= 0 && worn[s] !== id ? price(id) : 0), 0);
    results.push({ weapon: w, gear: pick.gear, r: IC.combat.calc(pick.gear, levels, m), cost });
  }
  return results.sort((x, y) => y.r.dps - x.r.dps || x.cost - y.cost);
};

IC.views.turkey = {
  label: 'Turkey',
  blurb: "The gear set with the highest damage against the Big ol' Turkey clan event boss that your levels allow.",
  state: { budget: '', untradeable: false, weapon: null, over: {} },
  NAMES: { big_old_turkey: "Big ol' Turkey" },
  // Average damage of one attack, counting misses.
  perAttack(r) { return r.hit * (r.max + 1) / 2; },
  // Everything the character could put in a slot under the current filters (same rules as the search).
  slotItems(slot, worn, allow) {
    return IC.data.game.items.filter((it) => {
      if (!it || it.dead) return false;
      const meta = IC.data.names.get(it.id);
      if (!meta || meta.equipmentSlot !== slot) return false;
      if (Object.values(it.stats).some((v) => Math.abs(v) > 5000)) return false;
      if (it.req && it.req.skill && (IC.levels[it.req.skill] || 1) < it.req.level) return false;
      return worn[slot] === it.id || allow(it);
    });
  },
  clock(secs) { if (!isFinite(secs)) return '–'; const s = Math.round(secs); return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`; },
  // Pop-up: the five best choices for one slot, with the rest of the shown set left as it is.
  options(el, slot, gear, worn, allow, m) {
    const st = this.state, D = IC.views.dps, base = IC.combat.calc(gear, IC.levels, m);
    const price = (id) => (id < 0 || worn[slot] === id ? 0 : IC.buyCost(id));
    const ids = this.slotItems(slot, worn, allow).filter((it) => slot !== 'rightHand' || it.interval > 0).map((it) => it.id).concat(slot === 'rightHand' ? [] : [-1]);
    const rows = ids.map((id) => {
      const g = Object.assign({}, gear, { [slot]: id }), r = IC.combat.calc(g, IC.levels, m);
      return { id, r, cost: price(id) };
    }).sort((a, b) => b.r.dps - a.r.dps || (worn[slot] === b.id) - (worn[slot] === a.id) || (a.cost == null ? Infinity : a.cost) - (b.cost == null ? Infinity : b.cost));
    const cur = gear[slot] == null ? -1 : gear[slot];
    const top = rows.slice(0, 5);
    for (const extra of [cur, worn[slot] == null ? -1 : worn[slot]]) if (!top.some((x) => x.id === extra)) { const x = rows.find((y) => y.id === extra); if (x) top.push(x); }
    const off = slot === 'leftHand' && base.weapon && base.weapon.twoHanded;
    const body = IC.ui.dialog(`<div class="dlg-head"><div><h2>${esc(D.slotLabel(slot))}: top options</h2><div class="muted small">Against the ${esc(this.NAMES[m.key])} with the rest of the shown set unchanged. ${rows.length} possible choices; the best five are listed${top.length > 5 ? ', plus what is shown and what you wear' : ''}.</div></div><button class="ghost" data-close>Close</button></div>
      ${off ? '<div class="note">The shown weapon is two-handed, so the off-hand slot does nothing with it.</div>' : ''}
      ${slot === 'rightHand' ? '<p class="muted small">Changing only the weapon keeps the other pieces. For the best supporting gear for a weapon, use "Best result for each weapon" on the page.</p>' : ''}
      <div class="tablewrap"><table><thead><tr><th>#</th><th>Item</th><th class="num">DPS</th><th class="num">${m.event ? 'Damage/attack' : 'Kills/hr'}</th><th class="num">Price</th><th></th></tr></thead><tbody>
      ${top.map((x) => { const it = x.id >= 0 ? IC.data.game.items[x.id] : null, val = (r) => (m.event ? this.perAttack(r) : r.kills), d = val(x.r) - val(base);
        return `<tr><td class="muted">${rows.indexOf(x) + 1}</td><td>${it ? esc(IC.itemName(x.id)) : 'Empty slot'}${x.id === cur ? '<span class="tag good">shown</span>' : ''}${(worn[slot] == null ? -1 : worn[slot]) === x.id && it ? '<span class="tag">worn</span>' : ''}${it && it.twoHanded ? '<span class="tag">2H</span>' : ''}
          ${it ? `<div class="muted small">${esc(D.bonusText(it, x.r.type))}${it.interval && slot === 'rightHand' ? ` · ${fmt.dec(it.interval / 1000, 2)}s ${IC.combat.STYLE[it.style] || ''}` : ''}</div>` : ''}</td>
          <td class="num">${fmt.dec(x.r.dps, 3)}</td>
          <td class="num"><b>${m.event ? fmt.dec(val(x.r), 2) : fmt.int(Math.floor(x.r.kills))}</b> <span class="small ${d > 0.004 ? 'good' : d < -0.004 ? 'bad' : 'muted'}">${d >= 0 ? '+' : ''}${fmt.dec(d, m.event ? 2 : 1)}</span></td>
          <td class="num">${!it || (worn[slot] === x.id) ? '' : x.cost == null ? '<span class="muted">not for sale</span>' : fmt.short(x.cost)}</td>
          <td class="num">${x.id === cur ? '' : `<button class="ghost small" data-use="${x.id}">Use</button>`}</td></tr>`; }).join('')}
      </tbody></table></div>`);
    // Bound to the table (rebuilt for each pop-up), not the shared dialog body, so old handlers never linger.
    body.querySelector('.tablewrap').addEventListener('click', (e) => {
      const b = e.target.closest('[data-use]'); if (!b) return;
      st.over[slot] = +b.dataset.use;
      document.getElementById('dialog').close();
      this.render(el);
    });
  },
  render(el) {
    const p = IC.data.profile, st = this.state, D = IC.views.dps;
    const m = IC.data.game.monsters.find((x) => x.key === 'big_old_turkey');
    if (!p) { el.innerHTML = `<h2>Turkey</h2>${IC.ui.needUser()}`; return; }
    if (!m) { el.innerHTML = '<h2>Turkey</h2><div class="note">The Big ol Turkey is not in the current game data.</div>'; return; }
    const name = this.NAMES[m.key] || IC.pretty(m.key), ev = m.event;
    const worn = D.worn(), budget = +st.budget || Infinity;
    const allow = (it) => {
      const cost = it.noTrade ? null : IC.buyCost(it.id);
      if (cost == null) return st.untradeable; // no market or shop price: only if untradeable items are wanted
      return cost <= budget;
    };
    const results = IC.combat.bestGear(IC.levels, m, { worn, allow });
    const now = IC.combat.calc(worn, IC.levels, m);
    const best = results.find((x) => x.weapon.id === st.weapon) || results[0];
    el.innerHTML = `<h2>Turkey</h2>
      <p class="muted">${ev
        ? `The best gear for the Big ol' Turkey, the boss of clan combat events (${fmt.int(m.hp)} HP solo), from everything ${esc(p.username)} meets the level requirement for. Everyone attacks it on the same fixed ${fmt.dec(m.fixedMs / 1000, 0)}-second timer, so weapon speed does not matter: only hit chance and max hit do. It is weak to every attack style and never hits back.`
        : `The best gear for killing the Turkey (Lvl ${m.lvl}, ${m.hp} HP) as fast as possible, from everything ${esc(p.username)} meets the level requirement for.`} Items you already wear are always considered.</p>
      <div class="controls">
        <label title="Leave out items that cost more than this each">Max price per item <input type="number" id="tBudget" min="0" placeholder="any" value="${esc(st.budget)}"></label>
        <label title="Items with no market or shop price, such as quest and boss rewards"><input type="checkbox" id="tUn" ${st.untradeable ? 'checked' : ''}> Include items that cannot be bought</label>
      </div>
      <div id="tOut"></div>`;
    el.querySelector('#tBudget').onchange = (e) => { st.budget = e.target.value; st.weapon = null; st.over = {}; this.render(el); };
    el.querySelector('#tUn').onchange = (e) => { st.untradeable = e.target.checked; st.weapon = null; st.over = {}; this.render(el); };
    const out = el.querySelector('#tOut');
    if (!best) { out.innerHTML = '<div class="note">No usable weapon found with these filters.</div>'; return; }

    const edited = Object.keys(st.over).some((s) => st.over[s] !== best.gear[s]);
    const gear = Object.assign({}, best.gear, st.over);
    const r = IC.combat.calc(gear, IC.levels, m), gain = now.dps > 0 ? r.dps / now.dps - 1 : null, same = Object.keys(worn).every((s) => (worn[s] == null ? -1 : worn[s]) === (gear[s] == null ? -1 : gear[s]));
    const setCost = Object.entries(gear).reduce((sum, [s, id]) => sum + (id >= 0 && worn[s] !== id ? (IC.buyCost(id) == null ? Infinity : IC.buyCost(id)) : 0), 0);
    const row = (label, a, b) => `<tr><td class="muted">${label}</td><td class="num"><b>${a}</b></td><td class="num muted">${b}</td></tr>`;
    const slots = D.SLOTS.filter((s) => s in gear && s !== 'pet');
    out.innerHTML = `<div class="dps-layout">
      <div class="card"><div class="dps-head"><b>${edited ? 'Your edited set' : best === results[0] ? 'Best set' : 'Best set with ' + esc(IC.itemName(best.weapon.id))}</b><span>${edited ? '<button class="ghost" id="tBest" title="Undo your changes">Back to best</button> ' : ''}<button id="tLoad" title="Open this set in the DPS Calculator">Open in DPS Calculator</button></span></div>
        <div class="tablewrap"><table><tbody>${slots.map((s) => {
          const id = gear[s], it = id >= 0 ? IC.data.game.items[id] : null, isWorn = (worn[s] == null ? -1 : worn[s]) === id, cost = it && !isWorn ? IC.buyCost(id) : null;
          return `<tr><td><button class="link" data-tslot="${s}" title="Show the top options for this slot">${esc(D.slotLabel(s))}</button></td>
            <td>${it ? IC.ui.itemLink(id) : '<span class="muted">empty</span>'}${isWorn ? (it ? '<span class="tag good">worn</span>' : '') : '<span class="tag warn">change</span>'}
              ${it ? `<div class="muted small">${esc(D.bonusText(it, r.type))}${it.interval && s === 'rightHand' ? ` · ${fmt.dec(it.interval / 1000, 2)}s ${IC.combat.STYLE[it.style] || ''}` : ''}</div>` : ''}</td>
            <td class="num">${isWorn ? '' : it ? (cost == null ? '<span class="muted">not for sale</span>' : fmt.short(cost)) : ''}</td></tr>`;
        }).join('')}</tbody></table></div>
        <p class="muted small">${same ? 'This is what you are already wearing.' : `Cost of the pieces you do not have: <b>${isFinite(setCost) ? fmt.short(setCost) : 'includes items that are not for sale'}</b> at the cheapest current offers.`} Click a slot name to see its top five options and swap one in. Where several items give the same result, the one you already wear is kept, otherwise the cheapest.</p>
      </div>
      <div>
        <div class="card"><h3>Against the ${esc(name)}</h3><table><thead><tr><th></th><th class="num">${edited ? 'Edited set' : 'This set'}</th><th class="num">Worn now</th></tr></thead><tbody>
          ${row('DPS', fmt.dec(r.dps, 2) + (gain != null && gain > 0.0005 ? ` <span class="good small">+${fmt.pct(gain, 1)}</span>` : ''), fmt.dec(now.dps, 2))}
          ${ev ? row('Average damage per attack', fmt.dec(this.perAttack(r), 2), fmt.dec(this.perAttack(now), 2)) : row('Kills per hour', fmt.int(Math.floor(r.kills)), fmt.int(Math.floor(now.kills)))}
          ${ev ? row('Time to kill it alone', this.clock(r.secs), this.clock(now.secs)) : row('Average kill time', `${fmt.dec(r.secs - r.respawn, 2)}s`, `${fmt.dec(now.secs - now.respawn, 2)}s`)}
          ${row('Hit chance', fmt.pct(r.hit, 2), fmt.pct(now.hit, 2))}
          ${row('Max hit', fmt.int(r.max), fmt.int(now.max))}
          ${row('Attack every', `${fmt.dec(r.interval / 1000, 2)}s`, `${fmt.dec(now.interval / 1000, 2)}s`)}
          ${ev ? '' : row('Total exp per hour', fmt.int(r.dmgHr * 5), fmt.int(now.dmgHr * 5))}
          ${ev ? '' : row('Loot per hour, player market', fmt.int(D.loot(m, r).marketHr), fmt.int(D.loot(m, now).marketHr))}
        </tbody></table>
        ${ev ? `<p class="muted small">${esc(IC.pretty(r.type))} attack. Your gear only changes how fast it dies, not what the event pays:</p>
        <table><tbody>
          <tr><td class="muted">Loot event, solo</td><td class="num"><b>${fmt.int(m.hp / m.lootEvery)} loot rolls</b>, worth about ${fmt.int(IC.lootValue(m.loot).total * m.hp / m.lootEvery)} gold</td></tr>
          <tr><td class="muted">Experience event, solo</td><td class="num"><b>${fmt.int(m.hp * 5 * IC.data.game.settings.eventXp)}</b> XP (${IC.data.game.settings.eventXp}× normal)</td></tr>
        </tbody></table>
        <p class="muted small">One loot roll per ${m.lootEvery} damage, handed to a random participant; about 18% of rolls give nothing. With more players its health rises (2,000 solo, 4,200 for two, 12,000 for five), and the best gear stays the same. Levels used: Attack ${IC.levels.attack}, Strength ${IC.levels.strength}, Archery ${IC.levels.archery}, Magic ${IC.levels.magic}.</p>`
        : `<p class="muted small">${esc(IC.pretty(r.type))} attack. The Turkey respawns in ${fmt.dec(r.respawn, 2)}s, which is included in DPS and kills per hour. Levels used: Attack ${IC.levels.attack}, Strength ${IC.levels.strength}, Archery ${IC.levels.archery}, Magic ${IC.levels.magic}.</p>`}</div>
        <div class="card"><h3>Best result for each weapon</h3><div id="tW"></div></div>
      </div></div>
      <p class="muted small">Each weapon you can use is paired with the best supporting gear for it, then the sets are ranked by DPS. Melee is matched to the game; archery and magic use the same formulas and have not been checked. Not included: potions, enchantments, set effects, special weapon effects and clan boosts.</p>`;
    IC.ui.table(out.querySelector('#tW'), {
      rows: results, sort: 1, limit: 15,
      cols: [
        { label: 'Weapon', val: (x) => IC.itemName(x.weapon.id), html: (x) => `<button class="link" data-weapon="${x.weapon.id}">${esc(IC.itemName(x.weapon.id))}</button>${x.weapon.id === gear.rightHand ? '<span class="tag good">shown</span>' : ''}${worn.rightHand === x.weapon.id ? '<span class="tag">worn</span>' : ''}` },
        { label: 'DPS', num: true, val: (x) => x.r.dps, html: (x) => fmt.dec(x.r.dps, 2) },
        ev ? { label: 'Damage/attack', num: true, val: (x) => this.perAttack(x.r), html: (x) => fmt.dec(this.perAttack(x.r), 2) }
          : { label: 'Kills/hr', num: true, val: (x) => x.r.kills, html: (x) => fmt.int(Math.floor(x.r.kills)) },
        ev ? { label: 'Max hit', num: true, val: (x) => x.r.max, html: (x) => fmt.int(x.r.max) }
          : { label: 'Speed', num: true, val: (x) => -x.weapon.interval, html: (x) => `${fmt.dec(x.weapon.interval / 1000, 2)}s` },
        { label: 'Cost to buy', num: true, val: (x) => (isFinite(x.cost) ? x.cost : null), html: (x) => (isFinite(x.cost) ? fmt.short(x.cost) : '<span class="muted">not for sale</span>'), title: 'Total for the pieces of that set you are not wearing' },
      ],
    });
    out.querySelector('#tW').addEventListener('click', (e) => { const b = e.target.closest('[data-weapon]'); if (b) { st.weapon = +b.dataset.weapon; st.over = {}; this.render(el); } });
    out.querySelector('.dps-layout').addEventListener('click', (e) => { const b = e.target.closest('[data-tslot]'); if (b) this.options(el, b.dataset.tslot, gear, worn, allow, m); });
    if (out.querySelector('#tBest')) out.querySelector('#tBest').onclick = () => { st.over = {}; this.render(el); };
    out.querySelector('#tLoad').onclick = () => {
      Object.assign(D.state, { gear: Object.assign({}, gear), user: p.username, monster: m.key });
      IC.store.set('dpsMonster', m.key);
      document.querySelector('[data-tab="dps"]').click();
    };
  },
};
