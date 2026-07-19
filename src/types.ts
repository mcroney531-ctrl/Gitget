export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  MCP_OBJECT: DurableObjectNamespace;
  /** Static key required on every API and MCP call (wrangler secret put API_KEY) */
  API_KEY: string;
  /** GitHub PAT, repo scope read-only (wrangler secret put GITHUB_PAT) */
  GITHUB_PAT: string;
  /** Optional override of https://api.github.com, used for testing */
  GITHUB_API_BASE?: string;
}

export interface Repo {
  id: number;
  name: string;
  owner: string;
  live_url: string | null;
  has_pages: number;
  build_status: string | null;
  last_deploy: string | null;
  source: "manual" | "push" | "synced";
  added_at: string;
  updated_at: string;
}

export interface RepoUpsert {
  name: string;
  owner?: string;
  live_url?: string | null;
  has_pages?: boolean;
  build_status?: string | null;
  last_deploy?: string | null;
  source?: "manual" | "push" | "synced";
}
