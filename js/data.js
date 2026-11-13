// Data layer: loads game config, item names, market prices and the player profile, and does the pricing maths.
IC.data = { game: null, names: null, prices: new Map(), summary: new Map(), profile: null, ranks: null, holiday: null };
IC.GOLD = 19;
const MIN = 60000, HOUR = 3600000;
const GAME_V = 2; // bump when slimGame's output shape changes, so cached copies are rebuilt

// ---------- game config ----------
// The endpoint returns MongoDB shell-style JSON (ObjectId("...") etc.), so it is cleaned before parsing.
function parseGameData(text) {
  // Depending on content negotiation the body is either the raw document or that document as a JSON string.
  if (text.trimStart().startsWith('"')) text = JSON.parse(text);
  const clean = text
    .replace(/ObjectId\(\s*("[^"]*")\s*\)/g, '$1')
    .replace(/ISODate\(\s*("[^"]*")\s*\)/g, '$1')
    .replace(/Number(?:Long|Int|Decimal)\(\s*"?(-?[\d.]+)"?\s*\)/g, '$1');
  return slimGame(JSON.parse(clean));
}

function normLoot(list, scale = 1) {
  if (!list || !list.length) return [];
  const sum = list.reduce((a, l) => a + (l.Weight || 0), 0);
  const div = sum > 100.5 ? sum : 100; // weights are percentages unless a table overshoots 100
  return list.map((l) => {
    const min = l.ItemAmountMin || 1, max = Math.max(l.ItemAmountMax || 1, min);
    return { id: l.ItemId, chance: (l.Weight / div) * scale, min, max, avg: (min + max) / 2 };
  });
}

function slimGame(g) {
  const items = [];
  for (const i of g.Items.Items) {
    items[i.ItemId] = {
      id: i.ItemId, key: i.Name, base: i.BaseValue || 0, noShop: !!i.CanNotBeSoldToGameShop, noTrade: !!i.CanNotBeTraded,
      buyLimit: i.PlayerMarketBuyLimit || 0, dead: !!(i.Discontinued || i.Unobtainable), twoHanded: !!i.TwoHanded,
      interval: i.AttackInterval || 0, req: i.LevelRequirement && i.LevelRequirement.Level ? { skill: IC.skillById(i.LevelRequirement.Skill), level: i.LevelRequirement.Level } : null,
      stats: {
        str: i.StrengthBonus || 0, acc: i.AccuracyBonus || 0, aStr: i.ArcheryStrengthBonus || 0, aAcc: i.ArcheryAccuracyBonus || 0,
        mStr: i.MagicStrengthBonus || 0, mAcc: i.MagicAccuracyBonus || 0, def: i.DefenceBonus || 0, aDef: i.ArcheryDefenceBonus || 0, mDef: i.MagicDefenceBonus || 0,
      },
    };
  }
  const tasks = [], monsters = [];
  for (const [skillName, groups] of Object.entries(g.Tasks)) {
    for (const grp of groups) {
      for (const t of grp.Items || []) {
        if (t.Disabled || t.Hidden) continue;
        if (skillName === 'Combat') {
          if (!t.EnemyHealth) continue;
          monsters.push({
            id: t.TaskId, key: t.Name, zone: grp.CustomId || '', hp: t.EnemyHealth, boss: !!t.IsBoss, keyId: t.IsBoss && t.ItemIdRequired > 0 ? t.ItemIdRequired : null,
            def: t.EnemyDefenceLevel || 0, atk: Math.max(t.EnemyRigourLevel || 0, t.EnemyArcheryLevel || 0, t.EnemyMagicLevel || 0), loot: normLoot(t.Loot),
          });
          continue;
        }
        if (!(t.BaseTime > 0)) continue; // enchanting scrolls etc. have no fixed cycle
        const skill = IC.skillById(t.Skill) || skillName.toLowerCase();
        // Plundering only pays out on a successful attempt; the chance depends on the player (see IC.successChance).
        const plunder = (t.PlunderingLoot || []).length > 0;
        const out = [];
        if (t.ItemReward >= 0 && t.ItemAmount > 0) out.push({ id: t.ItemReward, amt: t.ItemAmount });
        for (const l of normLoot(t.PlunderingLoot)) out.push({ id: l.id, amt: l.chance * l.avg, chance: l.chance, gated: true });
        for (const l of normLoot(t.Loot)) out.push({ id: l.id, amt: l.chance * l.avg, chance: l.chance });
        const reqs = [{ skill, level: t.LevelRequirement || 1 }];
        for (const r of t.AdditionalLevelRequirements || []) reqs.push({ skill: IC.skillById(r.Skill), level: r.Level });
        if (t.MagicLevelRequirement > 0) reqs.push({ skill: 'magic', level: t.MagicLevelRequirement });
        tasks.push({
          uid: skillName + ':' + t.TaskId + ':' + t.Name, key: t.Name, skill, group: skillName, level: t.LevelRequirement || 1, reqs, time: t.BaseTime, xp: t.ExpReward || 0,
          out, costs: (t.Costs || []).map((c) => ({ id: c.Item, amt: c.Amount })), mainOut: t.ItemReward >= 0 ? t.ItemReward : null,
          baseSuccess: plunder ? (t.BaseSuccessChancePercentage || 0) / 100 : null,
          adv: plunder ? (t.SkillAdvantages || []).map((a) => ({ skill: IC.skillById(a.Skill), cap: a.LevelCap })).filter((a) => a.skill && a.cap > 0) : [],
        });
      }
    }
  }
  const shop = {};
  for (const s of g.ShopItems.Items) if (s.ShopType === 0 && s.RewardType === 0 && s.Cost > 0) shop[s.EntityId] = s.Cost;
  const S = g.SharedSettings.Settings;
  return {
    v: GAME_V, items, tasks, monsters, shop,
    upgrades: g.Upgrades.Items.filter((u) => !u.Discontinued).map((u) => ({
      type: u.Type, tiers: u.Tiers || 0, bulk: !!u.CanPurchaseInBulk, names: u.TierNameLocKeys || [], values: u.TierUnlocks || [], costs: u.Costs || [],
      itemCosts: (u.ItemCosts || []).map((c) => ({ id: c.Item, amt: c.Amount })),
      reqs: (u.SkillRequirements || []).map((r) => ({ skill: IC.skillById(r.Skill), levels: r.Requirements || [] })),
    })),
    settings: { tax: S.PlayerShopTaxPercentage, offlineBase: S.BaseOfflineProgressCapHours, offlinePremium: S.OfflineHoursFromPremium, respawnMs: S.EnemyRespawnTimeMS, version: S.ConfigVersion },
  };
}

// ---------- loaders ----------
IC.loadBase = async function (force) {
  const D = IC.data;
  const [game, meta, prices] = await Promise.all([
    IC.api('/Configuration/game-data', { ttl: 12 * HOUR, text: true, transform: parseGameData, force: false }),
    IC.api('/Items/metadata', { ttl: 24 * HOUR }),
    IC.api('/PlayerMarket/items/prices/latest?includeAveragePrice=true', { ttl: 5 * MIN, force }),
  ]);
  D.game = game.v === GAME_V ? game : await IC.api('/Configuration/game-data', { ttl: 12 * HOUR, text: true, transform: parseGameData, force: true });
  D.names = new Map(meta.map((m) => [m.id, m]));
  D.prices = new Map(prices.map((p) => [p.itemId, p]));
  D.pricesTime = Date.now();
  // 7-day summary gives liquidity + a steadier average. Nice to have, so failures are tolerated.
  try {
    const sum = await IC.api('/PlayerMarket/items/prices/summary?period=7d', { ttl: 30 * MIN, force });
    D.summary = new Map(Object.values(sum).map((s) => {
      let v = 0, pv = 0;
      (s.prices || []).forEach((p, i) => { const vol = (s.volumes || [])[i] || 0; v += vol; pv += p * vol; });
      // Volume-weighted median: unlike the averages, one absurd trade cannot move it.
      const pts = (s.prices || []).map((p, i) => [p, (s.volumes || [])[i] || 0]).filter((x) => x[1] > 0).sort((a, b) => a[0] - b[0]);
      let med7 = 0, acc = 0;
      for (const [p, vol] of pts) { acc += vol; if (acc >= v / 2) { med7 = p; break; } }
      return [s.itemId, { vol7: s.tradeVolume || 0, avg7: v ? pv / v : 0, med7, last: s.lastTradeTimestamp, prices: s.prices || [] }];
    }));
  } catch (e) { D.summaryError = e.message; }
};

IC.loadProfile = async function (name, force) {
  const D = IC.data;
  D.profile = null; D.ranks = null; IC.levels = null;
  if (!name) return null;
  const p = await IC.api('/Player/profile/' + encodeURIComponent(name), { ttl: 2 * MIN, force });
  D.profile = p;
  IC.computeLevels();
  return p;
};
IC.computeLevels = function () {
  const p = IC.data.profile; if (!p) { IC.levels = null; return; }
  const over = IC.store.get('levels.' + p.username.toLowerCase(), {});
  IC.levels = {}; IC.xp = {};
  for (const s of IC.SKILLS) {
    const xp = (p.skillExperiences || {})[s] || 0;
    IC.xp[s] = xp;
    IC.levels[s] = over[s] || IC.levelForXp(xp);
  }
};
IC.totalLevel = () => IC.levels ? IC.SKILLS.reduce((a, s) => a + IC.levels[s], 0) : 0;

// ---------- names ----------
IC.itemName = function (id) {
  if (id === IC.GOLD) return 'Gold';
  const m = IC.data.names && IC.data.names.get(id);
  // About a third of items have no English name in the API and come back as their raw key.
  if (m && m.name) return m.name === m.nameLocKey || m.name.includes('_') ? IC.pretty(m.name) : m.name;
  const it = IC.data.game && IC.data.game.items[id];
  return it ? IC.pretty(it.key) : 'Item #' + id;
};
IC.taskName = (t) => (t.mainOut != null ? IC.itemName(t.mainOut) : IC.pretty(t.key));

// ---------- pricing ----------
IC.taxMult = () => 1 - ((IC.data.game && IC.data.game.settings.tax) || 1) / 100;
// What it costs to acquire one unit right now (cheapest of market listing and gold shop).
IC.buyCost = function (id) {
  if (id === IC.GOLD) return 1;
  const p = IC.data.prices.get(id), shop = IC.data.game.shop[id];
  let best = null;
  if (p && p.lowestSellPrice > 0) best = p.lowestSellPrice;
  if (shop && (best == null || shop < best)) best = shop;
  if (best == null && p && p.dailyAveragePrice > 0) best = p.dailyAveragePrice;
  if (best == null) { const s = IC.data.summary.get(id); if (s && s.avg7 > 0) best = s.avg7; }
  return best;
};
// What one unit is worth when sold. Returns { value, src } or null when nothing is known.
IC.sellValue = function (id, mode) {
  if (id === IC.GOLD) return { value: 1, src: 'gold' };
  mode = mode || IC.settings.sellMode;
  const it = IC.data.game.items[id], p = IC.data.prices.get(id), s = IC.data.summary.get(id);
  const shop = it && !it.noShop && it.base > 0 ? it.base : 0;
  let market = 0;
  if (it && !it.noTrade) {
    if (mode === 'instant') market = p ? p.highestBuyPrice || 0 : 0;
    else if (mode === 'list') market = p ? p.lowestSellPrice || p.dailyAveragePrice || 0 : 0;
    else if (mode === 'avg') {
      market = (p && p.dailyAveragePrice) || (s && s.avg7) || (p && p.lowestSellPrice) || 0;
      // A single outlier trade can inflate the averages a thousandfold; fall back to the 7-day median then.
      if (s && s.med7 > 0 && market > s.med7 * 3) market = s.med7;
    }
  }
  const net = market * IC.taxMult();
  if (mode === 'shop' || shop >= net) return shop > 0 ? { value: shop, src: 'shop' } : (net > 0 ? { value: net, src: 'market' } : null);
  return net > 0 ? { value: net, src: 'market' } : null;
};
IC.vol7 = (id) => { const s = IC.data.summary.get(id); return s ? s.vol7 : 0; };

// ---------- task maths ----------
IC.canDo = function (task) {
  if (!IC.levels) return { ok: true, missing: [] };
  const missing = task.reqs.filter((r) => r.skill && (IC.levels[r.skill] || 1) < r.level);
  return { ok: !missing.length, missing };
};
// Plundering success chance (0..1), or null for tasks that cannot fail.
// Fitted to in-game values: base + (100% - base) × average of level/cap over the task's advantage skills.
IC.successChance = function (task) {
  if (task.baseSuccess == null) return null;
  if (!IC.levels || !task.adv.length) return task.baseSuccess;
  const f = task.adv.reduce((a, x) => a + Math.min(IC.levels[x.skill] || 1, x.cap) / x.cap, 0) / task.adv.length;
  return task.baseSuccess + (1 - task.baseSuccess) * f;
};
IC.calcTask = function (task, mode) {
  const S = IC.settings;
  const success = IC.successChance(task);
  const perHr = (HOUR / task.time) * (1 + (S.speedBoost || 0) / 100);
  const xpHr = task.xp * perHr * (1 + (S.xpBoost || 0) / 100);
  let cost = 0, rev = 0, unknownIn = false, unknownOut = false, shopSold = false, minVolRatio = Infinity;
  for (const c of task.costs) {
    const price = IC.buyCost(c.id);
    if (price == null) unknownIn = true; else cost += price * c.amt;
  }
  for (const o of task.out) {
    const v = IC.sellValue(o.id, mode);
    if (!v) { if (o.id === task.mainOut) unknownOut = true; continue; }
    rev += v.value * o.amt * (o.gated ? success : 1);
    if (v.src === 'shop') shopSold = true;
    if (v.src === 'market' && o.id === task.mainOut) minVolRatio = Math.min(minVolRatio, IC.vol7(o.id) / (o.amt * perHr * 24));
  }
  const known = !unknownIn && !unknownOut;
  const profit = rev - cost;
  return {
    perHr, xpHr, costHr: cost * perHr, revHr: rev * perHr, profitHr: known ? profit * perHr : null, profitPer: known ? profit : null,
    goldPerXp: known && task.xp > 0 ? profit / (task.xp * (1 + (S.xpBoost || 0) / 100)) : null,
    unknownIn, unknownOut, shopSold, success,
    // "thin": the whole market trades less of this in a week than you would make in a day
    thin: minVolRatio < 1, vol7: task.mainOut != null ? IC.vol7(task.mainOut) : null,
    can: IC.canDo(task),
  };
};
IC.allTaskRows = function (mode) { return IC.data.game.tasks.map((t) => Object.assign({ task: t }, IC.calcTask(t, mode))); };

// Expected sale value of a loot table per roll.
IC.lootValue = function (loot, mode) {
  let gold = 0, items = 0;
  for (const l of loot) {
    if (l.id === IC.GOLD) { gold += l.chance * l.avg; continue; }
    const v = IC.sellValue(l.id, mode);
    if (v) items += l.chance * l.avg * v.value;
  }
  return { gold, items, total: gold + items };
};
