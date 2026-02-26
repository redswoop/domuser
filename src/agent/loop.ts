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
import { getLogger } from "../util/logger.js";

const log = getLogger("agent");

// Pattern for [More] / pause prompts that don't need LLM reasoning
const MORE_PATTERN = /\[More[:\s]*[\])]|Continue\s*\[Y\/n\]|Press\s+(?:ENTER|any key|RETURN)\s+to\s+continue|pause/i;

export class AgentLoop {
  private conn: TelnetConnection;
  private buffer: TerminalBuffer;
  private memory: MemoryStore;
  private persona: Persona;
  private config: AppConfig;
  private sessionTimestamp: string;

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
  ) {
    this.conn = conn;
    this.buffer = buffer;
    this.memory = memory;
    this.persona = persona;
    this.config = config;
    this.sessionTimestamp = new Date().toISOString().replace(/[:.]/g, "-");
  }

  async run(): Promise<void> {
    this.running = true;
    this.sessionStart = Date.now();

    // Build system prompt
    const systemPrompt = buildSystemPrompt(this.persona, this.memory);
    this.conversationHistory.push({ role: "system", content: systemPrompt });

    log.info(`agent loop started — persona=${this.persona.handle}, max_turns=${this.config.maxTurns}`);

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
        log.error(`agent tick error: ${err}`);
        await sleep(2000);
      }
    }

    // Post-session: extract and save structured memories
    await this.extractMemories();
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

    // Detect [More] prompts — handle without LLM
    if (MORE_PATTERN.test(screenText.trim().slice(-100))) {
      log.debug("auto-handling [More] prompt");
      this.conn.sendKey("enter");
      return;
    }

    // Detect stuck-in-loop
    const screenHash = simpleHash(screenText.trim());
    if (screenHash === this.lastScreenHash) {
      this.stuckCounter++;
      if (this.stuckCounter >= 3) {
        log.warn("stuck detected — same screen 3 times, forcing ESC + Enter");
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
          break;

        case "LINE":
          log.info(`LINE: ${action.value}`);
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
          await typeWithDelay(
            (buf) => this.conn.send(buf),
            action.value,
            this.config.keystrokeMinMs,
            this.config.keystrokeMaxMs,
          );
          break;

        case "KEY":
          log.info(`KEY: ${action.value}`);
          this.conn.sendKey(action.value.trim().toLowerCase());
          break;

        case "WAIT":
          const ms = parseInt(action.value.trim(), 10) || 1000;
          log.debug(`WAIT: ${ms}ms`);
          await sleep(ms);
          break;

        case "MEMORY":
          log.info(`MEMORY: ${action.value}`);
          this.memoryNotes.push(action.value);
          break;

        case "DISCONNECT":
          log.info(`DISCONNECT: ${action.value}`);
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
    // Keep system prompt + last 40 messages (20 turns)
    if (this.conversationHistory.length > 41) {
      const system = this.conversationHistory[0];
      const recent = this.conversationHistory.slice(-40);
      this.conversationHistory = [system, ...recent];
    }
  }

  private async extractMemories(): Promise<void> {
    try {
      // Append any MEMORY notes so extraction sees them
      if (this.memoryNotes.length > 0) {
        this.conversationHistory.push({
          role: "assistant",
          content: `MEMORY notes from this session:\n${this.memoryNotes.map((n) => `- ${n}`).join("\n")}`,
        });
      }
      await extractAndSaveMemories(
        this.conversationHistory,
        this.memory,
        this.persona,
        this.config.groqModel,
      );
    } catch (err) {
      log.error(`failed to extract memories: ${err}`);
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
