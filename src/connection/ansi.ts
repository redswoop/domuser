import iconv from "iconv-lite";
import { Terminal } from "@xterm/headless";

/**
 * Decode CP437 bytes (standard BBS character set) to UTF-8 string.
 */
export function decodeCP437(buf: Buffer): string {
  return iconv.decode(buf, "cp437");
}

/**
 * Virtual terminal emulator — interprets ANSI/VT100 escape codes
 * and maintains an 80x24 screen buffer, just like a real terminal.
 */
export class VirtualTerminal {
  private term: Terminal;

  constructor(cols: number = 80, rows: number = 24) {
    this.term = new Terminal({ cols, rows, scrollback: 100 });
  }

  /**
   * Feed raw BBS data (already decoded from CP437 to UTF-8).
   * Returns a promise that resolves when parsing is complete.
   */
  write(data: string): Promise<void> {
    return new Promise((resolve) => {
      this.term.write(data, resolve);
    });
  }

  /**
   * Feed raw bytes — decodes CP437 then writes to terminal.
   */
  async writeBytes(buf: Buffer): Promise<void> {
    const text = decodeCP437(buf);
    await this.write(text);
  }

  /**
   * Read the current screen as plain text (80x24 grid).
   * Trailing whitespace on each line is trimmed.
   * Blank trailing lines are removed.
   */
  getScreen(): string {
    const buf = this.term.buffer.active;
    const lines: string[] = [];

    for (let y = 0; y < this.term.rows; y++) {
      const line = buf.getLine(y);
      lines.push(line ? line.translateToString(true) : "");
    }

    // Trim blank trailing lines
    while (lines.length > 0 && lines[lines.length - 1] === "") {
      lines.pop();
    }

    return lines.join("\n");
  }

  /**
   * Get just the last N non-empty lines (useful for detecting prompts).
   */
  getTail(n: number = 5): string {
    const screen = this.getScreen();
    const lines = screen.split("\n").filter((l) => l.trim());
    return lines.slice(-n).join("\n");
  }

  /**
   * Get cursor position.
   */
  getCursor(): { row: number; col: number } {
    const buf = this.term.buffer.active;
    return { row: buf.cursorY, col: buf.cursorX };
  }

  dispose(): void {
    this.term.dispose();
  }
}
