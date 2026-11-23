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
  assert.strictEqual(s.flags.neverReviewed, true);
  assert.strictEqual(s.status, 'new');
});

test('age alone does not make a skill a decision', () => {
  const s = rules.decorate(skill({ mtime: ago(400) }), null, { staleDays: 90 });
  assert.strictEqual(s.flags.stale, true);
  assert.strictEqual(s.decision, null, 'being old is not evidence of being wrong');
});

test('reviewed long ago becomes due for review', () => {
  const s = rules.decorate(skill({ mtime: ago(5) }), { reviewedAt: new Date(ago(60)).toISOString() }, { reviewDays: 45 });
  assert.strictEqual(s.flags.unreviewed, false);
  assert.strictEqual(s.flags.reviewed, true);
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

test('drift is a commit count, not a date', () => {
  const cfg = { driftCommits: 10 };
  assert.strictEqual(rules.decorate(skill({ driftCommits: 9 }), null, cfg).flags.drift, false);
  assert.strictEqual(rules.decorate(skill({ driftCommits: 10 }), null, cfg).flags.drift, true);
  assert.strictEqual(rules.decorate(skill({ driftCommits: 0 }), null, cfg).flags.drift, false);
  assert.strictEqual(rules.decorate(skill({ driftCommits: null }), null, cfg).flags.drift, false);
  assert.strictEqual(rules.decorate(skill({ driftCommits: undefined }), null, cfg).flags.drift, false);
});

test('drift threshold is configurable', () => {
  assert.strictEqual(rules.decorate(skill({ driftCommits: 30 }), null, { driftCommits: 50 }).flags.drift, false);
  assert.strictEqual(rules.decorate(skill({ driftCommits: 30 }), null, { driftCommits: 20 }).flags.drift, true);
});

test('a confirmation newer than the last commit settles the drift', () => {
  const head = ago(30);
  const base = { driftCommits: 40, projectHeadAt: head };
  const stale = rules.decorate(skill(base), null, { driftCommits: 10 });
  assert.strictEqual(stale.flags.drift, true);

  const afterHead = rules.decorate(skill(base), { reviewedAt: new Date(ago(2)).toISOString() }, { driftCommits: 10 });
  assert.strictEqual(afterHead.flags.drift, false);
  assert.strictEqual(afterHead.flags.driftSettled, true);
  assert.strictEqual(afterHead.decision, null);

  const beforeHead = rules.decorate(skill(base), { reviewedAt: new Date(ago(60)).toISOString() }, { driftCommits: 10 });
  assert.strictEqual(beforeHead.flags.drift, true, 'confirming before the commits landed does not count');
});

test('drift outranks duplicate as the decision', () => {
  const both = rules.decorate(skill({ driftCommits: 50, dupCount: 3 }), null, { driftCommits: 10 });
  assert.strictEqual(both.decision, 'drift');
  const dupOnly = rules.decorate(skill({ driftCommits: 0, dupCount: 3 }), null, { driftCommits: 10 });
  assert.strictEqual(dupOnly.decision, 'dup');
});

test('a reviewed skill stops being a decision but can still be due', () => {
  const s = rules.decorate(skill({ driftCommits: 0, dupCount: 1, mtime: ago(200) }),
    { reviewedAt: new Date(ago(2)).toISOString() }, { driftCommits: 10, staleDays: 90 });
  assert.strictEqual(s.decision, null);
  assert.strictEqual(s.flags.reviewed, true);
  assert.strictEqual(s.flags.dueReview, false);
  assert.strictEqual(s.status, 'fresh');
});

test('summarize counts decisions and the ledger separately', () => {
  const list = [
    rules.decorate(skill({ id: 'a', driftCommits: 30 }), null, { driftCommits: 10 }),
    rules.decorate(skill({ id: 'b', dupCount: 2 }), null, {}),
    rules.decorate(skill({ id: 'c', mtime: ago(300) }), { reviewedAt: new Date(ago(1)).toISOString() }, {})
  ];
  const st = rules.summarize(list);
  assert.strictEqual(st.decisions, 2);
  assert.strictEqual(st.drift, 1);
  assert.strictEqual(st.dup, 1);
  assert.strictEqual(st.reviewed, 1);
  assert.strictEqual(st.unreviewed, 2);
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
