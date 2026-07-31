# Contributing to connectwise-cpq-mcp

Thanks for helping improve the ConnectWise CPQ MCP server.

## Development setup

```bash
export NODE_AUTH_TOKEN=$(gh auth token)   # GitHub Packages registry auth
npm install
```

Until `@wyre-technology/node-connectwise-cpq@1.0.0` is published, install the locally
built SDK tarball (see README "Local-dev note").

## Workflow

- `npm run build` — tsc build to `dist/`.
- `npm test` — vitest suite.
- `npm run lint` — eslint; `npm run typecheck` — `tsc --noEmit`.
- `node scripts/lint-destructive-warnings.mjs src` — destructive-warning convention gate.
- `node scripts/smoke-dual-era.mjs` — dual-era serving proof (run after build).
- `npm run build:ui` — rebuild the MCP Apps card embed (commit `src/generated/`).

All of the above must pass before a PR is merged.

## Invariants (do not break)

- **Stateless tool surface**: `tools/list` must return the same tools in the same order for
  every caller. No sessions, no per-user variance, no runtime sorting/filtering.
- **Never `legacy: 'reject'`** on `createMcpHandler` — it turns away every 2025-era client.
- **401 gate before the handler** in gateway mode; never fall through to env credentials.
- **MRTR safety**: no vendor mutation before an elicitation point in any handler.
- Destructive tools carry both the description warning prefix AND `destructiveHint` —
  and end with "Confirm with the user before invoking."
- `/health` stays shallow and unauthenticated.

## Commit messages

This repo releases via semantic-release; commit messages must follow
[Conventional Commits](https://www.conventionalcommits.org/):

- `fix:` — patch release
- `feat:` — minor release
- `feat!:` / `BREAKING CHANGE:` — major release
- `docs:`, `test:`, `chore:`, `refactor:` — no release
