import readline from "readline";
import { getLogger } from "./util/logger.js";
import { loadPersona } from "./persona/loader.js";
import { MemoryStore } from "./memory/store.js";
import { initGroq } from "./llm/groq.js";
import { chatCompletion, type LLMMessage } from "./llm/groq.js";
import { buildSystemPrompt, buildScreenMessage } from "./agent/prompt.js";
import { parseActions } from "./agent/parser.js";
import { extractAndSaveMemories } from "./memory/extract.js";
import type { Persona } from "./persona/types.js";
import type { AppConfig } from "./config.js";

export async function runConsole(config: AppConfig): Promise<void> {
  const log = getLogger("console");

  const persona = loadPersona(config.persona);
  log.info(`persona: ${persona.handle} (${persona.name}) — ${persona.archetype}`);

  const memory = new MemoryStore(config.host, persona.handle);
  initGroq(config.groqApiKey);

  const systemPrompt = buildSystemPrompt(persona, memory);
  const history: LLMMessage[] = [{ role: "system", content: systemPrompt }];
  let turnCount = 0;
  // Collect MEMORY notes during session for inclusion in extraction
  const memoryNotes: string[] = [];

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log(`\n--- domuser console mode ---`);
  console.log(`Persona: ${persona.handle} | BBS: ${config.host} (fake)`);
  console.log(`Paste BBS screen output, then enter a blank line to submit.`);
  console.log(`Commands: /quit, /memory, /history, /system\n`);

  const endSession = async (): Promise<void> => {
    if (turnCount > 0) {
      console.log("\nExtracting memories from session...");
      // Append any MEMORY notes as a final assistant message so extraction sees them
      if (memoryNotes.length > 0) {
        history.push({
          role: "assistant",
          content: `MEMORY notes from this session:\n${memoryNotes.map((n) => `- ${n}`).join("\n")}`,
        });
      }
      await extractAndSaveMemories(history, memory, persona, config.groqModel);
      console.log("Memories saved.");
    }
    console.log("Bye.");
    process.exit(0);
  };

  const prompt = (): void => {
    let buffer = "";
    let collecting = false;

    const ask = (): void => {
      rl.question(collecting ? "" : "BBS> ", (line) => {
        // Commands
        if (!collecting && line.startsWith("/")) {
          if (line.trim() === "/quit") {
            endSession();
            return;
          }
          handleCommand(line, memory, history, systemPrompt);
          ask();
          return;
        }

        // Blank line = submit what we've collected
        if (line === "" && collecting) {
          collecting = false;
          if (buffer.trim()) {
            submitScreen(buffer, history, ++turnCount, config.groqModel, memory, memoryNotes).then(() => ask());
          } else {
            ask();
          }
          return;
        }

        // Start or continue collecting
        collecting = true;
        buffer += (buffer ? "\n" : "") + line;
        ask();
      });
    };

    ask();
  };

  prompt();

  // Keep alive — the readline loop handles exit via /quit
  await new Promise<void>(() => {});
}

async function submitScreen(
  screenText: string,
  history: LLMMessage[],
  turn: number,
  model: string,
  memory: MemoryStore,
  memoryNotes: string[],
): Promise<void> {
  console.log(`\n--- Processing turn ${turn} ---`);

  const userMsg = buildScreenMessage(screenText, [], turn);
  history.push({ role: "user", content: userMsg });

  // Trim to keep context manageable
  if (history.length > 41) {
    const system = history[0];
    const recent = history.slice(-40);
    history.length = 0;
    history.push(system, ...recent);
  }

  try {
    const response = await chatCompletion(history, model);
    history.push({ role: "assistant", content: response });

    const actions = parseActions(response);
    console.log("");
    for (const action of actions) {
      switch (action.type) {
        case "THINKING":
          console.log(`  [think] ${action.value}`);
          break;
        case "LINE":
          console.log(`  >>> LINE: ${action.value}`);
          break;
        case "TYPE":
          console.log(`  >>  TYPE: ${action.value}`);
          break;
        case "KEY":
          console.log(`  [key] ${action.value}`);
          break;
        case "WAIT":
          console.log(`  [wait] ${action.value}ms`);
          break;
        case "MEMORY":
          console.log(`  [memory] ${action.value}`);
          memoryNotes.push(action.value);
          break;
        case "DISCONNECT":
          console.log(`  [disconnect] ${action.value}`);
          break;
      }
    }
    console.log("");
  } catch (err) {
    console.error(`LLM error: ${err}`);
  }
}

function handleCommand(
  cmd: string,
  memory: MemoryStore,
  history: LLMMessage[],
  systemPrompt: string,
): void {
  const parts = cmd.trim().split(/\s+/);
  switch (parts[0]) {
    case "/memory":
      console.log("\n--- Credentials ---");
      console.log(JSON.stringify(memory.getCredentials(), null, 2));
      console.log("\n--- Relationships ---");
      console.log(JSON.stringify(memory.getRelationships(), null, 2));
      console.log("\n--- Plots ---");
      console.log(JSON.stringify(memory.getPlots(), null, 2));
      console.log("\n--- Knowledge ---");
      console.log(JSON.stringify(memory.getKnowledge(), null, 2));
      console.log("");
      break;

    case "/history": {
      const count = parseInt(parts[1] || "5", 10);
      const recent = history.slice(-count * 2);
      for (const msg of recent) {
        if (msg.role === "system") continue;
        console.log(`\n[${msg.role}] ${msg.content.slice(0, 200)}...`);
      }
      console.log("");
      break;
    }

    case "/system":
      console.log("\n--- System Prompt ---");
      console.log(systemPrompt);
      console.log("");
      break;

    default:
      console.log("Unknown command. Available: /quit, /memory, /history [n], /system");
  }
}
