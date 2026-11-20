'use strict';

/**
 * `skilltidy init` support: look at this machine and propose scan roots.
 *
 * Nothing is guessed blindly - a project directory only becomes an enabled root
 * if a `skills` folder actually shows up within three levels, so a fresh config
 * does not turn into a 40-second no-op scan.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const wsl = require('./adapters/wsl');

const TOOL_HOMES = [
  { rel: '.claude/skills', label: 'Claude Code' },
  { rel: '.codex/skills', label: 'Codex' },
  { rel: '.agents/skills', label: 'Agents' },
  { rel: '.workbuddy/skills', label: 'WorkBuddy' },
  { rel: '.codebuddy/skills', label: 'CodeBuddy' },
  { rel: '.iflow/skills', label: 'iFlow' },
  { rel: '.cursor/skills', label: 'Cursor' }
];

const PROJECT_HINTS = ['code', 'projects', 'pros', 'workspace', 'src', 'dev', 'repos', 'git', 'WorkBuddy', 'source/repos'];

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'root';
}

function looksLikeSkillsTree(dir) {
  // Directory names only, no file reads: cheap enough to run on a few dozen
  // candidate folders during init.
  const queue = [[dir, 0]];
  while (queue.length) {
    const [cur, depth] = queue.shift();
    if (depth > 3) continue;
    let ents;
    try { ents = fs.readdirSync(cur, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      if (!e.isDirectory()) continue;
      if (e.name === 'skills' || e.name === '.skills') return true;
      if (e.name === 'node_modules' || e.name === '.git') continue;
      if (depth < 3) queue.push([path.join(cur, e.name), depth + 1]);
    }
  }
  return false;
}

function detectHost() {
  const home = os.homedir();
  const host = os.hostname();
  const roots = [];

  for (const t of TOOL_HOMES) {
    const p = path.join(home, t.rel);
    if (!fs.existsSync(p)) continue;
    roots.push({
      id: 'host-' + slug(t.label),
      label: `${t.label} (global)`,
      path: p,
      device: `${host} (${process.platform})`,
      scope: 'global',
      kind: 'mine',
      enabled: true
    });
  }

  for (const hint of PROJECT_HINTS) {
    const p = path.join(home, hint);
    if (!fs.existsSync(p)) continue;
    if (!fs.statSync(p).isDirectory()) continue;
    const has = looksLikeSkillsTree(p);
    roots.push({
      id: 'host-' + slug(hint) + '-projects',
      label: `${hint} (projects)`,
      path: p,
      device: `${host} (${process.platform})`,
      scope: 'project',
      kind: 'mine',
      enabled: has,
      maxDepth: 6
    });
  }

  return roots;
}

async function detectWsl() {
  if (process.platform !== 'win32') return [];
  const distros = (await wsl.listDistros())
    .filter((d) => !/docker/i.test(d)); // docker-desktop distros hold no user skills
  const roots = [];

  for (const distro of distros) {
    const home = await wsl.homeDir(distro);
    if (!home) continue;
    const device = `WSL ${distro}`;
    const prefix = '\\\\wsl.localhost\\' + distro;

    for (const t of TOOL_HOMES) {
      const exists = await wsl.existsFromHome(distro, t.rel);
      if (!exists) continue;
      roots.push({
        id: 'wsl-' + slug(distro) + '-' + slug(t.label),
        label: `WSL ${distro} / ${t.label} (global)`,
        path: prefix + (home + '/' + t.rel).replace(/\//g, '\\'),
        device,
        scope: 'global',
        kind: 'mine',
        enabled: true
      });
    }

    for (const hint of PROJECT_HINTS) {
      const exists = await wsl.existsFromHome(distro, hint);
      if (!exists) continue;
      const has = await wsl.probeFromHome(distro, hint);
      roots.push({
        id: 'wsl-' + slug(distro) + '-' + slug(hint) + '-projects',
        label: `WSL ${distro} / ${hint} (projects)`,
        path: prefix + (home + '/' + hint).replace(/\//g, '\\'),
        device,
        scope: 'project',
        kind: 'mine',
        enabled: has,
        maxDepth: 8
      });
    }
  }
  return roots;
}

async function detectAll() {
  const host = detectHost();
  const wslRoots = await detectWsl();
  return host.concat(wslRoots);
}

module.exports = { detectAll, detectHost, detectWsl, looksLikeSkillsTree };
