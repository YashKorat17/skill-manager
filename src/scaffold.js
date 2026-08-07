import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = path.join(here, 'templates', 'commands');

/**
 * Claude Code slash commands this package can scaffold into a target
 * project's `.claude/commands/`. Each is a prompt template (see
 * src/templates/commands/) that Claude itself carries the conversation for -
 * skill-manager only places the file and hands the terminal to `claude`.
 */
export const PROJECT_COMMANDS = [
  {
    key: 'project-init',
    file: 'project-init.md',
    slash: '/project-init',
    label: 'Project init',
    hint: 'interview: software type, framework, security, libs -> project skill'
  },
  {
    key: 'production-ready',
    file: 'production-ready.md',
    slash: '/production-ready',
    label: 'Production ready',
    hint: 'deployment setup: docker, kubernetes, shared database'
  },
  {
    key: 'production-guide',
    file: 'production-guide.md',
    slash: '/production-guide',
    label: 'Production guide',
    hint: 'generates a deploy guidebook for this project'
  },
  {
    key: 'github-init',
    file: 'github-init.md',
    slash: '/github-init',
    label: 'GitHub init',
    hint: 'learns branch/commit/PR conventions -> github-workflow skill'
  }
];

/** PROJECT_COMMANDS annotated with whether each is already installed in `cwd`. */
export function commandStatus(cwd = process.cwd()) {
  return PROJECT_COMMANDS.map((cmd) => ({
    ...cmd,
    installed: fs.existsSync(path.join(cwd, '.claude', 'commands', cmd.file))
  }));
}

/** Copies a command template into `<cwd>/.claude/commands/`, leaving an existing copy untouched. */
export function installCommand(cwd, key) {
  const cmd = PROJECT_COMMANDS.find((entry) => entry.key === key);
  if (!cmd) throw new Error(`unknown command: ${key}`);

  const destDir = path.join(cwd, '.claude', 'commands');
  const dest = path.join(destDir, cmd.file);
  const alreadyInstalled = fs.existsSync(dest);

  if (!alreadyInstalled) {
    fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(path.join(TEMPLATES_DIR, cmd.file), dest);
  }

  return { ...cmd, path: dest, alreadyInstalled };
}
