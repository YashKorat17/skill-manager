# @yashkorat17/skill-manager

Find every Claude skill installed on your machine, see what each one costs you in
tokens, and delete the ones you do not want.

Skills end up scattered across several directories — your personal `~/.claude/skills`,
each installed plugin, marketplace checkouts, per-project `.claude/skills`, and the
bundles the Claude desktop app unpacks. `skill-manager` walks all of them, reads each
`SKILL.md`, and prints a single table.

No dependencies. No install required.

```bash
npx @yashkorat17/skill-manager
```

```
SKILL             SOURCE               ALWAYS  ON USE  DESCRIPTION
context-mode      plugin:context-mode     230     13k  Use context-mode tools instead of Bash
xlsx              app                     226    276k  Any task where a spreadsheet is input
docx              app                     199    282k  Create, read and edit Word documents
babysit           plugin:claude-mem        46    989   Watch a pull request until it merges

context weight  1.6k tokens always loaded  + 895k on demand
heaviest: context-mode (230), xlsx (226), docx (199)
114 skills in 3 locations  plugin: 89  user: 14  app: 11
```

## Token weight

Every installed skill has two very different costs:

- **ALWAYS** — the skill's name and description are injected into the system prompt
  of *every* session, whether you use the skill or not. This is the number that
  quietly eats your context window.
- **ON USE** — the `SKILL.md` body plus any bundled files, read only once the skill
  actually triggers. A 280k-token skill is free until you call it.

So the useful question is not "which skill is biggest" but "which skill is biggest
in every single session":

```bash
npx @yashkorat17/skill-manager --sort tokens --top 10
```

Counts are estimates from a ~4-characters-per-token heuristic — no tokenizer is
bundled, which is why this package has zero dependencies. Treat them as an order of
magnitude, not a bill.

## Interactive menu

Run it with no arguments in a terminal and you get a menu instead of a table:

```
 skill-manager
--------------------------------------------------------------------------------

114 skills  plugin 89  user 14  app 11
8.5k tokens in every session  + 2057k loaded on demand

> Browse all skills         search, inspect, delete
  Token consumption         what every session pays for
  Install skills            browse plugins from marketplaces
  Marketplaces              add or refresh sources
  Update everything         package, marketplaces, plugins
  Quit

up/down move   enter select   esc/q quit
```

- **Browse all skills** — arrow keys to move, `/` to filter, `enter` for full detail,
  `d` to delete (with a confirmation screen and a backup).
- **Token consumption** — every skill ranked by what it costs in *every* session,
  as a bar chart with each skill's share of the total.
- **Install skills** — the full plugin catalog of your configured marketplaces
  (286 plugins here), searchable, `enter` installs.
- **Marketplaces** — list configured sources, add a new one by `owner/repo`, URL or
  path, or refresh them all.
- **Update everything** — one key updates this package, every marketplace and every
  installed plugin, streaming the output as it goes.

The menu only opens when stdin and stdout are both a TTY and no other flag was
given, so pipes and scripts keep the plain output. Force either mode with
`skill-manager ui` or `skill-manager --no-ui`.

Installing and updating plugins is delegated to the `claude` CLI — it owns the
marketplace config and plugin cache. Without it on your PATH, those two screens
explain what is missing and everything else still works.

## Updating

```bash
skill-manager update            # package + marketplaces + plugins
skill-manager update --check    # report what is outdated, change nothing
skill-manager update --self     # only this npm package
skill-manager update --plugins  # only marketplaces and plugins
```

```
+ @yashkorat17/skill-manager v1.2.0 -> v1.3.0
+ marketplaces all sources refreshed
= caveman@caveman v0.4.1
+ claude-mem@thedotmack updated

2 item(s) updated - restart Claude Code to load them
```

Restart Claude Code afterwards — plugin updates only take effect in a new session.

## Usage

```bash
npx @yashkorat17/skill-manager                    # interactive menu
npx @yashkorat17/skill-manager --no-ui            # every skill found
npx @yashkorat17/skill-manager pdf                # only skills matching "pdf"
npx @yashkorat17/skill-manager --sort tokens      # heaviest always-loaded first
npx @yashkorat17/skill-manager --source user      # only your own skills
npx @yashkorat17/skill-manager --show graphify    # full detail for one skill
npx @yashkorat17/skill-manager rm old-skill       # delete a skill (asks first)
npx @yashkorat17/skill-manager --json             # machine-readable output
```

Install it permanently if you use it often:

```bash
npm install -g @yashkorat17/skill-manager
```

## Deleting skills

```bash
skill-manager rm <name>
```

The name is matched the same way as the search query, so a prefix is enough. Before
anything is removed you get the skill's path, how many tokens it frees, and a warning
if it is managed by something that will put it back.

```
$ skill-manager rm old-helper
old-helper  user
/home/you/.claude/skills/old-helper
frees 61 tokens from every session, 1.2k on demand
Delete this skill directory? [y/N]
```

Safety rules:

- The directory must contain the `SKILL.md` that was scanned, so a wrong path can
  never take out an unrelated tree. A bare `skills/` directory is refused outright.
- The directory is copied into a backup folder under your temp directory first.
  Pass `--no-backup` to skip that.
- Without a TTY the command refuses to run unless you pass `--yes`.
- `--dry-run` prints exactly what would be deleted and touches nothing.

Deleting a `plugin` or `app` skill works, but it will return the next time that
plugin or the desktop app updates — uninstall the plugin instead for a permanent
removal. `skill-manager` says so before it deletes.

## Options

| Option | Meaning |
| --- | --- |
| `-j, --json` | Print JSON: skills, token totals, search roots, read errors |
| `-l, --list` | One tab-separated line per skill (`name`, `source`, `always`, `on-use`, `path`) |
| `-p, --paths` | Print only `SKILL.md` paths |
| `-s, --show <name>` | Full detail for a single skill |
| `-d, --dir <path>` | Scan this directory instead of the defaults (repeatable) |
| `--source <kind>` | Filter to `user`, `project`, `plugin` or `app` |
| `--sort <key>` | `name` (default), `tokens` (always-loaded), `total`, `source`, `modified` |
| `--top <n>` | Keep only the first n rows after sorting |
| `--depth <n>` | Directory levels to descend per root (default `8`) |
| `--duplicates` | Keep copies of the same plugin skill found in two places |
| `--body` | Include the `SKILL.md` body in `--json` / `--show` output |
| `--no-color` | Disable ANSI colors (also honours `NO_COLOR`) |
| `--no-ui` | Never open the interactive menu |

Delete options, for `rm`:

| Option | Meaning |
| --- | --- |
| `-y, --yes` | Do not ask for confirmation |
| `--dry-run` | Show what would be deleted, delete nothing |
| `--no-backup` | Do not copy the skill aside before deleting |
| `--all` | Also delete duplicate copies of the same skill |

Update options, for `update`:

| Option | Meaning |
| --- | --- |
| `--check` | Report what is outdated, change nothing |
| `--self` | Only update this npm package |
| `--plugins` | Only update marketplaces and installed plugins |

The search query matches skill name, description, plugin name and allowed tools,
case-insensitively.

## Where it looks

| Source | Location |
| --- | --- |
| `user` | `$CLAUDE_CONFIG_DIR`, `~/.claude`, `~/.config/claude` |
| `plugin` | `<config>/plugins/**` (marketplace checkouts and the version-pinned cache) |
| `project` | `.claude` in the working directory and every parent directory |
| `app` | Claude desktop app skill bundles (`%APPDATA%\Claude`, `~/Library/Application Support/Claude`, `~/.config/Claude`) |

A skill is any `SKILL.md` inside a `skills/` directory. Plugin names come from the
plugin's own `plugin.json` when there is one, so a version-pinned cache path like
`claude-mem/13.13.1/skills/babysit` still reports as `plugin:claude-mem`.

Because a plugin installed from a marketplace usually exists twice on disk, identical
skills from the same plugin are collapsed into one row. Pass `--duplicates` to see
every copy.

Directories that never hold skills (`node_modules`, `.git`, `dist`, `build`, caches)
are skipped, and unreadable paths are collected into the `errors` array of `--json`
rather than aborting the scan.

## Programmatic use

```js
import { findSkills, filterSkills, removeSkill } from '@yashkorat17/skill-manager';

const { skills, roots, errors } = await findSkills();

for (const skill of filterSkills(skills, 'pdf')) {
  console.log(skill.name, skill.source, skill.tokens.always, skill.path);
}

// Heaviest always-loaded skills
const heavy = [...skills].sort((a, b) => b.tokens.always - a.tokens.always).slice(0, 5);

// Deleting is opt-in and backs up by default
await removeSkill(heavy[0], { dryRun: true });
```

`findSkills(options)` accepts:

- `roots` — array of paths or `{ dir, kind }` objects, replacing the defaults
- `cwd` — base directory for project lookup and relative roots
- `maxDepth` — directory levels per root (default `8`)
- `includeBody` — keep the `SKILL.md` body on each result
- `duplicates` — keep duplicate copies instead of collapsing them

Other exports: `checkUpdates` / `updateAll` (from `update.js`), `listPlugins`,
`listAvailablePlugins`, `listMarketplaces` (thin wrappers over the `claude` CLI),
`weighSkill` and `estimateTokens`.

`removeSkill(skill, options)` accepts `dryRun`, `backup` (default `true`) and
`includeDuplicates`, and resolves to `{ removed, backup, skipped }`. It never throws
on a refused target — the reason lands in `skipped`.

Each skill looks like:

```json
{
  "name": "pdf",
  "description": "Read, merge, split and fill PDF files",
  "source": "plugin",
  "plugin": "anthropic-skills",
  "scope": "user",
  "root": "/home/you/.claude",
  "dir": "/home/you/.claude/plugins/.../skills/pdf",
  "path": "/home/you/.claude/plugins/.../skills/pdf/SKILL.md",
  "duplicatePaths": [],
  "tokens": { "always": 41, "onUse": 1180, "bundled": 6400, "total": 7621 },
  "allowedTools": ["Read", "Bash"],
  "model": null,
  "version": null,
  "license": null,
  "metadata": { "name": "pdf", "description": "..." },
  "resources": ["reference.md", "scripts/"],
  "size": 4812,
  "modified": "2026-08-06T10:12:33.000Z"
}
```

`metadata` holds the raw parsed frontmatter, so skill-specific keys survive.

## Requirements

Node.js 18 or newer.

## License

MIT
