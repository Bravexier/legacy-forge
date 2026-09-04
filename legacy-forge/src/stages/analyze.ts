/**
 * Étape 1 — L'analyste.
 * Entrée : l'inventaire déterministe. Sortie : un plan de migration structuré (JSON).
 */
import fs from "node:fs";
import path from "node:path";
import { runAgent, loadRolePrompt, READONLY_TOOLS, isDryRun } from "../agent.js";
import { inventory, inventoryToMarkdown } from "../inventory.js";
import { MigrationPlan, jsonSchemaOf } from "../schemas.js";
import type { RunContext } from "../context.js";
import { remainingBudget } from "../context.js";

export async function analyze(ctx: RunContext): Promise<void> {
  const { config, logger } = ctx;
  const inv = inventory(ctx.solutionDir);
  ctx.inventory = inv;
  fs.writeFileSync(path.join(ctx.runDir, "inventory.json"), JSON.stringify(inv, null, 2));
  logger.info(`Inventaire : ${inv.projects.length} projets, ${inv.totalLinesOfCode} lignes, tests=${inv.hasTests}, windows=${inv.needsWindows}`);

  const stage = config.stages.analyze;
  const prompt = [
    `Tu analyses la solution située dans \`${path.relative(ctx.workDir, ctx.solutionDir) || "."}\` (racine du dépôt cloné : ton répertoire courant).`,
    `Cible de migration : ${config.targetFramework} (projets Windows : ${config.targetFrameworkWindows}).`,
    "",
    "Inventaire déterministe déjà calculé (ne le refais pas, complète-le) :",
    "",
    inventoryToMarkdown(inv),
    "",
    "Produis le plan de migration au format JSON demandé. Lis le code autant que nécessaire, mais ne modifie rien.",
  ].join("\n");

  const started = new Date().toISOString();
  const outcome = await runAgent({
    role: "analyst",
    prompt,
    cwd: ctx.workDir,
    runDir: ctx.runDir,
    model: stage.model,
    effort: stage.effort,
    maxBudgetUsd: Math.min(stage.maxBudgetUsd, remainingBudget(ctx)),
    maxTurns: stage.maxTurns,
    allowedTools: READONLY_TOOLS,
    disallowedTools: ["Edit", "Write", "MultiEdit", "Bash(git commit*)", "Bash(git checkout*)"],
    outputSchema: jsonSchemaOf(MigrationPlan),
    logger,
  }, loadRolePrompt(config.agentsDir, "analyst"));

  let plan: MigrationPlan;
  if (outcome.dryRun || outcome.structured === undefined) {
    if (!outcome.dryRun && !isDryRun()) logger.warn("L'analyste n'a pas rendu de JSON exploitable : plan de repli déterministe");
    plan = fallbackPlan(inv, config.targetFramework);
  } else {
    plan = MigrationPlan.parse(outcome.structured);
  }
  ctx.plan = plan;
  fs.writeFileSync(path.join(ctx.runDir, "plan.json"), JSON.stringify(plan, null, 2));
  ctx.stages.push({ stage: "analyze", loop: 0, outcome, startedAt: started, endedAt: new Date().toISOString(), notes: [
    `migratable=${plan.migratable}`, `risque=${plan.estimatedRisk}`, `${plan.strategy.length} étapes`,
  ] });
  logger.info(`Plan : migrable=${plan.migratable}, risque=${plan.estimatedRisk}, ${plan.strategy.length} étapes`);
}

/** Plan minimal dérivé de l'inventaire, utilisé en dry-run ou si l'analyste échoue. */
export function fallbackPlan(inv: ReturnType<typeof inventory>, target: string): MigrationPlan {
  const blockers = inv.projects.flatMap((p) => p.blockers);
  const hardBlock = inv.projects.some((p) => p.kind === "webforms");
  return MigrationPlan.parse({
    summary: `Solution de ${inv.projects.length} projet(s), ${inv.totalLinesOfCode} lignes. Plan de repli généré sans analyse IA.`,
    projects: inv.projects.map((p) => ({
      path: p.path, kind: p.kind, targetFramework: p.targetFramework, sdkStyle: p.sdkStyle,
      packages: p.packages.filter((id) => !id.startsWith("ref:")).slice(0, 20), blockers: p.blockers, linesOfCode: p.linesOfCode,
    })),
    hasTests: inv.hasTests,
    migratable: !hardBlock,
    notMigratableReason: hardBlock ? blockers.join(" ; ") : undefined,
    strategy: [
      { order: 1, title: "Convertir les .csproj au format SDK", rationale: "Prérequis à toute cible moderne", risk: "low", files: inv.projects.map((p) => p.path) },
      { order: 2, title: `Retargeter vers ${target} et remplacer packages.config par PackageReference`, rationale: "Le cœur de la migration", risk: "medium", files: inv.projects.map((p) => p.path) },
      { order: 3, title: "Corriger les erreurs de compilation projet par projet", rationale: "Boucle build → fix", risk: "medium", files: [] },
      { order: 4, title: "Faire passer les tests existants (ou créer des tests de fumée)", rationale: "Preuve de non-régression", risk: "medium", files: [] },
    ],
    estimatedRisk: hardBlock ? "high" : "medium",
    notes: blockers,
  });
}
