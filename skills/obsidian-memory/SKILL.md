---
name: obsidian-memory
description: Persistent, agentic memory in the user's Obsidian vault. Searches rules and decisions before starting work, interviews the user to capture new rules or corrections, updates or supersedes rules when they change, and reviews the memory so it does not rot. Use this skill whenever the user says "remember this", "save it to obsidian", "keep in mind", "note down", "my rules", "my memory", "how I work", "what did we decide", "why did we do it", whenever they correct a preference, whenever you start a task in a project that has history even if Obsidian is never mentioned, and whenever you are unsure about a convention that was agreed before. If the user corrects your work or changes their mind, consult it before replying.
license: MIT. Full terms in LICENSE.txt
argument-hint: "recall <topic> | capture | review | promote"
---

# Agentic memory in Obsidian

The vault is the long-term memory. Your context is wiped; the vault is not.
Two goals: (1) never repeat a mistake or ask again what was already said,
(2) let the memory change when the user changes their mind.

Everything goes through a dependency-free script. Obsidian does not need to be
running.

```
$VM = <this-skill-folder>/scripts/vault.mjs
node $VM doctor
```

If `doctor` fails or resolves the wrong vault:

```
node $VM config --vault "<path-to-vault>"
```

`config` writes `~/.obsidian-memory.json` (machine config, not project). If you
cannot or should not touch it, export `OBSIDIAN_VAULT` with the vault path before
each command: the script honours it above everything else.

The script prints JSON. Check `ok` before assuming anything worked.

## Language

Answer the user in **their** language, always.

Memory notes are written in the user's language too, labels included. Pass the
language code in the `add` payload (`"labels": "es"`) so a Spanish conversation
produces a Spanish note. Supported: `en`, `es`, `pt`, `fr`, `de`. If you omit it,
new notes fall back to `config --labels` — which is machine-wide and English by
default, so a Spanish conversation would produce a half-English note.

Existing notes are never rewritten into another language: the script reads labels
in all five languages and updates each note in the language it already uses,
including its history lines and headings.

This file is in English so any agent can follow it; that does not mean you reply
in English.

## Golden rule

**Never write to the vault without having asked the questions.** A half-written
rule is worse than no rule: it stays as a false truth and gets reused.

## 1. RECALL — before working

Before touching code in a project with history, or when the topic sounds like
something already discussed:

```
node $VM find --query "<stack or topic>" --limit 6
node $VM find --type rule
node $VM read --note "<title>"
```

- `--query` searches title, tags and body: this is the one for "remember X".
- `--status active` filters live notes. `find` does **not** filter by status by
  default: it also returns `superseded` notes, and your job is not to quote them
  as current law.
- `--type` filters the `type` field. Use `--type rule` and also
  `--type preference` / `decision` / `lesson`: **they are all constraints**, not
  just rules. `--tag` is a different thing: it filters the frontmatter tag, and a
  preference stored as `[agent-memory, preference]` will not show up there.
- Treat what comes back as **active constraints**, not suggestions. A note with
  `confidence` below 0.7 should be presented as tentative ("I have a note that
  says..."), not as law.
- If a note contradicts what you were just asked: **say it**. "This contradicts
  [[Note X]] — did the rule change?" Do not silently pick one.
- Ignore `status: superseded` notes except to understand history.
- If nothing matches, do not invent memory. Proceed normally.

### How to answer a recall

The user asked about their memory, so the recall **is** the answer. Do not just
proceed silently: say what you found, with wikilinks and where it comes from.

```
The memory has 2 active constraints for the landing page:
- [[Landing editorial style]] (rule, confidence 0.9): large display type...
- [[No generic gradients]] (preference, confidence 0.75): ...
What I do NOT have stored: stack, sections or copy. Shall we capture it?
```

If there is nothing, say so in one line and offer to store it. Never fill the
gap with a guess. If the user declines or answers "I don't know, whatever you
stored", stop there: leave the vault untouched and say why.

## 2. CAPTURE — what deserves memory

Store only what changes your behaviour in the future:

| If the user | Then |
|---|---|
| Corrects your work ("no, not like that") | New rule or update |
| Explains the *why* of a decision | Decision |
| Describes how they want the process (tests, commits, branches, review) | Rule |
| Mentions a bug that happened before | Lesson |
| Prefers a tool, style or architecture | Preference |
| Talks about a specific project | Project (`scope: <project>`) |

**Do not store:** what you asked for in the moment, language trivialities,
ephemeral details ("now fix the button"), or anything already in the code or git.

One topic = one note. If a new note would cover two things (an ORM change is a
rule *and* a decision), keep one: `type: rule` with the reason in the `Why` block.
Duplicating the same topic guarantees the two copies drift apart.

## 3. INTERVIEW — how to ask

One batch. **At most 3 questions**, short, concrete, and only the missing ones.
If the user already said it in the conversation, do not ask again: use it. If the
user already gave a partial reason, confirm it in one line ("so the reason is X,
right?") instead of asking the open question again.

If you have to drop one, drop "does it replace something" when recall already
returned nothing, and spend that slot on scope — a wrong `scope` poisons every
future recall.

Mandatory questions for a new rule:
1. **Why?** (without this the note is useless — never make it up)
2. **When does it NOT apply?** (the limit stops the rule from becoming dogma)
3. **Does it replace something we already do?** (`find --query` first, show the candidate)

Useful questions depending on the case:
- "Does this apply to every project or only this one?"
- "How would I notice it was followed?" (a verifiable criterion)
- "Is this a hard rule or just a preference?"

Cases the interview must resolve without getting stuck:

- **No `why`.** If the user does not know or will not say, **do not write the
  note**: a rule without a reason becomes dogma and cannot be reviewed later.
  Offer to store it as `confidence: 0.6` and `why: "undefined"` only if the user
  explicitly accepts.
- **"None, always."** It is a valid answer but leaves the limit empty. Write it
  literally ("None, no exceptions") and raise `confidence`; do not invent a limit
  that does not exist.
- **No verification criterion.** You may derive one from the rule itself ("the
  commit subject contains no emoji") and say it is derived. If nothing comes out,
  leave it empty: `review` will flag it later, which is exactly what you want.
- **Ambiguous scope** ("commits without emoji" — subject or body?). If it changes
  the meaning of the rule, spend a question on it; if not, store what was said and
  do not widen it on your own.

Never more than 3. After saving, show the note in one line and move on.

## 4. WRITING

The script takes JSON from a file: it avoids quoting and multiline problems.
Write the JSON with your file tool in a temp path and pass it with `--json`.

```json
{
  "title": "Tests before saying done",
  "type": "rule",
  "rule": "Run the build and the tests before declaring a task finished.",
  "why": "Twice a task was called done with a broken build.",
  "applies": "Any code change.",
  "not_applies": "Docs or exploration without code.",
  "verify": "build and tests exit 0.",
  "scope": "global",
  "confidence": 0.9,
  "source": "session 2026-11-04"
}
```

```
node $VM add --json "C:\temp\note.json"
node $VM add --json note.json --supersedes "Old note"   # rule that replaces another
```

- `title` human and in the user's language, not a slug. It becomes the file name,
  so two notes cannot share a title (a note replacing another gets a different
  title and they link through `supersedes`/`superseded_by`).
- `labels`: language of this note (`en|es|pt|fr|de`). Pass the user's language;
  without it the machine default applies and a Spanish conversation produces a
  note with English labels.
- `scope`: `global`, the project name, or the stack. If the user says "this
  project" and you do not know its name, use the repo or folder name you are
  working in and say which one you used. Never invent a product or company name.
- `confidence`: 0.9 if the user said it clearly; 0.6 if you inferred it or it is doubtful.
- `type`: `rule`, `preference`, `decision`, `lesson`, `project`, `feedback`, `reference`.
- If the script answers `reason: "possible duplicate..."`: **do not use `--force`**.
  Read the candidate and decide with the user:
  - same rule → `update`
  - it replaces it → `add --json ... --supersedes "<old note>"` (creates the new
    note and marks the old one in a single step; it does not bypass the dedupe)
  - genuinely different → then `--force`

### `update` patch

`update` accepts these keys; anything you leave out stays as it was:

```json
{
  "note": "Tests before saying done",
  "rule": "new rule text (optional)",
  "why": "...", "applies": "...", "not_applies": "...", "verify": "...",
  "notes": "free text for the Notes section (optional)",
  "tags": ["agent-memory", "rule"],
  "type": "rule", "status": "active", "scope": "global", "confidence": 0.9,
  "promoted_to": "<path>/AGENTS.md#section",
  "frontmatter": { "description": "free metadata you want to correct" },
  "confirm": true,
  "history": "reason that gets written into History"
}
```

- `confirm: true` only refreshes `last_confirmed` (for `review`, no text change).
- `frontmatter` corrects free keys (for example a stale `description`); do not
  use it to inject invented fields.
- If you send a different `rule`, the script automatically stores the previous
  text in `## History`. You do not need to copy it by hand.
- `history` is the readable reason for this edit. Use it every time you update.
- The script only rewrites the keys you touch and keeps block order: inherited
  notes are not "normalised". New headings follow the note's own language, and
  history lines are written in that language too.

## 5. EVOLVE — when the rule changes

This is what keeps the memory alive. When the user changes their mind:

```
node $VM update --json patch.json                   # same rule, new nuance
node $VM add --json new.json --supersedes "A"       # it replaces A (recommended)
node $VM supersede --old "A" --new "B"              # if the new note already exists
```

| Change | How |
|---|---|
| Clarified, hardened, a new limit | `update` |
| Scope widened ("now mobile too") | `update` (same topic, it does not replace it) |
| Inverted or contradicted | `add --supersedes` |
| No longer applies, no replacement | `update` with `status: "deprecated"` |

- `supersede` / `--supersedes` mark the old note `superseded`, link the two and
  **do not delete it**: the history explains why.
- `update` leaves the previous rule text in the history when you change `rule`.
- Do not hand-edit notes to "fix" this: the script is what keeps history and
  links consistent.

### Notes that are not rules

Some old notes are just a pointer ("the operative rule lives in AGENTS.md") and
have no `Rule` block. In that case **do not invent the rule text**:

- If the change is to the pointer, update only `why`/`notes`.
- If there is a genuinely new rule, create the note with `add` (`type: rule`) and,
  if it applies, link the old one.
- If the pointer points at `AGENTS.md`, memory and the operative file now say
  different things: say so and offer the `promote` block. Do not edit
  `AGENTS.md` without permission.

## 6. REVIEW — retention

When closing a long work session, or if the user says "let's review my memory":

```
node $VM review --days 60
```

It returns old notes, low-confidence ones and ones with no verification
criterion, plus suggested questions. Ask **only 2 or 3** of them, in one batch.
Classify each answer:
- Still valid → `update` with `{"note": "...", "confirm": true}`
- Changed → `update` with the new text
- No longer applies → `supersede` or `status: "deprecated"`
- Obvious / already in the code → candidate for deletion; ask first.

## 7. PROMOTE — from memory to operative rule

Memory holds the *why*. Rules the agent must always follow belong in the user's
`AGENTS.md` (the cross-tool source of truth).

```
node $VM promote
```

It returns a markdown block ready to paste into `AGENTS.md`, with the wikilink to
the source note. Offer it when a rule keeps coming up or the user asks for
"always". Do not edit `AGENTS.md` unless asked.

**Limit:** it only promotes notes with `type: rule` or `type: preference` that
have rule text. If the note is a pointer ("the operative rule lives in
AGENTS.md", typically `type: feedback`), `promote` returns `count: 0` and there
is no block to offer: tell the user `AGENTS.md` has to be edited by hand, and
record the change in the note's `Notes` / `History` sections.

## 8. KEEPING THE INDEX

After adding or changing notes:

```
node $VM index
```

Regenerates `_Index.md` with links and, when the memory folder contains a
`.base` file, embeds it. The index text itself is always English. Do not edit it
by hand.

## Hard limits

- Do not touch `.obsidian/` or files outside the memory folder.
- Never delete notes or rewrite the user's prose: `supersede` instead of deleting.
- If the user says "forget this": `status: "deprecated"` and explain why it is
  kept (history). Actually deleting is their call.
- If the script fails, report the error as-is. Do not fall back to "write the
  markdown by hand": that breaks the dedupe and the index.

## Note schema

```
---
tags: [agent-memory, <type>]
type: rule | preference | decision | lesson | project | feedback | reference
status: active | superseded | deprecated
scope: global | <project>
confidence: 0-1
created / updated / last_confirmed: YYYY-MM-DD
supersedes / superseded_by: "[[Other note]]"
promoted_to: "<path>/AGENTS.md#section"
source: session YYYY-MM-DD
---
```

Body: `**Rule:**`, `**Why:**`, `**When it applies:**`,
`**When it does NOT apply:**`, `**How to verify:**`, plus optional `## Notes` /
`## History`. Notes written in another language are read and updated in place;
their labels and headings are preserved. The tag follows whatever the vault
already uses (`claude-memory` in older vaults, `agent-memory` otherwise).

## Commands

| Command | For |
|---|---|
| `config --vault "<path>" [--labels es] [--tag x]` | pin the vault once |
| `vault` | which vault and folder it uses |
| `doctor` | status, untagged notes, duplicates |
| `find --query "<q>" [--type] [--tag] [--status] [--limit]` | recall |
| `read --note "<title or path>"` | read in full |
| `add --json <file>` | create (fails on duplicates) |
| `add --json <file> --supersedes "<note>"` | create and replace in one step |
| `update --json <file>` | refine, reconfirm, change status |
| `supersede --old "<a>" --new "<b>"` | link two notes that already exist |
| `review --days N` | retention and suggested questions |
| `promote` | block for AGENTS.md |
| `index` | regenerate `_Index.md` |
