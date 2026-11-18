// Shared loaders for the specialist OAA tests (scripts/test/oaa-*.test.js).
// Vanilla: dotabuff/d2vpkr at DOTA_KV_REF (default master), or a local clone in D2VPKR.
const fs = require('fs');
const path = require('path');
const kv = require('../dota-patch/kv-text');
const { loadVanilla } = require('../dota-patch/vanilla');

const ROOT = path.join(__dirname, '..', '..');
const NPC = path.join(ROOT, 'game', 'scripts', 'npc');

function walk (dir, ext) {
  let out = [];
  fs.readdirSync(dir, { withFileTypes: true }).forEach(d => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) out = out.concat(walk(p, ext));
    else if (d.name.endsWith(ext)) out.push(p);
  });
  return out;
}

// { name: { file, node } } for every entry under game/scripts/npc/<sub>
function oaaEntries (sub) {
  const out = {};
  walk(path.join(NPC, sub), '.txt').forEach(f => {
    const rel = path.relative(NPC, f).split(path.sep).join('/');
    kv.entries(kv.parse(fs.readFileSync(f, 'utf8'))).forEach(node => {
      if (!out[node.key]) out[node.key] = { file: rel, node };
    });
  });
  return out;
}

let vanillaPromise = null;
function vanilla () {
  if (!vanillaPromise) vanillaPromise = loadVanilla(process.env.DOTA_KV_REF || 'master', { d2vpkr: process.env.D2VPKR });
  return vanillaPromise;
}

// Heroes OAA ships, from herolist.txt ("npc_dota_hero_x" "1")
function enabledHeroes () {
  const text = fs.readFileSync(path.join(NPC, 'herolist.txt'), 'utf8');
  const out = new Set();
  text.replace(/"(npc_dota_hero_[a-z_]+)"\s+"(-?\d+)"/g, (m, h, v) => {
    if (v !== '0') out.add(h);
  });
  return out;
}

// Known-issue baseline: issues that already existed on master are printed as
// "known" instead of failing, so a run after a Dota patch fails only on what
// the patch broke. Regenerate with OAA_UPDATE_KNOWN=1 (on master, with the
// vanilla ref master was built for).
const KNOWN_FILE = path.join(__dirname, 'fixtures', 'oaa-known-issues.json');
let known = null;
function issues (t, testName) {
  if (!known) known = fs.existsSync(KNOWN_FILE) ? JSON.parse(fs.readFileSync(KNOWN_FILE, 'utf8')) : {};
  const set = new Set(known[testName] || []);
  const found = [];
  return {
    report (id, msg) {
      found.push(id);
      if (set.has(id)) t.comment('known: ' + msg);
      else t.fail(msg);
    },
    done () {
      if (process.env.OAA_UPDATE_KNOWN) {
        known[testName] = found.sort();
        fs.writeFileSync(KNOWN_FILE, JSON.stringify(known, null, 1) + '\n');
      }
      const fixed = [...set].filter(id => !found.includes(id));
      if (fixed.length) t.comment('fixed since baseline (remove from fixtures/oaa-known-issues.json): ' + fixed.join(', '));
    }
  };
}

module.exports = { ROOT, NPC, walk, oaaEntries, vanilla, enabledHeroes, issues, kv };
