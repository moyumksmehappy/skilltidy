'use strict';

/**
 * Minimal YAML frontmatter reader for SKILL.md.
 * Only cares about the fields skilltidy needs: name, description, plus a flat
 * bag of everything else (tags, allowed-tools, license ...).
 *
 * Deliberately not a YAML parser: zero dependencies, and skill frontmatter is
 * almost always flat scalars with the odd folded block.
 */

function stripBom(s) {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

function splitFrontmatter(text) {
  const t = stripBom(String(text || '').replace(/\r\n/g, '\n'));
  if (!t.startsWith('---')) return { head: '', body: t, hasFrontmatter: false };
  const end = t.indexOf('\n---', 3);
  if (end < 0) return { head: '', body: t, hasFrontmatter: false };
  return {
    head: t.slice(3, end).replace(/^\n/, ''),
    body: t.slice(end + 4).replace(/^\n+/, ''),
    hasFrontmatter: true
  };
}

function parseFrontmatter(text) {
  const out = { name: '', description: '', tags: [], extra: {} };
  const { head, hasFrontmatter } = splitFrontmatter(text);
  if (!hasFrontmatter) return out;

  const lines = head.split('\n');
  let key = null;
  let buf = '';

  const commit = () => {
    if (!key) return;
    const v = buf.trim();
    if (key === 'name') out.name = unquote(v);
    else if (key === 'description') out.description = unquote(v);
    else if (key === 'tags') out.tags = parseList(v);
    else out.extra[key] = unquote(v);
    key = null;
    buf = '';
  };

  for (const raw of lines) {
    const line = raw.replace(/\t/g, '  ');
    const m = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (m) {
      commit();
      key = m[1];
      let v = m[2].trim();
      if (v === '>' || v === '>-' || v === '|' || v === '|-') v = '';
      else if (/^\[.*\]$/.test(v)) v = v; // inline list, parsed later
      buf = v;
    } else if (key && /^\s+\S/.test(line)) {
      buf = buf ? buf + ' ' + line.trim() : line.trim();
    }
  }
  commit();
  return out;
}

function unquote(v) {
  if (!v) return '';
  if (/^".*"$/.test(v) || /^'.*'$/.test(v)) return v.slice(1, -1);
  return v;
}

function parseList(v) {
  const s = v.trim();
  if (!s) return [];
  if (/^\[.*\]$/.test(s)) {
    return s.slice(1, -1).split(',').map((x) => unquote(x.trim())).filter(Boolean);
  }
  return s.split(',').map((x) => unquote(x.trim())).filter(Boolean);
}

module.exports = { parseFrontmatter, splitFrontmatter };
