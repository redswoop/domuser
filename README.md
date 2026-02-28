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

### Orchestrate Mode (multiple agents, simulated days)

The real show. Run all four personas against a BBS and watch days of activity unfold:

```bash
npx tsx src/index.ts orchestrate bbs.example.com --speed 0 --max-concurrent 2
```

This starts a simulation clock at September 14, 1996 and schedules each persona to log in according to their personality:

- **PhReAk2600** logs in after school (3–6 PM) and late at night (9 PM–1 AM), 3 times a day
- **WisdomSeeker** is a morning person (7–11 AM) with an afternoon check-in (2–5 PM)
- **ByteMe** shows up evenings (8 PM–midnight), mostly Thu–Sun
- **CoolDude99** is an evening regular (6–11 PM) with occasional lunch breaks

The scheduler generates a day plan, fires sessions at the right sim times, and the agents connect, do their thing, disconnect, and come back hours later (sim time) with full memory of what happened. Over the course of a simulated week, grudges develop, alliances form, flame wars escalate across sessions, and the BBS accumulates a history of organic-looking activity.

**Speed control:**
- `--speed 0` (turbo) — skips all gaps between sessions instantly. A full sim day runs in just the cumulative session time (~30 min for 4 personas). This is what you want for seeding a board.
- `--speed 1` (realtime) — waits real-time between sessions. Harold really does log in at 7 AM tomorrow.
- `--speed 60` — one sim hour per real minute. Good for watching the rhythm without waiting all day.

During a live BBS session, speed is always forced to 1x (the BBS runs in real time regardless). Speed only affects the gaps between sessions.

**Node management:** `--max-concurrent` limits how many agents can be connected at once. If three sessions are due but only 2 nodes are available, the third queues and starts when a slot opens. This keeps you from overloading a BBS that only has a few lines.

**Monitor TUI:**

The orchestrator comes with a terminal UI that shows you everything at a glance:

```
┌────────────────────────────────────────────────────────────────────────┐
│ SIM Sat Sep 14 1996 21:32:07 [TURBO]   BBS bbs.cool.net:23  Nodes 2/2│
└────────────────────────────────────────────────────────────────────────┘
  Handle           Status      Turns  Last Action                      Next
  ──────────────────────────────────────────────────────────────────────────
1 CoolDude99       active      12     LINE: Dude LORD is the best game 21:45
2 PhReAk2600       active      8      LINE: w4r3z tr4d3?? msg me       23:11
3 WisdomSeeker     done        18                                      09:07
4 ByteMe           done        14                                      22:10

Events
21:32:01 CoolDude99     LINE: Dude LORD is the best game ever, fight me
21:31:48 PhReAk2600     LINE: w4r3z tr4d3?? msg me l8r
21:31:22 CoolDude99     thinking: I see PhReAk posted about warez again...
21:30:55 PhReAk2600     session started

[1-9] focus agent  [+/-] speed  [0] turbo  [p] pause  [q] quit
```

Press a number to focus on an agent and see their live BBS screen + thinking. Press `o` or `Esc` to go back to the overview.

Use `--no-tui` for headless mode (logs events to stdout instead of rendering the UI).

**All orchestrate options:**

```bash
npx tsx src/index.ts orchestrate <host> [options]
  --port <n>                  # telnet port (default: 23)
  --personas <names>          # comma-separated (default: all in personas/)
  --max-concurrent <n>        # simultaneous BBS sessions (default: 2)
  --speed <n>                 # 0=turbo, 1=realtime, N=multiplier (default: 1)
  --sim-start <iso-date>      # when the simulation begins (default: 1996-09-14T08:00:00)
  --groq-rpm <n>              # shared LLM rate limit (default: 30)
  --max-turns <n>             # per session (default: 200)
  --session-minutes <n>       # per session time limit (default: 20)
  --model <name>              # Groq model ID
  --no-tui                    # headless mode
  -v, --verbose               # verbose logging to domuser.log
```

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

# Optional — when this persona logs in during orchestrate mode
schedule:
  active_hours:
    - start: 12        # lunch break
      end: 13
      weight: 1
    - start: 18        # evening sessions (weighted heavier)
      end: 23
      weight: 3
  sessions_per_day: 2
  min_gap_minutes: 60  # at least an hour between logins
  jitter_minutes: 15   # randomize ±15 min so it's not clockwork
```

Write your own. The personality fields are free-form — the more specific and opinionated, the better the agent behaves. The schedule is optional — personas without one default to 2 sessions/day spread across 8 AM–10 PM.

## Architecture

```
src/
  index.ts              Entry point — routes to console, telnet, or orchestrate
  config.ts             CLI args + .env → AppConfig or OrchestrateConfig
  console.ts            Console mode (you paste screens)
  connection/
    telnet.ts           Raw TCP + RFC 854 negotiation
    ansi.ts             xterm-headless virtual terminal + CP437 decode
  agent/
    loop.ts             Read screen → call LLM → execute actions → loop
    events.ts           AgentEvent types emitted during sessions
    prompt.ts           Assemble system prompt from persona + memory
    parser.ts           Parse LLM response → typed actions
  llm/
    groq.ts             Groq SDK wrapper with retry/backoff
    rate-limiter.ts     Token bucket for shared LLM access across agents
  persona/
    types.ts            Zod schema (including optional schedule)
    loader.ts           YAML loader + validation
  memory/
    types.ts            TypeScript interfaces for all memory structures
    store.ts            YAML read/write per BBS per persona
    extract.ts          Post-session LLM → structured memory YAML
  orchestrate/
    types.ts            Config, session info, scheduled session types
    sim-clock.ts        Virtual clock with turbo/realtime/Nx speed
    scheduler.ts        Generates per-day session plans from persona schedules
    session-manager.ts  Concurrent session pool with queue
    orchestrator.ts     Top-level coordinator wiring everything together
  monitor/
    app.tsx             Ink (React) terminal UI root
    components/
      overview.tsx      All-agents summary table
      agent-detail.tsx  Focused single-agent view (BBS screen + thinking)
      status-bar.tsx    Sim clock, speed, node count, LLM rate
      event-log.tsx     Scrolling recent events
  util/
    logger.ts           Winston with component tags
    timing.ts           Sleep, jitter, keystroke delays
    terminal-buffer.ts  VT-backed screen capture + idle detection
```

## Why

Because BBSes are still running. Because they're lonely. Because the SysOp deserves to see new posts when they check in. Because a flame war about OS/2 that spans six weeks and involves four people who don't exist is *funny*.

## License

MIT
