import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "./types";
import { listRepos, upsertRepo } from "./repos";
import { syncRepos } from "./github";

function text(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

function errorText(err: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: `Error: ${err instanceof Error ? err.message : String(err)}`,
      },
    ],
    isError: true,
  };
}

export class QuickGitMCP extends McpAgent<Env> {
  server = new McpServer({ name: "quickgit", version: "1.0.0" });

  async init() {
    this.server.tool(
      "send_to_quickgit",
      "Save a live GitHub Pages URL to QuickGit. Call this right after a Pages deploy goes live so the site is tracked. Upserts by repo name.",
      {
        name: z.string().describe("Repository name, e.g. 'my-site'"),
        url: z.string().url().describe("The live GitHub Pages URL"),
        owner: z.string().optional().describe("Repository owner/username"),
      },
      async ({ name, url, owner }) => {
        try {
          const repo = await upsertRepo(this.env, {
            name,
            live_url: url,
            owner,
            source: "push",
          });
          return text({ saved: true, repo });
        } catch (err) {
          return errorText(err);
        }
      }
    );

    this.server.tool(
      "list_repos",
      "List repos tracked in QuickGit with their live URLs, build status, and last deploy time. Optional search query filters by name, owner, or URL.",
      {
        query: z.string().optional().describe("Search filter (substring match)"),
      },
      async ({ query }) => {
        try {
          const repos = await listRepos(this.env, query);
          return text({ count: repos.length, repos });
        } catch (err) {
          return errorText(err);
        }
      }
    );

    this.server.tool(
      "sync_repos",
      "Sync from the GitHub API: scans all repos, finds those with GitHub Pages enabled, and upserts their live URL, build status, and last deploy time into QuickGit.",
      {},
      async () => {
        try {
          const result = await syncRepos(this.env);
          return text({
            scanned: result.scanned,
            pages_repos: result.pages_repos,
            synced: result.synced.map((r) => ({
              name: r.name,
              live_url: r.live_url,
              build_status: r.build_status,
            })),
            errors: result.errors,
          });
        } catch (err) {
          return errorText(err);
        }
      }
    );
  }
}
