# QuickGit

Personal tracker for live GitHub Pages URLs across your repos. One Cloudflare Worker serving three things:

- **API** (D1-backed) — upsert/list/delete repos, plus a `/sync` that scans the GitHub API for every repo with Pages enabled and pulls its live URL, build status, and last deploy time.
- **MCP server** at `/mcp` — `send_to_quickgit`, `list_repos`, `sync_repos`, so a Claude Code session can push a page's URL the moment a deploy goes live.
- **PWA** — installable single page listing repos as tappable cards (tap → opens the live site), with search, manual add, and a Sync button.

## Deploy

```sh
npm install

# 1. Create the D1 database, then paste the printed database_id into wrangler.jsonc
npx wrangler d1 create quickgit

# 2. Apply the schema
npm run db:remote

# 3. Secrets
npx wrangler secret put API_KEY      # any long random string; protects API + MCP + PWA
npx wrangler secret put GITHUB_PAT   # fine-grained PAT, read-only: Contents/Metadata + Pages

# 4. Ship it
npm run deploy
```

Open the deployed URL on your phone, enter the API key when prompted (stored in localStorage), and "Add to Home Screen".

## Hook up the MCP server

```sh
claude mcp add --transport http quickgit https://quickgit.<you>.workers.dev/mcp \
  --header "Authorization: Bearer <API_KEY>"
```

Then from any build session: *"send this to QuickGit"* → the `send_to_quickgit` tool upserts the repo + live URL. `sync_repos` (or the PWA's Sync button) is the backstop that catches anything never pushed manually.

## API

All routes require `Authorization: Bearer <API_KEY>` (or `X-Api-Key`).

| Route | What it does |
|---|---|
| `GET /repos?q=` | List repos, optional substring filter on name/owner/url |
| `POST /repos` | Upsert by name — `{name, url, owner?, source?}` |
| `DELETE /repos/:id` | Remove a repo |
| `POST /sync` | Scan GitHub, upsert every repo with Pages enabled |
| `GET /health` | Unauthenticated liveness check |

`POST /sync` returns `{scanned, pages_repos, synced[], errors[]}` — per-repo failures land in `errors` without aborting the run.

## Local dev

```sh
npm run db:local
printf 'API_KEY=test-key-local\nGITHUB_PAT=<real-or-dummy>\n' > .dev.vars
npm run dev
```

`GITHUB_API_BASE` in `.dev.vars` can point `/sync` at a mock server for testing without a PAT.

## Notes

- The whole surface (API, MCP, PWA data calls) sits behind the one static `API_KEY`; the PWA asks for it once and keeps it on-device. The GitHub PAT never leaves the Worker.
- `source` on each repo records how it arrived: `manual` (form), `push` (MCP send), `synced` (GitHub scan).
- Sync paginates `/user/repos` (up to 1000 repos), filters `has_pages`, then hits `/repos/{owner}/{repo}/pages` + `/pages/builds/latest` per match.
