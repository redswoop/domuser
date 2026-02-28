import { z } from "zod";

const ActiveHourSchema = z.object({
  start: z.number().min(0).max(23),
  end: z.number().min(0).max(23),
  weight: z.number().default(1),
});

export const ScheduleSchema = z.object({
  active_hours: z.array(ActiveHourSchema),
  sessions_per_day: z.number().min(1).max(10).default(2),
  min_gap_minutes: z.number().min(5).default(60),
  jitter_minutes: z.number().min(0).default(15),
  active_days: z.array(z.number().min(0).max(6)).optional(),
});

export const PersonaSchema = z.object({
  name: z.string(),
  handle: z.string(),
  age: z.number(),
  location: z.string(),
  occupation: z.string(),

  archetype: z.string(),

  personality: z.object({
    traits: z.array(z.string()),
    interests: z.array(z.string()),
    writing_style: z.string(),
    hot_buttons: z.string(),
    social_tendencies: z.string(),
  }),

  behavior: z.object({
    goals: z.array(z.string()),
    avoid: z.array(z.string()),
    session_length_minutes: z.number().default(20),
  }),

  registration: z.object({
    email: z.string(),
    real_name: z.string(),
    voice_phone: z.string(),
    birth_date: z.string(),
  }),

  schedule: ScheduleSchema.optional(),
});

export type Persona = z.infer<typeof PersonaSchema>;
export type Schedule = z.infer<typeof ScheduleSchema>;
