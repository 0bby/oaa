#!/usr/bin/env node
'use strict';
/*
  Help a maintainer's in-progress patch PR with the objective part only.

    node scripts/dota-patch/assist-pr.js --pr 3906 --to <d2vpkr sha> --worktree <dir>
                                         [--from <sha>] [--d2vpkr <clone>] [--tag 7.42]

  Rebuilds branch assist-<pr> on top of the PR's current head, then runs the
  porter in --safe mode, skipping every npc file the PR already touched or
  marked done (header comment carrying --tag). Only vanilla copies are
  applied; OAA levels 5-6 and anything low confidence are written to
  <worktree>/assist-<pr>-decisions.json for a human. Safe to re-run after
  every push to the PR: the branch is rebuilt from scratch each time.
*/
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const a = process.argv.slice(2);
const o = {};
for (let i = 0; i < a.length; i++) if (a[i].startsWith('--')) o[a[i].slice(2)] = a[++i];
if (!o.pr || !o.to || !o.worktree) {
  console.error('FAIL usage: --pr <n> --to <d2vpkr sha> --worktree <dir> [--from <sha>] [--d2vpkr <clone>] [--tag 7.42]');
  process.exit(1);
}
const repo = path.join(__dirname, '..', '..');
const git = (args, cwd) => execFileSync('git', args, { cwd: cwd || repo, encoding: 'utf8', maxBuffer: 1 << 28 }).trim();
const ref = 'pr-' + o.pr;
const branch = 'assist-' + o.pr;
const wt = path.resolve(o.worktree);

git(['fetch', '-q', '--force', 'origin', 'pull/' + o.pr + '/head:' + ref, 'master:refs/remotes/origin/master']);
const head = git(['rev-parse', '--short', ref]);
const base = git(['merge-base', ref, 'refs/remotes/origin/master']);
// files the PR touched, except ones whose only change is ItemCost (written by
// the cost-tree test, not a human review)
const touched = [];
let cur = null;
let onlyCost = true;
const flush = () => { if (cur && !onlyCost) touched.push(cur); };
git(['diff', '-U0', base, ref, '--', 'game/scripts/npc']).split('\n').forEach(l => {
  const m = l.match(/^diff --git a\/(\S+) b\//);
  if (m) {
    flush();
    cur = m[1].replace('game/scripts/npc/', '');
    onlyCost = true;
  } else if (/^[-+](?![-+]{2} )/.test(l) && !/"ItemCost"/.test(l)) {
    onlyCost = false;
  } else if (/^(deleted|new) file/.test(l)) {
    onlyCost = false;
  }
});
flush();

if (fs.existsSync(wt)) {
  // the branch is ours and rebuilt every run: discard leftovers (e.g. test cost writes)
  git(['checkout', '-q', '-f', '-B', branch, ref], wt);
  git(['clean', '-qfd', 'game'], wt);
} else {
  git(['worktree', 'add', '-q', '-B', branch, wt, ref]);
}
// the tools are not on the PR branch: copy them in (left untracked)
const tools = path.join(wt, 'scripts', 'dota-patch');
fs.mkdirSync(tools, { recursive: true });
fs.readdirSync(__dirname).filter(f => f.endsWith('.js')).forEach(f => fs.copyFileSync(path.join(__dirname, f), path.join(tools, f)));
const skipFile = path.join(wt, branch + '-skip.txt');
fs.writeFileSync(skipFile, touched.join('\n') + '\n');

const report = path.join(wt, branch + '.md');
const args = [path.join(tools, 'port.js'), '--to', o.to, '--apply', '--safe', '--skip-files', skipFile, '--report', report];
if (o.from) args.push('--from', o.from);
if (o.d2vpkr) args.push('--d2vpkr', o.d2vpkr);
if (o.tag) args.push('--skip-marked', o.tag);
console.log(execFileSync(process.execPath, args, { cwd: wt, encoding: 'utf8', maxBuffer: 1 << 28 }).trim());

git(['add', '-A', 'game/scripts/npc'], wt);
const staged = git(['diff', '--cached', '--shortstat'], wt);
if (!staged) {
  console.log('OK nothing objective left to apply on top of ' + ref + ' ' + head);
} else {
  git(['-c', 'user.name=0bby', '-c', 'user.email=72665894+0bby@users.noreply.github.com', 'commit', '-q', '-m',
    'Vanilla ' + (o.tag || '') + ' copies for files not yet done in #' + o.pr + ' (no OAA levels changed)'], wt);
  console.log('OK ' + branch + ' = ' + ref + ' ' + head + ' + 1 commit (' + staged + '). Skipped ' + touched.length + ' files the PR touched.');
}
console.log('Decisions (OAA levels 5-6, low confidence): ' + report.replace(/\.md$/, '-decisions.json'));
