'use strict';
/*
  Load vanilla Dota KVs (items, npc_abilities, every hero file) at a given
  dotabuff/d2vpkr commit, either from a local clone (fast, offline) or over
  HTTPS (cached under scripts/cache/d2vpkr/<sha>/).

  Returns { entryName: plainObject } with hero AbilityDefinitions flattened
  out so every ability is a top-level entry.
*/
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const kv = require('./kv-text');

const REPO = 'dotabuff/d2vpkr';
const NPC = 'dota/scripts/npc/';
const UA = { 'User-Agent': 'oaa-dota-patch-tool' };
const CACHE = path.join(__dirname, '..', 'cache', 'd2vpkr');

function git (dir, args) {
  return execFileSync('git', ['-C', dir].concat(args), { maxBuffer: 1 << 28, encoding: 'utf8' });
}

async function getJSON (url) {
  const res = await fetch(url, { headers: Object.assign({ Accept: 'application/vnd.github+json' }, UA) });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + url);
  return res.json();
}

async function getText (url) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: UA });
    if (res.ok) return res.text();
    if (attempt >= 3 || res.status === 404) throw new Error('HTTP ' + res.status + ' for ' + url);
  }
}

// Resolve a ref (sha, branch, or "<sha>^") to a full sha
async function resolveRef (ref, opts) {
  if (opts.d2vpkr) return git(opts.d2vpkr, ['rev-parse', ref]).trim();
  let parent = false;
  if (ref.endsWith('^')) {
    parent = true;
    ref = ref.slice(0, -1);
  }
  const c = await getJSON('https://api.github.com/repos/' + REPO + '/commits/' + ref);
  return parent ? c.parents[0].sha : c.sha;
}

async function listFiles (sha, opts) {
  if (opts.d2vpkr) {
    return git(opts.d2vpkr, ['ls-tree', '-r', '--name-only', sha, '--', NPC + 'heroes', NPC + 'items.txt', NPC + 'npc_abilities.txt'])
      .split('\n').filter(f => f.endsWith('.txt'));
  }
  const heroes = await getJSON('https://api.github.com/repos/' + REPO + '/contents/' + NPC + 'heroes?ref=' + sha);
  return [NPC + 'items.txt', NPC + 'npc_abilities.txt'].concat(heroes.filter(h => h.name.endsWith('.txt')).map(h => h.path));
}

async function readFile (sha, file, opts) {
  if (opts.d2vpkr) return git(opts.d2vpkr, ['show', sha + ':' + file]);
  const cached = path.join(opts.cacheDir || CACHE, sha, file);
  if (fs.existsSync(cached)) return fs.readFileSync(cached, 'utf8');
  const text = await getText('https://raw.githubusercontent.com/' + REPO + '/' + sha + '/' + file);
  fs.mkdirSync(path.dirname(cached), { recursive: true });
  fs.writeFileSync(cached, text);
  return text;
}

function addEntries (out, text, file) {
  const root = kv.parse(text);
  kv.entries(root).forEach(node => {
    const obj = kv.toObject(node);
    if (node.key.startsWith('npc_dota_hero_') && obj.AbilityDefinitions) {
      Object.keys(obj.AbilityDefinitions).forEach(k => {
        if (typeof obj.AbilityDefinitions[k] === 'object') out[k] = obj.AbilityDefinitions[k];
      });
      delete obj.AbilityDefinitions;
    }
    out[node.key] = obj;
  });
}

async function loadVanilla (ref, opts) {
  opts = opts || {};
  const sha = await resolveRef(ref, opts);
  const files = await listFiles(sha, opts);
  const out = {};
  const queue = files.slice();
  const workers = Array.from({ length: 8 }, async () => {
    while (queue.length) {
      const f = queue.shift();
      addEntries(out, await readFile(sha, f, opts), f);
    }
  });
  await Promise.all(workers);
  return { sha, entries: out };
}

module.exports = { loadVanilla, resolveRef, addEntries };
