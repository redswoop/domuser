import React from "react";
import { Box, Text } from "ink";
import type { SessionManager } from "../../orchestrate/session-manager.js";
import type { AgentEvent } from "../../agent/events.js";

interface AgentDetailProps {
  personaHandle: string;
  sessionManager: SessionManager;
  events: AgentEvent[];
  tick: number;
}

export function AgentDetail({ personaHandle, sessionManager, events, tick }: AgentDetailProps) {
  const activeSessions = sessionManager.getActiveSessions();
  const session = activeSessions.find((s) => s.personaHandle === personaHandle);

  // Get recent events for this persona
  const personaEvents = events
    .filter((e) => e.personaHandle === personaHandle)
    .slice(-30);

  // Extract screen and thinking from events
  const lastScreen = session?.currentScreen ?? "";
  const recentThinking = personaEvents
    .filter((e) => e.type === "turn:thinking" || e.type === "turn:action" || e.type === "memory:note")
    .slice(-10);

  return (
    <Box flexDirection="column" width="100%">
      {/* Header */}
      <Box marginBottom={1}>
        <Text bold color="cyan">{personaHandle}</Text>
        {session && (
          <>
            <Text> | Turn {session.turnCount} | </Text>
            <Text color="green">{session.status}</Text>
          </>
        )}
        {!session && <Text dimColor> | no active session</Text>}
      </Box>

      <Box flexDirection="row" width="100%">
        {/* BBS Screen — left side */}
        <Box flexDirection="column" width={82} borderStyle="single" borderColor="gray" paddingX={1}>
          <Text bold dimColor>BBS Screen</Text>
          <Text>{lastScreen || "(no screen data)"}</Text>
        </Box>

        {/* Thinking/actions — right side */}
        <Box flexDirection="column" flexGrow={1} marginLeft={1}>
          <Text bold dimColor>Agent Log</Text>
          {recentThinking.map((e, i) => {
            if (e.type === "turn:thinking") {
              return (
                <Text key={i} color="gray" wrap="truncate">
                  [think] {e.thinking?.slice(0, 100)}
                </Text>
              );
            }
            if (e.type === "turn:action" && e.action) {
              return (
                <Text key={i} color="green" wrap="truncate">
                  [{e.action.type}] {e.action.value.slice(0, 80)}
                </Text>
              );
            }
            if (e.type === "memory:note") {
              return (
                <Text key={i} color="yellow" wrap="truncate">
                  [mem] {e.note?.slice(0, 80)}
                </Text>
              );
            }
            return null;
          })}
          {recentThinking.length === 0 && (
            <Text dimColor>(waiting for events)</Text>
          )}
        </Box>
      </Box>
    </Box>
  );
}
