#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findSkills, filterSkills } from '../src/scan.js';
import { colorsEnabled, createStyler, formatDetail, formatList, formatTable } from '../src/format.js';

const HELP = `skill-finder - find every Claude skill installed on this machine

Usage
  skill-finder [query] [options]

Options
  -j, --json          print machine-readable JSON
  -l, --list          print one tab-separated line per skill (name, source, path)
  -p, --paths         print only SKILL.md paths
  -s, --show <name>   print full details for one skill
  -d, --dir <path>    scan this directory instead of the default locations
                      (repeatable)
      --source <kind> only user, project or plugin skills
      --depth <n>     directory depth per root (default 8)
      --duplicates    keep copies of the same plugin skill found twice
      --body          include SKILL.md body in --json / --show output
      --no-color      disable ANSI colors
  -v, --version       print version
  -h, --help          print this help

Examples
  npx skill-finder                 list every skill found
  npx skill-finder pdf             list skills matching "pdf"
  npx skill-finder --source plugin only skills shipped by plugins
  npx skill-finder --show pdf      full detail for the pdf skill
  npx skill-finder --json > skills.json
`;

main().catch((error) => {
  process.stderr.write(`skill-finder: ${error.message}\n`);
  process.exit(1);
});

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) return print(HELP.trimEnd());
  if (options.version) return print(readVersion());

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

  const style = createStyler(options.color ?? colorsEnabled());

  if (options.show) {
    const needle = options.show.toLowerCase();
    const match =
      results.find((skill) => skill.name.toLowerCase() === needle) ??
      results.find((skill) => skill.name.toLowerCase().includes(needle));

    if (!match) {
      process.stderr.write(`skill-finder: no skill matching "${options.show}"\n`);
      process.exit(1);
    }

    if (options.json) return print(JSON.stringify(match, null, 2));
    return print(formatDetail(match, { style }));
  }

  if (options.json) {
    return print(
      JSON.stringify(
        {
          count: results.length,
          roots: roots.map((root) => root.dir),
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
  print(style.dim(`${results.length} skill${results.length === 1 ? '' : 's'} in ${roots.length} location${roots.length === 1 ? '' : 's'}`));
  print(
    style.dim(
      summarize(results) +
        (duplicates.length && !options.duplicates
          ? `  (${duplicates.length} duplicate copies hidden, --duplicates to show)`
          : '')
    )
  );

  if (errors.length) {
    process.stderr.write(`${errors.length} path(s) could not be read (use --json to see them)\n`);
  }
}

function parseArgs(argv) {
  const options = {
    query: '',
    dirs: [],
    depth: 8,
    json: false,
    list: false,
    paths: false,
    body: false,
    duplicates: false,
    help: false,
    version: false,
    show: null,
    source: null,
    color: undefined
  };

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
      case '--no-color':
        options.color = false;
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
      case '--depth':
        options.depth = Number(next());
        if (!Number.isFinite(options.depth) || options.depth < 1) {
          throw new Error('--depth must be a positive number');
        }
        break;
      default:
        if (arg.startsWith('-')) throw new Error(`unknown option: ${arg}`);
        options.query = options.query ? `${options.query} ${arg}` : arg;
    }
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

function readVersion() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const pkg = JSON.parse(fs.readFileSync(path.join(here, '..', 'package.json'), 'utf8'));
  return pkg.version;
}

function print(text) {
  process.stdout.write(`${text}\n`);
}
