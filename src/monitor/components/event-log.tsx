import React from "react";
import { Box, Text } from "ink";
import type { AgentEvent } from "../../agent/events.js";
import type { SimClock } from "../../orchestrate/sim-clock.js";

interface EventLogProps {
  events: AgentEvent[];
  clock: SimClock;
  maxLines: number;
}

const EVENT_COLORS: Record<string, string> = {
  "session:start": "green",
  "session:end": "cyan",
  "turn:action": "white",
  "turn:thinking": "gray",
  "turn:more": "gray",
  "turn:stuck": "yellow",
  "memory:note": "yellow",
  "memory:extracting": "cyan",
  "memory:extracted": "green",
  "error": "red",
};

export function EventLog({ events, clock, maxLines }: EventLogProps) {
  const visible = events.slice(-maxLines);

  return (
    <Box flexDirection="column">
      <Text bold dimColor>Events</Text>
      {visible.map((event, i) => {
        const time = new Date(event.timestamp).toLocaleTimeString("en-US", { hour12: false });
        const color = EVENT_COLORS[event.type] ?? "white";
        const summary = formatEvent(event);
        return (
          <Text key={i} color={color} wrap="truncate">
            {time} {pad(event.personaHandle, 14)} {summary}
          </Text>
        );
      })}
      {visible.length === 0 && (
        <Text dimColor>  (no events yet)</Text>
      )}
    </Box>
  );
}

function formatEvent(event: AgentEvent): string {
  switch (event.type) {
    case "session:start":
      return "session started";
    case "session:end":
      return `session ended${event.reason ? ` (${event.reason})` : ""}`;
    case "turn:action":
      return event.action
        ? `${event.action.type}: ${event.action.value.slice(0, 60)}`
        : "action";
    case "turn:thinking":
      return `thinking: ${event.thinking?.slice(0, 60) ?? ""}`;
    case "turn:more":
      return "[More] auto-handled";
    case "turn:stuck":
      return "stuck — sending ESC+Enter";
    case "memory:note":
      return `note: ${event.note?.slice(0, 60) ?? ""}`;
    case "memory:extracting":
      return "extracting memories...";
    case "memory:extracted":
      return "memories saved";
    case "error":
      return `ERROR: ${event.error?.message ?? event.reason ?? "unknown"}`;
    default:
      return event.type;
  }
}

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length);
}
