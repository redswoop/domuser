# CLAUDE.md — domuser

## What This Is

domuser is a BBS agent system. LLM-driven personas connect to BBSes via telnet, post messages, get into flame wars, form alliances, distribute fake warez, and develop evolving opinions about each other. Memory across sessions is the critical feature — agents remember relationships, grudges, collaborations, and ongoing plots.

Think of it as a cast of simulated 1990s BBS users, each with a distinct personality, who autonomously log in, interact with the board (and each other's posts), and come back next time remembering everything.

## Tech Stack

- TypeScript / Node.js (ESM, `"type": "module"`)
- `tsx` for dev (runs .ts directly)
- Groq LLM provider (llama-3.3-70b-versatile default, configurable)
- Raw `net.Socket` for telnet (NOT `telnet-client` — that package is for Unix shells, not BBS interactive UIs)
- `@xterm/headless` for VT100/ANSI terminal emulation (interprets escape codes into 80x24 screen buffer)
- YAML for persona definitions and memory files
- JSONL for session logs

## Running

```bash
# Console mode — you play the BBS, paste screens, see what the agent does
npx tsx src/index.ts fake-bbs --console --persona default

# Telnet mode — agent connects to a real BBS
npx tsx src/index.ts bbs.example.com --persona warez-kid -v

# All options
npx tsx src/index.ts <host> [options]
  -c, --console              # you paste screens, agent responds (no telnet)
  -p, --port <n>             # telnet port (default: 23)
  --persona <name>           # persona file name without .yaml (default: "default")
  -v, --verbose              # dump raw BBS output + LLM responses
  --max-turns <n>            # auto-disconnect after N turns (default: 200)
  --session-minutes <n>      # session time limit (default: 20)
  --idle-timeout <ms>        # silence before treating as prompt-ready (default: 1500)
  --keystroke-min <ms>       # min per-character delay (default: 30)
  --keystroke-max <ms>       # max per-character delay (default: 100)
  --model <name>             # Groq model ID
```

Env: `GROQ_API_KEY` (required), `LOG_LEVEL` (optional, default "info"). Copy `.env.example` to `.env`.

## Project Structure

```
src/
  index.ts                    # CLI entry — routes to console or telnet mode
  config.ts                   # .env + commander CLI parsing → AppConfig
  console.ts                  # Console mode — stdin screen input, LLM response display

  connection/
    telnet.ts                 # Raw TCP socket + RFC 854 telnet negotiation
    ansi.ts                   # VirtualTerminal (xterm headless) + CP437 decode

  agent/
    loop.ts                   # Core read→think→act cycle (telnet mode)
    prompt.ts                 # System prompt assembly from persona + memory + screen
    parser.ts                 # Parse LLM response → Action[] (LINE, TYPE, KEY, WAIT, etc.)

  llm/
    groq.ts                   # Groq SDK wrapper, retry on 429 with backoff

  persona/
    types.ts                  # Persona zod schema
    loader.ts                 # Load + validate persona YAML files

  memory/
    types.ts                  # Credentials, Relationships, Plots, Knowledge interfaces
    store.ts                  # Per-BBS per-persona YAML file read/write
    extract.ts                # Post-session LLM call → structured memory extraction

  util/
    logger.ts                 # Winston logger with component tags
    timing.ts                 # sleep(), jitteredDelay(), typeWithDelay()
    terminal-buffer.ts        # VT-backed screen buffer + idle/prompt detection

personas/                     # The cast — checked into git
  default.yaml                # CoolDude99 — friendly warez kid, 28, Portland
  old-timer.yaml              # WisdomSeeker — pedantic retired engineer, 54, Tucson
  warez-kid.yaml              # PhReAk2600 — brash teenage phreaker, 16, Jersey City
  smarty-pants.yaml           # ByteMe — sharp CS grad student, 24, San Francisco

memory/                       # Runtime state — gitignored
  <bbs-host>/
    <persona-handle>/
      credentials.yaml
      relationships.yaml
      plots.yaml
      knowledge.yaml
      sessions/
        <timestamp>.jsonl
        <timestamp>.summary.md
```

## Architecture & Data Flow

### The Agent Loop (telnet mode)

```
connect TCP → telnet IAC negotiation (TTYPE=ANSI, NAWS=80x24)
  → raw bytes arrive
  → CP437 decode → feed into VirtualTerminal (xterm headless, interprets escape codes)
  → TerminalBuffer detects idle (timeout or prompt pattern match)
  → snapshot 80x24 rendered screen as plain text
  → build LLM prompt: system (persona+memory) + user (screen+history)
  → call Groq (non-streaming)
  → parse response into Action[]
  → execute: type chars with jittered delay, press keys, save MEMORY notes
  → loop until DISCONNECT / max turns / session timeout
  → extract structured memories via one final LLM call
```

### Console Mode

Same prompt/parse/memory pipeline, but you paste BBS screen text via stdin instead of telnet. Blank line submits. `/quit` triggers memory extraction. `/memory` dumps state. `/system` shows the full system prompt.

### Memory Extraction

At session end, one LLM call receives the condensed conversation history and returns structured YAML:
- **credentials** — username/password if login or registration happened
- **knowledge** — BBS name, software, message bases, file areas, door games, menu notes
- **relationships** — per-user role/trust/respect/notes/interaction, merged with existing
- **plots** — ongoing schemes with collaborators/adversaries/next steps
- **summary** — first-person session recap in persona voice

This replaces any dumb heuristic extraction. The LLM does all the structuring.

### VirtualTerminal

We use `@xterm/headless` (the xterm.js engine without DOM) to properly interpret BBS output. A BBS drawing menus with cursor positioning (`ESC[5;20H`) produces correctly laid-out text in the 80x24 buffer. Without this, escape codes get stripped and layout is lost — the LLM would see garbled text.

## Key Design Decisions

- **Raw net.Socket, not telnet-client**: BBS UIs are interactive screen-based apps, not Unix shell sessions. We need byte-level control over what we send and when.
- **VirtualTerminal, not strip-ansi**: BBSes use cursor positioning, screen clears, scroll regions. Stripping ANSI codes destroys layout. We need a real terminal emulator.
- **One LLM call for memory extraction**: Rather than parsing MEMORY notes with heuristics, we make one structured extraction call at session end. The LLM is better at deciding what goes into credentials vs relationships vs knowledge.
- **YAML for memory files**: Human-readable, easy to hand-edit for testing, easy to inspect.
- **Conversation history trimming**: Keep system prompt + last 40 messages (20 turns) to stay within token limits.
- **Stuck detection**: Hash the screen text. If identical 3 times in a row, send ESC+Enter to break out.
- **[More] auto-handling**: Regex match on common pause prompts, send Enter without burning an LLM call.

## LLM Action Format

The agent responds with one or more lines:

```
THINKING: <reasoning>          # logged only, not sent to BBS
LINE: <text>                   # type text + press Enter
TYPE: <text>                   # type text without Enter
KEY: enter|esc|space|y|n|...   # single keypress
WAIT: <ms>                     # pause (max 30s)
MEMORY: <note>                 # collected, fed into extraction at session end
DISCONNECT: <reason>           # end session
```

## Persona YAML Schema

```yaml
name: "Real Name"
handle: "BBSHandle"
age: 28
location: "City, ST"
occupation: "job title"
archetype: "warez kid"       # quick-reference role label

personality:
  traits: [friendly, sarcastic, ...]
  interests: [door games, ANSI art, ...]
  writing_style: |            # how they write: grammar, emoticons, length, quirks
  hot_buttons: |              # what makes them angry or defensive
  social_tendencies: |        # how they form alliances, hold grudges, etc.

behavior:
  goals:                      # what to do each session
    - Post and reply to messages
    - Check file areas
    - Play door games
  avoid:                      # hard rules
    - Revealing AI nature
    - Being boring or generic
  session_length_minutes: 20

registration:                 # for new-user signup
  email: "fake@email.net"
  real_name: "Real Name"
  voice_phone: "555-0147"
  birth_date: "1968-06-15"
```

## Memory File Formats

**credentials.yaml**: `username`, `password`, `registered` (bool), `last_login` (ISO timestamp)

**relationships.yaml**: `users` map of handle → `{first_seen, role, trust (1-10), respect (1-10), notes, recent_interactions[{date, summary}]}`
- Roles: ally, rival, neutral, enemy, mentor, annoyance

**plots.yaml**: `active[]` with `{id, started, collaborators[], adversaries[], description, next_steps, status}` + `completed[]` with `{id, summary}`

**knowledge.yaml**: `{bbs_name, software, menus, message_bases[], file_areas[], door_games[], notes}`

**sessions/\<timestamp\>.jsonl**: One JSON object per line: `{turn, type: "screen"|"response", text, timestamp}`

**sessions/\<timestamp\>.summary.md**: First-person session recap from the persona's perspective.

## Code Conventions

- **Imports**: ESM with explicit `.js` extensions. Type-only imports use `import type`.
- **Naming**: files kebab-case, classes PascalCase, constants UPPER_SNAKE, functions camelCase.
- **Logging**: `getLogger("component")` — every module gets a tagged logger. Levels: error, warn, info, debug.
- **Error handling**: LLM calls retry with backoff. Memory extraction failures log and continue (never crash). Telnet errors emit events. Config errors exit(1).
- **No tests yet**: vitest is installed but no test files exist.

## Console Mode Commands

```
BBS>                    # prompt — paste screen text, blank line to submit
/quit                   # extract memories and exit
/memory                 # dump all memory files as JSON
/history [n]            # show last n conversation turns
/system                 # show full system prompt being sent to LLM
```

## What Still Needs Work

- **Tests**: No test coverage. Parser, memory store, and prompt builder are all unit-testable.
- **Multi-agent orchestration**: Currently one agent per process. No scheduler for running multiple personas against the same BBS.
- **BBS knowledge bootstrapping**: First session on a new BBS is blind — agent has no knowledge of menus. Could be improved with a discovery/exploration mode.
- **Door game handling**: Agent can navigate to door games but has no special logic for playing them (game-specific action patterns).
- **Credential detection during session**: Currently credentials are only captured at session end via extraction. Could detect login success mid-session for reliability.
- **Session log in console mode**: Console mode doesn't write .jsonl session logs.
- **ANSI art appreciation**: The VT strips all visual formatting. The LLM never "sees" the ANSI art that makes BBSes special. Could optionally preserve color codes.
