---
description: Learn how this repo actually works on GitHub (branching, commits, PRs) and write it down as a project skill so future sessions follow it automatically.
allowed-tools: [Read, Glob, Grep, Write, Bash, AskUserQuestion]
---

<objective>
Work out this repo's real GitHub workflow - branch naming, commit style, PR/merge
rules - and capture it as a project skill, so every future commit or branch this
repo's Claude Code sessions make already follows house style instead of guessing.
</objective>

<process>
1. Read what the repo already shows before asking anything:
   - `git log --oneline -30` - is there a commit message pattern already
     (Conventional Commits like `feat:`/`fix:`, or something else)?
   - `git branch -a` / `git log --all --oneline --graph -20` - branch naming
     pattern already in use (`feature/x`, `fix/x`, `user/x`, ticket-prefixed, etc.)
   - `git remote -v` for the GitHub remote, and `.github/` for existing
     `CODEOWNERS`, PR templates, issue templates, or workflow files that imply
     required checks.
   - Default branch name (`main`/`master`/other) and whether it looks protected
     (branch protection isn't readable via plain git, so ask instead of guessing).

   Anything already evident from history should be confirmed back to the user,
   not re-asked.

2. Use `AskUserQuestion` (one batched call) for what history can't tell you:
   - **Branching model** - trunk-based (short-lived branches, merge straight to
     default branch), GitHub flow (feature branches + PR + merge), git-flow
     (`main`/`develop` + release branches), or "whatever, no fixed rule".
   - **When a new branch gets created** - one branch per feature/fix, one per
     ticket/issue, or ad hoc - and the naming pattern to use
     (e.g. `feature/<slug>`, `fix/<slug>`, `<ticket-id>-<slug>`).
   - **Commit message convention** - Conventional Commits (`feat:`, `fix:`,
     `chore:`...), a different house style, or freeform.
   - **PR requirements** - required reviewers, required CI checks before merge,
     draft-PR-first, or none of the above (direct merge allowed).
   - **Merge method** - squash, rebase, or merge commit - and whether the
     branch should be deleted after merge.

3. Reconcile: where the answers conflict with what step 1 found already in
   use, ask which one wins (the existing history usually should, unless the
   user is explicitly changing convention going forward).

4. Write `.claude/skills/github-workflow/SKILL.md` (create the directory if
   missing) as a project skill stating, plainly and without hedging:
   - the branch naming pattern to use for new work
   - when a new branch should be created vs. committing directly
   - the exact commit message format expected
   - PR requirements (reviewers/checks/draft) if any
   - merge method and post-merge branch cleanup

   This is a standing instruction future sessions read before touching git in
   this repo - write it as rules, not as a summary of the conversation.
</process>

<success_criteria>
- [ ] Existing history/branch/commit conventions were detected, not re-asked
- [ ] `.claude/skills/github-workflow/SKILL.md` written as clear, actionable rules
- [ ] Branch naming, commit format, and merge method are all unambiguous
- [ ] Nothing was pushed, committed, or branched as part of running this command
</success_criteria>
