#!/usr/bin/env node
'use strict';
/*
  Score the porter against real past ports: run it on the OAA files as they
  were before each patch PR and compare with what the maintainers merged.

    node scripts/dota-patch/backtest.js --d2vpkr <local d2vpkr clone> [--only 7.41]

  Needs a local d2vpkr clone (git clone --filter=blob:none) and the OAA git
  history (run from an OAA checkout that has origin/master).
*/
const path = require('path');
const { execFileSync } = require('child_process');
const kv = require('./kv-text');
const { loadVanilla } = require('./vanilla');
const { portFile } = require('./port-core');

// label, d2vpkr commit that shipped the patch, OAA PR that ported it
const PORTS = [
  ['7.40', '907930f70', 3864], ['7.40b', '8b9f4f3bf', 3869], ['7.40c', '1f73c9aca', 3875],
  ['7.41', 'bdc73e682', 3884], ['7.41a', '62894e2a7', 3887], ['7.41b', '358719e0f', 3888],
  ['7.41c', '9253fa19c', 3894], ['7.41d', '5fe586b96', 3896], ['7.41e', 'ca9626f58', 3899],
  ['7.41f', '969480b2e', 3902]
];

const repo = path.join(__dirname, '..', '..');
const git = (args) => execFileSync('git', ['-C', repo].concat(args), { maxBuffer: 1 << 28, encoding: 'utf8' });

// Read many files from git in one process: returns { spec: text|null }
function showMany (specs) {
  const buf = execFileSync('git', ['-C', repo, 'cat-file', '--batch'], { input: specs.join('\n') + '\n', maxBuffer: 1 << 30 });
  const out = {};
  let pos = 0;
  specs.forEach(spec => {
    const nl = buf.indexOf(10, pos);
    const hdr = buf.slice(pos, nl).toString().split(' ');
    pos = nl + 1;
    if (hdr[1] === 'missing' || hdr.length < 3) {
      out[spec] = null;
      return;
    }
    const size = parseInt(hdr[2], 10);
    out[spec] = buf.slice(pos, pos + size).toString('utf8');
    pos += size + 1;
  });
  return out;
}

function resolve (text, entry, p) {
  const node = kv.entries(kv.parse(text)).find(n => n.key === entry);
  if (!node) return { missing: true };
  let cur = node;
  for (const part of p.split('/')) {
    cur = kv.child(cur, part);
    if (!cur) return { missing: true };
  }
  if (cur.children) {
    const v = kv.child(cur, 'value');
    return { value: v ? v.value : undefined, block: true };
  }
  return { value: cur.value };
}

function score (a, preText, postText) {
  if (postText === null) return 'file-gone';
  if (a.rule === 'rename') return resolve(postText, a.entry, a.path.replace(/[^/]+$/, a.to)).missing ? 'miss' : 'hit';
  if (a.rule === 'add-key' || a.rule === 'add-sub') return resolve(postText, a.entry, a.path).missing ? 'miss' : 'hit';
  if (a.rule === 'remove-key' || a.rule === 'remove-sub') return resolve(postText, a.entry, a.path).missing ? 'hit' : 'miss';
  if (a.rule === 'leaf-to-block') return resolve(postText, a.entry, a.path).block ? 'hit' : 'miss';
  const after = resolve(postText, a.entry, a.path);
  if (after.missing) return 'path-gone';
  if (after.value === a.to) return 'hit';
  if (after.value === a.from) return 'not-ported';
  const n = s => (s || '').split(/\s+/).map(Number);
  const x = n(after.value);
  const y = n(a.to);
  const L = Math.min(x.length, y.length);
  let vanillaPartSame = true;
  for (let i = 0; i < L - 2; i++) if (x[i] !== y[i]) vanillaPartSame = false;
  return vanillaPartSame ? 'oaa-levels-differ' : 'miss';
}

async function main () {
  const argv = process.argv.slice(2);
  const opt = {};
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) opt[argv[i].slice(2)] = argv[++i];
  if (!opt.d2vpkr) throw new Error('--d2vpkr <path to local d2vpkr clone> is required');
  const total = {};
  const examples = {};
  for (const [label, vc, pr] of PORTS) {
    if (opt.only && opt.only !== label) continue;
    const merge = git(['log', '--format=%H', '-1', '--grep', '(#' + pr + ')', 'origin/master']).trim();
    if (!merge) {
      console.log(label + ': merge commit for #' + pr + ' not found');
      continue;
    }
    const [vOld, vNew] = await Promise.all([loadVanilla(vc + '^', opt), loadVanilla(vc, opt)]);
    const ctx = { vanOld: vOld.entries, vanNew: vNew.entries };
    const files = git(['ls-tree', '-r', '--name-only', merge + '^', '--', 'game/scripts/npc/abilities', 'game/scripts/npc/items'])
      .split('\n').filter(f => f.endsWith('.txt'));
    const s = {};
    const pres = showMany(files.map(f => merge + '^:' + f));
    const posts = showMany(files.map(f => merge + ':' + f));
    for (const f of files) {
      const pre = pres[merge + '^:' + f];
      if (!pre) continue;
      const r = portFile(pre, ctx);
      if (!r.actions.length) continue;
      const post = posts[merge + ':' + f];
      r.actions.forEach(a => {
        const key = a.kind === 'applied' ? a.rule : a.kind;
        const res = a.kind === 'applied' ? score(a, pre, post) : 'n/a';
        s[key] = s[key] || {};
        s[key][res] = (s[key][res] || 0) + 1;
        total[key] = total[key] || {};
        total[key][res] = (total[key][res] || 0) + 1;
        const ex = key + ':' + res;
        if (res !== 'hit' && res !== 'n/a' && (examples[ex] = examples[ex] || []).length < 4) {
          examples[ex].push(label + ' ' + a.entry + ' ' + a.path + ' | was ' + a.from + ' | tool ' + a.to + ' | merged ' + (post ? resolve(post, a.entry, a.path).value : 'file gone'));
        }
      });
    }
    console.log(label + ' #' + pr + ' ' + JSON.stringify(s));
  }
  console.log('\nTOTAL');
  Object.keys(total).forEach(k => {
    const t = total[k];
    const n = Object.values(t).reduce((x, y) => x + y, 0);
    console.log('  ' + k.padEnd(18) + String(n).padStart(6) + '  ' + JSON.stringify(t) + (t.hit !== undefined ? '  hit rate ' + Math.round(100 * t.hit / n) + '%' : ''));
  });
  console.log('\nEXAMPLES');
  Object.keys(examples).forEach(k => examples[k].forEach(e => console.log('  [' + k + '] ' + e)));
}

main().catch(e => {
  console.error('FAIL', e);
  process.exitCode = 1;
});
