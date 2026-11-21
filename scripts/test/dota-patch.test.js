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

test('top-level keys vanilla deleted are removed; --safe holds invented OAA levels', function (t) {
  const oaa = [
    '"DOTAAbilities"',
    '{',
    '  "foo_lapse"',
    '  {',
    '    "AbilityCastRange"                                    "500" // for the scepter',
    '    "AbilityCooldown"                                     "120"',
    '    "AbilityValues"',
    '    {',
    '      "damage"                                            "100 200 300 400 500 600"',
    '      "radius"                                            "300"',
    '    }',
    '  }',
    '}',
    ''
  ].join('\n');
  const vanOld = { foo_lapse: { MaxLevel: '4', AbilityCastRange: '500', AbilityCooldown: '120', AbilityValues: { damage: '100 200 300 400', radius: '300' } } };
  const vanNew = { foo_lapse: { MaxLevel: '4', AbilityValues: { damage: '90 180 270 360', radius: '250', AbilityCooldown: '120' } } };
  const full = portFile(oaa, { vanOld, vanNew });
  t.notOk(full.text.includes('AbilityCastRange'), 'deleted top-level key removed');
  t.ok(full.text.includes('"AbilityCooldown"                                     "120"'), 'moved key is left for review, not deleted');
  t.ok(full.actions.some(a => a.path === 'AbilityCooldown' && a.kind === 'review' && /moved/.test(a.note)), 'move logged');
  const { isObjective } = require('../dota-patch/port-core');
  const byPath = p => full.actions.find(a => a.path === p);
  t.ok(isObjective(byPath('AbilityValues/radius')), 'vanilla copy is objective');
  t.ok(isObjective(byPath('AbilityCastRange')), 'top-level removal is objective');
  t.notOk(isObjective(byPath('AbilityValues/damage')), 'invented OAA levels are not objective');
  // --safe rebuilds the file from objective edits only
  const ed = new kv.Editor(oaa);
  full.actions.filter(isObjective).forEach(a => ed.edits.push(...a.edits));
  const safe = ed.apply();
  t.ok(/"radius"\s+"250"/.test(safe) && !safe.includes('AbilityCastRange'), 'safe: objective edits applied');
  t.ok(safe.includes('"100 200 300 400 500 600"'), 'safe: OAA-level value left alone');
  t.end();
});

test('OAA follows vanilla when it turns a value into a block or a block into a value', function (t) {
  const oaa = [
    '"DOTAAbilities"',
    '{',
    '  "foo_fence"',
    '  {',
    '    "AbilityValues"',
    '    {',
    '      "formation_time"',
    '      {',
    '        "value"                                           "1"',
    '      }',
    '      "chain_damage"                                      "180 230 330 480 680"',
    '    }',
    '  }',
    '}',
    ''
  ].join('\r\n');
  const vanOld = { foo_fence: { AbilityValues: { formation_time: { value: '1' }, chain_damage: '180' } } };
  const vanNew = { foo_fence: { AbilityValues: { formation_time: '0.5', chain_damage: { value: '180' } } } };
  const r = portFile(oaa, { vanOld, vanNew });
  t.ok(/\r\n {6}"formation_time" +"0\.5"\r\n {6}"chain_damage"\r\n {6}\{\r\n {8}"value" +"180 230 330 480 680"\r\n {6}\}\r\n/.test(r.text), 'block -> leaf and leaf -> block, CRLF kept');
  t.ok(r.actions.some(a => a.rule === 'block-to-leaf'), 'block-to-leaf logged');
  t.equal(kv.entries(kv.parse(r.text)).length, 1, 'still parses');
  t.end();
});

test('hero base stats copy vanilla only when OAA still has the old vanilla value', function (t) {
  const { portHeroFile } = require('../dota-patch/port-core');
  const oaa = '"DOTAHeroes"\n{\n  "npc_dota_hero_foo"\n  {\n    "AttributeBaseStrength"   "19"\n    "ArmorPhysical"   "5" // OAA\n  }\n}\n';
  const vanOld = { npc_dota_hero_foo: { AttributeBaseStrength: '19', ArmorPhysical: '2' } };
  const vanNew = { npc_dota_hero_foo: { AttributeBaseStrength: '20', ArmorPhysical: '3' } };
  const r = portHeroFile(oaa, { vanOld, vanNew });
  t.ok(r.text.includes('"AttributeBaseStrength"   "20"'), 'stat copied');
  t.ok(r.text.includes('"ArmorPhysical"   "5" // OAA'), 'OAA stat untouched');
  t.ok(r.actions.some(a => a.path === 'ArmorPhysical' && a.kind === 'review'), 'OAA stat logged for review');
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
