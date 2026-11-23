'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const toggle = require('../lib/toggle');

const BODY = '---\nname: demo\ndescription: a demo\n---\n\n# Demo\n\n1. Step.\n';

async function sandbox() {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'skilltidy-toggle-'));
  const skillDir = path.join(dir, 'demo');
  await fsp.mkdir(skillDir, { recursive: true });
  const file = path.join(skillDir, 'SKILL.md');
  await fsp.writeFile(file, BODY, 'utf8');
  const st = await fsp.stat(file);
  const skill = { dir: skillDir, file, disabled: false, mtime: st.mtimeMs, size: st.size };
  return { root: dir, skillDir, skill };
}

test('disabling renames the manifest and leaves the bytes alone', async () => {
  const { root, skillDir, skill } = await sandbox();
  try {
    const r = await toggle.setEnabled(skill, false);
    assert.strictEqual(r.changed, true);
    assert.strictEqual(fs.existsSync(path.join(skillDir, 'SKILL.md')), false);
    assert.strictEqual(fs.existsSync(path.join(skillDir, 'SKILL.md.disabled')), true);
    assert.strictEqual(await fsp.readFile(path.join(skillDir, 'SKILL.md.disabled'), 'utf8'), BODY);
    assert.strictEqual(r.file, path.join(skillDir, 'SKILL.md.disabled'));
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test('enabling renames it back, byte for byte', async () => {
  const { root, skillDir, skill } = await sandbox();
  try {
    await toggle.setEnabled(skill, false);
    const r = await toggle.setEnabled({ ...skill, disabled: true }, true);
    assert.strictEqual(r.changed, true);
    assert.strictEqual(fs.existsSync(path.join(skillDir, 'SKILL.md.disabled')), false);
    assert.strictEqual(await fsp.readFile(path.join(skillDir, 'SKILL.md'), 'utf8'), BODY);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test('toggling to the state it is already in is a no-op', async () => {
  const { root, skillDir, skill } = await sandbox();
  try {
    const r = await toggle.setEnabled(skill, true);
    assert.strictEqual(r.changed, false);
    assert.strictEqual(fs.existsSync(path.join(skillDir, 'SKILL.md')), true);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test('two manifests in one folder is refused instead of guessed at', async () => {
  const { root, skillDir, skill } = await sandbox();
  try {
    await fsp.writeFile(path.join(skillDir, 'SKILL.md.disabled'), BODY, 'utf8');
    await assert.rejects(() => toggle.setEnabled(skill, false), /both SKILL\.md and SKILL\.md\.disabled/);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test('a missing manifest is reported, not silently ignored', async () => {
  const { root, skillDir, skill } = await sandbox();
  try {
    await fsp.unlink(path.join(skillDir, 'SKILL.md'));
    await assert.rejects(() => toggle.setEnabled(skill, false), /cannot find SKILL\.md/);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});
