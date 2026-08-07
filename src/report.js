import fs from 'node:fs';
import path from 'node:path';

/** Markdown snapshot of a scan: totals, token weight, heaviest skills. */
export function buildReport({ skills, roots }) {
  const timestamp = new Date().toISOString();
  const always = skills.reduce((total, skill) => total + (skill.tokens?.always ?? 0), 0);
  const onUse = skills.reduce(
    (total, skill) => total + (skill.tokens?.onUse ?? 0) + (skill.tokens?.bundled ?? 0),
    0
  );

  const bySource = new Map();
  for (const skill of skills) {
    bySource.set(skill.source, (bySource.get(skill.source) ?? 0) + 1);
  }

  const heaviest = [...skills]
    .sort((a, b) => (b.tokens?.always ?? 0) - (a.tokens?.always ?? 0))
    .slice(0, 10);

  const lines = [
    `# skill-manager report`,
    '',
    `Generated: ${timestamp}`,
    `Scanned: ${(roots ?? []).map((root) => root.dir).join(', ') || 'nothing'}`,
    '',
    `## Totals`,
    '',
    `- ${skills.length} skills`,
    `- ${always} tokens loaded in every session`,
    `- ${onUse} tokens loaded on demand`,
    ...[...bySource.entries()].map(([source, count]) => `- ${source}: ${count}`),
    '',
    `## Heaviest skills (always-loaded)`,
    '',
    `| Skill | Source | Always | On use |`,
    `| --- | --- | --- | --- |`,
    ...heaviest.map(
      (skill) =>
        `| ${skill.name} | ${skill.plugin ? `plugin:${skill.plugin}` : skill.source} | ${
          skill.tokens?.always ?? 0
        } | ${(skill.tokens?.onUse ?? 0) + (skill.tokens?.bundled ?? 0)} |`
    ),
    ''
  ];

  return lines.join('\n');
}

/**
 * Writes a timestamped report plus a `latest.md` copy under `.skill-manager/reports`,
 * so successive runs build a history instead of overwriting each other.
 */
export function saveReport(cwd, report) {
  const dir = path.join(cwd, '.skill-manager', 'reports');
  fs.mkdirSync(dir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(dir, `${stamp}.md`);
  fs.writeFileSync(file, report, 'utf8');
  fs.writeFileSync(path.join(dir, '..', 'latest.md'), report, 'utf8');

  return file;
}
