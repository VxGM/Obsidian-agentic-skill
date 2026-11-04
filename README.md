# obsidian-memory

Skill para agentes de IA que convierte tu vault de Obsidian en **memoria
persistente y agentica**: el agente busca reglas antes de trabajar, te
entrevista para guardar las nuevas, y actualiza la memoria cuando cambias de
criterio.

Funciona con cualquier agente compatible con el formato [Agent Skills](https://agentskills.io)
(Claude Code, Codex, Cursor, opencode, Command Code y ~75 mas), porque se instala
con `npx skills`.

## Instalacion

```bash
npx skills add VxGM/Obsidian-agentic-skill -g
```

`-g` instala a nivel usuario (todos tus proyectos). Sin `-g` se instala en el
proyecto actual.

Elegir agente o nombre explicito:

```bash
npx skills add VxGM/Obsidian-agentic-skill --skill obsidian-memory -a claude-code -a codex -g
```

Sin prompts (CI o instalacion rapida):

```bash
npx skills add VxGM/Obsidian-agentic-skill --skill obsidian-memory --all -y
```

Actualizar despues:

```bash
npx skills update obsidian-memory
```

### Elegir el vault

La primera vez, apunta la skill a tu vault:

```bash
node ~/.agents/skills/obsidian-memory/scripts/vault.mjs config --vault "C:\Users\tu-usuario\Obsidian\MiVault"
```

Si no lo configuras, la skill lo deduce: `OBSIDIAN_VAULT` → vault que ya tiene
carpeta de memoria (`Claude Memory` / `Agent Memory`) → vault abierto en Obsidian.

## Que resuelve

- Tu contexto se borra al cerrar la sesion; el vault no.
- Un agente nuevo no repite errores ni vuelve a preguntar lo mismo.
- Cuando una regla cambia, la vieja no se borra: queda `superseded` con el
  historial del por que, y la nueva la enlaza.

## Flujo

```
RECALL    -> busca reglas activas antes de trabajar
CAPTURE   -> filtra que merece guardarse (una regla = una nota)
INTERVIEW -> max 3 preguntas: por que, cuando NO aplica, reemplaza algo?
EVOLVE    -> update (matiz) o supersede (regla reemplazada)
REVIEW    -> notas viejas, de baja confianza o sin criterio de verificacion
PROMOTE   -> bloque listo para pegar en AGENTS.md
```

Pidele al agente en lenguaje normal ("recuerda que los commits van sin emoji",
"revisemos mi memoria") o invoca `/obsidian-memory`.

## Comandos

| Comando | Para |
|---|---|
| `config --vault "<ruta>"` | fijar el vault una vez |
| `vault` | que vault y carpeta usa |
| `doctor` | estado, notas sin tags, duplicados |
| `find --query "<t>" [--tag] [--type] [--limit]` | recall |
| `read --note "<titulo>"` | leer completa |
| `add --json <file>` | crear, falla si es duplicado |
| `update --json <file>` | matizar, reconfirmar, cambiar estado |
| `supersede --old "<a>" --new "<b>"` | reemplazar regla |
| `review --days N` | retencion y preguntas sugeridas |
| `promote` | bloque para AGENTS.md |
| `index` | regenerar `_Index.md` |

Todo devuelve JSON. `add` y `update` reciben un archivo JSON: evita el infierno
de comillas de `cmd` y de los mensajes multilinea.

```bash
node scripts/vault.mjs find --query "testing" --limit 5
node scripts/vault.mjs add --json nota.json
```

## Esquema de nota

```yaml
tags: [claude-memory, rule]
type: rule | preference | decision | lesson | project | feedback | reference
status: active | superseded | deprecated
scope: global | <proyecto>
confidence: 0.9
created / updated / last_confirmed: 2026-11-04
supersedes / superseded_by: "[[Otra nota]]"
promoted_to: "C:\Users\ASUS\AGENTS.md#seccion"
```

Cuerpo: `**Regla:**`, `**Por qué:**`, `**Cuándo aplica:**`,
`**Cuándo NO aplica:**`, `**Cómo verificar:**` y `## Historial`.

**Convive con vaults existentes:** las etiquetas y secciones que no conoce
(`**Why:**`, `**Operative rule now lives in:**`, frontmatter extra) se preservan
tal cual. Nunca reescribe prosa que no genero.

## Por que un script y no solo instrucciones

Buscar, deduplicar, enlazar y versionar reglas a mano produce notas duplicadas,
reglas contradictorias y perdida de historial. El script es determinista:
`add` rechaza duplicados (similitud >= 0.6) mostrando el candidato, `supersede`
siempre deja rastro enlazado.

Sin dependencias, sin MCP, sin Obsidian abierto: Node 18+ y acceso al `.md`.

## Estructura

```
skills/obsidian-memory/
├── SKILL.md          # el playbook que lee el agente
└── scripts/vault.mjs # CLI determinista
```

## Licencia

MIT
