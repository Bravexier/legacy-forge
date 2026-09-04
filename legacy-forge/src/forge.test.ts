/**
 * Tests unitaires des briques déterministes (node:test, aucun appel réseau ni modèle).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { targetFromUrl, Target } from "./targets.js";
import { estimateDifficulty } from "./scout.js";
import { classify, inventory } from "./inventory.js";
import { buildDashboard } from "./report.js";
import { makeRunId } from "./run.js";
import { MigrationPlan, ReviewVerdict, jsonSchemaOf } from "./schemas.js";
import { fallbackPlan } from "./stages/analyze.js";

test("targetFromUrl : dépôt simple et sous-dossier avec ref", () => {
  const a = targetFromUrl("https://github.com/greenshot/greenshot");
  assert.equal(a.repo, "greenshot/greenshot");
  assert.equal(a.ref, "HEAD");
  assert.equal(a.path, "");
  assert.equal(a.id, "greenshot-greenshot");

  const b = targetFromUrl("https://github.com/dotnet-architecture/eShopModernizing/tree/main/eShopLegacyMVCSolution", { solution: "eShopLegacyMVC.sln" });
  assert.equal(b.repo, "dotnet-architecture/eShopModernizing");
  assert.equal(b.ref, "main");
  assert.equal(b.path, "eShopLegacyMVCSolution");
  assert.equal(b.solution, "eShopLegacyMVC.sln");
  assert.throws(() => targetFromUrl("https://gitlab.com/x/y"));
});

test("Target : valeurs par défaut", () => {
  const t = Target.parse({ id: "x", repo: "a/b" });
  assert.equal(t.enabled, true);
  assert.equal(t.expected.migratable, true);
  assert.deepEqual(t.exclude, []);
});

test("estimateDifficulty : bornée entre 1 et 5, WebForms ≥ 4", () => {
  assert.equal(estimateDifficulty(1, 10, false, false), 1);
  assert.equal(estimateDifficulty(3, 200, false, false), 2);
  assert.equal(estimateDifficulty(20, 2000, false, true), 5);
  assert.equal(estimateDifficulty(1, 10, true, false), 4);
});

test("classify : MVC, WebForms (bloquant), tests, WinForms", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "forge-"));
  assert.equal(classify(dir, "", ["Microsoft.AspNet.Mvc"], "Library").kind, "web-mvc");
  assert.equal(classify(dir, "", ["xunit", "Microsoft.NET.Test.Sdk"], "Library").kind, "test");
  assert.equal(classify(dir, "", ["ref:System.Windows.Forms"], "WinExe").kind, "winforms");
  fs.writeFileSync(path.join(dir, "Default.aspx"), "<%@ Page %>");
  const wf = classify(dir, "", [], "Library");
  assert.equal(wf.kind, "webforms");
  assert.equal(wf.blockers.length, 1);
});

test("inventory + fallbackPlan : un projet WebForms rend la solution non migrable", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "forge-inv-"));
  fs.mkdirSync(path.join(root, "Web"));
  fs.writeFileSync(path.join(root, "Web", "Web.csproj"), `<Project><PropertyGroup><TargetFrameworkVersion>v4.8</TargetFrameworkVersion></PropertyGroup></Project>`);
  fs.writeFileSync(path.join(root, "Web", "Default.aspx"), "<%@ Page %>");
  fs.writeFileSync(path.join(root, "Web", "Default.aspx.cs"), "class A {}\n");
  fs.writeFileSync(path.join(root, "App.sln"), "");
  const inv = inventory(root);
  assert.equal(inv.projects.length, 1);
  assert.equal(inv.projects[0].targetFramework, "v4.8");
  assert.equal(inv.projects[0].sdkStyle, false);
  const plan = fallbackPlan(inv, "net8.0");
  assert.equal(plan.migratable, false);
  assert.ok(plan.notMigratableReason);
});

test("schemas : JSON Schema généré et verdict valide", () => {
  const schema = jsonSchemaOf(ReviewVerdict) as { properties?: Record<string, unknown>; required?: string[] };
  assert.ok(schema.properties && "approved" in schema.properties);
  assert.ok(schema.required?.includes("score"));
  assert.throws(() => ReviewVerdict.parse({ approved: true, score: 120, summary: "", findings: [], mustFix: [], cheatingDetected: false }));
  assert.ok(MigrationPlan.safeParse({ summary: "s", projects: [], hasTests: false, migratable: true, strategy: [], estimatedRisk: "low", notes: [] }).success);
});

test("makeRunId : horodatage + identifiant de cible", () => {
  const t = Target.parse({ id: "eshop-mvc", repo: "a/b" });
  assert.equal(makeRunId(t, new Date("2026-09-04T12:20:15Z")), "20260904-1220-eshop-mvc");
});

test("buildDashboard : agrège les report.json et calcule le taux de réussite hors dry run", () => {
  const runs = fs.mkdtempSync(path.join(os.tmpdir(), "forge-runs-"));
  const mk = (id: string, status: string, dryRun: boolean, costUsd: number) => {
    fs.mkdirSync(path.join(runs, id));
    fs.writeFileSync(path.join(runs, id, "report.json"), JSON.stringify({
      runId: id, target: "t", repo: "a/b", ref: "main", startedAt: `2026-09-0${id.length % 9 + 1}T00:00:00Z`, endedAt: "", status, statusReason: "",
      migratable: true, buildOk: true, tests: { ran: true, passed: 3, failed: 0, generated: false }, reviewScore: 80, reviewApproved: status === "success",
      cheatingDetected: false, loops: 1, costUsd, turns: 10, durationMin: 5, prUrl: undefined, stages: [], dryRun,
    }));
  };
  mk("r1", "success", false, 4);
  mk("r22", "build_failed", false, 6);
  mk("r333", "declined", true, 0);
  const md = buildDashboard(runs);
  assert.match(md, /Taux de réussite : 50 %/);
  assert.match(md, /coût cumulé : 10\.00 \$/);
  assert.match(md, /`declined` \(dry\)/);
  assert.ok(fs.existsSync(path.join(runs, "README.md")));
});
