import { z } from "zod";

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
});

export type Persona = z.infer<typeof PersonaSchema>;
