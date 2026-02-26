import { getLogger } from "../util/logger.js";

const log = getLogger("parser");

export type ActionType = "THINKING" | "LINE" | "TYPE" | "KEY" | "WAIT" | "MEMORY" | "DISCONNECT";

export interface Action {
  type: ActionType;
  value: string;
}

const VALID_KEYS = new Set([
  "enter", "esc", "space", "y", "n", "Y", "N",
  "backspace", "tab",
]);

/**
 * Parse an LLM response into a list of actions.
 */
export function parseActions(response: string): Action[] {
  const actions: Action[] = [];
  const lines = response.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const match = trimmed.match(/^(THINKING|LINE|TYPE|KEY|WAIT|MEMORY|DISCONNECT):\s*(.*)/i);
    if (!match) {
      // If the line doesn't match any action, treat it as implicit THINKING
      log.debug(`unparseable line, treating as THINKING: ${trimmed.slice(0, 80)}`);
      continue;
    }

    const type = match[1].toUpperCase() as ActionType;
    const value = match[2];

    // Validate KEY actions
    if (type === "KEY") {
      const key = value.trim().toLowerCase();
      if (!VALID_KEYS.has(key) && key.length !== 1) {
        log.warn(`invalid KEY value: ${value}, skipping`);
        continue;
      }
    }

    // Validate WAIT actions
    if (type === "WAIT") {
      const ms = parseInt(value.trim(), 10);
      if (isNaN(ms) || ms < 0 || ms > 30000) {
        log.warn(`invalid WAIT value: ${value}, clamping`);
        actions.push({ type, value: String(Math.min(Math.max(0, ms || 1000), 30000)) });
        continue;
      }
    }

    actions.push({ type, value });
  }

  // If we parsed nothing useful, something went wrong
  if (actions.length === 0 && response.trim().length > 0) {
    log.warn("no actions parsed from LLM response, adding fallback WAIT");
    actions.push({ type: "THINKING", value: "Could not determine what to do" });
    actions.push({ type: "WAIT", value: "2000" });
  }

  return actions;
}
