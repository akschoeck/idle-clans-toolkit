// Skilling: the game's premium "task stats" panel for whatever you are doing now or any task you pick,
// plus a target-level planner.
IC.views.skilling = {
  label: 'Skilling',
  blurb: 'Completions, XP and loot per hour for your current task or any other, and how long a target level will take.',
  state: { user: null, uid: null, target: {} },
  // "5m 15s" style duration from hours.
  dur(hours) {
    if (hours == null || !isFinite(hours)) return '–';
    let s = Math.round(hours * 3600);
    if (s < 60) return s + 's';
    const d = Math.floor(s / 86400); s -= d * 86400;
    const h = Math.floor(s / 3600); s -= h * 3600;
    const m = Math.floor(s / 60); s -= m * 60;
    if (d) return `${d}d ${h}h`;
    if (h) return `${h}h ${m}m`;
    return `${m}m ${s}s`;
  },
  // The task the character is doing right now (or was doing at logout), if it is a skilling task.
  current() {
    const p = IC.data.profile, name = p && p.taskNameOnLogout;
    return name ? IC.data.game.tasks.find((t) => t.key === name) || null : null;
  },
  render(el) {
    const st = this.state, p = IC.data.profile, tasks = IC.data.game.tasks;
    if (p && st.user !== p.username) { st.user = p.username; st.uid = null; }
    const cur = this.current();
    if (!st.uid || !tasks.some((t) => t.uid === st.uid)) st.uid = (cur || tasks[0]).uid;
    const skills = [...new Set(tasks.map((t) => t.skill))];
    const doing = p ? (cur ? `<b>${esc(p.username)}</b> ${p.activeServerId ? 'is doing' : 'was last doing'} <b>${esc(IC.taskName(cur))}</b> (${esc(IC.skillName(cur.skill))}).`
      : `<b>${esc(p.username)}</b> ${p.taskNameOnLogout ? `${p.activeServerId ? 'is' : 'was last'} on <b>${esc(IC.pretty(p.taskNameOnLogout))}</b>, which is not a timed skilling task` : 'has no current task'}. Pick a task below.`) : '';
    el.innerHTML = `<h2>Skilling</h2>
      ${p ? `<div class="controls"><span>${doing}</span><button id="kUpdate" title="Re-load your character and jump to what it is doing now">Update</button>${cur && cur.uid !== st.uid ? '<button class="ghost" id="kBack">Back to current task</button>' : ''}</div>` : IC.ui.needUser()}
      <div class="controls">
        <label>Skill <select id="kSkill">${skills.map((s) => `<option value="${s}">${esc(IC.skillName(s))}${IC.levels ? ` (${IC.levels[s]})` : ''}</option>`).join('')}</select></label>
        <label>Task <select id="kTask"></select></label>
        <label title="Total skilling speed boost from tools, upgrades, clan and potions">Speed boost <input type="number" id="kSpeed" min="0" max="500" value="${IC.settings.speedBoost}"> %</label>
        <label title="Total XP boost, e.g. 10 for the two +5% boosts shown in game">XP boost <input type="number" id="kXp" min="0" max="500" value="${IC.settings.xpBoost}"> %</label>
        ${IC.ui.sellModeSelect()}
      </div>
      <div id="kOut"></div>
      <h3 style="margin-top:18px">Every task in this skill</h3>
      <div id="kTable"></div>
      <p class="muted small">The API does not report your active boosts, so enter the totals above (they are shared with Settings). Click a row to load that task. Plundering loot is scaled by your success chance. Ritual power is not available from the API.</p>`;
    const $ = (id) => el.querySelector(id);
    const draw = () => this.draw(el);
    $('#kSkill').onchange = (e) => { const s = e.target.value, list = tasks.filter((t) => t.skill === s).sort((a, b) => a.level - b.level); const ok = list.filter((t) => IC.canDo(t).ok); st.uid = (ok[ok.length - 1] || list[0]).uid; draw(); };
    $('#kTask').onchange = (e) => { st.uid = e.target.value; draw(); };
    const num = (id, key) => { $(id).onchange = (e) => { IC.settings[key] = Math.max(0, +e.target.value || 0); IC.saveSettings(); draw(); }; };
    num('#kSpeed', 'speedBoost'); num('#kXp', 'xpBoost');
    if ($('#kUpdate')) $('#kUpdate').onclick = async () => {
      $('#kUpdate').disabled = true;
      try { await IC.loadProfile(IC.data.profile.username, true); } catch (e) { /* keep the copy we have */ }
      const now = this.current(); if (now) st.uid = now.uid;
      if (IC.currentView === 'skilling') this.render(el);
    };
    if ($('#kBack')) $('#kBack').onclick = () => { st.uid = cur.uid; this.render(el); };
    $('#kTable').addEventListener('click', (e) => { const b = e.target.closest('[data-task]'); if (b) { st.uid = b.dataset.task; draw(); window.scrollTo({ top: 0, behavior: 'smooth' }); } });
    IC.ui.bindSellMode(el, draw);
    draw();
  },
  task() { return IC.data.game.tasks.find((t) => t.uid === this.state.uid) || IC.data.game.tasks[0]; },
  draw(el) {
    const st = this.state, t = this.task(), s = t.skill, tasks = IC.data.game.tasks, cur = this.current();
    const $ = (id) => el.querySelector(id);
    $('#kSkill').value = s;
    $('#kTask').innerHTML = tasks.filter((x) => x.skill === s).sort((a, b) => a.level - b.level).map((x) => `<option value="${esc(x.uid)}">${esc(IC.taskName(x))} (lvl ${x.level})${IC.canDo(x).ok ? '' : ' – locked'}</option>`).join('');
    $('#kTask').value = t.uid;

    const r = IC.calcTask(t), shop = IC.calcTask(t, 'shop'), can = IC.canDo(t);
    const has = !!IC.levels, L = has ? IC.levels[s] : 1, xp = has ? IC.xp[s] || 0 : 0;
    const xpPer = t.xp * (1 + (IC.settings.xpBoost || 0) / 100);
    const plan = (level) => {
      const need = Math.max(0, IC.xpForLevel(level) - xp), actions = need > 0 && xpPer > 0 ? Math.ceil(need / xpPer) : 0;
      return { need, actions, hrs: actions / r.perHr };
    };
    const maxed = L >= IC.MAX_LEVEL, next = plan(Math.min(L + 1, IC.MAX_LEVEL));
    const target = Math.max(Math.min(st.target[s] || L + 1, IC.MAX_LEVEL), Math.min(L + 1, IC.MAX_LEVEL)), tp = plan(target);
    const gate = (o) => (o.gated ? r.success : 1);
    const outs = t.out.filter((o) => o.id !== IC.GOLD), gold = t.out.filter((o) => o.id === IC.GOLD).reduce((a, o) => a + o.amt * gate(o), 0);
    const itemsHr = outs.reduce((a, o) => a + o.amt * gate(o), 0) * r.perHr;
    const row = (label, value, title) => `<tr title="${esc(title || '')}"><td class="muted">${label}</td><td class="num"><b>${value}</b></td></tr>`;
    const list = (arr, mult) => arr.map((o) => `${fmt.dec(o.amt * mult * gate(o), o.amt * mult * gate(o) < 10 ? 2 : 0)}× ${IC.ui.itemLink(o.id)}`).join(', ');
    const top = outs.slice().sort((a, b) => b.amt * gate(b) - a.amt * gate(a)).slice(0, 6);

    $('#kOut').innerHTML = `<div class="cols">
      <div class="card"><h3>${esc(IC.taskName(t))} ${cur && cur.uid === t.uid ? '<span class="tag good">current task</span>' : ''}${can.ok ? '' : `<span class="tag warn">needs ${esc(IC.ui.reqText(can.missing))}</span>`}</h3>
        <table><tbody>
        ${row('Completions per hour', fmt.dec(r.perHr, 1), `${fmt.dec(3600 / r.perHr, 2)} seconds each`)}
        ${row('Experience per hour', fmt.int(r.xpHr), `${fmt.dec(xpPer, 2)} XP per completion`)}
        ${row('Items per hour', fmt.dec(itemsHr, itemsHr < 100 ? 1 : 0))}
        ${r.success != null ? row('Success chance', fmt.pct(r.success, 1)) : ''}
        ${gold ? row('Gold per hour', fmt.int(gold * r.perHr)) : ''}
        ${row('Loot per hour, base sell value', fmt.int(shop.revHr))}
        ${row('Loot per hour, player market', fmt.int(r.revHr), 'At the sell price chosen above, after market tax')}
        ${t.costs.length ? row('Input cost per hour', r.unknownIn ? 'no price' : fmt.int(r.costHr)) : ''}
        ${t.costs.length ? row('Profit per hour', r.profitHr == null ? 'no price' : `<span class="${r.profitHr >= 0 ? 'good' : 'bad'}">${fmt.int(r.profitHr)}</span>`) : ''}
        </tbody></table>
        ${top.length ? `<p class="muted small">Per hour: ${list(top, r.perHr)}${outs.length > top.length ? ` and ${outs.length - top.length} rarer drops` : ''}</p>` : ''}
        ${t.costs.length ? `<p class="muted small">Uses per hour: ${t.costs.map((c) => `${fmt.dec(c.amt * r.perHr, 0)}× ${IC.ui.itemLink(c.id)}`).join(', ')}</p>` : ''}
      </div>
      <div class="card"><h3>${esc(IC.skillName(s))} ${has ? `level ${L}` : ''}</h3>
        ${!has ? '<p class="muted">Enter your username at the top to see level-up times.</p>' : `
        <p>${maxed ? 'This skill is at the maximum level.' : `Next level up in about <b>${this.dur(next.hrs)}</b> (${fmt.int(next.actions)} actions, ${fmt.int(next.need)} XP)`}</p>
        <div class="controls"><label>Target level <input type="number" id="kTarget" min="${Math.min(L + 1, IC.MAX_LEVEL)}" max="${IC.MAX_LEVEL}" value="${target}"></label></div>
        ${maxed ? '' : `<table><tbody>
        ${row(`XP needed for level ${target}`, fmt.int(tp.need))}
        ${row('Completions needed', fmt.int(tp.actions))}
        ${row('Time needed', this.dur(tp.hrs), `${fmt.dec(tp.hrs, 1)} hours of continuous progress`)}
        ${outs.length ? row('Items produced', fmt.int(itemsHr / r.perHr * tp.actions)) : ''}
        ${t.costs.length ? row('Inputs needed', t.costs.map((c) => `${fmt.int(c.amt * tp.actions)}× ${IC.ui.itemLink(c.id)}`).join('<br>')) : ''}
        ${t.costs.length ? row('Input cost', r.unknownIn ? 'no price' : fmt.int(r.costHr / r.perHr * tp.actions)) : ''}
        ${row('Loot value, base sell', fmt.int(shop.revHr / r.perHr * tp.actions))}
        ${row('Loot value, player market', fmt.int(r.revHr / r.perHr * tp.actions))}
        ${r.profitPer != null && t.costs.length ? row('Net gold', `<span class="${r.profitPer >= 0 ? 'good' : 'bad'}">${fmt.int(r.profitPer * tp.actions)}</span>`) : ''}
        </tbody></table>`}`}
      </div></div>`;
    if ($('#kTarget')) $('#kTarget').onchange = (e) => { st.target[s] = Math.round(+e.target.value) || 0; this.draw(el); };

    const rows = IC.allTaskRows().filter((x) => x.task.skill === s && x.task.xp > 0).map((x) => {
      const per = x.task.xp * (1 + (IC.settings.xpBoost || 0) / 100);
      const a1 = next.need > 0 ? Math.ceil(next.need / per) : 0, a2 = tp.need > 0 ? Math.ceil(tp.need / per) : 0;
      return Object.assign(x, { a1, h1: a1 / x.perHr, a2, h2: a2 / x.perHr });
    });
    IC.ui.table($('#kTable'), {
      rows, sort: 3, limit: 60, rowClass: (x) => (x.can.ok ? '' : 'locked'), empty: 'This skill has no timed tasks in the game data.',
      cols: [
        { label: 'Task', val: (x) => IC.taskName(x.task), html: (x) => `<button class="link" data-task="${esc(x.task.uid)}">${esc(IC.taskName(x.task))}</button>${x.task.uid === t.uid ? '<span class="tag good">selected</span>' : ''}${x.can.ok ? '' : `<span class="tag warn">needs ${esc(IC.ui.reqText(x.can.missing))}</span>`}` },
        { label: 'Lvl', num: true, val: (x) => x.task.level, html: (x) => x.task.level },
        { label: 'Per hr', num: true, val: (x) => x.perHr, html: (x) => fmt.dec(x.perHr, 1), title: 'Completions per hour' },
        { label: 'XP/hr', num: true, val: (x) => x.xpHr, html: (x) => fmt.int(x.xpHr) },
        { label: 'Next level', num: true, val: (x) => (has && !maxed ? -x.h1 : null), html: (x) => (has && !maxed ? `${this.dur(x.h1)} <span class="muted small">(${fmt.int(x.a1)})</span>` : '–'), title: 'Time and completions to your next level' },
        { label: `To level ${target}`, num: true, val: (x) => (has && !maxed ? -x.h2 : null), html: (x) => (has && !maxed ? `${this.dur(x.h2)} <span class="muted small">(${fmt.int(x.a2)})</span>` : '–'), title: 'Time and completions to the target level' },
        { label: 'Profit/hr', num: true, val: (x) => x.profitHr, html: (x) => (x.profitHr == null ? '<span class="muted">no price</span>' : `<span class="${x.profitHr >= 0 ? 'good' : 'bad'}">${fmt.short(x.profitHr)}</span>`) },
      ],
    });
  },
};
