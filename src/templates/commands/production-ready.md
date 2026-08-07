---
description: Set up deployment tooling for this project (Docker, Kubernetes, shared database) sized to how it'll actually run.
allowed-tools: [Read, Glob, Grep, Write, Bash, AskUserQuestion]
---

<objective>
Get this project ready to deploy, at the scale it actually needs - not more.
A single small app does not need a Kubernetes cluster; a multi-tenant service
does not want to discover that on launch day.
</objective>

<process>
1. Read `.claude/skills/project-context/SKILL.md` if it exists (written by
   `/project-init`) for the already-known software type, framework and
   security level. Also check `package.json` / equivalent manifest for the
   runtime and start command, and look for an existing `Dockerfile`,
   `docker-compose.yml`, or `k8s/` directory - don't re-derive what's already
   there, and don't overwrite an existing file without asking first.

2. Use `AskUserQuestion` to fill in what isn't already known:
   - **Expected scale** - single small instance, needs horizontal scaling
     under load, or multi-tenant/large-scale from day one.
   - **Hosting target** - VPS/bare metal, managed PaaS (Railway, Render,
     Fly.io), Kubernetes cluster, or serverless.
   - **Database** - fine with a dedicated DB per environment, or needs a
     shared managed database (RDS, Atlas, Cloud SQL) reachable from multiple
     services/regions.
   - **CI/CD** - does a pipeline already exist, or does one need to be
     sketched out too.

3. Generate only what the answers call for:
   - **Small scale, no k8s** - a `Dockerfile` matched to the real runtime/start
     command, plus a `docker-compose.yml` that includes the detected database
     as a service if one is used.
   - **Scaling / k8s target** - also `k8s/deployment.yaml` and
     `k8s/service.yaml` (basic, readiness/liveness probes wired to whatever
     health endpoint the app actually has, or a plain TCP check if it
     doesn't), plus a note that a container registry is needed.
   - **Shared/managed database** - don't template credentials. Wire the
     connection through environment variables, and if MongoDB is the
     detected database, mention the `mongodb-connection` skill for pooling
     configuration instead of hand-rolling it here.

4. After writing files, cross-check the result against the security level
   from step 1 (if known): payment/PII or regulated projects should not end
   up with secrets committed to compose files or manifests - env vars or a
   secrets manager reference only.

5. Finish by naming what was created/changed, and suggest the "Deployment"
   category from `skill-manager`'s own suggestion engine (docker, kubernetes,
   terraform) for anything not already installed - as a suggestion, not an
   automatic install.
</process>

<success_criteria>
- [ ] Nothing generated beyond what the stated scale/hosting target needs
- [ ] No existing deployment file was overwritten without asking
- [ ] Generated files match the project's real runtime and start command
- [ ] No secrets or credentials were hardcoded into generated files
</success_criteria>
