---
description: Generate a deployment guidebook for running this project on a server, tailored to its real stack, with a troubleshooting table.
allowed-tools: [Read, Glob, Grep, Write, Bash]
---

<objective>
Write `PRODUCTION_GUIDE.md` at the repo root: a guide grounded in this
project's actual files and scripts, not generic deployment boilerplate. If
someone else had to bring this project up on a fresh server at 2am, this file
is what they'd want open.
</objective>

<process>
1. Inspect the project: `package.json` (or equivalent manifest) for the
   runtime, dependencies and scripts; `.claude/skills/project-context/SKILL.md`
   if `/project-init` already ran; any `Dockerfile`, `docker-compose.yml`, or
   `k8s/` manifests from `/production-ready` if that already ran. Reference
   real script names and real file names throughout - not `npm run build`
   as a guess, but whatever `scripts.build` actually says.

2. Write `PRODUCTION_GUIDE.md` covering:
   - **Prerequisites** - runtime + version, required environment variables
     (name them, not their values), any external services (database, cache)
     that must be reachable.
   - **Build** - the real build steps for this project.
   - **Deploy to a server** - pick the section(s) that match what's actually
     configured: plain VPS (rsync/scp + a systemd unit, with a working example
     unit file), Docker/`docker-compose up -d` if a Dockerfile exists, or the
     relevant PaaS/k8s flow if `/production-ready` set that up. Don't write
     sections for deployment paths this project isn't set up for.
   - **Start / stop / restart** - the actual commands for whichever path
     above applies.
   - **Verifying it's running** - a concrete health check (hit the real port/
     endpoint if one exists, otherwise `systemctl status` / `docker ps`).
   - **Common errors** - a symptom -> likely cause -> fix table. Include at
     least: port already in use, missing/misnamed environment variable,
     database connection refused, permission denied binding to a privileged
     port, out-of-memory kill, TLS/certificate errors - adapted to this
     project's actual stack rather than left generic.
   - **Rollback** - how to get back to the previous working version for
     whichever deploy path was documented.

3. Keep it as short as it can be while staying complete - this is a reference
   someone greps under pressure, not a tutorial.
</process>

<success_criteria>
- [ ] `PRODUCTION_GUIDE.md` written at repo root
- [ ] Every command in it matches a real script/file in this project
- [ ] Only the deployment path(s) this project actually supports are documented
- [ ] Troubleshooting table has concrete causes and fixes, not placeholders
</success_criteria>
