'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const PKG_ROOT = path.join(__dirname, '..');

const DEFAULT_SKIP_DIRS = [
  '.git', 'node_modules', '.venv', 'venv', '__pycache__', 'dist', 'build',
  'target', '.next', '.cache', 'anaconda3', '.terraform', 'vendor',
  'site-packages', '.pnpm-store', '.gradle', '.m2',
  'marketplaces', '.tmp', 'old-plugins', 'cache', 'backups'
];

const DEFAULT_VENDOR_PATTERNS = [
  '/everything-claude-code/',
  '/claude-code-resource/',
  '/node_modules/',
  '/openspec/',
  '/.claude/plugins/marketplaces/',
  '/.workbuddy/plugins/'
];

const TOOL_DIRS = ['.claude', '.agents', '.codebuddy', '.codex', '.workbuddy', '.iflow', '.cursor'];

function home() {
  return process.env.SKILLTIDY_HOME || path.join(os.homedir(), '.skilltidy');
}
function configPath() { return path.join(home(), 'config.json'); }
function metaPath() { return path.join(home(), 'meta.json'); }
function cachePath() { return path.join(home(), 'cache.json'); }

function ensureHome() {
  fs.mkdirSync(home(), { recursive: true });
}

function defaults() {
  return {
    version: 1,
    port: 7788,
    openOnStart: true,
    staleDays: 90,
    reviewDays: 45,
    roots: [],
    skipDirs: DEFAULT_SKIP_DIRS.slice(),
    vendorPatterns: DEFAULT_VENDOR_PATTERNS.slice(),
    git: { enabled: true, wsl: false }
  };
}

function normalize(cfg) {
  const d = defaults();
  const out = { ...d, ...(cfg || {}) };
  out.version = 1;
  out.roots = (out.roots || []).map((r, i) => ({
    id: r.id || 'root-' + i,
    label: r.label || r.path || 'root ' + i,
    path: r.path,
    device: r.device || '',
    scope: r.scope === 'global' ? 'global' : 'project',
    kind: r.kind === 'vendor' ? 'vendor' : 'mine',
    enabled: r.enabled !== false,
    ...(r.maxDepth ? { maxDepth: r.maxDepth } : {})
  })).filter((r) => !!r.path);
  out.skipDirs = Array.isArray(out.skipDirs) ? out.skipDirs : d.skipDirs;
  out.vendorPatterns = Array.isArray(out.vendorPatterns) ? out.vendorPatterns : d.vendorPatterns;
  out.git = { enabled: true, wsl: false, ...(out.git || {}) };
  out.staleDays = Number(out.staleDays) || d.staleDays;
  out.reviewDays = Number(out.reviewDays) || d.reviewDays;
  out.port = Number(out.port) || d.port;
  return out;
}

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
  fs.renameSync(tmp, p);
}

/**
 * Older single-folder distribution kept config.json and data/meta.json next to
 * the script. If we find one and the user has no ~/.skilltidy yet, adopt it so
 * existing notes and scan roots survive the upgrade.
 */
function findLegacy() {
  const candidates = [PKG_ROOT, process.cwd()];
  for (const base of candidates) {
    const c = path.join(base, 'config.json');
    if (fs.existsSync(c)) {
      return {
        config: c,
        meta: path.join(base, 'data', 'meta.json'),
        cache: path.join(base, 'data', 'cache.json')
      };
    }
  }
  return null;
}

function migrateLegacy(legacy) {
  const raw = readJson(legacy.config);
  if (!raw) return null;
  ensureHome();
  writeJson(configPath(), normalize(raw));
  if (fs.existsSync(legacy.meta)) {
    const m = readJson(legacy.meta);
    if (m) writeJson(metaPath(), m);
  }
  if (fs.existsSync(legacy.cache)) {
    const c = readJson(legacy.cache);
    if (c) writeJson(cachePath(), c);
  }
  return normalize(raw);
}

/**
 * The project shipped briefly as "skilldeck"; anyone who used that build has
 * state in ~/.skilldeck. Adopt it on first run instead of silently starting
 * with an empty config and losing their notes.
 */
function adoptPreviousHome() {
  const prev = path.join(os.homedir(), '.skilldeck');
  const prevConfig = path.join(prev, 'config.json');
  if (!fs.existsSync(prevConfig)) return null;
  const raw = readJson(prevConfig);
  if (!raw) return null;
  ensureHome();
  writeJson(configPath(), normalize(raw));
  for (const name of ['meta.json', 'cache.json']) {
    const src = path.join(prev, name);
    if (!fs.existsSync(src)) continue;
    const value = readJson(src);
    if (value) writeJson(path.join(home(), name), value);
  }
  return normalize(raw);
}

function load() {
  ensureHome();
  if (fs.existsSync(configPath())) {
    return normalize(readJson(configPath()) || defaults());
  }
  const adopted = adoptPreviousHome();
  if (adopted) return adopted;
  const legacy = findLegacy();
  if (legacy) {
    const migrated = migrateLegacy(legacy);
    if (migrated) return migrated;
  }
  return defaults();
}

function save(cfg) {
  const next = normalize(cfg);
  writeJson(configPath(), next);
  return next;
}

function exists(cfg) {
  return fs.existsSync(configPath());
}

module.exports = {
  PKG_ROOT,
  TOOL_DIRS,
  DEFAULT_SKIP_DIRS,
  DEFAULT_VENDOR_PATTERNS,
  home,
  configPath,
  metaPath,
  cachePath,
  ensureHome,
  defaults,
  normalize,
  load,
  save,
  exists,
  readJson,
  writeJson
};
