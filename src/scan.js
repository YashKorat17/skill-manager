import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseFrontmatter } from './frontmatter.js';
import { weighSkill } from './tokens.js';

const SKILL_FILE = 'SKILL.md';
const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  'dist',
  'build',
  'out',
  'coverage',
  'target',
  'vendor',
  '.venv',
  'venv',
  '__pycache__',
  '.next',
  '.cache',
  'tmp',
  'temp'
]);

/**
 * Directories Claude Code and the Agent SDK use for configuration. Each one is
 * walked looking for `<something>/skills/<name>/SKILL.md`, which covers user
 * skills, plugin skills and marketplace caches without hardcoding their layout.
 */
function desktopAppDirs(home) {
  const dirs = [];
  if (process.env.APPDATA) dirs.push(path.join(process.env.APPDATA, 'Claude'));
  dirs.push(path.join(home, 'Library', 'Application Support', 'Claude'));
  dirs.push(path.join(home, '.config', 'Claude'));
  return dirs;
}

export function defaultRoots({ cwd = process.cwd(), home = os.homedir() } = {}) {
  const roots = [];

  const add = (dir, kind) => {
    if (dir && !roots.some((root) => samePath(root.dir, dir))) {
      roots.push({ dir: path.resolve(dir), kind });
    }
  };

  if (process.env.CLAUDE_CONFIG_DIR) {
    for (const dir of process.env.CLAUDE_CONFIG_DIR.split(path.delimiter)) {
      add(dir.trim(), 'user');
    }
  }

  add(path.join(home, '.claude'), 'user');
  add(path.join(home, '.config', 'claude'), 'user');
  if (process.env.XDG_CONFIG_HOME) {
    add(path.join(process.env.XDG_CONFIG_HOME, 'claude'), 'user');
  }

  // The Claude desktop app unpacks its bundled skills per session. Point at the
  // exact subfolders rather than the app directory, which also holds caches.
  for (const appDir of desktopAppDirs(home)) {
    add(path.join(appDir, 'skills'), 'app');
    add(path.join(appDir, 'local-agent-mode-sessions'), 'app');
  }

  // The working directory and each ancestor may carry a project-level `.claude`.
  let dir = path.resolve(cwd);
  for (;;) {
    add(path.join(dir, '.claude'), 'project');
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return roots;
}

/**
 * Finds every skill under the given roots.
 *
 * @param {object} [options]
 * @param {Array<string|{dir: string, kind?: string}>} [options.roots] override the search roots
 * @param {string} [options.cwd]
 * @param {number} [options.maxDepth] directory levels to descend per root
 * @param {boolean} [options.includeBody] keep the SKILL.md body on each result
 * @returns {Promise<{skills: Array<object>, roots: Array<object>, errors: Array<{path: string, error: string}>}>}
 */
export async function findSkills(options = {}) {
  const { cwd = process.cwd(), maxDepth = 8, includeBody = false } = options;

  const roots = (options.roots ?? defaultRoots({ cwd })).map((root) =>
    typeof root === 'string'
      ? { dir: path.resolve(cwd, root), kind: 'custom' }
      : { ...root, dir: path.resolve(cwd, root.dir) }
  );

  const errors = [];
  const seen = new Map();
  const scanned = [];
  const manifests = new Map();

  for (const root of roots) {
    if (!(await isDirectory(root.dir))) continue;
    scanned.push(root);
    const files = await collectSkillFiles(root.dir, maxDepth, errors);
    for (const file of files) {
      const key = path.resolve(file).toLowerCase();
      if (seen.has(key)) continue;
      try {
        seen.set(key, await readSkill(file, root, { includeBody, manifests }));
      } catch (error) {
        errors.push({ path: file, error: error.message });
      }
    }
  }

  let skills = [...seen.values()].sort(
    (a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path)
  );

  const duplicates = [];
  if (!options.duplicates) {
    // A plugin installed from a marketplace is usually present twice: once in
    // the marketplace checkout and once in the version-pinned cache. Same skill,
    // same plugin - report it once and keep the rest on the side.
    const kept = new Map();
    for (const skill of skills) {
      const key = `${skill.source}|${skill.plugin ?? ''}|${skill.name}`.toLowerCase();
      if (kept.has(key)) {
        kept.get(key).duplicatePaths.push(skill.path);
        duplicates.push(skill);
      } else {
        kept.set(key, skill);
      }
    }
    skills = [...kept.values()];
  }

  return { skills, roots: scanned, errors, duplicates };
}

/** Depth-limited walk that only yields `skills/<name>/SKILL.md` matches. */
async function collectSkillFiles(dir, maxDepth, errors, depth = 0, inSkillsDir = false) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'EACCES' && error.code !== 'EPERM') {
      errors.push({ path: dir, error: error.message });
    }
    return [];
  }

  const found = [];

  for (const entry of entries) {
    const full = path.join(dir, entry.name);

    if (entry.isFile()) {
      if (inSkillsDir && entry.name.toLowerCase() === SKILL_FILE.toLowerCase()) {
        found.push(full);
      }
      continue;
    }

    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (IGNORED_DIRS.has(entry.name)) continue;
    if (entry.name.startsWith('.') && entry.name !== '.claude') continue;
    if (depth >= maxDepth) continue;

    const nested = entry.name.toLowerCase() === 'skills' || inSkillsDir;
    found.push(...(await collectSkillFiles(full, maxDepth, errors, depth + 1, nested)));
  }

  return found;
}

async function readSkill(file, root, { includeBody, manifests }) {
  const raw = await fs.readFile(file, 'utf8');
  const { data, body } = parseFrontmatter(raw);
  const stat = await fs.stat(file).catch(() => null);

  const dir = path.dirname(file);
  const name = String(data.name ?? path.basename(dir));
  const source = await describeSource(file, root, manifests);
  const bundle = await inspectDir(dir);
  const description = normalizeText(data.description ?? firstParagraph(body));

  const skill = {
    name,
    description,
    source: source.kind,
    plugin: source.plugin,
    scope: root.kind ?? 'custom',
    root: root.dir,
    dir,
    path: file,
    duplicatePaths: [],
    allowedTools: toList(data['allowed-tools'] ?? data.allowedTools),
    model: data.model ?? null,
    version: data.version ?? null,
    license: data.license ?? null,
    metadata: data,
    resources: bundle.entries,
    tokens: weighSkill({ name, description, body, resourceBytes: bundle.bytes }),
    size: stat?.size ?? null,
    bundleSize: (stat?.size ?? 0) + bundle.bytes,
    modified: stat ? stat.mtime.toISOString() : null
  };

  if (includeBody) skill.body = body;
  return skill;
}

/**
 * Plugin skills live under `<config>/plugins/...`, but the layout varies:
 * marketplace checkouts end in `<repo>/skills/`, while the cache pins a version
 * (`<plugin>/1.2.3/skills/`). Prefer the name from the plugin manifest and only
 * fall back to path segments, skipping version-looking ones.
 */
async function describeSource(file, root, manifests) {
  const relative = path.relative(root.dir, file).split(path.sep);
  const skillsIndex = relative.findIndex((part) => part.toLowerCase() === 'skills');

  if (relative[0] !== 'plugins' || skillsIndex < 1) {
    return { kind: root.kind ?? 'custom', plugin: null };
  }

  const skillsDir = path.join(root.dir, ...relative.slice(0, skillsIndex));
  const fromManifest = await findPluginName(skillsDir, root.dir, manifests);
  if (fromManifest) return { kind: 'plugin', plugin: fromManifest };

  for (let i = skillsIndex - 1; i >= 1; i -= 1) {
    if (!isVersionLike(relative[i])) return { kind: 'plugin', plugin: relative[i] };
  }

  return { kind: 'plugin', plugin: relative[skillsIndex - 1] };
}

const MANIFESTS = [path.join('.claude-plugin', 'plugin.json'), 'plugin.json'];

async function findPluginName(startDir, stopDir, cache = new Map()) {
  let dir = startDir;

  for (;;) {
    if (cache?.has(dir)) return cache.get(dir);

    let name = null;
    for (const manifest of MANIFESTS) {
      name = await readManifestName(path.join(dir, manifest));
      if (name) break;
    }

    cache?.set(dir, name);
    if (name) return name;

    const parent = path.dirname(dir);
    if (parent === dir || dir.length <= stopDir.length) return null;
    dir = parent;
  }
}

async function readManifestName(file) {
  try {
    const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
    return typeof parsed.name === 'string' && parsed.name ? parsed.name : null;
  } catch {
    return null;
  }
}

function isVersionLike(segment) {
  return /^v?\d+(\.\d+)*$/.test(segment) || /^[0-9a-f]{7,}$/i.test(segment);
}

/** Sibling files of a SKILL.md, plus their total size on disk. */
async function inspectDir(dir) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return { entries: [], bytes: 0 };
  }

  const names = [];
  let bytes = 0;

  for (const entry of entries) {
    if (entry.name.toLowerCase() === SKILL_FILE.toLowerCase()) continue;
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      names.push(`${entry.name}/`);
      bytes += await directorySize(full);
      continue;
    }

    names.push(entry.name);
    bytes += await fileSize(full);
  }

  return { entries: names.sort(), bytes };
}

async function directorySize(dir, depth = 0) {
  if (depth > 4) return 0;

  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }

  let bytes = 0;
  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    bytes += entry.isDirectory() ? await directorySize(full, depth + 1) : await fileSize(full);
  }
  return bytes;
}

async function fileSize(file) {
  try {
    return (await fs.stat(file)).size;
  } catch {
    return 0;
  }
}

function firstParagraph(body) {
  const text = body
    .split('\n')
    .filter((line) => !line.startsWith('#'))
    .join('\n')
    .trim();
  const paragraph = text.split(/\n\s*\n/)[0] ?? '';
  return paragraph.replace(/\s+/g, ' ').trim();
}

function normalizeText(value) {
  if (Array.isArray(value)) return value.join(', ');
  if (value == null) return '';
  return String(value).replace(/\s+/g, ' ').trim();
}

function toList(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

async function isDirectory(dir) {
  try {
    return (await fs.stat(dir)).isDirectory();
  } catch {
    return false;
  }
}

function samePath(a, b) {
  const normalize = (value) => path.resolve(value).replace(/[\\/]+$/, '').toLowerCase();
  return normalize(a) === normalize(b);
}

/** Case-insensitive match across name, description, plugin and tools. */
export function filterSkills(skills, query) {
  if (!query) return skills;
  const needle = String(query).toLowerCase();
  return skills.filter((skill) =>
    [skill.name, skill.description, skill.plugin, skill.source, ...skill.allowedTools]
      .filter(Boolean)
      .some((field) => String(field).toLowerCase().includes(needle))
  );
}
