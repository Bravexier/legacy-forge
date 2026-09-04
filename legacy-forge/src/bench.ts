/**
 * Le banc d'essai : lance toutes les cibles activées, l'une après l'autre, et régénère le tableau de bord.
 * Séquentiel volontairement : le budget se lit mieux, et les runners CI n'ont pas à se battre.
 */
import { loadConfig } from "./config.js";
import { loadTargets } from "./targets.js";
import { runTarget } from "./run.js";
import { buildDashboard, type RunReport } from "./report.js";

export async function bench(only?: string[]): Promise<RunReport[]> {
  const config = loadConfig();
  const targets = loadTargets(config.benchmarkFile).filter((t) => t.enabled && (!only || only.includes(t.id)));
  if (targets.length === 0) throw new Error("Aucune cible activée (voir benchmark/targets.json)");
  const reports: RunReport[] = [];
  for (const t of targets) {
    console.log(`\n=== Cible ${t.id} (${t.repo}) — difficulté ${t.difficulty}/5 ===`);
    reports.push(await runTarget(t, config));
  }
  buildDashboard(config.runsDir);
  const ok = reports.filter((r) => r.status === "success" || (r.status === "declined" && !targetExpected(targets, r.target))).length;
  console.log(`\nBanc d'essai : ${ok}/${reports.length} conformes — ${reports.reduce((s, r) => s + r.costUsd, 0).toFixed(2)} $`);
  return reports;
}

function targetExpected(targets: ReturnType<typeof loadTargets>, id: string): boolean {
  return targets.find((t) => t.id === id)?.expected.migratable ?? true;
}
