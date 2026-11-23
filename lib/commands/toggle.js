'use strict';

/**
 * `skilltidy disable <name|id>` / `skilltidy enable <name|id>`
 *
 * Exact name matches hit every copy, which is what you usually want: nine
 * copies of `diagnose` are nine copies of the same problem. A partial match
 * only prints candidates, because renaming the wrong skill is silent breakage.
 */

const config = require('../config');
const meta = require('../meta');
const engine = require('../engine');
const toggle = require('../toggle');
const args = require('../args');
const fmt = require('../format');

function pick(skills, query) {
  const q = query.toLowerCase();
  const exact = skills.filter((s) => s.name.toLowerCase() === q);
  if (exact.length) return { hits: exact, fuzzy: false };
  const byId = skills.filter((s) => s.id === query);
  if (byId.length) return { hits: byId, fuzzy: false };
  return { hits: skills.filter((s) => s.name.toLowerCase().includes(q)), fuzzy: true };
}

module.exports = async function toggleCmd(argv, enabled) {
  const { _ } = args.parse(argv);
  const query = (_[0] || '').trim();
  const verb = enabled ? 'enable' : 'disable';

  if (!query) {
    console.error(`usage: skilltidy ${verb} <name|id>`);
    console.error('');
    console.error(enabled
      ? '  renames SKILL.md.disabled back to SKILL.md so agents load it again'
      : '  renames SKILL.md to SKILL.md.disabled so agents stop loading it');
    return 2;
  }

  const cfg = config.load();
  const m = meta.load();
  const res = await engine.scan(cfg);
  const skills = res.skills.map((s) => ({ ...s, meta: m.skills[s.id] || {} }));

  const { hits, fuzzy } = pick(skills, query);

  if (!hits.length) {
    console.error(`no skill matching "${query}".`);
    return 1;
  }
  if (fuzzy) {
    console.error(`"${query}" does not match a skill name exactly. did you mean:`);
    for (const s of hits.slice(0, 12)) {
      console.error(`  ${s.name.padEnd(34)} ${s.project}`);
    }
    console.error('');
    console.error('use the exact name, or the id shown in the dashboard.');
    return 1;
  }

  let changed = 0;
  let failed = 0;
  for (const s of hits) {
    if (s.disabled === !enabled) {
      console.log(fmt.paint(fmt.dim, `  skip  ${s.name}  already ${enabled ? 'on' : 'off'}`));
      continue;
    }
    try {
      await toggle.setEnabled(s, enabled);
      changed++;
      console.log(`  ${enabled ? 'on ' : 'off'}   ${s.name.padEnd(32)} ${s.project}`);
    } catch (e) {
      failed++;
      console.error(`  FAIL  ${s.name}  ${(e && e.message) || e}`);
    }
  }

  console.log('');
  console.log(`${changed} skill${changed === 1 ? '' : 's'} ${enabled ? 'enabled' : 'disabled'}${failed ? `, ${failed} failed` : ''}`);
  return failed ? 1 : 0;
};
