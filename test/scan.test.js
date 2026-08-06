import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { findSkills, filterSkills } from '../src/scan.js';
import { parseFrontmatter } from '../src/frontmatter.js';

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-finder-'));

  await write(
    path.join(root, 'skills', 'pdf', 'SKILL.md'),
    ['---', 'name: pdf', 'description: Work with PDF files.', 'allowed-tools: Read, Bash', '---', '', 'body'].join('\n')
  );

  await write(
    path.join(root, 'plugins', 'cache', 'acme', 'skills', 'deploy', 'SKILL.md'),
    ['---', 'name: deploy', 'description: |', '  Ship the app', '  to production.', '---'].join('\n')
  );

  await write(path.join(root, 'skills', 'bare', 'SKILL.md'), 'No frontmatter here.\n');
  await write(path.join(root, 'skills', 'pdf', 'reference.md'), 'extra');
  await write(path.join(root, 'node_modules', 'skills', 'nope', 'SKILL.md'), 'ignored');

  return root;
}

async function write(file, contents) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, contents);
}

test('finds skills across user and plugin locations', async () => {
  const root = await fixture();
  const { skills } = await findSkills({ roots: [{ dir: root, kind: 'user' }] });

  assert.deepEqual(
    skills.map((skill) => skill.name),
    ['bare', 'deploy', 'pdf']
  );

  const pdf = skills.find((skill) => skill.name === 'pdf');
  assert.equal(pdf.description, 'Work with PDF files.');
  assert.deepEqual(pdf.allowedTools, ['Read', 'Bash']);
  assert.deepEqual(pdf.resources, ['reference.md']);

  const deploy = skills.find((skill) => skill.name === 'deploy');
  assert.equal(deploy.source, 'plugin');
  assert.equal(deploy.plugin, 'acme');
  assert.equal(deploy.description, 'Ship the app to production.');
});

test('falls back to the directory name and body text', async () => {
  const root = await fixture();
  const { skills } = await findSkills({ roots: [root] });
  const bare = skills.find((skill) => skill.name === 'bare');

  assert.equal(bare.description, 'No frontmatter here.');
});

test('ignores node_modules', async () => {
  const root = await fixture();
  const { skills } = await findSkills({ roots: [root] });

  assert.equal(skills.some((skill) => skill.name === 'nope'), false);
});

test('filters by name, description and plugin', async () => {
  const root = await fixture();
  const { skills } = await findSkills({ roots: [root] });

  assert.deepEqual(filterSkills(skills, 'PDF').map((s) => s.name), ['pdf']);
  assert.deepEqual(filterSkills(skills, 'production').map((s) => s.name), ['deploy']);
  assert.deepEqual(filterSkills(skills, 'acme').map((s) => s.name), ['deploy']);
});

test('parses frontmatter scalars, lists and block scalars', () => {
  const { data, body } = parseFrontmatter(
    ['---', 'name: demo', 'count: 3', 'flag: true', 'tools:', '  - Read', '  - Bash', 'text: >', '  one', '  two', '---', 'body line'].join('\n')
  );

  assert.equal(data.name, 'demo');
  assert.equal(data.count, 3);
  assert.equal(data.flag, true);
  assert.deepEqual(data.tools, ['Read', 'Bash']);
  assert.equal(data.text, 'one two');
  assert.equal(body.trim(), 'body line');
});
