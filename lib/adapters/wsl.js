'use strict';

/**
 * WSL adapter.
 *
 * Why not just walk the \\wsl.localhost UNC path from Windows? Because it is
 * roughly 90x slower: a recursive 9p readdir over a mid-size repo took 89s
 * against 1s for a native `find`. So everything happens inside the distro.
 *
 * Why base64 the script? `wsl.exe` mangles the command line it forwards:
 * `$variables` get expanded by an outer layer and single quotes get stripped,
 * which silently turns `read -r -d '' f` into nonsense. Passing the script as a
 * base64 blob sidesteps every quoting rule on both sides.
 */

const { execFile } = require('child_process');
const { HEAD_BYTES, parseWslUnc, toUnc } = require('../util');

const IS_WIN = process.platform === 'win32';

function decodeWsl(buf) {
  // `wsl.exe -l -q` emits UTF-16LE; command output inside the distro is UTF-8.
  if (buf.length >= 2 && buf[1] === 0) return buf.toString('utf16le').replace(/^\uFEFF/, '');
  return buf.toString('utf8');
}

function runWsl(args, { timeout = 120000 } = {}) {
  return new Promise((resolve) => {
    execFile('wsl.exe', args, { maxBuffer: 96 * 1024 * 1024, timeout, windowsHide: true, encoding: 'buffer' },
      (err, stdout, stderr) => resolve({
        ok: !err,
        out: decodeWsl(stdout || Buffer.alloc(0)),
        err: err ? String((stderr && stderr.toString()) || err.message) : null
      }));
  });
}

function runScript(distro, script, opts) {
  const b64 = Buffer.from(script, 'utf8').toString('base64');
  return runWsl(['-d', distro, '--', 'bash', '-c', `echo ${b64} | base64 -d | bash`], opts);
}

async function listDistros() {
  if (!IS_WIN) return [];
  const r = await runWsl(['-l', '-q'], { timeout: 15000 });
  if (!r.ok && !r.out) return [];
  return r.out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

const q = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";

async function list(rootPath, opts = {}) {
  if (!IS_WIN) return [];
  const w = parseWslUnc(rootPath);
  if (!w) return [];
  const maxDepth = opts.maxDepth || 8;
  const nots = (opts.skipDirs || []).map((d) => `-not -path ${q('*/' + d + '/*')}`).join(' ');
  const base = `find "$R" -maxdepth ${maxDepth} -name SKILL.md ${nots} 2>/dev/null`;

  const metaScript = [`R=${q(w.posix)}`, `${base} -printf '%T@\\t%s\\t%p\\n'`].join('\n');
  const headScript = [
    `R=${q(w.posix)}`,
    `${base} -print0 | xargs -0 -r awk 'FNR==1{if(buf!="")printf "%s\\t%s\\n",file,buf; file=FILENAME; buf=""} FNR<=36{l=$0; gsub(/[\\t\\r]/," ",l); buf=buf (buf==""?"":"\\001") l} END{if(buf!="")printf "%s\\t%s\\n",file,buf}' 2>/dev/null`
  ].join('\n');

  const [meta, heads] = await Promise.all([
    runScript(w.distro, metaScript),
    runScript(w.distro, headScript)
  ]);

  const headMap = new Map();
  for (const line of heads.out.split('\n')) {
    const i = line.indexOf('\t');
    if (i < 0) continue;
    headMap.set(line.slice(0, i), line.slice(i + 1).split('\x01').join('\n'));
  }

  const out = [];
  for (const line of meta.out.split('\n')) {
    if (!line) continue;
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const mtime = Math.round(parseFloat(parts[0]) * 1000);
    const size = parseInt(parts[1], 10);
    const dirPosix = parts[2].replace(/\/SKILL\.md$/, '');
    out.push({
      dir: toUnc(w.distro, dirPosix),
      mtime,
      size,
      head: headMap.get(parts[2]) || ''
    });
  }
  return out;
}

/** Home directory of the distro's default user (cached per distro). */
const homeCache = new Map();
async function homeDir(distro) {
  if (!IS_WIN) return null;
  if (homeCache.has(distro)) return homeCache.get(distro);
  const r = await runScript(distro, 'echo $HOME', { timeout: 15000 });
  const h = r.out.trim();
  const val = h.startsWith('/') ? h : null;
  homeCache.set(distro, val);
  return val;
}

/** Cheap existence check used by `init`; `rel` is relative to $HOME. */
async function existsFromHome(distro, rel) {
  if (!IS_WIN) return false;
  const r = await runScript(
    distro,
    `test -d "$HOME/${rel}" && echo yes || true`,
    { timeout: 15000 }
  );
  return r.out.trim() === 'yes';
}

/** Does this $HOME-relative folder contain any skills directory within 3 levels? */
async function probeFromHome(distro, rel) {
  if (!IS_WIN) return false;
  const r = await runScript(
    distro,
    `find "$HOME/${rel}" -maxdepth 3 -type d -name skills 2>/dev/null | head -1`,
    { timeout: 25000 }
  );
  return r.out.trim().length > 0;
}

module.exports = { id: 'wsl', list, listDistros, homeDir, existsFromHome, probeFromHome, HEAD_BYTES };
