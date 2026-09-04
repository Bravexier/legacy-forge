/**
 * L'orchestrateur : enchaîne les étapes pour une cible, tient le budget, écrit le rapport.
 *
 *   clone → analyste → [migrateur → build → tests → relecteur] × N → rapport (→ PR)
 *
 * Toute la logique de contrôle est ici, en code, déterministe et lisible.
 * Les agents exécutent, l'orchestrateur décide. C'est le modèle de la forge.
 */
import fs from "node:fs";
import path from "node:path";
import { loadConfig, type ForgeConfig } from "./config.js";
import type { Target } from "./targets.js";
import type { RunContext } from "./context.js";
import { spentSoFar } from "./context.js";
import { RunLogger } from "./util/log.js";
import { exec, execOrThrow } from "./util/exec.js";
import { analyze } from "./stages/analyze.js";
import { migrate } from "./stages/migrate.js";
import { testStage } from "./stages/test.js";
import { review } from "./stages/review.js";
import { buildReport, writeReport, buildDashboard, type RunReport } from "./report.js";
import { ensureFork, pushBranch, openPullRequest } from "./github.js";

export function makeRunId(target: Target, now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").slice(0, 13).replace("T", "-");
  return `${stamp}-${target.id}`;
}

export async function runTarget(target: Target, config: ForgeConfig = loadConfig()): Promise<RunReport> {
  const startedAt = new Date().toISOString();
  const runId = makeRunId(target);
  const runDir = path.join(config.runsDir, runId);
  const workDir = path.join(runDir, "work");
  fs.mkdirSync(runDir, { recursive: true });
  const logger = new RunLogger(runDir);
  logger.info(`Run ${runId} — ${target.repo}@${target.ref}${target.path ? "/" + target.path : ""} — budget ${config.runBudgetUsd} $`);

  const ctx: RunContext = {
    config, target, runId, runDir, workDir,
    solutionDir: path.join(workDir, target.path),
    branch: `forge/${target.id}-${config.targetFramework}`,
    baseCommit: "",
    logger, stages: [], costUsd: 0,
    status: "error", statusReason: "non démarré",
  };

  try {
    await clone(ctx);
    await analyze(ctx);

    if (!ctx.plan!.migratable) {
      ctx.status = "declined";
      ctx.statusReason = `Non migrable automatiquement : ${ctx.plan!.notMigratableReason ?? "voir le plan"}`
        + (target.expected.migratable ? " (inattendu : la cible était supposée migrable)" : " (conforme à l'attendu)");
      logger.warn(ctx.statusReason);
    } else {
      await execOrThrow("git", ["checkout", "-b", ctx.branch], { cwd: workDir });
      let approved = false;
      let mustFix: string[] = [];
      for (let loop = 0; loop <= config.maxReviewLoops; loop++) {
        if (spentSoFar(ctx) >= config.runBudgetUsd) { ctx.status = "budget_exceeded"; ctx.statusReason = `Plafond de ${config.runBudgetUsd} $ atteint avant la boucle ${loop}`; break; }
        const buildOk = await migrate(ctx, loop, mustFix);
        const dry = ctx.stages.some((s) => s.outcome?.dryRun);
        if (!buildOk) {
          ctx.status = "build_failed";
          ctx.statusReason = `Build KO après la boucle ${loop}`;
          // Le relecteur diagnostique quand même : ses `mustFix` nourrissent la boucle suivante.
          if (loop < config.maxReviewLoops && !dry) { await review(ctx, loop); mustFix = ctx.verdict?.mustFix ?? []; continue; }
          break;
        }
        await testStage(ctx, loop);
        await review(ctx, loop);
        if (ctx.verdict?.approved) { approved = true; break; }
        if (dry) { logger.warn("Dry run : une seule boucle, pas de relance du migrateur"); break; }
        mustFix = ctx.verdict?.mustFix ?? [];
        logger.warn(`Relecture non approuvée (boucle ${loop}) : ${mustFix.length} correction(s) demandée(s)`);
      }
      if (approved) {
        ctx.status = "success";
        ctx.statusReason = `Approuvé par le relecteur (score ${ctx.verdict!.score}/100)`;
        await publish(ctx);
      } else if (ctx.status === "error") {
        const loops = ctx.stages.filter((s) => s.stage === "migrate").length;
        ctx.status = ctx.buildOk ? "review_rejected" : "build_failed";
        ctx.statusReason = ctx.buildOk ? `Non approuvé après ${loops} boucle(s)` : "Build KO";
      }
    }
  } catch (err) {
    ctx.status = "error";
    ctx.statusReason = err instanceof Error ? err.message.split("\n")[0].slice(0, 300) : String(err);
    logger.error(`Erreur : ${ctx.statusReason}`);
  }

  const report = buildReport(ctx, startedAt);
  writeReport(ctx, report);
  buildDashboard(config.runsDir);
  logger.info(`Terminé : ${report.status} — ${report.costUsd.toFixed(2)} $ — ${report.durationMin} min — rapport : ${path.relative(config.rootDir, path.join(runDir, "report.md"))}`);
  return report;
}

async function clone(ctx: RunContext): Promise<void> {
  const { target, workDir, logger } = ctx;
  const url = `https://github.com/${target.repo}.git`;
  const args = ["clone", "--quiet", "--depth", "1"];
  if (target.ref !== "HEAD") args.push("--branch", target.ref);
  args.push(url, workDir);
  await execOrThrow("git", args, { timeoutMs: 10 * 60 * 1000 });
  for (const ex of target.exclude) {
    const p = path.join(ctx.solutionDir, ex);
    if (fs.existsSync(p)) { fs.rmSync(p, { recursive: true, force: true }); logger.info(`Exclu de la copie de travail : ${ex}`); }
  }
  await exec("git", ["config", "user.name", "legacy-forge"], { cwd: workDir });
  await exec("git", ["config", "user.email", "forge@users.noreply.github.com"], { cwd: workDir });
  if (target.exclude.length) await exec("git", ["commit", "-qam", "forge: remove excluded paths from working copy"], { cwd: workDir });
  ctx.baseCommit = (await execOrThrow("git", ["rev-parse", "HEAD"], { cwd: workDir })).stdout.trim();
  if (!fs.existsSync(ctx.solutionDir)) throw new Error(`Dossier de solution introuvable : ${target.path}`);
  logger.info(`Cloné ${target.repo} @ ${ctx.baseCommit.slice(0, 10)}`);
}

/** Fork + push + PR sur le fork. Sans token : on garde tout en artefact et on le dit. */
async function publish(ctx: RunContext): Promise<void> {
  const { config, target, logger } = ctx;
  const token = config.github.token;
  if (!token) { logger.warn("Pas de FORGE_TOKEN : pas de fork ni de PR, la branche reste dans le dossier du run"); return; }
  if (ctx.stages.some((s) => s.outcome?.dryRun)) { logger.warn("Dry run : pas de publication"); return; }
  const fork = await ensureFork(token, target.repo, config.github.owner);
  await pushBranch(token, ctx.workDir, fork.full_name, ctx.branch);
  const pr = await openPullRequest(token, fork.full_name, fork.default_branch, ctx.branch,
    `forge: migrate ${target.path || "solution"} to ${config.targetFramework}`,
    prBody(ctx));
  ctx.prUrl = pr.html_url;
  logger.info(`PR ouverte : ${pr.html_url}`);
}

function prBody(ctx: RunContext): string {
  const v = ctx.verdict!;
  const t = ctx.tests;
  return [
    `Migration automatique produite par [legacy-forge](https://github.com/${ctx.config.github.owner}/legacy-forge) — run \`${ctx.runId}\`.`,
    "",
    `- Cible : ${ctx.config.targetFramework}`,
    `- Build : OK`,
    `- Tests : ${t?.ran ? `${t.passed} OK / ${t.failed} KO${t.generated ? " (tests de fumée générés)" : ""}` : "aucun"}`,
    `- Relecture : ${v.score}/100 — ${v.summary}`,
    `- Coût du run : ${spentSoFar(ctx).toFixed(2)} $`,
    "",
    "Cette PR est ouverte sur le fork, pas sur le dépôt d'origine. Elle est destinée à être relue par un humain avant toute utilisation.",
    "",
    "Détails : voir `MIGRATION_NOTES.md` dans la solution.",
  ].join("\n");
}
