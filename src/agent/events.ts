export type AgentEventType =
  | "session:start"
  | "session:end"
  | "turn:screen"
  | "turn:thinking"
  | "turn:response"
  | "turn:action"
  | "turn:more"
  | "turn:stuck"
  | "memory:note"
  | "memory:extracting"
  | "memory:extracted"
  | "error";

export interface AgentEvent {
  type: AgentEventType;
  personaHandle: string;
  timestamp: number;
  turn?: number;
  screenText?: string;
  response?: string;
  action?: { type: string; value: string };
  thinking?: string;
  note?: string;
  reason?: string;
  error?: Error;
}
