import { EventEmitter } from "events";
import type { Persona, Schedule } from "../persona/types.js";
import type { SimClock } from "./sim-clock.js";
import type { ScheduledSession } from "./types.js";
import { getLogger } from "../util/logger.js";

const log = getLogger("scheduler");

/** Default schedule for personas that don't define one. */
const DEFAULT_SCHEDULE: Schedule = {
  active_hours: [{ start: 8, end: 22, weight: 1 }],
  sessions_per_day: 2,
  min_gap_minutes: 60,
  jitter_minutes: 15,
};

/**
 * Session scheduler — generates session plans for each sim day based on
 * persona schedules, then waits for each scheduled time and emits events.
 */
export class SessionScheduler extends EventEmitter {
  private clock: SimClock;
  private personas: Persona[];
  private running = false;
  private currentDayPlan: ScheduledSession[] = [];
  private lastScheduledDayKey = "";
  private lastSessionTimes = new Map<string, number>(); // handle → last sim time

  constructor(clock: SimClock, personas: Persona[]) {
    super();
    this.clock = clock;
    this.personas = personas;
  }

  /** Start the scheduling loop. Runs until stop() is called. */
  async start(): Promise<void> {
    this.running = true;
    log.info(`scheduler started with ${this.personas.length} personas`);

    while (this.running) {
      // Wait for resume if paused
      if (this.clock.isPaused()) {
        await this.clock.waitForResume();
        if (!this.running) break;
      }

      const now = this.clock.now();
      const dayKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;

      // Generate new day plan if needed
      if (dayKey !== this.lastScheduledDayKey) {
        this.currentDayPlan = this.generateDayPlan(now);
        this.lastScheduledDayKey = dayKey;
        log.info(`generated plan for ${now.toDateString()}: ${this.currentDayPlan.length} sessions`);
        for (const s of this.currentDayPlan) {
          log.debug(`  ${s.personaHandle} @ ${s.scheduledSimTime.toLocaleTimeString()}`);
        }
      }

      // Find next session (>= because turbo may jump clock to exact session time)
      const nextSession = this.currentDayPlan.find(
        (s) => s.scheduledSimTime.getTime() >= now.getTime(),
      );

      if (!nextSession) {
        // No more sessions today — advance to next day midnight
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 0, 0);
        log.debug(`no more sessions today, advancing to ${tomorrow.toDateString()}`);
        await this.clock.waitUntil(tomorrow);
        // Yield to event loop to prevent tight spin in turbo with failing connections
        await new Promise((r) => setTimeout(r, 50));
        continue;
      }

      // Wait for next session time
      await this.clock.waitUntil(nextSession.scheduledSimTime);
      if (!this.running) break;

      // Wait for resume if paused
      if (this.clock.isPaused()) {
        await this.clock.waitForResume();
        if (!this.running) break;
      }

      // Track last session time for gap enforcement
      this.lastSessionTimes.set(
        nextSession.personaHandle,
        nextSession.scheduledSimTime.getTime(),
      );

      log.info(`session due: ${nextSession.personaHandle} @ ${nextSession.scheduledSimTime.toLocaleTimeString()}`);
      this.emit("session:due", nextSession);

      // Remove from plan so we don't re-emit
      const idx = this.currentDayPlan.indexOf(nextSession);
      if (idx >= 0) this.currentDayPlan.splice(idx, 1);

      // Yield to let session manager process the enqueue
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  /** Stop the scheduling loop. */
  stop(): void {
    this.running = false;
  }

  /** Get the remaining plan for the current day. */
  getRemainingPlan(): ScheduledSession[] {
    return [...this.currentDayPlan];
  }

  /**
   * Generate a day plan: distribute sessions across active hours for each persona.
   */
  private generateDayPlan(day: Date): ScheduledSession[] {
    const sessions: ScheduledSession[] = [];
    const dayOfWeek = day.getDay(); // 0=Sun

    for (const persona of this.personas) {
      const schedule = persona.schedule ?? DEFAULT_SCHEDULE;

      // Check active days
      if (schedule.active_days && !schedule.active_days.includes(dayOfWeek)) {
        continue;
      }

      const personaSessions = this.generatePersonaSessions(persona, schedule, day);
      sessions.push(...personaSessions);
    }

    // Sort all sessions by scheduled time
    sessions.sort((a, b) => a.scheduledSimTime.getTime() - b.scheduledSimTime.getTime());
    return sessions;
  }

  /**
   * For a single persona, distribute sessions_per_day across active_hours windows,
   * weighted by the window weights.
   */
  private generatePersonaSessions(
    persona: Persona,
    schedule: Schedule,
    day: Date,
  ): ScheduledSession[] {
    const sessions: ScheduledSession[] = [];
    const sessionsPerDay = schedule.sessions_per_day;

    // Expand active hours into minute ranges with weights
    const windows: Array<{ startMin: number; endMin: number; weight: number }> = [];
    for (const ah of schedule.active_hours) {
      let startMin = ah.start * 60;
      let endMin = ah.end * 60;
      // Handle wrap-around (e.g., 21:00 to 01:00)
      if (endMin <= startMin) {
        endMin += 24 * 60;
      }
      windows.push({ startMin, endMin, weight: ah.weight });
    }

    // Calculate total weighted minutes
    const totalWeightedMinutes = windows.reduce(
      (sum, w) => sum + (w.endMin - w.startMin) * w.weight,
      0,
    );

    if (totalWeightedMinutes === 0) return sessions;

    // Distribute sessions across windows proportionally to weight
    const sessionSlots: number[] = []; // minutes from midnight
    let sessionsRemaining = sessionsPerDay;

    for (const window of windows) {
      const windowMinutes = window.endMin - window.startMin;
      const windowShare = (windowMinutes * window.weight) / totalWeightedMinutes;
      let windowSessions = Math.round(sessionsPerDay * windowShare);

      // Don't exceed remaining
      windowSessions = Math.min(windowSessions, sessionsRemaining);
      if (windowSessions === 0 && sessionsRemaining > 0 && window === windows[windows.length - 1]) {
        windowSessions = sessionsRemaining; // Give remaining to last window
      }

      // Spread sessions evenly within window
      const gap = windowMinutes / (windowSessions + 1);
      for (let i = 0; i < windowSessions; i++) {
        const minuteInWindow = gap * (i + 1);
        const minuteOfDay = window.startMin + minuteInWindow;

        // Add jitter
        const jitter = (Math.random() - 0.5) * 2 * schedule.jitter_minutes;
        const finalMinute = Math.max(window.startMin, Math.min(window.endMin, minuteOfDay + jitter));

        sessionSlots.push(finalMinute);
      }

      sessionsRemaining -= windowSessions;
    }

    // Enforce min_gap_minutes between consecutive sessions
    sessionSlots.sort((a, b) => a - b);
    const filtered: number[] = [];
    for (const slot of sessionSlots) {
      const lastSlot = filtered[filtered.length - 1];
      if (lastSlot === undefined || slot - lastSlot >= schedule.min_gap_minutes) {
        filtered.push(slot);
      } else {
        // Push this session later
        const pushed = lastSlot + schedule.min_gap_minutes;
        filtered.push(pushed);
      }
    }

    // Convert to Date objects
    for (const minuteOfDay of filtered) {
      const hours = Math.floor(minuteOfDay / 60) % 24;
      const minutes = Math.floor(minuteOfDay % 60);
      const scheduled = new Date(day);
      scheduled.setHours(hours, minutes, 0, 0);

      // If wrap-around pushed us to next day, adjust
      if (minuteOfDay >= 24 * 60) {
        scheduled.setDate(scheduled.getDate() + 1);
        scheduled.setHours(hours, minutes, 0, 0);
      }

      sessions.push({
        personaHandle: persona.handle,
        persona,
        scheduledSimTime: scheduled,
      });
    }

    return sessions;
  }
}

function getDayOfYear(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 0);
  const diff = date.getTime() - start.getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}
