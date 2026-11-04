> A skill for the [Agent Skills](https://agentskills.io/specification) standard. Install with `npx skills`.

# obsidian-memory

Turns your Obsidian vault into **persistent, agentic memory** for AI agents. The
agent looks up rules before it starts working, interviews you to store new ones,
and updates the memory when you change your mind.

The problem it solves: your context is wiped when the session ends, the vault is
not. A fresh agent does not repeat mistakes or ask again what you already told
it — and does not keep an outdated rule either when you changed your opinion.

## Requirements

- Node.js 18 or newer
- An Obsidian vault (Obsidian does not need to be running: the script writes the `.md` files directly)

## Install

```bash
npx skills add VxGM/Obsidian-agentic-skill -g
```

`-g` installs for the current user (all projects). Without `-g` it installs into
the current project.

Pick a specific agent or skill:

```bash
npx skills add VxGM/Obsidian-agentic-skill --skill obsidian-memory -a <agent> -g
```

Non-interactive (CI or quick install):

```bash
npx skills add VxGM/Obsidian-agentic-skill --skill obsidian-memory --all -y
```

Update later:

```bash
npx skills update obsidian-memory
```

### Point it at your vault

The first time, tell the skill where your vault is:

```bash
node ~/.agents/skills/obsidian-memory/scripts/vault.mjs config --vault "C:\Users\<you>\Obsidian\MyVault"
```

Without config it is resolved in this order: `OBSIDIAN_VAULT` → a vault that
already has a memory folder (`Claude Memory` / `Agent Memory`) → the vault open
in Obsidian.

## Use

Just ask in plain language:

- "remember that commits go without emoji"
- "save that this project uses Drizzle, not Prisma"
- "changed my mind, I do want tests before every commit now"
- "let's review my memory"

Or invoke the skill directly: `/obsidian-memory recall testing`.

## How it works

```
RECALL    -> look up active rules before working
CAPTURE   -> filter what deserves storing (one rule = one note)
INTERVIEW -> max 3 questions: why, when it does NOT apply, what it replaces
EVOLVE    -> update (nuance) or supersede (replaced rule)
REVIEW    -> old, low-confidence or unverifiable notes
PROMOTE   -> block ready to paste into AGENTS.md
```

The rule that keeps memory alive: **a rule that changes is not deleted**. It is
marked `superseded`, linked to the new one, and both keep the history of why.
That is what lets you understand past decisions without carrying them forward.

## Commands

| Command | For |
|---|---|
| `config --vault "<path>" [--labels es] [--tag x]` | pin the vault once |
| `vault` | which vault and folder it uses |
| `doctor` | status, untagged notes, duplicates |
| `find --query "<q>" [--type] [--tag] [--status] [--limit]` | recall |
| `read --note "<title>"` | read in full |
| `add --json <file>` | create, fails on duplicates |
| `add --json <file> --supersedes "<note>"` | create and replace in one step |
| `update --json <file>` | refine, reconfirm, change status |
| `supersede --old "<a>" --new "<b>"` | replace a rule |
| `review --days N` | retention and suggested questions |
| `promote` | block for AGENTS.md |
| `index` | regenerate `_Index.md` |

Everything returns JSON. `add` and `update` take a JSON file: that avoids the
quote escaping hell of `cmd` and multiline messages.

```bash
node scripts/vault.mjs find --query "testing" --limit 5
node scripts/vault.mjs add --json note.json
```

## Note schema

```yaml
tags: [agent-memory, rule]
type: rule | preference | decision | lesson | project | feedback | reference
status: active | superseded | deprecated
scope: global | <project>
confidence: 0.9
created / updated / last_confirmed: 2026-11-04
supersedes / superseded_by: "[[Other note]]"
promoted_to: "<path>/AGENTS.md#section"
```

Body: `**Rule:**`, `**Why:**`, `**When it applies:**`,
`**When it does NOT apply:**`, `**How to verify:**` and `## History`.

**Languages:** block labels are read in English, Spanish, Portuguese, French and
German, and each note keeps the language it already uses — an older note written
with `**Regla:**` is updated in place, not rewritten. New notes follow
`config --labels <en|es|pt|fr|de>` (English by default). The agent always answers
the user in the user's language.

**Works with existing vaults:** only the keys a command touches are rewritten.
Everything else (including block scalars `|`, block lists and labels such as
`**Why:**`) is emitted exactly as it was.

## Why a script and not just instructions

Searching, deduplicating, linking and versioning rules by hand produces duplicate
notes, contradictory rules and lost history. The script is deterministic: `add`
rejects duplicates (similarity ≥ 0.6) showing the candidate, `supersede` always
leaves a linked trace.

No dependencies, no MCP, no Obsidian running: just Node and filesystem access.

## Structure

```
skills/obsidian-memory/
├── SKILL.md          # the playbook the agent reads
├── LICENSE.txt
├── evals/evals.json  # test prompts for validating changes
└── scripts/vault.mjs # deterministic CLI
```

## Supported agents

Any agent implementing the Agent Skills standard. `npx skills` recognises Claude
Code, Codex, Cursor, opencode, Command Code and others; run `npx skills list -g`
to see where it landed.

## Contributing

1. Edit `skills/obsidian-memory/SKILL.md` or `scripts/vault.mjs`.
2. Test the CLI against a scratch vault, never against your real one.
3. If you change behaviour, add the case to `evals/evals.json`.
4. `node scripts/vault.mjs doctor` must still answer `ok: true`.

## License

MIT. See [LICENSE](LICENSE).
