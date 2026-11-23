'use strict';

const path = require('path');
const { parseFrontmatter } = require('./frontmatter');
const { sha1, toPosix, isWslUnc, parseWslUnc } = require('./util');
const { TOOL_DIRS } = require('./config');
const { resolve: resolveAdapter } = require('./adapters');
const wsl = require('./adapters/wsl');
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
 * Duplicates are counted among *enabled* skills only. Turning off eight of nine
 * copies is supposed to make the ninth stop being a duplicate; counting the
 * disabled ones would leave the warning stuck on forever.
 *
 * Exported because toggling a skill changes the answer, and re-scanning the disk
 * for that would cost seconds.
 */
function recomputeDuplicates(skills) {
  const byName = new Map();
  const byHash = new Map();
  for (const s of skills) {
    if (s.disabled) continue;
    const key = (s.name || '').toLowerCase();
    byName.set(key, (byName.get(key) || 0) + 1);
    byHash.set(s.headHash, (byHash.get(s.headHash) || 0) + 1);
  }
  for (const s of skills) {
    s.dupCount = s.disabled ? 1 : (byName.get((s.name || '').toLowerCase()) || 1);
    s.sameContentCount = s.disabled ? 1 : (byHash.get(s.headHash) || 1);
  }
  return skills;
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

    // A directory can briefly hold both names if a rename was interrupted;
    // prefer the live manifest so the skill reads as enabled.
    const byDir = new Map();
    for (const it of items) {
      const prev = byDir.get(it.dir);
      if (!prev || (prev.disabled && !it.disabled)) byDir.set(it.dir, it);
    }

    for (const it of byDir.values()) {
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
        file: path.join(it.dir, it.file || 'SKILL.md'),
        disabled: !!it.disabled,
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
        skillCommit: null,
        skillCommitAt: null,
        driftCommits: null,
        projectHeadAt: null,
        driftDays: null
      });
    }
    onRoot(root, items.length);
  }

  recomputeDuplicates(all);

  // Real drift: how many commits the repo made after the skill was last
  // touched. Skipped for worktrees (duplicated history) and vendor packs
  // (someone else's repo). WSL is handled inside the distro, one call per
  // batch, because spawning wsl.exe per skill is unusably slow.
  if (cfg.git && cfg.git.enabled && opts.git !== false) {
    const targets = all.filter((s) => !s.worktree && s.kind !== 'vendor' && s.projectPath && !s.disabled);
    const local = targets.filter((s) => !isWslUnc(s.dir));
    const byDistro = new Map();
    for (const s of targets.filter((x) => isWslUnc(x.dir))) {
      const w = parseWslUnc(s.dir);
      if (!w) continue;
      if (!byDistro.has(w.distro)) byDistro.set(w.distro, []);
      byDistro.get(w.distro).push({ skill: s, posix: w.posix });
    }

    const assign = (s, d) => {
      if (!d) return;
      s.skillCommit = d.lastSha;
      s.skillCommitAt = d.lastAt;
      s.driftCommits = d.commitsAfter;
      s.projectHeadAt = d.headAt;
      s.driftDays = d.headAt && d.lastAt ? Math.round((d.headAt - d.lastAt) / 86400000) : null;
    };

    if (local.length) {
      const map = await git.drift(
        local.slice(0, 500).map((s) => ({ dir: s.dir, projectPath: s.projectPath })),
        { concurrency: 8, timeout: 4000 }
      );
      for (const s of local) assign(s, map.get(s.dir));
    }

    if (byDistro.size) {
      for (const [distro, items] of byDistro) {
        const map = await wsl.drift(distro, items.map((x) => x.posix));
        for (const x of items) assign(x.skill, map.get(x.posix));
      }
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

module.exports = { scan, classify, skillId, recomputeDuplicates };
