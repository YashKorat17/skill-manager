import fs from 'node:fs';
import path from 'node:path';

/** Noise directories/files a skill-managed project accumulates - safe to hide, never to delete. */
export const DEFAULT_EXCLUDES = {
  '**/node_modules': true,
  '**/.git': true,
  '**/graphify-out/.graphify_*': true,
  '**/.skill-manager': true,
  '**/coverage': true,
  '**/dist': true,
  '**/.DS_Store': true
};

/**
 * Merges default excludes into `.vscode/settings.json`'s `files.exclude`,
 * preserving whatever the user already has. Never removes an existing key,
 * never overwrites unrelated settings.
 */
export function tidyIde(cwd = process.cwd()) {
  const dir = path.join(cwd, '.vscode');
  const file = path.join(dir, 'settings.json');

  let settings = {};
  if (fs.existsSync(file)) {
    try {
      settings = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      throw new Error(`${file} is not valid JSON - fix it before running tidy`);
    }
  }

  const exclude = { ...settings['files.exclude'] };
  const added = [];
  for (const [key, value] of Object.entries(DEFAULT_EXCLUDES)) {
    if (!(key in exclude)) {
      exclude[key] = value;
      added.push(key);
    }
  }

  settings['files.exclude'] = exclude;

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');

  return { file, added };
}
