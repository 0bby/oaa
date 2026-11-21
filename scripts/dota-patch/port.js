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
  --safe    apply only edits that copy vanilla (no invented OAA levels); every
            other edit is listed as a decision in <report>-decisions.json
  --skip-marked <tag>   leave files whose header comment carries <tag> (e.g. 7.42,
            how maintainers mark a file as done) untouched
  --skip-files <list>   leave the files in this list (one npc-relative path per line)
  --accept <rules>      with --safe, also apply these OAA-level choices (balance calls
            a maintainer has signed off): linear, ratio, item-offset, taper
            (taper: new durations/percentages step 1/3 of vanilla at OAA levels)

  Mechanical changes (applied): value copies, OAA-level re-extrapolation,
  key renames / additions / removals. Everything a human must decide goes in
  the report: diverged values, "intentionally"/"because" values, hero talent
  slots, new abilities/items, structural changes to Lua-backed abilities.
*/
const fs = require('fs');
const path = require('path');
const { loadVanilla } = require('./vanilla');
const { portFile, portHeroFile, isObjective, findCustomFamilies, TAPER_KEYS } = require('./port-core');

// OAA-level edits a maintainer has accepted as a policy (--accept)
function accepted (a, accept) {
  if (a.kind !== 'applied' || /has OAA comment/.test(a.note || '')) return false;
  const rule = /-to-/.test(a.rule) ? a.valueRule : a.rule;
  if (accept.has('linear') && rule === 'linear') return true;
  if (accept.has('ratio') && rule === 'ratio') return true;
  if (accept.has('item-offset') && rule === 'offset' && /^item_/.test(a.entry)) return true;
  if (accept.has('taper') && TAPER_KEYS.test(a.path) &&
    (rule === 'new-levels-linear' || (/^add-(key|sub)$/.test(rule) && a.lowConfidence))) return true;
  return false;
}
const { buildReport } = require('./report');
const { audit } = require('./audit');
const kv = require('./kv-text');

function args () {
  const a = process.argv.slice(2);
  const o = { to: 'master', apply: false, report: 'dota-patch-report.md' };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--apply') o.apply = true;
    else if (a[i] === '--safe') o.safe = true;
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
  const accept = new Set((o.accept || '').split(',').map(x => x.trim()).filter(Boolean));
  const ok = a => isObjective(a) || accepted(a, accept);
  const ctx = { vanOld: vOld.entries, vanNew: vNew.entries, customFamilies: findCustomFamilies(itemTexts), taper: accept.has('taper') };
  const skipList = new Set(o['skip-files'] ? fs.readFileSync(o['skip-files'], 'utf8').split(/\r?\n/).map(x => x.trim()).filter(Boolean) : []);
  const tag = o['skip-marked'];
  const marked = text => tag && text.split(/\r?\n/).some(l => /^\s*\/\//.test(l) && l.split(/[^0-9A-Za-z.]+/).includes(tag));
  const skipped = [];
  const skip = (rel, text) => {
    if (skipList.has(rel) || marked(text)) {
      skipped.push(rel);
      return true;
    }
    return false;
  };
  const actions = [];
  const oaaNames = new Set();
  let filesChanged = 0;
  const results = []; // { file, text, r }
  // an ability, or a whole item family (item_x, item_x_2..5, its recipe), is
  // ported all or nothing in --safe mode, so no file is left half-ported
  const group = name => /^item_/.test(name) ? name.replace(/^item_recipe_/, 'item_').replace(/_\d$/, '') : name;
  const heldGroups = new Set();

  ['abilities', 'items'].forEach(sub => {
    walk(path.join(npc, sub)).forEach(file => {
      const text = fs.readFileSync(file, 'utf8');
      const rel = path.relative(npc, file).replace(/\\/g, '/');
      const names = kv.entries(kv.parse(text)).map(n => n.key);
      names.forEach(n => oaaNames.add(n));
      if (skip(rel, text)) {
        names.forEach(n => heldGroups.add(group(n)));
        return;
      }
      results.push({ file, text, r: portFile(text, ctx) });
    });
  });
  walk(path.join(npc, 'heroes')).forEach(file => {
    const rel = path.relative(npc, file).replace(/\\/g, '/');
    const text = fs.readFileSync(file, 'utf8');
    if (skip(rel, text)) return;
    results.push({ file, text, r: portHeroFile(text, ctx) });
  });

  if (o.safe) {
    const isCost = a => /(^|\/)ItemCost$/i.test(a.path || '');
    results.forEach(({ r }) => r.actions.forEach(a => {
      if (isCost(a)) return; // costs are derived: the cost-tree test writes them
      if (a.edits && !ok(a)) heldGroups.add(group(a.entry));
      // item tiers must stay identical: one tier left for review holds the family
      if (/^item_/.test(a.entry) && a.path && ['review', 'protected', 'structural'].includes(a.kind)) heldGroups.add(group(a.entry));
      // --stage objective: leave groups that need an accepted OAA-level edit for the next commit
      if (o.stage === 'objective' && a.edits && !isObjective(a)) heldGroups.add(group(a.entry));
    }));
  }
  results.forEach(({ file, text, r }) => {
    const rel = path.relative(npc, file).replace(/\\/g, '/');
    let out = r.text;
    if (o.safe) {
      const ed = new kv.Editor(text);
      r.actions.forEach(a => {
        if (!a.edits) return;
        if (heldGroups.has(group(a.entry)) || /(^|\/)ItemCost$/i.test(a.path || '')) a.held = true;
        else ed.edits.push(...a.edits);
      });
      out = ed.apply();
    }
    r.actions.forEach(a => actions.push(Object.assign({ file: rel }, a)));
    if (out !== text) {
      filesChanged++;
      if (o.apply) fs.writeFileSync(file, out);
    }
  });

  // safe mode: held edits become decisions (balance calls), not applied changes
  const held = actions.filter(a => a.held);
  held.forEach(a => {
    a.rule = a.rule + ' (held)';
    a.kind = 'review';
    a.note = (a.oaaLevels || /linear|ratio|offset|collapse|flat/.test(a.rule) ? 'OAA levels 5-6: balance call' : 'low confidence') + '; porter suggests ' + a.to;
  });
  if (o.safe) fs.writeFileSync(o.report.replace(/\.md$/, '') + '-decisions.json', JSON.stringify(held, null, 1));
  const newEntries = Object.keys(vNew.entries).filter(k => !vOld.entries[k] && !oaaNames.has(k));
  // audit the result (on disk if applied, otherwise the current files)
  const findings = audit(repo, ctx, actions);
  const md = buildReport({ from: vOld.sha, to: vNew.sha, actions, newEntries, applied: o.apply, filesChanged, findings });
  fs.writeFileSync(o.report, md);
  fs.writeFileSync(o.report.replace(/\.md$/, '') + '.json', JSON.stringify({ from: vOld.sha, to: vNew.sha, actions, newEntries }, null, 1));
  if (skipped.length) console.log('Skipped ' + skipped.length + ' files (marked done or listed).');
  if (o.safe) console.log('Safe mode: ' + held.length + ' edits held for a decision (OAA levels or low confidence).');
  const count = k => actions.filter(a => a.kind === k).length;
  console.log((o.apply ? 'Applied' : 'Would apply') + ' ' + count('applied') + ' changes in ' + filesChanged + ' files; ' +
    count('review') + ' to review, ' + count('protected') + ' protected, ' + count('structural') + ' structural (Lua-backed), ' +
    newEntries.length + ' new vanilla entries. Report: ' + o.report);
}

main().catch(e => {
  console.error('FAIL', e);
  process.exitCode = 1;
});
