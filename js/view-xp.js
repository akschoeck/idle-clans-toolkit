// XP planner: per-skill overview, then a detailed plan to a target level.
IC.views.xp = {
  label: 'XP',
  blurb: 'Fastest and cheapest ways to level each skill, time to your target level, and what unlocks next.',
  state: { skill: null, target: {} },
  render(el) {
    const st = this.state;
    const rows = IC.allTaskRows();
    const bySkill = {};
    for (const r of rows) (bySkill[r.task.skill] = bySkill[r.task.skill] || []).push(r);
    const skills = Object.keys(bySkill);
    if (!st.skill || !bySkill[st.skill]) st.skill = skills[0];
    const lvl = (s) => (IC.levels ? IC.levels[s] : 1), xpOf = (s) => (IC.levels ? IC.xp[s] : 0);

    const overview = skills.map((s) => {
      const able = bySkill[s].filter((r) => r.can.ok && r.xpHr > 0);
      const fastest = able.slice().sort((a, b) => b.xpHr - a.xpHr)[0];
      const priced = able.filter((r) => r.goldPerXp != null && !r.thin);
      const cheapest = priced.slice().sort((a, b) => b.goldPerXp - a.goldPerXp)[0];
      const next = bySkill[s].filter((r) => r.task.level > lvl(s)).sort((a, b) => a.task.level - b.task.level)[0];
      const L = lvl(s), toNext = L < IC.MAX_LEVEL ? IC.xpForLevel(L + 1) - xpOf(s) : 0;
      return { s, L, fastest, cheapest, next, toNext, hrs: fastest && toNext > 0 ? toNext / fastest.xpHr : null };
    });

    el.innerHTML = `
      <h2>XP planner</h2>
      ${IC.levels ? '' : IC.ui.needUser()}
      <div id="xpOver"></div>
      <h2 style="margin-top:18px">Plan a skill</h2>
      <div class="controls">
        <label>Skill <select id="xSkill">${skills.map((s) => `<option value="${s}">${IC.skillName(s)}</option>`).join('')}</select></label>
        <label>Target level <input type="number" id="xTarget" min="2" max="${IC.MAX_LEVEL}"></label>
        ${IC.ui.sellModeSelect()}
      </div>
      <div id="xSummary"></div>
      <div id="xTable"></div>
      <p class="muted small">Gold per XP is profit (or loss) divided by XP earned: positive means the training pays for itself. Totals assume you buy every input and sell every output at today's prices. Boosts from Settings: +${IC.settings.speedBoost}% speed, +${IC.settings.xpBoost}% XP.</p>`;

    IC.ui.table(el.querySelector('#xpOver'), {
      rows: overview, sort: -1, limit: 30,
      cols: [
        { label: 'Skill', val: (o) => IC.skillName(o.s), html: (o) => `<button class="link" data-skill="${o.s}">${IC.skillName(o.s)}</button>` },
        { label: 'Level', num: true, val: (o) => o.L, html: (o) => o.L },
        { label: 'Fastest task you can do', val: (o) => (o.fastest ? IC.taskName(o.fastest.task) : ''), html: (o) => (o.fastest ? `${esc(IC.taskName(o.fastest.task))} <span class="muted">(${fmt.short(o.fastest.xpHr)} XP/hr)</span>` : '<span class="muted">–</span>') },
        { label: 'Next level in', num: true, val: (o) => o.hrs, html: (o) => (o.L >= IC.MAX_LEVEL ? 'max' : fmt.hours(o.hrs)) },
        { label: 'Best gold per XP', val: (o) => (o.cheapest ? o.cheapest.goldPerXp : null), html: (o) => (o.cheapest ? `${esc(IC.taskName(o.cheapest.task))} <span class="${o.cheapest.goldPerXp >= 0 ? 'good' : 'bad'}">(${fmt.dec(o.cheapest.goldPerXp, 2)} g/XP)</span>` : '<span class="muted">–</span>') },
        { label: 'Next unlock', val: (o) => (o.next ? o.next.task.level : null), html: (o) => (o.next ? `${esc(IC.taskName(o.next.task))} at ${o.next.task.level} <span class="muted">(${fmt.short(Math.max(0, IC.xpForLevel(o.next.task.level) - xpOf(o.s)))} XP away)</span>` : '<span class="muted">everything unlocked</span>') },
      ],
    });
    el.querySelector('#xpOver').addEventListener('click', (e) => { const b = e.target.closest('[data-skill]'); if (b) { st.skill = b.dataset.skill; detail(); el.querySelector('#xSkill').scrollIntoView({ behavior: 'smooth', block: 'center' }); } });

    const detail = () => {
      const s = st.skill, L = lvl(s);
      el.querySelector('#xSkill').value = s;
      const target = Math.max(Math.min(st.target[s] || Math.min(L + 1, IC.MAX_LEVEL), IC.MAX_LEVEL), 2);
      el.querySelector('#xTarget').value = target;
      const need = Math.max(0, IC.xpForLevel(target) - xpOf(s));
      el.querySelector('#xSummary').innerHTML = `<p>${IC.skillName(s)} ${L} → ${target}: <b>${fmt.int(need)}</b> XP needed.</p>`;
      const xpBoost = 1 + (IC.settings.xpBoost || 0) / 100;
      const list = IC.allTaskRows().filter((r) => r.task.skill === s && r.task.xp > 0).map((r) => {
        const actions = need > 0 ? Math.ceil(need / (r.task.xp * xpBoost)) : 0;
        return Object.assign(r, { actions, hrs: need / r.xpHr, total: r.profitPer != null ? r.profitPer * actions : null });
      });
      IC.ui.table(el.querySelector('#xTable'), {
        rows: list, sort: 2, limit: 40, rowClass: (r) => (r.can.ok ? '' : 'locked'), empty: 'This skill has no timed tasks in the game data.',
        cols: [
          { label: 'Task', val: (r) => IC.taskName(r.task), html: (r) => (r.task.mainOut != null ? IC.ui.itemLink(r.task.mainOut) : esc(IC.taskName(r.task))) + (r.thin ? '<span class="tag warn">thin</span>' : '') + (r.can.ok ? '' : `<span class="tag warn">needs ${esc(IC.ui.reqText(r.can.missing))}</span>`) },
          { label: 'Lvl', num: true, val: (r) => r.task.level, html: (r) => r.task.level },
          { label: 'XP/hr', num: true, val: (r) => r.xpHr },
          { label: 'Time to target', num: true, val: (r) => (need > 0 ? -r.hrs : null), html: (r) => (need > 0 ? fmt.hours(r.hrs) : '–') },
          { label: 'Actions', num: true, val: (r) => r.actions, html: (r) => fmt.int(r.actions) },
          { label: 'Inputs needed', val: (r) => r.task.costs.length, html: (r) => r.task.costs.map((c) => `${fmt.short(c.amt * r.actions)}× ${IC.ui.itemLink(c.id)}`).join(', ') || '<span class="muted">none</span>' },
          { label: 'Gold per XP', num: true, val: (r) => r.goldPerXp, html: (r) => (r.goldPerXp == null ? '<span class="muted">no price</span>' : `<span class="${r.goldPerXp >= 0 ? 'good' : 'bad'}">${fmt.dec(r.goldPerXp, 2)}</span>`) },
          { label: 'Total gold', num: true, val: (r) => r.total, html: (r) => (r.total == null ? '<span class="muted">–</span>' : `<span class="${r.total >= 0 ? 'good' : 'bad'}">${fmt.signed(r.total)}</span>`), title: 'Net gold over the whole grind to the target level' },
        ],
      });
    };
    el.querySelector('#xSkill').onchange = (e) => { st.skill = e.target.value; detail(); };
    el.querySelector('#xTarget').onchange = (e) => { st.target[st.skill] = +e.target.value || 2; detail(); };
    IC.ui.bindSellMode(el, () => this.render(el));
    detail();
  },
};
