import { EventEmitter } from "events";
import { TelnetConnection } from "../connection/telnet.js";
import { TerminalBuffer } from "../util/terminal-buffer.js";
import { MemoryStore } from "../memory/store.js";
import { chatCompletion, type LLMMessage } from "../llm/groq.js";
import { buildSystemPrompt, buildScreenMessage } from "./prompt.js";
import { extractAndSaveMemories } from "../memory/extract.js";
import { parseActions, type Action } from "./parser.js";
import { typeWithDelay, sleep } from "../util/timing.js";
import type { Persona } from "../persona/types.js";
import type { AppConfig } from "../config.js";
import type { AgentEvent } from "./events.js";
import type { RateLimiter } from "../llm/rate-limiter.js";
import { getLogger } from "../util/logger.js";

const log = getLogger("agent");

// Pattern for [More] / pause prompts that don't need LLM reasoning
const MORE_PATTERN = /\[More[:\s]*[\])]|Continue\s*\[Y\/n\]|Press\s+(?:ENTER|any key|RETURN)\s+to\s+continue|pause/i;

export interface AgentLoopOptions {
  rateLimiter?: RateLimiter;
}

export class AgentLoop extends EventEmitter {
  private conn: TelnetConnection;
  private buffer: TerminalBuffer;
  private memory: MemoryStore;
  private persona: Persona;
  private config: AppConfig;
  private sessionTimestamp: string;
  private options: AgentLoopOptions;

  private turnCount = 0;
  private conversationHistory: LLMMessage[] = [];
  private lastScreens: string[] = [];
  private stuckCounter = 0;
  private lastScreenHash = "";
  private running = false;
  private sessionStart = 0;
  private memoryNotes: string[] = [];

  constructor(
    conn: TelnetConnection,
    buffer: TerminalBuffer,
    memory: MemoryStore,
    persona: Persona,
    config: AppConfig,
    options?: AgentLoopOptions,
  ) {
    super();
    this.conn = conn;
    this.buffer = buffer;
    this.memory = memory;
    this.persona = persona;
    this.config = config;
    this.options = options ?? {};
    this.sessionTimestamp = new Date().toISOString().replace(/[:.]/g, "-");
  }

  private emitEvent(event: Partial<AgentEvent> & { type: AgentEvent["type"] }): void {
    const full: AgentEvent = {
      personaHandle: this.persona.handle,
      timestamp: Date.now(),
      turn: this.turnCount,
      ...event,
    };
    this.emit("agent:event", full);
  }

  /** Gracefully stop the agent loop. Active turn finishes, then extraction runs. */
  stop(): void {
    this.running = false;
  }

  /** Current turn number. */
  getTurnCount(): number {
    return this.turnCount;
  }

  /** Whether the loop is currently running. */
  isRunning(): boolean {
    return this.running;
  }

  async run(): Promise<void> {
    this.running = true;
    this.sessionStart = Date.now();

    // Build system prompt
    const systemPrompt = buildSystemPrompt(this.persona, this.memory);
    this.conversationHistory.push({ role: "system", content: systemPrompt });

    log.info(`agent loop started — persona=${this.persona.handle}, max_turns=${this.config.maxTurns}`);
    this.emitEvent({ type: "session:start" });

    while (this.running) {
      // Check limits
      if (this.turnCount >= this.config.maxTurns) {
        log.info("max turns reached, disconnecting");
        this.conn.disconnect();
        break;
      }

      const elapsedMinutes = (Date.now() - this.sessionStart) / 60000;
      if (elapsedMinutes >= this.config.sessionMinutes) {
        log.info("session time limit reached, disconnecting");
        this.conn.disconnect();
        break;
      }

      if (!this.conn.isConnected()) {
        log.info("connection lost");
        break;
      }

      try {
        await this.tick();
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        log.error(`agent tick error: ${err}`);
        this.emitEvent({ type: "error", error });
        await sleep(2000);
      }
    }

    // Post-session: extract and save structured memories
    await this.extractMemories();
    this.emitEvent({ type: "session:end", reason: "complete" });
  }

  private async tick(): Promise<void> {
    // Wait for BBS to become idle
    const screenText = await this.buffer.waitForIdle();
    if (!screenText.trim()) return;

    this.turnCount++;

    // Log the raw screen
    this.memory.appendSessionLog(this.sessionTimestamp, {
      turn: this.turnCount,
      type: "screen",
      text: screenText,
      timestamp: new Date().toISOString(),
    });

    if (this.config.verbose) {
      log.info(`--- SCREEN (turn ${this.turnCount}) ---\n${screenText.slice(0, 500)}`);
    }

    this.emitEvent({ type: "turn:screen", screenText });

    // Detect [More] prompts — handle without LLM
    if (MORE_PATTERN.test(screenText.trim().slice(-100))) {
      log.debug("auto-handling [More] prompt");
      this.emitEvent({ type: "turn:more" });
      this.conn.sendKey("enter");
      return;
    }

    // Detect stuck-in-loop
    const screenHash = simpleHash(screenText.trim());
    if (screenHash === this.lastScreenHash) {
      this.stuckCounter++;
      if (this.stuckCounter >= 3) {
        log.warn("stuck detected — same screen 3 times, forcing ESC + Enter");
        this.emitEvent({ type: "turn:stuck" });
        this.conn.sendKey("esc");
        await sleep(500);
        this.conn.sendKey("enter");
        this.stuckCounter = 0;
        return;
      }
    } else {
      this.stuckCounter = 0;
      this.lastScreenHash = screenHash;
    }

    // Build user message
    const recentHistory = this.buffer.getHistory(3);
    const userMsg = buildScreenMessage(screenText, recentHistory, this.turnCount);
    this.conversationHistory.push({ role: "user", content: userMsg });

    // Trim conversation history to avoid token limits (keep system + last 20 turns)
    this.trimHistory();

    // Acquire rate limiter token before LLM call
    await this.options.rateLimiter?.acquire();

    // Call LLM
    log.debug(`calling LLM (turn ${this.turnCount}, ${this.conversationHistory.length} messages)`);
    const response = await chatCompletion(
      this.conversationHistory,
      this.config.groqModel,
    );

    // Add assistant response to history
    this.conversationHistory.push({ role: "assistant", content: response });

    // Log the LLM response
    this.memory.appendSessionLog(this.sessionTimestamp, {
      turn: this.turnCount,
      type: "response",
      text: response,
      timestamp: new Date().toISOString(),
    });

    if (this.config.verbose) {
      log.info(`--- LLM RESPONSE ---\n${response}`);
    }

    this.emitEvent({ type: "turn:response", response });

    // Parse and execute actions
    const actions = parseActions(response);
    await this.executeActions(actions);
  }

  private async executeActions(actions: Action[]): Promise<void> {
    for (const action of actions) {
      if (!this.running || !this.conn.isConnected()) break;

      switch (action.type) {
        case "THINKING":
          log.debug(`THINKING: ${action.value.slice(0, 120)}`);
          this.emitEvent({ type: "turn:thinking", thinking: action.value });
          break;

        case "LINE":
          log.info(`LINE: ${action.value}`);
          this.emitEvent({ type: "turn:action", action: { type: "LINE", value: action.value } });
          await typeWithDelay(
            (buf) => this.conn.send(buf),
            action.value,
            this.config.keystrokeMinMs,
            this.config.keystrokeMaxMs,
          );
          await sleep(100);
          this.conn.sendKey("enter");
          break;

        case "TYPE":
          log.info(`TYPE: ${action.value}`);
          this.emitEvent({ type: "turn:action", action: { type: "TYPE", value: action.value } });
          await typeWithDelay(
            (buf) => this.conn.send(buf),
            action.value,
            this.config.keystrokeMinMs,
            this.config.keystrokeMaxMs,
          );
          break;

        case "KEY":
          log.info(`KEY: ${action.value}`);
          this.emitEvent({ type: "turn:action", action: { type: "KEY", value: action.value } });
          this.conn.sendKey(action.value.trim().toLowerCase());
          break;

        case "WAIT":
          const ms = parseInt(action.value.trim(), 10) || 1000;
          log.debug(`WAIT: ${ms}ms`);
          this.emitEvent({ type: "turn:action", action: { type: "WAIT", value: String(ms) } });
          await sleep(ms);
          break;

        case "MEMORY":
          log.info(`MEMORY: ${action.value}`);
          this.memoryNotes.push(action.value);
          this.emitEvent({ type: "memory:note", note: action.value });
          break;

        case "DISCONNECT":
          log.info(`DISCONNECT: ${action.value}`);
          this.emitEvent({ type: "turn:action", action: { type: "DISCONNECT", value: action.value } });
          this.running = false;
          this.conn.disconnect();
          return;
      }

      // Small pause between actions
      if (action.type !== "THINKING" && action.type !== "WAIT") {
        await sleep(200);
      }
    }
  }

  private trimHistory(): void {
    // Keep system prompt + last 16 messages (8 turns)
    // Old screens are already in the LLM's context from prior turns — no need to carry 20
    if (this.conversationHistory.length > 17) {
      const system = this.conversationHistory[0];
      const recent = this.conversationHistory.slice(-16);
      this.conversationHistory = [system, ...recent];
    }
  }

  private async extractMemories(): Promise<void> {
    try {
      this.emitEvent({ type: "memory:extracting" });

      // Append any MEMORY notes so extraction sees them
      if (this.memoryNotes.length > 0) {
        this.conversationHistory.push({
          role: "assistant",
          content: `MEMORY notes from this session:\n${this.memoryNotes.map((n) => `- ${n}`).join("\n")}`,
        });
      }

      // Acquire rate limiter token for extraction LLM call
      await this.options.rateLimiter?.acquire();

      await extractAndSaveMemories(
        this.conversationHistory,
        this.memory,
        this.persona,
        this.config.groqModel,
      );

      this.emitEvent({ type: "memory:extracted" });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      log.error(`failed to extract memories: ${err}`);
      this.emitEvent({ type: "error", error, reason: "memory extraction failed" });
    }
  }
}

function simpleHash(s: string): string {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    const char = s.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return String(hash);
}
