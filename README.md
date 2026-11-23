# SkillTidy

**Know which skills still hold, and which ones you already checked.**

`apm` and `asm` get skills *installed*. Nothing looks after them afterwards: the skill
you wrote six months ago, forked into three worktrees, describing a CLI that has since
been renamed.

SkillTidy answers two questions and ignores the rest:

- **Which copy is the real one?** The same skill in five repos, three of them worktree leftovers.
- **When did I last confirm this still holds?** A record only you can keep.

Everything else follows: it counts **drift** (commits that landed after the skill was
last touched) instead of guessing from file age, it reads **Windows and WSL in one
list**, and it keeps your confirmations in a local ledger. Zero dependencies, no
network calls, read-only by default.

![SkillTidy dashboard](https://raw.githubusercontent.com/moyumksmehappy/skilltidy/main/docs/screenshot.png)

```
  SkillTidy - 9 skills  (0.3s, 1 root)
  7 need a decision   3 confirmed   6 never confirmed
  7 drifted   9 untouched 90d+   0 vendor

NAME                STATE       CONFIRMED  UPDATED  SCOPE    PROJECT
deploy-runbook      drift +31   never      238d     project  personal-site
terraform-review    drift +18   never      95d      project  infra
api-conventions     ok          6d ago     238d     project  acme-api
```

## Quick start

```bash
npx skilltidy init     # find skill folders on this machine, write ~/.skilltidy/config.json
npx skilltidy scan     # what do I actually have?
npx skilltidy ui       # open the dashboard at http://127.0.0.1:7788
```

Or install it once:

```bash
npm i -g skilltidy
skilltidy ui
```

Requires Node 18+. There is nothing to compile and nothing to configure by hand —
`init` looks for `.claude/skills`, `.codex/skills`, `.agents/skills`,
`.workbuddy/skills`, `.codebuddy/skills` and the usual project folders, on the host
and inside every WSL distro.

## Commands

| Command | What it does |
|---|---|
| `skilltidy init` | Detect scan roots, write the config. `--force` to redo. |
| `skilltidy scan` | List skills ordered by how much attention they need. `--json`, `--limit n`, `--all` |
| `skilltidy check` | CI gate. Exits 1 when the rules you name are violated. |
| `skilltidy ui` | Local dashboard. `--port n`, `--no-open` |
| `skilltidy open <name>` | Reveal a skill folder in Explorer / Finder / xdg-open |
| `skilltidy disable <name>` | Turn a skill off so agents stop loading it — see below |
| `skilltidy enable <name>` | Turn it back on |
| `skilltidy tag <name> --add a,b` | Add or remove tags. `--list` shows the histogram |

## What the states mean

| Flag | Meaning | Default |
|---|---|---|
| `drift` | N commits landed in the repo after the skill was last touched | >= 10 commits |
| `dup` | Other skills share the same name (possibly different content) | — |
| `due` | You confirmed it `reviewDays` ago, time to look again | 45 days |
| `stale` | `SKILL.md` untouched for longer than `staleDays` — informational, not a decision | 90 days |
| `never` | Never confirmed. The initial state of everything | — |
| `off` | Disabled: the manifest is renamed, agents skip it, nothing asks for attention | — |

Only `drift` and `dup` are **decisions**: cases where the tool can point at evidence
that something is off. "You have not looked at this yet" is bookkeeping, not a finding.

"Confirm still holds" is the load-bearing action. It writes no files — it records that
you looked at the skill and decided it is still correct, and a confirmation newer than
the newest commit settles the drift.

## Turning a skill off

There is exactly one action in this tool that changes your files, and it is a rename:

```
SKILL.md  ->  SKILL.md.disabled
```

That is the whole implementation. Agent tools look for a file called `SKILL.md`, so
the skill stops being loaded. Nothing is moved, nothing is edited, no content is
touched — the same bytes are still there, under a name the agent ignores. Renaming it
back is the entire undo, and `skilltidy enable` does exactly that.

Why a rename rather than a flag in `meta.json`: a flag would only make the dashboard
*look* like the skill is off while the agent kept loading it. If the point is to stop
it from being used, the file has to be the thing that changes.

Three consequences worth knowing:

- **The dashboard keeps showing it.** Scanning looks for both names, so a disabled
  skill stays in the "已停用 / disabled" view with its tags, notes and history intact.
  A skill you cannot see is a skill you cannot turn back on.
- **git sees it.** If the skill lives in a repo, the rename is a normal file change
  (a delete plus an add). Commit it if you want the state to travel with the repo, or
  gitignore `*.disabled` if you want it local only.
- **Disabled skills drop out of every rule.** No drift, no duplicate, no stale, no
  `check --fail-on` failure. You answered the question already; it is not asking again.

## Tags

Tags live in `~/.skilltidy/meta.json` and never in your skill files, so they cost
nothing to add and sync between machines with the rest of the state. A skill's
frontmatter `tags:` are shown too — merged and de-duplicated — but they are treated as
read-only, because they belong to the file.

The dashboard has a tag list in the sidebar (click to filter, combine with a view or a
project) and one-click reuse of an existing tag in the drawer, so you do not end up with
`backend`, `Backend` and `后端` as three different things. From the terminal:

```bash
skilltidy tag deploy-runbook --add deploy,ops
skilltidy tag "diagnose" --remove temp
skilltidy tag --list
```

## How drift is measured

Drift is a commit count, not an age. For each skill, SkillTidy finds the last commit
that touched its folder, then counts how many commits landed in that repo since:

```
diagnose  ->  1294 commits since the skill was last edited
```

A skill untouched for a year that describes an unchanged process is fine. A skill
edited last week that points at a renamed flag is not. Counting commits is the only
cheap signal that tells those two apart.

Cost: one `rev-list` per repo plus one `git log -1` per skill folder, so large
histories stay cheap. On WSL the whole loop runs inside the distro in a single
`wsl.exe` call. Drift is skipped for worktrees (duplicated history), vendor packs
(someone else's repo), and when no working git binary can be found — `SKILLTIDY_DEBUG=1`
prints which binary was chosen.

## Why not just use `asm` / `apm` / a registry?

They solve distribution: getting a skill from a repo into `.claude/skills`.

SkillTidy solves hygiene: noticing that you have 131 duplicates, that 123 skills have
not been touched in a year, and that the repo changed after you wrote the instructions.
They compose fine — SkillTidy only reads what is on disk.

There are already a few local dashboards that *list* your skills. The gaps they leave
are the two this project was built around:

- **Nothing crosses the WSL boundary.** Your skills are usually half on Windows, half
  inside a distro, in repos that no host-side scanner will ever walk. Which means
  "this is the same skill in three places" is a claim nobody else can make.
- **Nothing knows when you last looked.** Listing is easy; the hard part is that a
  skill only rots relative to reality. SkillTidy keeps the one piece of data no linter
  can generate — your confirmations — and checks it against the commit history.

## Multi-device

The dashboard is per-machine; your annotations are portable.

```bash
skilltidy ui           # settings → Export notes   (on machine A)
skilltidy ui           # settings → Import notes   (on machine B)
```

Merging is field-wise: newest review wins, tags union, longer note wins, star is OR.

If you prefer syncing the whole state folder (`~/.skilltidy`), keep it in a private
repo — it is just `config.json`, `meta.json` and a cache. Skill ids are derived from
`root id + path relative to that root`, so the same skill keeps its id on another
machine as long as the root is named the same.

## Configuration

`~/.skilltidy/config.json` (override the folder with `SKILLTIDY_HOME`):

```json
{
  "staleDays": 90,
  "reviewDays": 45,
  "driftCommits": 10,
  "git": { "enabled": true, "wsl": true },
  "roots": [
    {
      "id": "wsl-pros",
      "label": "WSL - projects",
      "path": "\\\\wsl.localhost\\Ubuntu\\home\\you\\pros",
      "device": "WSL Ubuntu",
      "scope": "project",
      "kind": "mine",
      "enabled": true,
      "maxDepth": 8
    }
  ],
  "skipDirs": [".git", "node_modules", "cache", ".tmp"],
  "vendorPatterns": ["/node_modules/", "/.claude/plugins/marketplaces/"]
}
```

- `scope: global` — a tool-level skills folder; the dashboard shows it as "global"
- `scope: project` — a folder of repos; each skill is attributed to the repo it sits in
- `kind: vendor` — third-party collections, greyed out and filterable
- `skipDirs` — plugin caches. Skipping these matters: one `.codex/.tmp/plugins` folder
  can contain 600 skills and drown the list
- `vendorPatterns` — path fragments marking a skill as third-party
- `driftCommits` — how many commits after a skill's last edit count as drift
- `git.wsl` — set `false` if you do not want git called inside a distro

See `examples/` for macOS, Linux and Windows+WSL starting points.

## How the scanning works

Two adapters, chosen by path shape:

- **fs adapter** — normal `readdir` walk for Windows / macOS / Linux. Stops descending as
  soon as it finds a `SKILL.md`.
- **WSL adapter** — for `\\wsl.localhost\...` paths. Walks *inside* the distro with a
  native `find`, because recursive traversal over the 9p UNC mount is about 90x slower
  (89s vs 1s on a mid-size repo). The script is passed as base64: `wsl.exe` mangles
  `$variables` and single quotes in forwarded command lines.

Git is resolved by probing `where`/`which` output and keeping the first binary that
actually prints a version: on some machines the bare name hits a shim that exits
silently, which would quietly report zero drift everywhere.

## In CI

```yaml
- run: npx skilltidy check --fail-on drift --drift-commits 25
```

Useful in a repo that ships its own skills: fail the build when the code has moved on
far enough that the instructions are probably lying.

## Non-goals

Not a package manager, not a registry, not a desktop app, not a SaaS.
It reads what other tools wrote and tells you the truth about it, with one deliberate
exception: `disable` / `enable` renames the manifest, because "stop the agent from
loading this" cannot be done by reading.

## 中文速览

`apm`/`asm` 管技能怎么装，SkillTidy 管技能还成不成立。

它只回答两个问题：**哪一份才是正本**，以及**你上次确认它还成立是什么时候**。

「项目已领先」数的是提交次数 —— 技能上次改动之后，仓库又提交了多少次，而不是
文件放了多久。放了一年但流程没变，不算问题；上周改的却指向一个已经改名的参数，才算。

```bash
npx skilltidy init   # 自动探测本机与 WSL 里的技能目录
npx skilltidy scan   # 看看自己到底写了多少，哪些需要决策
npx skilltidy ui     # 打开看板 http://127.0.0.1:7788
npx skilltidy disable diagnose   # 停用：改名成 SKILL.md.disabled
npx skilltidy tag deploy-runbook --add deploy,ops
```

零依赖、不联网、默认只读。星标/标签/备注/确认记录存在 `~/.skilltidy/meta.json`，
可以跨设备导出导入。详见 `examples/config.windows-wsl.json`。

**停用**是唯一会动你文件的动作，做法就是改名 `SKILL.md` → `SKILL.md.disabled`：
内容一个字节不改，agent 不再加载它，改回来就是完整恢复（`skilltidy enable`）。
看板仍会列出它（「已停用」视图），否则你没法把它再打开。

## License

MIT
