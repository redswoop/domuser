import { config as dotenvConfig } from "dotenv";
import { Command } from "commander";

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

export function parseConfig(): AppConfig {
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

  const groqApiKey = process.env.GROQ_API_KEY;
  if (!groqApiKey) {
    console.error("GROQ_API_KEY not set in environment or .env");
    process.exit(1);
  }

  return {
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
}
