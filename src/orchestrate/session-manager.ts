import { EventEmitter } from "events";
import { TelnetConnection } from "../connection/telnet.js";
import { TerminalBuffer } from "../util/terminal-buffer.js";
import { MemoryStore } from "../memory/store.js";
import { AgentLoop } from "../agent/loop.js";
import { decodeCP437 } from "../connection/ansi.js";
import type { RateLimiter } from "../llm/rate-limiter.js";
import type { SimClock } from "./sim-clock.js";
import type { OrchestrateConfig, ScheduledSession, SessionInfo, SessionStatus } from "./types.js";
import type { AgentEvent } from "../agent/events.js";
import type { AppConfig } from "../config.js";
import { getLogger } from "../util/logger.js";

const log = getLogger("session-mgr");

let sessionCounter = 0;

/**
 * Manages a pool of concurrent BBS sessions.
 * Queues sessions when all BBS nodes are in use.
 */
export class SessionManager extends EventEmitter {
  private config: OrchestrateConfig;
  private rateLimiter: RateLimiter;
  private clock: SimClock;
  private maxConcurrent: number;

  private queue: ScheduledSession[] = [];
  private activeSessions = new Map<string, { agent: AgentLoop; conn: TelnetConnection; info: SessionInfo }>();
  private allSessions = new Map<string, SessionInfo>();
  private pendingConnections = 0;  // tracks in-flight connect() calls

  constructor(config: OrchestrateConfig, rateLimiter: RateLimiter, clock: SimClock) {
    super();
    this.config = config;
    this.rateLimiter = rateLimiter;
    this.clock = clock;
    this.maxConcurrent = config.maxConcurrent;
  }

  /** Add a session to the queue. Starts immediately if a slot is free. */
  enqueue(session: ScheduledSession): void {
    this.queue.push(session);
    log.info(`enqueued session for ${session.personaHandle} (queue: ${this.queue.length}, active: ${this.activeSessions.size}/${this.maxConcurrent})`);
    this.tryStartNext();
  }

  /** Get info about all sessions (active + completed). */
  getAllSessions(): SessionInfo[] {
    return [...this.allSessions.values()];
  }

  /** Get info about active sessions only. */
  getActiveSessions(): SessionInfo[] {
    return [...this.activeSessions.values()].map((s) => s.info);
  }

  /** Number of sessions currently running. */
  activeCount(): number {
    return this.activeSessions.size;
  }

  /** Number of sessions in queue. */
  queueCount(): number {
    return this.queue.length;
  }

  /**
   * Graceful shutdown: stop all agents, wait for memory extraction (with timeout),
   * then force-disconnect remaining.
   */
  async shutdown(timeoutMs: number = 60000): Promise<void> {
    log.info(`shutting down ${this.activeSessions.size} active sessions...`);

    // Stop all agents (they'll finish current turn then extract memories)
    for (const [id, session] of this.activeSessions) {
      session.agent.stop();
    }

    // Wait for all to finish with timeout
    const deadline = Date.now() + timeoutMs;
    while (this.activeSessions.size > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 500));
    }

    // Force-disconnect any remaining
    for (const [id, session] of this.activeSessions) {
      log.warn(`force-disconnecting ${session.info.personaHandle}`);
      session.conn.disconnect();
      this.updateSessionStatus(id, "done");
    }
    this.activeSessions.clear();
    this.queue = [];
  }

  /** Try to start the next queued session if a slot is available. */
  private tryStartNext(): void {
    while (this.queue.length > 0 && (this.activeSessions.size + this.pendingConnections) < this.maxConcurrent) {
      const next = this.queue.shift()!;
      this.pendingConnections++;
      this.startSession(next).finally(() => {
        this.pendingConnections--;
      });
    }
  }

  /** Start a single session: connect, wire up, run agent loop. */
  private async startSession(scheduled: ScheduledSession): Promise<void> {
    const id = `session-${++sessionCounter}`;
    const { persona } = scheduled;

    const info: SessionInfo = {
      id,
      personaHandle: persona.handle,
      persona,
      status: "connecting",
      turnCount: 0,
      currentScreen: "",
      lastAction: "",
      scheduledSimTime: scheduled.scheduledSimTime,
      startedAt: Date.now(),
    };

    this.allSessions.set(id, info);
    this.emit("session:status", info);

    // Build an AppConfig-compatible object for the agent loop
    const appConfig: AppConfig = {
      host: this.config.host,
      port: this.config.port,
      persona: persona.handle,
      console: false,
      verbose: this.config.verbose,
      maxTurns: this.config.maxTurns,
      sessionMinutes: this.config.sessionMinutes,
      idleTimeoutMs: this.config.idleTimeoutMs,
      keystrokeMinMs: this.config.keystrokeMinMs,
      keystrokeMaxMs: this.config.keystrokeMaxMs,
      groqApiKey: this.config.groqApiKey,
      groqModel: this.config.groqModel,
      logLevel: this.config.logLevel,
    };

    const conn = new TelnetConnection(this.config.host, this.config.port);
    const buffer = new TerminalBuffer(this.config.idleTimeoutMs);
    const memory = new MemoryStore(this.config.host, persona.handle);

    // Wire data flow
    conn.on("data", (data: Buffer) => {
      buffer.feed(data);
    });

    conn.on("close", () => {
      log.debug(`${persona.handle}: connection closed`);
    });

    conn.on("error", (err: Error) => {
      log.error(`${persona.handle}: connection error: ${err.message}`);
    });

    try {
      await conn.connect();
    } catch (err) {
      log.error(`${persona.handle}: failed to connect: ${err}`);
      this.updateSessionStatus(id, "error");
      info.error = String(err);
      this.emit("session:status", info);
      this.tryStartNext();
      return;
    }

    // Create agent loop with rate limiter
    const agent = new AgentLoop(conn, buffer, memory, persona, appConfig, {
      rateLimiter: this.rateLimiter,
    });

    this.activeSessions.set(id, { agent, conn, info });
    this.updateSessionStatus(id, "active");

    // Notify sim clock that a real-time session is active
    this.clock.sessionStarted();

    // Forward agent events
    agent.on("agent:event", (event: AgentEvent) => {
      // Update session info
      if (event.type === "turn:screen" && event.screenText) {
        info.currentScreen = event.screenText;
        info.turnCount = event.turn ?? info.turnCount;
      }
      if (event.type === "turn:action" && event.action) {
        info.lastAction = `${event.action.type}: ${event.action.value.slice(0, 60)}`;
      }
      if (event.type === "memory:extracting") {
        this.updateSessionStatus(id, "extracting");
      }

      this.emit("agent:event", event);
    });

    // Run the agent in the background
    agent.run().then(() => {
      this.finishSession(id);
    }).catch((err) => {
      log.error(`${persona.handle}: agent error: ${err}`);
      info.error = String(err);
      this.finishSession(id, "error");
    });
  }

  private finishSession(id: string, status: SessionStatus = "done"): void {
    const session = this.activeSessions.get(id);
    if (session) {
      session.info.endedAt = Date.now();
      session.conn.disconnect();
      this.activeSessions.delete(id);
      this.updateSessionStatus(id, status);

      // Notify sim clock
      this.clock.sessionEnded();

      log.info(`${session.info.personaHandle}: session ${status} (${session.info.turnCount} turns)`);
    }

    // Try starting next queued session
    this.tryStartNext();
  }

  private updateSessionStatus(id: string, status: SessionStatus): void {
    const info = this.allSessions.get(id);
    if (info) {
      info.status = status;
      this.emit("session:status", info);
    }
  }
}
