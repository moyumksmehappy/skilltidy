'use strict';

const $ = (s) => document.querySelector(s);
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };

const VIEWS = [
  { id: 'attention', label: '需关注', fn: (s) => s.flags.stale || s.flags.dueReview || s.flags.drift },
  { id: 'all', label: '全部技能', fn: () => true },
  { id: 'stale', label: '沉睡中', fn: (s) => s.flags.stale },
  { id: 'unreviewed', label: '从未审查', fn: (s) => s.flags.unreviewed },
  { id: 'due', label: '该复查了', fn: (s) => s.flags.dueReview },
  { id: 'dup', label: '重复副本', fn: (s) => s.flags.dup },
  { id: 'drift', label: '项目已领先', fn: (s) => s.flags.drift },
  { id: 'starred', label: '收藏', fn: (s) => s.meta.star },
  { id: 'mine', label: '我写的', fn: (s) => s.kind !== 'vendor' },
  { id: 'vendor', label: '第三方 / 引用库', fn: (s) => s.kind === 'vendor' },
  { id: 'archived', label: '已归档', fn: (s) => s.meta.archived, archived: true }
];

const state = {
  data: null,
  view: 'attention',
  q: '',
  device: null,
  project: null,
  sort: 'attention',
  current: null,
  editing: false,
  files: [],
  fileSel: 'SKILL.md',
  showArchived: false
};

/* ---------------- utils ---------------- */

const OS_LABEL = { wsl: 'WSL', windows: 'WIN', macos: 'MAC', linux: 'LNX' };
const osLabel = (os) => OS_LABEL[os] || String(os || '?').toUpperCase().slice(0, 4);
const projLabel = (s) => (s.scope === 'global' ? '全局' : s.project);
const projName = (p) => (p === 'global' ? '全局' : p);

function relTime(ms) {
  if (!ms) return '—';
  const d = Math.floor((Date.now() - ms) / 86400000);
  if (d <= 0) return '今天';
  if (d === 1) return '昨天';
  if (d < 30) return d + ' 天前';
  if (d < 365) return Math.round(d / 30) + ' 个月前';
  return (d / 365).toFixed(1) + ' 年前';
}
function ageText(n) {
  if (n <= 0) return '今天';
  if (n < 30) return n + ' 天';
  if (n < 365) return Math.round(n / 30) + ' 月';
  return (n / 365).toFixed(1) + ' 年';
}
function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ---------------- markdown ---------------- */

function md(src) {
  let text = String(src || '').replace(/\r\n/g, '\n');
  if (text.replace(/^\uFEFF/, '').startsWith('---')) {
    const clean = text.replace(/^\uFEFF/, '');
    const end = clean.indexOf('\n---', 3);
    if (end > -1) text = clean.slice(end + 4).replace(/^\n+/, '');
  }
  const lines = text.split('\n');
  let out = [];
  let i = 0;
  let inFence = false;
  let fence = [];
  let list = [];
  let quote = [];

  const flushList = () => { if (list.length) { out.push('<ul>' + list.map((t) => '<li>' + t + '</li>').join('') + '</ul>'); list = []; } };
  const flushQuote = () => { if (quote.length) { out.push('<blockquote>' + quote.join('<br>') + '</blockquote>'); quote = []; } };

  while (i < lines.length) {
    const raw = lines[i];
    const line = raw;
    if (/^```/.test(line.trim())) {
      if (!inFence) { inFence = true; fence = []; }
      else { out.push('<pre><code>' + esc(fence.join('\n')) + '</code></pre>'); inFence = false; }
      i++; continue;
    }
    if (inFence) { fence.push(raw); i++; continue; }

    if (!line.trim()) { flushList(); flushQuote(); i++; continue; }

    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      flushList(); flushQuote();
      const lv = Math.min(h[1].length, 3);
      out.push('<h' + lv + '>' + inline(h[2]) + '</h' + lv + '>');
      i++; continue;
    }
    if (/^\s*([-*+])\s+/.test(line)) {
      flushQuote();
      list.push(inline(line.replace(/^\s*([-*+])\s+/, '')));
      i++; continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      flushQuote();
      list.push(inline(line.replace(/^\s*\d+\.\s+/, '')));
      i++; continue;
    }
    if (/^>\s?/.test(line)) { flushList(); quote.push(inline(line.replace(/^>\s?/, ''))); i++; continue; }
    if (/^(---|\*\*\*|___)\s*$/.test(line)) { flushList(); flushQuote(); out.push('<hr>'); i++; continue; }
    if (/^\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      flushList(); flushQuote();
      const rows = [line];
      i += 2;
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) { rows.push(lines[i]); i++; }
      const cells = (r) => r.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      let t = '<table><thead><tr>' + cells(rows[0]).map((c) => '<th>' + inline(c) + '</th>').join('') + '</tr></thead><tbody>';
      for (let k = 1; k < rows.length; k++) t += '<tr>' + cells(rows[k]).map((c) => '<td>' + inline(c) + '</td>').join('') + '</tr>';
      out.push(t + '</tbody></table>');
      continue;
    }
    flushList(); flushQuote();
    out.push('<p>' + inline(line) + '</p>');
    i++;
  }
  if (inFence && fence.length) out.push('<pre><code>' + esc(fence.join('\n')) + '</code></pre>');
  flushList(); flushQuote();
  return out.join('\n');

  function inline(t) {
    let s = esc(t);
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    s = s.replace(/(^|[^*])\*([^*]+)\*/g, '$1<i>$2</i>');
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    return s;
  }
}

/* ---------------- data ---------------- */

async function api(path, opts) {
  const r = await fetch(path, opts);
  if (!r.ok) throw new Error('请求失败 ' + r.status);
  return r.json();
}

async function load() {
  state.data = await api('/api/state');
  render();
  const h = decodeURIComponent(location.hash.replace(/^#/, ''));
  if (h) {
    const s = state.data.skills.find((x) => x.id === h);
    if (s) openDrawer(s);
  }
}

async function scan() {
  const btn = $('#btnScan');
  btn.disabled = true; btn.textContent = '扫描中…';
  try {
    state.data = await api('/api/scan', { method: 'POST' });
    render();
  } catch (e) {
    alert('扫描失败：' + e.message);
  } finally {
    btn.disabled = false; btn.textContent = '重新扫描';
  }
}

/* ---------------- render ---------------- */

function filterSkills() {
  const v = VIEWS.find((x) => x.id === state.view) || VIEWS[1];
  let list = state.data.skills.filter((s) => (v.archived ? s.meta.archived : !s.meta.archived));
  list = list.filter(v.fn);
  if (state.device) list = list.filter((s) => s.device === state.device);
  if (state.project) list = list.filter((s) => s.project === state.project);
  if (state.q) {
    const q = state.q.toLowerCase();
    list = list.filter((s) =>
      (s.name + ' ' + s.description + ' ' + s.project + ' ' + (s.meta.tags || []).join(' ') + ' ' + s.rel)
        .toLowerCase().includes(q));
  }
  const score = (s) => (s.flags.stale ? 100 : 0) + (s.flags.drift ? 50 : 0) + (s.flags.dueReview ? 40 : 0) + (s.flags.unreviewed ? 20 : 0) + (s.flags.aging ? 8 : 0);
  const sorters = {
    attention: (a, b) => score(b) - score(a) || b.ageDays - a.ageDays,
    mtime: (a, b) => b.mtime - a.mtime,
    name: (a, b) => a.name.localeCompare(b.name, 'zh'),
    project: (a, b) => (a.project + a.name).localeCompare(b.project + b.name, 'zh'),
    age: (a, b) => b.ageDays - a.ageDays
  };
  list.sort(sorters[state.sort] || sorters.attention);
  return list;
}

function render() {
  const st = state.data.stats;
  $('#statTotal').textContent = st.total;
  $('#statAttention').textContent = state.data.skills.filter((s) => !s.meta.archived && (s.flags.stale || s.flags.dueReview || s.flags.drift)).length;
  $('#statDup').textContent = st.dup;
  $('#statStar').textContent = st.starred;

  // nav
  const nav = $('#nav');
  nav.innerHTML = '';
  const all = state.data.skills;
  for (const v of VIEWS) {
    const n = all.filter((s) => (v.archived ? s.meta.archived : !s.meta.archived)).filter(v.fn).length;
    const li = el('li');
    li.dataset.view = v.id;
    if (state.view === v.id) li.classList.add('active');
    li.appendChild(el('span', null, v.label));
    li.appendChild(el('span', 'cnt', n));
    li.onclick = () => { state.view = v.id; state.project = null; render(); };
    nav.appendChild(li);
  }

  // devices
  const devList = $('#devList');
  devList.innerHTML = '';
  const devs = {};
  all.forEach((s) => { if (!s.meta.archived) devs[s.device] = (devs[s.device] || 0) + 1; });
  const liAllDev = el('li');
  if (!state.device) liAllDev.classList.add('active');
  liAllDev.appendChild(el('span', null, '全部位置'));
  liAllDev.onclick = () => { state.device = null; render(); };
  devList.appendChild(liAllDev);
  Object.entries(devs).sort((a, b) => b[1] - a[1]).forEach(([d, n]) => {
    const li = el('li');
    if (state.device === d) li.classList.add('active');
    li.appendChild(el('span', null, d || '未知'));
    li.appendChild(el('span', 'cnt', n));
    li.onclick = () => { state.device = state.device === d ? null : d; render(); };
    devList.appendChild(li);
  });

  // projects
  const projList = $('#projList');
  projList.innerHTML = '';
  const projs = {};
  all.forEach((s) => { if (!s.meta.archived) projs[s.project] = (projs[s.project] || 0) + 1; });
  const pli = el('li');
  if (!state.project) pli.classList.add('active');
  pli.appendChild(el('span', null, '全部项目'));
  pli.onclick = () => { state.project = null; render(); };
  projList.appendChild(pli);
  Object.entries(projs).sort((a, b) => b[1] - a[1]).slice(0, 40).forEach(([p, n]) => {
    const li = el('li');
    if (state.project === p) li.classList.add('active');
    li.appendChild(el('span', null, projName(p)));
    li.appendChild(el('span', 'cnt', n));
    li.title = p;
    li.onclick = () => { state.project = state.project === p ? null : p; render(); };
    projList.appendChild(li);
  });

  // meta line
  const sm = state.data;
  $('#scanMeta').innerHTML = sm.scannedAt
    ? `上次扫描 ${relTime(new Date(sm.scannedAt).getTime())}${sm.durationMs ? ' · ' + (sm.durationMs / 1000).toFixed(1) + 's' : ''}<br>${sm.stats.projects} 个项目 · ${sm.stats.devices} 个位置`
    : '尚未扫描';

  // rows
  const list = filterSkills();
  const v = VIEWS.find((x) => x.id === state.view) || VIEWS[1];
  $('#viewTitle').textContent = v.label;
  $('#viewCount').textContent = list.length + ' 个';
  const tbody = $('#rows');
  tbody.innerHTML = '';
  const frag = document.createDocumentFragment();

  for (const s of list) {
    const tr = document.createElement('tr');

    const tdDot = el('td', 'c-dot');
    tdDot.appendChild(el('span', 'dot ' + s.status));
    tr.appendChild(tdDot);

    const tdName = el('td', 'c-name');
    const nm = el('div', 'skill-name', s.name);
    if (s.kind === 'vendor') nm.appendChild(el('span', 'chip vendor', '第三方'));
    tdName.appendChild(nm);
    tdName.appendChild(el('div', 'skill-desc', s.description || '（无描述）'));
    tr.appendChild(tdName);

    const tdLoc = el('td', 'c-loc');
    const ll = el('div', 'loc-line');
    ll.appendChild(el('span', 'chip ' + (s.os === 'wsl' ? 'wsl' : 'win'), osLabel(s.os)));
    ll.appendChild(el('span', null, projLabel(s)));
    tdLoc.appendChild(ll);
    tr.appendChild(tdLoc);

    const tdTime = el('td', 'c-time');
    const tc = el('div', 'time-cell');
    tc.appendChild(el('b', null, relTime(s.mtime)));
    tc.appendChild(el('div', 'sub', '龄期 ' + ageText(s.ageDays)));
    tdTime.appendChild(tc);
    tr.appendChild(tdTime);

    const tdB = el('td', 'c-badge');
    if (s.flags.stale) tdB.appendChild(el('span', 'chip stale', '沉睡'));
    else if (s.flags.dueReview) tdB.appendChild(el('span', 'chip due', '该复查'));
    else if (s.flags.unreviewed) tdB.appendChild(el('span', 'chip unreviewed', '未审查'));
    if (s.flags.dup) tdB.appendChild(el('span', 'chip dup', '重复 ×' + s.dupCount));
    if (s.flags.drift) tdB.appendChild(el('span', 'chip drift', '项目已更新'));
    if (s.worktree) tdB.appendChild(el('span', 'chip wt', 'worktree'));
    (s.meta.tags || []).slice(0, 2).forEach((t) => tdB.appendChild(el('span', 'chip', t)));
    tr.appendChild(tdB);

    const tdStar = el('td', 'c-star');
    const star = el('button', 'star' + (s.meta.star ? ' on' : ''), s.meta.star ? '★' : '☆');
    star.onclick = async (ev) => {
      ev.stopPropagation();
      await api('/api/meta', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: s.id, patch: { star: !s.meta.star } }) });
      s.meta.star = !s.meta.star;
      star.textContent = s.meta.star ? '★' : '☆';
      star.classList.toggle('on', s.meta.star);
      $('#statStar').textContent = state.data.skills.filter((x) => x.meta.star).length;
    };
    tdStar.appendChild(star);
    tr.appendChild(tdStar);

    tr.onclick = () => openDrawer(s);
    frag.appendChild(tr);
  }
  tbody.appendChild(frag);
  const empty = $('#empty');
  empty.hidden = list.length > 0;
  if (!list.length) empty.textContent = state.q ? '没有匹配的技能' : '这个视图下暂时没有技能';
}

/* ---------------- drawer ---------------- */

async function openDrawer(s) {
  state.current = s;
  state.editing = false;
  state.fileSel = 'SKILL.md';
  history.replaceState(null, '', '#' + s.id);
  $('#drawer').hidden = false;
  $('#backdrop').hidden = false;
  $('#dName').textContent = s.name;
  $('#dPath').textContent = s.file;
  $('#dContent').textContent = '加载中…';
  $('#dEditor').hidden = true;
  $('#dContent').hidden = false;
  switchTab('preview');
  renderDrawerMeta(s);
  renderMetaFields(s);
  try {
    const d = await api('/api/skill?id=' + encodeURIComponent(s.id) + '&meta=1');
    state.files = d.files || [];
    $('#dContent').innerHTML = md(d.content);
    renderFiles();
  } catch (e) {
    $('#dContent').textContent = '读取失败：' + e.message;
  }
}

function renderDrawerMeta(s) {
  const box = $('#dMeta');
  box.innerHTML = '';
  box.appendChild(el('span', 'chip ' + (s.os === 'wsl' ? 'wsl' : 'win'), osLabel(s.os)));
  box.appendChild(el('span', 'chip', s.device || '未知设备'));
  box.appendChild(el('span', 'chip', s.scope === 'global' ? '全局技能' : '项目技能'));
  box.appendChild(el('span', 'chip', projLabel(s)));
  box.appendChild(el('span', 'chip', '更新于 ' + relTime(s.mtime)));
  box.appendChild(el('span', 'chip', '审查 ' + (s.meta.reviewedAt ? relTime(new Date(s.meta.reviewedAt).getTime()) : '从未')));
  if (s.flags.dup) box.appendChild(el('span', 'chip dup', '同名 ×' + s.dupCount + (s.sameContentCount > 1 ? ' · 同内容 ×' + s.sameContentCount : '')));
  if (s.flags.drift) box.appendChild(el('span', 'chip drift', '项目提交领先 ' + s.driftDays + ' 天'));
  $('#dStar').textContent = s.meta.star ? '取消收藏' : '收藏';
  $('#dArchive').textContent = s.meta.archived ? '取消归档' : '归档';
}

function renderMetaFields(s) {
  $('#dTags').value = (s.meta.tags || []).join(', ');
  $('#dNote').value = s.meta.note || '';
}

function switchTab(name) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  $('#tab-preview').hidden = name !== 'preview';
  $('#tab-files').hidden = name !== 'files';
  $('#tab-notes').hidden = name !== 'notes';
}

function renderFiles() {
  const ul = $('#dFiles');
  ul.innerHTML = '';
  for (const f of state.files) {
    const li = el('li', f.rel === state.fileSel ? 'sel' : '');
    li.appendChild(el('span', null, f.rel));
    li.appendChild(el('span', 'sz', f.size > 1024 ? (f.size / 1024).toFixed(1) + ' KB' : f.size + ' B'));
    li.onclick = async () => {
      state.fileSel = f.rel;
      renderFiles();
      const d = await api('/api/skill?id=' + encodeURIComponent(state.current.id) + '&file=' + encodeURIComponent(f.rel));
      if (state.editing) $('#dText').value = d.content;
      else $('#dContent').innerHTML = md(d.content);
    };
    ul.appendChild(li);
  }
  if (!state.files.length) ul.appendChild(el('li', null, '（空）'));
}

function closeDrawer() {
  $('#drawer').hidden = true;
  $('#backdrop').hidden = true;
  state.current = null;
  history.replaceState(null, '', location.pathname);
}

/* ---------------- actions ---------------- */

async function patchMeta(patch) {
  if (!state.current) return;
  const r = await api('/api/meta', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: state.current.id, patch }) });
  Object.assign(state.current.meta, r.meta || patch);
  const fresh = state.data.skills.find((x) => x.id === state.current.id);
  if (fresh) Object.assign(fresh.meta, state.current.meta);
  render();
  renderDrawerMeta(state.current);
}

function bind() {
  $('#q').oninput = (e) => { state.q = e.target.value.trim(); render(); };
  $('#sort').onchange = (e) => { state.sort = e.target.value; render(); };
  $('#btnScan').onclick = scan;
  $('#devClear').onclick = () => { state.device = null; render(); };
  $('#backdrop').onclick = closeDrawer;
  $('#dClose').onclick = closeDrawer;

  document.querySelectorAll('.tab').forEach((t) => t.onclick = () => switchTab(t.dataset.tab));

  $('#dStar').onclick = async () => { await patchMeta({ star: !state.current.meta.star }); };
  $('#dReview').onclick = async () => {
    await patchMeta({ reviewedAt: new Date().toISOString() });
    $('#dSaveHint').textContent = '';
    $('#dReview').textContent = '已标记 ✓';
    setTimeout(() => { $('#dReview').textContent = '标记已审查'; }, 1400);
  };
  $('#dArchive').onclick = async () => {
    const want = !state.current.meta.archived;
    await patchMeta({ archived: want });
    if (want) closeDrawer();
  };
  $('#dOpen').onclick = async () => {
    await api('/api/open', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: state.current.id }) });
  };
  $('#dEdit').onclick = async () => {
    if (state.editing) return;
    const d = await api('/api/skill?id=' + encodeURIComponent(state.current.id) + '&file=' + encodeURIComponent(state.fileSel));
    $('#dText').value = d.content;
    state.editing = true;
    $('#dContent').hidden = true;
    $('#dEditor').hidden = false;
  };
  $('#dCancel').onclick = () => {
    state.editing = false;
    $('#dEditor').hidden = true;
    $('#dContent').hidden = false;
  };
  $('#dSave').onclick = async () => {
    $('#dSaveHint').textContent = '保存中…';
    try {
      await api('/api/skill', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: state.current.id, file: state.fileSel, content: $('#dText').value })
      });
      $('#dSaveHint').textContent = '已保存';
      state.editing = false;
      $('#dEditor').hidden = true;
      $('#dContent').hidden = false;
      $('#dContent').innerHTML = md($('#dText').value);
      const d = await api('/api/skill?id=' + encodeURIComponent(state.current.id) + '&meta=1');
      const fresh = state.data.skills.find((x) => x.id === state.current.id);
      if (fresh) { fresh.mtime = d.skill.mtime; fresh.name = d.skill.name; fresh.description = d.skill.description; fresh.ageDays = d.skill.ageDays; fresh.status = d.skill.status; fresh.flags = d.skill.flags; }
      state.current = d.skill;
      render();
      renderDrawerMeta(state.current);
      setTimeout(() => { $('#dSaveHint').textContent = ''; }, 2000);
    } catch (e) {
      $('#dSaveHint').textContent = '保存失败：' + e.message;
    }
  };
  $('#dSaveMeta').onclick = async () => {
    const tags = $('#dTags').value.split(/[,，]/).map((t) => t.trim()).filter(Boolean);
    await patchMeta({ tags, note: $('#dNote').value });
    $('#dSaveMeta').textContent = '已保存 ✓';
    setTimeout(() => { $('#dSaveMeta').textContent = '保存标签与备注'; }, 1400);
  };

  // settings
  $('#btnSettings').onclick = openSettings;
  $('#btnCloseSettings').onclick = () => { $('#settingsModal').hidden = true; };
  $('#settingsModal').onclick = (e) => { if (e.target.id === 'settingsModal') $('#settingsModal').hidden = true; };
  $('#btnSaveSettings').onclick = async () => {
    const roots = [...document.querySelectorAll('#rootsList .root-item')].map((r) => {
      const orig = state.data.roots.find((x) => x.id === r.dataset.id);
      return { ...orig, enabled: r.querySelector('input').checked };
    });
    await api('/api/roots', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roots, settings: { staleDays: $('#staleDays').value, reviewDays: $('#reviewDays').value } })
    });
    $('#settingsModal').hidden = true;
    await scan();
  };
  $('#btnExport').onclick = () => { window.open('/api/export', '_blank'); };
  $('#btnImport').onclick = () => $('#fileImport').click();
  $('#fileImport').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const text = await f.text();
    try {
      const payload = JSON.parse(text);
      const r = await api('/api/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      alert('已合并 ' + r.merged + ' 条笔记');
      await load();
    } catch (err) { alert('导入失败：' + err.message); }
  };

  // keyboard
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
      e.preventDefault(); $('#q').focus();
    }
    if (e.key === 'Escape') {
      if (!$('#settingsModal').hidden) $('#settingsModal').hidden = true;
      else if (!$('#drawer').hidden) closeDrawer();
    }
  });

  // auto refresh
  const saved = localStorage.getItem('skilltidy.auto') === '1';
  $('#autoRefresh').checked = saved;
  let timer = null;
  const setupAuto = () => {
    if (timer) clearInterval(timer);
    timer = null;
    if ($('#autoRefresh').checked) timer = setInterval(() => scan().catch(() => { }), 5 * 60 * 1000);
  };
  $('#autoRefresh').onchange = (e) => {
    localStorage.setItem('skilltidy.auto', e.target.checked ? '1' : '0');
    setupAuto();
  };
  setupAuto();
}

function openSettings() {
  const box = $('#rootsList');
  box.innerHTML = '';
  for (const r of state.data.roots) {
    const item = el('div', 'root-item');
    item.dataset.id = r.id;
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = r.enabled;
    item.appendChild(cb);
    const main = el('div', 'ri-main');
    main.appendChild(el('div', 'ri-label', r.label + (r.kind === 'vendor' ? '（第三方）' : '') + ' · ' + (r.scope === 'global' ? '全局' : '项目')));
    main.appendChild(el('div', 'ri-path', r.path));
    item.appendChild(main);
    box.appendChild(item);
  }
  $('#staleDays').value = state.data.settings.staleDays;
  $('#reviewDays').value = state.data.settings.reviewDays;
  $('#settingsModal').hidden = false;
}

bind();
load().catch((e) => {
  document.body.innerHTML = '<div style="padding:40px;font-family:system-ui">加载失败：' + esc(e.message) + '</div>';
});
