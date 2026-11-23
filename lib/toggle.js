'use strict';

/**
 * Turning a skill on or off.
 *
 * The only reliable way to make an agent stop loading a skill is to stop it
 * from finding the manifest. So "disabled" is not a flag in a database - it is
 * the file renamed from SKILL.md to SKILL.md.disabled. Nothing is moved,
 * nothing is edited, and renaming it back restores it byte for byte.
 *
 * This is the one place in the tool that writes to your skill folders, which is
 * why it is a separate module: every other path stays read-only.
 */

const fsp = require('fs').promises;
const path = require('path');
const { isWslUnc, parseWslUnc } = require('./util');
const wsl = require('./adapters/wsl');

const ON = 'SKILL.md';
const OFF = 'SKILL.md.disabled';

async function exists(file) {
  try { await fsp.access(file); return true; } catch { return false; }
}

/**
 * @param {object} skill  a scanned skill ({ dir, disabled, file })
 * @param {boolean} enabled  desired state
 * @returns {Promise<{changed: boolean, mtime: number, size: number, file: string}>}
 */
async function setEnabled(skill, enabled) {
  const want = !!enabled;
  const already = skill.disabled ? false : true;
  if (already === want) {
    return { changed: false, mtime: skill.mtime, size: skill.size, file: skill.file };
  }

  const fromName = want ? OFF : ON;
  const toName = want ? ON : OFF;

  if (isWslUnc(skill.dir)) {
    const w = parseWslUnc(skill.dir);
    if (!w) throw new Error('cannot parse WSL path: ' + skill.dir);
    const from = w.posix.replace(/\/+$/, '') + '/' + fromName;
    const to = w.posix.replace(/\/+$/, '') + '/' + toName;
    const st = await wsl.rename(w.distro, from, to);
    return { changed: true, mtime: st.mtime, size: st.size, file: path.join(skill.dir, toName) };
  }

  const from = path.join(skill.dir, fromName);
  const to = path.join(skill.dir, toName);

  if (!(await exists(from))) {
    throw new Error(`cannot find ${fromName} in ${skill.dir}`);
  }
  // Two manifests in one folder is an inconsistent state we refuse to guess at.
  if (await exists(to)) {
    throw new Error(`both ${ON} and ${OFF} exist in ${skill.dir}; fix it by hand`);
  }

  await fsp.rename(from, to);
  const st = await fsp.stat(to);
  return { changed: true, mtime: st.mtimeMs, size: st.size, file: to };
}

/** Quick check used by the CLI before it bothers with a full scan. */
function stateOf(skill) {
  return skill.disabled ? 'off' : 'on';
}

module.exports = { setEnabled, stateOf, ON, OFF };
