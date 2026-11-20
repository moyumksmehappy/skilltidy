'use strict';

const config = require('../config');
const meta = require('../meta');
const engine = require('../engine');
const rules = require('../rules');
const { openPath } = require('../adapters');
const fmt = require('../format');
const args = require('../args');

/** Reveal a skill folder in Finder / Explorer / xdg-open. */
module.exports = async function openCmd(argv) {
  const { _, flags } = args.parse(argv);
  const query = (_[0] || '').trim();
  if (!query) {
    console.error('usage: skilltidy open <id|name>');
    return 2;
  }

  const cfg = config.load();
  const m = meta.load();
  const res = await engine.scan(cfg);
  const skills = res.skills.map((s) => rules.decorate(s, m.skills[s.id], cfg));
  const q = query.toLowerCase();

  const hit = skills.find((s) => s.id === query)
    || skills.find((s) => s.name.toLowerCase() === q)
    || skills.find((s) => s.name.toLowerCase().includes(q));

  if (!hit) {
    console.error(`no skill matching "${query}".`);
    const near = skills.filter((s) => s.name.toLowerCase().includes(q.slice(0, 4))).slice(0, 8);
    if (near.length) console.error('did you mean: ' + near.map((s) => s.name).join(', '));
    return 1;
  }

  openPath(hit.file);
  if (args.bool(flags, 'print')) console.log(hit.file);
  else console.log(fmt.paint(fmt.dim, hit.file));
  return 0;
};
