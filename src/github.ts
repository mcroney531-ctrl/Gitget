import type { Env, Repo } from "./types";
import { ApiError, upsertRepo } from "./repos";

function ghBase(env: Env): string {
  return env.GITHUB_API_BASE || "https://api.github.com";
}

function ghHeaders(env: Env): HeadersInit {
  return {
    Authorization: `Bearer ${env.GITHUB_PAT}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "quickgit-worker",
  };
}

async function ghFetch(env: Env, path: string): Promise<Response> {
  const res = await fetch(`${ghBase(env)}${path}`, { headers: ghHeaders(env) });
  if (res.status === 401 || res.status === 403) {
    throw new ApiError(502, `GitHub auth failed (${res.status}) — check GITHUB_PAT secret`);
  }
  return res;
}

interface GhRepo {
  name: string;
  owner: { login: string };
  has_pages: boolean;
  fork: boolean;
  pushed_at: string;
}

interface GhPages {
  html_url: string;
  status: string | null;
}

interface GhPagesBuild {
  status: string;
  updated_at: string;
}

export interface SyncResult {
  scanned: number;
  pages_repos: number;
  synced: Repo[];
  errors: string[];
}

export async function syncRepos(env: Env): Promise<SyncResult> {
  if (!env.GITHUB_PAT) {
    throw new ApiError(500, "GITHUB_PAT secret is not configured");
  }

  // Page through everything the PAT can see, keep repos with Pages enabled.
  const withPages: GhRepo[] = [];
  let scanned = 0;
  for (let page = 1; page <= 10; page++) {
    const res = await ghFetch(env, `/user/repos?per_page=100&page=${page}&sort=pushed`);
    if (!res.ok) {
      throw new ApiError(502, `GitHub /user/repos failed: ${res.status} ${await res.text()}`);
    }
    const batch = (await res.json()) as GhRepo[];
    scanned += batch.length;
    withPages.push(...batch.filter((r) => r.has_pages));
    if (batch.length < 100) break;
  }

  const synced: Repo[] = [];
  const errors: string[] = [];

  for (const repo of withPages) {
    const full = `${repo.owner.login}/${repo.name}`;
    try {
      const pagesRes = await ghFetch(env, `/repos/${full}/pages`);
      if (!pagesRes.ok) {
        errors.push(`${full}: pages lookup failed (${pagesRes.status})`);
        continue;
      }
      const pages = (await pagesRes.json()) as GhPages;

      // Latest build gives a fresher status plus a deploy timestamp.
      let buildStatus = pages.status;
      let lastDeploy: string | null = null;
      const buildRes = await ghFetch(env, `/repos/${full}/pages/builds/latest`);
      if (buildRes.ok) {
        const build = (await buildRes.json()) as GhPagesBuild;
        buildStatus = build.status ?? buildStatus;
        lastDeploy = build.updated_at ?? null;
      }

      synced.push(
        await upsertRepo(env, {
          name: repo.name,
          owner: repo.owner.login,
          live_url: pages.html_url,
          has_pages: true,
          build_status: buildStatus,
          last_deploy: lastDeploy,
          source: "synced",
        })
      );
    } catch (err) {
      if (err instanceof ApiError) throw err;
      errors.push(`${full}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { scanned, pages_repos: withPages.length, synced, errors };
}

export interface CheckResult {
  /** true when GitHub has Pages activity newer than what's stored */
  changes: boolean;
  /** short human-readable list of what looks out of date (capped) */
  reasons: string[];
  pages_repos: number;
}

/**
 * Cheap, read-only "is there anything to sync?" check. Only lists repos
 * (no per-repo Pages/build calls) and compares each Pages repo's push time
 * to when we last synced it (updated_at). Never writes to the DB.
 *
 * updated_at is set to now on every sync, and a repo's pushed_at is always
 * <= the moment we synced it, so right after a sync nothing looks stale —
 * only a push that lands *after* the last sync flags as syncable.
 */
export async function checkSync(env: Env): Promise<CheckResult> {
  if (!env.GITHUB_PAT) {
    throw new ApiError(500, "GITHUB_PAT secret is not configured");
  }

  const withPages: GhRepo[] = [];
  for (let page = 1; page <= 10; page++) {
    const res = await ghFetch(env, `/user/repos?per_page=100&page=${page}&sort=pushed`);
    if (!res.ok) {
      throw new ApiError(502, `GitHub /user/repos failed: ${res.status}`);
    }
    const batch = (await res.json()) as GhRepo[];
    withPages.push(...batch.filter((r) => r.has_pages));
    if (batch.length < 100) break;
  }

  const { results: stored } = await env.DB.prepare(
    `SELECT name, updated_at FROM repos`
  ).all<{ name: string; updated_at: string | null }>();
  const syncedAt = new Map(stored.map((r) => [r.name.toLowerCase(), r.updated_at]));

  const ms = (s: string | null): number => {
    if (!s) return 0;
    const t = Date.parse(s.includes("T") ? s : s.replace(" ", "T") + "Z");
    return Number.isFinite(t) ? t : 0;
  };
  const SKEW = 10_000; // ms tolerance so GitHub/Cloudflare clock drift can't false-flag

  const reasons: string[] = [];
  for (const r of withPages) {
    const key = r.name.toLowerCase();
    if (!syncedAt.has(key)) {
      reasons.push(`${r.name} (new)`);
    } else if (ms(r.pushed_at) > ms(syncedAt.get(key) ?? null) + SKEW) {
      reasons.push(`${r.name} (updated)`);
    }
  }

  return { changes: reasons.length > 0, reasons: reasons.slice(0, 25), pages_repos: withPages.length };
}
