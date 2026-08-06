import { claude, hasClaude, listMarketplaces, listPlugins, run } from './claude.js';

/**
 * "Update everything" is three separate things:
 *
 *   1. this npm package
 *   2. the marketplaces (their git checkouts)
 *   3. each installed plugin, which is where most skills come from
 *
 * Each step reports its own status so a failure in one does not hide the rest.
 */

/** Latest published version of a package, or null when npm cannot be reached. */
export async function latestVersion(pkg) {
  const result = await run('npm', ['view', pkg, 'version'], { quiet: true });
  if (result.code !== 0) return null;
  const version = result.stdout.trim().split('\n').pop()?.trim();
  return version && /^\d/.test(version) ? version : null;
}

export function isNewer(latest, current) {
  if (!latest || !current) return false;

  const parse = (value) =>
    String(value)
      .split('-')[0]
      .split('.')
      .map((part) => Number.parseInt(part, 10) || 0);

  const [a, b] = [parse(latest), parse(current)];
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

/**
 * What an "update all" would touch, without changing anything.
 *
 * @returns {Promise<{self: object, marketplaces: object[], plugins: object[], claudeAvailable: boolean}>}
 */
export async function checkUpdates({ pkg, version } = {}) {
  const claudeAvailable = await hasClaude();

  const [latest, marketplaces, plugins] = await Promise.all([
    pkg ? latestVersion(pkg) : Promise.resolve(null),
    claudeAvailable ? listMarketplaces() : Promise.resolve([]),
    claudeAvailable ? listPlugins() : Promise.resolve([])
  ]);

  return {
    claudeAvailable,
    self: {
      name: pkg ?? null,
      current: version ?? null,
      latest,
      outdated: isNewer(latest, version)
    },
    marketplaces,
    plugins
  };
}

/**
 * Runs every update step in order.
 *
 * @param {object} [options]
 * @param {string} [options.pkg] npm package to self-update
 * @param {boolean} [options.self] include the npm self-update (default true)
 * @param {boolean} [options.marketplaces] refresh marketplaces (default true)
 * @param {boolean} [options.plugins] update installed plugins (default true)
 * @param {(event: {step: string, status: string, detail?: string}) => void} [options.onProgress]
 * @returns {Promise<Array<{step: string, status: 'updated'|'current'|'failed'|'skipped', detail: string}>>}
 */
export async function updateAll(options = {}) {
  const {
    pkg,
    version,
    self = true,
    marketplaces = true,
    plugins = true,
    onProgress = () => {}
  } = options;

  const results = [];
  const report = (step, status, detail = '') => {
    const entry = { step, status, detail };
    results.push(entry);
    onProgress(entry);
    return entry;
  };

  if (self && pkg) {
    onProgress({ step: pkg, status: 'running' });
    const latest = await latestVersion(pkg);

    if (!latest) {
      report(pkg, 'failed', 'could not reach the npm registry');
    } else if (!isNewer(latest, version)) {
      report(pkg, 'current', `v${version}`);
    } else {
      const install = await run('npm', ['install', '-g', `${pkg}@latest`], { quiet: true });
      report(
        pkg,
        install.code === 0 ? 'updated' : 'failed',
        install.code === 0 ? `v${version} -> v${latest}` : firstLine(install.stderr)
      );
    }
  }

  if (!(await hasClaude())) {
    if (marketplaces || plugins) {
      report('claude CLI', 'skipped', 'not found on PATH - plugin updates need it');
    }
    return results;
  }

  if (marketplaces) {
    onProgress({ step: 'marketplaces', status: 'running' });
    const result = await claude(['plugin', 'marketplace', 'update'], { quiet: true });
    report(
      'marketplaces',
      result.code === 0 ? 'updated' : 'failed',
      result.code === 0 ? 'all sources refreshed' : firstLine(result.stderr || result.stdout)
    );
  }

  if (plugins) {
    const installed = await listPlugins();
    if (!installed.length) report('plugins', 'skipped', 'no plugins installed');

    for (const plugin of installed) {
      onProgress({ step: plugin.id, status: 'running' });
      const result = await claude(['plugin', 'update', plugin.id], { quiet: true });
      const output = `${result.stdout}${result.stderr}`;

      if (result.code !== 0) {
        report(plugin.id, 'failed', firstLine(output));
      } else if (/already up[- ]to[- ]date|no update/i.test(output)) {
        report(plugin.id, 'current', plugin.version ? `v${plugin.version}` : '');
      } else {
        report(plugin.id, 'updated', firstLine(output) || 'updated');
      }
    }
  }

  return results;
}

function firstLine(text) {
  return String(text ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)[0]
    ?.slice(0, 120) ?? '';
}
