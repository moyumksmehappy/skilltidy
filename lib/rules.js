'use strict';

const { days } = require('./util');

/**
 * Pure rules layer: no IO, no config file reading. Everything here takes the
 * data it needs as arguments so it can be unit tested and reused by `check`.
 */

const DEFAULT_SETTINGS = { staleDays: 90, reviewDays: 45, driftCommits: 10 };

function decorate(skill, meta, settings) {
  const cfg = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  const m = meta || {};
  const ageDays = Math.max(0, Math.round(days(skill.mtime)));
  const reviewedAt = m.reviewedAt || null;
  const sinceReview = reviewedAt ? Math.max(0, Math.round(days(new Date(reviewedAt).getTime()))) : null;
  const minCommits = Number.isFinite(Number(cfg.driftCommits)) ? Number(cfg.driftCommits) : 10;

  // Drift is settled if you confirmed the skill after the newest commit in the
  // repo: at that point you looked at the current code and said it still holds.
  const headAt = Number(skill.projectHeadAt) || 0;
  const confirmedAt = reviewedAt ? new Date(reviewedAt).getTime() : 0;
  const driftRaw = typeof skill.driftCommits === 'number' && skill.driftCommits >= minCommits;
  const driftSettled = driftRaw && headAt > 0 && confirmedAt >= headAt;

  const flags = {
    // Kept for the "untouched" view, but no longer the headline: a file being
    // old is not evidence that it is wrong.
    stale: ageDays > cfg.staleDays,
    aging: ageDays > 30 && ageDays <= cfg.staleDays,
    unreviewed: !reviewedAt,
    neverReviewed: !reviewedAt,
    reviewed: !!reviewedAt,
    dueReview: !!reviewedAt && sinceReview > cfg.reviewDays,
    // Off means the manifest is renamed to SKILL.md.disabled, so agent tools no
    // longer pick it up. It stays in the list so it can be turned back on.
    disabled: !!skill.disabled,
    // A disabled copy is not a duplicate problem: it is already out of the way.
    dup: !skill.disabled && (skill.dupCount || 1) > 1,
    // Drift is a commit count, not a date: N commits landed after this skill was
    // last touched, so whatever it describes has probably moved on.
    drift: driftRaw && !driftSettled,
    driftSettled
  };

  // A decision is something the tool can point at as evidence, as opposed to
  // "you have not looked at this yet", which is bookkeeping. A disabled skill
  // is not asking for anything - you already answered.
  const decision = flags.disabled ? null : (flags.drift ? 'drift' : flags.dup ? 'dup' : null);

  // The status dot answers one question: does this need my attention? Age is
  // deliberately not part of it - a skill confirmed yesterday reads as fine
  // even if the file has not changed in a year.
  let status = 'fresh';
  if (flags.disabled) status = 'off';
  else if (decision) status = decision;
  else if (flags.dueReview) status = 'due';
  else if (flags.neverReviewed) status = 'new';

  // Tags come from two places: the ones you added in the dashboard (meta) and
  // the ones the skill itself declares in its frontmatter. Both are shown, but
  // only yours are editable - frontmatter tags belong to the file.
  const declaredTags = Array.isArray(skill.tags) ? skill.tags : [];
  const mineTags = Array.isArray(m.tags) ? m.tags : [];
  const allTags = [];
  for (const t of [...mineTags, ...declaredTags]) {
    if (typeof t === 'string' && t.trim() && !allTags.some((x) => x.toLowerCase() === t.toLowerCase())) {
      allTags.push(t.trim());
    }
  }

  return {
    ...skill,
    meta: {
      star: !!m.star,
      tags: allTags,
      mineTags,
      declaredTags,
      note: m.note || '',
      archived: !!m.archived,
      reviewedAt
    },
    ageDays,
    sinceReview,
    flags,
    decision,
    status
  };
}

function needsAttention(s) {
  return !s.meta.archived && !s.flags.disabled && (!!s.decision || s.flags.dueReview);
}

function summarize(skills) {
  const active = skills.filter((s) => !s.meta.archived && !s.flags.disabled);
  return {
    total: active.length,
    mine: active.filter((s) => s.kind !== 'vendor').length,
    vendor: active.filter((s) => s.kind === 'vendor').length,
    stale: active.filter((s) => s.flags.stale).length,
    unreviewed: active.filter((s) => s.flags.neverReviewed).length,
    due: active.filter((s) => s.flags.dueReview).length,
    dup: active.filter((s) => s.flags.dup).length,
    drift: active.filter((s) => s.flags.drift).length,
    decisions: active.filter((s) => !!s.decision).length,
    reviewed: active.filter((s) => s.flags.reviewed).length,
    attention: active.filter(needsAttention).length,
    projects: new Set(active.map((s) => s.project)).size,
    devices: new Set(active.map((s) => s.device)).size,
    starred: active.filter((s) => s.meta.star).length,
    disabled: skills.filter((s) => s.flags.disabled && !s.meta.archived).length,
    archived: skills.filter((s) => s.meta.archived).length
  };
}

/** Tag histogram over the skills you are actually looking at. */
function tagCounts(skills) {
  const counts = new Map();
  for (const s of skills) {
    for (const t of s.meta.tags || []) {
      const key = t.toLowerCase();
      const cur = counts.get(key);
      if (cur) cur.n++;
      else counts.set(key, { tag: t, n: 1 });
    }
  }
  return [...counts.values()].sort((a, b) => b.n - a.n || a.tag.localeCompare(b.tag, 'zh'));
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

/**
 * Sort helper shared by CLI and UI. Drift first: it is the only signal backed
 * by evidence. Age is worth the least, because it is worth the least.
 */
function attentionScore(s) {
  return (s.flags.drift ? 100 : 0)
    + (s.flags.dup ? 80 : 0)
    + (s.flags.dueReview ? 40 : 0)
    + (s.flags.stale ? 20 : 0)
    + (s.flags.neverReviewed ? 10 : 0)
    + (s.flags.aging ? 4 : 0);
}

module.exports = { DEFAULT_SETTINGS, decorate, summarize, tagCounts, needsAttention, duplicateGroups, attentionScore };
