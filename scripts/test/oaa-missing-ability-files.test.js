// Specialist test: every scaling ability in an enabled hero's vanilla slots has
// an OAA file (so it gets OAA levels), unless the OAA hero file replaces the slot.
// Catches new vanilla abilities after a patch (7.42: Undying Bite, Chen Anoint...).
const test = require('tape');
const { oaaEntries, vanilla, enabledHeroes, issues, kv } = require('./oaa-lib');
const { parseTokens } = require('../dota-patch/extrapolate');

// really scales: learnable, and has a per-level value or an explicit MaxLevel > 1
function scales (e) {
  const beh = getCI(e, 'AbilityBehavior') || '';
  if (/HIDDEN|NOT_LEARNABLE|INNATE_UI/.test(beh)) return false;
  if (parseInt(getCI(e, 'MaxLevel'), 10) > 1) return true;
  const av = getCI(e, 'AbilityValues') || {};
  return Object.keys(av).some(k => {
    const val = typeof av[k] === 'string' ? av[k] : av[k].value;
    const tk = parseTokens(val);
    return tk && tk.length > 1;
  });
}
const { vanillaLevels, getCI } = require('../dota-patch/port-core');

test('OAA levels: scaling hero abilities have an OAA file', async function (t) {
  const v = (await vanilla()).entries;
  const abilities = oaaEntries('abilities');
  const heroes = oaaEntries('heroes');
  const enabled = enabledHeroes();
  const log = issues(t, 'missing-ability-files');
  let checked = 0;
  [...enabled].sort().forEach(hero => {
    const vh = v[hero];
    if (!vh) return;
    const oh = heroes[hero] && heroes[hero].node;
    for (let i = 1; i <= 9; i++) {
      const slot = 'Ability' + i;
      const name = getCI(vh, slot);
      if (!name || name === 'generic_hidden' || !v[name]) continue;
      const override = oh && kv.child(oh, slot);
      if (override && override.value !== name) continue; // OAA replaced this slot
      if (vanillaLevels(v[name], name) <= 1 || !scales(v[name])) continue;
      checked++;
      if (!abilities[name]) log.report(name, hero + ' ' + slot + ': ' + name + ' scales in vanilla but has no OAA file, so it has no OAA levels');
    }
  });
  log.done();
  t.pass('checked ' + checked + ' hero ability slots');
  t.end();
});
