import type { Persona } from "../persona/types.js";

export interface OrchestrateConfig {
  host: string;
  port: number;
  personas: string[];           // persona file names (without .yaml)
  maxConcurrent: number;        // BBS node limit
  speed: number;                // 0=turbo, 1=realtime, N=multiplier
  simStart: Date;               // sim clock start time
  groqRpm: number;              // rate limit for LLM calls
  maxTurns: number;             // per session
  groqModel: string;
  groqApiKey: string;
  sessionMinutes: number;
  idleTimeoutMs: number;
  keystrokeMinMs: number;
  keystrokeMaxMs: number;
  noTui: boolean;               // headless mode
  verbose: boolean;
  logLevel: string;
}

export type SessionStatus =
  | "queued"
  | "connecting"
  | "active"
  | "extracting"
  | "done"
  | "error";

export interface SessionInfo {
  id: string;
  personaHandle: string;
  persona: Persona;
  status: SessionStatus;
  turnCount: number;
  currentScreen: string;
  lastAction: string;
  scheduledSimTime: Date;
  startedAt?: number;
  endedAt?: number;
  error?: string;
}

export interface ScheduledSession {
  personaHandle: string;
  persona: Persona;
  scheduledSimTime: Date;
}
