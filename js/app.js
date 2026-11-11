// App shell: username handling, tab routing, refresh loop, price-alert notifications.
(() => {
  const view = document.getElementById('view'), tabs = document.getElementById('tabs');
  const input = document.getElementById('userInput'), shown = document.getElementById('userShown');
  const saveBtn = document.getElementById('userSave'), changeBtn = document.getElementById('userChange');
  let ready = false, userError = '';
  IC.currentView = IC.store.get('tab', 'home');
  if (!IC.views[IC.currentView]) IC.currentView = 'home';

  tabs.innerHTML = Object.entries(IC.views).map(([k, v]) => `<button role="tab" data-tab="${k}">${v.label}</button>`).join('');
  function show(name) {
    IC.currentView = name; IC.store.set('tab', name);
    tabs.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === name));
    if (!ready) return;
    const v = IC.views[name];
    try { v.render(view); } catch (e) { console.error(e); view.innerHTML = `<div class="note alert-bad">This page hit an error: ${IC.esc(e.message)}</div>`; }
    if (v.extras) v.extras(() => { if (IC.currentView === name) v.render(view); });
  }
  tabs.onclick = (e) => { const b = e.target.closest('[data-tab]'); if (b) show(b.dataset.tab); };
  view.addEventListener('click', (e) => { const b = e.target.closest('[data-goto]'); if (b) show(b.dataset.goto); });

  function userUi() {
    const name = IC.store.get('username', '');
    const has = !!name;
    shown.hidden = !has; shown.textContent = IC.data.profile ? IC.data.profile.username : name;
    input.hidden = has; saveBtn.hidden = has; changeBtn.hidden = !has;
  }
  function status() {
    const msgs = [];
    if (userError) msgs.push(userError);
    if (IC.staleKeys.size) msgs.push('The API could not be reached for some data, so older cached numbers are shown. Press Refresh to retry.');
    if (IC.data.summaryError) msgs.push('7-day market volumes could not be loaded (' + IC.data.summaryError + '), so liquidity warnings are unavailable.');
    IC.ui.status(msgs);
  }

  async function loadUser(force) {
    const name = IC.store.get('username', '');
    userError = '';
    try { await IC.loadProfile(name, force); }
    catch (e) {
      IC.data.profile = null; IC.levels = null;
      userError = e.status === 404 ? `No Idle Clans character named "${name}" was found. Check the spelling and press Change.` : `Could not load ${name}'s profile: ${e.message}`;
    }
    userUi();
  }
  IC.setUser = async function (name) {
    name = String(name || '').trim();
    if (name) IC.store.set('username', name); else IC.store.remove('username');
    input.value = '';
    await loadUser(true);
    status(); show(IC.currentView);
  };
  document.getElementById('userForm').onsubmit = (e) => { e.preventDefault(); if (input.value.trim()) IC.setUser(input.value); };
  changeBtn.onclick = () => { input.hidden = false; saveBtn.hidden = false; changeBtn.hidden = true; shown.hidden = true; input.value = IC.store.get('username', ''); input.focus(); input.select(); };

  // Desktop notifications for watchlist hits (each hit announced once per session).
  const notified = new Set();
  function notifyHits() {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    for (const w of IC.watchHits()) {
      const key = `${w.id}:${w.dir}:${w.price}`;
      if (notified.has(key)) continue;
      notified.add(key);
      try { new Notification('Idle Clans price alert', { body: `${IC.itemName(w.id)} is at ${IC.fmt.int(w.now)} gold (target ${w.dir === 'below' ? 'at or below' : 'at or above'} ${IC.fmt.int(w.price)})` }); } catch (e) { /* ignore */ }
    }
  }

  async function refresh(force) {
    try {
      await IC.loadBase(force);
      if (force || !IC.data.profile) await loadUser(force);
      ready = true;
    } catch (e) {
      if (!ready) { view.innerHTML = `<div class="note alert-bad"><b>Could not load game data.</b> ${IC.esc(e.message)} <button class="ghost" id="retry">Try again</button></div>`; document.getElementById('retry').onclick = () => start(); return; }
    }
    status(); notifyHits(); show(IC.currentView);
  }
  async function start() {
    view.innerHTML = '<p class="muted">Loading game data and market prices…</p>';
    userUi(); show(IC.currentView);
    await refresh(false);
  }
  document.getElementById('refreshBtn').onclick = () => { IC.data.ranks = null; refresh(true); };
  // Keep prices fresh for alerts; skip re-rendering while a dialog or input is in use.
  setInterval(async () => {
    if (!ready || document.hidden) return;
    try { await IC.loadBase(false); } catch (e) { return; }
    notifyHits(); status();
    const busy = document.getElementById('dialog').open || ['INPUT', 'SELECT'].includes((document.activeElement || {}).tagName);
    if (!busy) show(IC.currentView);
  }, 5 * 60000 + 5000);
  start();
})();
