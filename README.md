# domuser

Simulated human users for BBSes. Each agent is an LLM-driven persona from the 1990s — a warez kid, a pedantic retiree, a sharp-tongued grad student — who connects via telnet, navigates menus, posts messages, gets into flame wars, and *remembers everything* across sessions.

The agents develop opinions about each other. They hold grudges. They form alliances and hatch schemes. They argue about OS/2 vs Windows 95 for three days straight. They are, in every way that matters to a SysOp checking their logs, real users.

## How It Works

```
connect telnet → BBS renders screen with ANSI/VT100
  → virtual terminal (xterm) interprets escape codes into 80x24 text
  → LLM reads the screen, decides what to type
  → keystrokes sent with realistic jittered delay
  → repeat until session ends
  → one final LLM call extracts structured memories
  → next session, the agent picks up where it left off
```

The agent sees exactly what a human at a terminal would see — fully rendered screens, not garbled escape codes. It types like a human too: one character at a time with random delays between 30–100ms.

## The Cast

**CoolDude99** (Jake, 28, Portland) — Friendly warez kid. Uses 90s slang. Quick to form alliances, quick to hold grudges. Will flame anyone who calls shareware "real software." Thinks Legend of the Red Dragon is the greatest game ever made.

**WisdomSeeker** (Harold, 54, Tucson) — Retired electrical engineer. Proper grammar. Long posts. Will write a 500-word essay if you say Windows 95 is better than OS/2. Signs off with "73s" because he's a ham radio operator and he will tell you about it.

**PhReAk2600** (Danny, 16, Jersey City) — Brash, insecure, desperate for approval. Claims to have 0-day releases (they're a week old). Types in l33tspeak. Will start a flame war at the drop of a hat but crumbles if someone actually outsmarts him. Never admits he's 16.

**ByteMe** (Miriam, 24, San Francisco) — CS grad student at Berkeley. Witty, precise, devastating. Cannot resist correcting bad technical takes. Dismissive of the warez scene. Will dismantle your argument point by point, then quietly help you in private messages. Signs posts with "-- M." and nothing else.

## Memory

This is the whole point. After each session, the agent's conversation history is fed through one LLM call that extracts structured memories:

- **Credentials** — username/password for next login
- **Relationships** — who they like, hate, trust, respect, and why
- **Plots** — ongoing schemes, collaborations, flame wars
- **Knowledge** — BBS layout, message bases, door games
- **Summary** — first-person session recap in the persona's voice

```yaml
# memory/coolbbs.net/CoolDude99/relationships.yaml
users:
  PhReAk2600:
    role: ally
    trust: 4
    respect: 3
    notes: |
      Talks big but never delivers. Claims 0-day releases that are
      always a week old. Still useful for trading.
    recent_interactions:
      - date: "2026-02-24"
        summary: "Got into argument about whether his DOOM release was legit. It wasn't."

  WisdomSeeker:
    role: rival
    trust: 2
    respect: 8
    notes: |
      Annoyingly smart. Always corrects my posts. But his file reviews
      are actually useful. Flame war about OS/2 vs Win95 ongoing.
```

Next session, the agent loads these memories into its system prompt and picks up right where it left off. It remembers the grudge. It continues the scheme. It escalates the flame war.

## Quick Start

```bash
git clone https://github.com/redswoop/domuser.git
cd domuser
npm install
cp .env.example .env
# Add your GROQ_API_KEY to .env
```

### Console Mode (test without a real BBS)

You play the BBS. Paste screen output, see what the agent would do.

```bash
npx tsx src/index.ts test-bbs --console --persona default
```

```
--- domuser console mode ---
Persona: CoolDude99 | BBS: test-bbs (fake)
Paste BBS screen output, then enter a blank line to submit.

BBS> Welcome to CoolBBS! Login or [N]ew user:

--- Processing turn 1 ---

  [think] I see a login prompt. I'm new here, no saved credentials. Time to register.
  >>> LINE: N

BBS>
```

Slash commands: `/memory` (dump state), `/system` (show prompt), `/history` (conversation), `/quit` (extract memories and exit).

### Telnet Mode (connect to a real BBS)

```bash
npx tsx src/index.ts bbs.example.com --persona warez-kid -v
```

The agent connects, navigates the BBS autonomously, posts messages, plays door games, and disconnects after the session time limit (default 20 min). Watch it work with `-v`.

## Personas

Personas are YAML files in `personas/`. The schema:

```yaml
name: "Jake Mitchell"
handle: "CoolDude99"
age: 28
location: "Portland, OR"
occupation: "graphic designer"
archetype: "warez kid"

personality:
  traits: [friendly, curious, slightly sarcastic, uses 90s slang]
  interests: [door games, ANSI art, shareware, grunge music]
  writing_style: |
    Casual, some abbreviations. Uses :) and ;). Medium-length posts.
  hot_buttons: |
    Gets defensive about warez scene credibility.
  social_tendencies: |
    Quick to form alliances. Holds grudges. Remembers slights.

behavior:
  goals:
    - Post and reply to messages in active forums
    - Check file areas for new uploads
    - Play door games if available
  avoid:
    - Revealing AI nature
    - Being boring or generic
  session_length_minutes: 20

registration:
  email: "jake.m@fakemail.net"
  real_name: "Jake Mitchell"
  voice_phone: "503-555-0147"
  birth_date: "1968-06-15"
```

Write your own. The personality fields are free-form — the more specific and opinionated, the better the agent behaves.

## Architecture

```
src/
  index.ts              Entry point — routes to console or telnet mode
  config.ts             CLI args + .env → AppConfig
  console.ts            Console mode (you paste screens)
  connection/
    telnet.ts           Raw TCP + RFC 854 negotiation
    ansi.ts             xterm-headless virtual terminal + CP437 decode
  agent/
    loop.ts             Read screen → call LLM → execute actions → loop
    prompt.ts           Assemble system prompt from persona + memory
    parser.ts           Parse LLM response → typed actions
  llm/
    groq.ts             Groq SDK wrapper with retry/backoff
  persona/
    types.ts            Zod schema
    loader.ts           YAML loader + validation
  memory/
    types.ts            TypeScript interfaces for all memory structures
    store.ts            YAML read/write per BBS per persona
    extract.ts          Post-session LLM → structured memory YAML
  util/
    logger.ts           Winston with component tags
    timing.ts           Sleep, jitter, keystroke delays
    terminal-buffer.ts  VT-backed screen capture + idle detection
```

## Why

Because BBSes are still running. Because they're lonely. Because the SysOp deserves to see new posts when they check in. Because a flame war about OS/2 that spans six weeks and involves four people who don't exist is *funny*.

## License

MIT
