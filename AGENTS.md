# Repository Guidelines

## Project Structure & Module Organization
- `src/index.tsx` contains the Cloudflare Worker entrypoint and Hono routes.
- `public/` holds static assets served via the Wrangler `assets` binding.
- `wrangler.jsonc` defines the Worker name, compatibility date, and asset directory.
- `worker-configuration.d.ts` provides generated type bindings for Cloudflare resources.

## Build, Test, and Development Commands
- `npm install` installs dependencies.
- `npm run dev` runs the Worker locally with Wrangler dev server.
- `npm run deploy` deploys to Cloudflare with minification enabled.
- `npm run cf-typegen` regenerates `CloudflareBindings` types from the Wrangler config.

## Coding Style & Naming Conventions
- TypeScript is the primary language; keep code in `src/`.
- Use 2-space indentation and double quotes for strings (match `src/index.tsx`).
- Prefer concise, descriptive route names (e.g., `/message`).
- No formatter or linter is configured; keep diffs consistent with existing style.

## Testing Guidelines
- No automated test framework is set up yet.
- If you add tests, document the runner and commands in this file and wire them into `package.json` scripts.

## Commit & Pull Request Guidelines
- Commit history currently uses short, sentence-case, imperative subjects (e.g., “Initialize web application…”). Keep future subjects consistent and under ~72 characters.
- PRs should include: a brief summary, testing steps (commands + results), and screenshots when UI output in `public/` or route responses change.

## Security & Configuration Tips
- Store secrets with Wrangler secrets, not in `wrangler.jsonc`.
- When changing bindings or assets, regenerate types with `npm run cf-typegen` and update any Hono `Bindings` generics.

## Agent-Specific Instructions
- When introducing a new main class or top-level component, add a brief comment at the top referencing the design doc (e.g., `README.md`) and related classes/components.
- Until explicitly instructed, keep implementations simple and avoid adding exception-handling-only code paths.
- If a large feature/refactor is needed and `PLANS.md` exists, create an "ExecPlan" in that file before implementing.

# ExecPlans

ExecPlans are stored as standalone Markdown files under `.agents/execplans/`.
When writing complex features or significant refactors, create a new ExecPlan file at
`.agents/execplans/<slug>.md` following `PLANS.md`, then implement milestone by milestone.

Conventions:
- Location: `.agents/execplans/`
- Filename: `<slug>.md` (short, kebab-case; example: `github-login-do-migration.md`)
- One feature/refactor = one ExecPlan file (do not append ExecPlans into `PLANS.md`)

