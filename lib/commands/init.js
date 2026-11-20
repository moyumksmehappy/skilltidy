'use strict';

const config = require('../config');
const detect = require('../detect');
const fmt = require('../format');
const args = require('../args');

/**
 * Detect scan roots on this machine and write ~/.skilltidy/config.json.
 * Idempotent unless --force is passed, because overwriting hand-tuned roots is
 * the kind of thing that makes people distrust a CLI.
 */
module.exports = async function initCmd(argv) {
  const { flags } = args.parse(argv);
  const force = args.bool(flags, 'force');

  if (config.exists() && !force) {
    console.error(`config already exists: ${config.configPath()}`);
    console.error('re-run with --force to detect again (this overwrites scan roots).');
    return 1;
  }

  process.stderr.write('looking for skill directories...\n');
  const roots = await detect.detectAll();

  if (!roots.length) {
    console.error('\nno skills directories found.');
    console.error('add roots by hand in ' + config.configPath());
    return 1;
  }

  const cfg = config.save({ ...config.defaults(), roots });
  const enabled = cfg.roots.filter((r) => r.enabled);

  console.log('');
  console.log(fmt.paint(fmt.bold, `found ${roots.length} candidate root(s), ${enabled.length} enabled`));
  console.log('');
  console.log(fmt.table(cfg.roots, [
    { title: '', width: 3, get: (r) => (r.enabled ? 'x' : '-') },
    { title: 'LABEL', width: 34, get: (r) => fmt.cut(r.label, 34) },
    { title: 'SCOPE', width: 8, get: (r) => r.scope },
    { title: 'PATH', width: 52, get: (r) => fmt.cut(r.path, 52) }
  ]));
  console.log('');
  console.log(fmt.paint(fmt.dim, `config written to ${config.configPath()}`));
  const off = cfg.roots.filter((r) => !r.enabled);
  if (off.length) {
    console.log(fmt.paint(fmt.dim, `${off.length} root(s) kept disabled - no skills folder found in them yet.`));
    console.log(fmt.paint(fmt.dim, 'enable them later in `skilltidy ui` -> settings, if you add skills there.'));
  }
  console.log('');
  console.log('next:');
  console.log('  skilltidy scan    # see what you have');
  console.log('  skilltidy ui      # open the dashboard');
  console.log('');
  return 0;
};
