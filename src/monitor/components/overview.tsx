import React from "react";
import { Box, Text } from "ink";
import type { SessionManager } from "../../orchestrate/session-manager.js";
import type { SessionScheduler } from "../../orchestrate/scheduler.js";
import type { Persona } from "../../persona/types.js";
import type { SessionInfo } from "../../orchestrate/types.js";

interface OverviewProps {
  sessionManager: SessionManager;
  scheduler: SessionScheduler;
  personas: Persona[];
  tick: number;
}

const STATUS_COLORS: Record<string, string> = {
  queued: "gray",
  connecting: "yellow",
  active: "green",
  extracting: "cyan",
  done: "gray",
  error: "red",
};

export function Overview({ sessionManager, scheduler, personas, tick }: OverviewProps) {
  const activeSessions = sessionManager.getActiveSessions();
  const allSessions = sessionManager.getAllSessions();
  const remainingPlan = scheduler.getRemainingPlan();

  // Build per-persona status
  const rows = personas.map((persona) => {
    // Find active/recent session for this persona
    const active = activeSessions.find((s) => s.personaHandle === persona.handle);
    const recent = allSessions
      .filter((s) => s.personaHandle === persona.handle)
      .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))[0];

    const session = active || recent;

    // Find next scheduled
    const nextScheduled = remainingPlan.find((s) => s.personaHandle === persona.handle);

    return {
      handle: persona.handle,
      name: persona.name,
      archetype: persona.archetype,
      status: session?.status ?? "idle",
      turns: session?.turnCount ?? 0,
      lastAction: session?.lastAction ?? "",
      nextSession: nextScheduled
        ? nextScheduled.scheduledSimTime.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit" })
        : "-",
    };
  });

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box>
        <Text bold>
          {"  "}
          {pad("Handle", 16)}
          {pad("Status", 12)}
          {pad("Turns", 7)}
          {pad("Last Action", 40)}
          {pad("Next", 8)}
        </Text>
      </Box>
      <Text dimColor>{"  " + "─".repeat(83)}</Text>

      {/* Rows */}
      {rows.map((row, i) => {
        const statusColor = STATUS_COLORS[row.status] ?? "white";
        return (
          <Box key={row.handle}>
            <Text bold color="yellow">{`${i + 1} `}</Text>
            <Text bold>{pad(row.handle, 16)}</Text>
            <Text color={statusColor}>{pad(row.status, 12)}</Text>
            <Text>{pad(String(row.turns), 7)}</Text>
            <Text dimColor>{pad(row.lastAction.slice(0, 40), 40)}</Text>
            <Text color="cyan">{pad(row.nextSession, 8)}</Text>
          </Box>
        );
      })}

      {rows.length === 0 && (
        <Text dimColor>{"  No personas loaded"}</Text>
      )}
    </Box>
  );
}

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length);
}
