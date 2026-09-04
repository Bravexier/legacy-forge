/**
 * Étape 4 — Le relecteur.
 * Lit le diff, le plan et les résultats de tests ; rend un verdict structuré.
 * Des contrôles anti-triche déterministes s'ajoutent à son jugement : si l'un
 * d'eux se déclenche, le run ne peut pas être approuvé, quoi qu'en dise l'IA.
 */
import fs from "node:fs";
import path from "node:path";
import { runAgent, loadRolePrompt, READONLY_TOOLS } from "../agent.js";
import { ReviewVerdict, jsonSchemaOf } from "../schemas.js";
import { exec } from "../util/exec.js";
import type { RunContext } from "../context.js";
import { remainingBudget } from "../context.js";

const MAX_DIFF_CHARS = 120_000;

export interface CheatCheck { rule: string; hits: string[] }

/** Motifs qui trahissent une migration « facile » : on masque le problème au lieu de le résoudre. */
export async function cheatChecks(ctx: RunContext): Promise<CheatCheck[]> {
  const diff = (await exec("git", ["diff", `${ctx.baseCommit}..HEAD`, "--", ".", ":(exclude)*.jsonl"], { cwd: ctx.workDir, maxOutputChars: 2_000_000 })).stdout;
  const added = diff.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++"));
  const removed = diff.split("\n").filter((l) => l.startsWith("-") && !l.startsWith("---"));
  const checks: CheatCheck[] = [];
  const grab = (rule: string, lines: string[], re: RegExp) => {
    const hits = lines.filter((l) => re.test(l)).slice(0, 10);
    if (hits.length) checks.push({ rule, hits });
  };
  grab("Warnings masqués globalement (<NoWarn> large ou TreatWarningsAsErrors désactivé)", added, /<NoWarn>[^<]{12,}|<TreatWarningsAsErrors>\s*false/i);
  grab("Pragmas de désactivation ajoutés", added, /#pragma\s+warning\s+disable/i);
  grab("Tests ignorés ou désactivés", added, /\[(Fact|Theory|Test)\s*\(\s*Skip|\[Ignore\b|\.Skip\s*=/);
  grab("Tests supprimés", removed, /\[(Fact|Theory|Test|TestMethod)\]/);
  grab("Logique remplacée par des TODO / NotImplementedException", added, /throw new NotImplementedException|\/\/\s*TODO.*(migrat|port|later|fix)/i);

  // Fichiers de code supprimés : légitime pour Global.asax ou des packages.config, suspect au-delà de quelques .cs.
  const deleted = (await exec("git", ["diff", "--diff-filter=D", "--name-only", `${ctx.baseCommit}..HEAD`], { cwd: ctx.workDir })).stdout
    .split("\n").map((l) => l.trim()).filter((l) => l.endsWith(".cs") && !/Global\.asax\.cs$|AssemblyInfo\.cs$|Startup\.Auth\.cs$|BundleConfig\.cs$|FilterConfig\.cs$|RouteConfig\.cs$|WebApiConfig\.cs$/.test(l));
  if (deleted.length > 3) checks.push({ rule: `Suppression de ${deleted.length} fichiers .cs hors fichiers de configuration ASP.NET`, hits: deleted.slice(0, 10) });
  return checks;
}

export async function review(ctx: RunContext, loop: number): Promise<void> {
  const { config, logger } = ctx;
  const stage = config.stages.review;
  const started = new Date().toISOString();

  const stat = (await exec("git", ["diff", "--stat", `${ctx.baseCommit}..HEAD`], { cwd: ctx.workDir })).stdout;
  const full = (await exec("git", ["diff", `${ctx.baseCommit}..HEAD`], { cwd: ctx.workDir, maxOutputChars: MAX_DIFF_CHARS + 1 })).stdout;
  const diffPath = path.join(ctx.runDir, `diff-${loop}.patch`);
  fs.writeFileSync(diffPath, full);
  const truncated = full.length > MAX_DIFF_CHARS;
  const checks = await cheatChecks(ctx);

  const prompt = [
    `Relis la migration de \`${path.relative(ctx.workDir, ctx.solutionDir) || "."}\` vers ${config.targetFramework}, branche \`${ctx.branch}\` (base : ${ctx.baseCommit.slice(0, 10)}).`,
    "",
    "## Plan qui devait être suivi",
    "```json", JSON.stringify(ctx.plan, null, 2), "```",
    "",
    "## Résultat de build (orchestrateur)", ctx.buildOk ? "OK" : "KO", "```", (ctx.buildOutputTail ?? "").slice(-3000), "```",
    "",
    "## Résultat des tests (orchestrateur)", "```json", JSON.stringify(ctx.tests, null, 2), "```",
    "",
    "## Contrôles anti-triche déterministes", checks.length ? checks.map((c) => `- ${c.rule} : ${c.hits.length} occurrence(s)`).join("\n") : "- rien détecté",
    "",
    "## Diff (stat)", "```", stat, "```",
    "",
    `Le diff complet est dans \`${path.relative(ctx.workDir, diffPath)}\`${truncated ? " (tronqué à 120 k caractères : lis les fichiers directement pour le reste)" : ""}.`,
    "Tu peux lire n'importe quel fichier du dépôt et lancer des commandes en lecture seule (git, dotnet build). Rends ton verdict au format JSON demandé.",
  ].join("\n");

  const outcome = await runAgent({
    role: "reviewer",
    prompt,
    cwd: ctx.workDir,
    runDir: ctx.runDir,
    model: stage.model,
    effort: stage.effort,
    maxBudgetUsd: Math.min(stage.maxBudgetUsd, remainingBudget(ctx)),
    maxTurns: stage.maxTurns,
    allowedTools: READONLY_TOOLS,
    disallowedTools: ["Edit", "Write", "MultiEdit", "Bash(git commit*)", "Bash(git checkout*)", "Bash(git reset*)"],
    outputSchema: jsonSchemaOf(ReviewVerdict),
    transcriptName: `reviewer-${loop}.jsonl`,
    logger,
  }, loadRolePrompt(config.agentsDir, "reviewer"));

  let verdict: ReviewVerdict;
  if (outcome.dryRun || outcome.structured === undefined) {
    verdict = ReviewVerdict.parse({
      approved: false, score: 0, summary: outcome.dryRun ? "Dry run : pas de relecture IA" : "Le relecteur n'a pas rendu de JSON exploitable",
      findings: [], mustFix: ["Relecture IA indisponible"], cheatingDetected: checks.length > 0,
    });
  } else {
    verdict = ReviewVerdict.parse(outcome.structured);
  }

  // Les contrôles déterministes priment : triche détectée = pas d'approbation, et les motifs remontent au migrateur.
  if (checks.length > 0) {
    verdict.cheatingDetected = true;
    verdict.approved = false;
    verdict.mustFix.push(...checks.map((c) => `Retirer : ${c.rule} — ex. ${c.hits[0].slice(0, 160)}`));
  }
  if (!ctx.buildOk) verdict.approved = false;
  if (ctx.tests && ctx.tests.ran && ctx.tests.failed > 0) verdict.approved = false;
  if (verdict.score < config.reviewPassScore) verdict.approved = false;

  ctx.verdict = verdict;
  fs.writeFileSync(path.join(ctx.runDir, `verdict-${loop}.json`), JSON.stringify(verdict, null, 2));
  const notes = [`approuvé=${verdict.approved}`, `score=${verdict.score}`, `${verdict.findings.length} remarque(s)`, verdict.cheatingDetected ? "TRICHE DÉTECTÉE" : "pas de triche"];
  ctx.stages.push({ stage: "review", loop, outcome, startedAt: started, endedAt: new Date().toISOString(), notes });
  logger.info(`Relecture (boucle ${loop}) : ${notes.join(" | ")}`);
}
