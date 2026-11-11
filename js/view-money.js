// Money: profit per hour for every skilling task at live market prices.
IC.views.money = {
  label: 'Money',
  blurb: 'Gold per hour for every skilling task, using live market prices and the 1% sale tax.',
  state: { skill: 'all', doable: true, hideThin: true, q: '' },
  render(el) {
    const st = this.state;
    el.innerHTML = `
      <h2>Gold per hour</h2>
      <p class="muted">Inputs are bought at the cheapest current offer (market or gold shop). Outputs are sold at the price you pick below, less the ${IC.data.game.settings.tax}% market tax, or to the game shop when that pays more.</p>
      ${IC.levels ? '' : IC.ui.needUser()}
      <div class="controls">
        <label>Skill <select id="mSkill"><option value="all">All skills</option>${[...new Set(IC.data.game.tasks.map((t) => t.skill))].map((s) => `<option value="${s}">${IC.skillName(s)}</option>`).join('')}</select></label>
        ${IC.ui.sellModeSelect()}
        <label><input type="checkbox" id="mDoable"> Only what I can do</label>
        <label title="Hides items where the whole market trades less in a week than you would produce in a day"><input type="checkbox" id="mThin"> Hide thinly traded</label>
        <input type="search" id="mQ" placeholder="Search task…" value="${esc(st.q)}">
      </div>
      <div id="mTable"></div>
      <p class="muted small">Speed and XP boosts come from Settings (currently +${IC.settings.speedBoost}% speed, +${IC.settings.xpBoost}% XP). Plundering uses the base success chance. "Thin" means the weekly market volume is smaller than one day of your output, so the price will not hold if you sell in bulk.</p>`;
    const $ = (id) => el.querySelector(id);
    $('#mSkill').value = st.skill; $('#mDoable').checked = st.doable && !!IC.levels; $('#mDoable').disabled = !IC.levels; $('#mThin').checked = st.hideThin;
    const draw = () => {
      const q = st.q.trim().toLowerCase();
      const rows = IC.allTaskRows().filter((r) =>
        (st.skill === 'all' || r.task.skill === st.skill) && (!st.doable || !IC.levels || r.can.ok) && (!st.hideThin || !r.thin)
        && (!q || IC.taskName(r.task).toLowerCase().includes(q)));
      IC.ui.table($('#mTable'), {
        rows, sort: 7, limit: 50, rowClass: (r) => (r.can.ok ? '' : 'locked'), empty: 'No tasks match these filters.',
        cols: [
          { label: 'Task', val: (r) => IC.taskName(r.task), html: (r) => (r.task.mainOut != null ? IC.ui.itemLink(r.task.mainOut) : esc(IC.taskName(r.task)))
            + (r.thin ? '<span class="tag warn">thin</span>' : '') + (r.shopSold ? '<span class="tag">shop</span>' : '') + (r.task.success ? `<span class="tag">${Math.round(r.task.success * 100)}% success</span>` : '')
            + (r.can.ok ? '' : `<span class="tag warn">needs ${esc(IC.ui.reqText(r.can.missing))}</span>`) },
          { label: 'Skill', val: (r) => IC.skillName(r.task.skill) },
          { label: 'Lvl', num: true, val: (r) => r.task.level, html: (r) => r.task.level },
          { label: 'Per hr', num: true, val: (r) => r.perHr, html: (r) => fmt.dec(r.perHr, 1), title: 'Completions per hour' },
          { label: 'XP/hr', num: true, val: (r) => r.xpHr },
          { label: 'Inputs', val: (r) => r.task.costs.length, html: (r) => r.task.costs.map((c) => `${fmt.dec(c.amt, 1)}× ${IC.ui.itemLink(c.id)}`).join(', ') || '<span class="muted">none</span>' },
          { label: 'Cost/hr', num: true, val: (r) => (r.unknownIn ? null : r.costHr), html: (r) => (r.unknownIn ? '<span class="muted">no price</span>' : fmt.short(r.costHr)) },
          { label: 'Profit/hr', num: true, val: (r) => r.profitHr, html: (r) => (r.profitHr == null ? '<span class="muted">no price</span>' : `<b class="${r.profitHr >= 0 ? 'good' : 'bad'}">${fmt.short(r.profitHr)}</b>`) },
          { label: '7d volume', num: true, val: (r) => r.vol7, title: 'Units of the output traded on the market in the last 7 days' },
        ],
      });
    };
    $('#mSkill').onchange = (e) => { st.skill = e.target.value; draw(); };
    $('#mDoable').onchange = (e) => { st.doable = e.target.checked; draw(); };
    $('#mThin').onchange = (e) => { st.hideThin = e.target.checked; draw(); };
    $('#mQ').oninput = (e) => { st.q = e.target.value; draw(); };
    IC.ui.bindSellMode(el, draw);
    draw();
  },
};
