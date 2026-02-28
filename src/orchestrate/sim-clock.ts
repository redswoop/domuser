import { EventEmitter } from "events";
import { getLogger } from "../util/logger.js";

const log = getLogger("sim-clock");

/**
 * Virtual simulation clock. Tracks historical time starting from a configurable
 * date (default: 1996-09-14). Supports speed control:
 *   - speed=0 (turbo): waitUntil resolves instantly, clock jumps forward
 *   - speed=1 (realtime): real sleep for real-time equivalent
 *   - speed=N: sleep is divided by N
 *
 * When a live BBS session is active, effective speed is forced to 1 (real-time)
 * since the BBS doesn't know about our sim clock.
 */
export class SimClock extends EventEmitter {
  private baseSimTime: number;
  private baseRealTime: number;
  private configuredSpeed: number;
  private activeSessions = 0;
  private paused = false;
  private pauseResolvers: Array<() => void> = [];

  constructor(simStart: Date, speed: number = 1) {
    super();
    this.baseSimTime = simStart.getTime();
    this.baseRealTime = Date.now();
    this.configuredSpeed = speed;
  }

  /** Current simulated time. */
  now(): Date {
    const effectiveSpeed = this.effectiveSpeed();
    if (effectiveSpeed === 0) {
      // In turbo with no sessions, sim time is wherever we last jumped to
      return new Date(this.baseSimTime);
    }
    const realElapsed = Date.now() - this.baseRealTime;
    const simElapsed = realElapsed * effectiveSpeed;
    return new Date(this.baseSimTime + simElapsed);
  }

  /** Get configured speed setting. */
  getSpeed(): number {
    return this.configuredSpeed;
  }

  /** Get the effective speed (1 when sessions active, configured otherwise). */
  effectiveSpeed(): number {
    if (this.activeSessions > 0) return 1;
    return this.configuredSpeed;
  }

  /** Change simulation speed. Reanchors the clock. */
  setSpeed(speed: number): void {
    this.reanchor();
    this.configuredSpeed = speed;
    log.info(`sim speed set to ${speed === 0 ? "turbo" : speed + "x"}`);
    this.emit("speed:change", speed);
  }

  /** Returns true if paused. */
  isPaused(): boolean {
    return this.paused;
  }

  /** Pause scheduling. Active sessions continue but no new ones start. */
  pause(): void {
    this.paused = true;
    this.emit("paused");
  }

  /** Resume scheduling. */
  resume(): void {
    this.paused = false;
    // Wake up anyone waiting on the pause
    for (const resolve of this.pauseResolvers) {
      resolve();
    }
    this.pauseResolvers = [];
    this.emit("resumed");
  }

  /** Wait until the pause is lifted (resolves immediately if not paused). */
  waitForResume(): Promise<void> {
    if (!this.paused) return Promise.resolve();
    return new Promise((resolve) => {
      this.pauseResolvers.push(resolve);
    });
  }

  /**
   * The core scheduling primitive.
   * Wait until simulated time reaches `targetSimTime`.
   *
   * - turbo (speed=0): resolve immediately, jump clock to target
   * - realtime (speed=1): sleep the real-time difference
   * - Nx: sleep is divided by N
   */
  async waitUntil(targetSimTime: Date): Promise<void> {
    // If paused, wait for resume first
    if (this.paused) {
      await this.waitForResume();
    }

    const speed = this.effectiveSpeed();

    if (speed === 0) {
      // Turbo: jump clock forward instantly
      this.baseSimTime = targetSimTime.getTime();
      this.baseRealTime = Date.now();
      return;
    }

    const currentSim = this.now();
    const simDeltaMs = targetSimTime.getTime() - currentSim.getTime();

    if (simDeltaMs <= 0) return; // Already past this time

    const realWaitMs = simDeltaMs / speed;
    log.debug(`waitUntil: ${targetSimTime.toISOString()} — real wait ${Math.round(realWaitMs / 1000)}s`);

    await this.interruptibleSleep(realWaitMs);
  }

  /** Notify that a live BBS session has started. Forces effective speed to 1. */
  sessionStarted(): void {
    if (this.activeSessions === 0) {
      this.reanchor(); // Capture current sim time before speed change
    }
    this.activeSessions++;
    log.debug(`session started — ${this.activeSessions} active (effective speed: 1x)`);
  }

  /** Notify that a live BBS session has ended. Restores configured speed when all done. */
  sessionEnded(): void {
    this.activeSessions = Math.max(0, this.activeSessions - 1);
    if (this.activeSessions === 0) {
      this.reanchor(); // Recapture before speed change
      log.debug(`all sessions ended — restoring speed ${this.configuredSpeed === 0 ? "turbo" : this.configuredSpeed + "x"}`);
    } else {
      log.debug(`session ended — ${this.activeSessions} still active`);
    }
  }

  /** Number of active sessions. */
  getActiveSessions(): number {
    return this.activeSessions;
  }

  /**
   * Reanchor: snapshot current sim time and real time so speed changes
   * don't cause time jumps.
   */
  private reanchor(): void {
    const currentSim = this.now();
    this.baseSimTime = currentSim.getTime();
    this.baseRealTime = Date.now();
  }

  /** Sleep that can be interrupted by dispose. */
  private interruptibleSleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, Math.min(ms, 2147483647)); // Cap at max 32-bit
      if (timer.unref) timer.unref();
    });
  }
}
