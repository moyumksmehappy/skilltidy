'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { parseFrontmatter, splitFrontmatter } = require('../lib/frontmatter');

test('reads name and description', () => {
  const md = `---\nname: k8s-logs\ndescription: Tail logs from a pod. Use when debugging a crashloop.\n---\n\n# k8s logs\n`;
  const fm = parseFrontmatter(md);
  assert.strictEqual(fm.name, 'k8s-logs');
  assert.strictEqual(fm.description, 'Tail logs from a pod. Use when debugging a crashloop.');
});

test('handles folded description blocks', () => {
  const md = `---\nname: pr\ndescription: >-\n  Draft a pull request description\n  from the current diff.\n---\nbody\n`;
  const fm = parseFrontmatter(md);
  assert.strictEqual(fm.description, 'Draft a pull request description from the current diff.');
});

test('strips matching quotes', () => {
  const fm = parseFrontmatter(`---\nname: "quoted name"\ndescription: 'single'\n---\n`);
  assert.strictEqual(fm.name, 'quoted name');
  assert.strictEqual(fm.description, 'single');
});

test('parses inline and comma tags', () => {
  assert.deepStrictEqual(parseFrontmatter(`---\ntags: [a, b]\n---\n`).tags, ['a', 'b']);
  assert.deepStrictEqual(parseFrontmatter(`---\ntags: a, b\n---\n`).tags, ['a', 'b']);
});

test('ignores files without frontmatter', () => {
  const fm = parseFrontmatter('# just a heading\n');
  assert.strictEqual(fm.name, '');
  assert.strictEqual(fm.description, '');
});

test('keeps extra keys out of name/description', () => {
  const fm = parseFrontmatter(`---\nname: x\ndescription: y\nallowed-tools: Bash(python:*)\n---\n`);
  assert.strictEqual(fm.extra['allowed-tools'], 'Bash(python:*)');
});

test('splitFrontmatter returns the body', () => {
  const { body, hasFrontmatter } = splitFrontmatter(`---\nname: x\n---\n\n# Title\n`);
  assert.ok(hasFrontmatter);
  assert.strictEqual(body.trim(), '# Title');
});

test('tolerates CRLF and BOM', () => {
  const fm = parseFrontmatter('\uFEFF---\r\nname: win\r\ndescription: crlf\r\n---\r\n');
  assert.strictEqual(fm.name, 'win');
  assert.strictEqual(fm.description, 'crlf');
});
