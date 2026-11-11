// Home: profile summary, alerts, best picks, skills grid.
IC.views = {};
IC.offlineCap = function () {
  const p = IC.data.profile, g = IC.data.game; if (!g) return null;
  const up = g.upgrades.find((u) => u.type === 6); // offline progress upgrade: tier value = extra hours
  const tier = p && p.upgrades ? p.upgrades.offlineProgress || 0 : 0;
  const extra = up && tier > 0 ? up.values[Math.min(tier, up.values.length) - 1] || 0 : 0;
  return g.settings.offlineBase + extra + (IC.settings.premium ? g.settings.offlinePremium : 0);
};

IC.views.home = {
  label: 'Home',
  render(el) {
    const p = IC.data.profile;
    if (!p) {
      el.innerHTML = `<div class="card"><h2>Welcome</h2>
        <p>Enter your in-game username at the top. It is saved in this browser, and every tool then filters to what your character can actually do.</p>
        <p class="muted">Without a username the tools still work, they just show everything in the game.</p></div>
        <div class="grid">${Object.entries(IC.views).filter(([k]) => k !== 'home').map(([k, v]) => `<div class="card"><h3>${esc(v.label)}</h3><p class="muted">${esc(v.blurb || '')}</p><button class="ghost" data-goto="${k}">Open</button></div>`).join('')}</div>`;
      return;
    }
    const rows = IC.allTaskRows().filter((r) => r.can.ok);
    const liquid = rows.filter((r) => r.profitHr != null && !r.thin);
    const bestGold = liquid.slice().sort((a, b) => b.profitHr - a.profitHr)[0];
    const bestXp = rows.slice().sort((a, b) => b.xpHr - a.xpHr)[0];
    const bestBoth = liquid.filter((r) => r.profitHr > 0 && r.xpHr > 0).sort((a, b) => b.xpHr - a.xpHr)[0];
    const pick = (title, r, main, sub) => r ? `<div class="card stat"><div class="label">${title}</div><div class="value">${esc(IC.taskName(r.task))}</div><div>${main}</div><div class="muted small">${IC.skillName(r.task.skill)} · level ${r.task.level}${sub ? ' · ' + sub : ''}</div></div>` : '';

    const alerts = [];
    const cap = IC.offlineCap();
    if (p.hoursOffline != null && cap) {
      const online = p.activeServerId != null && p.activeServerId !== '';
      if (!online && p.hoursOffline >= cap) alerts.push(`<div class="note alert-bad"><b>Offline progress has stopped.</b> You have been offline ${fmt.dec(p.hoursOffline, 1)}h and your cap is about ${cap}h. Log in to restart ${esc(IC.pretty(p.taskNameOnLogout || 'your task'))}.</div>`);
      else if (!online && p.hoursOffline >= cap - 2) alerts.push(`<div class="note alert-warn"><b>Offline cap is close.</b> ${fmt.dec(p.hoursOffline, 1)}h of about ${cap}h used. Log in within ${fmt.hours(cap - p.hoursOffline)} to avoid losing progress.</div>`);
    }
    const h = IC.data.holiday;
    if (h && h.active && h.experienceBoost > 0) alerts.push(`<div class="note alert-good"><b>${esc(h.eventType)} event:</b> +${h.experienceBoost}% XP is active${h.estimatedEndTime ? `, estimated to end ${new Date(h.estimatedEndTime).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : ''}. ${IC.settings.xpBoost ? '' : 'Add it under Settings → XP boost so the planners include it.'}</div>`);
    const hits = IC.watchHits ? IC.watchHits() : [];
    if (hits.length) alerts.push(`<div class="note alert-good"><b>Price alert:</b> ${hits.map((w) => `${IC.ui.itemLink(w.id)} is at ${fmt.int(w.now)} (target ${w.dir === 'below' ? '≤' : '≥'} ${fmt.int(w.price)})`).join('; ')}.</div>`);

    const totalXp = IC.SKILLS.reduce((a, s) => a + IC.xp[s], 0);
    const ranks = IC.data.ranks;
    el.innerHTML = `
      ${alerts.join('')}
      <div class="grid">
        <div class="card stat"><div class="label">${esc(p.gameMode || 'default')} character</div><div class="value">${esc(p.username)}</div>
          <div class="muted small">${p.guildName ? 'Clan: ' + esc(p.guildDisplayName || p.guildName) : 'No clan'}</div></div>
        <div class="card stat"><div class="label">Total level</div><div class="value">${fmt.int(IC.totalLevel())}</div>
          <div class="muted small">${fmt.short(totalXp)} XP${ranks && ranks.totalLevelResult ? ' · rank #' + fmt.int(ranks.totalLevelResult.rank) : ''}</div></div>
        <div class="card stat"><div class="label">Last task</div><div class="value">${esc(IC.pretty(p.taskNameOnLogout || '–'))}</div>
          <div class="muted small">${p.activeServerId ? 'Online now' : `Offline ${fmt.dec(p.hoursOffline, 1)}h · cap about ${cap}h`}</div></div>
      </div>
      <h2>Best for you right now</h2>
      <div class="grid">
        ${pick('Most gold per hour', bestGold, bestGold ? `<b class="good">${fmt.short(bestGold.profitHr)}</b> gold/hr` : '', bestGold ? fmt.short(bestGold.xpHr) + ' XP/hr' : '')}
        ${pick('Most XP per hour', bestXp, bestXp ? `<b>${fmt.short(bestXp.xpHr)}</b> XP/hr` : '', bestXp && bestXp.profitHr != null ? fmt.signed(bestXp.profitHr) + ' gold/hr' : '')}
        ${pick('Best XP that still profits', bestBoth, bestBoth ? `<b>${fmt.short(bestBoth.xpHr)}</b> XP/hr` : '', bestBoth ? '+' + fmt.short(bestBoth.profitHr) + ' gold/hr' : '')}
      </div>
      <p class="muted small">Picks skip thinly traded items. See the Money and XP tabs for full rankings.</p>
      <h2>Skills</h2>
      <div class="skills">${IC.SKILLS.map((s) => {
        const L = IC.levels[s], xp = IC.xp[s], lo = IC.xpForLevel(L), hi = L < IC.MAX_LEVEL ? IC.xpForLevel(L + 1) : lo;
        const frac = hi > lo ? Math.max(0, Math.min(1, (xp - lo) / (hi - lo))) : 1;
        const rk = ranks && ranks.fields && ranks.fields[s];
        return `<div class="skill"><div class="row"><span class="name">${IC.skillName(s)}</span><span class="lvl">${L}</span></div>
          <div class="bar"><i style="width:${(frac * 100).toFixed(1)}%"></i></div>
          <div class="row muted small"><span>${L < IC.MAX_LEVEL ? fmt.short(Math.max(0, hi - xp)) + ' XP to ' + (L + 1) : 'Max level'}</span><span>${rk ? '#' + fmt.int(rk.rank) : ''}</span></div></div>`;
      }).join('')}</div>
      <p class="muted small" style="margin-top:8px">Levels are estimated from XP and can be one level off right at a threshold. Fix any mismatch under Settings.</p>`;
  },
  // extra, slower data: leaderboard ranks + holiday event
  async extras(rerender) {
    const p = IC.data.profile;
    const jobs = [IC.api('/HolidayEvent/current', { ttl: 30 * MIN }).then((h) => { IC.data.holiday = h; }).catch(() => {})];
    if (p && !IC.data.ranks) {
      const board = 'players:' + (p.gameMode || 'default');
      jobs.push(IC.api(`/Leaderboard/profile/${encodeURIComponent(board)}/${encodeURIComponent(p.username)}`, { ttl: 10 * MIN }).then((r) => { IC.data.ranks = r; }).catch(() => {}));
    }
    await Promise.all(jobs);
    rerender();
  },
};
