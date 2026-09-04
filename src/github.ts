/**
 * GitHub : fork, push de branche, pull request — sur le fork, jamais sur le dépôt d'origine.
 * On ne sollicite pas les mainteneurs : la PR est ouverte dans le fork (base = branche par défaut du fork).
 */
import { exec, execOrThrow } from "./util/exec.js";

const API = "https://api.github.com";

async function gh<T>(token: string, method: string, route: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${route}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "legacy-forge",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`GitHub ${method} ${route} → ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

export interface RepoInfo { full_name: string; default_branch: string; html_url: string; fork: boolean; parent?: { full_name: string } }

/** Crée (ou récupère) le fork de owner/name sous le compte du token. */
export async function ensureFork(token: string, upstream: string, forkOwner: string): Promise<RepoInfo> {
  const [, name] = upstream.split("/");
  try {
    const existing = await gh<RepoInfo>(token, "GET", `/repos/${forkOwner}/${name}`);
    if (existing.fork && existing.parent?.full_name.toLowerCase() === upstream.toLowerCase()) return existing;
  } catch { /* pas encore de fork */ }
  const created = await gh<RepoInfo>(token, "POST", `/repos/${upstream}/forks`, { default_branch_only: false });
  // Le fork est asynchrone côté GitHub : on attend qu'il réponde.
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    try { return await gh<RepoInfo>(token, "GET", `/repos/${created.full_name}`); } catch { /* retry */ }
  }
  throw new Error(`Le fork ${created.full_name} n'est pas disponible après 60 s`);
}

export async function pushBranch(token: string, workDir: string, forkFullName: string, branch: string): Promise<void> {
  const url = `https://x-access-token:${token}@github.com/${forkFullName}.git`;
  await exec("git", ["remote", "remove", "forge"], { cwd: workDir });
  await execOrThrow("git", ["remote", "add", "forge", url], { cwd: workDir });
  await execOrThrow("git", ["push", "--force", "forge", `HEAD:refs/heads/${branch}`], { cwd: workDir, timeoutMs: 5 * 60 * 1000 });
  await exec("git", ["remote", "remove", "forge"], { cwd: workDir });
}

export interface PullRequest { html_url: string; number: number }

export async function openPullRequest(token: string, forkFullName: string, base: string, head: string, title: string, body: string): Promise<PullRequest> {
  const existing = await gh<PullRequest[]>(token, "GET", `/repos/${forkFullName}/pulls?head=${encodeURIComponent(forkFullName.split("/")[0] + ":" + head)}&state=open`);
  if (existing.length > 0) return existing[0];
  return gh<PullRequest>(token, "POST", `/repos/${forkFullName}/pulls`, { title, head, base, body, draft: false });
}
