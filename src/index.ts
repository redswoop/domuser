import { parseConfig } from "./config.js";
import { initLogger, getLogger } from "./util/logger.js";
import { TelnetConnection } from "./connection/telnet.js";
import { TerminalBuffer } from "./util/terminal-buffer.js";
import { loadPersona } from "./persona/loader.js";
import { MemoryStore } from "./memory/store.js";
import { initGroq } from "./llm/groq.js";
import { AgentLoop } from "./agent/loop.js";
import { decodeCP437 } from "./connection/ansi.js";
import { runConsole } from "./console.js";

async function main(): Promise<void> {
  const result = parseConfig();

  // Orchestrate mode — separate entry path
  if (result.mode === "orchestrate") {
    initLogger(result.config.verbose ? "debug" : result.config.logLevel);
    const { Orchestrator } = await import("./orchestrate/orchestrator.js");
    const orchestrator = new Orchestrator(result.config);
    await orchestrator.run();
    return;
  }

  const config = result.config;
  initLogger(config.verbose ? "debug" : config.logLevel);
  const log = getLogger("main");

  // Console mode — no telnet, you are the BBS
  if (config.console) {
    await runConsole(config);
    return;
  }

  log.info(`domuser v0.1.0 — connecting to ${config.host}:${config.port}`);

  // Load persona
  const persona = loadPersona(config.persona);
  log.info(`persona: ${persona.handle} (${persona.name}) — ${persona.archetype}`);

  // Init memory
  const memory = new MemoryStore(config.host, persona.handle);
  const creds = memory.getCredentials();
  if (creds) {
    log.info(`found saved credentials for ${creds.username}`);
  } else {
    log.info("no saved credentials — will register as new user");
  }

  // Init LLM
  initGroq(config.groqApiKey);

  // Connect
  const conn = new TelnetConnection(config.host, config.port);
  const buffer = new TerminalBuffer(config.idleTimeoutMs);

  // Wire up data flow
  conn.on("data", (data: Buffer) => {
    buffer.feed(data);

    if (config.verbose) {
      const text = decodeCP437(data);
      process.stdout.write(text);
    }
  });

  conn.on("close", () => {
    log.info("connection closed");
  });

  conn.on("error", (err: Error) => {
    log.error(`connection error: ${err.message}`);
  });

  try {
    await conn.connect();
  } catch (err) {
    log.error(`failed to connect: ${err}`);
    process.exit(1);
  }

  // Run agent loop
  const agent = new AgentLoop(conn, buffer, memory, persona, config);

  // Handle graceful shutdown
  process.on("SIGINT", () => {
    log.info("SIGINT received, disconnecting...");
    conn.disconnect();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    log.info("SIGTERM received, disconnecting...");
    conn.disconnect();
    process.exit(0);
  });

  await agent.run();

  log.info("session complete");
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
