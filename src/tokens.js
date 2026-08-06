/**
 * Token estimates.
 *
 * There is no tokenizer here on purpose - shipping one would dwarf the rest of
 * the package. English prose with code and markdown punctuation lands close to
 * 4 characters per token, so the estimate is chars/4 with a small correction for
 * whitespace-heavy files. Treat the numbers as an order of magnitude, not a bill.
 */
const CHARS_PER_TOKEN = 4;

export function estimateTokens(text) {
  if (!text) return 0;
  const chars = text.length;
  const whitespace = (text.match(/\s/g) ?? []).length;
  // Runs of whitespace merge into neighbouring tokens, so they cost less.
  return Math.max(1, Math.round((chars - whitespace * 0.35) / CHARS_PER_TOKEN));
}

export function estimateTokensFromBytes(bytes) {
  if (!bytes) return 0;
  return Math.max(1, Math.round(bytes / CHARS_PER_TOKEN));
}

/**
 * Splits a skill's cost into the two things that actually matter:
 *
 * - `always`: name + description, injected into every session's system prompt
 * - `onUse`:  the SKILL.md body, read only once the skill is triggered
 * - `bundled`: sibling files the skill may pull in afterwards
 */
export function weighSkill({ name, description, body, resourceBytes = 0 }) {
  const always = estimateTokens(`${name}: ${description}`);
  const onUse = estimateTokens(body);
  const bundled = estimateTokensFromBytes(resourceBytes);

  return {
    always,
    onUse,
    bundled,
    total: always + onUse + bundled
  };
}

export function formatTokens(count) {
  if (count < 1000) return String(count);
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  return `${Math.round(count / 1000)}k`;
}

/** Rough dollar cost of keeping N tokens in the prompt, at a given $/Mtok rate. */
export function estimateCost(tokens, dollarsPerMillion) {
  return (tokens / 1_000_000) * dollarsPerMillion;
}
