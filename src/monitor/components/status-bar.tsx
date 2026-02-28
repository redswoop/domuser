import React from "react";
import { Box, Text } from "ink";
import type { SimClock } from "../../orchestrate/sim-clock.js";
import type { RateLimiter } from "../../llm/rate-limiter.js";
import type { SessionManager } from "../../orchestrate/session-manager.js";
import type { OrchestrateConfig } from "../../orchestrate/types.js";

interface StatusBarProps {
  clock: SimClock;
  rateLimiter: RateLimiter;
  sessionManager: SessionManager;
  config: OrchestrateConfig;
  tick: number;  // force re-render
}

export function StatusBar({ clock, rateLimiter, sessionManager, config, tick }: StatusBarProps) {
  const simTime = clock.now();
  const speed = clock.getSpeed();
  const effectiveSpeed = clock.effectiveSpeed();
  const paused = clock.isPaused();

  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const simDate = `${dayNames[simTime.getDay()]} ${simTime.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })}`;
  const simTimeStr = simTime.toLocaleTimeString("en-US", { hour12: false });

  const speedLabel = paused
    ? "PAUSED"
    : speed === 0
    ? `TURBO${effectiveSpeed === 1 ? " (1x live)" : ""}`
    : `${speed}x${effectiveSpeed !== speed ? ` (eff: ${effectiveSpeed}x)` : ""}`;

  return (
    <Box flexDirection="row" justifyContent="space-between" width="100%">
      <Box>
        <Text bold color="cyan">SIM </Text>
        <Text>{simDate} {simTimeStr}</Text>
        <Text> </Text>
        <Text bold color={paused ? "red" : speed === 0 ? "yellow" : "green"}>
          [{speedLabel}]
        </Text>
      </Box>
      <Box>
        <Text bold color="blue">BBS </Text>
        <Text>{config.host}:{config.port}</Text>
        <Text> </Text>
        <Text bold>Nodes </Text>
        <Text>{sessionManager.activeCount()}/{config.maxConcurrent}</Text>
        <Text> </Text>
        <Text bold>Queue </Text>
        <Text>{sessionManager.queueCount()}</Text>
        <Text> </Text>
        <Text bold>LLM </Text>
        <Text>{rateLimiter.available()}/{config.groqRpm}rpm</Text>
        {rateLimiter.queueDepth() > 0 && (
          <Text color="yellow"> (wait: {rateLimiter.queueDepth()})</Text>
        )}
      </Box>
    </Box>
  );
}
