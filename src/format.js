const ESC = String.fromCharCode(27);
const CODES = {
  reset: `${ESC}[0m`,
  bold: `${ESC}[1m`,
  dim: `${ESC}[2m`,
  cyan: `${ESC}[36m`,
  green: `${ESC}[32m`,
  yellow: `${ESC}[33m`,
  magenta: `${ESC}[35m`
};

export function createStyler(enabled) {
  const wrap = (code) => (text) => (enabled ? `${code}${text}${CODES.reset}` : String(text));
  return {
    bold: wrap(CODES.bold),
    dim: wrap(CODES.dim),
    cyan: wrap(CODES.cyan),
    green: wrap(CODES.green),
    yellow: wrap(CODES.yellow),
    magenta: wrap(CODES.magenta)
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

/** Aligned three-column table sized to the terminal width. */
export function formatTable(skills, { style, width = 100 } = {}) {
  const s = style ?? createStyler(false);
  if (!skills.length) return '';

  const rows = skills.map((skill) => ({
    name: skill.name,
    source: skill.plugin ? `plugin:${skill.plugin}` : skill.source,
    description: skill.description || ''
  }));

  const nameWidth = clamp(maxLength(rows, 'name'), 4, 34);
  const sourceWidth = clamp(maxLength(rows, 'source'), 6, 26);
  const descWidth = Math.max(20, width - nameWidth - sourceWidth - 4);

  const lines = [
    [s.bold(pad('SKILL', nameWidth)), s.bold(pad('SOURCE', sourceWidth)), s.bold('DESCRIPTION')].join(
      '  '
    )
  ];

  for (const [index, row] of rows.entries()) {
    const color = SOURCE_COLOR[skills[index].source] ?? 'yellow';
    lines.push(
      [
        pad(truncate(row.name, nameWidth), nameWidth),
        s[color](pad(truncate(row.source, sourceWidth), sourceWidth)),
        s.dim(truncate(row.description, descWidth))
      ].join('  ')
    );
  }

  return lines.join('\n');
}

/** One line per skill: `name<TAB>source<TAB>path`, easy to pipe into grep/awk. */
export function formatList(skills) {
  return skills
    .map((skill) =>
      [skill.name, skill.plugin ? `plugin:${skill.plugin}` : skill.source, skill.path].join('\t')
    )
    .join('\n');
}

export function formatDetail(skill, { style } = {}) {
  const s = style ?? createStyler(false);
  const lines = [s.bold(skill.name)];

  if (skill.description) lines.push(skill.description);
  lines.push('');
  lines.push(`${s.dim('source  ')} ${skill.plugin ? `plugin:${skill.plugin}` : skill.source}`);
  lines.push(`${s.dim('scope   ')} ${skill.scope}`);
  lines.push(`${s.dim('path    ')} ${skill.path}`);
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

function truncate(text, width) {
  if (text.length <= width) return text;
  return `${text.slice(0, Math.max(1, width - 1))}...`;
}
