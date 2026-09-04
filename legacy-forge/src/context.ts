/**
 * Contexte d'un run : tout ce que les étapes partagent.
 */
import type { ForgeConfig } from "./config.js";
import type { Target } from "./targets.js";
import type { RunLogger } from "./util/log.js";
import type { Inventory } from "./inventory.js";
import type { MigrationPlan, ReviewVerdict, TestOutcome } from "./schemas.js";
import type { AgentOutcome } from "./agent.js";

export type RunStatus =
  | "success"          // build OK, tests OK, relecteur approuve
  | "declined"         // l'analyste a conclu « non migrable automatiquement » (et c'était attendu ou non)
  | "review_rejected"  // boucles de relecture épuisées sans approbation
  | "build_failed"     // le migrateur n'a pas obtenu un build vert
  | "budget_exceeded"  // plafond global atteint
  | "error";           // exception technique

export interface StageRecord {
  stage: string;
  loop: number;
  outcome: AgentOutcome | null;
  startedAt: string;
  endedAt: string;
  notes: string[];
}

export interface RunContext {
  config: ForgeConfig;
  target: Target;
  runId: string;
  runDir: string;
  /** Copie de travail du dépôt cible (clone). */
  workDir: string;
  /** Sous-dossier de la solution dans la copie de travail. */
  solutionDir: string;
  branch: string;
  baseCommit: string;
  logger: RunLogger;
  inventory?: Inventory;
  plan?: MigrationPlan;
  tests?: TestOutcome;
  verdict?: ReviewVerdict;
  stages: StageRecord[];
  costUsd: number;
  status: RunStatus;
  statusReason: string;
  buildOk?: boolean;
  buildOutputTail?: string;
  prUrl?: string;
}

export function spentSoFar(ctx: RunContext): number {
  return ctx.stages.reduce((s, r) => s + (r.outcome?.costUsd ?? 0), 0);
}

export function remainingBudget(ctx: RunContext): number {
  return Math.max(0, ctx.config.runBudgetUsd - spentSoFar(ctx));
}
