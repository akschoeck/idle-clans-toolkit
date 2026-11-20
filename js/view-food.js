// Food: the cheapest way to get healing, three ways (make it all yourself, buy the ingredients and cook, buy it ready
// to eat), ranked by one number: gold per health point once your time is counted at what you could earn instead.
// Recipes, heal amounts, levels and times come from the game data; prices from the player market and the game shop.
// Upgrade effects (The fisherman, Power forager, Farming trickery, Most efficient fisherman) follow the wiki.
IC.views.food = {
  label: 'Food',
  blurb: 'The cheapest way to get more food: make it from scratch, buy the ingredients and cook, or buy it ready to eat.',
  ROUTES: { scratch: 'Make from scratch', cook: 'Buy ingredients, cook', buy: 'Buy ready to eat' },
  VERB: { fishing: 'Catch', foraging: 'Forage', farming: 'Grow', cooking: 'Cook' },
  opt() { return Object.assign({ target: 10000, rate: '', buy: 'ask', ignore: false, thresh: 50, minHeal: 0 }, IC.store.get('food', {})); },
  // Owned tier of a Local market upgrade as a fraction (0.2 = 20%). per: percent per tier, used when the game data has no values.
  tier(key, type, per) {
    const t = ((IC.data.profile || {}).upgrades || {})[key] || 0;
    if (!t) return 0;
    const u = IC.data.game.upgrades.find((x) => x.type === type);
    return ((u && u.values[Math.min(t, u.values.length) - 1]) || per * t) / 100;
  },
  books: new Map(), // item id -> sell offers [{ price, qty }], cheapest first, loaded on demand
  // What one unit costs to buy when `need` units are wanted: { price, vol, depth, short }.
  // vol: units on offer at the cheapest price. Once the item's sell offers are loaded, price is the average paid
  // working up through them, depth is how many are on offer in total and short says the market cannot fill the order.
  price(id, mode, need) {
    const it = IC.data.game.items[id], p = IC.data.prices.get(id) || {}, shop = IC.data.game.shop[id];
    let price = null, vol = null;
    if (it && !it.noTrade) {
      const ask = p.lowestSellPrice > 0 ? p.lowestSellPrice : null;
      if (mode === 'bid' && p.highestBuyPrice > 0) price = ask ? Math.min(p.highestBuyPrice + 1, ask) : p.highestBuyPrice + 1;
      else if (ask) {
        price = ask; vol = p.lowestPriceVolume || 0;
        const book = this.books.get(id);
        if (book && book.length && need > vol && !(shop && shop <= ask)) {
          let left = need, paid = 0, depth = 0;
          for (const b of book) { const take = Math.min(left, b.qty); paid += take * b.price; left -= take; depth += b.qty; }
          paid += left * book[book.length - 1].price; // beyond the visible offers: assume the last price holds
          return { price: paid / need, vol, depth, short: left > 0 };
        }
      }
      else if (p.dailyAveragePrice > 0) price = p.dailyAveragePrice;
    }
    if (shop && (price == null || shop < price)) { price = shop; vol = null; }
    return price == null ? null : { price, vol };
  },
  // The task that makes an item. mode 'scratch': any timed skilling task; 'cook': Cooking only.
  pickTask(id, mode) {
    const c = IC.data.game.tasks.filter((t) => t.mainOut === id && t.skill !== 'plundering' && (mode === 'scratch' || t.skill === 'cooking'));
    return c.sort((a, b) => (IC.canDo(b).ok - IC.canDo(a).ok) || a.level - b.level)[0] || null;
  },
  // Adds what it takes to get `qty` of an item into acc. Anything without a task in this mode is bought.
  make(id, mode, qty, acc, depth) {
    const task = mode === 'buy' || depth > 6 ? null : this.pickTask(id, mode);
    if (!task) {
      const pr = this.price(id, acc.buyMode, qty * acc.pieces);
      if (!pr) { acc.ok = false; return; }
      if (pr.short) acc.thin.push(`${IC.itemName(id)}: only ${fmt.int(pr.depth)} on the market, ${fmt.int(qty * acc.pieces)} needed`);
      else if (pr.depth == null && pr.vol != null && pr.vol < qty * acc.pieces) { acc.thin.push(`${IC.itemName(id)}: only ${fmt.int(pr.vol)} on offer at this price, ${fmt.int(qty * acc.pieces)} needed`); acc.unknown.push(id); }
      acc.gold += pr.price * qty; acc.buys.set(id, (acc.buys.get(id) || 0) + qty);
      return;
    }
    const U = this.up, S = IC.settings;
    const base = (task.out.find((o) => o.id === id && o.chance == null) || { amt: 1 }).amt;
    const dbl = task.skill === 'fishing' ? U.fish : task.skill === 'foraging' ? U.forage : 0;
    const n = qty / (base * (1 + dbl)); // completions needed
    // Most efficient fisherman cooks a share of your own catch for free, so that share needs no cooking time.
    const selfFished = mode === 'scratch' && task.skill === 'cooking' && task.costs.length === 1 && (this.pickTask(task.costs[0].id, 'scratch') || {}).skill === 'fishing';
    acc.hours += n * task.time / 3600000 / (1 + (S.speedBoost || 0) / 100) * (selfFished ? 1 - U.autoCook : 1);
    acc.xp[task.skill] = (acc.xp[task.skill] || 0) + n * task.xp * (1 + (S.xpBoost || 0) / 100);
    if (!acc.tasks.includes(task)) acc.tasks.push(task);
    const keep = task.skill === 'farming' ? 1 - U.seeds : 1; // Farming trickery saves seeds
    for (const c of task.costs) this.make(c.id, mode, n * c.amt * keep, acc, depth + 1);
  },
  // One row per food and route, with every number the tables need.
  rows(o, hp, rate, takenHr) {
    const out = [], foods = IC.data.game.items.filter((i) => i && i.heal > 0 && !i.dead);
    // Auto eating waits until you are under the threshold, so a piece can only use the health that is missing by then.
    const room = hp ? Math.max(1, Math.floor(hp * (1 - o.thresh / 100))) : Infinity;
    for (const food of foods) {
      for (const route of ['scratch', 'cook', 'buy']) {
        if (route !== 'buy' && !this.pickTask(food.id, route)) continue;
        const eff = Math.min(food.heal, room), pieces = Math.ceil(o.target / eff);
        const acc = { gold: 0, hours: 0, xp: {}, buys: new Map(), tasks: [], ok: true, buyMode: o.buy, pieces, thin: [], unknown: [] };
        this.make(food.id, route, 1, acc, 0);
        if (!acc.ok) continue;
        if (route === 'scratch' && !acc.tasks.some((t) => t.skill !== 'cooking')) continue; // nothing gathered: same as buying the ingredients
        const missing = [];
        for (const t of acc.tasks) for (const m of IC.canDo(t).missing) { const had = missing.find((x) => x.skill === m.skill); if (!had) missing.push(Object.assign({}, m)); else had.level = Math.max(had.level, m.level); }
        const thin = acc.thin;
        out.push({
          food, route, acc, missing, eff, pieces, thin, gold: acc.gold, hours: acc.hours,
          gPerHp: acc.gold / eff, allIn: (acc.gold + acc.hours * rate) / eff, totGold: acc.gold * pieces, totHours: acc.hours * pieces,
          xp: Object.values(acc.xp).reduce((a, b) => a + b, 0), eatHr: takenHr > 0 ? takenHr / eff : null,
        });
      }
    }
    return out;
  },
  // Loads the sell offers behind the best-looking rows, so their prices reflect the quantity actually wanted.
  // A cheap first offer is often only a few hundred units deep; ranking on it alone would be misleading.
  async loadBooks(rerender) {
    if (this.loading) return;
    this.loading = true;
    try {
      for (let round = 0; round < 4; round++) {
        const ids = [...new Set(this.want || [])].filter((id) => !this.books.has(id)).slice(0, 8);
        if (!ids.length) break;
        for (const id of ids) {
          try {
            const c = await IC.api(`/PlayerMarket/items/prices/latest/comprehensive/${id}`, { ttl: 2 * MIN });
            this.books.set(id, (c.lowestSellPricesWithVolume || []).map((x) => ({ price: +x.key, qty: +x.value })).filter((x) => x.price > 0 && x.qty > 0).sort((a, b) => a.price - b.price));
          } catch (e) { this.books.set(id, []); }
        }
        rerender();
      }
    } finally { this.loading = false; }
  },
  extras(rerender) { return this.loadBooks(rerender); },
  secs(hours) { const s = hours * 3600; return s <= 0 ? '–' : s < 100 ? fmt.dec(s, 1) + 's' : IC.views.skilling.dur(hours); },
  steps(r) {
    const how = r.acc.tasks.slice().reverse().map((t) => `${this.VERB[t.skill] || IC.skillName(t.skill)} ${IC.taskName(t)}`);
    const buys = [...r.acc.buys].map(([id, q]) => `${fmt.dec(q, 2)}× ${IC.itemName(id)}`);
    return (r.route === 'buy' ? [] : [...(buys.length ? ['Buy ' + buys.join(', ')] : []), ...how]).join(' → ');
  },
  tags(r) {
    return (r.missing.length ? `<span class="tag warn">needs ${esc(IC.ui.reqText(r.missing))}</span>` : '')
      + (r.acc.unknown.length ? `<span class="tag" title="${esc(r.thin.join('. '))}. Checking the deeper sell offers…">checking supply</span>` : r.thin.length ? `<span class="tag warn" title="${esc(r.thin.join('. '))}. The price shown assumes the rest can be had at the dearest visible offer.">not enough on sale</span>` : '')
      + (r.eff < r.food.heal ? `<span class="tag warn" title="Heals ${r.food.heal}, but at your eat threshold only ${r.eff} health is missing, so the rest is wasted.">wastes ${r.food.heal - r.eff}</span>` : '');
  },
  render(el) {
    const p = IC.data.profile, o = this.opt(), D = IC.views.dps, game = IC.data.game;
    this.up = { fish: this.tier('theFisherman', 3, 20), forage: this.tier('powerForager', 9, 10), seeds: this.tier('farmingTrickery', 8, 10), autoCook: this.tier('mostEfficientFisherman', 11, 10) };
    const U = this.up, u = (p && p.upgrades) || {};
    const hp = IC.levels ? IC.levels.health : 0;
    // What an hour is worth: the best money-maker the character can do that actually sells, unless the player sets a number.
    const best = IC.allTaskRows().filter((r) => r.can.ok && r.profitHr > 0 && !r.thin).sort((a, b) => b.profitHr - a.profitHr)[0];
    const autoRate = best ? Math.round(best.profitHr) : 0, rate = o.rate !== '' && +o.rate >= 0 ? +o.rate : autoRate;
    // The enemy and gear set up on the DPS Calculator tab tell how much healing a fight uses.
    let m = null, r = null;
    if (p) {
      if (!D.state.monster) D.state.monster = IC.store.get('dpsMonster', '') || game.monsters[0].key;
      m = D.monster(); r = IC.combat.calc(D.gearFor(), IC.levels, m, D.opts());
    }
    const takenHr = r ? r.takenHr : 0;
    const all = this.rows(o, hp, rate, takenHr);
    const shown = all.filter((x) => (o.ignore || !x.missing.length) && x.food.heal >= (+o.minHeal || 0));
    const by = (route) => shown.filter((x) => x.route === route);
    // Best three foods overall: each food by its cheapest route, all costs counted.
    const perFood = new Map();
    for (const x of shown.slice().sort((a, b) => a.allIn - b.allIn)) if (!perFood.has(x.food.id)) perFood.set(x.food.id, x);
    const top = [...perFood.values()].slice(0, 3);
    // Rows near the top of any list whose prices rest on a first offer too small for the order: fetch their sell offers.
    const lead = (list) => list.slice().sort((a, b) => a.allIn - b.allIn).slice(0, 6);
    this.want = [...lead(by('scratch')), ...lead(by('cook')), ...lead(by('buy')), ...top].flatMap((x) => x.acc.unknown);
    const room = hp ? Math.max(1, Math.floor(hp * (1 - o.thresh / 100))) : 0, eatAt = hp ? Math.ceil(hp * o.thresh / 100) : 0;
    const big = shown.length ? Math.max(...shown.map((x) => x.food.heal)) : 0;

    // Food the chosen enemy drops (raw meat is cooked by Keep it burning when the Cooking level allows).
    const drops = [];
    if (m && r) {
      const rolls = m.lootEvery ? r.dmgHr / m.lootEvery : r.kills;
      for (const l of m.loot) {
        const it = game.items[l.id]; if (!it) continue;
        const cook = it.heal > 0 ? null : game.tasks.find((t) => t.skill === 'cooking' && t.costs.length === 1 && t.costs[0].id === l.id && t.costs[0].amt === 1 && (game.items[t.mainOut] || {}).heal > 0);
        if (!(it.heal > 0) && !cook) continue;
        const food = cook ? game.items[cook.mainOut] : it;
        drops.push({ raw: l.id, food, cook, perHr: rolls * l.chance * l.avg, can: !cook || IC.canDo(cook).ok });
      }
    }
    const dropHeal = drops.reduce((a, d) => a + d.perHr * d.food.heal, 0);

    const card = (x, i) => `<div class="card stat"><div class="label">#${i + 1} overall · ${esc(this.ROUTES[x.route])}</div><div class="value">${IC.ui.itemLink(x.food.id)}</div>
      <div><b>${fmt.dec(x.allIn, 1)}</b> gold per health, time included${this.tags(x)}</div>
      <div class="muted small">Heals ${x.food.heal} · ${fmt.int(x.gold)} gold${x.hours ? ` and ${this.secs(x.hours)}` : ''} a piece${this.steps(x) ? `<br>${esc(this.steps(x))}` : ''}
      <br>For ${fmt.int(o.target)} health: ${fmt.int(x.pieces)} pieces, ${fmt.short(x.totGold)} gold${x.hours ? `, ${IC.views.skilling.dur(x.totHours)}` : ''}${x.eatHr ? `<br>Fighting ${esc(IC.pretty(m.key))}: ${fmt.dec(x.eatHr, 1)} eaten per hour, ${fmt.short(x.eatHr * x.gold)} gold per hour` : ''}</div></div>`;

    el.innerHTML = `<h2>Food</h2>
      <p class="muted">Every food in the game, three ways to get it, ranked by what a point of health really costs you: the gold you pay plus the time you spend, with that time priced at what you could earn instead.</p>
      ${p ? '' : IC.ui.needUser()}
      <div class="controls">
        <label title="How much healing you want to stock up on. The totals in the tables are for this amount.">Health to restore <input type="number" id="fTarget" min="1" step="100" value="${esc(o.target)}"></label>
        <label title="Used to turn time into gold. Leave empty to use your best money-making task that sells reliably${best ? `: ${esc(IC.taskName(best.task))}` : ''}. Set 0 to rank by gold only.">An hour of my time is worth <input type="number" id="fRate" min="0" step="1000" placeholder="${autoRate}" value="${esc(o.rate)}" style="width:110px"> gold</label>
        <label title="Instant: the cheapest sell offer on the market right now. Patient: your own buy offer, 1 gold above the highest current one, which is cheaper but has to wait for sellers.">Buy price <select id="fBuy"><option value="ask" ${o.buy === 'ask' ? 'selected' : ''}>Instant (lowest sell offer)</option><option value="bid" ${o.buy === 'bid' ? 'selected' : ''}>Patient (my own buy offer)</option></select></label>
      </div>
      <div class="controls">
        <label title="Ticked: foods and ingredients you cannot fish, forage, farm or cook yet are listed too, with the levels they need."><input type="checkbox" id="fIgnore" ${o.ignore ? 'checked' : ''}> Ignore my skill levels</label>
        <label title="Auto eating is set to eat once your health falls under this share of the maximum. A food that heals more than is missing by then wastes the rest.">Auto-eat threshold <input type="number" id="fThresh" min="1" max="99" value="${esc(o.thresh)}" style="width:70px"> %</label>
        <label title="Hide foods that heal less than this per piece.">Smallest heal worth using <input type="number" id="fMin" min="0" max="${big || 30}" value="${esc(+o.minHeal || 0)}" style="width:70px"></label>
        <label title="Total skilling speed boost from tools, upgrades, clan and potions. Shared with the Skilling tab and Settings.">Speed boost <input type="number" id="fSpeed" min="0" max="500" value="${IC.settings.speedBoost}" style="width:70px"> %</label>
      </div>
      <h3>Best three overall</h3>
      <div class="grid">${top.length ? top.map(card).join('') : '<p class="muted">No food matches these settings.</p>'}</div>
      ${p ? `<div class="cols">
        <div class="card"><h3>What suits ${esc(p.username)}</h3><table><tbody>
          <tr><td class="muted">Health level, taken as maximum health</td><td class="num"><b>${hp}</b></td></tr>
          <tr><td class="muted">Eats at or below</td><td class="num"><b>${eatAt} health</b></td></tr>
          <tr><td class="muted">Biggest heal that is never wasted</td><td class="num"><b>${room}</b></td></tr>
          <tr><td class="muted">Biggest heal you can ${o.ignore ? 'get' : 'make or buy'}</td><td class="num"><b>${big}</b></td></tr>
        </tbody></table>
        <p class="muted small">${room >= big ? `Nothing in the game overheals at a ${esc(o.thresh)}% threshold, so price per health decides.` : `At a ${esc(o.thresh)}% threshold only ${room} health is missing when you eat. Bigger foods are counted at ${room} and marked.`} ${u.autoEating > 0 ? '' : 'You do not own Auto eating yet (Local market, 100,000 gold).'} ${u.pickyEater > 0 ? 'Picky eater picks the food closest to your missing health, so carrying a small and a large food wastes the least.' : 'Without Picky eater (10M gold, Cooking 90) food is eaten in inventory order, so one food type at a time works best.'}</p></div>
        <div class="card"><h3>Fighting <select id="fMon">${game.monsters.slice().sort((a, b) => a.lvl - b.lvl).map((x) => `<option value="${esc(x.key)}" ${x.key === m.key ? 'selected' : ''}>${esc(IC.pretty(x.key))} (lvl ${x.lvl})</option>`).join('')}</select></h3><table><tbody>
          <tr><td class="muted">Damage you take per hour</td><td class="num"><b>${fmt.int(takenHr)}</b></td></tr>
          <tr><td class="muted">Its hardest hit</td><td class="num"><b>${r.enemy.max}</b>${hp && r.enemy.max >= eatAt ? '<span class="tag warn" title="A hit this size from just above your eat threshold would kill you. Raise the threshold.">over your threshold</span>' : ''}</td></tr>
          ${top[0] ? `<tr><td class="muted">${esc(IC.itemName(top[0].food.id))} eaten per hour</td><td class="num"><b>${fmt.dec(top[0].eatHr, 1)}</b></td></tr>
          <tr><td class="muted">Hours of fighting from ${fmt.int(o.target)} health</td><td class="num"><b>${takenHr > 0 ? fmt.dec(o.target / takenHr, 1) : '–'}</b></td></tr>` : ''}
          <tr><td class="muted">Healing it drops per hour</td><td class="num"><b>${fmt.int(dropHeal)}</b>${takenHr > 0 && dropHeal > 0 ? ` <span class="muted small">${fmt.pct(dropHeal / takenHr, 0)} of what you take</span>` : ''}</td></tr>
        </tbody></table>
        <p class="muted small">${drops.length ? drops.map((d) => `${fmt.dec(d.perHr, 1)}× ${esc(IC.itemName(d.raw))} per hour${d.cook ? ` (${d.food.heal} health each once cooked${d.can ? '' : `, needs Cooking ${d.cook.level}`})` : ''}`).join(', ') + '. ' + (drops.some((d) => d.cook) ? (u.keepItBurning > 0 ? 'Keep it burning cooks the meat for you as it drops.' : 'The Keep it burning upgrade would cook the meat as it drops.') : '') : 'This enemy drops no food.'} Uses the gear and boosts set on the DPS Calculator tab. Keep the threshold comfortably above its hardest hit.</p></div>
      </div>` : ''}
      <h3>1. Make it yourself from scratch</h3>
      <p class="muted small">You fish, forage or farm every ingredient and cook it. Only what cannot be gathered (seeds, bait, meat from combat) is bought.</p><div id="fScratch"></div>
      <h3 style="margin-top:16px">2. Buy the ingredients and cook</h3>
      <p class="muted small">Raw ingredients come from the market; you only spend the cooking time.</p><div id="fCook"></div>
      <h3 style="margin-top:16px">3. Buy it ready to eat</h3>
      <p class="muted small">No time at all, just gold.</p><div id="fBuyT"></div>
      <h3 style="margin-top:16px">Every food</h3><div id="fAll"></div>
      <p class="muted small" style="margin-top:10px">Each table starts on its best five; press Show more for the rest, or click a heading to sort. "Gold / health, time included" is (gold paid + hours spent × ${fmt.int(rate)} gold) ÷ health healed. ${o.rate === '' ? `That hourly figure is ${best ? `what ${esc(IC.taskName(best.task))} earns you` : 'zero because no profitable task was found'}; type your own to change it.` : ''} Applied from your profile: ${[U.fish ? `The fisherman (${fmt.pct(U.fish, 0)} double catch)` : '', U.forage ? `Power forager (${fmt.pct(U.forage, 0)} double loot)` : '', U.seeds ? `Farming trickery (${fmt.pct(U.seeds, 0)} seeds saved)` : '', U.autoCook ? `Most efficient fisherman (${fmt.pct(U.autoCook, 0)} cooked as caught)` : ''].filter(Boolean).join(', ') || 'no food-related upgrades'}. Not counted: the Chef's hat (+20% healing), skilling gloves (5% double loot), and the XP you earn while making food, which is shown but not valued. Maximum health is taken to equal your Health level, and the wiki does not say how fast food can be eaten, so very small foods may not keep up with hard-hitting enemies. Market prices are what the whole quantity would cost working up through the current sell offers, not just the cheapest one, so they change with the amount of health you ask for; "not enough on sale" means even all the visible offers fall short.</p>`;

    const route = (id, rows, empty) => IC.ui.table(el.querySelector(id), {
      rows, sort: 5, dir: 1, limit: 5, rowClass: (x) => (x.missing.length ? 'locked' : ''), empty,
      cols: [
        { label: 'Food', val: (x) => IC.itemName(x.food.id), html: (x) => `${IC.ui.itemLink(x.food.id)}${this.tags(x)}${this.steps(x) ? `<div class="muted small">${esc(this.steps(x))}</div>` : ''}` },
        { label: 'Heals', num: true, val: (x) => x.food.heal, html: (x) => (hp ? `${x.food.heal} <span class="muted small">${fmt.pct(x.food.heal / hp, 0)}</span>` : x.food.heal), title: 'Health per piece, and as a share of your maximum health' },
        { label: 'Gold each', num: true, val: (x) => x.gold, html: (x) => fmt.int(x.gold), title: 'Gold paid per piece' },
        { label: 'Time each', num: true, val: (x) => x.hours, html: (x) => this.secs(x.hours), title: 'Your time per piece, at the speed boost above' },
        { label: 'Gold / health', num: true, val: (x) => x.gPerHp, html: (x) => fmt.dec(x.gPerHp, 1), title: 'Gold paid per health point, time not counted' },
        { label: 'Gold / health, time included', num: true, val: (x) => x.allIn, html: (x) => `<b>${fmt.dec(x.allIn, 1)}</b>`, title: 'Gold paid plus your time at the hourly value above, per health point. Lower is better.' },
        { label: 'Pieces', num: true, val: (x) => x.pieces, html: (x) => fmt.int(x.pieces), title: `Pieces for ${fmt.int(o.target)} health` },
        { label: 'Total gold', num: true, val: (x) => x.totGold, html: (x) => fmt.short(x.totGold), title: `Gold for ${fmt.int(o.target)} health` },
        { label: 'Total time', num: true, val: (x) => x.totHours, html: (x) => (x.totHours ? IC.views.skilling.dur(x.totHours) : '–'), title: `Your time for ${fmt.int(o.target)} health` },
        { label: 'XP each', num: true, val: (x) => x.xp, html: (x) => (x.xp ? fmt.dec(x.xp, 0) : '–'), title: 'Skill XP earned per piece, all skills together' },
        ...(takenHr > 0 ? [{ label: 'Eaten/hr', num: true, val: (x) => x.eatHr, html: (x) => fmt.dec(x.eatHr, 1), title: `Pieces eaten per hour fighting ${IC.pretty(m.key)}` }] : []),
      ],
    });
    const none = o.ignore ? 'No food can be had this way at current prices.' : 'Nothing here is within your levels. Tick "Ignore my skill levels" to see what you are working towards.';
    route('#fScratch', by('scratch'), none); route('#fCook', by('cook'), none); route('#fBuyT', by('buy'), 'No food is on sale right now.');

    // Every food side by side, including the ones hidden above.
    const foods = [...new Set(all.map((x) => x.food))].map((food) => {
      const get = (rt) => all.find((x) => x.food === food && x.route === rt) || null;
      const f = { food, scratch: get('scratch'), cook: get('cook'), buy: get('buy'), task: this.pickTask(food.id, 'scratch'), pr: IC.data.prices.get(food.id) || {} };
      f.best = [f.scratch, f.cook, f.buy].filter((x) => x && (o.ignore || !x.missing.length)).sort((a, b) => a.allIn - b.allIn)[0] || null;
      return f;
    });
    const cell = (k) => ({ num: true, val: (f) => (f[k] ? f[k].allIn : null), html: (f) => (f[k] ? `<span class="${f[k] === f.best ? 'good' : f[k].missing.length ? 'muted' : ''}" title="${esc(f[k].missing.length ? 'Needs ' + IC.ui.reqText(f[k].missing) : '')}">${fmt.dec(f[k].allIn, 1)}</span>` : '–') });
    IC.ui.table(el.querySelector('#fAll'), {
      rows: foods, sort: 1, dir: 1, limit: 60,
      cols: [
        { label: 'Food', val: (f) => IC.itemName(f.food.id), html: (f) => IC.ui.itemLink(f.food.id) },
        { label: 'Heals', num: true, val: (f) => f.food.heal, html: (f) => f.food.heal },
        { label: 'Made with', val: (f) => (f.task ? f.task.level : null), html: (f) => (f.task ? `<span class="${IC.canDo(f.task).ok ? '' : 'warn'}">${esc(IC.skillName(f.task.skill))} ${f.task.level}</span>` : '<span class="muted">not craftable</span>'), title: 'Skill and level for the final step' },
        { label: 'Sell offer', num: true, val: (f) => f.pr.lowestSellPrice || null, html: (f) => fmt.int(f.pr.lowestSellPrice || null), title: 'Cheapest sell offer on the market' },
        { label: 'Buy offer', num: true, val: (f) => f.pr.highestBuyPrice || null, html: (f) => fmt.int(f.pr.highestBuyPrice || null), title: 'Highest buy offer on the market' },
        { label: 'Traded / day', num: true, val: (f) => IC.vol7(f.food.id) / 7, title: 'Average units traded per day over the last week' },
        Object.assign({ label: 'Scratch', title: 'Gold per health, time included, making it from scratch' }, cell('scratch')),
        Object.assign({ label: 'Cook', title: 'Gold per health, time included, buying the ingredients and cooking' }, cell('cook')),
        Object.assign({ label: 'Buy', title: 'Gold per health buying it ready to eat' }, cell('buy')),
        { label: 'Best way', val: (f) => (f.best ? this.ROUTES[f.best.route] : null), html: (f) => (f.best ? esc(this.ROUTES[f.best.route]) : '<span class="muted">out of reach</span>') },
      ],
    });

    const again = () => { this.render(el); this.loadBooks(() => { if (IC.currentView === 'food') this.render(el); }); };
    const save = (k, v) => { const s = this.opt(); s[k] = v; IC.store.set('food', s); again(); };
    const $ = (id) => el.querySelector(id);
    $('#fTarget').onchange = (e) => save('target', Math.max(1, Math.round(+e.target.value) || 10000));
    $('#fRate').onchange = (e) => save('rate', e.target.value === '' ? '' : Math.max(0, +e.target.value || 0));
    $('#fBuy').onchange = (e) => save('buy', e.target.value);
    $('#fIgnore').onchange = (e) => save('ignore', e.target.checked);
    $('#fThresh').onchange = (e) => save('thresh', Math.min(99, Math.max(1, Math.round(+e.target.value) || 50)));
    $('#fMin').onchange = (e) => save('minHeal', Math.max(0, +e.target.value || 0));
    $('#fSpeed').onchange = (e) => { IC.settings.speedBoost = Math.max(0, +e.target.value || 0); IC.saveSettings(); again(); };
    if ($('#fMon')) $('#fMon').onchange = (e) => { D.state.monster = e.target.value; IC.store.set('dpsMonster', D.state.monster); again(); };
  },
};
