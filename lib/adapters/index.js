'use strict';

const path = require('path');
const { execFile } = require('child_process');
const { isWslUnc } = require('../util');

const fsAdapter = require('./fs');
const wslAdapter = require('./wsl');

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';

/** Pick the traversal strategy for a root path. WSL is a Windows-only special case. */
function resolve(p) {
  return isWslUnc(p) ? wslAdapter : fsAdapter;
}

/** Reveal a file in the OS file manager. UNC paths work on Windows. */
function openPath(file) {
  if (IS_WIN) return execFile('explorer.exe', ['/select,' + file], { windowsHide: true }, () => { });
  if (IS_MAC) return execFile('open', ['-R', file], () => { });
  return execFile('xdg-open', [path.dirname(file)], () => { });
}

function openUrl(url) {
  if (IS_WIN) return execFile('cmd.exe', ['/c', 'start', '', url], { windowsHide: true }, () => { });
  if (IS_MAC) return execFile('open', [url], () => { });
  return execFile('xdg-open', [url], () => { });
}

module.exports = { resolve, openPath, openUrl, fsAdapter, wslAdapter, IS_WIN, IS_MAC };
