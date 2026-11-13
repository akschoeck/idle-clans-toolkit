// Settings: boosts used by the calculators, level corrections, cache.
IC.views.settings = {
  label: 'Settings',
  blurb: 'Your speed and XP boosts, level corrections and cached data.',
  render(el) {
    const S = IC.settings, p = IC.data.profile;
    const over = p ? IC.store.get('levels.' + p.username.toLowerCase(), {}) : {};
    el.innerHTML = `<h2>Settings</h2>
      <div class="card"><h3>Your boosts</h3>
        <p class="muted">The API does not report your active boosts, so add up what you have in game (tools, clan house, potions, events) and enter the totals. Every calculator uses them.</p>
        <div class="controls">
          <label>Skilling speed boost <input type="number" id="sSpeed" min="0" max="500" value="${S.speedBoost}"> %</label>
          <label>XP boost <input type="number" id="sXp" min="0" max="500" value="${S.xpBoost}"> %</label>
          <label><input type="checkbox" id="sPrem" ${S.premium ? 'checked' : ''}> I have premium (+${IC.data.game.settings.offlinePremium}h offline cap)</label>
        </div></div>
      ${p ? `<div class="card"><h3>Level corrections for ${esc(p.username)}</h3>
        <p class="muted">Levels are worked out from XP using the game's XP table. If one ever disagrees with the game, type the real level here. Leave blank to use the estimate.</p>
        <div class="skills">${IC.SKILLS.map((s) => `<label class="skill"><div class="row"><span class="name">${IC.skillName(s)}</span><span class="muted small">est. ${IC.levelForXp(IC.xp[s])}</span></div>
          <input type="number" data-lvl="${s}" min="1" max="${IC.MAX_LEVEL}" value="${over[s] || ''}" placeholder="auto" style="width:100%;margin-top:6px"></label>`).join('')}</div></div>` : ''}
      <div class="card"><h3>Data</h3>
        <p class="muted">Game data is cached for 12 hours and prices for 5 minutes (game config version ${esc(IC.data.game.settings.version)}).</p>
        <div class="controls"><button class="ghost" id="sClear">Clear cached data and reload</button><button class="ghost" id="sForget">Forget my username</button></div></div>`;
    const num = (id, key) => { el.querySelector(id).onchange = (e) => { S[key] = Math.max(0, +e.target.value || 0); IC.saveSettings(); }; };
    num('#sSpeed', 'speedBoost'); num('#sXp', 'xpBoost');
    el.querySelector('#sPrem').onchange = (e) => { S.premium = e.target.checked; IC.saveSettings(); };
    el.querySelectorAll('[data-lvl]').forEach((i) => i.onchange = () => {
      const v = Math.round(+i.value);
      if (v >= 1 && v <= IC.MAX_LEVEL) over[i.dataset.lvl] = v; else { delete over[i.dataset.lvl]; i.value = ''; }
      IC.store.set('levels.' + p.username.toLowerCase(), over);
      IC.computeLevels();
    });
    el.querySelector('#sClear').onclick = () => { try { indexedDB.deleteDatabase('ic-cache'); } catch (e) { /* ignore */ } setTimeout(() => location.reload(), 150); };
    el.querySelector('#sForget').onclick = () => IC.setUser('');
  },
};
