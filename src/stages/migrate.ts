/**
 * Étape 2 — Le migrateur.
 * Entrée : le plan (+ les corrections demandées par le relecteur aux boucles suivantes).
 * Sortie : des commits sur la branche de travail, et un build vert vérifié par l'orchestrateur.
 */
import fs from "node:fs";
import path from "node:path";
import { runAgent, loadRolePrompt, CODING_TOOLS } from "../agent.js";
import { build } from "../dotnet.js";
import { exec } from "../util/exec.js";
import type { RunContext } from "../context.js";
import { remainingBudget } from "../context.js";

export async function migrate(ctx: RunContext, loop: number, mustFix: string[] = []): Promise<boolean> {
  const { config, logger } = ctx;
  const stage = config.stages.migrate;
  const plan = ctx.plan!;
  const solutionRel = path.relative(ctx.workDir, ctx.solutionDir) || ".";

  const prompt = [
    `Tu migres la solution située dans \`${solutionRel}\` vers ${config.targetFramework} (projets WinForms/WPF : ${config.targetFrameworkWindows}).`,
    `Tu travailles sur la branche git \`${ctx.branch}\`, déjà créée. Commit après chaque étape du plan, messages en anglais, préfixe \`forge:\`.`,
    "",
    "## Plan de migration (produit par l'analyste)",
    "```json",
    JSON.stringify(plan, null, 2),
    "```",
    "",
    loop > 0
      ? ["## Corrections exigées par le relecteur (boucle " + loop + ")", ...mustFix.map((m) => `- ${m}`), "", "Traite chaque point, puis vérifie de nouveau le build."].join("\n")
      : "Première passe : exécute le plan dans l'ordre.",
    "",
    "Critère de fin : `dotnet build` passe sans erreur sur toute la solution, et tu as écrit `MIGRATION_NOTES.md` à la racine de la solution (ce qui a été fait, ce qui reste, les choix discutables).",
  ].join("\n");

  const started = new Date().toISOString();
  const outcome = await runAgent({
    role: "migrator",
    prompt,
    cwd: ctx.workDir,
    runDir: ctx.runDir,
    model: stage.model,
    effort: stage.effort,
    maxBudgetUsd: Math.min(stage.maxBudgetUsd, remainingBudget(ctx)),
    maxTurns: stage.maxTurns,
    allowedTools: CODING_TOOLS,
    transcriptName: `migrator-${loop}.jsonl`,
    logger,
  }, loadRolePrompt(config.agentsDir, "migrator"));

  // Porte déterministe : on recompile nous-mêmes. (En dry run rien n'a été migré : compiler l'ancien code n'aurait pas de sens.)
  const b = outcome.dryRun
    ? { ok: true, skipped: true, errors: 0, warnings: 0, tail: "dry run : build ignoré" }
    : await build(ctx.solutionDir, ctx.target.solution);
  ctx.buildOk = b.ok;
  ctx.buildOutputTail = b.tail;
  fs.writeFileSync(path.join(ctx.runDir, `build-${loop}.log`), b.tail);

  const diff = await exec("git", ["diff", "--stat", `${ctx.baseCommit}..HEAD`], { cwd: ctx.workDir });
  const commits = await exec("git", ["log", "--oneline", `${ctx.baseCommit}..HEAD`], { cwd: ctx.workDir });
  const notes = [
    b.skipped ? b.tail : `build ${b.ok ? "OK" : "KO"} — ${b.errors} erreur(s), ${b.warnings} warning(s)`,
    `${commits.stdout.trim().split("\n").filter(Boolean).length} commit(s)`,
    diff.stdout.trim().split("\n").pop() ?? "",
  ];
  ctx.stages.push({ stage: "migrate", loop, outcome, startedAt: started, endedAt: new Date().toISOString(), notes });
  logger.info(`Migration (boucle ${loop}) : ${notes.join(" | ")}`);
  return ctx.buildOk;
}
