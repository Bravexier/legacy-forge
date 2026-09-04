/**
 * Portes déterministes : build et tests exécutés par l'orchestrateur, pas par l'agent.
 * « Faire confiance, mais vérifier » : le migrateur dit que ça compile ; on recompile.
 */
import fs from "node:fs";
import path from "node:path";
import { exec } from "./util/exec.js";
import { walk } from "./inventory.js";
import type { TestOutcome } from "./schemas.js";

export async function hasDotnet(): Promise<string | null> {
  const r = await exec("dotnet", ["--version"], { timeoutMs: 30_000 });
  return r.code === 0 ? r.stdout.trim() : null;
}

export interface BuildResult {
  ok: boolean;
  skipped: boolean;
  errors: number;
  warnings: number;
  tail: string;
}

/** Compile la solution (ou tous les projets SDK-style si pas de .sln exploitable). */
export async function build(solutionDir: string, solution?: string): Promise<BuildResult> {
  if (!(await hasDotnet())) return { ok: false, skipped: true, errors: 0, warnings: 0, tail: "dotnet absent : build ignoré" };
  const args = ["build", "--nologo", "-clp:ErrorsOnly;Summary", "-p:EnableWindowsTargeting=true"];
  if (solution) args.splice(1, 0, solution);
  const r = await exec("dotnet", args, { cwd: solutionDir, timeoutMs: 20 * 60 * 1000 });
  const out = r.stdout + "\n" + r.stderr;
  const errors = Number(out.match(/(\d+) Error\(s\)/)?.[1] ?? (r.code === 0 ? 0 : 1));
  const warnings = Number(out.match(/(\d+) Warning\(s\)/)?.[1] ?? 0);
  return { ok: r.code === 0 && !r.timedOut, skipped: false, errors, warnings, tail: out.slice(-6000) };
}

export function findTestProjects(root: string): string[] {
  return walk(root, (n) => n.endsWith(".csproj")).filter((f) => {
    const x = fs.readFileSync(f, "utf8");
    return /Microsoft\.NET\.Test\.Sdk|xunit|nunit|MSTest/i.test(x);
  }).map((f) => path.relative(root, f));
}

/** Lance `dotnet test` et parse le résumé console. */
export async function test(solutionDir: string, solution?: string): Promise<TestOutcome> {
  const projects = findTestProjects(solutionDir);
  if (projects.length === 0) return { ran: false, passed: 0, failed: 0, skipped: 0, generated: false, notes: ["Aucun projet de test"] };
  if (!(await hasDotnet())) return { ran: false, passed: 0, failed: 0, skipped: 0, generated: false, notes: ["dotnet absent : tests ignorés"] };
  const args = ["test", "--nologo", "--no-restore", "-p:EnableWindowsTargeting=true"];
  if (solution) args.splice(1, 0, solution);
  const r = await exec("dotnet", args, { cwd: solutionDir, timeoutMs: 20 * 60 * 1000 });
  const out = r.stdout + "\n" + r.stderr;
  // Formats rencontrés : "Passed! - Failed: 0, Passed: 12, Skipped: 0" (VSTest) ou "total: 12 failed: 0 succeeded: 12 skipped: 0" (MTP)
  const failed = sumAll(out, /Failed:\s*(\d+)/g) + sumAll(out, /failed:\s*(\d+)/g);
  const passed = sumAll(out, /Passed:\s*(\d+)/g) + sumAll(out, /succeeded:\s*(\d+)/g);
  const skipped = sumAll(out, /Skipped:\s*(\d+)/g) + sumAll(out, /skipped:\s*(\d+)/g);
  const framework = /xunit/i.test(out) ? "xunit" : /nunit/i.test(out) ? "nunit" : /MSTest/i.test(out) ? "mstest" : undefined;
  return {
    ran: true,
    framework,
    passed, failed, skipped,
    generated: false,
    notes: [`${projects.length} projet(s) de test`, r.code === 0 ? "dotnet test : succès" : `dotnet test : code ${r.code}${r.timedOut ? " (timeout)" : ""}`, out.slice(-1500)],
  };
}

function sumAll(text: string, re: RegExp): number {
  let s = 0;
  for (const m of text.matchAll(re)) s += Number(m[1]);
  return s;
}
