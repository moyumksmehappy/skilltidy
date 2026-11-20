'use strict';

const crypto = require('crypto');

const HEAD_BYTES = 2400;

function sha1(s) {
  return crypto.createHash('sha1').update(s).digest('hex');
}

function toPosix(p) {
  return String(p).replace(/\\/g, '/');
}

function isWslUnc(p) {
  return /^\\\\wsl(\.localhost|\$)\\/i.test(String(p));
}

function parseWslUnc(p) {
  const m = /^\\\\wsl(?:\.localhost|\$)\\([^\\]+)\\(.*)$/i.exec(String(p));
  if (!m) return null;
  return { distro: m[1], posix: '/' + m[2].replace(/\\/g, '/') };
}

function toUnc(distro, posix) {
  return '\\\\wsl.localhost\\' + distro + String(posix).replace(/\//g, '\\');
}

function days(ms) {
  return (Date.now() - ms) / 86400000;
}

function humanAge(n) {
  if (n <= 0) return 'today';
  if (n === 1) return '1 day';
  if (n < 30) return n + ' days';
  if (n < 365) return Math.round(n / 30) + ' mo';
  return (n / 365).toFixed(1) + ' yr';
}

function humanBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

module.exports = {
  HEAD_BYTES,
  sha1,
  toPosix,
  isWslUnc,
  parseWslUnc,
  toUnc,
  days,
  humanAge,
  humanBytes
};
