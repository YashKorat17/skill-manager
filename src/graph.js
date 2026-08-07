import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

/** graphify writes its HTML view here; null if that skill hasn't been run yet. */
export function findProjectGraph(cwd = process.cwd()) {
  const file = path.join(cwd, 'graphify-out', 'graph.html');
  return fs.existsSync(file) ? file : null;
}

/** Opens a file with the OS default handler - the browser, for an .html graph. */
export function openInBrowser(filePath) {
  const opener =
    process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/d', '/s', '/c', 'start', '', filePath] : [filePath];

  const child = spawn(opener, args, { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
}
