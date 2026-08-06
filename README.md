# skill-finder

Find every Claude skill installed on your machine and list them in one place.

Skills end up scattered across several directories — your personal `~/.claude/skills`,
each installed plugin, marketplace checkouts, per-project `.claude/skills`, and the
bundles the Claude desktop app unpacks. `skill-finder` walks all of them, reads each
`SKILL.md`, and prints a single table.

No dependencies. No install required.

```bash
npx skill-finder
```

```
SKILL                SOURCE                DESCRIPTION
docx                 app                   Create, read and edit Word documents
pdf                  app                   Read, merge, split and fill PDF files
babysit              plugin:claude-mem     Watch a pull request until it is ready to merge
graphify             user                  Turn any input into a persistent knowledge graph

114 skills in 3 locations
plugin: 89  user: 14  app: 11
```

## Usage

```bash
npx skill-finder                  # every skill found
npx skill-finder pdf              # only skills matching "pdf"
npx skill-finder --source user    # only your own skills
npx skill-finder --show graphify  # full detail for one skill
npx skill-finder --json           # machine-readable output
```

Install it permanently if you use it often:

```bash
npm install -g skill-finder
```

## Options

| Option | Meaning |
| --- | --- |
| `-j, --json` | Print JSON: skills, search roots, read errors |
| `-l, --list` | One tab-separated line per skill (`name`, `source`, `path`) |
| `-p, --paths` | Print only `SKILL.md` paths |
| `-s, --show <name>` | Full detail for a single skill |
| `-d, --dir <path>` | Scan this directory instead of the defaults (repeatable) |
| `--source <kind>` | Filter to `user`, `project`, `plugin` or `app` |
| `--depth <n>` | Directory levels to descend per root (default `8`) |
| `--duplicates` | Keep copies of the same plugin skill found in two places |
| `--body` | Include the `SKILL.md` body in `--json` / `--show` output |
| `--no-color` | Disable ANSI colors (also honours `NO_COLOR`) |

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
import { findSkills, filterSkills } from 'skill-finder';

const { skills, roots, errors } = await findSkills();

for (const skill of filterSkills(skills, 'pdf')) {
  console.log(skill.name, skill.source, skill.path);
}
```

`findSkills(options)` accepts:

- `roots` — array of paths or `{ dir, kind }` objects, replacing the defaults
- `cwd` — base directory for project lookup and relative roots
- `maxDepth` — directory levels per root (default `8`)
- `includeBody` — keep the `SKILL.md` body on each result
- `duplicates` — keep duplicate copies instead of collapsing them

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
