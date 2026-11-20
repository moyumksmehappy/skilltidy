'use strict';

const config = require('../config');
const { createServer } = require('../server');
const { openUrl } = require('../adapters');
const fmt = require('../format');
const args = require('../args');

module.exports = async function uiCmd(argv) {
  const { flags } = args.parse(argv);
  const cfg = config.load();

  if (!cfg.roots.length) {
    console.error('no scan roots configured yet.');
    console.error('run `skilltidy init` first (or edit ' + config.configPath() + ')');
    return 1;
  }

  const port = Number(args.flag(flags, 'port', process.env.PORT || cfg.port || 7788));
  const app = createServer();

  try {
    await new Promise((resolve, reject) => {
      app.server.once('error', reject);
      app.server.listen(port, '127.0.0.1', resolve);
    });
  } catch (e) {
    if (e.code === 'EADDRINUSE') {
      console.error(`port ${port} is already in use. try: skilltidy ui --port ${port + 1}`);
      return 1;
    }
    throw e;
  }

  const url = `http://127.0.0.1:${port}`;
  console.log('');
  console.log('  ' + fmt.paint(fmt.bold, 'SkillTidy') + '  ' + fmt.paint(fmt.cyan, url));
  console.log('  ' + fmt.paint(fmt.dim, 'config: ' + config.configPath()));
  console.log('  ' + fmt.paint(fmt.dim, 'ctrl+c to stop'));
  console.log('');

  if (!args.bool(flags, 'no-open') && cfg.openOnStart !== false) openUrl(url);

  if (!app.cache.scannedAt) {
    console.log('  ' + fmt.paint(fmt.dim, 'first scan, this can take a while...'));
    const res = await app.scan();
    console.log('  ' + fmt.paint(fmt.dim, `${res.skills.length} skills in ${(res.durationMs / 1000).toFixed(1)}s`));
    console.log('');
  } else {
    console.log('  ' + fmt.paint(fmt.dim, `${app.cache.skills.length} skills cached (${app.cache.scannedAt})`));
    console.log('');
  }

  return 0;
};
