/**
 * Journalisation minimaliste : une ligne lisible pour l'humain sur stdout,
 * et l'événement brut en JSONL dans le dossier du run (observabilité v0).
 */
import fs from "node:fs";
import path from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";

export class RunLogger {
  private readonly file: string;

  constructor(runDir: string, name = "forge") {
    fs.mkdirSync(runDir, { recursive: true });
    this.file = path.join(runDir, `${name}.log`);
  }

  log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    const ts = new Date().toISOString();
    const line = `${ts} [${level.toUpperCase().padEnd(5)}] ${message}`;
    if (level === "error") console.error(line);
    else if (level !== "debug" || process.env.FORGE_DEBUG) console.log(line);
    fs.appendFileSync(this.file, JSON.stringify({ ts, level, message, ...data }) + "\n");
  }

  info(message: string, data?: Record<string, unknown>): void { this.log("info", message, data); }
  warn(message: string, data?: Record<string, unknown>): void { this.log("warn", message, data); }
  error(message: string, data?: Record<string, unknown>): void { this.log("error", message, data); }
  debug(message: string, data?: Record<string, unknown>): void { this.log("debug", message, data); }
}

/** Écrit un événement dans un fichier JSONL (transcript d'agent, etc.). */
export function appendJsonl(file: string, event: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(event) + "\n");
}
