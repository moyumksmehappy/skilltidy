'use strict';

const config = require('../config');
const meta = require('../meta');
const engine = require('../engine');
const rules = require('../rules');
const fmt = require('../format');
const args = require('../args');

async function collect(cfg) {
  const m = meta.load();
  const res = await engine.scan(cfg);
  const skills = res.skills.map((s) => rules.decorate(s, m.skills[s.id], cfg));
  return { res, skills, stats: rules.summarize(skills) };
}

module.exports = async function scanCmd(argv) {
  const { flags } = args.parse(argv);
  const cfg = config.load();
  const json = args.bool(flags, 'json');
  const limit = Number(args.flag(flags, 'limit', 25));

  const { res, skills, stats } = await collect(cfg);

  if (json) {
    process.stdout.write(JSON.stringify({ ...res, skills, stats }, null, 2) + '\n');
    return 0;
  }

  const total = skills.length;
  console.log('');
  console.log(fmt.paint(fmt.bold, `SkillTidy - ${stats.total} skills`) + fmt.paint(fmt.dim, `  (${(res.durationMs / 1000).toFixed(1)}s, ${cfg.roots.filter((r) => r.enabled).length} roots)`));
  console.log([
    `${fmt.paint(fmt.red, String(stats.decisions))} need a decision`,
    `${fmt.paint(fmt.green, String(stats.reviewed))} confirmed`,
    `${stats.unreviewed} never confirmed`
  ].join('   '));
  console.log(fmt.paint(fmt.dim, [
    `${stats.drift} drifted`,
    `${stats.stale} untouched ${cfg.staleDays}d+`,
    `${stats.vendor} vendor`
  ].join('   ')));
  if (res.errors.length) {
    console.log(fmt.paint(fmt.red, '  scan errors: ') + res.errors.map((e) => `${e.root}: ${e.message}`).join('; '));
  }
  console.log('');

  const rows = skills
    .slice()
    .sort((a, b) => rules.attentionScore(b) - rules.attentionScore(a) || b.ageDays - a.ageDays)
    .slice(0, limit);

  if (!rows.length) {
    console.log(fmt.paint(fmt.dim, '  no skills found. run `skilltidy init` to detect scan roots.'));
    return 0;
  }

  const state = (s) => {
    if (s.flags.drift) return `drift +${s.driftCommits}`;
    if (s.flags.dup) return `dup x${s.dupCount}`;
    if (s.flags.dueReview) return 'due';
    if (s.flags.reviewed) return 'ok';
    return 'new';
  };

  console.log(fmt.table(rows, [
    { title: 'NAME', width: 28, get: (s) => fmt.cut(s.name, 28) },
    { title: 'STATE', width: 11, get: state },
    { title: 'CONFIRMED', width: 10, get: (s) => (s.sinceReview === null ? 'never' : s.sinceReview + 'd ago') },
    { title: 'UPDATED', width: 8, get: (s) => s.ageDays + 'd' },
    { title: 'SCOPE', width: 7, get: (s) => (s.scope === 'global' ? 'global' : 'project') },
    { title: 'PROJECT', width: 20, get: (s) => fmt.cut(s.project, 20) }
  ]));
  if (total > limit) console.log(fmt.paint(fmt.dim, `\n  ... ${total - limit} more (use --limit ${total} or --json)`));
  console.log('');
  return 0;
};

module.exports.collect = collect;
