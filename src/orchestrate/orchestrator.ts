import fs from "fs";
import path from "path";
import { initGroq } from "../llm/groq.js";
import { RateLimiter } from "../llm/rate-limiter.js";
import { loadPersona } from "../persona/loader.js";
import { SimClock } from "./sim-clock.js";
import { SessionScheduler } from "./scheduler.js";
import { SessionManager } from "./session-manager.js";
import type { OrchestrateConfig, ScheduledSession } from "./types.js";
import type { AgentEvent } from "../agent/events.js";
import type { Persona } from "../persona/types.js";
import { getLogger, replaceConsoleTransport } from "../util/logger.js";

const log = getLogger("orchestrator");

export class Orchestrator {
  private config: OrchestrateConfig;
  private clock: SimClock;
  private rateLimiter: RateLimiter;
  private scheduler: SessionScheduler;
  private sessionManager: SessionManager;
  private personas: Persona[];
  private shutdownPromise: Promise<void> | null = null;

  constructor(config: OrchestrateConfig) {
    this.config = config;

    // Init LLM
    initGroq(config.groqApiKey);

    // Load personas
    this.personas = this.loadPersonas();

    // Core components
    this.clock = new SimClock(config.simStart, config.speed);
    this.rateLimiter = new RateLimiter(config.groqRpm);
    this.scheduler = new SessionScheduler(this.clock, this.personas);
    this.sessionManager = new SessionManager(config, this.rateLimiter, this.clock);
  }

  async run(): Promise<void> {
    log.info(`orchestrator starting — ${this.personas.length} personas, host=${this.config.host}:${this.config.port}`);
    log.info(`sim start: ${this.config.simStart.toISOString()}, speed: ${this.config.speed === 0 ? "turbo" : this.config.speed + "x"}`);
    log.info(`max concurrent: ${this.config.maxConcurrent}, groq rpm: ${this.config.groqRpm}`);

    // Wire scheduler → session manager
    this.scheduler.on("session:due", (session: ScheduledSession) => {
      this.sessionManager.enqueue(session);
    });

    // Handle SIGINT
    const shutdownHandler = () => {
      if (!this.shutdownPromise) {
        log.info("SIGINT — graceful shutdown...");
        this.shutdownPromise = this.shutdown();
      }
    };
    process.on("SIGINT", shutdownHandler);
    process.on("SIGTERM", shutdownHandler);

    if (this.config.noTui) {
      // Headless mode — log events to stdout
      this.runHeadless();
      await this.scheduler.start();
    } else {
      // TUI mode — redirect winston to file, start ink UI
      replaceConsoleTransport(path.resolve("domuser.log"));

      const { startMonitor } = await import("../monitor/app.js");
      const cleanup = startMonitor({
        clock: this.clock,
        rateLimiter: this.rateLimiter,
        scheduler: this.scheduler,
        sessionManager: this.sessionManager,
        personas: this.personas,
        config: this.config,
        onSpeedChange: (speed: number) => this.clock.setSpeed(speed),
        onPauseToggle: () => {
          if (this.clock.isPaused()) {
            this.clock.resume();
          } else {
            this.clock.pause();
          }
        },
        onShutdown: () => shutdownHandler(),
      });

      await this.scheduler.start();
      cleanup();
    }
  }

  private runHeadless(): void {
    this.sessionManager.on("agent:event", (event: AgentEvent) => {
      const time = this.clock.now().toLocaleTimeString();
      switch (event.type) {
        case "session:start":
          console.log(`[${time}] ${event.personaHandle} — session started`);
          break;
        case "session:end":
          console.log(`[${time}] ${event.personaHandle} — session ended`);
          break;
        case "turn:action":
          if (event.action) {
            console.log(`[${time}] ${event.personaHandle} turn ${event.turn} — ${event.action.type}: ${event.action.value.slice(0, 80)}`);
          }
          break;
        case "turn:thinking":
          console.log(`[${time}] ${event.personaHandle} turn ${event.turn} — thinking: ${event.thinking?.slice(0, 80)}`);
          break;
        case "memory:note":
          console.log(`[${time}] ${event.personaHandle} — memory: ${event.note?.slice(0, 80)}`);
          break;
        case "error":
          console.log(`[${time}] ${event.personaHandle} — ERROR: ${event.error?.message}`);
          break;
      }
    });

    this.sessionManager.on("session:status", (info: { personaHandle: string; status: string }) => {
      const time = this.clock.now().toLocaleTimeString();
      console.log(`[${time}] ${info.personaHandle} — status: ${info.status}`);
    });
  }

  private async shutdown(): Promise<void> {
    log.info("shutting down...");
    this.scheduler.stop();
    await this.sessionManager.shutdown();
    this.rateLimiter.dispose();
    log.info("shutdown complete");
    process.exit(0);
  }

  private loadPersonas(): Persona[] {
    if (this.config.personas.length > 0 && this.config.personas[0] !== "all") {
      return this.config.personas.map((name) => loadPersona(name));
    }

    // Load all personas from the personas/ directory
    const personaDir = path.resolve("personas");
    if (!fs.existsSync(personaDir)) {
      throw new Error(`Personas directory not found: ${personaDir}`);
    }

    const files = fs.readdirSync(personaDir).filter(
      (f) => f.endsWith(".yaml") || f.endsWith(".yml"),
    );

    if (files.length === 0) {
      throw new Error(`No persona files found in ${personaDir}`);
    }

    return files.map((f) => {
      const name = f.replace(/\.ya?ml$/, "");
      return loadPersona(name);
    });
  }
}
