import React, { useState, useEffect, useCallback } from "react";
import { render, Box, Text, useInput, useApp } from "ink";
import { StatusBar } from "./components/status-bar.js";
import { Overview } from "./components/overview.js";
import { AgentDetail } from "./components/agent-detail.js";
import { EventLog } from "./components/event-log.js";
import type { SimClock } from "../orchestrate/sim-clock.js";
import type { RateLimiter } from "../llm/rate-limiter.js";
import type { SessionScheduler } from "../orchestrate/scheduler.js";
import type { SessionManager } from "../orchestrate/session-manager.js";
import type { Persona } from "../persona/types.js";
import type { OrchestrateConfig } from "../orchestrate/types.js";
import type { AgentEvent } from "../agent/events.js";

const MAX_EVENTS = 200;
const EVENT_LOG_LINES = 12;

export interface MonitorProps {
  clock: SimClock;
  rateLimiter: RateLimiter;
  scheduler: SessionScheduler;
  sessionManager: SessionManager;
  personas: Persona[];
  config: OrchestrateConfig;
  onSpeedChange: (speed: number) => void;
  onPauseToggle: () => void;
  onShutdown: () => void;
}

function Monitor({
  clock,
  rateLimiter,
  scheduler,
  sessionManager,
  personas,
  config,
  onSpeedChange,
  onPauseToggle,
  onShutdown,
}: MonitorProps) {
  const { exit } = useApp();
  const [view, setView] = useState<"overview" | "detail">("overview");
  const [focusedPersona, setFocusedPersona] = useState<string>("");
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [tick, setTick] = useState(0);

  // Refresh timer — update display every second
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  // Subscribe to agent events
  useEffect(() => {
    const handler = (event: AgentEvent) => {
      setEvents((prev) => {
        const next = [...prev, event];
        return next.length > MAX_EVENTS ? next.slice(-MAX_EVENTS) : next;
      });
    };
    sessionManager.on("agent:event", handler);
    return () => {
      sessionManager.off("agent:event", handler);
    };
  }, [sessionManager]);

  // Keyboard input
  useInput(useCallback((input: string, key: { escape?: boolean }) => {
    // Number keys: focus on persona
    const num = parseInt(input, 10);
    if (num >= 1 && num <= personas.length) {
      setFocusedPersona(personas[num - 1].handle);
      setView("detail");
      return;
    }

    // Overview
    if (input === "o" || key.escape) {
      setView("overview");
      return;
    }

    // Speed controls
    if (input === "+") {
      const current = clock.getSpeed();
      onSpeedChange(current === 0 ? 1 : Math.min(current * 2, 1024));
      return;
    }
    if (input === "-") {
      const current = clock.getSpeed();
      if (current <= 1) {
        onSpeedChange(1);
      } else {
        onSpeedChange(Math.max(1, current / 2));
      }
      return;
    }
    if (input === "0") {
      onSpeedChange(clock.getSpeed() === 0 ? 1 : 0);
      return;
    }

    // Pause
    if (input === "p") {
      onPauseToggle();
      return;
    }

    // Quit
    if (input === "q") {
      onShutdown();
      exit();
      return;
    }
  }, [clock, personas, onSpeedChange, onPauseToggle, onShutdown, exit]));

  return (
    <Box flexDirection="column" width="100%">
      {/* Status bar */}
      <Box borderStyle="single" borderColor="blue" paddingX={1}>
        <StatusBar
          clock={clock}
          rateLimiter={rateLimiter}
          sessionManager={sessionManager}
          config={config}
          tick={tick}
        />
      </Box>

      {/* Main content */}
      <Box flexDirection="column" flexGrow={1} marginTop={1}>
        {view === "overview" ? (
          <Overview
            sessionManager={sessionManager}
            scheduler={scheduler}
            personas={personas}
            tick={tick}
          />
        ) : (
          <AgentDetail
            personaHandle={focusedPersona}
            sessionManager={sessionManager}
            events={events}
            tick={tick}
          />
        )}
      </Box>

      {/* Event log */}
      <Box marginTop={1}>
        <EventLog events={events} clock={clock} maxLines={EVENT_LOG_LINES} />
      </Box>

      {/* Help footer */}
      <Box marginTop={1}>
        <Text dimColor>
          {view === "overview" ? "[1-9] focus agent  " : "[o/Esc] overview  "}
          [+/-] speed  [0] turbo  [p] pause  [q] quit
        </Text>
      </Box>
    </Box>
  );
}

/**
 * Start the monitor TUI. Returns a cleanup function.
 */
export function startMonitor(props: MonitorProps): () => void {
  const instance = render(<Monitor {...props} />);
  return () => {
    instance.unmount();
  };
}
