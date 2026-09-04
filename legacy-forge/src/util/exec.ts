/**
 * Exécution de commandes avec capture, timeout et journalisation.
 * Utilisé par l'orchestrateur (git, dotnet) — pas par les agents, qui ont leur propre outil Bash.
 */
import { spawn } from "node:child_process";

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface ExecOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  /** Tronque la sortie capturée pour ne pas gonfler les rapports. */
  maxOutputChars?: number;
}

export function exec(cmd: string, args: string[], opts: ExecOptions = {}): Promise<ExecResult> {
  const { cwd, env, timeoutMs = 10 * 60 * 1000, maxOutputChars = 200_000 } = opts;
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (d: Buffer) => { if (stdout.length < maxOutputChars) stdout += d.toString(); });
    child.stderr.on("data", (d: Buffer) => { if (stderr.length < maxOutputChars) stderr += d.toString(); });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: stderr + String(err), timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr, timedOut });
    });
  });
}

/** Variante qui lève une erreur si la commande échoue. */
export async function execOrThrow(cmd: string, args: string[], opts: ExecOptions = {}): Promise<ExecResult> {
  const r = await exec(cmd, args, opts);
  if (r.code !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} a échoué (code ${r.code}${r.timedOut ? ", timeout" : ""})\n${r.stderr.slice(-4000)}`);
  }
  return r;
}
