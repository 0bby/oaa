'use strict';

function esc (s) {
  return String(s === undefined ? '' : s).replace(/\|/g, '\\|');
}

function table (rows, cols) {
  if (!rows.length) return '_none_\n';
  let s = '| ' + cols.map(c => c[0]).join(' | ') + ' |\n|' + cols.map(() => '---').join('|') + '|\n';
  rows.forEach(r => {
    s += '| ' + cols.map(c => esc(c[1](r))).join(' | ') + ' |\n';
  });
  return s;
}

function buildReport (d) {
  const by = k => d.actions.filter(a => a.kind === k);
  const applied = by('applied');
  const rules = {};
  applied.forEach(a => {
    rules[a.rule] = (rules[a.rule] || 0) + 1;
  });
  const low = applied.filter(a => a.lowConfidence);
  let s = '# Dota patch port report\n\n';
  s += 'Vanilla `' + d.from.slice(0, 9) + '` -> `' + d.to.slice(0, 9) + '`. ' +
    (d.applied ? 'Changes were written' : 'Dry run, nothing written') + ' (' + d.filesChanged + ' files).\n\n';
  s += '| Bucket | Count | What to do |\n|---|---|---|\n';
  s += '| Applied | ' + applied.length + ' | Skim the diff; check the low-confidence list below |\n';
  s += '| Low confidence | ' + low.length + ' | New keys / guessed OAA levels: check each |\n';
  s += '| Review | ' + by('review').length + ' | Vanilla changed but OAA diverged: decide by hand |\n';
  s += '| Protected | ' + by('protected').length + ' | Comment says intentionally/because: left alone, re-check balance |\n';
  s += '| Structural (Lua) | ' + by('structural').length + ' | Custom base class: update KV and Lua together |\n';
  s += '| New vanilla entries | ' + d.newEntries.length + ' | New abilities/items: add OAA versions with OAA levels |\n\n';
  s += 'Applied by rule: ' + Object.keys(rules).map(r => r + ' ' + rules[r]).join(', ') + '\n\n';
  const cols = [['File', a => a.file], ['Entry', a => a.entry], ['Path', a => a.path]];
  s += '## Low confidence\n\n' + table(low, cols.concat([['Rule', a => a.rule], ['Was', a => a.from], ['Now', a => a.to]]));
  s += '\n## Review\n\n' + table(by('review'), cols.concat([['OAA', a => a.from], ['Vanilla', a => a.vanilla], ['Why', a => a.note]]));
  s += '\n## Protected\n\n' + table(by('protected'), cols.concat([['OAA', a => a.from], ['Vanilla', a => a.vanilla], ['Comment', a => a.note]]));
  s += '\n## Structural (Lua-backed)\n\n' + table(by('structural'), cols.concat([['Note', a => a.note]]));
  s += '\n## New vanilla entries\n\n' + (d.newEntries.length ? d.newEntries.map(n => '- `' + n + '`').join('\n') + '\n' : '_none_\n');
  s += '\n## Applied\n\n' + table(applied, cols.concat([['Rule', a => a.rule], ['Was', a => a.from], ['Now', a => a.to]]));
  return s;
}

module.exports = { buildReport };
