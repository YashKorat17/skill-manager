import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/**
 * Deleting a skill means deleting the directory that holds its SKILL.md.
 * Two guards apply before anything is removed:
 *
 *  - the directory must actually contain the SKILL.md we scanned, so a bad path
 *    can never take out an unrelated tree;
 *  - by default the deleted directory is copied into a backup folder first, so
 *    an accidental removal is recoverable without reinstalling anything.
 */
export function backupRoot() {
  return path.join(os.tmpdir(), 'skill-finder-backups');
}

/**
 * Warnings worth showing before a delete. Plugin and app skills are managed by
 * something else and will reappear when that thing updates.
 */
export function deletionWarnings(skill) {
  const warnings = [];

  if (skill.source === 'plugin') {
    warnings.push(
      `managed by plugin "${skill.plugin}" - it will come back when the plugin updates; uninstall the plugin instead for a permanent removal`
    );
  }

  if (skill.source === 'app') {
    warnings.push('shipped by the Claude desktop app - it will be restored on the next app update');
  }

  if (skill.duplicatePaths?.length) {
    warnings.push(
      `${skill.duplicatePaths.length} other cop${skill.duplicatePaths.length === 1 ? 'y' : 'ies'} of this skill exist elsewhere (--duplicates to list)`
    );
  }

  return warnings;
}

/**
 * @param {object} skill a skill object from findSkills()
 * @param {object} [options]
 * @param {boolean} [options.dryRun] report what would happen, change nothing
 * @param {boolean} [options.backup] copy the directory aside first (default true)
 * @param {boolean} [options.includeDuplicates] also delete the duplicate copies
 * @returns {Promise<{removed: string[], backup: string|null, skipped: Array<{path:string,reason:string}>}>}
 */
export async function removeSkill(skill, options = {}) {
  const { dryRun = false, backup = true, includeDuplicates = false } = options;

  const targets = [skill.dir];
  if (includeDuplicates) {
    for (const file of skill.duplicatePaths ?? []) targets.push(path.dirname(file));
  }

  const removed = [];
  const skipped = [];
  let backupDir = null;

  for (const target of targets) {
    const check = await verifyTarget(target);
    if (check) {
      skipped.push({ path: target, reason: check });
      continue;
    }

    if (dryRun) {
      removed.push(target);
      continue;
    }

    if (backup) {
      backupDir ??= path.join(backupRoot(), `${timestamp()}-${sanitize(skill.name)}`);
      await copyDir(target, path.join(backupDir, sanitize(path.basename(target))));
    }

    await fs.rm(target, { recursive: true, force: true });
    removed.push(target);
  }

  return { removed, backup: dryRun ? null : backupDir, skipped };
}

/** Returns a reason string when the directory must not be deleted, else null. */
async function verifyTarget(dir) {
  const resolved = path.resolve(dir);

  if (path.dirname(resolved) === resolved) return 'refusing to delete a filesystem root';
  if (path.basename(resolved).toLowerCase() === 'skills') {
    return 'refusing to delete a whole skills directory';
  }

  try {
    const stat = await fs.stat(resolved);
    if (!stat.isDirectory()) return 'not a directory';
  } catch {
    return 'directory no longer exists';
  }

  const entries = await fs.readdir(resolved);
  if (!entries.some((entry) => entry.toLowerCase() === 'skill.md')) {
    return 'no SKILL.md inside - not a skill directory';
  }

  return null;
}

async function copyDir(from, to) {
  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.cp(from, to, { recursive: true });
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function sanitize(value) {
  return String(value).replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 60) || 'skill';
}
