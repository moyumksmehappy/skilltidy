'use strict';

const path = require('path');
const { metaPath, ensureHome, readJson, writeJson } = require('./config');

const META_VERSION = 1;

function empty() {
  return { version: META_VERSION, skills: {} };
}

/**
 * meta.json holds only *your* annotations - star, tags, note, reviewedAt,
 * archived - keyed by skill id. Skill files are never touched by this store,
 * which is what makes it safe to sync between machines.
 */
function migrate(raw) {
  if (!raw || typeof raw !== 'object') return empty();
  const out = empty();
  const skills = raw.skills && typeof raw.skills === 'object' ? raw.skills : {};

  // v0 (pre-versioned): a bare { id: {...} } map.
  const from = raw.version ? skills : (raw.skills || raw);

  for (const [id, v] of Object.entries(from || {})) {
    if (!v || typeof v !== 'object') continue;
    if (!/^[a-f0-9]{6,}$/i.test(id)) continue;
    out.skills[id] = {
      star: !!v.star,
      tags: Array.isArray(v.tags) ? v.tags.filter((t) => typeof t === 'string') : [],
      note: typeof v.note === 'string' ? v.note : '',
      reviewedAt: typeof v.reviewedAt === 'string' ? v.reviewedAt : null,
      archived: !!v.archived
    };
  }
  out.version = META_VERSION;
  return out;
}

function load() {
  ensureHome();
  return migrate(readJson(metaPath()));
}

function save(meta) {
  ensureHome();
  const out = { version: META_VERSION, skills: (meta && meta.skills) || {} };
  writeJson(metaPath(), out);
  return out;
}

function get(meta, id) {
  return (meta.skills && meta.skills[id]) || null;
}

function patch(meta, id, p) {
  const cur = (meta.skills && meta.skills[id]) || {};
  const next = { ...cur, ...(p || {}) };
  if (p && p.touchReview) {
    next.reviewedAt = new Date().toISOString();
    delete next.touchReview;
  }
  meta.skills[id] = next;
  save(meta);
  return next;
}

/**
 * Merge two stores. Used by `skilltidy import` and by people who sync the
 * whole folder: newest review wins, tags union, longer note wins, star is OR.
 */
function merge(into, from) {
  let count = 0;
  for (const [id, v] of Object.entries((from && from.skills) || {})) {
    const cur = into.skills[id];
    if (!cur) { into.skills[id] = v; count++; continue; }
    const a = cur.reviewedAt ? new Date(cur.reviewedAt).getTime() : 0;
    const b = v.reviewedAt ? new Date(v.reviewedAt).getTime() : 0;
    into.skills[id] = {
      star: !!(cur.star || v.star),
      tags: [...new Set([...(cur.tags || []), ...(v.tags || [])])],
      note: (cur.note || '').length >= (v.note || '').length ? cur.note : v.note,
      reviewedAt: a >= b ? cur.reviewedAt : v.reviewedAt,
      archived: a >= b ? !!cur.archived : !!v.archived
    };
    count++;
  }
  save(into);
  return count;
}

module.exports = { META_VERSION, empty, load, save, get, patch, merge, migrate };
