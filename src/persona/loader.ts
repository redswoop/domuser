import fs from "fs";
import path from "path";
import { parse as parseYAML } from "yaml";
import { PersonaSchema, type Persona } from "./types.js";
import { getLogger } from "../util/logger.js";

const log = getLogger("persona");

/**
 * Load a persona from a YAML file.
 * Looks in ./personas/<name>.yaml relative to project root.
 */
export function loadPersona(name: string): Persona {
  const searchPaths = [
    path.resolve("personas", `${name}.yaml`),
    path.resolve("personas", `${name}.yml`),
  ];

  let filePath: string | null = null;
  for (const p of searchPaths) {
    if (fs.existsSync(p)) {
      filePath = p;
      break;
    }
  }

  if (!filePath) {
    throw new Error(`Persona "${name}" not found. Searched: ${searchPaths.join(", ")}`);
  }

  log.info(`loading persona from ${filePath}`);
  const raw = fs.readFileSync(filePath, "utf-8");
  const data = parseYAML(raw);
  return PersonaSchema.parse(data);
}
