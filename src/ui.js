import readline from 'node:readline';
import process from 'node:process';
import { findSkills, filterSkills } from './scan.js';
import { deletionWarnings, removeSkill } from './remove.js';
import { claude, hasClaude, listAvailablePlugins, listMarketplaces, listPlugins } from './claude.js';
import { checkUpdates, updateAll } from './update.js';
import { createStyler, formatDetail } from './format.js';
import { formatTokens } from './tokens.js';

const ESC = String.fromCharCode(27);
const CLEAR = `${ESC}[2J${ESC}[H`;
const HIDE_CURSOR = `${ESC}[?25l`;
const SHOW_CURSOR = `${ESC}[?25h`;

/**
 * A small full-screen menu app.
 *
 * Everything is redrawn on each keypress instead of being diffed - the screens
 * are a few dozen lines each, so a full repaint is simpler and fast enough, and
 * it keeps the code free of any rendering library.
 */
export async function startUI(context = {}) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('the interactive menu needs a terminal - run without --no-ui in a TTY');
  }

  const style = createStyler(context.color ?? true);
  const out = process.stdout;

  const state = {
    style,
    pkg: context.pkg,
    version: context.version,
    skills: [],
    roots: [],
    duplicates: [],
    status: '',
    claudeAvailable: await hasClaude()
  };

  out.write(HIDE_CURSOR);
  const restore = () => {
    out.write(SHOW_CURSOR);
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
  };
  process.on('exit', restore);

  await reloadSkills(state);

  try {
    await home(state);
  } finally {
    restore();
    out.write('\n');
  }
}

async function reloadSkills(state) {
  const { skills, roots, duplicates } = await findSkills();
  state.skills = skills;
  state.roots = roots;
  state.duplicates = duplicates;
}

/* ------------------------------------------------------------------ screens */

async function home(state) {
  for (;;) {
    const choice = await menu(state, {
      title: 'skill-manager',
      subtitle: homeSummary(state),
      items: [
        { key: 'all skills', label: 'Browse all skills', hint: 'search, inspect, delete' },
        { key: 'weight', label: 'Token consumption', hint: 'what every session pays for' },
        { key: 'install', label: 'Install skills', hint: 'browse plugins from marketplaces' },
        { key: 'marketplaces', label: 'Marketplaces', hint: 'add or refresh sources' },
        { key: 'update', label: 'Update everything', hint: 'package, marketplaces, plugins' },
        { key: 'quit', label: 'Quit' }
      ]
    });

    if (choice === null || choice === 'quit') return;

    if (choice === 'all skills') await browse(state, state.skills, 'All skills');
    if (choice === 'weight') await weightScreen(state);
    if (choice === 'install') await installScreen(state);
    if (choice === 'marketplaces') await marketplaceScreen(state);
    if (choice === 'update') await updateScreen(state);
  }
}

function homeSummary(state) {
  const s = state.style;
  const always = state.skills.reduce((total, skill) => total + (skill.tokens?.always ?? 0), 0);
  const onUse = state.skills.reduce(
    (total, skill) => total + (skill.tokens?.onUse ?? 0) + (skill.tokens?.bundled ?? 0),
    0
  );

  const sources = new Map();
  for (const skill of state.skills) {
    sources.set(skill.source, (sources.get(skill.source) ?? 0) + 1);
  }

  return [
    `${s.bold(String(state.skills.length))} skills  ${s.dim(
      [...sources.entries()].map(([kind, count]) => `${kind} ${count}`).join('  ')
    )}`,
    `${s.bold(formatTokens(always))} tokens in every session  ${s.dim(
      `+ ${formatTokens(onUse)} loaded on demand`
    )}`,
    state.claudeAvailable ? '' : s.yellow('claude CLI not on PATH - install and update are disabled')
  ]
    .filter(Boolean)
    .join('\n');
}

/** Scrollable skill list. Enter inspects, d deletes, / filters. */
async function browse(state, skills, title) {
  let query = '';
  let cursor = 0;
  let offset = 0;

  for (;;) {
    const rows = filterSkills(skills, query);
    cursor = Math.min(cursor, Math.max(0, rows.length - 1));

    const height = Math.max(5, (process.stdout.rows || 24) - 10);
    if (cursor < offset) offset = cursor;
    if (cursor >= offset + height) offset = cursor - height + 1;

    const s = state.style;
    const lines = rows.slice(offset, offset + height).map((skill, index) => {
      const selected = offset + index === cursor;
      const marker = selected ? s.cyan('>') : ' ';
      const source = skill.plugin ? `plugin:${skill.plugin}` : skill.source;
      const label = `${padEnd(skill.name, 28)} ${s.dim(padEnd(source, 22))} ${padStart(
        formatTokens(skill.tokens?.always ?? 0),
        6
      )}  ${s.dim(truncate(skill.description, Math.max(20, (process.stdout.columns || 100) - 70)))}`;
      return `${marker} ${selected ? s.bold(label) : label}`;
    });

    draw(state, {
      title,
      subtitle: query
        ? `${s.dim('filter:')} ${query}  ${s.dim(`${rows.length} match`)}`
        : s.dim(`${rows.length} skills  ALWAYS column = tokens spent in every session`),
      body: lines.join('\n') || s.dim('nothing matches'),
      footer: 'up/down move   enter details   d delete   / filter   esc back'
    });

    const key = await readKey();
    if (!key) return;

    if (key.name === 'escape' || key.name === 'q' || key.ctrl) return;
    if (key.name === 'up') cursor = Math.max(0, cursor - 1);
    if (key.name === 'down') cursor = Math.min(rows.length - 1, cursor + 1);
    if (key.name === 'pageup') cursor = Math.max(0, cursor - height);
    if (key.name === 'pagedown') cursor = Math.min(rows.length - 1, cursor + height);
    if (key.name === 'home') cursor = 0;
    if (key.name === 'end') cursor = rows.length - 1;

    if (key.name === 'return' && rows[cursor]) {
      await detailScreen(state, rows[cursor]);
    }

    if (key.name === 'd' && rows[cursor]) {
      const deleted = await deleteScreen(state, rows[cursor]);
      if (deleted) {
        await reloadSkills(state);
        skills = state.skills;
        cursor = Math.max(0, cursor - 1);
      }
    }

    if (key.name === '/') {
      query = await prompt(state, 'filter:', query);
      cursor = 0;
      offset = 0;
    }
  }
}

async function detailScreen(state, skill) {
  draw(state, {
    title: skill.name,
    body: formatDetail(skill, { style: state.style }),
    footer: 'd delete   esc back'
  });

  const key = await readKey();
  if (key?.name === 'd') {
    const deleted = await deleteScreen(state, skill);
    if (deleted) await reloadSkills(state);
  }
}

async function deleteScreen(state, skill) {
  const s = state.style;
  const warnings = deletionWarnings(skill);

  draw(state, {
    title: `Delete ${skill.name}?`,
    body: [
      skill.dir,
      '',
      `frees ${s.bold(formatTokens(skill.tokens?.always ?? 0))} tokens from every session`,
      `and ${formatTokens((skill.tokens?.onUse ?? 0) + (skill.tokens?.bundled ?? 0))} loaded on demand`,
      '',
      ...warnings.map((warning) => s.yellow(`warning: ${warning}`)),
      '',
      s.dim('a backup copy is kept in your temp directory')
    ].join('\n'),
    footer: 'y delete   any other key cancel'
  });

  const key = await readKey();
  if (key?.name !== 'y') return false;

  const result = await removeSkill(skill, { backup: true });
  state.status = result.removed.length
    ? `deleted ${skill.name} (backup: ${result.backup})`
    : `could not delete ${skill.name}: ${result.skipped[0]?.reason ?? 'unknown error'}`;

  return result.removed.length > 0;
}

/** Skills ranked by what they cost in every session. */
async function weightScreen(state) {
  const s = state.style;
  const ranked = [...state.skills].sort(
    (a, b) => (b.tokens?.always ?? 0) - (a.tokens?.always ?? 0)
  );

  const always = ranked.reduce((total, skill) => total + (skill.tokens?.always ?? 0), 0);
  const width = Math.max(10, Math.min((process.stdout.columns || 100) - 60, 40));
  const heaviest = ranked[0]?.tokens?.always ?? 1;

  const body = ranked.slice(0, Math.max(5, (process.stdout.rows || 24) - 14)).map((skill) => {
    const value = skill.tokens?.always ?? 0;
    const filled = Math.max(1, Math.round((value / heaviest) * width));
    const share = always ? ((value / always) * 100).toFixed(1) : '0.0';
    const bar = value >= 300 ? s.red('#'.repeat(filled)) : value >= 120 ? s.yellow('#'.repeat(filled)) : s.green('#'.repeat(filled));
    return `${padEnd(skill.name, 30)} ${padStart(formatTokens(value), 6)}  ${padStart(`${share}%`, 6)}  ${bar}`;
  });

  draw(state, {
    title: 'Token consumption',
    subtitle: [
      `${s.bold(formatTokens(always))} tokens are injected into every session by ${state.skills.length} skills`,
      s.dim('this is the name + description of each skill; bodies load only when a skill fires')
    ].join('\n'),
    body: body.join('\n'),
    footer: 'esc back'
  });

  await readKey();
}

/** Browse the plugin catalog of every configured marketplace and install one. */
async function installScreen(state) {
  const s = state.style;

  if (!state.claudeAvailable) {
    return message(state, 'Install skills', [
      'The claude CLI was not found on PATH.',
      '',
      'Skills ship inside plugins, and installing one is done by the CLI:',
      s.dim('  claude plugin install <plugin>@<marketplace>'),
      '',
      'Install Claude Code first, then come back.'
    ]);
  }

  draw(state, { title: 'Install skills', body: s.dim('loading catalog...') });
  let catalog = await listAvailablePlugins();

  if (!catalog.length) {
    return message(state, 'Install skills', [
      'No plugins are available from the configured marketplaces.',
      '',
      'Add a marketplace first from the Marketplaces screen.'
    ]);
  }

  let query = '';
  let cursor = 0;
  let offset = 0;

  for (;;) {
    const rows = query
      ? catalog.filter((plugin) =>
          `${plugin.name} ${plugin.marketplace} ${plugin.description}`
            .toLowerCase()
            .includes(query.toLowerCase())
        )
      : catalog;

    cursor = Math.min(cursor, Math.max(0, rows.length - 1));
    const height = Math.max(5, (process.stdout.rows || 24) - 10);
    if (cursor < offset) offset = cursor;
    if (cursor >= offset + height) offset = cursor - height + 1;

    const lines = rows.slice(offset, offset + height).map((plugin, index) => {
      const selected = offset + index === cursor;
      const marker = selected ? s.cyan('>') : ' ';
      const tag = plugin.installed ? s.green('installed') : s.dim(plugin.marketplace);
      const label = `${padEnd(plugin.name, 34)} ${padEnd(tag, 24)} ${s.dim(
        truncate(plugin.description, Math.max(20, (process.stdout.columns || 100) - 68))
      )}`;
      return `${marker} ${selected ? s.bold(label) : label}`;
    });

    draw(state, {
      title: 'Install skills',
      subtitle: query
        ? `${s.dim('filter:')} ${query}  ${s.dim(`${rows.length} match`)}`
        : s.dim(`${catalog.length} plugins from ${new Set(catalog.map((p) => p.marketplace)).size} marketplaces`),
      body: lines.join('\n') || s.dim('nothing matches'),
      footer: 'up/down move   enter install   / filter   esc back'
    });

    const key = await readKey();
    if (!key || key.name === 'escape' || key.name === 'q' || key.ctrl) return;
    if (key.name === 'up') cursor = Math.max(0, cursor - 1);
    if (key.name === 'down') cursor = Math.min(rows.length - 1, cursor + 1);
    if (key.name === 'pageup') cursor = Math.max(0, cursor - height);
    if (key.name === 'pagedown') cursor = Math.min(rows.length - 1, cursor + height);

    if (key.name === '/') {
      query = await prompt(state, 'filter:', query);
      cursor = 0;
      offset = 0;
    }

    if (key.name === 'return' && rows[cursor]) {
      const plugin = rows[cursor];

      if (plugin.installed) {
        await message(state, plugin.name, ['This plugin is already installed.']);
        continue;
      }

      await runTask(state, `Installing ${plugin.id}`, (log) =>
        claude(['plugin', 'install', plugin.id], { onData: log })
      );

      catalog = await listAvailablePlugins();
      await reloadSkills(state);
    }
  }
}

async function marketplaceScreen(state) {
  const s = state.style;

  if (!state.claudeAvailable) {
    return message(state, 'Marketplaces', ['The claude CLI was not found on PATH.']);
  }

  for (;;) {
    const marketplaces = await listMarketplaces();

    const body = marketplaces.length
      ? marketplaces
          .map((market) => `  ${padEnd(market.name, 34)} ${s.dim(market.repo ?? market.source ?? '')}`)
          .join('\n')
      : s.dim('no marketplaces configured');

    const choice = await menu(state, {
      title: 'Marketplaces',
      subtitle: `${body}\n`,
      items: [
        { key: 'add', label: 'Add a marketplace', hint: 'owner/repo, URL or local path' },
        { key: 'refresh', label: 'Refresh all marketplaces' },
        { key: 'back', label: 'Back' }
      ]
    });

    if (choice === null || choice === 'back') return;

    if (choice === 'add') {
      const source = await prompt(state, 'marketplace (owner/repo, URL or path):', '');
      if (!source.trim()) continue;
      await runTask(state, `Adding ${source}`, (log) =>
        claude(['plugin', 'marketplace', 'add', source.trim()], { onData: log })
      );
    }

    if (choice === 'refresh') {
      await runTask(state, 'Refreshing marketplaces', (log) =>
        claude(['plugin', 'marketplace', 'update'], { onData: log })
      );
    }
  }
}

/** One screen that checks, then updates, everything at once. */
async function updateScreen(state) {
  const s = state.style;

  draw(state, { title: 'Update', body: s.dim('checking for updates...') });
  const status = await checkUpdates({ pkg: state.pkg, version: state.version });

  const lines = [];
  if (status.self.name) {
    lines.push(
      status.self.outdated
        ? `${padEnd(status.self.name, 34)} ${s.yellow(`v${status.self.current} -> v${status.self.latest}`)}`
        : `${padEnd(status.self.name, 34)} ${s.green(`v${status.self.current ?? '?'} up to date`)}`
    );
  }

  lines.push(
    `${padEnd('marketplaces', 34)} ${s.dim(`${status.marketplaces.length} configured`)}`,
    `${padEnd('plugins', 34)} ${s.dim(`${status.plugins.length} installed`)}`,
    ''
  );

  for (const plugin of status.plugins.slice(0, 12)) {
    lines.push(`  ${padEnd(plugin.id, 40)} ${s.dim(plugin.version ?? '')}`);
  }
  if (status.plugins.length > 12) lines.push(s.dim(`  ...and ${status.plugins.length - 12} more`));

  const choice = await menu(state, {
    title: 'Update',
    subtitle: `${lines.join('\n')}\n`,
    items: [
      { key: 'all', label: 'Update everything', hint: 'package + marketplaces + plugins' },
      { key: 'plugins', label: 'Update plugins only' },
      { key: 'self', label: `Update ${state.pkg ?? 'this package'} only` },
      { key: 'back', label: 'Back' }
    ]
  });

  if (choice === null || choice === 'back') return;

  await runTask(state, 'Updating', async (log) => {
    const results = await updateAll({
      pkg: state.pkg,
      version: state.version,
      self: choice === 'all' || choice === 'self',
      marketplaces: choice === 'all' || choice === 'plugins',
      plugins: choice === 'all' || choice === 'plugins',
      onProgress: (event) => {
        if (event.status === 'running') return log(`${event.step}...\n`);
        log(`${statusMark(state, event.status)} ${event.step} ${event.detail ?? ''}\n`);
      }
    });

    const changed = results.filter((item) => item.status === 'updated').length;
    log(`\n${changed} item(s) updated. Restart Claude Code to load the new versions.\n`);
    return { code: 0 };
  });

  await reloadSkills(state);
}

function statusMark(state, status) {
  const s = state.style;
  if (status === 'updated') return s.green('+');
  if (status === 'current') return s.dim('=');
  if (status === 'skipped') return s.yellow('-');
  return s.red('x');
}

/* ------------------------------------------------------------ screen plumbing */

/** Renders a titled screen. */
function draw(state, { title, subtitle, body, footer }) {
  const s = state.style;
  const width = Math.min(process.stdout.columns || 100, 160);

  const out = [
    CLEAR,
    s.cyan(s.bold(` ${title} `)),
    s.dim('-'.repeat(Math.max(10, Math.min(width, 80)))),
    ''
  ];

  if (subtitle) out.push(subtitle, '');
  if (body) out.push(body);

  out.push('');
  if (state.status) {
    out.push(s.green(state.status));
    state.status = '';
  }
  if (footer) out.push(s.dim(footer));

  process.stdout.write(`${out.join('\n')}\n`);
}

/** Arrow-key menu. Resolves to the chosen item's key, or null on escape. */
async function menu(state, { title, subtitle, items }) {
  let cursor = 0;

  for (;;) {
    const s = state.style;
    const body = items
      .map((item, index) => {
        const selected = index === cursor;
        const label = `${padEnd(item.label, 26)}${item.hint ? s.dim(item.hint) : ''}`;
        return `${selected ? s.cyan('>') : ' '} ${selected ? s.bold(label) : label}`;
      })
      .join('\n');

    draw(state, { title, subtitle, body, footer: 'up/down move   enter select   esc/q quit' });

    const key = await readKey();
    if (!key) return null;
    if (key.name === 'escape' || key.name === 'q' || key.ctrl) return null;
    if (key.name === 'up') cursor = (cursor - 1 + items.length) % items.length;
    if (key.name === 'down') cursor = (cursor + 1) % items.length;
    if (key.name === 'return') return items[cursor].key;

    const digit = Number.parseInt(key.name, 10);
    if (Number.isInteger(digit) && digit >= 1 && digit <= items.length) {
      return items[digit - 1].key;
    }
  }
}

async function message(state, title, lines) {
  draw(state, { title, body: lines.join('\n'), footer: 'any key to go back' });
  await readKey();
}

/** Runs a long task, streaming its output onto the screen. */
async function runTask(state, title, task) {
  const s = state.style;
  let buffer = '';

  const render = () => {
    const height = Math.max(5, (process.stdout.rows || 24) - 8);
    const tail = buffer.split('\n').slice(-height).join('\n');
    draw(state, { title, body: tail || s.dim('working...'), footer: '' });
  };

  render();
  const log = (chunk) => {
    buffer += chunk;
    render();
  };

  const result = await task(log);

  draw(state, {
    title,
    body: buffer || s.dim('done'),
    footer: result?.code === 0 ? 'done - any key to go back' : 'finished with errors - any key to go back'
  });

  await readKey();
  return result;
}

/** Single-line text input, drawn under the current screen. */
async function prompt(state, label, initial = '') {
  const stdin = process.stdin;
  const wasRaw = stdin.isRaw;
  if (wasRaw) stdin.setRawMode(false);
  process.stdout.write(SHOW_CURSOR);

  const rl = readline.createInterface({ input: stdin, output: process.stdout });
  const answer = await rl.question(`${state.style.cyan(label)} `, { signal: undefined }).catch(
    () => initial
  );
  rl.close();

  process.stdout.write(HIDE_CURSOR);
  if (wasRaw) stdin.setRawMode(true);
  return answer ?? initial;
}

/** Resolves the next keypress, or null when input is closed. */
function readKey() {
  const stdin = process.stdin;
  readline.emitKeypressEvents(stdin);
  if (stdin.isTTY) stdin.setRawMode(true);
  stdin.resume();

  return new Promise((resolve) => {
    const onKey = (_char, key) => {
      stdin.removeListener('keypress', onKey);
      stdin.pause();

      if (!key) return resolve(null);
      // Ctrl+C and Ctrl+D read as "close this screen" everywhere.
      if (key.ctrl && (key.name === 'c' || key.name === 'd')) return resolve(null);
      resolve(key);
    };

    stdin.on('keypress', onKey);
  });
}

function padEnd(text, width) {
  const value = truncate(String(text ?? ''), width);
  return value.length >= width ? value : value + ' '.repeat(width - value.length);
}

function padStart(text, width) {
  const value = String(text ?? '');
  return value.length >= width ? value : ' '.repeat(width - value.length) + value;
}

function truncate(text, width) {
  const value = String(text ?? '');
  if (value.length <= width) return value;
  if (width <= 3) return value.slice(0, width);
  return `${value.slice(0, width - 3)}...`;
}
