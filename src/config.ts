import { config as dotenvConfig } from "dotenv";
import { Command } from "commander";
import type { OrchestrateConfig } from "./orchestrate/types.js";

dotenvConfig();

export interface AppConfig {
  host: string;
  port: number;
  persona: string;
  console: boolean;
  verbose: boolean;
  maxTurns: number;
  sessionMinutes: number;
  idleTimeoutMs: number;
  keystrokeMinMs: number;
  keystrokeMaxMs: number;
  groqApiKey: string;
  groqModel: string;
  logLevel: string;
}

export type ParseResult =
  | { mode: "console" | "telnet"; config: AppConfig }
  | { mode: "orchestrate"; config: OrchestrateConfig };

export function parseConfig(): ParseResult {
  const args = process.argv.slice(2);

  // Detect orchestrate subcommand
  if (args[0] === "orchestrate") {
    return { mode: "orchestrate", config: parseOrchestrateConfig(args.slice(1)) };
  }

  return parseStandardConfig();
}

function parseStandardConfig(): { mode: "console" | "telnet"; config: AppConfig } {
  const program = new Command()
    .name("domuser")
    .description("BBS agent — simulated human users driven by LLMs")
    .argument("<host>", "BBS hostname or IP (use any name in console mode)")
    .option("-c, --console", "console mode — you paste BBS screens, agent responds", false)
    .option("-p, --port <number>", "telnet port", "23")
    .option("--persona <name>", "persona YAML file (without .yaml)", "default")
    .option("-v, --verbose", "verbose output", false)
    .option("--max-turns <number>", "max agent turns", "200")
    .option("--session-minutes <number>", "session time limit", "20")
    .option("--idle-timeout <ms>", "ms of silence before treating as prompt", "1500")
    .option("--keystroke-min <ms>", "min keystroke delay ms", "30")
    .option("--keystroke-max <ms>", "max keystroke delay ms", "100")
    .option("--model <name>", "Groq model ID", "llama-3.3-70b-versatile")
    .parse();

  const opts = program.opts();
  const host = program.args[0];

  const groqApiKey = requireGroqApiKey();

  const config: AppConfig = {
    host,
    port: parseInt(opts.port, 10),
    persona: opts.persona,
    console: opts.console,
    verbose: opts.verbose,
    maxTurns: parseInt(opts.maxTurns, 10),
    sessionMinutes: parseInt(opts.sessionMinutes, 10),
    idleTimeoutMs: parseInt(opts.idleTimeout, 10),
    keystrokeMinMs: parseInt(opts.keystrokeMin, 10),
    keystrokeMaxMs: parseInt(opts.keystrokeMax, 10),
    groqApiKey,
    groqModel: opts.model,
    logLevel: process.env.LOG_LEVEL || "info",
  };

  return { mode: config.console ? "console" : "telnet", config };
}

function parseOrchestrateConfig(args: string[]): OrchestrateConfig {
  const program = new Command()
    .name("domuser orchestrate")
    .description("Multi-agent BBS orchestrator with simulation clock")
    .argument("<host>", "BBS hostname or IP")
    .option("-p, --port <number>", "telnet port", "23")
    .option("--personas <names>", "comma-separated persona names (default: all)", "all")
    .option("--max-concurrent <number>", "max simultaneous BBS sessions", "2")
    .option("--speed <number>", "sim speed: 0=turbo, 1=realtime, N=multiplier", "1")
    .option("--sim-start <iso-date>", "simulation start time", "1996-09-14T08:00:00")
    .option("--groq-rpm <number>", "Groq rate limit (requests per minute)", "30")
    .option("--max-turns <number>", "max turns per session", "200")
    .option("--session-minutes <number>", "session time limit", "20")
    .option("--idle-timeout <ms>", "ms of silence before treating as prompt", "1500")
    .option("--keystroke-min <ms>", "min keystroke delay ms", "30")
    .option("--keystroke-max <ms>", "max keystroke delay ms", "100")
    .option("--model <name>", "Groq model ID", "llama-3.3-70b-versatile")
    .option("--no-tui", "headless mode — log events to stdout")
    .option("-v, --verbose", "verbose file logging", false)
    .parse(["node", "orchestrate", ...args]);

  const opts = program.opts();
  const host = program.args[0];

  if (!host) {
    console.error("Error: <host> argument required for orchestrate command");
    process.exit(1);
  }

  const groqApiKey = requireGroqApiKey();

  const personas = opts.personas === "all" ? ["all"] : opts.personas.split(",").map((s: string) => s.trim());

  return {
    host,
    port: parseInt(opts.port, 10),
    personas,
    maxConcurrent: parseInt(opts.maxConcurrent, 10),
    speed: parseFloat(opts.speed),
    simStart: new Date(opts.simStart),
    groqRpm: parseInt(opts.groqRpm, 10),
    maxTurns: parseInt(opts.maxTurns, 10),
    groqModel: opts.model,
    groqApiKey,
    sessionMinutes: parseInt(opts.sessionMinutes, 10),
    idleTimeoutMs: parseInt(opts.idleTimeout, 10),
    keystrokeMinMs: parseInt(opts.keystrokeMin, 10),
    keystrokeMaxMs: parseInt(opts.keystrokeMax, 10),
    noTui: opts.tui === false,  // commander flips --no-tui to tui: false
    verbose: opts.verbose,
    logLevel: process.env.LOG_LEVEL || "info",
  };
}

function requireGroqApiKey(): string {
  const key = process.env.GROQ_API_KEY;
  if (!key) {
    console.error("GROQ_API_KEY not set in environment or .env");
    process.exit(1);
  }
  return key;
}
