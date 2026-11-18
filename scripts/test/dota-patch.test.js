const test = require('tape');
const kv = require('../dota-patch/kv-text');
const { portValue } = require('../dota-patch/extrapolate');
const { portFile } = require('../dota-patch/port-core');

test('kv-text keeps the file byte for byte when nothing changes', function (t) {
  const src = '"DOTAAbilities"\n{\n  "x" // OAA, intentionally\n  {\n    "AbilityValues"\n    {\n      "a"   "1 2 3" // c\n    }\n  }\n}\n';
  const root = kv.parse(src);
  const ed = new kv.Editor(src);
  t.equal(ed.apply(), src);
  const x = kv.entries(root)[0];
  t.equal(x.key, 'x');
  t.equal(x.comment, 'OAA, intentionally');
  t.equal(kv.child(kv.child(x, 'AbilityValues'), 'a').comment, 'c');
  t.end();
});

test('portValue rules (cases taken from real OAA ports)', function (t) {
  const cases = [
    // [vanilla old, vanilla new, OAA old, expected OAA new, rule]
    ['+2', '+2.5', '+2', '+2.5', 'copy'],
    ['2 3 4 5', '3 4 5 6', '2 3 4 5 6 7', '3 4 5 6 7 8', 'linear'],
    ['110 170 230 290', '100 160 220 280', '110 170 230 290 580 1160', '100 160 220 280 560 1120', 'ratio'],
    ['25 35 45 55', '30 40 50 60', '25 35 45 55 155 255', '30 40 50 60 160 260', 'offset'],
    ['1.4 1.6 1.8', '1.2 1.4 1.6', '1.4 1.6 1.8 2.0 2.2', '1.2 1.4 1.6 1.8 2.0', 'linear'],
    ['600 625 650 675', '700', '600 625 650 675 700 725', '700', 'collapse']
  ];
  cases.forEach(c => {
    const r = portValue(c[0], c[1], c[2], { vanillaLevels: 4, oaaLevels: 6 });
    t.equal(r.value, c[3], c[2] + ' -> ' + c[3]);
    t.equal(r.rule, c[4]);
  });
  t.ok(portValue('16 14 12 10', '14 13 12 11', '15 14 13 12 11 10', {}).skip, 'skips values OAA already diverged on');
  t.end();
});

test('portFile ports values, renames and adds keys, respects comments', function (t) {
  const oaa = [
    '"DOTAAbilities"',
    '{',
    '  "foo_bolt"',
    '  {',
    '    "AbilityManaCost"                                     "100 110 120 130 140 150"',
    '    "AbilityValues"',
    '    {',
    '      "damage"                                            "100 200 300 400 800 1600"',
    '      "slow"                                              "10 20 30 40 50 60" // OAA, intentionally buffed',
    '      "old_name"                                          "5"',
    '    }',
    '  }',
    '}',
    ''
  ].join('\n');
  const vanOld = { foo_bolt: { MaxLevel: '4', AbilityManaCost: '100 110 120 130', AbilityValues: { damage: '100 200 300 400', slow: '5 10 15 20', old_name: '5' } } };
  const vanNew = { foo_bolt: { MaxLevel: '4', AbilityManaCost: '90 100 110 120', AbilityValues: { damage: '120 220 320 420', slow: '6 12 18 24', new_name: '5', radius: '300' } } };
  const r = portFile(oaa, { vanOld, vanNew });
  t.ok(r.text.includes('"90 100 110 120 130 140"'), 'mana cost continues the step');
  t.ok(r.text.includes('"120 220 320 420 840 1680"'), 'damage keeps the x2/x4 OAA levels');
  t.ok(r.text.includes('"10 20 30 40 50 60" // OAA, intentionally buffed'), 'protected value untouched');
  t.ok(r.text.includes('"new_name"'), 'renamed key');
  t.notOk(r.text.includes('"old_name"'), 'old key gone');
  t.ok(/"radius"\s+"300"/.test(r.text), 'new key added');
  t.ok(r.actions.some(a => a.kind === 'protected'), 'protected logged for review');
  t.ok(kv.entries(kv.parse(r.text)).length === 1, 'result still parses');
  t.end();
});

test('audit flags missing OAA levels and flattened OAA levels', function (t) {
  const { auditLevels } = require('../dota-patch/audit');
  const text = [
    '"DOTAAbilities"', '{', '  "foo_nova"', '  {', '    "MaxLevel"   "6"', '    "AbilityValues"', '    {',
    '      "damage"   "100 200 300 400 400 400"', '      "slow"   "10 20 30 40"', '      "radius"   "300 350 400 450 450 450"',
    '    }', '  }', '}', ''
  ].join('\n');
  const out = [];
  auditLevels(text, 'abilities/foo_nova.txt', { vanNew: { foo_nova: { MaxLevel: '4' } } }, out);
  t.ok(out.some(f => f.kind === 'plateau' && f.path === 'damage'), 'damage plateau flagged');
  t.ok(out.some(f => f.kind === 'missing-oaa-levels' && f.path === 'slow'), 'slow missing OAA levels');
  t.notOk(out.some(f => f.path === 'radius'), 'flat radius is fine');
  t.end();
});
