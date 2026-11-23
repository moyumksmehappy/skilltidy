'use strict';

const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const configLib = require('./config');
const metaLib = require('./meta');
const engine = require('./engine');
const rules = require('./rules');
const { openPath } = require('./adapters');
const { sha1, HEAD_BYTES } = require('./util');

const UI_DIR = path.join(__dirname, '..', 'ui');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png'
};

function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function sendFile(res, file) {
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(buf);
  });
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 16 * 1024 * 1024) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
  });
}

function safeInside(dir, rel) {
  const base = path.resolve(dir);
  const target = path.resolve(base, rel);
  return target === base || target.startsWith(base + path.sep) ? target : null;
}

async function listFiles(dir) {
  const out = [];
  const skip = new Set(['.git', 'node_modules', '__pycache__', '.DS_Store']);
  async function walk(d, rel, depth) {
    if (depth > 3) return;
    let ents;
    try { ents = await fsp.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (e.isDirectory()) {
        if (skip.has(e.name)) continue;
        await walk(path.join(d, e.name), rel ? rel + '/' + e.name : e.name, depth + 1);
      } else {
        if (/:Zone\.Identifier$/i.test(e.name) || e.name === '.DS_Store') continue;
        try {
          const st = await fsp.stat(path.join(d, e.name));
          out.push({ rel: rel ? rel + '/' + e.name : e.name, size: st.size, mtime: st.mtimeMs });
        } catch { }
      }
    }
  }
  await walk(dir, '', 0);
  out.sort((a, b) => (a.rel === 'SKILL.md' ? -1 : b.rel === 'SKILL.md' ? 1 : a.rel.localeCompare(b.rel)));
  return out.slice(0, 120);
}

function createServer() {
  let cfg = configLib.load();
  let meta = metaLib.load();
  let cache = configLib.readJson(configLib.cachePath()) || { scannedAt: null, skills: [], errors: [] };
  let scanning = false;
  let scanError = null;

  function settings() {
    return { staleDays: cfg.staleDays, reviewDays: cfg.reviewDays, driftCommits: cfg.driftCommits };
  }

  async function doScan() {
    if (scanning) return cache;
    scanning = true;
    scanError = null;
    try {
      const result = await engine.scan(cfg);
      cache = result;
      if (result.errors && result.errors.length) {
        scanError = result.errors.map((e) => `${e.root}: ${e.message}`).join('; ');
      }
      configLib.writeJson(configLib.cachePath(), cache);
    } catch (e) {
      scanError = String((e && e.message) || e);
    } finally {
      scanning = false;
    }
    return cache;
  }

  function buildState() {
    const skills = (cache.skills || []).map((s) => rules.decorate(s, meta.skills[s.id], settings()));
    return {
      scannedAt: cache.scannedAt,
      durationMs: cache.durationMs || null,
      scanning,
      scanError,
      roots: cfg.roots.map((r) => ({
        id: r.id, label: r.label, path: r.path, device: r.device,
        scope: r.scope, kind: r.kind, enabled: !!r.enabled
      })),
      settings: { ...settings(), port: cfg.port, home: configLib.home() },
      stats: rules.summarize(skills),
      skills
    };
  }

  function findSkill(id) {
    return (cache.skills || []).find((s) => s.id === id) || null;
  }

  async function handle(req, res) {
    const u = new URL(req.url, 'http://127.0.0.1');
    const p = u.pathname;

    if (p === '/') return sendFile(res, path.join(UI_DIR, 'index.html'));
    if (p.startsWith('/static/')) {
      const file = safeInside(UI_DIR, p.slice('/static/'.length));
      return file ? sendFile(res, file) : (res.writeHead(403), res.end());
    }

    if (p === '/api/state') return sendJson(res, 200, buildState());

    if (p === '/api/scan' && req.method === 'POST') {
      if (!scanning) await doScan();
      return sendJson(res, 200, buildState());
    }

    if (p === '/api/skill') {
      const isPost = req.method === 'POST';
      const body = isPost ? await readBody(req) : null;
      const id = isPost ? body.id : u.searchParams.get('id');
      const s = findSkill(id);
      if (!s) return sendJson(res, 404, { error: 'skill not found' });

      const rel = (isPost ? body.file : u.searchParams.get('file')) || 'SKILL.md';
      const target = safeInside(s.dir, rel);
      if (!target) return sendJson(res, 403, { error: 'forbidden' });

      if (!isPost) {
        let content;
        try { content = await fsp.readFile(target, 'utf8'); }
        catch (e) { return sendJson(res, 404, { error: 'cannot read: ' + e.message }); }
        if (u.searchParams.get('meta') === '1') {
          return sendJson(res, 200, {
            skill: rules.decorate(s, meta.skills[s.id], settings()),
            content,
            files: await listFiles(s.dir)
          });
        }
        return sendJson(res, 200, { content });
      }

      try {
        await fsp.writeFile(target, String(body.content ?? ''), 'utf8');
        const st = await fsp.stat(target);
        if (rel === 'SKILL.md') {
          const head = String(body.content ?? '').slice(0, HEAD_BYTES);
          s.mtime = st.mtimeMs;
          s.size = st.size;
          s.headHash = sha1(head.replace(/\r\n/g, '\n'));
          const fm = require('./frontmatter').parseFrontmatter(head);
          if (fm.name) s.name = fm.name.trim();
          if (fm.description) s.description = fm.description.trim();
          configLib.writeJson(configLib.cachePath(), cache);
        }
        return sendJson(res, 200, { ok: true, mtime: st.mtimeMs });
      } catch (e) {
        return sendJson(res, 500, { error: e.message });
      }
    }

    if (p === '/api/meta' && req.method === 'POST') {
      const body = await readBody(req);
      if (!findSkill(body.id)) return sendJson(res, 404, { error: 'skill not found' });
      const next = metaLib.patch(meta, body.id, body.patch || {});
      return sendJson(res, 200, { ok: true, meta: next });
    }

    if (p === '/api/open' && req.method === 'POST') {
      const body = await readBody(req);
      const s = findSkill(body.id);
      if (!s) return sendJson(res, 404, { error: 'skill not found' });
      openPath(s.file);
      return sendJson(res, 200, { ok: true });
    }

    if (p === '/api/roots' && req.method === 'POST') {
      const body = await readBody(req);
      if (Array.isArray(body.roots)) cfg.roots = body.roots;
      if (body.settings) {
        if (Number(body.settings.staleDays)) cfg.staleDays = Number(body.settings.staleDays);
        if (Number(body.settings.reviewDays)) cfg.reviewDays = Number(body.settings.reviewDays);
      }
      cfg = configLib.save(cfg);
      return sendJson(res, 200, { ok: true, roots: cfg.roots });
    }

    if (p === '/api/export') {
      const payload = {
        app: 'skilltidy',
        version: 1,
        exportedAt: new Date().toISOString(),
        config: { staleDays: cfg.staleDays, reviewDays: cfg.reviewDays, roots: cfg.roots },
        meta,
        skills: (cache.skills || []).map((s) => ({ id: s.id, name: s.name, rel: s.rel, rootId: s.rootId, project: s.project }))
      };
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': 'attachment; filename="skilltidy-export.json"'
      });
      return res.end(JSON.stringify(payload, null, 2));
    }

    if (p === '/api/import' && req.method === 'POST') {
      const body = await readBody(req);
      if (!body || !body.meta) return sendJson(res, 400, { error: 'bad payload' });
      const n = metaLib.merge(meta, metaLib.migrate(body.meta));
      return sendJson(res, 200, { ok: true, merged: n });
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('not found');
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((e) => {
      try { sendJson(res, 500, { error: String((e && e.message) || e) }); } catch { }
    });
  });

  return {
    server,
    scan: doScan,
    state: buildState,
    get cache() { return cache; },
    get config() { return cfg; },
    list: () => engine.scan(cfg)
  };
}

module.exports = { createServer, UI_DIR };
