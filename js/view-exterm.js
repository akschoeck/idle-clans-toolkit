// Exterminating: which master gives the most Exterminating XP per hour and the most points per hour.
// A master hands out one of its assignments at random. The chance of each is its weight divided by the total weight of
// the assignments the player's Exterminating level allows (this reproduces the percentages the game shows, e.g. 10/68 =
// 14.7% at Eldric). Rates are long-run averages over that mix: expected reward per assignment ÷ expected time per assignment.
IC.views.exterm = {
  label: 'Exterminating',
  blurb: 'Which Exterminating master gives the most Exterminating XP and the most points per hour with your gear and level.',
  XP_PER_HP: 0.5,      // wiki: Exterminating XP per kill is 50% of the enemy's health
  EXTENDED: 1.5,       // wiki: Extended assignments make the Exterminating-only enemies' assignments 50% larger
  TOKEN: 1.25,         // wiki: an activated Exterminating token gives 25% more points
  opt() { return Object.assign({ level: '', extended: false, token: false, auto: true, gap: 60, cancel: false, goal: 'xp' }, IC.store.get('exterm', {})); },
  level() { const o = +this.opt().level; return o >= 1 ? Math.min(o, IC.MAX_LEVEL || 120) : (IC.levels && IC.levels.exterminating) || 1; },
  shopCost(key) { return (IC.data.game.exterm.shop.find((s) => s.key === key) || {}).cost || 0; },
  // Long-run hourly rates when only the assignments in `keep` are done and every other one is cancelled on sight.
  rates(live, keep, points, cancelCost, food) {
    let secs = 0, xp = 0, combat = 0, gold = 0, taken = 0, kills = 0, pKeep = 0;
    for (const x of keep) { secs += x.p * x.secs; xp += x.p * x.xp; combat += x.p * x.combatXp; gold += x.p * x.gold; taken += x.p * x.taken; kills += x.p * x.n; pKeep += x.p; }
    const ok = secs > 0 && isFinite(secs), hr = ok ? 3600 / secs : 0, pts = points * pKeep - cancelCost * (1 - pKeep);
    return {
      keep, ok, pKeep, secs: pKeep ? secs / pKeep : 0, kills: pKeep ? kills / pKeep : 0, // per assignment actually done
      xpHr: xp * hr, ptsHr: pts * hr, combatHr: combat * hr, goldHr: gold * hr, foodHr: food ? taken * hr / food.heal : null, doneHr: pKeep * hr,
    };
  },
  // The keep-set with the best rate for a goal. At most 13 assignments per master, so every combination is tried.
  // Going for XP must not lose points overall, otherwise the cancelling could not be kept up.
  bestPolicy(live, points, cancelCost, food, goal) {
    const idle = this.rates(live, live, points, cancelCost, food);
    const can = live.filter((x) => isFinite(x.secs));
    let best = idle.ok ? idle : null;
    const val = (r) => (goal === 'xp' ? r.xpHr : r.ptsHr);
    for (let mask = 1; mask < (1 << can.length) - (can.length === live.length ? 1 : 0); mask++) {
      const r = this.rates(live, can.filter((_, i) => mask & (1 << i)), points, cancelCost, food);
      if (!r.ok || (goal === 'xp' && r.ptsHr < 0)) continue;
      if (!best || val(r) > val(best) * (1 + 1e-9)) best = r;
    }
    return best || idle;
  },
  // One master's numbers for the given Exterminating level.
  master(ms, lvl) {
    const D = IC.views.dps, o = this.opt(), byKey = this.byKey, gear = D.gearFor();
    const opts = Object.assign(D.opts(), { assign: true, quest: false, clanDmg: false });
    const owned = (IC.data.profile.upgrades || {}).upgrade_bloodmoon_exterminator > 0;
    const xpMult = owned ? 1 + IC.combat.upgradeValue(56, 10) / 100 : 1;
    const points = ms.points * (o.token ? this.TOKEN : 1), gap = o.auto ? 0 : +o.gap || 0;
    const foods = D.foods(), food = foods.find((f) => f.id === IC.store.get('dpsFood', null)) || foods[Math.floor(foods.length / 2)];
    const rows = ms.tasks.filter((t) => byKey.has(t.mon)).map((t) => {
      const m = byKey.get(t.mon), r = IC.combat.calc(gear, IC.levels, m, opts);
      const big = o.extended && m.zone === 'exterminating' ? this.EXTENDED : 1;
      const min = Math.floor(t.min * big), max = Math.floor(t.max * big), n = (min + max) / 2;
      const secs = r.kills > 0 ? n * r.secs + gap : Infinity; // one whole assignment
      return { t, m, r, min, max, n, secs, ok: t.req <= lvl, xp: n * m.hp * this.XP_PER_HP * xpMult, combatXp: n * m.hp * 5 * r.xpMult, gold: n * D.loot(m, r).market, taken: r.takenHr * (n * r.secs) / 3600 };
    });
    const live = rows.filter((x) => x.ok), W = live.reduce((a, x) => a + x.t.weight, 0);
    for (const x of rows) x.p = x.ok && W > 0 ? x.t.weight / W : 0;
    const cost = this.shopCost('cancel_assignment_title');
    const idle = this.rates(live, live, points, cost, food);
    const pol = { xp: this.bestPolicy(live, points, cost, food, 'xp'), pts: this.bestPolicy(live, points, cost, food, 'pts') };
    // What the page shows for each goal: the cancelling policy when the box is ticked, otherwise doing everything.
    const use = (goal) => (o.cancel ? pol[goal] : idle);
    return { ms, rows, live, points, idle, pol, use, shown: use(o.goal), stuck: live.filter((x) => !isFinite(x.secs)), locked: (IC.levels.health || 1) < ms.health, food };
  },
  clock(secs) {
    if (!isFinite(secs)) return '–';
    const s = Math.round(secs);
    return s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m` : s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
  },
  render(el) {
    const p = IC.data.profile, X = IC.data.game.exterm;
    if (!p) { el.innerHTML = `<h2>Exterminating</h2>${IC.ui.needUser()}`; return; }
    if (!X || !X.masters.length) { el.innerHTML = '<h2>Exterminating</h2><div class="note">The game data has no Exterminating masters right now.</div>'; return; }
    this.byKey = new Map(IC.data.game.monsters.map((m) => [m.key, m]));
    const D = IC.views.dps, o = this.opt(), own = IC.levels.exterminating || 1, lvl = this.level();
    const gear = D.gearFor(), gr = IC.combat.calc(gear, IC.levels, D.monster(), D.opts());
    const all = X.masters.map((ms) => this.master(ms, lvl)), open = all.filter((a) => !a.locked);
    const top = (f) => open.filter((a) => f(a) > 0).sort((a, b) => f(b) - f(a))[0];
    const bx = top((a) => a.use('xp').xpHr), bp = top((a) => a.use('pts').ptsHr);
    const bestShown = { xpHr: top((a) => a.shown.xpHr), ptsHr: top((a) => a.shown.ptsHr) };
    const name = (a) => esc(IC.pretty(a.ms.key)), diff = (a) => esc(IC.pretty(a.ms.difficulty));
    const crate = this.shopCost('supply_crate'), crateGold = IC.lootValue(X.crate).total, cancelCost = this.shopCost('cancel_assignment_title');
    // Next level at which an enemy joins a master's list, so the player can see where the mix changes.
    const next = [...new Set(X.masters.flatMap((ms) => ms.tasks.map((t) => t.req)).filter((r) => r > lvl))].sort((a, b) => a - b)[0];
    const skips = (a, goal) => a.live.filter((x) => !a.pol[goal].keep.includes(x));
    const skipText = (a, goal) => { const s = skips(a, goal); return o.cancel && s.length ? ` Cancel: ${s.map((x) => esc(IC.pretty(x.m.key))).join(', ')}.` : ''; };
    const card = (title, a, value, sub, goal) => `<div class="card stat"><div class="label">${title}</div><div class="value">${a ? `${name(a)} <span class="muted small">${diff(a)}</span>` : '–'}</div><div>${a ? `<b>${value}</b> ${sub}<div class="muted small">${skipText(a, goal)}</div>` : 'No master is available.'}</div></div>`;
    const cell = (a, k, f) => `<td class="num">${a.shown.ok ? (a === bestShown[k] ? `<b class="good">${f(a.shown[k])}</b>` : f(a.shown[k])) : '–'}</td>`;
    const stuckNote = all.filter((a) => a.stuck.length).map((a) => IC.pretty(a.ms.key)).join(', ');
    const goalName = o.goal === 'xp' ? 'Exterminating XP' : 'points';

    el.innerHTML = `<h2>Exterminating</h2>
      <p class="muted">Each master gives a random assignment, so the rates are averages over the enemies that master can give at Exterminating level ${lvl}, weighted by how often each comes up and how long it takes with the gear on the left. It starts from what ${esc(p.username)} is wearing; click any piece to try another.</p>
      <div class="dps-layout">
        <div class="card"><div class="dps-head"><b>Gear</b><button id="xReset" title="Re-load what you are actually wearing from the game">Reset all to worn gear</button></div><div id="xGear">${D.gearHtml(gr)}</div>
          <p class="muted small">Shared with the DPS Calculator tab, where potions and other boosts are ticked. The item picker ranks items against ${esc(IC.pretty(D.monster().key))}, the enemy chosen there.</p></div>
        <div>
      <div class="controls">
        <label title="Leave empty to use your real level. Enemies only join a master's list once you reach their level.">Exterminating level <input type="number" id="xLvl" min="1" max="120" placeholder="${own}" value="${esc(o.level || '')}" style="width:80px"></label>
        <label title="Shop unlock, ${fmt.int(this.shopCost('exterminating_boss_extension'))} points: assignments for the Exterminating-only enemies are 50% larger."><input type="checkbox" id="xExt" ${o.extended ? 'checked' : ''}> Extended assignments</label>
        <label title="An activated Exterminating token gives 25% more points."><input type="checkbox" id="xTok" ${o.token ? 'checked' : ''}> Exterminating token active</label>
        ${IC.ui.sellModeSelect()}
      </div>
      <div class="controls">
        <label title="Shop unlock, ${fmt.int(this.shopCost('exterminating_auto_complete'))} points: the next assignment starts by itself, so no time is lost between assignments."><input type="checkbox" id="xAuto" ${o.auto ? 'checked' : ''}> Auto completer</label>
        <label title="Without the Auto completer: how long, on average, a finished assignment waits before you pick up the next one." style="${o.auto ? 'opacity:.55' : ''}">Seconds lost per assignment <input type="number" id="xGap" min="0" value="${esc(+o.gap || 0)}" style="width:80px" ${o.auto ? 'disabled' : ''}></label>
      </div>
      <div class="controls">
        <label title="Ticked: the per-hour numbers assume you cancel the assignments marked 'cancel' as soon as you get them (${fmt.int(cancelCost)} points each). Unticked: fully idle, every assignment is done."><input type="checkbox" id="xCan" ${o.cancel ? 'checked' : ''}> I cancel the assignments marked as worth cancelling (unticked = fully idle)</label>
        <label style="${o.cancel ? '' : 'opacity:.55'}" title="Which assignments are worth cancelling depends on what you are after.">Cancel to get the most <select id="xGoal" ${o.cancel ? '' : 'disabled'}><option value="xp" ${o.goal === 'xp' ? 'selected' : ''}>Exterminating XP</option><option value="pts" ${o.goal === 'pts' ? 'selected' : ''}>points</option></select></label>
      </div>
      <div class="grid">
        ${card('Most Exterminating XP per hour', bx, bx ? fmt.int(bx.use('xp').xpHr) : '', `Exterminating XP/hr${bx && o.cancel ? ` · ${fmt.dec(bx.use('xp').ptsHr, 1)} points/hr` : ''}`, 'xp')}
        ${card('Most points per hour', bp, bp ? fmt.dec(bp.use('pts').ptsHr, 1) : '', `points/hr${bp && crate ? ` · a crate every ${this.clock(crate / bp.use('pts').ptsHr * 3600)}` : ''}`, 'pts')}
      </div>
      <div class="card"><h3 style="margin-top:0">Masters compared${o.cancel ? ` <span class="muted small">cancelling for the most ${goalName}</span>` : ' <span class="muted small">fully idle</span>'}</h3>
        <div class="tablewrap"><table><thead><tr><th>Master</th><th class="num" title="Points for each finished assignment">Points</th><th class="num" title="Enemies this master can give you at this Exterminating level, out of all it has">Enemies</th>${o.cancel ? '<th class="num" title="Assignments you would cancel on sight">Cancel</th>' : ''}<th class="num" title="Average kills per assignment you do">Kills</th><th class="num" title="Average time to finish one assignment you do">Time each</th><th class="num">Exterm. XP/hr</th><th class="num" title="Points per hour after paying for cancels">Points/hr</th><th class="num" title="Total combat plus Health XP">Combat XP/hr</th><th class="num" title="Market value of the loot at the chosen sell price">Gold/hr</th><th class="num" title="Pieces of the food chosen on the DPS Calculator tab">Food/hr</th></tr></thead><tbody>
        ${all.map((a) => { const s = a.shown; return `<tr class="${a.locked ? 'locked' : ''}"><td><b>${name(a)}</b> <span class="muted small">${diff(a)}</span>${a.locked ? `<span class="tag warn">Health ${a.ms.health}</span>` : ''}${a.stuck.length ? `<span class="tag warn" title="This gear cannot damage: ${esc(a.stuck.map((x) => IC.pretty(x.m.key)).join(', '))}">${s.ok ? 'must cancel some' : 'cannot finish'}</span>` : ''}</td>
          <td class="num">${fmt.dec(a.points, 2)}</td><td class="num">${a.live.length}/${a.rows.length}</td>${o.cancel ? `<td class="num">${a.live.length - s.keep.length || '–'}</td>` : ''}<td class="num">${s.ok ? fmt.int(s.kills) : '–'}</td><td class="num">${s.ok ? this.clock(s.secs) : '–'}</td>
          ${cell(a, 'xpHr', fmt.int)}${cell(a, 'ptsHr', (v) => fmt.dec(v, 1))}<td class="num">${s.ok ? fmt.int(s.combatHr) : '–'}</td><td class="num">${s.ok ? fmt.short(s.goldHr) : '–'}</td><td class="num">${s.ok && s.foodHr != null ? fmt.dec(s.foodHr, s.foodHr < 10 ? 1 : 0) : '–'}</td></tr>`; }).join('')}
        </tbody></table></div>
        <p class="muted small">Best values are highlighted; masters you lack the Health level for are greyed out and left out of the picks.${next ? ` The mix next changes at Exterminating level ${next}: try it in the level box.` : ''}${crate && crateGold ? ` A crate costs ${fmt.int(crate)} points and holds about ${fmt.short(crateGold)} gold of loot on average.` : ''}${stuckNote && !o.cancel ? ` ${esc(stuckNote)}: this gear cannot damage one of the possible enemies, so no idle rate is shown.` : ''}</p></div>
      ${all.map((a) => { const sx = skips(a, 'xp'), sp = skips(a, 'pts'), gain = (goal, k) => (a.idle.ok && a.idle[k] > 0 ? ` (+${fmt.pct(a.pol[goal][k] / a.idle[k] - 1)})` : '');
        return `<div class="card"><details ${a === bx || a === bp ? 'open' : ''}><summary><b>${name(a)}</b> <span class="muted">${diff(a)} · ${fmt.dec(a.points, 2)} points per assignment${a.ms.health > 1 ? ` · Health ${a.ms.health}` : ''}</span></summary>
        <div class="tablewrap"><table><thead><tr><th>Enemy</th><th class="num" title="Chance this is your next assignment">Chance</th><th class="num">Kills</th><th class="num">Kills/hr</th><th class="num" title="Average time for the whole assignment">Time</th><th class="num" title="Exterminating XP per hour while on this assignment">Exterm. XP/hr</th><th class="num" title="Points per hour if every assignment were this one">Points/hr</th><th class="num">Hit chance</th><th class="num" title="Its hardest hit on you">Enemy max hit</th></tr></thead><tbody>
        ${a.rows.map((x) => { const hr = isFinite(x.secs) ? 3600 / x.secs : 0, cx = sx.includes(x), cp = sp.includes(x); return `<tr class="${x.ok ? '' : 'locked'}"><td><button class="link" data-goto-mon="${esc(x.m.key)}" title="Open in the DPS Calculator">${esc(IC.pretty(x.m.key))}</button>${x.ok ? '' : `<span class="tag warn">Exterminating ${x.t.req}</span>`}${x.r.weak ? '<span class="tag good" title="Weak to your weapon\'s attack style">weak</span>' : `<span class="tag" title="Its weakness. Your weapon does not match it.">${esc(IC.combat.STYLE[x.m.weak] || 'no weakness')}</span>`}${cx || cp ? `<span class="tag warn" title="Cancelling this assignment on sight raises your long-run rate">cancel for ${cx && cp ? 'XP and points' : cx ? 'XP' : 'points'}</span>` : ''}</td>
          <td class="num">${x.ok ? fmt.pct(x.p) : '–'}</td><td class="num">${x.min}–${x.max}</td><td class="num">${fmt.int(Math.floor(x.r.kills))}</td><td class="num">${this.clock(x.secs)}</td>
          <td class="num">${fmt.int(x.xp * hr)}</td><td class="num">${fmt.dec(a.points * hr, 1)}</td><td class="num">${fmt.pct(x.r.hit)}</td><td class="num">${x.r.enemy.max}</td></tr>`; }).join('')}
        </tbody></table></div>
        <p class="muted small">${sx.length ? `For XP, cancelling ${sx.map((x) => esc(IC.pretty(x.m.key))).join(', ')} gives ${fmt.int(a.pol.xp.xpHr)} XP/hr${gain('xp', 'xpHr')} and ${fmt.dec(a.pol.xp.ptsHr, 1)} points/hr.` : 'For XP, nothing here is worth cancelling.'} ${sp.length ? `For points, cancelling ${sp.map((x) => esc(IC.pretty(x.m.key))).join(', ')} gives ${fmt.dec(a.pol.pts.ptsHr, 1)} points/hr${gain('pts', 'ptsHr')}.` : 'For points, nothing here is worth cancelling.'}</p></details></div>`; }).join('')}
      <p class="muted small">Assignment lists, weights, level requirements, kill counts and points come from the live game data. Exterminating XP is taken as 50% of the enemy's health per kill (wiki)${(p.upgrades || {}).upgrade_bloodmoon_exterminator > 0 ? ', plus 10% for Bloodmoon exterminator' : ''}. Kill speed uses the one gear set for every enemy, with the boosts ticked on the DPS Calculator tab${(p.upgrades || {}).upgrade_bounty_hunter > 0 ? ' and Bounty hunter' : ''}. Cancel advice: a cancel costs ${fmt.int(cancelCost)} points and is taken to be instant; when going for XP, only cancelling that does not lose points overall is suggested. Nothing checks whether you survive: watch the enemy max hit and Food/hr.</p>
        </div>
      </div>`;

    const redraw = () => { if (IC.currentView === 'exterm') this.render(el); };
    const save = (k, v) => { const s = this.opt(); s[k] = v; IC.store.set('exterm', s); this.render(el); };
    el.querySelector('#xLvl').onchange = (e) => save('level', e.target.value);
    el.querySelector('#xExt').onchange = (e) => save('extended', e.target.checked);
    el.querySelector('#xTok').onchange = (e) => save('token', e.target.checked);
    el.querySelector('#xAuto').onchange = (e) => save('auto', e.target.checked);
    el.querySelector('#xGap').onchange = (e) => save('gap', Math.max(0, +e.target.value || 0));
    el.querySelector('#xCan').onchange = (e) => save('cancel', e.target.checked);
    el.querySelector('#xGoal').onchange = (e) => save('goal', e.target.value);
    el.querySelector('#xReset').onclick = () => D.reset(null, redraw);
    D.bindGear(el.querySelector('#xGear'), redraw);
    IC.ui.bindSellMode(el, () => this.render(el));
    el.querySelectorAll('[data-goto-mon]').forEach((b) => { b.onclick = () => { D.state.monster = b.dataset.gotoMon; IC.store.set('dpsMonster', D.state.monster); document.querySelector('[data-tab="dps"]').click(); }; });
  },
};
