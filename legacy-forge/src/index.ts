#!/usr/bin/env node
/**
 * CLI de la forge.
 *
 *   forge run <url-github> [--solution X.sln] [--exclude a,b] [--target net8.0]
 *   forge run --id <cible-du-banc>
 *   forge bench [id ...]
 *   forge scout
 *   forge report
 *   forge inventory <dossier>
 */
import path from "node:path";
import { loadConfig } from "./config.js";
import { loadTargets, targetFromUrl } from "./targets.js";
import { runTarget } from "./run.js";
import { bench } from "./bench.js";
import { scout } from "./scout.js";
import { buildDashboard } from "./report.js";
import { inventory, inventoryToMarkdown } from "./inventory.js";

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main(argv: string[]): Promise<number> {
  const [cmd, ...args] = argv;
  const config = loadConfig();

  switch (cmd) {
    case "run": {
      const id = flag(args, "--id");
      const target = id
        ? loadTargets(config.benchmarkFile).find((t) => t.id === id) ?? (() => { throw new Error(`Cible inconnue : ${id}`); })()
        : targetFromUrl(args[0], {
          solution: flag(args, "--solution"),
          exclude: flag(args, "--exclude")?.split(",").filter(Boolean) ?? [],
        });
      if (flag(args, "--target")) process.env.FORGE_TARGET = flag(args, "--target");
      const report = await runTarget(target, loadConfig());
      return report.status === "success" || report.status === "declined" ? 0 : 1;
    }
    case "bench": {
      const reports = await bench(args.length ? args : undefined);
      return reports.every((r) => r.status === "success" || r.status === "declined") ? 0 : 1;
    }
    case "scout": {
      const token = process.env.FORGE_TOKEN || process.env.GITHUB_TOKEN;
      if (!token) throw new Error("GITHUB_TOKEN ou FORGE_TOKEN requis pour la recherche de code GitHub");
      const c = await scout({ token, outDir: path.join(config.rootDir, "benchmark"), minStars: Number(flag(args, "--min-stars") ?? 25) });
      console.log(`${c.length} candidats → benchmark/CANDIDATES.md`);
      return 0;
    }
    case "report": {
      console.log(buildDashboard(config.runsDir));
      return 0;
    }
    case "inventory": {
      const inv = inventory(path.resolve(args[0] ?? "."));
      console.log(inventoryToMarkdown(inv));
      return 0;
    }
    default:
      console.log([
        "legacy-forge — flotte d'agents de modernisation .NET",
        "",
        "  forge run <url-github> [--solution X.sln] [--exclude a,b] [--target net8.0]",
        "  forge run --id <cible-du-banc>",
        "  forge bench [id ...]        lance les cibles activées de benchmark/targets.json",
        "  forge scout [--min-stars N] cherche des dépôts .NET Framework publics (GITHUB_TOKEN requis)",
        "  forge report                régénère runs/README.md",
        "  forge inventory <dossier>   inventaire déterministe d'une solution",
        "",
        "Variables : ANTHROPIC_API_KEY, FORGE_TOKEN (fork/PR), FORGE_RUN_BUDGET_USD, FORGE_MODEL_WORKER, FORGE_MODEL_REVIEWER, FORGE_DRY_RUN=1",
      ].join("\n"));
      return cmd ? 2 : 0;
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => { console.error(err instanceof Error ? err.message : err); process.exit(1); },
);
