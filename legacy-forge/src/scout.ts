/**
 * L'éclaireur : trouve sur GitHub des dépôts publics encore sur .NET Framework,
 * les qualifie (étoiles, licence, activité, tests, taille) et propose un classement
 * par difficulté. Déterministe, sans IA : c'est de la recherche et du tri.
 *
 * Nécessite un token GitHub (GITHUB_TOKEN dans Actions suffit : la recherche de code est authentifiée).
 */
import fs from "node:fs";
import path from "node:path";

const API = "https://api.github.com";
const QUERIES = [
  "TargetFrameworkVersion v4.8 extension:csproj",
  "TargetFrameworkVersion v4.7.2 extension:csproj",
  "TargetFrameworkVersion v4.6.1 extension:csproj",
  "TargetFrameworkVersion v4.5.2 extension:csproj",
];
const LICENSES = new Set(["mit", "apache-2.0", "bsd-2-clause", "bsd-3-clause", "gpl-2.0", "gpl-3.0", "lgpl-2.1", "lgpl-3.0", "mpl-2.0", "unlicense", "0bsd", "isc"]);

export interface Candidate {
  repo: string;
  url: string;
  description: string;
  stars: number;
  license: string;
  pushedAt: string;
  archived: boolean;
  sizeKb: number;
  csprojCount: number;
  csFileCount: number;
  hasTests: boolean;
  hasWebForms: boolean;
  hasWinForms: boolean;
  difficulty: number;
  score: number;
}

interface CodeSearchResponse { total_count: number; items: Array<{ repository: { full_name: string } }> }
interface RepoResponse { full_name: string; html_url: string; description: string | null; stargazers_count: number; license: { key: string } | null; pushed_at: string; archived: boolean; fork: boolean; size: number; default_branch: string }
interface TreeResponse { tree: Array<{ path: string; type: string }>; truncated: boolean }

async function gh<T>(token: string, route: string): Promise<T> {
  const res = await fetch(`${API}${route}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "legacy-forge-scout" },
  });
  if (res.status === 403 || res.status === 429) {
    const reset = Number(res.headers.get("x-ratelimit-reset") ?? 0) * 1000;
    const wait = Math.max(5_000, Math.min(reset - Date.now(), 90_000));
    console.log(`  rate limit GitHub : pause ${Math.round(wait / 1000)} s`);
    await new Promise((r) => setTimeout(r, wait));
    return gh<T>(token, route);
  }
  if (!res.ok) throw new Error(`GitHub GET ${route} → ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function scout(opts: { token: string; outDir: string; minStars?: number; maxPagesPerQuery?: number; maxRepos?: number }): Promise<Candidate[]> {
  const { token, outDir, minStars = 25, maxPagesPerQuery = 3, maxRepos = 60 } = opts;
  const seen = new Map<string, number>();

  for (const q of QUERIES) {
    for (let page = 1; page <= maxPagesPerQuery; page++) {
      console.log(`recherche : ${q} (page ${page})`);
      const r = await gh<CodeSearchResponse>(token, `/search/code?q=${encodeURIComponent(q)}&per_page=100&page=${page}`);
      for (const item of r.items) seen.set(item.repository.full_name, (seen.get(item.repository.full_name) ?? 0) + 1);
      if (r.items.length < 100) break;
      await sleep(7_000); // la recherche de code est limitée à ~10 requêtes/minute
    }
    await sleep(7_000);
  }
  console.log(`${seen.size} dépôts distincts trouvés`);

  const candidates: Candidate[] = [];
  for (const [fullName] of [...seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, maxRepos * 3)) {
    if (candidates.length >= maxRepos) break;
    let repo: RepoResponse;
    try { repo = await gh<RepoResponse>(token, `/repos/${fullName}`); } catch { continue; }
    if (repo.fork || repo.stargazers_count < minStars) continue;
    const license = repo.license?.key ?? "none";
    if (!LICENSES.has(license)) continue;

    let tree: TreeResponse;
    try { tree = await gh<TreeResponse>(token, `/repos/${fullName}/git/trees/${repo.default_branch}?recursive=1`); } catch { continue; }
    const paths = tree.tree.filter((t) => t.type === "blob").map((t) => t.path);
    const csproj = paths.filter((p) => p.endsWith(".csproj"));
    const cs = paths.filter((p) => p.endsWith(".cs"));
    const hasTests = csproj.some((p) => /test/i.test(p));
    const hasWebForms = paths.some((p) => p.endsWith(".aspx") || p.endsWith(".master"));
    const hasWinForms = paths.some((p) => p.endsWith(".Designer.cs")) && !paths.some((p) => p.endsWith(".xaml"));
    const difficulty = estimateDifficulty(csproj.length, cs.length, hasWebForms, tree.truncated);
    const staleYears = (Date.now() - new Date(repo.pushed_at).getTime()) / (365 * 24 * 3600 * 1000);
    // Score : on veut des dépôts vivants, connus, testés, et de taille abordable.
    const score = Math.round(
      Math.log10(repo.stargazers_count + 1) * 20 + (hasTests ? 25 : 0) + (staleYears < 1 ? 15 : staleYears < 3 ? 5 : -10) + (6 - difficulty) * 8 - (repo.archived ? 15 : 0),
    );
    candidates.push({
      repo: fullName, url: repo.html_url, description: (repo.description ?? "").slice(0, 140), stars: repo.stargazers_count, license,
      pushedAt: repo.pushed_at.slice(0, 10), archived: repo.archived, sizeKb: repo.size,
      csprojCount: csproj.length, csFileCount: cs.length, hasTests, hasWebForms, hasWinForms, difficulty, score,
    });
    console.log(`  ${fullName} — ${repo.stargazers_count}★ ${license} ${csproj.length} csproj, ${cs.length} .cs, tests=${hasTests} → difficulté ${difficulty}, score ${score}`);
    await sleep(800);
  }

  candidates.sort((a, b) => b.score - a.score);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "candidates.json"), JSON.stringify({ generatedAt: new Date().toISOString(), queries: QUERIES, candidates }, null, 2));
  fs.writeFileSync(path.join(outDir, "CANDIDATES.md"), candidatesMarkdown(candidates));
  return candidates;
}

export function estimateDifficulty(csprojCount: number, csCount: number, hasWebForms: boolean, truncated: boolean): number {
  let d = 1;
  if (csCount > 100) d++;
  if (csCount > 500) d++;
  if (csprojCount > 5) d++;
  if (csprojCount > 15 || truncated) d++;
  if (hasWebForms) d = Math.max(d, 4);
  return Math.min(5, d);
}

export function candidatesMarkdown(c: Candidate[]): string {
  return [
    "# Candidats repérés par l'éclaireur",
    "",
    `_${c.length} dépôts publics encore sur .NET Framework, triés par score (étoiles, tests, activité, taille). Généré le ${new Date().toISOString().slice(0, 10)}._`,
    "",
    "| Score | Dépôt | ★ | Licence | Dernier push | Projets | Fichiers .cs | Tests | WebForms | WinForms | Difficulté |",
    "|---|---|---|---|---|---|---|---|---|---|---|",
    ...c.map((x) => `| ${x.score} | [${x.repo}](${x.url})${x.archived ? " (archivé)" : ""} | ${x.stars} | ${x.license} | ${x.pushedAt} | ${x.csprojCount} | ${x.csFileCount} | ${x.hasTests ? "oui" : "non"} | ${x.hasWebForms ? "oui" : "non"} | ${x.hasWinForms ? "oui" : "non"} | ${x.difficulty}/5 |`),
    "",
    "Pour promouvoir un candidat au banc d'essai : l'ajouter à `benchmark/targets.json` (décision du pilote).",
    "",
  ].join("\n");
}
