'use strict';
/*
  Minimal KeyValues parser that remembers where every key, value and comment
  lives in the source text, so the file can be edited in place without
  touching formatting, key order or comments.

  parse(text) -> root node
  node = {
    key, keyStart, keyEnd,          // key token (offsets of the text inside the quotes)
    value,                          // string for leaf nodes, undefined for blocks
    valueStart, valueEnd,           // leaf value offsets (inside the quotes)
    children,                       // array for block nodes
    comment,                        // trailing // comment on the key line (or value line), '' if none
    start, end,                     // offset of first char of key line .. end of last line (incl. newline)
    parent
  }
*/

function tokenize (text) {
  const toks = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') {
      i++;
    } else if (c === '/' && text[i + 1] === '/') {
      let j = text.indexOf('\n', i);
      if (j < 0) j = n;
      toks.push({ t: 'comment', s: i, e: j, v: text.slice(i + 2, j).replace(/\r$/, '').trim() });
      i = j;
    } else if (c === '"') {
      let j = i + 1;
      while (j < n && text[j] !== '"') {
        j += text[j] === '\\' ? 2 : 1;
      }
      toks.push({ t: 'str', s: i + 1, e: j, v: text.slice(i + 1, j) });
      i = j + 1;
    } else if (c === '{' || c === '}') {
      toks.push({ t: c, s: i, e: i + 1 });
      i++;
    } else if (c === '#') {
      let j = text.indexOf('\n', i);
      if (j < 0) j = n;
      toks.push({ t: 'directive', s: i, e: j, v: text.slice(i, j) });
      i = j;
    } else {
      let j = i;
      while (j < n && !' \t\r\n{}"'.includes(text[j])) j++;
      toks.push({ t: 'str', s: i, e: j, v: text.slice(i, j), bare: true });
      i = j;
    }
  }
  return toks;
}

function lineStart (text, pos) {
  const i = text.lastIndexOf('\n', pos - 1);
  return i + 1;
}

function lineEnd (text, pos) {
  const i = text.indexOf('\n', pos);
  return i < 0 ? text.length : i + 1;
}

function sameLine (text, a, b) {
  return text.slice(Math.min(a, b), Math.max(a, b)).indexOf('\n') < 0;
}

function parse (text) {
  const toks = tokenize(text);
  let p = 0;
  const root = { key: null, children: [], start: 0, end: text.length, comment: '' };

  function trailingComment (afterPos) {
    if (p < toks.length && toks[p].t === 'comment' && sameLine(text, afterPos, toks[p].s)) {
      return toks[p++];
    }
    return null;
  }

  function block (parent) {
    while (p < toks.length) {
      const tk = toks[p];
      if (tk.t === '}') {
        p++;
        return tk;
      }
      if (tk.t !== 'str') {
        p++;
        continue;
      }
      p++;
      const node = { key: tk.v, keyStart: tk.s, keyEnd: tk.e, parent, comment: '', start: lineStart(text, tk.s) };
      let c = trailingComment(tk.e);
      if (c) node.comment = c.v;
      // skip comments between key and value/brace
      while (p < toks.length && toks[p].t === 'comment') p++;
      const nx = toks[p];
      if (!nx) break;
      if (nx.t === '{') {
        p++;
        node.children = [];
        const close = block(node);
        const cc = close ? trailingComment(close.e) : null;
        node.end = close ? lineEnd(text, cc ? cc.e : close.s) : text.length;
      } else if (nx.t === 'str') {
        p++;
        node.value = nx.v;
        node.valueStart = nx.s;
        node.valueEnd = nx.e;
        c = trailingComment(nx.e);
        if (c && !node.comment) node.comment = c.v;
        node.end = lineEnd(text, c ? c.e : nx.e);
      } else {
        continue;
      }
      parent.children.push(node);
    }
    return null;
  }
  block(root);
  return root;
}

function child (node, key) {
  if (!node || !node.children) return null;
  const lk = key.toLowerCase();
  return node.children.find(c => c.key.toLowerCase() === lk) || null;
}

// Top-level entries: the children of the first block (e.g. DOTAAbilities)
function entries (root) {
  const top = root.children.find(c => c.children);
  return top ? top.children.filter(c => c.children) : [];
}

// Plain JS object view (order preserved), for comparisons
function toObject (node) {
  if (!node.children) return node.value;
  const o = {};
  node.children.forEach(c => {
    o[c.key] = toObject(c);
  });
  return o;
}

/*
  Editor: collects edits as {start, end, text} and applies them back to front.
*/
class Editor {
  constructor (text) {
    this.text = text;
    this.edits = [];
  }

  setValue (node, value) {
    if (node.value === value) return;
    this.edits.push({ start: node.valueStart, end: node.valueEnd, text: value });
  }

  renameKey (node, key) {
    if (node.valueStart === undefined) {
      this.edits.push({ start: node.keyStart, end: node.keyEnd, text: key });
      return;
    }
    // leaf: keep the value in its column (rename used to shift it)
    const gap = (node.valueStart - 1) - (node.keyEnd + 1);
    const pad = Math.max(1, gap + (node.keyEnd - node.keyStart) - key.length);
    this.edits.push({ start: node.keyStart, end: node.valueStart - 1, text: key + '"' + ' '.repeat(pad) });
  }

  remove (node) {
    this.edits.push({ start: node.start, end: node.end, text: '' });
  }

  insertAfter (node, text) {
    this.edits.push({ start: node.end, end: node.end, text });
  }

  // Insert as the first child of a block node (after its opening brace line)
  insertFirst (blockNode, text) {
    const brace = this.text.indexOf('{', blockNode.keyEnd);
    const at = lineEnd(this.text, brace);
    this.edits.push({ start: at, end: at, text });
  }

  apply () {
    const sorted = this.edits.slice().sort((a, b) => b.start - a.start || b.end - a.end);
    let out = this.text;
    let lastStart = Infinity;
    sorted.forEach(e => {
      if (e.end > lastStart) { // overlapping edit: keep the later one, say so
        this.dropped = (this.dropped || 0) + 1;
        return;
      }
      out = out.slice(0, e.start) + e.text + out.slice(e.end);
      lastStart = e.start;
    });
    return out;
  }
}

function indentOf (text, node) {
  const ls = lineStart(text, node.keyStart);
  return text.slice(ls, node.keyStart - 1).match(/^[ \t]*/)[0];
}

// Format a leaf line the way OAA files do: values aligned to a column
function formatLeaf (indent, key, value, column, eol) {
  const head = indent + '"' + key + '"';
  const pad = Math.max(1, (column || 58) - head.length);
  return head + ' '.repeat(pad) + '"' + value + '"' + (eol || '\n');
}

function valueColumn (text, node) {
  if (node.valueStart === undefined) return 58;
  const ls = lineStart(text, node.valueStart);
  return node.valueStart - 1 - ls;
}

module.exports = { tokenize, parse, entries, child, toObject, Editor, indentOf, formatLeaf, valueColumn, lineStart, lineEnd };
