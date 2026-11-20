'use strict';

const path = require('path');
const { parseFrontmatter } = require('./frontmatter');
const { sha1, toPosix, isWslUnc } = require('./util');
const { TOOL_DIRS } = require('./config');
const { resolve: resolveAdapter } = require('./adapters');
const git = require('./git');

/**
 * Stable, sync-friendly id. Derived from the root id + path relative to it, so
 * that the same skill keeps the same id when the folder sits at a different
 * absolute location on another machine (as long as the root is named the same).
 */
function skillId(rootId, rel) {
  return sha1(rootId + '|' + rel).slice(0, 12);
}

function platformTag(p) {
  if (isWslUnc(p)) return 'wsl';
  if (process.platform === 'win32') return 'windows';
  if (process.platform === 'darwin') return 'macos';
  return 'linux';
}

/**
 * Work out which project a skill belongs to, from its path alone.
 *
 * Recognises both layouts people actually use:
 *   <project>/.claude/skills/<name>/SKILL.md
 *   <project>/skills/<name>/SKILL.md
 */
function classify(dir, root) {
  const posixDir = toPosix(dir);
  const rootPosix = toPosix(root.path).replace(/\/+$/, '');
  const rel = posixDir.startsWith(rootPosix)
    ? posixDir.slice(rootPosix.length).replace(/^\/+/, '')
    : posixDir;
  const segs = rel.split('/').filter(Boolean);

  let toolIdx = -1;
  for (let i = segs.length - 1; i >= 0; i--) {
    if (TOOL_DIRS.includes(segs[i].toLowerCase())) { toolIdx = i; break; }
  }

  let projectSegs;
  if (toolIdx >= 0) {
    projectSegs = segs.slice(0, toolIdx);
  } else {
    projectSegs = segs.slice(0, Math.max(0, segs.length - 2));
  }

  const isGlobal = (root.scope || 'project') === 'global';
  const projectName = isGlobal
    ? 'global'
    : (projectSegs.length ? projectSegs[projectSegs.length - 1] : path.basename(root.path));
  const projectPath = isGlobal
    ? root.path
    : path.join(root.path, ...(projectSegs.length ? projectSegs : []));

  // Both spellings show up in the wild: `.../.worktrees/...` and
  // `.../.claude/worktrees/...`.
  const worktree = /(^|\/)(\.)?worktrees?\//.test('/' + rel + '/');

  return {
    rel,
    skillName: segs.length ? segs[segs.length - 1] : path.basename(dir),
    projectName,
    projectPath,
    projectSegs: projectSegs.join('/'),
    toolDir: toolIdx >= 0 ? segs[toolIdx] : '',
    worktree,
    isGlobal
  };
}

/**
 * Walk every enabled root and return the normalised skill list.
 * Read-only: never writes to a skill file, never moves anything.
 */
async function scan(cfg, opts = {}) {
  const t0 = Date.now();
  const errors = [];
  const all = [];
  const roots = (cfg.roots || []).filter((r) => r.enabled !== false);
  const onRoot = opts.onRoot || (() => {});

  for (const root of roots) {
    const adapter = resolveAdapter(root.path);
    let items = [];
    try {
      items = await adapter.list(root.path, {
        maxDepth: root.maxDepth || 8,
        skipDirs: cfg.skipDirs || []
      });
    } catch (e) {
      errors.push({ root: root.id, message: String((e && e.message) || e) });
    }

    for (const it of items) {
      const info = classify(it.dir, root);
      const fm = parseFrontmatter(it.head);
      const headHash = sha1(String(it.head || '').replace(/\r\n/g, '\n'));
      const lowerDir = toPosix(it.dir).toLowerCase();
      const vendor = (cfg.vendorPatterns || []).some((p) => lowerDir.includes(String(p).toLowerCase()));

      all.push({
        id: skillId(root.id, info.rel),
        name: (fm.name || info.skillName || path.basename(it.dir)).trim(),
        description: (fm.description || '').trim(),
        tags: fm.tags || [],
        dir: it.dir,
        file: path.join(it.dir, 'SKILL.md'),
        rootId: root.id,
        rootLabel: root.label,
        device: root.device || '',
        os: platformTag(it.dir),
        scope: root.scope || 'project',
        kind: vendor ? 'vendor' : (root.kind || 'mine'),
        toolDir: info.toolDir,
        project: info.projectName,
        projectPath: info.projectPath,
        rel: info.rel,
        worktree: info.worktree,
        mtime: it.mtime,
        size: it.size,
        headHash,
        dupCount: 1,
        sameContentCount: 1,
        projectCommit: null,
        driftDays: null
      });
    }
    onRoot(root, items.length);
  }

  const byName = new Map();
  const byHash = new Map();
  for (const s of all) {
    const key = (s.name || '').toLowerCase();
    byName.set(key, (byName.get(key) || 0) + 1);
    byHash.set(s.headHash, (byHash.get(s.headHash) || 0) + 1);
  }
  for (const s of all) {
    s.dupCount = byName.get((s.name || '').toLowerCase()) || 1;
    s.sameContentCount = byHash.get(s.headHash) || 1;
  }

  // Project drift: is the repo newer than the skill? Windows side only by
  // default - waking a whole WSL distro just to read one commit time is rude.
  if (cfg.git && cfg.git.enabled && opts.git !== false) {
    const skipWsl = cfg.git.wsl === false;
    const targets = [...new Set(all.filter((s) => !s.worktree).map((s) => s.projectPath))]
      .filter((p) => p && !(skipWsl && isWslUnc(p)))
      .slice(0, 150);
    const cache = new Map();
    for (const p of targets) {
      const t = await git.lastCommit(p);
      if (t) cache.set(p, t);
    }
    for (const s of all) {
      const gc = cache.get(s.projectPath);
      if (!gc) continue;
      s.projectCommit = gc;
      s.driftDays = gc > s.mtime ? Math.round((gc - s.mtime) / 86400000) : null;
    }
  }

  all.sort((a, b) => b.mtime - a.mtime);

  return {
    version: 1,
    scannedAt: new Date().toISOString(),
    durationMs: Date.now() - t0,
    errors,
    skills: all
  };
}

module.exports = { scan, classify, skillId };
