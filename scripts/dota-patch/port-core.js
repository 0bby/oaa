'use strict';
/*
  portFile(text, ctx) applies one vanilla patch (ctx.vanOld -> ctx.vanNew) to
  one OAA KV file and returns { text, actions }.

  ctx.vanOld / ctx.vanNew: { entryName: plainObject } (see vanilla.js)
  Every change is logged in actions as
    { entry, path, kind, rule?, from?, to?, vanilla?, note? }
  kind: 'applied' | 'review' | 'protected' | 'structural' | 'skipped'
*/
const kv = require('./kv-text');
const { portValue, parseTokens, extendLinear } = require('./extrapolate');

const TOP_KEYS = [
  'AbilityCooldown', 'AbilityManaCost', 'AbilityCastRange', 'AbilityCastPoint',
  'AbilityChannelTime', 'AbilityDuration', 'AbilityDamage', 'AbilityCharges',
  'AbilityChargeRestoreTime', 'ItemCost', 'ItemInitialCharges', 'ItemDisplayCharges',
  'AbilityBehavior', 'SpellDispellableType', 'SpellImmunityType', 'AbilityUnitDamageType',
  'AbilityUnitTargetTeam', 'AbilityUnitTargetType', 'AbilityUnitTargetFlags',
  'AbilityType', 'ItemRequiresCharges'
];
const PROTECTED = /intentionally|because/i;
const TAPER_KEYS = /duration|time|pct|percent|chance|resist|slow|amp|potency|reduction/i;
// Damage/heal/stat keys scale linearly even when named *_pct (Kez max_health_damage_pct got
// 3.92 4.09 instead of 4.25 4.75 in 7.42). Match on the key name only, never the ability name.
const NO_TAPER_KEYS = /damage|dmg|heal|lifesteal|health|mana|armor|regen|attack_speed|bonus_(str|agi|int|all)/i;
function isTaperKey (path) {
  const parts = String(path || '').split('/').filter(p => p && p.toLowerCase() !== 'value');
  const key = parts[parts.length - 1] || '';
  return TAPER_KEYS.test(key) && !NO_TAPER_KEYS.test(key);
}

function getCI (obj, key) {
  if (!obj || typeof obj !== 'object') return undefined;
  if (key in obj) return obj[key];
  const lk = key.toLowerCase();
  const k = Object.keys(obj).find(x => x.toLowerCase() === lk);
  return k === undefined ? undefined : obj[k];
}

function asBlock (v) {
  if (v === undefined) return undefined;
  if (typeof v === 'string') return { value: v };
  return v;
}

function isCustomBase (base) {
  return /_datadriven$|_lua$/.test(base || '');
}

function vanillaLevels (vEntry, name) {
  const ml = parseInt(getCI(vEntry, 'MaxLevel'), 10);
  if (ml > 0) return ml;
  if (name.startsWith('item_')) return 1;
  return getCI(vEntry, 'AbilityType') === 'ABILITY_TYPE_ULTIMATE' ? 3 : 4;
}

function oaaLevels (node, vLevels, name) {
  const ml = parseInt((kv.child(node, 'MaxLevel') || {}).value, 10);
  if (ml > 0) return ml;
  if (name.startsWith('item_')) {
    const mu = parseInt((kv.child(node, 'MaxUpgradeLevel') || {}).value, 10);
    return mu > 0 ? mu : 1;
  }
  return vLevels > 1 ? vLevels + 2 : vLevels;
}

function portFile (text, ctx) {
  const root = kv.parse(text);
  const ed = new kv.Editor(text);
  const actions = [];
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  let editMark = 0;

  kv.entries(root).forEach(node => {
    const name = node.key;
    const base = (kv.child(node, 'BaseClass') || {}).value;
    let parent = null;
    // item upgrade tier (item_x_2..5) of a vanilla item
    const tier = name.match(/^(item_.+)_(\d)$/);
    const familyBase = tier && (ctx.vanNew[tier[1]] || ctx.vanOld[tier[1]]) ? tier[1] : null;
    if (ctx.vanNew[name] || ctx.vanOld[name]) parent = name;
    else if (base && (ctx.vanNew[base] || ctx.vanOld[base])) parent = base;
    else if (familyBase) parent = familyBase;
    if (!parent) return;
    // the whole family has to stay identical, so if any tier is Lua-backed the
    // structure of every tier is a human job (values still get ported)
    const customFamily = (ctx.customFamilies || new Set()).has(familyBase || name);
    const vo = ctx.vanOld[parent];
    const vn = ctx.vanNew[parent];
    if (!vn) {
      actions.push({ entry: name, path: '', kind: 'review', note: 'vanilla removed ' + parent });
      return;
    }
    if (!vo) return; // new in vanilla; OAA already has it (nothing to diff against)
    // vanilla retired the item (7.42 Revenant's Brooch: cost 0, recipe gone)
    if (/^item_(?!recipe_)/.test(parent) && getCI(vn, 'ItemCost') === '0' && +getCI(vo, 'ItemCost') > 0) {
      actions.push({ entry: name, path: '', kind: 'review', note: 'vanilla retired ' + parent + ' (ItemCost 0): keep, remove or replace the OAA family' });
      return;
    }
    const custom = (isCustomBase(base) && (parent === name || parent === familyBase)) || customFamily;
    const vLv = vanillaLevels(vn, parent);
    const oLv = oaaLevels(node, vLv, name);
    // each applied action owns the edits pushed since the previous log, so
    // --safe can keep only the objective ones (see filterSafe)
    const log = (a) => {
      const act = Object.assign({ entry: name }, a);
      const own = ed.edits.slice(editMark);
      if (own.length) Object.defineProperty(act, 'edits', { value: own, enumerable: false });
      if (act.kind === 'applied' && extrapolated) act.oaaLevels = true;
      extrapolated = false;
      actions.push(act);
      editMark = ed.edits.length;
    };
    let extrapolated = false; // set by fitLevels when it invents OAA levels
    let currentKey = ''; // key being inserted, for taperFor
    // --accept taper: new durations/percentages get OAA levels at 1/3 of the vanilla step
    const taperFor = p => ctx.taper && isTaperKey(p) ? 1 / 3 : 1;

    function portLeaf (oNode, from, to, path, commentNodes) {
      if (!oNode || oNode.value === undefined) return;
      const comments = commentNodes.map(n => (n && n.comment) || '').join(' ');
      if (PROTECTED.test(comments)) {
        log({ path, kind: 'protected', from: oNode.value, vanilla: from + ' -> ' + to, note: comments });
        return;
      }
      const r = portValue(from, to, oNode.value, { vanillaLevels: vLv, oaaLevels: oLv, stepFactor: taperFor(path) });
      if (r.skip) {
        log({ path, kind: 'review', from: oNode.value, vanilla: from + ' -> ' + to, note: r.skip + (/OAA/.test(comments) ? ' (has OAA comment)' : '') });
        return;
      }
      if (r.value === oNode.value) return;
      ed.setValue(oNode, r.value);
      // an OAA comment means a maintainer looked at this value: still port it
      // (the vanilla levels matched old vanilla) but put it on the check list
      const oaaNote = /OAA/.test(comments) ? 'has OAA comment: ' + comments.trim() : undefined;
      log({ path, kind: 'applied', rule: r.rule, from: oNode.value, to: r.value, vanilla: from + ' -> ' + to, lowConfidence: r.lowConfidence || !!oaaNote || undefined, note: oaaNote });
    }

    // ---- recipes: copy vanilla's new components when OAA still has the old ones
    // (OAA writes components without vanilla's '*' marker)
    const oReq = kv.child(node, 'ItemRequirements');
    const vReqO = getCI(vo, 'ItemRequirements');
    const vReqN = getCI(vn, 'ItemRequirements');
    if (oReq && oReq.children && vReqO && vReqN && JSON.stringify(vReqO) !== JSON.stringify(vReqN)) {
      const plain = x => typeof x === 'string' ? x.replace(/\*/g, '') : x;
      oReq.children.forEach(c => {
        const a = plain(getCI(vReqO, c.key));
        const b = plain(getCI(vReqN, c.key));
        if (a === b || c.value === b) return;
        if (c.value !== a || /OAA/.test(c.comment) || PROTECTED.test(c.comment)) {
          return log({ path: 'ItemRequirements/' + c.key, kind: 'review', from: c.value, vanilla: a + ' -> ' + b, note: 'OAA recipe differs from old vanilla' });
        }
        if (b === undefined) return log({ path: 'ItemRequirements/' + c.key, kind: 'review', from: c.value, note: 'vanilla removed this recipe option' });
        ed.setValue(c, b);
        log({ path: 'ItemRequirements/' + c.key, kind: 'applied', rule: 'recipe', from: c.value, to: b, vanilla: a + ' -> ' + b });
      });
    }

    // ---- top level keys (may live in AbilityValues as a block in OAA)
    const oAV = kv.child(node, 'AbilityValues');
    TOP_KEYS.forEach(key => {
      const a = getCI(vo, key);
      const b = getCI(vn, key);
      if (a === b || typeof a !== 'string') return;
      const top = kv.child(node, key);
      if (b === undefined) {
        // vanilla dropped the key: either deleted, or moved into AbilityValues
        if (!top || top.value === undefined) return;
        const moved = getCI(getCI(vn, 'AbilityValues') || {}, key) !== undefined;
        if (moved) return log({ path: key, kind: 'review', from: top.value, note: 'vanilla moved ' + key + ' into AbilityValues' });
        if (PROTECTED.test(top.comment) || /OAA/.test(top.comment)) return log({ path: key, kind: 'review', note: 'vanilla removed this key, OAA comment kept it: ' + top.comment });
        if (custom) return log({ path: key, kind: 'structural', note: 'vanilla removed this key (custom base class)' });
        ed.remove(top);
        return log({ path: key, kind: 'applied', rule: 'remove-top', from: top.value });
      }
      if (typeof b !== 'string') return;
      if (top && top.value !== undefined) {
        portLeaf(top, a, b, key, [top]);
      } else {
        const blk = kv.child(oAV, key);
        if (blk) {
          const vnode = blk.children ? kv.child(blk, 'value') : blk;
          portLeaf(vnode, a, b, 'AbilityValues/' + key, [blk, vnode]);
        }
      }
    });

    // ---- AbilityValues
    const avo = getCI(vo, 'AbilityValues') || {};
    const avn = getCI(vn, 'AbilityValues') || {};
    if (!oAV) return;
    const removed = Object.keys(avo).filter(k => getCI(avn, k) === undefined);
    const added = Object.keys(avn).filter(k => getCI(avo, k) === undefined);
    const renamed = {};
    removed.forEach(r => {
      const match = added.find(a => !renamed[a] && JSON.stringify(avo[r]) === JSON.stringify(avn[a]));
      if (match) renamed[match] = r;
    });

    Object.keys(avn).forEach((k, idx) => {
      const oldVal = getCI(avo, k);
      const oK = kv.child(oAV, k);
      if (oldVal === undefined) {
        if (renamed[k]) {
          const oOld = kv.child(oAV, renamed[k]);
          if (oOld) {
            if (custom) return log({ path: 'AbilityValues/' + renamed[k], kind: 'structural', note: 'renamed to ' + k + ' in vanilla (custom base class, update Lua too)' });
            ed.renameKey(oOld, k);
            log({ path: 'AbilityValues/' + renamed[k], kind: 'applied', rule: 'rename', to: k });
          }
          return;
        }
        if (oK) return;
        if (custom) return log({ path: 'AbilityValues/' + k, kind: 'structural', note: 'new vanilla key (custom base class, add only if Lua uses it)' });
        insertKey(k, avn[k], Object.keys(avn).slice(0, idx).reverse());
        return;
      }
      if (!oK) return;
      const bo = asBlock(oldVal);
      const bn = asBlock(avn[k]);
      const path = 'AbilityValues/' + k;
      const vanBecameBlock = typeof oldVal === 'string' && typeof avn[k] === 'object';
      const vanBecameLeaf = typeof oldVal === 'object' && typeof avn[k] === 'string';
      // vanilla turned a block into a plain value: follow it, unless OAA added its own sub keys
      if (oK.children && vanBecameLeaf && oK.children.every(c => c.key.toLowerCase() === 'value' || getCI(bo, c.key) !== undefined)) {
        if (custom) return log({ path, kind: 'structural', note: 'vanilla turned this block into a plain value' });
        const vnode = kv.child(oK, 'value');
        if (!vnode || PROTECTED.test(oK.comment + ' ' + vnode.comment)) return;
        const r = portValue(bo.value, bn.value, vnode.value, { vanillaLevels: vLv, oaaLevels: oLv });
        const v = r.skip ? vnode.value : r.value;
        const tail = oK.comment || vnode.comment;
        ed.edits.push({ start: oK.start, end: oK.end, text: kv.formatLeaf(kv.indentOf(text, oK), oK.key, v, kv.valueColumn(text, vnode), tail ? ' //' + tail + eol : eol) });
        return log({ path, kind: 'applied', rule: 'block-to-leaf', valueRule: r.skip ? 'kept' : r.rule, from: vnode.value, to: v, lowConfidence: !!r.skip || undefined });
      }
      if (JSON.stringify(bo) === JSON.stringify(bn) && !(vanBecameBlock && !oK.children)) return;
      // leaf in OAA but vanilla now has sub keys (or became a block) -> convert to block
      if (!oK.children) {
        const extraSubs = Object.keys(bn).filter(s => s !== 'value');
        if (extraSubs.length || vanBecameBlock) {
          if (custom) return log({ path, kind: 'structural', note: 'vanilla turned this into a block with ' + extraSubs.join(', ') });
          convertLeaf(oK, bo, bn, path);
          return;
        }
        portLeaf(oK, bo.value, bn.value, path, [oK]);
        return;
      }
      Object.keys(bn).forEach((s, sIdx) => {
        const sNode = kv.child(oK, s);
        const sOld = getCI(bo, s);
        if (sOld === undefined) {
          if (sNode) return;
          if (custom) return log({ path: path + '/' + s, kind: 'structural', note: 'new vanilla sub key' });
          const prev = Object.keys(bn).slice(0, sIdx).reverse().map(x => kv.child(oK, x)).find(Boolean);
          currentKey = k;
          const val = fitLevels(bn[s]);
          const line = kv.formatLeaf(indentFor(oK, prev), s, val, prev ? kv.valueColumn(text, prev) : 58, eol);
          if (prev) ed.insertAfter(prev, line);
          else ed.insertFirst(oK, line);
          log({ path: path + '/' + s, kind: 'applied', rule: 'add-sub', to: val, lowConfidence: val !== bn[s] || undefined });
          return;
        }
        if (sNode && typeof bn[s] === 'string' && typeof sOld === 'string' && sOld !== bn[s]) {
          portLeaf(sNode, sOld, bn[s], path + '/' + s, [oK, sNode]);
        }
      });
      Object.keys(bo).forEach(s => {
        if (getCI(bn, s) !== undefined) return;
        const sNode = kv.child(oK, s);
        if (!sNode) return;
        if (PROTECTED.test(sNode.comment) || /OAA/.test(sNode.comment)) {
          return log({ path: path + '/' + s, kind: 'review', note: 'vanilla removed this sub key, OAA comment kept it: ' + sNode.comment });
        }
        if (custom) return log({ path: path + '/' + s, kind: 'structural', note: 'vanilla removed this sub key' });
        ed.remove(sNode);
        log({ path: path + '/' + s, kind: 'applied', rule: 'remove-sub', from: sNode.value });
      });
    });

    removed.forEach(r => {
      if (Object.values(renamed).includes(r)) return;
      const oK = kv.child(oAV, r);
      if (!oK) return;
      if (PROTECTED.test(oK.comment) || /OAA/.test(oK.comment)) {
        return log({ path: 'AbilityValues/' + r, kind: 'review', note: 'vanilla removed this key, OAA comment kept it: ' + oK.comment });
      }
      if (custom) return log({ path: 'AbilityValues/' + r, kind: 'structural', note: 'vanilla removed this key (custom base class)' });
      ed.remove(oK);
      log({ path: 'AbilityValues/' + r, kind: 'applied', rule: 'remove-key' });
    });

    function fitLevels (val) {
      if (typeof val !== 'string') return val;
      const t = parseTokens(val);
      if (t && t.length > 1 && t.length === vLv && oLv > vLv) {
        extrapolated = true;
        return extendLinear(t, oLv, taperFor(currentKey));
      }
      return val;
    }

    function indentFor (blockNode, sibling) {
      if (sibling) return kv.indentOf(text, sibling);
      const first = blockNode.children && blockNode.children[0];
      if (first) return kv.indentOf(text, first);
      return kv.indentOf(text, blockNode) + '  ';
    }

    function blockText (indent, key, obj, col, comment) {
      if (typeof obj === 'string') return kv.formatLeaf(indent, key, fitLevels(obj), col, eol);
      let s = indent + '"' + key + '"' + (comment ? ' //' + comment : '') + eol + indent + '{' + eol;
      Object.keys(obj).forEach(sk => {
        const v = obj[sk];
        if (typeof v === 'string') s += kv.formatLeaf(indent + '  ', sk, sk === 'value' || /^special_bonus_(scepter|shard)$/.test(sk) ? fitLevels(v) : v, col, eol);
        else s += blockText(indent + '  ', sk, v, col);
      });
      return s + indent + '}' + eol;
    }

    function insertKey (k, val, prevKeys) {
      currentKey = k;
      const prev = prevKeys.map(x => kv.child(oAV, x)).find(Boolean);
      const sib = prev || (oAV.children && oAV.children[0]);
      const indent = sib ? kv.indentOf(text, sib) : kv.indentOf(text, oAV) + '  ';
      const col = sib && sib.valueStart !== undefined ? kv.valueColumn(text, sib) : 58;
      const t = blockText(indent, k, val, col);
      if (prev) ed.insertAfter(prev, t);
      else ed.insertFirst(oAV, t);
      log({ path: 'AbilityValues/' + k, kind: 'applied', rule: 'add-key', to: JSON.stringify(val), lowConfidence: extrapolated || undefined });
    }

    function convertLeaf (oK, bo, bn, path) {
      const r = portValue(bo.value, bn.value, oK.value, { vanillaLevels: vLv, oaaLevels: oLv });
      const v = r.skip ? oK.value : r.value;
      const obj = Object.assign({}, bn, { value: v });
      const indent = kv.indentOf(text, oK);
      const t = blockText(indent, oK.key, obj, kv.valueColumn(text, oK), oK.comment);
      ed.edits.push({ start: oK.start, end: oK.end, text: t });
      log({ path, kind: 'applied', rule: 'leaf-to-block', valueRule: r.skip ? 'kept' : r.rule, from: oK.value, to: JSON.stringify(obj), lowConfidence: !!r.skip || undefined });
    }
  });

  // every applied action carries its own edits, so port.js --safe can rebuild
  // the file from the objective ones only (see applySafe)
  return { text: ed.apply(), actions };
}

// An applied action that only copies vanilla (no OAA level was invented)
const OBJECTIVE_RULES = new Set(['copy', 'block-to-leaf', 'remove-key', 'remove-sub', 'remove-top', 'rename', 'add-sub', 'add-key', 'leaf-to-block', 'hero-stat', 'slot-comment', 'recipe']);
function isObjective (a) {
  if (a.kind !== 'applied' || a.oaaLevels || a.lowConfidence || !OBJECTIVE_RULES.has(a.rule)) return false;
  if (/-to-/.test(a.rule) && !['copy', 'unchanged'].includes(a.valueRule)) return false;
  return true;
}

/*
  Hero files: compare vanilla Ability slots; OAA only lists the slots it overrides.
*/
function heroSlotReview (text, ctx) {
  const root = kv.parse(text);
  const out = [];
  kv.entries(root).forEach(node => {
    const vo = ctx.vanOld[node.key];
    const vn = ctx.vanNew[node.key];
    if (!vo || !vn) return;
    (node.children || []).forEach(c => {
      if (!/^Ability\d+$/.test(c.key)) return;
      const a = getCI(vo, c.key);
      const b = getCI(vn, c.key);
      if (a === b) return;
      out.push({ entry: node.key, path: c.key, kind: 'review', from: c.value, vanilla: a + ' -> ' + b, note: c.comment ? 'comment: ' + c.comment : 'no comment' });
    });
  });
  return out;
}

/*
  Hero files: slot review plus base stats (AttributeBaseStrength...). A stat
  is copied only when OAA still has the old vanilla value and no OAA comment.
*/
function portHeroFile (text, ctx) {
  const actions = heroSlotReview(text, ctx);
  const ed = new kv.Editor(text);
  kv.entries(kv.parse(text)).forEach(node => {
    const vo = ctx.vanOld[node.key];
    const vn = ctx.vanNew[node.key];
    if (!vo || !vn) return;
    (node.children || []).forEach(c => {
      if (c.children || c.value === undefined || /^Ability\d+$/.test(c.key)) return;
      const a = getCI(vo, c.key);
      const b = getCI(vn, c.key);
      if (typeof a !== 'string' || typeof b !== 'string' || a === b) return;
      if (c.value !== a || PROTECTED.test(c.comment) || /OAA/.test(c.comment)) {
        actions.push({ entry: node.key, path: c.key, kind: 'review', from: c.value, vanilla: a + ' -> ' + b, note: 'OAA hero stat differs from vanilla' + (c.comment ? ': ' + c.comment : '') });
        return;
      }
      const before = ed.edits.length;
      ed.setValue(c, b);
      const act = { entry: node.key, path: c.key, kind: 'applied', rule: 'hero-stat', from: a, to: b, vanilla: a + ' -> ' + b };
      Object.defineProperty(act, 'edits', { value: ed.edits.slice(before), enumerable: false });
      actions.push(act);
    });
  });
  // commented slot lines ( //"Ability14"  "special_bonus_attack_speed_50" ) record
  // the vanilla talent OAA replaced; when vanilla changes that slot, update the note
  // (7.42: Wraith King +50 -> +40 attack speed is a new talent name in the same slot)
  kv.entries(kv.parse(text)).forEach(node => {
    const vo = ctx.vanOld[node.key];
    const vn = ctx.vanNew[node.key];
    if (!vo || !vn) return;
    const re = /^[ \t]*\/\/[ \t]*"(Ability\d+)"[ \t]+"([^"]*)"/gm;
    const body = text.slice(node.start, node.end);
    let m;
    while ((m = re.exec(body))) {
      const a = getCI(vo, m[1]);
      const b = getCI(vn, m[1]);
      if (m[2] !== a || typeof b !== 'string' || a === b) continue;
      // talents that moved between slots also move OAA's own override: a human job
      const slotsOf = h => Object.keys(h).filter(k => /^Ability\d+$/.test(k)).map(k => h[k]);
      if (slotsOf(vn).includes(a) || slotsOf(vo).includes(b)) {
        actions.push({ entry: node.key, path: '//' + m[1], kind: 'review', from: a, vanilla: a + ' -> ' + b, note: 'vanilla moved talents between slots: move the OAA override with them' });
        continue;
      }
      const at = node.start + m.index + m[0].length - 1 - m[2].length;
      const edit = { start: at, end: at + m[2].length, text: b };
      ed.edits.push(edit);
      const act = { entry: node.key, path: '//' + m[1], kind: 'applied', rule: 'slot-comment', from: a, to: b, vanilla: a + ' -> ' + b };
      Object.defineProperty(act, 'edits', { value: [edit], enumerable: false });
      actions.push(act);
    }
  });
  return { text: ed.apply(), actions };
}

// Names of vanilla items whose OAA upgrade tiers are reimplemented in Lua /
// datadriven. texts: array of OAA item file contents.
function findCustomFamilies (texts) {
  const out = new Set();
  texts.forEach(text => {
    kv.entries(kv.parse(text)).forEach(node => {
      const m = node.key.match(/^(item_.+)_(\d)$/);
      const base = (kv.child(node, 'BaseClass') || {}).value;
      if (m && !node.key.startsWith('item_recipe_') && isCustomBase(base)) out.add(m[1]);
    });
  });
  return out;
}

module.exports = { TAPER_KEYS, isTaperKey, portFile, isObjective, heroSlotReview, portHeroFile, findCustomFamilies, vanillaLevels, getCI, TOP_KEYS };
