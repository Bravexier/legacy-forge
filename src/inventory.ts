/**
 * Inventaire déterministe d'une solution .NET : pas d'IA ici.
 *
 * Principe de la forge : l'IA ne sert que là où il faut du jugement.
 * Lister les .csproj, lire leur cible et leurs packages, c'est du parsing —
 * on le fait en code, c'est gratuit, exact et reproductible. L'analyste IA
 * reçoit cet inventaire comme point de départ et se concentre sur la stratégie.
 */
import fs from "node:fs";
import path from "node:path";
import type { ProjectKind } from "./schemas.js";

export interface ProjectInfo {
  path: string;
  kind: ProjectKind;
  targetFramework: string;
  sdkStyle: boolean;
  packages: string[];
  blockers: string[];
  linesOfCode: number;
  outputType: string;
  isTest: boolean;
}

export interface Inventory {
  root: string;
  solutions: string[];
  projects: ProjectInfo[];
  totalLinesOfCode: number;
  hasTests: boolean;
  needsWindows: boolean;
}

const IGNORED_DIRS = new Set(["bin", "obj", "node_modules", "packages", ".git", ".vs", "TestResults"]);

export function walk(dir: string, predicate: (file: string) => boolean, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) walk(path.join(dir, entry.name), predicate, out);
    } else if (predicate(entry.name)) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

function attr(xml: string, tag: string): string | undefined {
  const m = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
  return m?.[1]?.trim();
}

function packageIds(projectDir: string, csproj: string): string[] {
  const ids = new Set<string>();
  for (const m of csproj.matchAll(/<PackageReference\s+Include="([^"]+)"/g)) ids.add(m[1]);
  const pkgConfig = path.join(projectDir, "packages.config");
  if (fs.existsSync(pkgConfig)) {
    for (const m of fs.readFileSync(pkgConfig, "utf8").matchAll(/<package\s+id="([^"]+)"/g)) ids.add(m[1]);
  }
  for (const m of csproj.matchAll(/<Reference\s+Include="([^",]+)/g)) ids.add(`ref:${m[1]}`);
  return [...ids].sort();
}

function countLines(dir: string, exts: string[]): number {
  let total = 0;
  for (const f of walk(dir, (n) => exts.some((e) => n.endsWith(e)))) {
    total += fs.readFileSync(f, "utf8").split("\n").length;
  }
  return total;
}

export function classify(projectDir: string, csproj: string, packages: string[], outputType: string): { kind: ProjectKind; blockers: string[]; isTest: boolean } {
  const has = (p: string) => packages.some((id) => id.toLowerCase().includes(p.toLowerCase()));
  const blockers: string[] = [];
  const isTest = has("xunit") || has("nunit") || has("MSTest") || has("Microsoft.NET.Test.Sdk");
  if (isTest) return { kind: "test", blockers, isTest: true };

  const hasAspx = walk(projectDir, (n) => n.endsWith(".aspx") || n.endsWith(".ascx") || n.endsWith(".master")).length > 0;
  if (hasAspx || has("Microsoft.AspNet.WebForms")) {
    blockers.push("ASP.NET WebForms n'a pas d'équivalent en .NET moderne : réécriture (Razor Pages / Blazor) nécessaire");
    return { kind: "webforms", blockers, isTest: false };
  }
  if (has("Microsoft.AspNet.Mvc")) return { kind: "web-mvc", blockers, isTest: false };
  if (has("Microsoft.AspNet.WebApi")) return { kind: "web-api", blockers, isTest: false };
  if (has("ref:System.ServiceModel") || csproj.includes(".svc")) {
    blockers.push("WCF : passer par CoreWCF (serveur) ou System.ServiceModel.* (client)");
    return { kind: "wcf", blockers, isTest: false };
  }
  if (has("ref:System.Windows.Forms") || csproj.includes("<UseWindowsForms>true")) return { kind: "winforms", blockers, isTest: false };
  if (has("ref:PresentationFramework") || csproj.includes("<UseWPF>true")) return { kind: "wpf", blockers, isTest: false };
  if (outputType.toLowerCase() === "exe" || outputType.toLowerCase() === "winexe") return { kind: "console", blockers, isTest: false };
  if (outputType.toLowerCase() === "library") return { kind: "library", blockers, isTest: false };
  return { kind: "unknown", blockers, isTest: false };
}

export function inventory(root: string): Inventory {
  const solutions = walk(root, (n) => n.endsWith(".sln")).map((f) => path.relative(root, f));
  const projects: ProjectInfo[] = walk(root, (n) => n.endsWith(".csproj")).map((file) => {
    const csproj = fs.readFileSync(file, "utf8");
    const projectDir = path.dirname(file);
    const sdkStyle = /<Project\s+Sdk=/.test(csproj);
    const targetFramework = attr(csproj, "TargetFrameworkVersion") ?? attr(csproj, "TargetFramework") ?? attr(csproj, "TargetFrameworks") ?? "?";
    const outputType = attr(csproj, "OutputType") ?? (csproj.includes("Microsoft.WebApplication.targets") ? "Web" : "Library");
    const packages = packageIds(projectDir, csproj);
    const { kind, blockers, isTest } = classify(projectDir, csproj, packages, outputType);
    const linesOfCode = countLines(projectDir, [".cs", ".cshtml", ".aspx", ".ascx", ".xaml"]);
    return { path: path.relative(root, file), kind, targetFramework, sdkStyle, packages, blockers, linesOfCode, outputType, isTest };
  });
  return {
    root,
    solutions,
    projects,
    totalLinesOfCode: projects.reduce((s, p) => s + p.linesOfCode, 0),
    hasTests: projects.some((p) => p.isTest),
    needsWindows: projects.some((p) => p.kind === "winforms" || p.kind === "wpf"),
  };
}

/** Résumé compact de l'inventaire, à injecter dans un prompt. */
export function inventoryToMarkdown(inv: Inventory): string {
  const lines = [
    `Solutions : ${inv.solutions.join(", ") || "(aucune)"}`,
    `Projets : ${inv.projects.length} — ${inv.totalLinesOfCode} lignes (cs/cshtml/aspx/xaml) — tests : ${inv.hasTests ? "oui" : "non"}`,
    "",
    "| Projet | Type | Cible | SDK-style | Packages notables | Bloquants |",
    "|---|---|---|---|---|---|",
  ];
  for (const p of inv.projects) {
    const notable = p.packages.filter((id) => !id.startsWith("ref:")).slice(0, 12).join(", ");
    lines.push(`| ${p.path} | ${p.kind} | ${p.targetFramework} | ${p.sdkStyle ? "oui" : "non"} | ${notable} | ${p.blockers.join(" ; ") || "-"} |`);
  }
  return lines.join("\n");
}
