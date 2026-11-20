'use strict';

/** Tiny argv parser: `--flag`, `--key value`, `--key=value`, `-h`. */
function parse(argv) {
  const out = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { out._.push(...argv.slice(i + 1)); break; }
    if (a.startsWith('--')) {
      const body = a.slice(2);
      const eq = body.indexOf('=');
      if (eq > -1) { out.flags[body.slice(0, eq)] = body.slice(eq + 1); continue; }
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('-')) { out.flags[body] = next; i++; }
      else out.flags[body] = true;
      continue;
    }
    if (a.startsWith('-') && a.length > 1) { out.flags[a.slice(1)] = true; continue; }
    out._.push(a);
  }
  return out;
}

const flag = (flags, name, fallback) => (flags[name] === undefined ? fallback : flags[name]);
const bool = (flags, name) => flags[name] === true || flags[name] === 'true';

module.exports = { parse, flag, bool };
