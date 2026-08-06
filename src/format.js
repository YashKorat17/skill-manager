const ESC = String.fromCharCode(27);
const CODES = {
  reset: `${ESC}[0m`,
  bold: `${ESC}[1m`,
  dim: `${ESC}[2m`,
  cyan: `${ESC}[36m`,
  green: `${ESC}[32m`,
  yellow: `${ESC}[33m`,
  magenta: `${ESC}[35m`,
  red: `${ESC}[31m`
};

export function createStyler(enabled) {
  const wrap = (code) => (text) => (enabled ? `${code}${text}${CODES.reset}` : String(text));
  return {
    bold: wrap(CODES.bold),
    dim: wrap(CODES.dim),
    cyan: wrap(CODES.cyan),
    green: wrap(CODES.green),
    yellow: wrap(CODES.yellow),
    magenta: wrap(CODES.magenta),
    red: wrap(CODES.red)
  };
}

export function colorsEnabled(stream = process.stdout) {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR && process.env.FORCE_COLOR !== '0') return true;
  return Boolean(stream.isTTY);
}

const SOURCE_COLOR = {
  user: 'green',
  project: 'cyan',
  plugin: 'magenta'
};

/**
 * Aligned table sized to the terminal width.
 *
 * `ALWAYS` is what the skill costs in every session (its name and description
 * live in the system prompt); `ON USE` is the SKILL.md body, paid only when the
 * skill fires. Keeping them in separate columns is the whole point - a 12k-token
 * skill with a one-line description is cheap until you use it.
 */
export function formatTable(skills, { style, width = 100 } = {}) {
  const s = style ?? createStyler(false);
  if (!skills.length) return '';

  const rows = skills.map((skill) => ({
    name: skill.name,
    source: skill.plugin ? `plugin:${skill.plugin}` : skill.source,
    always: formatTokens(skill.tokens?.always ?? 0),
    onUse: formatTokens((skill.tokens?.onUse ?? 0) + (skill.tokens?.bundled ?? 0)),
    description: skill.description || ''
  }));

  const nameWidth = clamp(maxLength(rows, 'name'), 5, 34);
  const sourceWidth = clamp(maxLength(rows, 'source'), 6, 26);
  const alwaysWidth = Math.max(6, maxLength(rows, 'always'));
  const onUseWidth = Math.max(6, maxLength(rows, 'onUse'));
  const descWidth = Math.max(
    20,
    width - nameWidth - sourceWidth - alwaysWidth - onUseWidth - 8
  );

  const lines = [
    [
      s.bold(pad('SKILL', nameWidth)),
      s.bold(pad('SOURCE', sourceWidth)),
      s.bold(padStart('ALWAYS', alwaysWidth)),
      s.bold(padStart('ON USE', onUseWidth)),
      s.bold('DESCRIPTION')
    ].join('  ')
  ];

  for (const [index, row] of rows.entries()) {
    const skill = skills[index];
    const color = SOURCE_COLOR[skill.source] ?? 'yellow';
    lines.push(
      [
        pad(truncate(row.name, nameWidth), nameWidth),
        s[color](pad(truncate(row.source, sourceWidth), sourceWidth)),
        weightColor(s, skill.tokens?.always ?? 0, 120, 300)(padStart(row.always, alwaysWidth)),
        s.dim(padStart(row.onUse, onUseWidth)),
        s.dim(truncate(row.description, descWidth))
      ].join('  ')
    );
  }

  return lines.join('\n');
}

/** Green under `warn`, yellow under `heavy`, red above it. */
function weightColor(style, value, warn, heavy) {
  if (value >= heavy) return style.red;
  if (value >= warn) return style.yellow;
  return style.green;
}

/** One line per skill: `name<TAB>source<TAB>always<TAB>onUse<TAB>path`. */
export function formatList(skills) {
  return skills
    .map((skill) =>
      [
        skill.name,
        skill.plugin ? `plugin:${skill.plugin}` : skill.source,
        skill.tokens?.always ?? 0,
        (skill.tokens?.onUse ?? 0) + (skill.tokens?.bundled ?? 0),
        skill.path
      ].join('\t')
    )
    .join('\n');
}

/**
 * Footer summary: what these skills cost every session, and the worst offenders.
 */
export function formatWeight(skills, { style, top = 3 } = {}) {
  const s = style ?? createStyler(false);
  if (!skills.length) return '';

  const always = sum(skills, (skill) => skill.tokens?.always ?? 0);
  const onUse = sum(skills, (skill) => (skill.tokens?.onUse ?? 0) + (skill.tokens?.bundled ?? 0));

  const heaviest = [...skills]
    .sort((a, b) => (b.tokens?.always ?? 0) - (a.tokens?.always ?? 0))
    .slice(0, top)
    .filter((skill) => (skill.tokens?.always ?? 0) > 0);

  const lines = [
    `${s.bold('context weight')}  ${formatTokens(always)} tokens always loaded  ${s.dim(
      `+ ${formatTokens(onUse)} on demand`
    )}`
  ];

  if (heaviest.length) {
    lines.push(
      s.dim(
        `heaviest: ${heaviest
          .map((skill) => `${skill.name} (${formatTokens(skill.tokens.always)})`)
          .join(', ')}`
      )
    );
  }

  return lines.join('\n');
}

function sum(items, pick) {
  return items.reduce((total, item) => total + pick(item), 0);
}

function formatTokens(count) {
  if (count < 1000) return String(count);
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  return `${Math.round(count / 1000)}k`;
}

export function formatDetail(skill, { style } = {}) {
  const s = style ?? createStyler(false);
  const lines = [s.bold(skill.name)];

  if (skill.description) lines.push(skill.description);
  lines.push('');
  lines.push(`${s.dim('source  ')} ${skill.plugin ? `plugin:${skill.plugin}` : skill.source}`);
  lines.push(`${s.dim('scope   ')} ${skill.scope}`);
  lines.push(`${s.dim('path    ')} ${skill.path}`);
  if (skill.tokens) {
    lines.push(
      `${s.dim('tokens  ')} ${formatTokens(skill.tokens.always)} always loaded, ${formatTokens(
        skill.tokens.onUse
      )} on use${skill.tokens.bundled ? `, ${formatTokens(skill.tokens.bundled)} bundled files` : ''}`
    );
  }
  if (skill.model) lines.push(`${s.dim('model   ')} ${skill.model}`);
  if (skill.version) lines.push(`${s.dim('version ')} ${skill.version}`);
  if (skill.allowedTools.length) {
    lines.push(`${s.dim('tools   ')} ${skill.allowedTools.join(', ')}`);
  }
  if (skill.resources.length) {
    lines.push(`${s.dim('files   ')} ${skill.resources.join(', ')}`);
  }
  if (skill.modified) lines.push(`${s.dim('modified')} ${skill.modified.slice(0, 10)}`);

  return lines.join('\n');
}

function maxLength(rows, key) {
  return rows.reduce((max, row) => Math.max(max, row[key].length), 0);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function pad(text, width) {
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

function padStart(text, width) {
  return text.length >= width ? text : ' '.repeat(width - text.length) + text;
}

function truncate(text, width) {
  if (text.length <= width) return text;
  if (width <= 3) return text.slice(0, width);
  return `${text.slice(0, width - 3)}...`;
}
