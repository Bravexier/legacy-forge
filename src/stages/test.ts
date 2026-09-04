/**
 * Étape 3 — Le testeur.
 * S'il existe des tests : on les lance (déterministe). Sinon, l'agent testeur écrit
 * des tests de fumée sur la surface publique, puis on les lance.
 * Un run sans aucune preuve d'exécution n'est jamais déclaré réussi.
 */
import fs from "node:fs";
import path from "node:path";
import { runAgent, loadRolePrompt, CODING_TOOLS } from "../agent.js";
import { test as dotnetTest, findTestProjects } from "../dotnet.js";
import { TestOutcome } from "../schemas.js";
import type { RunContext } from "../context.js";
import { remainingBudget } from "../context.js";

export async function testStage(ctx: RunContext, loop: number): Promise<void> {
  const { config, logger } = ctx;
  const started = new Date().toISOString();
  let outcome = null;
  let generated = false;

  if (findTestProjects(ctx.solutionDir).length === 0) {
    const stage = config.stages.test;
    const prompt = [
      `La solution dans \`${path.relative(ctx.workDir, ctx.solutionDir) || "."}\` vient d'être migrée vers ${config.targetFramework} (branche \`${ctx.branch}\`).`,
      "Elle n'a aucun projet de test. Crée un projet xUnit `*.Tests` couvrant la surface publique la plus importante",
      "(contrôleurs, services, sérialisation, accès données avec un provider en mémoire si besoin), ajoute-le à la solution,",
      "et fais-le passer avec `dotnet test`. Pas de tests vides ni d'assertions triviales : chaque test doit pouvoir échouer.",
      "Commit : `forge: add smoke tests`.",
    ].join("\n");
    outcome = await runAgent({
      role: "tester",
      prompt,
      cwd: ctx.workDir,
      runDir: ctx.runDir,
      model: stage.model,
      effort: stage.effort,
      maxBudgetUsd: Math.min(stage.maxBudgetUsd, remainingBudget(ctx)),
      maxTurns: stage.maxTurns,
      allowedTools: CODING_TOOLS,
      transcriptName: `tester-${loop}.jsonl`,
      logger,
    }, loadRolePrompt(config.agentsDir, "tester"));
    generated = true;
  }

  const result = await dotnetTest(ctx.solutionDir, ctx.target.solution);
  const tests = TestOutcome.parse({ ...result, generated: generated && result.ran });
  ctx.tests = tests;
  fs.writeFileSync(path.join(ctx.runDir, `tests-${loop}.json`), JSON.stringify(tests, null, 2));
  const notes = [tests.ran ? `${tests.passed} OK / ${tests.failed} KO / ${tests.skipped} ignorés` : "aucun test exécuté", generated ? "tests générés" : "tests existants"];
  ctx.stages.push({ stage: "test", loop, outcome, startedAt: started, endedAt: new Date().toISOString(), notes });
  logger.info(`Tests (boucle ${loop}) : ${notes.join(" | ")}`);
}
