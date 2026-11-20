'use strict';

const test = require('node:test');
const assert = require('node:assert');
const rules = require('../lib/rules');
const { classify, skillId } = require('../lib/engine');
const { toPosix } = require('../lib/util');

const DAY = 86400000;
const ago = (n) => Date.now() - n * DAY;

function skill(over = {}) {
  return {
    id: 'abc123456789',
    name: 'demo',
    mtime: ago(10),
    dupCount: 1,
    sameContentCount: 1,
    driftDays: null,
    scope: 'project',
    project: 'p',
    ...over
  };
}

test('fresh skill nobody reviewed is flagged unreviewed, not stale', () => {
  const s = rules.decorate(skill({ mtime: ago(5) }), null, { staleDays: 90, reviewDays: 45 });
  assert.strictEqual(s.flags.stale, false);
  assert.strictEqual(s.flags.unreviewed, true);
  assert.strictEqual(s.status, 'unreviewed');
});

test('stale wins over unreviewed', () => {
  const s = rules.decorate(skill({ mtime: ago(120) }), null, { staleDays: 90 });
  assert.strictEqual(s.flags.stale, true);
  assert.strictEqual(s.status, 'stale');
});

test('reviewed long ago becomes due for review', () => {
  const s = rules.decorate(skill({ mtime: ago(5) }), { reviewedAt: new Date(ago(60)).toISOString() }, { reviewDays: 45 });
  assert.strictEqual(s.flags.unreviewed, false);
  assert.strictEqual(s.flags.dueReview, true);
  assert.strictEqual(s.status, 'due');
});

test('recent review keeps it fresh', () => {
  const s = rules.decorate(skill({ mtime: ago(5) }), { reviewedAt: new Date(ago(2)).toISOString() }, { reviewDays: 45 });
  assert.strictEqual(s.status, 'fresh');
  assert.strictEqual(s.sinceReview, 2);
});

test('stale threshold is configurable', () => {
  const s = rules.decorate(skill({ mtime: ago(40) }), null, { staleDays: 30 });
  assert.strictEqual(s.flags.stale, true);
});

test('duplicate flag follows dupCount', () => {
  assert.strictEqual(rules.decorate(skill({ dupCount: 3 }), null, {}).flags.dup, true);
  assert.strictEqual(rules.decorate(skill({ dupCount: 1 }), null, {}).flags.dup, false);
});

test('drift needs more than a week and a known commit', () => {
  assert.strictEqual(rules.decorate(skill({ driftDays: 3 }), null, {}).flags.drift, false);
  assert.strictEqual(rules.decorate(skill({ driftDays: 30 }), null, {}).flags.drift, true);
  assert.strictEqual(rules.decorate(skill({ driftDays: null }), null, {}).flags.drift, false);
});

test('summarize ignores archived skills', () => {
  const list = [
    rules.decorate(skill({ mtime: ago(200) }), null, { staleDays: 90 }),
    rules.decorate(skill({ id: 'b', mtime: ago(1) }), { archived: true }, { staleDays: 90 })
  ];
  const st = rules.summarize(list);
  assert.strictEqual(st.total, 1);
  assert.strictEqual(st.stale, 1);
  assert.strictEqual(st.archived, 1);
});

test('duplicateGroups groups by name and by content', () => {
  const a = { name: 'Diagnose', headHash: 'h1' };
  const b = { name: 'diagnose', headHash: 'h1' };
  const c = { name: 'diagnose', headHash: 'h2' };
  const { byName, byHash } = rules.duplicateGroups([a, b, c]);
  assert.strictEqual(byName.get('diagnose').length, 3);
  assert.strictEqual(byHash.get('h1').length, 2);
  assert.strictEqual(byHash.get('h2').length, 1);
});

test('classify understands <project>/.claude/skills/<name>', () => {
  const root = { path: '/pros', scope: 'project' };
  const info = classify('/pros/api/.claude/skills/diagnose', root);
  assert.strictEqual(info.projectName, 'api');
  assert.strictEqual(toPosix(info.projectPath), '/pros/api');
  assert.strictEqual(info.worktree, false);
  assert.strictEqual(info.toolDir, '.claude');
});

test('classify understands <project>/skills/<name>', () => {
  const info = classify('/pros/api/skills/diagnose', { path: '/pros', scope: 'project' });
  assert.strictEqual(info.projectName, 'api');
});

test('classify marks worktree copies', () => {
  const info = classify('/pros/api/.claude/worktrees/feat-x/skills/diagnose', { path: '/pros', scope: 'project' });
  assert.strictEqual(info.worktree, true);
  assert.strictEqual(info.projectName, 'api');
});

test('classify names global roots', () => {
  const info = classify('/home/u/.claude/skills/find-skills', { path: '/home/u/.claude', scope: 'global' });
  assert.strictEqual(info.projectName, 'global');
});

test('skillId is stable across absolute locations with the same root id', () => {
  const a = skillId('root-a', 'proj/.claude/skills/x');
  const b = skillId('root-a', 'proj/.claude/skills/x');
  const c = skillId('root-b', 'proj/.claude/skills/x');
  assert.strictEqual(a, b);
  assert.notStrictEqual(a, c);
});
