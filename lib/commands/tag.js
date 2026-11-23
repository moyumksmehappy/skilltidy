'use strict';

/**
 * `skilltidy tag <name|id> --add a,b --remove c`
 * `skilltidy tag --list`
 *
 * Tags live in ~/.skilltidy/meta.json, never in your skill files, so they sync
 * between machines without touching the repos. Frontmatter tags are shown too
 * but are read-only from here - they belong to the file.
 */

const config = require('../config');
const meta = require('../meta');
const engine = require('../engine');
const rules = require('../rules');
const args = require('../args');
const fmt = require('../format');

const split = (v) => String(v || '').split(/[,，]/).map((t) => t.trim()).filter(Boolean);

module.exports = async function tagCmd(argv) {
  const { _, flags } = args.parse(argv);
  const cfg = config.load();
  const m = meta.load();
  const res = await engine.scan(cfg);
  const skills = res.skills.map((s) => rules.decorate(s, m.skills[s.id], cfg));
  const visible = skills.filter((s) => !s.meta.archived && !s.flags.disabled);

  if (args.bool(flags, 'list') || !_[0]) {
    const counts = rules.tagCounts(visible);
    if (!counts.length) {
      console.log(fmt.paint(fmt.dim, '  no tags yet. add one with: skilltidy tag <name> --add <tag>'));
      return 0;
    }
    console.log('');
    for (const { tag, n } of counts) {
      console.log(`  ${String(n).padStart(4)}  ${tag}`);
    }
    console.log('');
    console.log(fmt.paint(fmt.dim, `  ${counts.length} tags across ${visible.length} skills`));
    return 0;
  }

  const query = _[0].trim();
  const add = split(args.flag(flags, 'add', ''));
  const remove = split(args.flag(flags, 'remove', ''));
  if (!add.length && !remove.length) {
    console.error('usage: skilltidy tag <name|id> --add a,b [--remove c]');
    return 2;
  }

  const q = query.toLowerCase();
  let hits = skills.filter((s) => s.name.toLowerCase() === q);
  const fuzzy = !hits.length;
  if (fuzzy) hits = skills.filter((s) => s.name.toLowerCase().includes(q));

  if (!hits.length) {
    console.error(`no skill matching "${query}".`);
    return 1;
  }
  if (fuzzy) {
    console.error(`"${query}" does not match a skill name exactly. did you mean:`);
    for (const s of hits.slice(0, 12)) console.error(`  ${s.name.padEnd(34)} ${s.project}`);
    return 1;
  }

  for (const s of hits) {
    const cur = (m.skills[s.id] && m.skills[s.id].tags) || [];
    const lower = new Set(remove.map((t) => t.toLowerCase()));
    const next = cur.filter((t) => !lower.has(t.toLowerCase()));
    for (const t of add) {
      if (!next.some((x) => x.toLowerCase() === t.toLowerCase())) next.push(t);
    }
    meta.patch(m, s.id, { tags: next });
    console.log(`  ${s.name.padEnd(32)} ${s.project.padEnd(22)} ${next.join(', ') || '(no tags)'}`);
  }

  console.log('');
  console.log(`${hits.length} skill${hits.length === 1 ? '' : 's'} updated`);
  return 0;
};
