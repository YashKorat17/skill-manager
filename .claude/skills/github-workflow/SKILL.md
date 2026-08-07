---
name: github-workflow
description: This repo's branching, commit message, and PR/merge conventions. Load before committing, branching, or opening a PR in this repo.
---

# GitHub workflow for skill-manager

Rules for working with git/GitHub in this repository. Follow these instead of
guessing or defaulting to a generic convention.

## Branching model: mixed

- **Small, low-risk changes** (a bug fix, a doc tweak, a single-file change,
  a version bump) — commit straight to `main`. No branch needed.
- **Bigger or riskier changes** (a new feature spanning multiple files, a
  refactor, anything you'd want reviewed before it lands) — create a branch
  and open a PR.
- When in doubt, prefer a branch + PR over guessing wrong on `main`.

This matches how the repo has actually been used: early history (PR #1-#4)
went through branches and PR merges, while recent work has landed directly on
`main`. Neither is "wrong" here — pick based on the size/risk of the change.

## Branch naming

When a branch is used: `feature/<slug>` or `fix/<slug>`, e.g.
`feature/github-init-command`, `fix/detect-stack-lowercasing`. Keep the slug
short and descriptive, kebab-case.

## Commit messages

Freeform imperative, present tense — this is the repo's actual dominant
style: `Add project-aware skill suggestions`, `Bump version to 1.5.0`,
`Fix GitHub Packages auth via scoped setup-node step`. No required prefix
(Conventional Commits `feat:`/`fix:` is not enforced here, even though a
couple of older commits used `fix:` — that was incidental, not a rule).

One line, no period, describes what changed and reads naturally after
"This commit will...".

## PRs and merging

Whenever a PR is used:
- **Merge method:** squash merge into a single commit on `main`.
- **Delete the branch** after merge.
- **Gate:** `npm test` must pass before merging (13 tests currently in
  `test/scan.test.js` and `test/update.test.js`). No other required checks
  are currently configured in `.github/workflows/`.

## What NOT to do

- Don't invent a Conventional Commits prefix scheme — it isn't this repo's
  convention.
- Don't create a branch for a one-line fix just to "be safe" — direct-to-main
  is the norm for small changes here.
- Don't merge a PR (real or hypothetical) without `npm test` passing first.
