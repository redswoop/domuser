import net from "net";
import { EventEmitter } from "events";
import { getLogger } from "../util/logger.js";

const log = getLogger("telnet");

// RFC 854 telnet commands
const IAC = 0xff;
const DONT = 0xfe;
const DO = 0xfd;
const WONT = 0xfc;
const WILL = 0xfb;
const SB = 0xfa;
const SE = 0xf0;

// Telnet options
const OPT_ECHO = 0x01;
const OPT_SGA = 0x03; // Suppress Go Ahead
const OPT_TTYPE = 0x18; // Terminal Type
const OPT_NAWS = 0x1f; // Negotiate About Window Size
const OPT_LINEMODE = 0x22;

const TTYPE_IS = 0x00;
const TTYPE_SEND = 0x01;

export interface TelnetEvents {
  data: (data: Buffer) => void;
  connect: () => void;
  close: () => void;
  error: (err: Error) => void;
}

export class TelnetConnection extends EventEmitter {
  private socket: net.Socket | null = null;
  private host: string;
  private port: number;
  private connected = false;

  constructor(host: string, port: number) {
    super();
    this.host = host;
    this.port = port;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = net.createConnection({ host: this.host, port: this.port }, () => {
        log.info(`connected to ${this.host}:${this.port}`);
        this.connected = true;
        this.emit("connect");
        resolve();
      });

      this.socket.on("data", (data: Buffer) => {
        const cleaned = this.handleTelnetNegotiation(data);
        if (cleaned.length > 0) {
          this.emit("data", cleaned);
        }
      });

      this.socket.on("close", () => {
        log.info("connection closed");
        this.connected = false;
        this.emit("close");
      });

      this.socket.on("error", (err: Error) => {
        log.error(`connection error: ${err.message}`);
        this.connected = false;
        this.emit("error", err);
        reject(err);
      });

      this.socket.setTimeout(30000, () => {
        log.warn("socket timeout");
        this.socket?.destroy();
      });
    });
  }

  send(data: Buffer): void {
    if (this.socket && this.connected) {
      this.socket.write(data);
    }
  }

  sendLine(text: string): void {
    this.send(Buffer.from(text + "\r\n", "ascii"));
  }

  sendText(text: string): void {
    this.send(Buffer.from(text, "ascii"));
  }

  sendKey(key: string): void {
    const keyMap: Record<string, Buffer> = {
      enter: Buffer.from("\r\n", "ascii"),
      esc: Buffer.from([0x1b]),
      space: Buffer.from(" ", "ascii"),
      backspace: Buffer.from([0x08]),
      tab: Buffer.from([0x09]),
      y: Buffer.from("y", "ascii"),
      n: Buffer.from("n", "ascii"),
      Y: Buffer.from("Y", "ascii"),
      N: Buffer.from("N", "ascii"),
    };
    const buf = keyMap[key] || Buffer.from(key, "ascii");
    this.send(buf);
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.end();
      this.socket.destroy();
      this.connected = false;
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Handle telnet IAC negotiation sequences.
   * Returns the non-telnet data bytes.
   */
  private handleTelnetNegotiation(data: Buffer): Buffer {
    const output: number[] = [];
    let i = 0;

    while (i < data.length) {
      if (data[i] !== IAC) {
        output.push(data[i]);
        i++;
        continue;
      }

      // IAC found
      if (i + 1 >= data.length) break;

      const cmd = data[i + 1];

      // Double IAC = literal 0xFF
      if (cmd === IAC) {
        output.push(IAC);
        i += 2;
        continue;
      }

      // DO / DONT / WILL / WONT
      if (cmd === DO || cmd === DONT || cmd === WILL || cmd === WONT) {
        if (i + 2 >= data.length) break;
        const opt = data[i + 2];
        this.respondToNegotiation(cmd, opt);
        i += 3;
        continue;
      }

      // Subnegotiation
      if (cmd === SB) {
        const seIdx = this.findSE(data, i + 2);
        if (seIdx === -1) break;
        const subData = data.subarray(i + 2, seIdx);
        this.handleSubnegotiation(subData);
        i = seIdx + 2; // skip IAC SE
        continue;
      }

      // Unknown command, skip
      i += 2;
    }

    return Buffer.from(output);
  }

  private findSE(data: Buffer, start: number): number {
    for (let i = start; i < data.length - 1; i++) {
      if (data[i] === IAC && data[i + 1] === SE) {
        return i;
      }
    }
    return -1;
  }

  private respondToNegotiation(cmd: number, opt: number): void {
    if (!this.socket) return;

    const optName = this.optionName(opt);

    if (cmd === DO) {
      // They're asking us to do something
      if (opt === OPT_TTYPE || opt === OPT_NAWS) {
        log.debug(`DO ${optName} → WILL`);
        this.socket.write(Buffer.from([IAC, WILL, opt]));
        if (opt === OPT_NAWS) {
          this.sendNAWS(80, 24);
        }
      } else if (opt === OPT_SGA) {
        log.debug(`DO ${optName} → WILL`);
        this.socket.write(Buffer.from([IAC, WILL, opt]));
      } else {
        log.debug(`DO ${optName} → WONT`);
        this.socket.write(Buffer.from([IAC, WONT, opt]));
      }
    } else if (cmd === WILL) {
      // They will do something
      if (opt === OPT_ECHO || opt === OPT_SGA) {
        log.debug(`WILL ${optName} → DO`);
        this.socket.write(Buffer.from([IAC, DO, opt]));
      } else {
        log.debug(`WILL ${optName} → DONT`);
        this.socket.write(Buffer.from([IAC, DONT, opt]));
      }
    } else if (cmd === WONT) {
      log.debug(`WONT ${optName} → DONT`);
      this.socket.write(Buffer.from([IAC, DONT, opt]));
    } else if (cmd === DONT) {
      log.debug(`DONT ${optName} → WONT`);
      this.socket.write(Buffer.from([IAC, WONT, opt]));
    }
  }

  private handleSubnegotiation(data: Buffer): void {
    if (data.length < 1) return;
    const opt = data[0];

    if (opt === OPT_TTYPE && data.length >= 2 && data[1] === TTYPE_SEND) {
      log.debug("TTYPE subneg → responding with ANSI");
      this.sendTTYPE("ANSI");
    }
  }

  private sendTTYPE(type: string): void {
    if (!this.socket) return;
    const payload = Buffer.alloc(type.length + 4);
    payload[0] = IAC;
    payload[1] = SB;
    payload[2] = OPT_TTYPE;
    payload[3] = TTYPE_IS;
    Buffer.from(type, "ascii").copy(payload, 4);
    const footer = Buffer.from([IAC, SE]);
    this.socket.write(Buffer.concat([payload, footer]));
  }

  private sendNAWS(cols: number, rows: number): void {
    if (!this.socket) return;
    const buf = Buffer.from([
      IAC, SB, OPT_NAWS,
      (cols >> 8) & 0xff, cols & 0xff,
      (rows >> 8) & 0xff, rows & 0xff,
      IAC, SE,
    ]);
    this.socket.write(buf);
    log.debug(`NAWS → ${cols}x${rows}`);
  }

  private optionName(opt: number): string {
    const names: Record<number, string> = {
      [OPT_ECHO]: "ECHO",
      [OPT_SGA]: "SGA",
      [OPT_TTYPE]: "TTYPE",
      [OPT_NAWS]: "NAWS",
      [OPT_LINEMODE]: "LINEMODE",
    };
    return names[opt] || `0x${opt.toString(16)}`;
  }
}
