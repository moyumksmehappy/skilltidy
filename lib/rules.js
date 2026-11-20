'use strict';

const { days } = require('./util');

/**
 * Pure rules layer: no IO, no config file reading. Everything here takes the
 * data it needs as arguments so it can be unit tested and reused by `check`.
 */

const DEFAULT_SETTINGS = { staleDays: 90, reviewDays: 45 };

function decorate(skill, meta, settings) {
  const cfg = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  const m = meta || {};
  const ageDays = Math.max(0, Math.round(days(skill.mtime)));
  const reviewedAt = m.reviewedAt || null;
  const sinceReview = reviewedAt ? Math.max(0, Math.round(days(new Date(reviewedAt).getTime()))) : null;

  const flags = {
    stale: ageDays > cfg.staleDays,
    aging: ageDays > 30 && ageDays <= cfg.staleDays,
    unreviewed: !reviewedAt,
    dueReview: !!reviewedAt && sinceReview > cfg.reviewDays,
    dup: (skill.dupCount || 1) > 1,
    drift: skill.driftDays !== null && skill.driftDays !== undefined && skill.driftDays > 7
  };

  let status = 'fresh';
  if (flags.stale) status = 'stale';
  else if (flags.dueReview) status = 'due';
  else if (flags.unreviewed) status = 'unreviewed';
  else if (flags.aging) status = 'aging';

  return {
    ...skill,
    meta: {
      star: !!m.star,
      tags: Array.isArray(m.tags) ? m.tags : [],
      note: m.note || '',
      archived: !!m.archived,
      reviewedAt
    },
    ageDays,
    sinceReview,
    flags,
    status
  };
}

function needsAttention(s) {
  return !s.meta.archived && (s.flags.stale || s.flags.dueReview || s.flags.drift);
}

function summarize(skills) {
  const active = skills.filter((s) => !s.meta.archived);
  return {
    total: active.length,
    mine: active.filter((s) => s.kind !== 'vendor').length,
    vendor: active.filter((s) => s.kind === 'vendor').length,
    stale: active.filter((s) => s.flags.stale).length,
    unreviewed: active.filter((s) => s.flags.unreviewed).length,
    due: active.filter((s) => s.flags.dueReview).length,
    dup: active.filter((s) => s.flags.dup).length,
    drift: active.filter((s) => s.flags.drift).length,
    attention: active.filter(needsAttention).length,
    projects: new Set(active.map((s) => s.project)).size,
    devices: new Set(active.map((s) => s.device)).size,
    starred: active.filter((s) => s.meta.star).length,
    archived: skills.length - active.length
  };
}

/** Group duplicates: same lowercase name, and same content fingerprint. */
function duplicateGroups(skills) {
  const byName = new Map();
  const byHash = new Map();
  for (const s of skills) {
    const n = (s.name || '').toLowerCase();
    if (!byName.has(n)) byName.set(n, []);
    byName.get(n).push(s);
    const h = s.headHash || '';
    if (!byHash.has(h)) byHash.set(h, []);
    byHash.get(h).push(s);
  }
  return { byName, byHash };
}

/** Sort helper shared by CLI and UI. */
function attentionScore(s) {
  return (s.flags.stale ? 100 : 0)
    + (s.flags.drift ? 50 : 0)
    + (s.flags.dueReview ? 40 : 0)
    + (s.flags.unreviewed ? 20 : 0)
    + (s.flags.aging ? 8 : 0);
}

module.exports = { DEFAULT_SETTINGS, decorate, summarize, needsAttention, duplicateGroups, attentionScore };
