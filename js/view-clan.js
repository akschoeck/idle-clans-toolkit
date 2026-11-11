// Clan: member activity, XP contributions and Clan Cup standings.
IC.views.clan = {
  label: 'Clan',
  blurb: 'Who is contributing XP, what members are doing, and where the clan stands in the Clan Cup.',
  state: { hours: 24 },
  RANKS: { 0: 'Member', 1: 'Deputy', 2: 'Leader' },
  render(el) {
    const p = IC.data.profile, st = this.state;
    if (!p) { el.innerHTML = `<h2>Clan</h2>${IC.ui.needUser()}`; return; }
    if (!p.guildName) { el.innerHTML = '<h2>Clan</h2><div class="note">This character is not in a clan.</div>'; return; }
    const clan = p.guildName, enc = encodeURIComponent(clan);
    el.innerHTML = `<h2>${esc(p.guildDisplayName || clan)}</h2>
      <div id="clInfo" class="grid"></div>
      <div class="controls"><b>XP contributions</b><span class="subtabs" style="margin:0">${[[24, '24 hours'], [168, '7 days'], [720, '30 days']].map(([h, l]) => `<button data-h="${h}" aria-pressed="${h === st.hours}">${l}</button>`).join('')}</span></div>
      <div id="clXp"><p class="muted">Loading…</p></div>
      <h3 style="margin-top:16px">Members</h3><div id="clMembers"><p class="muted">Loading…</p></div>
      <h3 style="margin-top:16px">Clan Cup standings</h3><div id="clCup"><p class="muted">Loading…</p></div>`;
    el.querySelectorAll('[data-h]').forEach((b) => b.onclick = () => { st.hours = +b.dataset.h; this.render(el); });
    const fail = (id, what) => (e) => { const n = el.querySelector(id); if (n) n.innerHTML = `<p class="muted">${e.status === 404 ? `No ${what} found for this clan.` : esc(e.message)}</p>`; };

    IC.api(`/Clan/${enc}/experience?hours=${st.hours}`, { ttl: 5 * MIN }).then((x) => {
      const total = x.totalExperience || 0;
      const rows = (x.playerContributions || []).map((c) => {
        const top = Object.entries(c.skills || {}).sort((a, b) => b[1].experience - a[1].experience).slice(0, 3);
        return { name: c.username, xp: c.totalExperience || 0, share: total ? c.totalExperience / total : 0, top };
      });
      const skillTotals = Object.entries(x.skillTotals || {}).sort((a, b) => b[1] - a[1]).slice(0, 5);
      const box = el.querySelector('#clXp'); if (!box) return;
      box.innerHTML = `<p>Total: <b>${fmt.short(total)}</b> XP${skillTotals.length ? ' · top skills: ' + skillTotals.map(([s, v]) => `${esc(s)} ${fmt.short(v)}`).join(', ') : ''}</p><div id="clXpT"></div>`;
      IC.ui.table(box.querySelector('#clXpT'), {
        rows, sort: 1, limit: 30, empty: 'No XP recorded in this period.',
        cols: [
          { label: 'Member', val: (r) => r.name, html: (r) => esc(r.name) + (r.name.toLowerCase() === p.username.toLowerCase() ? '<span class="tag good">you</span>' : '') },
          { label: 'XP gained', num: true, val: (r) => r.xp },
          { label: 'Share', num: true, val: (r) => r.share, html: (r) => `<div>${fmt.pct(r.share, 0)}</div><div class="bar"><i style="width:${(r.share * 100).toFixed(1)}%"></i></div>` },
          { label: 'Mostly training', html: (r) => r.top.map(([s, v]) => `${esc(s)} <span class="muted">(${fmt.short(v.experience)}, lvl ${v.level})</span>`).join(', ') },
        ],
      });
    }).catch(fail('#clXp', 'XP data'));

    IC.api(`/Clan/recruitment/${enc}`, { ttl: 10 * MIN }).then(async (c) => {
      const info = el.querySelector('#clInfo'); if (!info) return;
      const members = c.memberlist || [];
      info.innerHTML = `
        <div class="card stat"><div class="label">Members</div><div class="value">${members.length}</div><div class="muted small">${c.isRecruiting ? 'Recruiting' : 'Not recruiting'}${c.language ? ' · ' + esc(c.language) : ''}</div></div>
        <div class="card stat"><div class="label">Activity score</div><div class="value">${fmt.dec(c.activityScore, 1)}</div><div class="muted small">Min. total level ${fmt.int(c.minimumTotalLevelRequired || 0)}</div></div>`;
      let profiles = {};
      try {
        const res = await IC.api('/Player/profiles?' + members.slice(0, 20).map((m) => 'usernames=' + encodeURIComponent(m.memberName)).join('&'), { ttl: 5 * MIN });
        for (const pr of (Array.isArray(res) ? res : Object.values(res || {}))) if (pr && pr.username) profiles[pr.username.toLowerCase()] = pr;
      } catch (e) { /* statuses are optional */ }
      const rows = members.map((m) => {
        const pr = profiles[m.memberName.toLowerCase()];
        const total = pr ? IC.SKILLS.reduce((a, s) => a + IC.levelForXp((pr.skillExperiences || {})[s] || 0), 0) : null;
        return { m, pr, total, online: pr ? !!pr.activeServerId : null, off: pr ? pr.hoursOffline : null };
      });
      const box = el.querySelector('#clMembers'); if (!box) return;
      IC.ui.table(box, {
        rows, sort: 2, limit: 30,
        cols: [
          { label: 'Member', val: (r) => r.m.memberDisplayName || r.m.memberName, html: (r) => esc(r.m.memberDisplayName || r.m.memberName) },
          { label: 'Rank', val: (r) => r.m.rank, html: (r) => esc(this.RANKS[r.m.rank] || 'Rank ' + r.m.rank) },
          { label: 'Total level', num: true, val: (r) => r.total, html: (r) => fmt.int(r.total) },
          { label: 'Status', val: (r) => (r.online ? -1 : r.off), html: (r) => (r.pr ? (r.online ? '<span class="good">Online</span>' : `Offline ${fmt.hours(r.off)}`) : '<span class="muted">unknown</span>') },
          { label: 'Last task', val: (r) => (r.pr ? r.pr.taskNameOnLogout || '' : ''), html: (r) => (r.pr && r.pr.taskNameOnLogout ? esc(IC.pretty(r.pr.taskNameOnLogout)) : '<span class="muted">–</span>') },
        ],
      });
    }).catch((e) => { fail('#clMembers', 'member list')(e); const i = el.querySelector('#clInfo'); if (i) i.innerHTML = ''; });

    IC.api(`/ClanCup/standings/${enc}?gameMode=${encodeURIComponent(p.gameMode || 'default')}`, { ttl: 10 * MIN }).then((s) => {
      const box = el.querySelector('#clCup'); if (!box) return;
      IC.ui.table(box, {
        rows: s || [], sort: 2, dir: 1, limit: 40, empty: 'No Clan Cup scores yet.',
        cols: [
          { label: 'Objective', val: (r) => IC.pretty(r.objective) },
          { label: 'Score', num: true, val: (r) => r.score, html: (r) => fmt.int(r.score) },
          { label: 'Rank', num: true, val: (r) => r.rank, html: (r) => '#' + fmt.int(r.rank) },
        ],
      });
    }).catch(fail('#clCup', 'Clan Cup standings'));
  },
};
