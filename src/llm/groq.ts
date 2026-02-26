import Groq from "groq-sdk";
import { getLogger } from "../util/logger.js";
import { sleep } from "../util/timing.js";

const log = getLogger("groq");

let client: Groq;

export function initGroq(apiKey: string): void {
  client = new Groq({ apiKey });
}

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export async function chatCompletion(
  messages: LLMMessage[],
  model: string,
  maxTokens: number = 2048,
): Promise<string> {
  if (!client) throw new Error("Groq client not initialized — call initGroq first");

  const maxRetries = 3;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await client.chat.completions.create({
        model,
        messages,
        max_tokens: maxTokens,
        temperature: 0.9,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error("Empty response from Groq");
      }

      log.debug(`LLM response (${content.length} chars)`);
      return content;
    } catch (err: unknown) {
      const error = err as { status?: number; message?: string };

      // Rate limit — back off and retry
      if (error.status === 429) {
        const waitMs = attempt * 5000;
        log.warn(`rate limited, waiting ${waitMs}ms (attempt ${attempt}/${maxRetries})`);
        await sleep(waitMs);
        continue;
      }

      // Other errors
      log.error(`Groq API error: ${error.message || err}`);
      if (attempt === maxRetries) throw err;
      await sleep(2000);
    }
  }

  throw new Error("Groq API failed after max retries");
}
