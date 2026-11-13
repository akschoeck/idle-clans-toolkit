// Usage log: tells the site owner which character names are used here and what they look up.
// Sends only a random visitor code kept in this browser, the character name typed at the top, the action and a
// short detail. The code is made up locally and says nothing about the person. No IP address is stored.
// Does nothing until LOG_URL is set to the deployed worker's address (see worker/worker.js).
(() => {
  const LOG_URL = 'https://idle-clan-logs.akschoeck.workers.dev';
  const local = ['localhost', '127.0.0.1', '[::1]', ''].includes(location.hostname);
  if (!LOG_URL || local) return;

  // Random per-browser code so one visitor can be followed across character names and days.
  let visitor = IC.store.get('visitor', '');
  if (!/^v-[a-z0-9]{8}$/.test(visitor)) {
    const bytes = new Uint8Array(8); crypto.getRandomValues(bytes);
    visitor = 'v-' + [...bytes].map((b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
    IC.store.set('visitor', visitor);
  }
  const who = () => (IC.data.profile ? IC.data.profile.username : IC.store.get('username', '')) || '';
  let last = '';
  function track(event, detail) {
    const body = JSON.stringify({ visitor, name: who(), event, detail: String(detail == null ? '' : detail).slice(0, 200) });
    if (body === last) return; // skip immediate repeats
    last = body;
    try { fetch(LOG_URL + '/e', { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'text/plain' } }).catch(() => {}); } catch (e) { /* logging must never break the page */ }
  }

  track('visit', IC.currentView || '');
  const setUser = IC.setUser;
  IC.setUser = async function (name) { const r = await setUser.apply(this, arguments); track(name ? 'load character' : 'forget character', name || ''); return r; };

  // The label's own words only (its text nodes), not the text of the options inside a dropdown.
  const label = (el) => { const l = el.closest('label'); return (l ? [...l.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' ').replace(/\s+/g, ' ').trim().slice(0, 30) : '') || el.id || el.name || el.type; };
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab],[data-item],[data-mon],[data-task],[data-pick],[data-forget],#userKeep');
    if (!t) return;
    const d = t.dataset;
    if (d.tab) track('open tab', d.tab);
    else if (d.item) track('view item', IC.itemName(+d.item));
    else if (d.mon) track('view enemy', d.mon);
    else if (d.task) track('pick task', d.task);
    else if (d.pick) track('pick gear', +d.pick >= 0 ? IC.itemName(+d.pick) : 'empty slot');
    else if (d.forget) track('remove saved character', d.forget);
    else track('save character', document.getElementById('userInput').value.trim());
  }, true);
  // Dropdowns, search boxes and number fields: logged when the value is committed, not per keystroke.
  document.addEventListener('change', (e) => {
    const el = e.target;
    if (!el.matches || !el.matches('select, input[type=search], input[type=number], input[type=checkbox]') || el.id === 'userInput') return;
    const value = el.type === 'checkbox' ? (el.checked ? 'on' : 'off') : el.tagName === 'SELECT' && el.selectedOptions[0] ? el.selectedOptions[0].textContent.trim() : el.value;
    track(el.type === 'search' ? 'search' : 'set ' + label(el), value);
  }, true);

})();
