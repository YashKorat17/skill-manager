import fs from 'node:fs';
import path from 'node:path';
import { listAvailablePlugins, listMarketplaces } from './claude.js';

/**
 * Categories used to both detect a project's stack (via package.json deps and
 * known config files) and to score the plugin catalog against it. The same
 * keyword list drives both sides so a match is symmetric: "remotion" in a
 * dependency and "remotion" in a plugin's name/description count the same.
 */
export const CATEGORIES = [
  {
    name: 'UI / components',
    keywords: ['react', 'vue', 'svelte', 'tailwind', 'shadcn', 'radix', 'chakra', 'mui', 'styled-components'],
    configFiles: ['tailwind.config.js', 'tailwind.config.ts', 'components.json']
  },
  {
    name: 'Animation',
    keywords: ['remotion', 'framer-motion', 'gsap', 'three', 'react-three', 'lottie', 'animejs', 'anime.js'],
    configFiles: ['remotion.config.ts', 'remotion.config.js']
  },
  {
    name: 'Database',
    keywords: ['mongodb', 'mongoose', 'postgres', 'pg', 'sqlite', 'prisma', 'redis', 'mysql'],
    configFiles: ['prisma/schema.prisma']
  },
  {
    name: 'Testing',
    keywords: ['jest', 'vitest', 'mocha', 'playwright', 'cypress', 'testing-library'],
    configFiles: ['playwright.config.ts', 'jest.config.js', 'vitest.config.ts']
  },
  {
    name: 'Documents',
    keywords: ['pdf-lib', 'pdfkit', 'docx', 'xlsx', 'exceljs', 'pptx'],
    configFiles: []
  },
  {
    name: 'API / backend',
    keywords: ['express', 'fastify', 'koa', 'graphql', 'apollo', 'trpc'],
    configFiles: []
  },
  {
    name: 'Build tooling',
    keywords: ['vite', 'webpack', 'esbuild', 'rollup', 'turbopack'],
    configFiles: ['vite.config.ts', 'vite.config.js', 'webpack.config.js']
  }
];

/**
 * Reads package.json dependency names and known config file basenames out of
 * `cwd`, lowercased into a flat signal set. Missing/unreadable package.json
 * just yields an empty dependency set - detection still runs off config files.
 */
export function detectStack(cwd = process.cwd()) {
  const signals = new Set();

  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
    for (const name of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) {
      signals.add(name.toLowerCase());
    }
  } catch {
    // no package.json, or it's not valid JSON - fall through to config files
  }

  for (const category of CATEGORIES) {
    for (const file of category.configFiles) {
      if (fs.existsSync(path.join(cwd, file))) signals.add(path.basename(file).split('.')[0]);
    }
  }

  return signals;
}

/** Categories whose keywords show up among the detected signals. */
export function matchCategories(signals) {
  return CATEGORIES.filter((category) =>
    category.keywords.some((keyword) => [...signals].some((signal) => signal.includes(keyword)))
  );
}

/**
 * GitHub star counts for every configured marketplace's repo, used as a
 * popularity proxy since individual plugins don't carry their own stars.
 * Best-effort: network failures or missing repo info just leave a plugin
 * unranked by stars rather than failing the whole suggestion.
 */
export async function marketplaceStars(marketplaces, { fetchImpl = fetch, timeoutMs = 3000 } = {}) {
  const stars = new Map();

  await Promise.all(
    marketplaces.map(async (market) => {
      const repo = market.repo && /^[\w.-]+\/[\w.-]+$/.test(market.repo) ? market.repo : null;
      if (!repo) return;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const res = await fetchImpl(`https://api.github.com/repos/${repo}`, {
          signal: controller.signal,
          headers: { Accept: 'application/vnd.github+json' }
        });
        if (!res.ok) return;
        const data = await res.json();
        if (typeof data.stargazers_count === 'number') stars.set(market.name, data.stargazers_count);
      } catch {
        // offline, rate-limited, or repo not found - this marketplace stays unranked by stars
      } finally {
        clearTimeout(timer);
      }
    })
  );

  return stars;
}

/**
 * Ranks the available plugin catalog against the detected project stack.
 * Score is keyword overlap between project signals + matched category
 * keywords and the plugin's name/description; ties break on marketplace
 * stars. Only plugins with a non-zero overlap are returned.
 */
export async function suggestSkills({ cwd = process.cwd(), fetchImpl = fetch } = {}) {
  const signals = detectStack(cwd);
  const categories = matchCategories(signals);
  const keywords = new Set([...signals, ...categories.flatMap((category) => category.keywords)]);

  const [catalog, marketplaces] = await Promise.all([listAvailablePlugins(), listMarketplaces()]);
  const stars = await marketplaceStars(marketplaces, { fetchImpl });

  const ranked = catalog
    .map((plugin) => {
      const haystack = `${plugin.name} ${plugin.description}`.toLowerCase();
      const matched = [...keywords].filter((keyword) => haystack.includes(keyword));
      return {
        ...plugin,
        score: matched.length,
        matched,
        stars: stars.get(plugin.marketplace) ?? null
      };
    })
    .filter((plugin) => plugin.score > 0 && !plugin.installed)
    .sort((a, b) => b.score - a.score || (b.stars ?? -1) - (a.stars ?? -1) || a.name.localeCompare(b.name));

  return { categories: categories.map((category) => category.name), suggestions: ranked };
}
