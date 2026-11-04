> Skill para el estándar [Agent Skills](https://agentskills.io/specification). Instalable con `npx skills`.

# obsidian-memory

Convierte tu vault de Obsidian en **memoria persistente y agentica** para agentes
de IA. El agente busca reglas antes de trabajar, te entrevista para guardar las
nuevas, y actualiza la memoria cuando cambias de criterio.

El problema que resuelve: tu contexto se borra al cerrar la sesión, el vault no.
Un agente nuevo no repite errores ni vuelve a preguntar lo que ya le dijiste,
pero tampoco se queda con una regla vieja cuando cambiaste de opinión.

## Requisitos

- Node.js 18 o superior
- Un vault de Obsidian (opcional tener Obsidian abierto: el script escribe los `.md` directamente)

## Instalación

```bash
npx skills add VxGM/Obsidian-agentic-skill -g
```

`-g` instala a nivel usuario (todos tus proyectos). Sin `-g` se instala en el
proyecto actual.

Elegir agente o nombre explícito:

```bash
npx skills add VxGM/Obsidian-agentic-skill --skill obsidian-memory -a <agente> -g
```

Sin prompts (CI o instalación rápida):

```bash
npx skills add VxGM/Obsidian-agentic-skill --skill obsidian-memory --all -y
```

Actualizar después:

```bash
npx skills update obsidian-memory
```

### Elegir el vault

La primera vez, apunta la skill a tu vault:

```bash
node ~/.agents/skills/obsidian-memory/scripts/vault.mjs config --vault "C:\Users\<tu-usuario>\Obsidian\MiVault"
```

Si no lo configuras, se deduce en este orden: `OBSIDIAN_VAULT` → vault que ya
tiene carpeta de memoria (`Claude Memory` / `Agent Memory`) → vault abierto en
Obsidian.

## Uso

Pídeselo en lenguaje normal:

- "recuerda que los commits van sin emoji"
- "guarda que en este proyecto usamos Drizzle, no Prisma"
- "cambié de idea, ahora sí quiero tests antes de cada commit"
- "revisemos mi memoria"

O invoca la skill directamente: `/obsidian-memory recall testing`.

## Cómo funciona

```
RECALL    -> busca reglas activas antes de trabajar
CAPTURE   -> filtra qué merece guardarse (una regla = una nota)
INTERVIEW -> máx 3 preguntas: por qué, cuándo NO aplica, reemplaza algo?
EVOLVE    -> update (matiz) o supersede (regla reemplazada)
REVIEW    -> notas viejas, de baja confianza o sin criterio de verificación
PROMOTE   -> bloque listo para pegar en AGENTS.md
```

La regla que mantiene la memoria viva: **una regla que cambia no se borra**. Se
marca `superseded`, se enlaza con la nueva y ambas guardan el historial de por
qué. Eso es lo que permite entender decisiones pasadas sin arrastrarlas.

## Comandos

| Comando | Para |
|---|---|
| `config --vault "<ruta>"` | fijar el vault una vez |
| `vault` | qué vault y carpeta usa |
| `doctor` | estado, notas sin tags, duplicados |
| `find --query "<t>" [--tag] [--type] [--limit]` | recall |
| `read --note "<titulo>"` | leer completa |
| `add --json <file>` | crear, falla si es duplicado |
| `update --json <file>` | matizar, reconfirmar, cambiar estado |
| `supersede --old "<a>" --new "<b>"` | reemplazar regla |
| `review --days N` | retención y preguntas sugeridas |
| `promote` | bloque para AGENTS.md |
| `index` | regenerar `_Index.md` |

Todo devuelve JSON. `add` y `update` reciben un archivo JSON: evita el infierno
de comillas de `cmd` y de los mensajes multilínea.

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
promoted_to: "<ruta>/AGENTS.md#seccion"
```

Cuerpo: `**Regla:**`, `**Por qué:**`, `**Cuándo aplica:**`,
`**Cuándo NO aplica:**`, `**Cómo verificar:**` y `## Historial`.

**Convive con vaults existentes:** solo reescribe las claves que el comando
tocó. Las propiedades que no modifica (incluidos block scalars `|`, listas en
bloque y etiquetas como `**Why:**`) se reemiten tal como estaban.

## Por qué un script y no solo instrucciones

Buscar, deduplicar, enlazar y versionar reglas a mano produce notas duplicadas,
reglas contradictorias y pérdida de historial. El script es determinista:
`add` rechaza duplicados (similitud ≥ 0.6) mostrando el candidato, `supersede`
siempre deja rastro enlazado.

Sin dependencias, sin MCP, sin Obsidian abierto: Node y acceso al sistema de archivos.

## Estructura

```
skills/obsidian-memory/
├── SKILL.md          # el playbook que lee el agente
├── LICENSE.txt
├── evals/evals.json  # prompts de prueba para validar cambios
└── scripts/vault.mjs # CLI determinista
```

## Agentes soportados

Cualquier agente que implemente el estándar Agent Skills. `npx skills` reconoce
Claude Code, Codex, Cursor, opencode, Command Code y otros; consulta
`npx skills list -g` para ver dónde quedó instalada.

## Contribuir

1. Edita `skills/obsidian-memory/SKILL.md` o `scripts/vault.mjs`.
2. Prueba el CLI contra un vault de prueba, no contra tu vault real.
3. Si cambias comportamiento, agrega el caso a `evals/evals.json`.
4. `node scripts/vault.mjs doctor` debe seguir respondiendo `ok: true`.

## Licencia

MIT. Ver [LICENSE](LICENSE).
