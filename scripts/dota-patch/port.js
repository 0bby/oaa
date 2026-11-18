#!/usr/bin/env node
'use strict';
/*
  Port a vanilla Dota patch onto OAA's KV files.

    node scripts/dota-patch/port.js [--to <d2vpkr ref>] [--from <ref>] [--apply]
                                    [--d2vpkr <local clone>] [--report <file.md>]

  --to      d2vpkr commit after the patch (default: master)
  --from    d2vpkr commit before the patch (default: parent of --to)
  --apply   write the mechanical changes into game/scripts/npc (default: dry run)
  --report  where to write the markdown worklist (default: dota-patch-report.md)

  Mechanical changes (applied): value copies, OAA-level re-extrapolation,
  key renames / additions / removals. Everything a human must decide goes in
  the report: diverged values, "intentionally"/"because" values, hero talent
  slots, new abilities/items, structural changes to Lua-backed abilities.
*/
const fs = require('fs');
const path = require('path');
const { loadVanilla } = require('./vanilla');
const { portFile, heroSlotReview, findCustomFamilies } = require('./port-core');
const { buildReport } = require('./report');
const { audit } = require('./audit');
const kv = require('./kv-text');

function args () {
  const a = process.argv.slice(2);
  const o = { to: 'master', apply: false, report: 'dota-patch-report.md' };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--apply') o.apply = true;
    else if (a[i].startsWith('--')) o[a[i].slice(2)] = a[++i];
  }
  return o;
}

function walk (dir) {
  let out = [];
  fs.readdirSync(dir, { withFileTypes: true }).forEach(d => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) out = out.concat(walk(p));
    else if (d.name.endsWith('.txt')) out.push(p);
  });
  return out;
}

async function main () {
  const o = args();
  const repo = path.join(__dirname, '..', '..');
  const npc = path.join(repo, 'game', 'scripts', 'npc');
  const opts = { d2vpkr: o.d2vpkr };
  const from = o.from || o.to + '^';
  console.log('Loading vanilla ' + from + ' and ' + o.to + ' ...');
  const [vOld, vNew] = await Promise.all([loadVanilla(from, opts), loadVanilla(o.to, opts)]);
  const itemTexts = walk(path.join(npc, 'items')).map(f => fs.readFileSync(f, 'utf8'));
  const ctx = { vanOld: vOld.entries, vanNew: vNew.entries, customFamilies: findCustomFamilies(itemTexts) };
  const actions = [];
  const oaaNames = new Set();
  let filesChanged = 0;

  ['abilities', 'items'].forEach(sub => {
    walk(path.join(npc, sub)).forEach(file => {
      const text = fs.readFileSync(file, 'utf8');
      const rel = path.relative(npc, file).replace(/\\/g, '/');
      const r = portFile(text, ctx);
      r.actions.forEach(a => actions.push(Object.assign({ file: rel }, a)));
      kv.entries(kv.parse(text)).forEach(n => oaaNames.add(n.key));
      if (r.text !== text) {
        filesChanged++;
        if (o.apply) fs.writeFileSync(file, r.text);
      }
    });
  });
  walk(path.join(npc, 'heroes')).forEach(file => {
    const rel = path.relative(npc, file).replace(/\\/g, '/');
    heroSlotReview(fs.readFileSync(file, 'utf8'), ctx).forEach(a => actions.push(Object.assign({ file: rel }, a)));
  });

  const newEntries = Object.keys(vNew.entries).filter(k => !vOld.entries[k] && !oaaNames.has(k));
  // audit the result (on disk if applied, otherwise the current files)
  const findings = audit(repo, ctx, actions);
  const md = buildReport({ from: vOld.sha, to: vNew.sha, actions, newEntries, applied: o.apply, filesChanged, findings });
  fs.writeFileSync(o.report, md);
  fs.writeFileSync(o.report.replace(/\.md$/, '') + '.json', JSON.stringify({ from: vOld.sha, to: vNew.sha, actions, newEntries }, null, 1));
  const count = k => actions.filter(a => a.kind === k).length;
  console.log((o.apply ? 'Applied' : 'Would apply') + ' ' + count('applied') + ' changes in ' + filesChanged + ' files; ' +
    count('review') + ' to review, ' + count('protected') + ' protected, ' + count('structural') + ' structural (Lua-backed), ' +
    newEntries.length + ' new vanilla entries. Report: ' + o.report);
}

main().catch(e => {
  console.error('FAIL', e);
  process.exitCode = 1;
});
