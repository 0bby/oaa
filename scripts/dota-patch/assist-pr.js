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
const branch = o.branch || 'assist-' + o.pr;
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
const port = extra => {
  const args = [path.join(tools, 'port.js'), '--to', o.to, '--apply', '--safe', '--skip-files', skipFile, '--report', report].concat(extra);
  if (o.from) args.push('--from', o.from);
  if (o.d2vpkr) args.push('--d2vpkr', o.d2vpkr);
  if (o.tag) args.push('--skip-marked', o.tag);
  console.log(execFileSync(process.execPath, args, { cwd: wt, encoding: 'utf8', maxBuffer: 1 << 28 }).trim());
};
const commit = msg => {
  git(['add', '-A', 'game/scripts/npc'], wt);
  const staged = git(['diff', '--cached', '--shortstat'], wt);
  if (!staged) return console.log('OK nothing to commit for: ' + msg);
  git(['-c', 'user.name=0bby', '-c', 'user.email=72665894+0bby@users.noreply.github.com', 'commit', '-q', '-m', msg], wt);
  console.log('OK commit: ' + msg + ' (' + staged + ')');
};

// commit 1: vanilla copies only. commit 2 (with --accept): the OAA-level choices
// a human signed off, recomputed from the PR head so both commits stay consistent
const accept = o.accept ? ['--accept', o.accept] : [];
port(accept.length ? accept.concat(['--stage', 'objective']) : []);
// never write "#<n>" in a message: GitHub would cross-link it onto the upstream PR
commit('Vanilla ' + (o.tag || '') + ' copies for files the port PR has not done yet (no OAA levels changed)');
if (accept.length) {
  git(['checkout', '-q', ref, '--', 'game/scripts/npc'], wt);
  port(accept);
  commit('OAA levels 5-6 by agreed rules (' + o.accept + ') for files the port PR has not done yet');
}
console.log(branch + ' is ' + ref + ' ' + head + ' + the commits above. Skipped ' + touched.length + ' files the PR touched.');
console.log('Decisions still open: ' + report.replace(/\.md$/, '-decisions.json'));
