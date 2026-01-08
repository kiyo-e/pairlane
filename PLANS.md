# PLANS.md — ExecPlans for Bun + Cloudflare Workers + Hono

This file defines how we write and execute “ExecPlans”: execution plans that a coding agent (or a human unfamiliar with this repo) can follow to deliver a working, observable change.

An ExecPlan is not a vague design note. It is an executable specification: it must tell a complete novice exactly what to change, what commands to run, and what behavior to observe to prove the change works.

## Terms (define once, then keep using consistently)

- ExecPlan: A single, self-contained design+execution document that can be followed end-to-end.
- Cloudflare Worker: A program running on Cloudflare’s edge runtime, configured via Wrangler.
- Wrangler: Cloudflare’s official CLI for developing and deploying Workers.
- Hono: A lightweight web framework; in Workers it typically exports an app that handles HTTP requests.
- Binding: A Cloudflare resource wired into the Worker (environment variables, KV, D1, R2, Durable Objects, etc.). In Hono, bindings are typically accessed via `c.env` (Context environment).
- “Observable outcome”: A behavior a human can verify (HTTP status/body, logs, test results), not an internal code artifact.

## Repository defaults (assumptions all ExecPlans must either follow or explicitly override)

Unless an ExecPlan says otherwise, assume the project uses:

1) Package manager & runtime
- Bun is the package manager (`bun install`) and runs scripts (`bun run <script>`).

2) Worker tooling
- Wrangler is used for local dev and deploy.
- Project uses one Wrangler config file:
  - Prefer `wrangler.toml` for simple Worker-only projects.
  - If the repository already uses `wrangler.jsonc` (common in full-stack templates), keep using it and do not add a second config format.

3) Entry point & routing
- The Worker entry point is TypeScript.
- Default entry file: `src/worker/index.ts`.
- Default Hono export style:
  - `export default app` for a simple fetch handler.
  - If the plan adds additional Workers event handlers (e.g., `scheduled`), use module-style export that includes `fetch: app.fetch`.

4) Canonical scripts (ExecPlans may add these if missing)
- `dev`: starts local dev server (Wrangler).
- `deploy`: deploys the Worker (Wrangler).
- `test`: runs tests (prefer a Workers-compatible runner).
- `typecheck`: runs TypeScript typechecking.

5) Local dev expectation (unless overridden)
- Dev server is reachable on `http://localhost:8787` and serves the app.

## Non-negotiable requirements for every ExecPlan

1) Self-contained
- The ExecPlan must contain all knowledge and instructions needed for a novice to succeed.
- Do not rely on external blog posts or “read the docs”. If knowledge is needed, explain it inside the ExecPlan in plain language.

2) Living document
- ExecPlans must be updated as work proceeds. If you learn something that changes the approach, record it.
- Every stopping point must update `Progress` so the next person can resume from the plan alone.

3) Demonstrably working behavior
- Every ExecPlan must define user-visible behavior or testable outcomes and show how to verify them.
- “Code compiles” is not sufficient. Always include a behavior-based acceptance.

4) Plain language
- Define any term of art immediately. Prefer ordinary language over jargon.
- When naming repo-specific concepts, name the concrete files/modules/commands.

## ExecPlan formatting rules (strict)

- An ExecPlan MUST be one single fenced code block labeled `md` (triple backticks).
- Do not nest triple-backtick fences inside the ExecPlan.
  - When you need to show commands/logs/diffs, use indented blocks inside the single fence.
- Use headings `#`, `##`, etc. Put two newlines after each heading.
- Narrative sections should be prose-first. Lists are allowed where clarity demands it.
- The only mandatory checklist is in the `Progress` section.

If you are writing an ExecPlan to a `.md` file whose entire contents is only that ExecPlan, you may omit the outer triple backticks (but keep the structure identical).

## Stack-specific guidance (Bun + Workers + Hono)

When an ExecPlan targets this stack, include the following specifics unless intentionally out of scope:

A) Minimal “Hello” verification
- Ensure there is at least one endpoint that returns a stable response (e.g., `GET /` returns 200 with a short body).
- Verify locally via:
  - Start dev server: `bun run dev`
  - Request: `curl -i http://localhost:8787/`
  - Expected: `HTTP/1.1 200` and the expected body text.

B) Bindings
- If the plan introduces bindings, it must:
  - Declare them in Wrangler config (`wrangler.toml` or `wrangler.jsonc`).
  - Define the Typescript type for bindings and document how they are accessed (e.g., via `c.env`).
  - Provide a local verification strategy (dev server behavior or tests).

C) Tests
- Prefer Workers-compatible testing so the behavior matches the runtime.
- The ExecPlan must include:
  - Exact test command(s).
  - A description of what failing looks like before the change (if adding new tests) and what passing looks like after.

D) Deploy
- The ExecPlan must state:
  - The exact deploy command (typically `bun run deploy`).
  - The expected observable proof of deployment (e.g., a `*.workers.dev` URL responds with the same behavior as local).

## Required sections in every ExecPlan (must exist and must be maintained)

- `Progress` (checkbox list with timestamps)
- `Surprises & Discoveries`
- `Decision Log`
- `Outcomes & Retrospective`
- Plus the core planning sections: `Purpose / Big Picture`, `Context and Orientation`, `Plan of Work`, `Concrete Steps`, `Validation and Acceptance`, `Idempotence and Recovery`, `Artifacts and Notes`, `Interfaces and Dependencies`

## Milestones (how to use them)

- Milestones are narrative checkpoints that produce independently verifiable progress.
- Each milestone must say:
  - What will exist at the end that did not exist before
  - Exactly what to run
  - Exactly what to observe to prove it worked
- If feasibility is uncertain, include an explicit “Prototyping milestone” to de-risk assumptions.

## ExecPlan skeleton (copy this verbatim when creating a new ExecPlan)

```md
# <Short, action-oriented description>

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

If this repo contains PLANS.md, reference its path here and state that this ExecPlan follows it.

## Purpose / Big Picture

Explain what someone gains after this change and how they can see it working (observable behavior).

## Progress

- [ ] (YYYY-MM-DD hh:mmZ) First step (describe outcome).
- [ ] Next step.

Rules:
- Use timestamps.
- Every stopping point must update this section (split partial items into “done vs remaining”).

## Surprises & Discoveries

- Observation: …
  Evidence: …

## Decision Log

- Decision: …
  Rationale: …
  Date/Author: …

## Outcomes & Retrospective

Summarize outcomes, remaining gaps, and lessons learned (at major milestones or completion).

## Context and Orientation

Assume the reader knows nothing about this repo.
- Describe key files and how requests flow (e.g., `src/index.tsx` Hono app; Wrangler config file; scripts).
- Define any non-obvious term.

## Plan of Work

In prose, describe the sequence of edits and additions.
Name files by full repo-relative path and identify the target functions/modules.

## Concrete Steps

List the exact commands to run and where:
- Install: `bun install`
- Dev: `bun run dev`
- Test: `bun run test` (if applicable)
- Typecheck: `bun run typecheck` (if applicable)
Include short expected outputs as indented examples.

## Validation and Acceptance

Behavior-based acceptance criteria. Example:
- After `bun run dev`, `curl -i http://localhost:8787/` returns `HTTP 200` with body `...`.
- After `bun run deploy`, the deployed URL returns the same response.

## Idempotence and Recovery

Explain how to re-run steps safely.
If any step is risky, provide rollback/retry instructions.

## Artifacts and Notes

Include the smallest necessary evidence (logs, short diffs, command transcripts) as indented blocks.

## Interfaces and Dependencies

Name required libraries, modules, and public interfaces/signatures that must exist at the end.
Explain why these dependencies are chosen.
````

## When revising an ExecPlan

When you change the plan mid-implementation:

* Update all affected sections (especially `Progress`, `Decision Log`, and `Concrete Steps`).
* Add a short note at the bottom of the ExecPlan describing what changed and why.

