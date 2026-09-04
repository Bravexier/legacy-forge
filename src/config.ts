/**
 * Configuration centrale de la forge.
 *
 * Tout ce qui coûte de l'argent ou borne le comportement des agents est ici,
 * lisible d'un coup d'œil, et surchargeable par variable d'environnement.
 * Règle du pilote : on ne change un budget qu'après avoir lu un rapport de run.
 */
import path from "node:path";

const env = (name: string, fallback: string): string => process.env[name] ?? fallback;
const envNum = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
};

export type StageName = "analyze" | "migrate" | "test" | "review";

export interface StageBudget {
  /** Plafond de dépense (USD) pour cette étape — le SDK coupe la session quand il est atteint. */
  maxBudgetUsd: number;
  /** Plafond de tours agentiques (aller-retours outil) pour cette étape. */
  maxTurns: number;
  /** Modèle : alias ('sonnet', 'opus', 'haiku') ou nom complet. */
  model: string;
  /** Niveau de raisonnement demandé au modèle ; absent = défaut du modèle. */
  effort?: Effort;
}

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
const envEffort = (name: string): Effort | undefined => {
  const v = process.env[name];
  return v === "low" || v === "medium" || v === "high" || v === "xhigh" || v === "max" ? v : undefined;
};

export interface ForgeConfig {
  rootDir: string;
  runsDir: string;
  benchmarkFile: string;
  agentsDir: string;
  /** Cible .NET par défaut pour les projets non-Windows. */
  targetFramework: string;
  /** Cible .NET pour WinForms / WPF. */
  targetFrameworkWindows: string;
  /** Plafond global d'un run, toutes étapes confondues (USD). */
  runBudgetUsd: number;
  /** Nombre maximal de boucles migrateur ↔ relecteur avant abandon. */
  maxReviewLoops: number;
  /** Score minimal du relecteur (0-100) pour qu'un run soit déclaré réussi. */
  reviewPassScore: number;
  stages: Record<StageName, StageBudget>;
  github: {
    /** Token avec droits repo (fork + push + PR). Absent = pas de PR, on garde le résultat en artefact. */
    token: string | undefined;
    /** Compte GitHub qui héberge les forks et le dépôt de la forge. */
    owner: string;
  };
}

export function loadConfig(rootDir = process.cwd()): ForgeConfig {
  const workerModel = env("FORGE_MODEL_WORKER", "sonnet");
  const reviewerModel = env("FORGE_MODEL_REVIEWER", workerModel);
  return {
    rootDir,
    runsDir: path.join(rootDir, "runs"),
    benchmarkFile: path.join(rootDir, "benchmark", "targets.json"),
    agentsDir: path.join(rootDir, "agents"),
    targetFramework: env("FORGE_TARGET", "net8.0"),
    targetFrameworkWindows: env("FORGE_TARGET_WINDOWS", "net8.0-windows"),
    runBudgetUsd: envNum("FORGE_RUN_BUDGET_USD", 15),
    maxReviewLoops: envNum("FORGE_MAX_REVIEW_LOOPS", 2),
    reviewPassScore: envNum("FORGE_REVIEW_PASS_SCORE", 70),
    stages: {
      analyze: { maxBudgetUsd: envNum("FORGE_BUDGET_ANALYZE", 1.5), maxTurns: 60, model: workerModel, effort: envEffort("FORGE_EFFORT_ANALYZE") },
      migrate: { maxBudgetUsd: envNum("FORGE_BUDGET_MIGRATE", 8), maxTurns: 250, model: workerModel, effort: envEffort("FORGE_EFFORT_MIGRATE") },
      test: { maxBudgetUsd: envNum("FORGE_BUDGET_TEST", 3), maxTurns: 120, model: workerModel, effort: envEffort("FORGE_EFFORT_TEST") },
      review: { maxBudgetUsd: envNum("FORGE_BUDGET_REVIEW", 1.5), maxTurns: 60, model: reviewerModel, effort: envEffort("FORGE_EFFORT_REVIEW") },
    },
    github: {
      token: process.env.FORGE_TOKEN || process.env.GITHUB_TOKEN || undefined,
      owner: env("FORGE_GITHUB_OWNER", "bravexier"),
    },
  };
}
