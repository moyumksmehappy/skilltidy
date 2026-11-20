#!/usr/bin/env node
'use strict';

const pkg = require('../package.json');

const COMMANDS = {
  init: () => require('../lib/commands/init'),
  scan: () => require('../lib/commands/scan'),
  check: () => require('../lib/commands/check'),
  ui: () => require('../lib/commands/ui'),
  open: () => require('../lib/commands/open')
};

const HELP = `
  ${pkg.name} ${pkg.version} - audit the agent skills you wrote

  usage
    skilltidy <command> [options]

  commands
    init              detect skill directories on this machine, write config
    scan              list skills by how much attention they need
    check             CI gate: exit 1 when skills are stale / duplicated / drifted
    ui                open the local dashboard  (default command)
    open <name|id>    reveal a skill folder in the file manager

  options
    --port <n>        ui port (default 7788)
    --no-open         do not launch a browser
    --json            machine readable output
    --limit <n>       scan: rows to print (default 25)
    --fail-on a,b     check: stale,due,drift,dup,unreviewed  (default: stale)
    --days <n>        stale threshold override, in days
    --force           init: overwrite an existing config
    -h, --help        -v, --version

  examples
    npx skilltidy init
    npx skilltidy scan --limit 40
    npx skilltidy ui
    npx skilltidy check --fail-on stale,dup --days 60

  state lives in ~/.skilltidy (override with SKILLTIDY_HOME)
`;

async function main(argv) {
  const first = argv[0];
  const isFlag = first && first.startsWith('-');

  if (!first || first === 'help' || first === '--help' || first === '-h') {
    process.stdout.write(HELP);
    return 0;
  }
  if (first === '--version' || first === '-v' || first === 'version') {
    process.stdout.write(pkg.version + '\n');
    return 0;
  }

  const name = isFlag ? 'ui' : first;
  const rest = isFlag ? argv : argv.slice(1);
  const loader = COMMANDS[name];

  if (!loader) {
    process.stderr.write(`unknown command: ${name}\n`);
    process.stdout.write(HELP);
    return 2;
  }

  const cmd = loader();
  return cmd(rest);
}

main(process.argv.slice(2))
  .then((code) => { process.exitCode = code || 0; })
  .catch((err) => {
    process.stderr.write('\n' + ((err && err.stack) || String(err)) + '\n');
    process.exitCode = 1;
  });
