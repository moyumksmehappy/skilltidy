'use strict';

const config = require('../config');
const meta = require('../meta');
const engine = require('../engine');
const rules = require('../rules');
const fmt = require('../format');
const args = require('../args');

const KINDS = ['stale', 'due', 'drift', 'dup', 'unreviewed'];

/**
 * CI gate: exit 1 when anything you asked about is violated.
 *   skilltidy check --fail-on stale,dup
 *   skilltidy check --days 30
 */
module.exports = async function checkCmd(argv) {
  const { flags } = args.parse(argv);
  const failOn = String(args.flag(flags, 'fail-on', 'stale'))
    .split(',').map((s) => s.trim()).filter(Boolean);
  const unknown = failOn.filter((k) => !KINDS.includes(k));
  if (unknown.length) {
    console.error(`unknown --fail-on value(s): ${unknown.join(', ')}\nknown: ${KINDS.join(', ')}`);
    return 2;
  }

  const cfg = config.load();
  const days = Number(args.flag(flags, 'days', 0));
  const driftCommits = Number(args.flag(flags, 'drift-commits', 0));
  const effective = { ...cfg };
  if (days) effective.staleDays = days;
  if (driftCommits) effective.driftCommits = driftCommits;

  const m = meta.load();
  const res = await engine.scan(cfg);
  const skills = res.skills.map((s) => rules.decorate(s, m.skills[s.id], effective));

  const violations = {};
  for (const k of KINDS) {
    // A disabled skill is switched off on purpose: it cannot rot in a way that
    // should fail a build, so it is out of every rule.
    violations[k] = skills.filter((s) => !s.meta.archived && !s.flags.disabled && s.flags[k === 'due' ? 'dueReview' : k]);
  }

  const failing = failOn.filter((k) => violations[k].length > 0);

  if (args.bool(flags, 'json')) {
    process.stdout.write(JSON.stringify({
      ok: failing.length === 0,
      failOn,
      failing,
      counts: Object.fromEntries(KINDS.map((k) => [k, violations[k].length])),
      violations: Object.fromEntries(KINDS.map((k) => [k, violations[k].map((s) => ({
        id: s.id, name: s.name, project: s.project, os: s.os, ageDays: s.ageDays, path: s.file
      }))]))
    }, null, 2) + '\n');
    return failing.length ? 1 : 0;
  }

  const label = { stale: 'stale', due: 'due for review', drift: 'project moved on', dup: 'duplicated', unreviewed: 'never reviewed' };

  console.log('');
  for (const k of failOn) {
    const list = violations[k];
    if (!list.length) {
      console.log(`  ${fmt.paint(fmt.green, 'ok')}  ${label[k]}: 0`);
      continue;
    }
    console.log(`  ${fmt.paint(fmt.red, 'fail')}  ${label[k]}: ${list.length}`);
    const show = list.slice(0, 15);
    for (const s of show) {
      console.log(fmt.paint(fmt.dim, `        ${fmt.pad(fmt.cut(s.name, 34), 36)}${fmt.pad(fmt.cut(s.project, 22), 24)}${s.os}  ${s.ageDays}d`));
    }
    if (list.length > show.length) console.log(fmt.paint(fmt.dim, `        ... ${list.length - show.length} more`));
  }
  console.log('');
  console.log(failing.length
    ? fmt.paint(fmt.red, `  ${failing.join(' + ')} -> exit 1`)
    : fmt.paint(fmt.green, '  all clear -> exit 0'));
  console.log('');
  return failing.length ? 1 : 0;
};
