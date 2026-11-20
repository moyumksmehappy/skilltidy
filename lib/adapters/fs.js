'use strict';

const fsp = require('fs').promises;
const path = require('path');
const { HEAD_BYTES } = require('../util');

// Dot-directories we still descend into: these are the ones agent tools use to
// keep skills. Everything else hidden (.git, .next, .cache ...) is skipped.
const DOT_ALLOWED = new Set([
  '.claude', '.agents', '.codebuddy', '.codex', '.workbuddy',
  '.iflow', '.cursor', '.worktrees'
]);

async function readHead(file) {
  try {
    const fd = await fsp.open(file, 'r');
    const buf = Buffer.alloc(HEAD_BYTES);
    const { bytesRead } = await fd.read(buf, 0, HEAD_BYTES, 0);
    await fd.close();
    return buf.subarray(0, bytesRead).toString('utf8');
  } catch {
    return '';
  }
}

/**
 * Generic filesystem adapter: Windows, macOS and Linux all use this.
 * Returns every directory that directly contains a SKILL.md.
 */
async function list(rootPath, opts = {}) {
  const maxDepth = opts.maxDepth || 8;
  const skip = new Set((opts.skipDirs || []).map((s) => s.toLowerCase()));
  const found = [];

  async function walk(dir, depth) {
    if (depth > maxDepth) return;
    let ents;
    try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }

    if (ents.some((e) => e.isFile() && e.name.toLowerCase() === 'skill.md')) {
      found.push(dir);
      return;
    }

    for (const e of ents) {
      if (!e.isDirectory()) continue; // symlinks report as links, so no loops
      const name = e.name;
      const low = name.toLowerCase();
      if (skip.has(low)) continue;
      if (name.startsWith('.') && !DOT_ALLOWED.has(low)) continue;
      await walk(path.join(dir, name), depth + 1);
    }
  }

  await walk(rootPath, 0);

  const out = [];
  for (const dir of found) {
    const file = path.join(dir, 'SKILL.md');
    let st;
    try { st = await fsp.stat(file); } catch { continue; }
    out.push({ dir, mtime: st.mtimeMs, size: st.size, head: await readHead(file) });
  }
  return out;
}

module.exports = { id: 'fs', list, readHead };
