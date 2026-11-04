# obsidian-memory

Skill agentica que convierte tu vault de Obsidian en memoria persistente para
cualquier agente de IA (Command Code, Claude Code, Codex, opencode, ...).

El agente **pregunta antes de guardar**, **actualiza** cuando cambias de criterio y
**revisa** la memoria para que no envejezca. Sin plugins, sin Obsidian abierto:
lee y escribe los `.md` del vault directamente.

## Que resuelve

- Tu contexto se borra al cerrar la sesion; el vault no.
- Un agente nuevo no repite errores ni vuelve a preguntar lo mismo.
- Cuando una regla cambia, la vieja no se borra: queda `superseded` con el
  historial de por que, y la nueva la enlaza.

## Instalacion

```bat
xcopy /E /I /Y ".commandcode\skills\obsidian-memory" "%USERPROFILE%\.agents\skills\obsidian-memory"
node "%USERPROFILE%\.agents\skills\obsidian-memory\scripts\vault.mjs" config --vault "C:\Users\ASUS\Obsidian\PP"
```

`.agents\skills` lo leen varias herramientas. Si solo usas Command Code:
`%USERPROFILE%\.commandcode\skills\`.

El vault se resuelve en este orden: `OBSIDIAN_VAULT` → `~/.obsidian-memory.json`
→ vault que ya tiene carpeta de memoria → vault abierto.

## Uso

Pidele al agente en lenguaje normal:

- "recuerda que los commits van sin emoji"
- "guarda que en este proyecto usamos Drizzle, no Prisma"
- "revisemos mi memoria"

O invoca la skill: `/obsidian-memory recall testing`, `/obsidian-memory review`.

## Flujo

```
RECALL  -> busca reglas activas antes de trabajar
CAPTURE -> filtra que merece guardarse (una regla = una nota)
INTERVIEW -> max 3 preguntas: por que, cuando NO aplica, reemplaza algo?
EVOLVE  -> update (matiz) o supersede (regla reemplazada)
REVIEW  -> notas viejas o sin criterio de verificacion
PROMOTE -> bloque listo para AGENTS.md
```

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

Todo devuelve JSON. `add` y `update` reciben un archivo JSON (evita infierno de
comillas en cmd).

## Esquema

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

Cuerpo: `**Regla:**`, `**Por qué:**`, `**Cuándo aplica:**`, `**Cuándo NO aplica:**`,
`**Cómo verificar:**`, `## Historial`.

Convive con el esquema viejo (`**Why:**`, `type: feedback`): las etiquetas y
secciones desconocidas se preservan tal cual, nunca se reescriben.

## Por que un script y no solo instrucciones

Buscar, deduplicar, enlazar y versionar reglas a mano produce notas duplicadas,
reglas contradictorias y perdida de historial. El script es determinista:
`add` rechaza duplicados con similitud >= 0.6, `supersede` siempre deja rastro.

Sin dependencias: Node 18+.
