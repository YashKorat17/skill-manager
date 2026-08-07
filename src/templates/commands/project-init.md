---
description: Interview the user about this project's stack, then write a project skill and suggest matching Claude Code skills.
allowed-tools: [Read, Glob, Grep, Write, AskUserQuestion, Bash]
---

<objective>
Learn what this project is before doing anything else in it, capture that as a
project skill so every future session already knows it, and point the user at
the Claude Code skills that actually match.
</objective>

<process>
1. Look around first. Read `package.json` if present, and check for obvious
   config files (`tsconfig.json`, `tailwind.config.*`, `prisma/schema.prisma`,
   `docker-compose.yml`, framework config files, etc.). Anything already
   detectable from the repo should not be asked about again - just confirm it
   back to the user in the questions below instead of re-asking.

2. Use `AskUserQuestion` (batch every question you still need into one call)
   to fill in what the repo can't tell you:
   - **Software type** - web app, CLI tool, API/backend service, mobile app,
     library/package, game, data/ML pipeline, other.
   - **Framework** - the specific framework/runtime (React, Next.js, SvelteKit,
     Express, FastAPI, Django, none/vanilla, or "not decided yet").
   - **Security level** - public/low-risk content, requires user auth,
     handles payment or PII, regulated/compliance-bound (health, finance,
     government). This drives how careful later work needs to be.
   - **Key libraries** - anything specific the user already wants (state
     management, ORM, testing framework, etc.) beyond what's detected.
   - **Purpose** - one line on what the project is for and who uses it. This
     is the "why" that should quietly inform naming, defaults and tone in
     everything built afterward.

3. Reconcile the answers with what step 1 detected. Where they conflict,
   the user's answer wins.

4. Write `.claude/skills/project-context/SKILL.md` (create the directory if
   missing) as a project skill capturing the reconciled picture: software
   type, framework, security level, key libraries, purpose, and any explicit
   constraints the user mentioned. Keep it short and factual - this file gets
   loaded into every future session in this repo, so it should read like a
   briefing, not a transcript.

5. Suggest a matching skill set, grouped by category, e.g.:
   - **UI / components** - shadcn/ui + tailwindcss for React-family UI work.
   - **Animation** - anime.js for lightweight DOM/SVG animation, Remotion for
     programmatic video generation - pick based on which was actually implied.
   - **Database** - MongoDB for flexible/document data, Postgres for
     relational/strict-schema data.
   - **Testing** - Vitest/Jest for unit, Playwright for e2e, matched to the
     detected framework.
   - **Deployment** - only mention if the security level or purpose implies
     it matters now; otherwise defer to `/production-ready`.

   If security level is "handles payment/PII" or "regulated", call that out
   explicitly and mention that `/production-ready` and `/production-guide`
   exist for when deployment is being set up.

6. Offer, don't force: ask whether to install any of the suggested skills now
   (via `claude plugin install <name>@<marketplace>`, or point at
   `skill-manager`'s own "Suggest for this project" screen) rather than
   installing anything without confirmation.
</process>

<success_criteria>
- [ ] Detected stack was not re-asked about
- [ ] `.claude/skills/project-context/SKILL.md` written, short and factual
- [ ] Skill suggestions are grouped by category and justified by the answers
- [ ] Nothing was installed without the user confirming
</success_criteria>
