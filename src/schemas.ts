/**
 * Contrats de données entre les étapes du pipeline.
 *
 * Les agents « qui jugent » (analyste, relecteur) rendent du JSON conforme à
 * ces schémas — le SDK force la sortie structurée, et on la revalide ici.
 * Un contrat explicite entre agents, c'est ce qui permet de remplacer un agent
 * (ou son modèle) sans casser les autres.
 */
import { z } from "zod/v4";

export const ProjectKind = z.enum([
  "web-mvc", "web-api", "webforms", "wcf", "winforms", "wpf", "console", "library", "test", "unknown",
]);
export type ProjectKind = z.infer<typeof ProjectKind>;

export const Risk = z.enum(["low", "medium", "high"]);

export const ProjectInventory = z.object({
  path: z.string().describe("Chemin du .csproj relatif à la racine du dépôt"),
  kind: ProjectKind,
  targetFramework: z.string().describe("Ex. v4.7.2, net461"),
  sdkStyle: z.boolean().describe("true si le csproj est déjà au format SDK"),
  packages: z.array(z.string()).describe("Identifiants NuGet notables (framework web, ORM, DI, logging...)"),
  blockers: z.array(z.string()).describe("Ce qui n'a pas d'équivalent direct en .NET moderne"),
  linesOfCode: z.number().int().nonnegative(),
});

export const PlanStep = z.object({
  order: z.number().int().positive(),
  title: z.string(),
  rationale: z.string(),
  risk: Risk,
  files: z.array(z.string()).describe("Fichiers ou dossiers principalement touchés"),
});

export const MigrationPlan = z.object({
  summary: z.string().describe("Deux ou trois phrases : ce qu'est l'application et l'état de départ"),
  projects: z.array(ProjectInventory),
  hasTests: z.boolean(),
  migratable: z.boolean().describe("false si une partie majeure n'a pas d'équivalent (ex. WebForms)"),
  notMigratableReason: z.string().optional(),
  strategy: z.array(PlanStep),
  estimatedRisk: Risk,
  notes: z.array(z.string()),
});
export type MigrationPlan = z.infer<typeof MigrationPlan>;

export const TestOutcome = z.object({
  ran: z.boolean(),
  framework: z.string().optional().describe("xunit, nunit, mstest..."),
  passed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  generated: z.boolean().describe("true si le testeur a dû créer des tests de fumée"),
  notes: z.array(z.string()),
});
export type TestOutcome = z.infer<typeof TestOutcome>;

export const Finding = z.object({
  severity: z.enum(["blocker", "major", "minor", "nit"]),
  file: z.string().optional(),
  note: z.string(),
});

export const ReviewVerdict = z.object({
  approved: z.boolean(),
  score: z.number().int().min(0).max(100).describe("Qualité globale de la migration"),
  summary: z.string(),
  findings: z.array(Finding),
  mustFix: z.array(z.string()).describe("Points à corriger avant approbation, formulés pour le migrateur"),
  cheatingDetected: z.boolean().describe("Tests supprimés/désactivés, warnings masqués, logique remplacée par des TODO..."),
});
export type ReviewVerdict = z.infer<typeof ReviewVerdict>;

/** JSON Schema à donner au SDK (outputFormat) pour forcer la sortie structurée. */
export const jsonSchemaOf = (schema: z.ZodType): Record<string, unknown> =>
  z.toJSONSchema(schema, { target: "draft-7" }) as Record<string, unknown>;
