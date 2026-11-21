'use strict';
/*
  Given how a value changed in vanilla (vOld -> vNew) and what OAA had (oOld),
  work out the new OAA value.

  OAA values have the vanilla levels first, then extra "OAA levels". When the
  vanilla part of oOld still equals vOld, OAA was tracking vanilla, so the
  vanilla part becomes vNew and the OAA levels are re-derived in the same
  shape they had before:
    flat    - OAA levels repeated the last vanilla value      (7 7 7)
    linear  - OAA levels continued the vanilla step           (2 3 4 5 6 7)
    ratio   - OAA levels were nice multiples of the last one  (290 580 1160)
    offset  - anything else keeps its distance from the last  (55 155 255)
  If the vanilla part differs from vOld, OAA diverged on purpose: skip.
*/

const NUM = /^([+=x]?)(-?(?:\d+\.?\d*|\.\d+))(%?)$/;

function parseTokens (s) {
  if (typeof s !== 'string') return null;
  const parts = s.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return null;
  const out = [];
  for (const raw of parts) {
    const m = raw.match(NUM);
    if (!m) return null;
    const dec = (m[2].split('.')[1] || '').length;
    out.push({ pre: m[1], num: parseFloat(m[2]), suf: m[3], raw, dec });
  }
  return out;
}

function close (a, b) {
  return Math.abs(a - b) < 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));
}

function expand (arr, len) {
  if (arr.length === 1 && len > 1) return Array(len).fill(arr[0]);
  return arr;
}

function fmt (num, dec, pre, suf) {
  const d = Math.min(Math.max(dec, 0), 4);
  // keep the file's decimal style ("2.0" stays "2.0") unless the extra digits are noise
  let s = num.toFixed(d);
  if (d > 0 && Number(s) === Number(num.toFixed(0)) && dec > 1) s = num.toFixed(1);
  if (/^-0(\.0+)?$/.test(s)) s = s.slice(1);
  return (pre || '') + s + (suf || '');
}

// OAA levels that are whole multiples of the last vanilla level (x2, x3, x4)
function nice (r) {
  return r >= 2 - 1e-6 && Math.abs(r - Math.round(r)) < 1e-6;
}

/*
  opts.vanillaLevels: number of vanilla levels (1 for items)
  opts.oaaLevels:     number of levels the OAA entry has (MaxLevel)
  returns { value, rule } or { skip: reason }
*/
function portValue (vOld, vNew, oOld, opts) {
  opts = opts || {};
  if (vOld === vNew) return { value: oOld, rule: 'unchanged' };
  if (oOld === vOld) {
    // exact copy of vanilla (single value or same level count)
    const b = parseTokens(vNew);
    if (!b || b.length === 1 || !opts.oaaLevels || opts.oaaLevels <= b.length) {
      return { value: vNew, rule: 'copy' };
    }
  }
  const a = parseTokens(vOld);
  const b = parseTokens(vNew);
  const o = parseTokens(oOld);
  if (!a || !b || !o) {
    return { skip: 'non-numeric value that differs from vanilla' };
  }

  // OAA has a single value
  if (o.length === 1) {
    const aFlat = a.every(x => close(x.num, a[0].num));
    if (!aFlat || !close(o[0].num, a[0].num)) return { skip: 'OAA diverged from vanilla' };
    if (b.length === 1) return { value: vNew, rule: 'copy' };
    const want = opts.oaaLevels || b.length;
    return { value: extendLinear(b, want, opts.stepFactor), rule: 'new-levels-linear', lowConfidence: true };
  }

  let L;
  if (b.length > 1) L = b.length;
  else if (a.length > 1) L = a.length;
  else L = opts.vanillaLevels || Math.max(1, o.length - 2);
  if (o.length < L) return { skip: 'OAA has fewer levels than vanilla' };

  const A = expand(a, L);
  const B = expand(b, L);
  if (A.length !== L || B.length !== L) return { skip: 'level count mismatch' };
  for (let i = 0; i < L; i++) {
    if (!close(o[i].num, A[i].num)) return { skip: 'OAA diverged from vanilla' };
  }

  const extras = o.slice(L);
  // vanilla collapsed a per-level value into one number: past ports almost
  // always collapsed the OAA value too (backtest: 7.41b-7.41e)
  if (b.length === 1 && a.length > 1) {
    return { value: vNew, rule: 'collapse' };
  }
  const head = b.length === 1 && L > 1
    ? B.map(t => fmt(t.num, t.dec, o[0].pre, t.suf))
    : B.map(t => t.raw);
  if (!extras.length) return { value: head.join(' '), rule: 'copy' };

  const aL = A[L - 1].num;
  const bL = B[L - 1].num;
  const dec = Math.max(...B.map(t => t.dec), ...extras.map(t => t.dec));
  let rule;
  let vals;
  const sA = L >= 2 ? A[L - 1].num - A[L - 2].num : null;
  const sB = L >= 2 ? B[L - 1].num - B[L - 2].num : null;

  let flatLow = false;
  if (extras.every(e => close(e.num, aL))) {
    rule = 'flat';
    vals = extras.map(() => bL);
    flatLow = true; // backtest: maintainers often re-scale plateaus by hand
  } else if (sA !== null && !close(sA, 0) && extras.every((e, i) => close(e.num, aL + sA * (i + 1)))) {
    rule = 'linear';
    vals = extras.map((e, i) => bL + sB * (i + 1));
  } else if (!close(aL, 0) && extras.every(e => nice(e.num / aL))) {
    rule = 'ratio';
    vals = extras.map(e => bL * (e.num / aL));
  } else {
    rule = 'offset';
    vals = extras.map(e => bL + (e.num - aL));
  }
  // never flip the sign of a series (e.g. a cooldown going negative)
  const lowConfidence = vals.some(v => (bL > 0 && v <= 0) || (bL < 0 && v >= 0));
  const tail = vals.map((v, i) => fmt(v, dec, extras[i].pre, extras[i].suf));
  return { value: head.concat(tail).join(' '), rule, lowConfidence: lowConfidence || flatLow || undefined };
}

// factor < 1 tapers the OAA levels (maintainers use about 1/3 of the vanilla step
// for new durations and percentages, e.g. Requiem 1.2 1.5 1.8 -> 1.9 2.0)
function extendLinear (b, want, factor) {
  const L = b.length;
  const dec = Math.max(...b.map(t => t.dec));
  let step = L >= 2 ? b[L - 1].num - b[L - 2].num : 0;
  if (factor && factor !== 1 && step) {
    const unit = Math.pow(10, -dec);
    step = Math.sign(step) * Math.max(unit, Math.round(Math.abs(step) * factor / unit) * unit);
  }
  const out = b.map(t => t.raw);
  for (let i = 1; out.length < want; i++) {
    out.push(fmt(b[L - 1].num + step * i, dec, b[L - 1].pre, b[L - 1].suf));
  }
  return out.join(' ');
}

module.exports = { portValue, parseTokens, extendLinear };
