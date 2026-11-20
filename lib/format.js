'use strict';

/** Terminal helpers. CJK counts as two columns so tables stay aligned. */

function width(s) {
  let w = 0;
  for (const ch of String(s)) {
    const c = ch.codePointAt(0);
    w += (c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3)
      || (c >= 0xf900 && c <= 0xfaff) || (c >= 0xfe30 && c <= 0xfe6f) || (c >= 0xff00 && c <= 0xff60)
      || (c >= 0xffe0 && c <= 0xffe6) ? 2 : 1;
  }
  return w;
}

function pad(s, n) {
  const str = String(s == null ? '' : s);
  return str + ' '.repeat(Math.max(0, n - width(str)));
}

function cut(s, n) {
  const str = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  if (width(str) <= n) return str;
  let out = '';
  let w = 0;
  for (const ch of str) {
    const cw = width(ch);
    if (w + cw > n - 2) break;
    out += ch;
    w += cw;
  }
  return out + '..';
}

function table(rows, columns) {
  const head = columns.map((c) => pad(c.title, c.width)).join('  ');
  const lines = rows.map((r) => columns.map((c) => pad(c.get(r), c.width)).join('  ').replace(/\s+$/, ''));
  return [head, '-'.repeat(width(head)), ...lines].join('\n');
}

const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const cyan = (s) => `\x1b[36m${s}\x1b[0m`;

const supportsColor = () => process.stdout.isTTY && !process.env.NO_COLOR;

function paint(fn, s) {
  return supportsColor() ? fn(s) : String(s);
}

module.exports = { width, pad, cut, table, dim, bold, red, yellow, green, cyan, paint };
