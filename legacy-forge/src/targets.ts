/**
 * Cibles du banc d'essai (benchmark/targets.json) et cibles ad hoc (URL passée en ligne de commande).
 */
import fs from "node:fs";
import { z } from "zod/v4";

export const Target = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  repo: z.string().describe("owner/name GitHub"),
  ref: z.string().default("HEAD").describe("Branche, tag ou commit"),
  /** Sous-dossier contenant la solution à migrer (vide = racine). */
  path: z.string().default(""),
  solution: z.string().optional().describe("Fichier .sln à cibler s'il y en a plusieurs"),
  /** Dossiers à retirer de la copie de travail (ex. un portage humain qui servirait d'antisèche). */
  exclude: z.array(z.string()).default([]),
  description: z.string().default(""),
  difficulty: z.number().int().min(1).max(5).default(3),
  needsWindows: z.boolean().default(false).describe("true si la validation doit tourner sur un runner Windows"),
  enabled: z.boolean().default(true),
  expected: z.object({
    migratable: z.boolean().default(true),
  }).default({ migratable: true }),
});
export type Target = z.infer<typeof Target>;

export const TargetsFile = z.object({
  version: z.number().int().default(1),
  targets: z.array(Target),
});

export function loadTargets(file: string): Target[] {
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  return TargetsFile.parse(raw).targets;
}

/** Construit une cible à partir d'une URL GitHub (forge run https://github.com/owner/name[/tree/ref/sub/dir]). */
export function targetFromUrl(url: string, overrides: Partial<Target> = {}): Target {
  const m = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/#?]+?)(?:\.git)?(?:\/tree\/([^/]+)(?:\/(.*))?)?\/?$/);
  if (!m) throw new Error(`URL GitHub non reconnue : ${url}`);
  const [, owner, name, ref, sub] = m;
  const id = `${owner}-${name}`.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return Target.parse({
    id,
    repo: `${owner}/${name}`,
    ref: ref ?? "HEAD",
    path: sub ?? "",
    ...overrides,
  });
}
