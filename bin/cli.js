#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { findSkills, filterSkills } from '../src/scan.js';
import { deletionWarnings, removeSkill } from '../src/remove.js';
import {
  colorsEnabled,
  createStyler,
  formatDetail,
  formatList,
  formatTable,
  formatWeight
} from '../src/format.js';

const HELP = `skill-manager - find every Claude skill installed on this machine,
see what it costs in tokens, install more, update them and delete the rest.

Usage
  skill-manager                     interactive menu (in a terminal)
  skill-manager [query] [options]   print a table instead
  skill-manager rm <name> [options] delete a skill
  skill-manager update [options]    update package, marketplaces and plugins
  skill-manager ui                  force the interactive menu

Options
  -j, --json          print machine-readable JSON
  -l, --list          one tab-separated line per skill
                      (name, source, always, on-use, path)
  -p, --paths         print only SKILL.md paths
  -s, --show <name>   print full details for one skill
  -d, --dir <path>    scan this directory instead of the default locations
                      (repeatable)
      --source <kind> only user, project, plugin or app skills
      --sort <key>    name (default), tokens, source or modified
      --top <n>       keep only the first n rows after sorting
      --depth <n>     directory depth per root (default 8)
      --duplicates    keep copies of the same plugin skill found twice
      --body          include SKILL.md body in --json / --show output
      --suggest       recommend marketplace plugins matching this project
      --report        save a progress report (skill counts + token weight)
      --graph         open graphify-out/graph.html in the browser, if it exists
      --tidy-ide      add files.exclude entries to .vscode/settings.json
      --no-color      disable ANSI colors
      --no-ui         never open the interactive menu
  -v, --version       print version
  -h, --help          print this help

Delete options (rm)
  -y, --yes           do not ask for confirmation
      --dry-run       show what would be deleted, delete nothing
      --no-backup     do not copy the skill aside before deleting
      --all           also delete duplicate copies of the same skill

Update options (update)
      --check         report what is outdated, change nothing
      --self          only update this npm package
      --plugins       only update marketplaces and plugins

Token weight
  ALWAYS is the name + description, which sit in the system prompt of every
  session. ON USE is the SKILL.md body plus bundled files, read only once the
  skill triggers. Counts are estimates (~4 characters per token).

Examples
  skill-manager                      interactive menu
  skill-manager --no-ui              list every skill with its token weight
  skill-manager --sort tokens --top 10   the 10 heaviest skills
  skill-manager --source user        only your own skills
  skill-manager --show graphify      full detail for one skill
  skill-manager rm old-skill --dry-run
  skill-manager update --check
  skill-manager --json > skills.json
`;

main().catch((error) => {
  process.stderr.write(`skill-manager: ${error.message}\n`);
  process.exit(1);
});

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) return print(HELP.trimEnd());
  if (options.version) return print(readVersion());
  if (options.command === 'update') return update(options);
  if (options.suggest) return suggest(options);
  if (options.report) return report(options);
  if (options.graph) return graph(options);
  if (options.tidyIde) return tidyIdeCommand(options);

  // Bare `skill-manager` in a terminal opens the menu; anything else - a query,
  // a flag, a pipe - keeps the plain printing behaviour scripts rely on.
  if (options.command === 'ui' || (options.command === 'list' && isBareInteractive(options))) {
    const { startUI } = await import('../src/ui.js');
    return startUI({
      pkg: readPackage().name,
      version: readPackage().version,
      color: options.color ?? colorsEnabled()
    });
  }

  const { skills, roots, errors, duplicates } = await findSkills({
    roots: options.dirs.length ? options.dirs : undefined,
    maxDepth: options.depth,
    includeBody: options.body,
    duplicates: options.duplicates
  });

  let results = filterSkills(skills, options.query);
  if (options.source) {
    results = results.filter((skill) => skill.source === options.source);
  }
  results = sortSkills(results, options.sort);
  if (options.top) results = results.slice(0, options.top);

  const style = createStyler(options.color ?? colorsEnabled());

  if (options.command === 'rm') return remove(results, options, style);

  if (options.show) {
    const match = pickSkill(results, options.show);
    if (!match) return notFound(options.show);
    if (options.json) return print(JSON.stringify(match, null, 2));
    return print(formatDetail(match, { style }));
  }

  if (options.json) {
    return print(
      JSON.stringify(
        {
          count: results.length,
          roots: roots.map((root) => root.dir),
          tokens: totals(results),
          skills: results,
          duplicates: duplicates.length,
          errors
        },
        null,
        2
      )
    );
  }

  if (options.paths) return print(results.map((skill) => skill.path).join('\n'));
  if (options.list) return print(formatList(results));

  if (!results.length) {
    print(style.yellow('No skills found.'));
    print(style.dim(`Searched: ${roots.map((root) => root.dir).join(', ') || 'nothing'}`));
    return;
  }

  print(formatTable(results, { style, width: terminalWidth() }));
  print('');
  print(formatWeight(results, { style }));
  print(
    style.dim(
      `${results.length} skill${results.length === 1 ? '' : 's'} in ${roots.length} location${
        roots.length === 1 ? '' : 's'
      }  ${summarize(results)}${
        duplicates.length && !options.duplicates
          ? `  (${duplicates.length} duplicate copies hidden)`
          : ''
      }`
    )
  );

  if (errors.length) {
    process.stderr.write(`${errors.length} path(s) could not be read (use --json to see them)\n`);
  }
}

async function remove(results, options, style) {
  const match = pickSkill(results, options.target);
  if (!match) return notFound(options.target);

  const warnings = deletionWarnings(match);

  print(`${style.bold(match.name)}  ${style.dim(match.plugin ? `plugin:${match.plugin}` : match.source)}`);
  print(match.dir);
  print(
    style.dim(
      `frees ${match.tokens.always} tokens from every session, ${
        match.tokens.onUse + match.tokens.bundled
      } on demand`
    )
  );
  for (const warning of warnings) print(style.yellow(`warning: ${warning}`));

  if (options.dryRun) {
    const { removed, skipped } = await removeSkill(match, {
      dryRun: true,
      includeDuplicates: options.all
    });
    for (const dir of removed) print(style.dim(`would delete ${dir}`));
    for (const item of skipped) print(style.yellow(`would skip ${item.path}: ${item.reason}`));
    return;
  }

  if (!options.yes) {
    // Deleting a directory is not reversible from the shell, so require an
    // explicit yes; a non-interactive run must pass --yes on purpose.
    if (!process.stdin.isTTY) {
      throw new Error('refusing to delete without confirmation - pass --yes');
    }

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(`Delete this skill directory? [y/N] `);
    rl.close();

    if (!/^y(es)?$/i.test(answer.trim())) return print('Cancelled.');
  }

  const { removed, backup, skipped } = await removeSkill(match, {
    backup: options.backup,
    includeDuplicates: options.all
  });

  for (const dir of removed) print(style.green(`deleted ${dir}`));
  for (const item of skipped) print(style.yellow(`skipped ${item.path}: ${item.reason}`));
  if (backup) print(style.dim(`backup: ${backup}`));
  if (!removed.length) process.exitCode = 1;
}

function isBareInteractive(options) {
  if (options.ui === false) return false;
  if (options.json || options.list || options.paths || options.show) return false;
  if (options.query || options.source || options.dirs.length || options.top) return false;
  return Boolean(process.stdout.isTTY && process.stdin.isTTY);
}

/** Non-interactive counterpart of the update screen. */
async function update(options) {
  const { checkUpdates, updateAll } = await import('../src/update.js');
  const pkg = readPackage();
  const style = createStyler(options.color ?? colorsEnabled());

  if (options.check) {
    const status = await checkUpdates({ pkg: pkg.name, version: pkg.version });

    print(
      status.self.outdated
        ? style.yellow(`${pkg.name}  v${pkg.version} -> v${status.self.latest}`)
        : style.green(`${pkg.name}  v${pkg.version} is current`)
    );

    if (!status.claudeAvailable) {
      print(style.yellow('claude CLI not found - plugin and marketplace updates unavailable'));
      return;
    }

    print(`${status.marketplaces.length} marketplace(s), ${status.plugins.length} plugin(s)`);
    for (const plugin of status.plugins) {
      print(style.dim(`  ${plugin.id} ${plugin.version ?? ''}`));
    }
    return;
  }

  const results = await updateAll({
    pkg: pkg.name,
    version: pkg.version,
    self: !options.plugins,
    marketplaces: !options.self,
    plugins: !options.self,
    onProgress: (event) => {
      if (event.status === 'running') return;
      const mark =
        event.status === 'updated'
          ? style.green('+')
          : event.status === 'current'
            ? style.dim('=')
            : event.status === 'skipped'
              ? style.yellow('-')
              : style.red('x');
      print(`${mark} ${event.step} ${style.dim(event.detail ?? '')}`);
    }
  });

  const changed = results.filter((item) => item.status === 'updated').length;
  print('');
  print(
    changed
      ? style.bold(`${changed} item(s) updated - restart Claude Code to load them`)
      : style.dim('everything already up to date')
  );

  if (results.some((item) => item.status === 'failed')) process.exitCode = 1;
}

/** Non-interactive counterpart of the suggest screen. */
async function suggest(options) {
  const { suggestSkills } = await import('../src/suggest.js');
  const style = createStyler(options.color ?? colorsEnabled());
  const { categories, suggestions } = await suggestSkills();

  print(
    categories.length
      ? style.dim(`detected: ${categories.join(', ')}`)
      : style.dim('no known stack detected from package.json or config files')
  );

  if (!suggestions.length) {
    print(style.yellow('No matching plugins found in the configured marketplaces.'));
    return;
  }

  for (const plugin of suggestions) {
    const stars = plugin.stars != null ? `* ${plugin.stars}` : '* ?';
    print(
      `${style.bold(plugin.name)}  ${style.dim(plugin.marketplace)}  ${style.dim(stars)}  ${plugin.description}`
    );
  }
  print('');
  print(style.dim(`install with: claude plugin install <name>@<marketplace>`));
}

async function report() {
  const { buildReport, saveReport } = await import('../src/report.js');
  const { skills, roots } = await findSkills();
  const text = buildReport({ skills, roots });
  const file = saveReport(process.cwd(), text);
  print(`Report saved: ${file}`);
}

async function graph() {
  const { findProjectGraph, openInBrowser } = await import('../src/graph.js');
  const file = findProjectGraph(process.cwd());
  if (!file) {
    print('No graphify-out/graph.html found. Generate one first with the graphify skill (/graphify).');
    process.exitCode = 1;
    return;
  }
  openInBrowser(file);
  print(`Opened ${file}`);
}

async function tidyIdeCommand() {
  const { tidyIde } = await import('../src/ide.js');
  const { file, added } = tidyIde(process.cwd());
  print(`Updated ${file}`);
  print(added.length ? `Added: ${added.join(', ')}` : 'Nothing to add - already tidy.');
}

function pickSkill(skills, needle) {
  const query = String(needle).toLowerCase();
  return (
    skills.find((skill) => skill.name.toLowerCase() === query) ??
    skills.find((skill) => skill.path.toLowerCase() === query) ??
    skills.find((skill) => skill.name.toLowerCase().includes(query)) ??
    null
  );
}

function notFound(needle) {
  process.stderr.write(`skill-manager: no skill matching "${needle}"\n`);
  process.exit(1);
}

function sortSkills(skills, key) {
  const byName = (a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path);

  switch (key) {
    case 'tokens':
      return [...skills].sort(
        (a, b) => (b.tokens?.always ?? 0) - (a.tokens?.always ?? 0) || byName(a, b)
      );
    case 'total':
      return [...skills].sort(
        (a, b) => (b.tokens?.total ?? 0) - (a.tokens?.total ?? 0) || byName(a, b)
      );
    case 'source':
      return [...skills].sort(
        (a, b) =>
          `${a.source}${a.plugin ?? ''}`.localeCompare(`${b.source}${b.plugin ?? ''}`) || byName(a, b)
      );
    case 'modified':
      return [...skills].sort((a, b) => String(b.modified).localeCompare(String(a.modified)));
    default:
      return [...skills].sort(byName);
  }
}

function totals(skills) {
  return skills.reduce(
    (acc, skill) => ({
      always: acc.always + (skill.tokens?.always ?? 0),
      onUse: acc.onUse + (skill.tokens?.onUse ?? 0),
      bundled: acc.bundled + (skill.tokens?.bundled ?? 0),
      total: acc.total + (skill.tokens?.total ?? 0)
    }),
    { always: 0, onUse: 0, bundled: 0, total: 0 }
  );
}

function parseArgs(argv) {
  const options = {
    command: 'list',
    target: null,
    query: '',
    dirs: [],
    depth: 8,
    sort: 'name',
    top: 0,
    json: false,
    list: false,
    paths: false,
    body: false,
    duplicates: false,
    suggest: false,
    report: false,
    graph: false,
    tidyIde: false,
    help: false,
    version: false,
    show: null,
    source: null,
    yes: false,
    dryRun: false,
    backup: true,
    all: false,
    check: false,
    self: false,
    plugins: false,
    ui: undefined,
    color: undefined
  };

  const positional = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (value == null) throw new Error(`${arg} needs a value`);
      i += 1;
      return value;
    };

    switch (arg) {
      case '-h':
      case '--help':
        options.help = true;
        break;
      case '-v':
      case '--version':
        options.version = true;
        break;
      case '-j':
      case '--json':
        options.json = true;
        break;
      case '-l':
      case '--list':
        options.list = true;
        break;
      case '-p':
      case '--paths':
        options.paths = true;
        break;
      case '--body':
        options.body = true;
        break;
      case '--duplicates':
        options.duplicates = true;
        break;
      case '--suggest':
        options.suggest = true;
        break;
      case '--report':
        options.report = true;
        break;
      case '--graph':
        options.graph = true;
        break;
      case '--tidy-ide':
        options.tidyIde = true;
        break;
      case '--no-color':
        options.color = false;
        break;
      case '--no-ui':
        options.ui = false;
        break;
      case '--check':
        options.check = true;
        break;
      case '--self':
        options.self = true;
        break;
      case '--plugins':
        options.plugins = true;
        break;
      case '-y':
      case '--yes':
        options.yes = true;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--no-backup':
        options.backup = false;
        break;
      case '--all':
        options.all = true;
        break;
      case '-s':
      case '--show':
        options.show = next();
        break;
      case '-d':
      case '--dir':
        options.dirs.push(next());
        break;
      case '--source':
        options.source = next();
        break;
      case '--sort':
        options.sort = next();
        if (!['name', 'tokens', 'total', 'source', 'modified'].includes(options.sort)) {
          throw new Error(`--sort must be name, tokens, total, source or modified`);
        }
        break;
      case '--top':
        options.top = Number(next());
        if (!Number.isFinite(options.top) || options.top < 1) {
          throw new Error('--top must be a positive number');
        }
        break;
      case '--depth':
        options.depth = Number(next());
        if (!Number.isFinite(options.depth) || options.depth < 1) {
          throw new Error('--depth must be a positive number');
        }
        break;
      default:
        if (arg.startsWith('-')) throw new Error(`unknown option: ${arg}`);
        positional.push(arg);
    }
  }

  if (['ui', 'menu'].includes(positional[0])) {
    options.command = 'ui';
  } else if (['update', 'upgrade'].includes(positional[0])) {
    options.command = 'update';
  } else if (['rm', 'remove', 'delete'].includes(positional[0])) {
    options.command = 'rm';
    options.target = positional[1];
    if (!options.target && !options.help) throw new Error('rm needs a skill name');
    // `--all` deletes the copies recorded on `duplicatePaths`, which only exist
    // when duplicates are collapsed - so rm always scans with collapsing on.
    if (options.all) options.duplicates = false;
  } else {
    options.query = positional.join(' ');
  }

  return options;
}

function summarize(skills) {
  const counts = new Map();
  for (const skill of skills) {
    counts.set(skill.source, (counts.get(skill.source) ?? 0) + 1);
  }
  return [...counts.entries()].map(([source, count]) => `${source}: ${count}`).join('  ');
}

function terminalWidth() {
  return Math.max(60, Math.min(process.stdout.columns || 100, 160));
}

let cachedPackage;

function readPackage() {
  if (!cachedPackage) {
    const here = path.dirname(fileURLToPath(import.meta.url));
    cachedPackage = JSON.parse(fs.readFileSync(path.join(here, '..', 'package.json'), 'utf8'));
  }
  return cachedPackage;
}

function readVersion() {
  return readPackage().version;
}

function print(text) {
  process.stdout.write(`${text}\n`);
}
