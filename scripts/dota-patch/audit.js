'use strict';
/*
  Post-port audit: checks for the problems that kept coming back after past
  ports (see the commit history 2024-2026):
    missing-oaa-levels  scaling ability without MaxLevel base+2, or a per-level
                        value with fewer entries than MaxLevel (7.36, 7.40, 7.41)
    plateau             OAA levels just repeat the last vanilla level on a value
                        that scales (7.41 port, fixed by hand in #3890/#3891)
    lua-removed-key     Lua reads a key the port removed/renamed (silently 0)
*/
const fs = require('fs');
const path = require('path');
const kv = require('./kv-text');
const { parseTokens } = require('./extrapolate');
const { vanillaLevels, getCI, TOP_KEYS } = require('./port-core');

// keys where a flat tail is normal (cooldowns, costs, ranges...)
const FLAT_OK = /cooldown|cost|cast|range|radius|duration|delay|interval|time|tick|speed|charge|width|distance|chance|pct|percent|max_|_max|count|stack|threshold|tooltip/i;

function walk (dir, ext) {
  let out = [];
  if (!fs.existsSync(dir)) return out;
  fs.readdirSync(dir, { withFileTypes: true }).forEach(d => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) out = out.concat(walk(p, ext));
    else if (d.name.endsWith(ext)) out.push(p);
  });
  return out;
}

function auditLevels (text, rel, ctx, out) {
  kv.entries(kv.parse(text)).forEach(node => {
    const name = node.key;
    const vn = ctx.vanNew[name];
    if (!vn || name.startsWith('item_') || name.startsWith('special_bonus_')) return;
    const vLv = vanillaLevels(vn, name);
    if (vLv <= 1) return;
    const ml = kv.child(node, 'MaxLevel');
    const oLv = ml ? parseInt(ml.value, 10) : vLv;
    if (oLv !== vLv + 2 && !(ml && /OAA/.test(ml.comment))) {
      out.push({ kind: 'missing-oaa-levels', file: rel, entry: name, path: 'MaxLevel', note: 'MaxLevel ' + oLv + ', expected ' + (vLv + 2) + ' (vanilla ' + vLv + ' + 2 OAA levels)' });
    }
    const leaves = [];
    TOP_KEYS.forEach(k => {
      const c = kv.child(node, k);
      if (c && c.value !== undefined) leaves.push([k, c, k]);
    });
    const av = kv.child(node, 'AbilityValues');
    (av && av.children ? av.children : []).forEach(c => {
      if (c.children) {
        c.children.forEach(s => {
          if (s.value !== undefined && (s.key === 'value' || /^special_bonus_(scepter|shard|facet)/.test(s.key))) leaves.push([c.key, s, c.key + '/' + s.key, c]);
        });
      } else leaves.push([c.key, c, c.key]);
    });
    leaves.forEach(([key, leaf, p, parent]) => {
      const comment = (leaf.comment || '') + ' ' + ((parent && parent.comment) || '');
      if (/OAA/.test(comment) && /MaxLevel|level/i.test(comment)) return;
      const t = parseTokens(leaf.value);
      if (!t || t.length <= 1) return;
      if (t.length < oLv) {
        out.push({ kind: 'missing-oaa-levels', file: rel, entry: name, path: p, note: t.length + ' values for MaxLevel ' + oLv + ': ' + leaf.value });
        return;
      }
      if (t.length === oLv && oLv === vLv + 2 && !FLAT_OK.test(key)) {
        const v = t.map(x => x.num);
        const rising = v.slice(0, vLv).every((x, i) => i === 0 || x > v[i - 1]);
        if (rising && v[vLv - 1] !== 0 && v[vLv] === v[vLv - 1] && v[vLv + 1] === v[vLv - 1]) {
          out.push({ kind: 'plateau', file: rel, entry: name, path: p, note: 'OAA levels repeat the last vanilla level: ' + leaf.value });
        }
      }
    });
  });
}

function auditLua (vscriptsDir, actions, out) {
  const pairs = actions
    .filter(a => a.kind === 'applied' && ['remove-key', 'remove-sub', 'rename'].includes(a.rule))
    .map(a => [a.entry.replace(/_\d$/, ''), a.path.split('/').pop(), a])
    .filter(p => !/^special_bonus/.test(p[1]));
  if (!pairs.length) return;
  const files = walk(vscriptsDir, '.lua').map(f => [f, fs.readFileSync(f, 'utf8')]);
  const seen = new Set();
  pairs.forEach(([entry, key, a]) => {
    files.forEach(([f, t]) => {
      if (!t.includes(entry)) return;
      const lines = t.split('\n');
      lines.forEach((l, i) => {
        if (!(l.includes('"' + key + '"') || l.includes("'" + key + "'"))) return;
        const id = f + i;
        if (seen.has(id)) return;
        seen.add(id);
        out.push({ kind: 'lua-removed-key', file: path.relative(path.join(vscriptsDir, '..', '..'), f).split(path.sep).join('/') + ':' + (i + 1), entry, path: key, note: 'vanilla ' + (a.rule === 'rename' ? 'renamed' : 'removed') + ' this key; Lua reads it: ' + l.trim().slice(0, 120) });
      });
    });
  });
}

function audit (repo, ctx, actions) {
  const npc = path.join(repo, 'game', 'scripts', 'npc');
  const out = [];
  walk(path.join(npc, 'abilities'), '.txt').forEach(f => {
    auditLevels(fs.readFileSync(f, 'utf8'), path.relative(npc, f).split(path.sep).join('/'), ctx, out);
  });
  auditLua(path.join(repo, 'game', 'scripts', 'vscripts'), actions, out);
  return out;
}

module.exports = { audit, auditLevels, getCI };
