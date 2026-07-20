import type { Env } from "./types";
import { ApiError, deleteRepo, listRepos, upsertRepo } from "./repos";
import { checkSync, syncRepos } from "./github";
import { QuickGitMCP } from "./mcp";

export { QuickGitMCP };

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function authorized(request: Request, env: Env): boolean {
  if (!env.API_KEY) return false;
  const header =
    request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ??
    request.headers.get("X-Api-Key") ??
    "";
  if (header.length !== env.API_KEY.length) return false;
  // Constant-time compare
  let diff = 0;
  for (let i = 0; i < header.length; i++) {
    diff |= header.charCodeAt(i) ^ env.API_KEY.charCodeAt(i);
  }
  return diff === 0;
}

async function handleApi(request: Request, env: Env, url: URL): Promise<Response> {
  const { pathname } = url;
  const method = request.method;

  if (pathname === "/repos" && method === "GET") {
    const repos = await listRepos(env, url.searchParams.get("q") ?? undefined);
    return json({ repos, count: repos.length });
  }

  if (pathname === "/repos" && method === "POST") {
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      throw new ApiError(400, "invalid JSON body");
    }
    const repo = await upsertRepo(env, {
      name: String(body.name ?? ""),
      owner: body.owner ? String(body.owner) : undefined,
      live_url: body.live_url ? String(body.live_url) : body.url ? String(body.url) : undefined,
      has_pages: body.has_pages === undefined ? undefined : Boolean(body.has_pages),
      build_status: body.build_status ? String(body.build_status) : undefined,
      last_deploy: body.last_deploy ? String(body.last_deploy) : undefined,
      source: body.source as "manual" | "push" | "synced" | undefined,
    });
    return json({ repo }, 201);
  }

  const idMatch = pathname.match(/^\/repos\/(\d+)$/);
  if (idMatch && method === "DELETE") {
    const deleted = await deleteRepo(env, Number(idMatch[1]));
    if (!deleted) throw new ApiError(404, "repo not found");
    return json({ deleted: true });
  }

  if (pathname === "/sync" && method === "POST") {
    const result = await syncRepos(env);
    return json(result);
  }

  if (pathname === "/check" && method === "GET") {
    const result = await checkSync(env);
    return json(result);
  }

  throw new ApiError(404, "not found");
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return json({ ok: true, service: "quickgit" });
    }

    const isApi =
      url.pathname === "/repos" ||
      url.pathname.startsWith("/repos/") ||
      url.pathname === "/sync" ||
      url.pathname === "/check";
    const isMcp = url.pathname === "/mcp" || url.pathname === "/sse" || url.pathname.startsWith("/sse/");

    if (isApi || isMcp) {
      if (!authorized(request, env)) {
        return json({ error: "unauthorized" }, 401);
      }
      if (isMcp) {
        if (url.pathname === "/mcp") {
          return QuickGitMCP.serve("/mcp").fetch(request, env, ctx);
        }
        return QuickGitMCP.serveSSE("/sse").fetch(request, env, ctx);
      }
      try {
        return await handleApi(request, env, url);
      } catch (err) {
        if (err instanceof ApiError) return json({ error: err.message }, err.status);
        console.error(err);
        return json({ error: "internal error" }, 500);
      }
    }

    // Everything else is the PWA
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
