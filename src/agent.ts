/**
 * Harnais d'agent : une seule fonction, runAgent(), qui lance un agent Claude
 * (via le Claude Agent SDK) avec un rôle, un budget, des outils autorisés,
 * et qui renvoie ce qu'il a produit + ce que ça a coûté.
 *
 * C'est la brique la plus importante du projet pour le pilote : tout ce qui
 * concerne « comment on tient un agent » est ici, et nulle part ailleurs.
 *
 *  - le budget est appliqué côté SDK (maxBudgetUsd, maxTurns) : l'agent est
 *    coupé net, il ne peut pas « négocier » ;
 *  - les outils sont une liste blanche + une liste noire explicites ;
 *  - chaque message échangé est écrit en JSONL dans le dossier du run
 *    (c'est le transcript que le pilote lit le vendredi) ;
 *  - une sortie structurée (JSON Schema) peut être exigée : l'analyste et le
 *    relecteur rendent du JSON, pas de la prose.
 */
import fs from "node:fs";
import path from "node:path";
import { query, type Options, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { appendJsonl, type RunLogger } from "./util/log.js";

export interface AgentSpec {
  /** Nom du rôle : correspond à agents/<role>.md (system prompt). */
  role: string;
  /** Instruction de la tâche (ce que l'agent doit faire maintenant). */
  prompt: string;
  /** Répertoire de travail de l'agent (le dépôt cloné). */
  cwd: string;
  /** Dossier du run où écrire le transcript. */
  runDir: string;
  model: string;
  /** Niveau de raisonnement ('low' | 'medium' | 'high' | 'xhigh' | 'max'), défaut du modèle si absent. */
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  maxBudgetUsd: number;
  maxTurns: number;
  allowedTools?: string[];
  disallowedTools?: string[];
  /** JSON Schema de la sortie attendue (structured output). */
  outputSchema?: Record<string, unknown>;
  /** Nom du fichier transcript (défaut : <role>.jsonl). */
  transcriptName?: string;
  logger?: RunLogger;
}

export interface AgentOutcome {
  role: string;
  ok: boolean;
  /** Sous-type du résultat SDK : 'success', 'error_max_budget_usd', ... */
  subtype: string;
  text: string;
  structured?: unknown;
  costUsd: number;
  turns: number;
  durationMs: number;
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number };
  toolCalls: number;
  transcriptPath: string;
  dryRun: boolean;
}

/** Outils lecture/écriture standard d'un agent de code. */
export const CODING_TOOLS = ["Read", "Edit", "Write", "MultiEdit", "Glob", "Grep", "Bash", "TodoWrite"];
/** Outils en lecture seule (analyste, relecteur). */
export const READONLY_TOOLS = ["Read", "Glob", "Grep", "Bash"];

/**
 * Interdictions par défaut, quel que soit le rôle. Un agent de migration n'a
 * aucune raison de pousser du code, d'effacer le dépôt ou d'aller sur le web.
 */
export const DEFAULT_DISALLOWED = [
  "Bash(git push*)",
  "Bash(git remote*)",
  "Bash(rm -rf /*)",
  "Bash(sudo*)",
  "Bash(curl*)",
  "Bash(wget*)",
  "WebFetch",
  "WebSearch",
];

export function loadRolePrompt(agentsDir: string, role: string): string {
  const file = path.join(agentsDir, `${role}.md`);
  if (!fs.existsSync(file)) throw new Error(`Prompt de rôle introuvable : ${file}`);
  return fs.readFileSync(file, "utf8");
}

export function isDryRun(): boolean {
  return process.env.FORGE_DRY_RUN === "1" || !process.env.ANTHROPIC_API_KEY;
}

export async function runAgent(spec: AgentSpec, systemPrompt: string): Promise<AgentOutcome> {
  const transcriptPath = path.join(spec.runDir, spec.transcriptName ?? `${spec.role}.jsonl`);
  const log = spec.logger;
  const started = Date.now();

  if (isDryRun()) {
    log?.warn(`[${spec.role}] DRY RUN — aucun appel au modèle (FORGE_DRY_RUN=1 ou ANTHROPIC_API_KEY absent)`);
    appendJsonl(transcriptPath, { type: "dry_run", role: spec.role, prompt: spec.prompt.slice(0, 2000), ts: new Date().toISOString() });
    return {
      role: spec.role,
      ok: true,
      subtype: "dry_run",
      text: "",
      structured: undefined,
      costUsd: 0,
      turns: 0,
      durationMs: Date.now() - started,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      toolCalls: 0,
      transcriptPath,
      dryRun: true,
    };
  }

  const allowed = spec.allowedTools ?? CODING_TOOLS;
  const options: Options = {
    cwd: spec.cwd,
    model: spec.model,
    effort: spec.effort,
    maxBudgetUsd: spec.maxBudgetUsd,
    maxTurns: spec.maxTurns,
    systemPrompt,
    // `tools` restreint les outils qui EXISTENT pour cet agent (moins de définitions envoyées au modèle,
    // moins de surface) ; `allowedTools` les pré-autorise (personne ne répond aux demandes de permission en CI).
    tools: allowed,
    allowedTools: allowed,
    disallowedTools: [...DEFAULT_DISALLOWED, ...(spec.disallowedTools ?? [])],
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    // On n'hérite d'aucun réglage de la machine : le comportement doit être le même partout (CI, poste, sandbox).
    settingSources: [],
    persistSession: false,
    outputFormat: spec.outputSchema ? { type: "json_schema", schema: spec.outputSchema } : undefined,
    stderr: (data: string) => log?.debug(`[${spec.role}] stderr: ${data.trimEnd()}`),
  };

  appendJsonl(transcriptPath, {
    type: "forge_start",
    role: spec.role,
    ts: new Date().toISOString(),
    model: spec.model,
    maxBudgetUsd: spec.maxBudgetUsd,
    maxTurns: spec.maxTurns,
    prompt: spec.prompt,
  });

  let toolCalls = 0;
  let final: AgentOutcome | undefined;

  try {
    for await (const message of query({ prompt: spec.prompt, options })) {
      appendJsonl(transcriptPath, message);
      describe(message, spec.role, log, () => { toolCalls += 1; });
      if (message.type === "result") {
        const ok = message.subtype === "success" && !message.is_error;
        final = {
          role: spec.role,
          ok,
          subtype: message.subtype,
          text: message.subtype === "success" ? message.result : "",
          structured: message.subtype === "success" ? message.structured_output : undefined,
          costUsd: round(message.total_cost_usd),
          turns: message.num_turns,
          durationMs: message.duration_ms,
          usage: {
            input: message.usage.input_tokens ?? 0,
            output: message.usage.output_tokens ?? 0,
            cacheRead: message.usage.cache_read_input_tokens ?? 0,
            cacheWrite: message.usage.cache_creation_input_tokens ?? 0,
          },
          toolCalls,
          transcriptPath,
          dryRun: false,
        };
      }
    }
  } catch (err) {
    // Le SDK lève une erreur après avoir émis un résultat en échec (budget, tours, ...).
    // Si on a le résultat, on le garde : c'est une fin de session normale pour la forge, pas un bug.
    if (!final) throw err;
    log?.warn(`[${spec.role}] session close en erreur : ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
  }

  if (!final) {
    throw new Error(`[${spec.role}] la session s'est terminée sans message de résultat`);
  }
  log?.info(`[${spec.role}] terminé : ${final.subtype} — ${final.turns} tours, ${final.toolCalls} appels d'outils, ${final.costUsd.toFixed(3)} USD, ${(final.durationMs / 1000).toFixed(0)} s`);
  return final;
}

/** Une ligne de progression lisible par message, sans noyer la console. */
function describe(message: SDKMessage, role: string, log: RunLogger | undefined, onToolCall: () => void): void {
  if (message.type !== "assistant") return;
  const content = (message.message as { content?: unknown }).content;
  if (!Array.isArray(content)) return;
  for (const block of content as Array<Record<string, unknown>>) {
    if (block.type === "tool_use") {
      onToolCall();
      const input = block.input as Record<string, unknown> | undefined;
      const hint = typeof input?.command === "string" ? input.command
        : typeof input?.file_path === "string" ? input.file_path
        : typeof input?.pattern === "string" ? input.pattern
        : "";
      log?.debug(`[${role}] → ${String(block.name)} ${hint.slice(0, 120)}`);
    }
  }
}

function round(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
