import { spawn } from 'node:child_process';
import process from 'node:process';

/**
 * Thin wrapper around the `claude` CLI.
 *
 * Everything that installs or updates a plugin is delegated to it rather than
 * reimplemented: it owns the marketplace config, the plugin cache layout and the
 * lockfile. If the binary is missing we degrade to read-only advice instead of
 * touching those files ourselves.
 */
let cachedPath;

export async function claudePath() {
  if (cachedPath !== undefined) return cachedPath;
  const result = await run(process.platform === 'win32' ? 'where' : 'which', ['claude'], {
    quiet: true
  });
  const found = result.code === 0 ? result.stdout.split('\n')[0].trim() : '';
  cachedPath = found || null;
  return cachedPath;
}

export async function hasClaude() {
  return Boolean(await claudePath());
}

/**
 * Runs a command and captures its output.
 *
 * @param {string} command
 * @param {string[]} args
 * @param {{onData?: (chunk: string) => void, quiet?: boolean, cwd?: string}} [options]
 * @returns {Promise<{code: number, stdout: string, stderr: string}>}
 */
export function run(command, args, options = {}) {
  return new Promise((resolve) => {
    // Windows batch entry points (npm.cmd) can only be spawned through a shell,
    // and a shell concatenates arguments unescaped - so any argument carrying
    // shell metacharacters is refused rather than quoted-and-hoped.
    const viaCmd = needsShell(command);
    const unsafe = viaCmd ? args.find((arg) => !SAFE_SHELL_ARG.test(String(arg))) : null;

    if (unsafe) {
      resolve({ code: 1, stdout: '', stderr: `refusing to run with unsafe argument: ${unsafe}` });
      return;
    }

    const [bin, binArgs] = viaCmd
      ? ['cmd.exe', ['/d', '/s', '/c', command, ...args]]
      : [command, args];

    const child = spawn(bin, binArgs, {
      cwd: options.cwd,
      windowsHide: true
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      if (!options.quiet) options.onData?.(text);
    });

    child.stderr?.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      if (!options.quiet) options.onData?.(text);
    });

    child.on('error', (error) => resolve({ code: 1, stdout, stderr: `${stderr}${error.message}` }));
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

const WINDOWS_BATCH = new Set(['npm', 'npx', 'yarn', 'pnpm']);
const SAFE_SHELL_ARG = /^[A-Za-z0-9@/:._+-]+$/;

function needsShell(command) {
  return process.platform === 'win32' && WINDOWS_BATCH.has(command);
}

export async function claude(args, options = {}) {
  const bin = await claudePath();
  if (!bin) {
    return { code: 127, stdout: '', stderr: 'claude CLI not found on PATH' };
  }
  return run(bin, args, options);
}

/**
 * Hands the real terminal to `claude` (stdin/stdout/stderr inherited) so a
 * slash command can hold an actual back-and-forth conversation with the user,
 * instead of the one-shot capture-and-parse flow `run`/`claude` use above.
 * Caller is responsible for restoring the TUI's own raw-mode/cursor state
 * once this resolves.
 */
export async function claudeInteractive(args, options = {}) {
  const bin = await claudePath();
  if (!bin) {
    return { code: 127 };
  }

  return new Promise((resolve) => {
    const child = spawn(bin, args, {
      cwd: options.cwd,
      stdio: 'inherit',
      windowsHide: true
    });

    child.on('error', () => resolve({ code: 1 }));
    child.on('close', (code) => resolve({ code: code ?? 1 }));
  });
}

/**
 * Installed plugins. The CLI's `--json` is preferred; the text output is parsed
 * as a fallback so an older CLI still works. `--json` can exit non-zero while
 * still printing valid JSON, so the payload is tried before the exit code.
 */
export async function listPlugins() {
  const json = await claudeJson(['plugin', 'list', '--json']);
  if (json) return normalizePlugins(json.installed ?? json);

  const result = await claude(['plugin', 'list'], { quiet: true });
  return result.code === 0 ? parsePluginList(result.stdout) : [];
}

/** Every plugin offered by the configured marketplaces, installed or not. */
export async function listAvailablePlugins() {
  const json = await claudeJson(['plugin', 'list', '--available', '--json']);
  if (!json) return [];

  const installed = new Set(normalizePlugins(json.installed ?? []).map((plugin) => plugin.id));

  return (json.available ?? []).map((entry) => {
    const id = entry.pluginId ?? `${entry.name}@${entry.marketplaceName}`;
    return {
      id,
      name: entry.name ?? id.split('@')[0],
      marketplace: entry.marketplaceName ?? id.split('@')[1] ?? '',
      description: (entry.description ?? '').replace(/\s+/g, ' ').trim(),
      version: entry.version ?? null,
      installed: installed.has(id)
    };
  });
}

/** Configured marketplaces, as reported by `claude plugin marketplace list`. */
export async function listMarketplaces() {
  const json = await claudeJson(['plugin', 'marketplace', 'list', '--json']);
  if (json) {
    return (Array.isArray(json) ? json : (json.marketplaces ?? [])).map((entry) => ({
      name: entry.name,
      source: entry.source ?? null,
      repo: entry.repo ?? null,
      path: entry.installLocation ?? null
    }));
  }

  const result = await claude(['plugin', 'marketplace', 'list'], { quiet: true });
  return result.code === 0 ? parseMarketplaceList(result.stdout) : [];
}

async function claudeJson(args) {
  const result = await claude(args, { quiet: true });
  const text = result.stdout.trim();
  if (!text.startsWith('{') && !text.startsWith('[')) return null;

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function normalizePlugins(entries) {
  return (entries ?? []).map((entry) => {
    const id = entry.id ?? `${entry.name}@${entry.marketplace}`;
    const [name, marketplace = ''] = id.split('@');
    return {
      id,
      name: entry.name ?? name,
      marketplace: entry.marketplace ?? marketplace,
      version: entry.version ?? null,
      scope: entry.scope ?? 'user',
      enabled: entry.enabled !== false,
      path: entry.installPath ?? null,
      lastUpdated: entry.lastUpdated ?? null
    };
  });
}

/**
 * The CLI prints blocks, not JSON:
 *
 *   > claude-mem@thedotmack
 *       Version: 13.13.1
 *       Scope: user
 *       Status: enabled
 */
export function parsePluginList(text) {
  return parseBlocks(stripAnsi(text)).flatMap((block) => {
    const match = /^([A-Za-z0-9._-]+)@([A-Za-z0-9._-]+)$/.exec(block.title);
    if (!match) return [];

    return [
      {
        name: match[1],
        marketplace: match[2],
        id: block.title,
        version: block.fields.version ?? null,
        scope: block.fields.scope ?? 'user',
        enabled: !/disabled/i.test(block.fields.status ?? 'enabled')
      }
    ];
  });
}

/**
 *   > caveman
 *       Source: GitHub (JuliusBrussee/caveman)
 */
export function parseMarketplaceList(text) {
  return parseBlocks(stripAnsi(text)).flatMap((block) => {
    if (!/^[A-Za-z0-9._-]+$/.test(block.title)) return [];

    const source = block.fields.source ?? null;
    const repo = source ? (/\(([^)]+)\)/.exec(source) ?? [])[1] ?? null : null;

    return [{ name: block.title, source, repo }];
  });
}

/** Splits `> title` blocks with indented `Key: value` lines. */
function parseBlocks(text) {
  const blocks = [];
  let current = null;

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;

    const header = /^[>*•-]\s+(.+)$/.exec(line);
    if (header) {
      current = { title: header[1].trim(), fields: {} };
      blocks.push(current);
      continue;
    }

    const field = /^([A-Za-z ]+):\s*(.*)$/.exec(line);
    if (field && current) {
      const key = field[1].trim().toLowerCase().replace(/\s+/g, '');
      current.fields[key] = field[2].trim();
    }
  }

  return dedupeBy(blocks, (block) => block.title).map((block) => ({
    title: block.title,
    fields: block.fields
  }));
}

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

export function stripAnsi(text) {
  return String(text).replace(ANSI, '');
}

function dedupeBy(items, key) {
  const seen = new Map();
  for (const item of items) {
    if (!seen.has(key(item))) seen.set(key(item), item);
  }
  return [...seen.values()];
}
