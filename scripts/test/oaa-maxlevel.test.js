// Specialist test: every scaling vanilla ability OAA overrides has 2 OAA levels
// (MaxLevel = vanilla + 2). Recurring after ports: 7.36 (e3eb4db91),
// 7.40 (87245e225), 7.41 (da70e319e, 92b234cdd).
// Opt out with an OAA comment on MaxLevel, e.g.  "MaxLevel" "1" // OAA, innate in OAA
const test = require('tape');
const { oaaEntries, vanilla, issues, kv } = require('./oaa-lib');
const { vanillaLevels } = require('../dota-patch/port-core');

test('OAA levels: MaxLevel is vanilla + 2', async function (t) {
  const v = (await vanilla()).entries;
  const oaa = oaaEntries('abilities');
  const log = issues(t, 'maxlevel');
  let checked = 0;
  Object.keys(oaa).sort().forEach(name => {
    const vn = v[name];
    if (!vn || name.startsWith('special_bonus_')) return;
    const vLv = vanillaLevels(vn, name);
    if (vLv <= 1) return;
    const { file, node } = oaa[name];
    const ml = kv.child(node, 'MaxLevel');
    if (ml && /OAA/.test(ml.comment)) return;
    const base = kv.child(node, 'BaseClass');
    if (base && /_datadriven$|_lua$/.test(base.value)) return; // custom: own level rules
    const got = ml ? parseInt(ml.value, 10) : vLv;
    checked++;
    if (got !== vLv + 2) {
      log.report(name, name + ' (' + file + '): MaxLevel ' + got + ', expected ' + (vLv + 2) + ' (vanilla ' + vLv + ' + 2 OAA levels)');
    }
  });
  log.done();
  t.pass('checked ' + checked + ' scaling abilities');
  t.end();
});
