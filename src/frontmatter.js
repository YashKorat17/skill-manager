/**
 * Minimal YAML frontmatter reader.
 *
 * Skill files are small and their frontmatter is flat (`name`, `description`,
 * `allowed-tools`, ...), so a dependency-free parser that understands scalars,
 * quoted strings, block scalars (`|` / `>`) and inline lists is enough. Anything
 * it does not understand is kept as a raw string rather than dropped.
 */

const BLOCK_SCALAR = /^[|>][-+]?\d*$/;

/**
 * @param {string} text raw file contents
 * @returns {{ data: Record<string, unknown>, body: string }}
 */
export function parseFrontmatter(text) {
  const normalized = text.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) {
    return { data: {}, body: normalized };
  }

  const end = normalized.indexOf('\n---', 3);
  if (end === -1) {
    return { data: {}, body: normalized };
  }

  const raw = normalized.slice(4, end);
  const bodyStart = normalized.indexOf('\n', end + 1);
  const body = bodyStart === -1 ? '' : normalized.slice(bodyStart + 1);

  return { data: parseBlock(raw.split('\n')), body };
}

function parseBlock(lines) {
  const data = {};

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim() || line.trimStart().startsWith('#')) continue;

    const match = /^([A-Za-z0-9_.-]+)\s*:\s?(.*)$/.exec(line);
    if (!match) continue;

    const key = match[1];
    const inline = match[2].trim();

    if (BLOCK_SCALAR.test(inline)) {
      const { value, next } = readBlockScalar(lines, i + 1, inline.startsWith('>'));
      data[key] = value;
      i = next - 1;
      continue;
    }

    if (inline === '') {
      const { value, next } = readNestedOrFolded(lines, i + 1);
      data[key] = value;
      i = next - 1;
      continue;
    }

    data[key] = coerce(inline);
  }

  return data;
}

/** Reads an indented `|`/`>` block, dedenting by the first line's indent. */
function readBlockScalar(lines, start, folded) {
  const collected = [];
  let i = start;
  let indent = null;

  for (; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) {
      collected.push('');
      continue;
    }
    const lead = line.length - line.trimStart().length;
    if (indent === null) indent = lead;
    if (lead < indent) break;
    collected.push(line.slice(indent));
  }

  while (collected.length && collected[collected.length - 1] === '') collected.pop();
  const value = folded
    ? collected.join(' ').replace(/\s+/g, ' ').trim()
    : collected.join('\n');

  return { value, next: i };
}

/**
 * A bare `key:` is either a list, a nested map, or a value wrapped onto the
 * following indented lines. All three show up in skill frontmatter in the wild.
 */
function readNestedOrFolded(lines, start) {
  const chunk = [];
  let i = start;

  for (; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) break;
    if (!/^\s/.test(line)) break;
    chunk.push(line);
  }

  if (!chunk.length) return { value: '', next: i };

  if (chunk.every((line) => line.trimStart().startsWith('- '))) {
    return {
      value: chunk.map((line) => coerce(line.trimStart().slice(2).trim())),
      next: i
    };
  }

  if (chunk.some((line) => /^\s*[A-Za-z0-9_.-]+\s*:/.test(line))) {
    const indent = chunk[0].length - chunk[0].trimStart().length;
    return { value: parseBlock(chunk.map((line) => line.slice(indent))), next: i };
  }

  return {
    value: chunk.map((line) => line.trim()).join(' ').replace(/\s+/g, ' ').trim(),
    next: i
  };
}

function coerce(value) {
  if (value === '') return '';

  const quoted = /^(['"])([\s\S]*)\1$/.exec(value);
  if (quoted) return quoted[2];

  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = value.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map((item) => coerce(item.trim()));
  }

  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null' || value === '~') return null;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);

  return value;
}
