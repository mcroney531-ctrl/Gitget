import type { Env, Repo, RepoUpsert } from "./types";

export async function upsertRepo(env: Env, input: RepoUpsert): Promise<Repo> {
  const name = input.name?.trim();
  if (!name) throw new ApiError(400, "name is required");
  const source = input.source ?? "manual";
  if (!["manual", "push", "synced"].includes(source)) {
    throw new ApiError(400, `invalid source: ${source}`);
  }

  const result = await env.DB.prepare(
    `INSERT INTO repos (name, owner, live_url, has_pages, build_status, last_deploy, source)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
     ON CONFLICT(name) DO UPDATE SET
       owner        = CASE WHEN excluded.owner != '' THEN excluded.owner ELSE repos.owner END,
       live_url     = COALESCE(excluded.live_url, repos.live_url),
       has_pages    = excluded.has_pages,
       build_status = COALESCE(excluded.build_status, repos.build_status),
       last_deploy  = COALESCE(excluded.last_deploy, repos.last_deploy),
       source       = excluded.source,
       updated_at   = datetime('now')
     RETURNING *`
  )
    .bind(
      name,
      input.owner?.trim() ?? "",
      input.live_url ?? null,
      input.has_pages === false ? 0 : 1,
      input.build_status ?? null,
      input.last_deploy ?? null,
      source
    )
    .first<Repo>();

  if (!result) throw new ApiError(500, "upsert failed");
  return result;
}

export async function listRepos(env: Env, query?: string): Promise<Repo[]> {
  if (query?.trim()) {
    const like = `%${query.trim()}%`;
    const { results } = await env.DB.prepare(
      `SELECT * FROM repos WHERE name LIKE ?1 OR owner LIKE ?1 OR live_url LIKE ?1
       ORDER BY updated_at DESC`
    )
      .bind(like)
      .all<Repo>();
    return results;
  }
  const { results } = await env.DB.prepare(
    `SELECT * FROM repos ORDER BY updated_at DESC`
  ).all<Repo>();
  return results;
}

export async function deleteRepo(env: Env, id: number): Promise<boolean> {
  const result = await env.DB.prepare(`DELETE FROM repos WHERE id = ?1`)
    .bind(id)
    .run();
  return result.meta.changes > 0;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}
