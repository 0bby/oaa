// Specialist test: Lua only reads KV keys that exist. GetSpecialValueFor on a
// missing key silently returns 0 in game, and no other test sees it.
// Replaces the stale scripts/check-lua-kv.js (it still reads AbilitySpecial).
// Scope: a ScriptFile's self:/ability:/GetAbility(): reads, checked against
// the entry's AbilityValues (plus vanilla parent keys).
const test = require('tape');
const fs = require('fs');
const path = require('path');
const { ROOT, oaaEntries, vanilla, issues, kv } = require('./oaa-lib');
const { getCI } = require('../dota-patch/port-core');

const READ = /(?:\bself|\bability|GetAbility\(\))\s*:\s*(?:GetSpecialValueFor|GetLevelSpecialValueFor)\s*\(\s*["']([A-Za-z0-9_]+)["']/g;
const ALWAYS = new Set(['AbilityCooldown', 'AbilityManaCost', 'AbilityCastRange', 'AbilityDuration', 'AbilityDamage', 'AbilityChargeRestoreTime', 'AbilityCharges']);

test('Lua reads only KV keys that exist', async function (t) {
  const v = (await vanilla()).entries;
  const all = Object.assign({}, oaaEntries('items'), oaaEntries('abilities'));
  const byScript = {};
  Object.keys(all).forEach(name => {
    const sf = kv.child(all[name].node, 'ScriptFile');
    if (!sf) return;
    const f = path.join(ROOT, 'game', 'scripts', 'vscripts', sf.value.replace(/\.lua$/, '') + '.lua');
    (byScript[f] = byScript[f] || []).push(name);
  });
  const log = issues(t, 'lua-kv-keys');
  let checked = 0;
  Object.keys(byScript).sort().forEach(f => {
    if (!fs.existsSync(f)) return; // "script file referenced from kv exists" covers this
    const lua = fs.readFileSync(f, 'utf8');
    const keys = new Set();
    let m;
    while ((m = READ.exec(lua))) keys.add(m[1]);
    if (!keys.size) return;
    // keys any entry using this file defines
    const defined = new Set(ALWAYS);
    byScript[f].forEach(name => {
      const node = all[name].node;
      const av = kv.child(node, 'AbilityValues');
      (av && av.children ? av.children : []).forEach(c => defined.add(c.key));
      const base = (kv.child(node, 'BaseClass') || {}).value;
      [name, base].forEach(p => {
        const vav = getCI(v[p], 'AbilityValues');
        if (vav) Object.keys(vav).forEach(k => defined.add(k));
      });
    });
    const rel = path.relative(ROOT, f).split(path.sep).join('/');
    keys.forEach(k => {
      checked++;
      if (!defined.has(k)) log.report(rel + ':' + k, rel + ' reads "' + k + '" but ' + byScript[f].join(', ') + ' has no such key (returns 0 in game)');
    });
  });
  log.done();
  t.pass('checked ' + checked + ' Lua key reads');
  t.end();
});
