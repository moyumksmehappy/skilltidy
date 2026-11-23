'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { parseRevList, parseLogLine, commitsAfter } = require('../lib/git');

test('parseRevList keeps only commit shas', () => {
  const out = 'aaa1111\nbbb2222\n\n\nnot-a-sha\nccc3333\n';
  assert.deepStrictEqual(parseRevList(out), ['aaa1111', 'bbb2222', 'ccc3333']);
});

test('parseRevList tolerates empty output', () => {
  assert.deepStrictEqual(parseRevList(''), []);
  assert.deepStrictEqual(parseRevList(null), []);
});

test('parseLogLine reads sha and commit seconds', () => {
  const r = parseLogLine('d4de207abc123\t1770257592\n');
  assert.strictEqual(r.sha, 'd4de207abc123');
  assert.strictEqual(r.at, 1770257592000);
});

test('parseLogLine returns null when nothing was committed', () => {
  assert.strictEqual(parseLogLine(''), null);
  assert.strictEqual(parseLogLine('\n\n'), null);
});

test('commitsAfter counts how far behind HEAD the skill is', () => {
  const shas = ['head000', 'mid0000', 'skill00', 'old0000'];
  assert.strictEqual(commitsAfter(shas, 'head000'), 0);
  assert.strictEqual(commitsAfter(shas, 'mid0000'), 1);
  assert.strictEqual(commitsAfter(shas, 'skill00'), 2);
  assert.strictEqual(commitsAfter(shas, 'old0000'), 3);
});

test('commitsAfter is unknown when the commit is not in history', () => {
  assert.strictEqual(commitsAfter(['a'], 'missing'), null);
  assert.strictEqual(commitsAfter(['a'], null), null);
  assert.strictEqual(commitsAfter([], 'a'), null);
});
