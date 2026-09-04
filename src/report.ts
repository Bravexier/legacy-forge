/**
 * Rapports : un report.json + un report.md par run, et un tableau de bord
 * (runs/README.md) régénéré à partir de tous les report.json.
 * C'est ce que le pilote lit en premier chaque semaine.
 */
import fs from "node:fs";
import path from "node:path";
import type { RunContext } from "./context.js";
import { spentSoFar } from "./context.js";

export interface RunReport {
  runId: string;
  target: string;
  repo: string;
  ref: string;
  startedAt: string;
  endedAt: string;
  status: string;
  statusReason: string;
  migratable: boolean | undefined;
  buildOk: boolean | undefined;
  tests: { ran: boolean; passed: number; failed: number; generated: boolean } | undefined;
  reviewScore: number | undefined;
  reviewApproved: boolean | undefined;
  cheatingDetected: boolean | undefined;
  loops: number;
  costUsd: number;
  turns: number;
  durationMin: number;
  prUrl: string | undefined;
  stages: Array<{ stage: string; loop: number; costUsd: number; turns: number; toolCalls: number; durationS: number; subtype: string; notes: string[] }>;
  dryRun: boolean;
}

export function buildReport(ctx: RunContext, startedAt: string): RunReport {
  const endedAt = new Date().toISOString();
  const stages = ctx.stages.map((s) => ({
    stage: s.stage, loop: s.loop,
    costUsd: s.outcome?.costUsd ?? 0, turns: s.outcome?.turns ?? 0, toolCalls: s.outcome?.toolCalls ?? 0,
    durationS: Math.round((new Date(s.endedAt).getTime() - new Date(s.startedAt).getTime()) / 1000),
    subtype: s.outcome?.subtype ?? "none", notes: s.notes,
  }));
  return {
    runId: ctx.runId,
    target: ctx.target.id,
    repo: ctx.target.repo,
    ref: ctx.target.ref,
    startedAt, endedAt,
    status: ctx.status,
    statusReason: ctx.statusReason,
    migratable: ctx.plan?.migratable,
    buildOk: ctx.buildOk,
    tests: ctx.tests ? { ran: ctx.tests.ran, passed: ctx.tests.passed, failed: ctx.tests.failed, generated: ctx.tests.generated } : undefined,
    reviewScore: ctx.verdict?.score,
    reviewApproved: ctx.verdict?.approved,
    cheatingDetected: ctx.verdict?.cheatingDetected,
    loops: Math.max(0, ...ctx.stages.filter((s) => s.stage === "migrate").map((s) => s.loop + 1)),
    costUsd: Math.round(spentSoFar(ctx) * 1000) / 1000,
    turns: ctx.stages.reduce((n, s) => n + (s.outcome?.turns ?? 0), 0),
    durationMin: Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 6000) / 10,
    prUrl: ctx.prUrl,
    stages,
    dryRun: ctx.stages.some((s) => s.outcome?.dryRun),
  };
}

export function writeReport(ctx: RunContext, report: RunReport): void {
  fs.writeFileSync(path.join(ctx.runDir, "report.json"), JSON.stringify(report, null, 2));
  const md: string[] = [
    `# Run ${report.runId} — ${report.repo}${report.dryRun ? " (dry run)" : ""}`,
    "",
    `**Statut : ${statusBadge(report.status)}** — ${report.statusReason}`,
    "",
    `| Cible | Migrable | Build | Tests | Relecture | Boucles | Coût | Tours | Durée |`,
    `|---|---|---|---|---|---|---|---|---|`,
    `| ${report.target} | ${yesNo(report.migratable)} | ${yesNo(report.buildOk)} | ${testsCell(report.tests)} | ${reviewCell(report)} | ${report.loops} | ${report.costUsd.toFixed(2)} $ | ${report.turns} | ${report.durationMin} min |`,
    "",
    report.prUrl ? `Pull request : ${report.prUrl}\n` : "",
    "## Étapes",
    "",
    "| Étape | Boucle | Fin | Coût | Tours | Outils | Durée | Notes |",
    "|---|---|---|---|---|---|---|---|",
    ...report.stages.map((s) => `| ${s.stage} | ${s.loop} | ${s.subtype} | ${s.costUsd.toFixed(3)} $ | ${s.turns} | ${s.toolCalls} | ${s.durationS} s | ${s.notes.join(" · ").replace(/\|/g, "/")} |`),
    "",
    ctx.plan ? `## Plan de l'analyste\n\n${ctx.plan.summary}\n\n${ctx.plan.strategy.map((s) => `${s.order}. **${s.title}** (${s.risk}) — ${s.rationale}`).join("\n")}\n` : "",
    ctx.verdict ? `## Verdict du relecteur\n\n${ctx.verdict.summary}\n\n${ctx.verdict.findings.map((f) => `- [${f.severity}] ${f.file ? `\`${f.file}\` : ` : ""}${f.note}`).join("\n")}\n` : "",
    "## Fichiers du run",
    "",
    "- `inventory.json`, `plan.json` : ce que l'analyste a vu et décidé",
    "- `migrator-*.jsonl`, `tester-*.jsonl`, `reviewer-*.jsonl` : transcripts complets (artefacts CI, non versionnés)",
    "- `build-*.log`, `tests-*.json`, `diff-*.patch`, `verdict-*.json` : preuves à chaque boucle",
  ];
  fs.writeFileSync(path.join(ctx.runDir, "report.md"), md.filter((l) => l !== undefined).join("\n"));
}

/** Régénère runs/README.md à partir de tous les report.json. */
export function buildDashboard(runsDir: string): string {
  const reports: RunReport[] = [];
  if (fs.existsSync(runsDir)) {
    for (const entry of fs.readdirSync(runsDir, { withFileTypes: true })) {
      const f = path.join(runsDir, entry.name, "report.json");
      if (entry.isDirectory() && fs.existsSync(f)) {
        try { reports.push(JSON.parse(fs.readFileSync(f, "utf8"))); } catch { /* rapport corrompu : ignoré */ }
      }
    }
  }
  reports.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const real = reports.filter((r) => !r.dryRun);
  const successes = real.filter((r) => r.status === "success").length;
  const totalCost = real.reduce((s, r) => s + r.costUsd, 0);
  const lines = [
    "# Tableau de bord des runs",
    "",
    `_Régénéré le ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC — ${real.length} run(s) réels, ${reports.length - real.length} dry run(s)._`,
    "",
    `**Taux de réussite : ${real.length ? Math.round((100 * successes) / real.length) : 0} %** (${successes}/${real.length}) — **coût cumulé : ${totalCost.toFixed(2)} $** — coût moyen par run : ${real.length ? (totalCost / real.length).toFixed(2) : "0.00"} $`,
    "",
    "| Run | Dépôt | Statut | Migrable | Build | Tests | Relecture | Boucles | Coût | Durée | PR |",
    "|---|---|---|---|---|---|---|---|---|---|---|",
    ...reports.map((r) => `| [${r.runId}](./${r.runId}/report.md) | ${r.repo} | ${statusBadge(r.status)}${r.dryRun ? " (dry)" : ""} | ${yesNo(r.migratable)} | ${yesNo(r.buildOk)} | ${testsCell(r.tests)} | ${reviewCell(r)} | ${r.loops} | ${r.costUsd.toFixed(2)} $ | ${r.durationMin} min | ${r.prUrl ? `[PR](${r.prUrl})` : "-"} |`),
    "",
    "Légende des statuts : `success` = build + tests + relecture approuvée · `declined` = l'analyste a conclu « non migrable automatiquement » · `review_rejected` = boucles épuisées · `build_failed` · `budget_exceeded` · `error`.",
  ];
  const out = lines.join("\n") + "\n";
  fs.mkdirSync(runsDir, { recursive: true });
  fs.writeFileSync(path.join(runsDir, "README.md"), out);
  return out;
}

function yesNo(v: boolean | undefined): string { return v === undefined ? "-" : v ? "oui" : "non"; }
function testsCell(t: RunReport["tests"]): string { return !t || !t.ran ? "-" : `${t.passed} OK / ${t.failed} KO${t.generated ? " (générés)" : ""}`; }
function reviewCell(r: Pick<RunReport, "reviewScore" | "reviewApproved" | "cheatingDetected">): string {
  if (r.reviewScore === undefined) return "-";
  return `${r.reviewScore}/100 ${r.reviewApproved ? "✔" : "✘"}${r.cheatingDetected ? " triche" : ""}`;
}
function statusBadge(s: string): string { return `\`${s}\``; }
