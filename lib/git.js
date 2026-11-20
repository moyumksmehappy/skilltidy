'use strict';

const { execFile } = require('child_process');

/**
 * Time of the most recent commit touching a project directory, in ms.
 * Returns null when the directory is not a repo, git is missing, or it times
 * out - git drift is a nice-to-have signal, never a hard dependency.
 */
function lastCommit(dir, { timeout = 2500 } = {}) {
  return new Promise((resolve) => {
    execFile('git', ['-C', dir, 'log', '-1', '--format=%ct'], { timeout, windowsHide: true, encoding: 'utf8' },
      (err, stdout) => {
        if (err) return resolve(null);
        const t = parseInt(String(stdout).trim(), 10);
        resolve(Number.isFinite(t) ? t * 1000 : null);
      });
  });
}

module.exports = { lastCommit };
