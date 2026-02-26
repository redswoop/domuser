import { VirtualTerminal, decodeCP437 } from "../connection/ansi.js";
import { getLogger } from "./logger.js";

const log = getLogger("buffer");

// Patterns that indicate the BBS is waiting for input
const PROMPT_PATTERNS = [
  /\?\s*$/,
  /:\s*$/,
  />\s*$/,
  /\[Y\/n\]/i,
  /\[y\/N\]/i,
  /\[More\]/i,
  /\[Enter\]/i,
  /Command\s*[:>]\s*$/i,
  /Selection\s*[:>]\s*$/i,
  /choice\s*[:>]\s*$/i,
  /\(\d+\s*min\s*left\)/i,
  /Press\s+\S+\s+to\s+continue/i,
  /password\s*[:>]\s*$/i,
  /login\s*[:>]\s*$/i,
  /name\s*[:>]\s*$/i,
  /handle\s*[:>]\s*$/i,
];

export class TerminalBuffer {
  private vt: VirtualTerminal;
  private dirty = false;
  private lastDataTime = 0;
  private idleTimeoutMs: number;
  private resolveIdle: ((text: string) => void) | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private lastScreen = "";

  // Keep a rolling history of screens for context
  private screenHistory: string[] = [];
  private maxHistory = 40;

  constructor(idleTimeoutMs: number) {
    this.idleTimeoutMs = idleTimeoutMs;
    this.vt = new VirtualTerminal(80, 24);
  }

  /**
   * Feed raw bytes from the telnet connection.
   * The virtual terminal interprets all escape codes and updates
   * its internal 80x24 screen buffer.
   */
  feed(data: Buffer): void {
    const text = decodeCP437(data);
    // Write synchronously — xterm processes inline, callback is for notification
    this.vt.write(text);
    this.dirty = true;
    this.lastDataTime = Date.now();

    // Reset idle timer
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }

    // Check for immediate prompt patterns on the rendered screen
    if (this.resolveIdle && this.hasPromptPattern()) {
      // Give a tiny extra wait for any trailing data
      this.idleTimer = setTimeout(() => this.flushToWaiter(), 300);
      return;
    }

    // Set idle timer
    if (this.resolveIdle) {
      this.idleTimer = setTimeout(() => this.flushToWaiter(), this.idleTimeoutMs);
    }
  }

  /**
   * Wait for the BBS to become idle (ready for input).
   * Returns the current rendered screen content.
   */
  waitForIdle(): Promise<string> {
    return new Promise((resolve) => {
      // If we have new data and it's been idle
      if (this.dirty && Date.now() - this.lastDataTime > this.idleTimeoutMs) {
        resolve(this.snapshot());
        return;
      }

      this.resolveIdle = resolve;
      this.idleTimer = setTimeout(() => this.flushToWaiter(), this.idleTimeoutMs);
    });
  }

  /**
   * Get the current rendered screen without consuming it.
   */
  peek(): string {
    return this.vt.getScreen();
  }

  /**
   * Get recent screen history for context building.
   */
  getHistory(count?: number): string[] {
    const n = count ?? this.maxHistory;
    return this.screenHistory.slice(-n);
  }

  /**
   * Get history as a single string for the LLM prompt.
   */
  getHistoryText(count?: number): string {
    return this.getHistory(count).join("\n---\n");
  }

  private hasPromptPattern(): boolean {
    // Check the last few lines of the rendered screen
    const tail = this.vt.getTail(3);
    return PROMPT_PATTERNS.some((p) => p.test(tail));
  }

  /**
   * Take a snapshot of the current screen, add to history if changed.
   */
  private snapshot(): string {
    const screen = this.vt.getScreen();
    this.dirty = false;

    if (screen.trim() && screen !== this.lastScreen) {
      this.lastScreen = screen;
      this.screenHistory.push(screen);
      if (this.screenHistory.length > this.maxHistory) {
        this.screenHistory.shift();
      }
    }

    return screen;
  }

  private flushToWaiter(): void {
    if (this.resolveIdle) {
      const resolve = this.resolveIdle;
      this.resolveIdle = null;
      this.idleTimer = null;
      resolve(this.snapshot());
    }
  }

  /**
   * Clear everything. Used on disconnect.
   */
  reset(): void {
    this.dirty = false;
    this.lastScreen = "";
    this.screenHistory = [];
    this.vt.dispose();
    this.vt = new VirtualTerminal(80, 24);
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (this.resolveIdle) {
      this.resolveIdle("");
      this.resolveIdle = null;
    }
  }
}
