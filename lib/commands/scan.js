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
    `  ${fmt.paint(fmt.red, String(stats.stale))} stale`,
    `${fmt.paint(fmt.yellow, String(stats.due))} due for review`,
    `${fmt.paint(fmt.yellow, String(stats.dup))} duplicated`,
    `${stats.vendor} vendor`,
    `${stats.unreviewed} never reviewed`
  ].join('   '));
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

  console.log(fmt.table(rows, [
    { title: 'NAME', width: 30, get: (s) => fmt.cut(s.name, 30) },
    { title: 'AGE', width: 8, get: (s) => s.ageDays + 'd' },
    { title: 'STATE', width: 12, get: (s) => (s.flags.stale ? 'stale' : s.flags.dueReview ? 'due' : s.flags.unreviewed ? 'unreviewed' : s.flags.aging ? 'aging' : 'fresh') },
    { title: 'SCOPE', width: 8, get: (s) => (s.scope === 'global' ? 'global' : 'project') },
    { title: 'PROJECT', width: 22, get: (s) => fmt.cut(s.project, 22) },
    { title: 'OS', width: 7, get: (s) => s.os }
  ]));
  if (total > limit) console.log(fmt.paint(fmt.dim, `\n  ... ${total - limit} more (use --limit ${total} or --json)`));
  console.log('');
  return 0;
};

module.exports.collect = collect;
