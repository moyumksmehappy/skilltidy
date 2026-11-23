'use strict';

const { execFile } = require('child_process');

/**
 * Real drift detection.
 *
 * "Old" and "wrong" are different things. A deploy runbook that nobody touched
 * for a year can be perfectly correct; a skill that points at a renamed CLI
 * flag is wrong the moment that rename lands, however recently it was edited.
 *
 * The evidence we can actually get from git is: the skill was last touched at
 * commit X, and the repository has made N commits since. That N is the drift -
 * a count, not an age. Everything else (dates, days) is derived from it.
 */

function exec(bin, args, cwd, timeout) {
  const opts = { timeout, windowsHide: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 };
  // Passing cwd: null makes git start and exit without writing anything, which
  // looks exactly like "no repository here". Only set it when we have one.
  if (cwd) opts.cwd = cwd;
  return new Promise((resolve) => {
    execFile(bin, args, opts, (err, stdout) => {
      if (process.env.SKILLTIDY_DEBUG) {
        console.error('[git-exec] ' + bin + ' ' + args[0] + ' cwd=' + (opts.cwd || '-') + ' err=' + (err && err.code) + ' len=' + String(stdout || '').length);
      }
      if (err) return resolve({ ok: false, out: '' });
      resolve({ ok: true, out: String(stdout || '') });
    });
  });
}

/**
 * Resolving `git` by name is not reliable: on some machines PATH hits a shim
 * that starts and exits without writing anything, which would silently turn
 * every drift number into 0. So probe every candidate the OS knows about and
 * keep the first one that actually prints a version.
 *
 * Windows paths are normalised to forward slashes: backslash absolute paths
 * have been observed to spawn "successfully" while writing no stdout at all.
 */
let gitBin;
async function resolveGit() {
  if (gitBin !== undefined) return gitBin || null;

  const norm = (p) => (process.platform === 'win32' ? String(p).replace(/\\/g, '/') : String(p));
  const candidates = [];
  if (process.env.SKILLTIDY_GIT) candidates.push(norm(process.env.SKILLTIDY_GIT));

  const lister = process.platform === 'win32' ? 'where' : 'which';
  const found = await new Promise((res) => {
    execFile(lister, ['git'], { encoding: 'utf8', windowsHide: true, timeout: 3000 }, (err, out) => {
      res(err ? [] : String(out || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean).map(norm));
    });
  });
  candidates.push(...found);
  candidates.push('git');

  const debug = !!process.env.SKILLTIDY_DEBUG;
  for (const bin of candidates) {
    const r = await exec(bin, ['--version'], null, 5000);
    if (debug) console.error('[git] ' + bin + ' -> ok=' + r.ok + ' out=' + JSON.stringify(r.out.trim()).slice(0, 40));
    if (r.ok && r.out.trim()) {
      gitBin = bin;
      return bin;
    }
  }
  if (debug) console.error('[git] no usable git found; drift will be skipped');
  gitBin = '';
  return null;
}

async function run(args, cwd, timeout) {
  const bin = await resolveGit();
  if (!bin) return { ok: false, out: '' };
  return exec(bin, args, cwd, timeout);
}

/** `rev-list HEAD` output -> commit shas, newest first. Pure, for tests. */
function parseRevList(text) {
  return String(text || '')
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => /^[0-9a-f]{7,40}$/i.test(s));
}

/** How many commits came after this one. 0 means the skill is at HEAD. */
function commitsAfter(shas, sha) {
  if (!sha) return null;
  const i = shas.indexOf(sha);
  return i < 0 ? null : i;
}

/** `<sha>\t<unix seconds>` -> { sha, at (ms) }. Pure, for tests. */
function parseLogLine(text) {
  const line = String(text || '').trim().split('\n').pop() || '';
  const [sha, secs] = line.split('\t');
  if (!/^[0-9a-f]{7,40}$/i.test(sha || '')) return null;
  const n = parseInt(secs, 10);
  if (!Number.isFinite(n)) return { sha, at: null };
  return { sha, at: n * 1000 };
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

async function repoTop(dir, timeout) {
  const r = await run(['rev-parse', '--show-toplevel'], dir, timeout);
  const top = r.ok ? r.out.trim() : '';
  return top || null;
}

/**
 * targets: [{ dir, projectPath }]
 * returns Map<dir, { lastSha, lastAt, commitsAfter, headAt, commitCount }>
 */
async function drift(targets, opts = {}) {
  const timeout = opts.timeout || 4000;
  const concurrency = opts.concurrency || 8;
  const result = new Map();
  if (!targets.length) return result;

  // One repo probe per project, not per skill.
  const projects = [...new Set(targets.map((t) => t.projectPath).filter(Boolean))];
  const tops = new Map();
  await mapLimit(projects, 4, async (p) => {
    tops.set(p, await repoTop(p, timeout));
  });

  // rev-list per repo, shared by every skill inside it.
  const histories = new Map();
  const repos = [...new Set([...tops.values()].filter(Boolean))];
  await mapLimit(repos, 4, async (top) => {
    const [list, head] = await Promise.all([
      run(['rev-list', 'HEAD'], top, timeout * 2),
      run(['log', '-1', '--format=%ct'], top, timeout)
    ]);
    const shas = list.ok ? parseRevList(list.out) : [];
    const headAt = head.ok ? parseInt(head.out.trim(), 10) * 1000 : null;
    histories.set(top, { shas, headAt: Number.isFinite(headAt) ? headAt : null });
  });

  await mapLimit(targets, concurrency, async (t) => {
    const top = tops.get(t.projectPath);
    if (!top) return;
    const h = histories.get(top);
    if (!h) return;

    const r = await run(['log', '-1', '--format=%H%x09%ct', '--', '.'], t.dir, timeout);
    if (!r.ok) return;
    const last = parseLogLine(r.out);
    if (!last) return;

    const after = commitsAfter(h.shas, last.sha);
    result.set(t.dir, {
      lastSha: last.sha.slice(0, 7),
      lastAt: last.at,
      commitsAfter: after,
      headAt: h.headAt,
      commitCount: h.shas.length,
      repo: top
    });
  });

  return result;
}

module.exports = { drift, parseRevList, parseLogLine, commitsAfter, repoTop };
