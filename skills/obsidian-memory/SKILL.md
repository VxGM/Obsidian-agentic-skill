---
name: obsidian-memory
description: Memoria persistente y agentica en el vault de Obsidian del usuario. Busca reglas y decisiones antes de trabajar, entrevista al usuario para capturar nuevas reglas o correcciones, actualiza o reemplaza reglas cuando cambian, y revisa la memoria para evitar que envejezca. Usala siempre que el usuario diga "recuerda esto", "guarda en obsidian", "que recuerdes", "anota", "mis reglas", "mi memoria", "como trabajo", "que decidimos", "por que hicimos", o cuando corrija una preferencia, y tambien al empezar una tarea en un proyecto con historial aunque no mencione Obsidian, y cuando dude sobre una convencion que ya se acordo antes. Si el usuario corrige tu trabajo o cambia de criterio, consultala antes de responder.
license: MIT. Terminos completos en LICENSE.txt
argument-hint: "recall <tema> | capture | review | promote"
---

# Memoria agentica en Obsidian

El vault es la memoria a largo plazo. Tu contexto se borra; el vault no.
Objetivo doble: (1) no repetir errores ni volver a preguntar lo que ya se dijo,
(2) que la memoria evolucione cuando el usuario cambia de criterio.

Todo pasa por un script sin dependencias. No requiere Obsidian abierto.

```
$VM = <carpeta-de-esta-skill>/scripts/vault.mjs
node $VM doctor
```

Si `doctor` falla o resuelve el vault equivocado:

```
node $VM config --vault "C:\Users\<tu-usuario>\Obsidian\MiVault"
```

El script imprime JSON. Lee `ok` antes de asumir que algo funciono.

## Regla de oro

**Nunca escribas en el vault sin haber hecho las preguntas.** Guardar una regla
a medias es peor que no guardarla: queda como verdad falsa y se reutiliza.

## 1. RECALL — antes de trabajar

Antes de tocar codigo en un proyecto con historial, o cuando el tema suene a algo
ya discutido:

```
node $VM find --query "<stack o tema>" --limit 6
node $VM find --tag rule
node $VM read --note "<titulo>"
```

- Trata lo que devuelve como **restricciones activas**, no como sugerencias.
- Si una nota contradice lo que te acaban de pedir: **dilo**. "Esto contradice
  [[Nota X]] — ¿la regla cambio?" No elijas en silencio.
- Ignora notas con `status: superseded` salvo para entender historia.
- Si no hay coincidencias, no inventes memoria. Sigue normal.

## 2. CAPTURE — que merece memoria

Guarda solo lo que cambia tu comportamiento en el futuro:

| Si | Entonces |
|---|---|
| Corrige tu trabajo ("no, asi no") | Regla nueva o actualizacion |
| Explica el *por que* de una decision | Decision |
| Dice como quiere el proceso (tests, commits, ramas, review) | Regla |
| Cuenta un bug que ya paso antes | Leccion |
| Prefiere una herramienta, estilo o arquitectura | Preferencia |
| Habla de un proyecto concreto | Proyecto (`scope: <proyecto>`) |

**No guardes:** lo que pediste en el momento, obviedades del lenguaje, detalles
efimeros ("ahora arregla el boton"), ni lo que ya esta en el codigo o en git.

Un tema = una nota. Si la nota nueva trata dos cosas, son dos notas.

## 3. INTERVIEW — como preguntar

Una sola tanda. **Maximo 3 preguntas**, cortas, concretas, y solo las que faltan.
Si ya lo dijo en la conversacion, no lo preguntes otra vez: usalo.

Preguntas obligatorias para una regla nueva:
1. **¿Por que?** (sin esto la nota no sirve — no lo inventes nunca)
2. **¿Cuando NO aplica?** (el limite evita que la regla se vuelva dogma)
3. **¿Reemplaza algo que ya hacemos?** (`find --query` primero, y muestra el candidato)

Preguntas utiles segun el caso:
- "¿Aplica a todos los proyectos o solo a este?"
- "¿Como me doy cuenta de que se cumplio?" (criterio verificable)
- "¿Esto es regla firme o solo preferencia?"

Nunca mas de 3. Despues de guardar, muestra la nota en una linea y sigue.

## 4. ESCRIBIR

El script espera un JSON por archivo: evita problemas de comillas y multilinea.
Escribe el JSON con tu herramienta de escritura en un temporal y pasalo con `--json`.

```json
{
  "title": "Tests antes de decir terminado",
  "type": "rule",
  "rule": "Correr build y tests antes de declarar una tarea terminada.",
  "why": "Dos veces se declaro terminado con el build roto.",
  "applies": "Cualquier cambio de codigo.",
  "not_applies": "Docs o exploracion sin codigo.",
  "verify": "build y tests terminan en 0.",
  "scope": "global",
  "confidence": 0.9,
  "source": "sesion 2026-11-04"
}
```

```
node $VM add --json "C:\ruta\temporal\nota.json"
```

- `title` humano y en espanol, no slug. Se convierte en el nombre del archivo.
- `scope`: `global`, o el nombre del proyecto/stack.
- `confidence`: 0.9 si lo dijo claro; 0.6 si lo deduces o dudo.
- Si el script responde `reason: "posible duplicado"`: **no uses `--force`**.
  Lee el candidato y decide con el usuario: es la misma regla (update) o una
  version nueva (supersede).

## 5. EVOLVE — cuando la regla cambia

Este es el punto que mantiene la memoria viva. Cuando el usuario cambia de idea:

```
node $VM update --json patch.json        # misma regla, matiz nuevo
node $VM supersede --old "A" --new "B"   # regla reemplazada
```

- `update` = la regla sigue siendo la misma, se aclaro o endurecio. El script
  agrega una linea al `## Historial` y sube `last_confirmed`.
- `supersede` = la regla vieja ya no vale. Se marca `superseded`, se enlazan
  entre si y **no se borra**: la historia explica por que.
- Nunca sobreescribas el texto de una regla sin dejar rastro en el historial.
- Si actualizas a mano, agrega la linea `- AAAA-MM-DD motivo` en `## Historial`.

## 6. REVIEW — retencion

Al cerrar una sesion de trabajo largo, o si el usuario dice "revisemos mi memoria":

```
node $VM review --days 60
```

Devuelve notas viejas, de baja confianza o sin criterio de verificacion, y
preguntas sugeridas. Hazle **solo 2 o 3** de esas preguntas, en una tanda.
Clasifica cada respuesta:
- Sigue valiendo → `update` con `{"note": "...", "confirm": true}`
- Cambio → `update` con el texto nuevo
- Ya no aplica → `supersede` o `status: "deprecated"`
- Es obvio / ya esta en el codigo → candidato a borrar; pregunta antes.

## 7. PROMOTE — de memoria a regla operativa

La memoria guarda el *por que*. Las reglas que el agente debe cumplir siempre
van en `AGENTS.md` del usuario (fuente de verdad entre herramientas).

```
node $VM promote
```

Devuelve un bloque markdown listo para pegar en `AGENTS.md`, con el wikilink a
la nota de origen. Proponlo cuando una regla se repite o el usuario la pide
"siempre". No edites `AGENTS.md` sin pedirlo.

## 8. MANTENER EL INDICE

Tras agregar o cambiar notas:

```
node $VM index
```

Regenera `_Index.md` con links y el embed de la Base. No editar a mano.

## Limites duros

- No toques `.obsidian/` ni archivos que no esten en la carpeta de memoria.
- No borres notas ni reescribas prosa del usuario: `supersede` en vez de borrar.
- Si el usuario dice "olvida esto": `status: "deprecated"` y explica por que se
  conserva (historial). Borrar de verdad es decision suya.
- Idioma: espanol, mismo tono que el usuario.
- Si el script falla, reporta el error tal cual. No caigas a "escribir el
  markdown a mano": rompe el dedupe y el indice.

## Esquema de una nota

```
---
tags: [claude-memory, <type>]
type: rule | preference | decision | lesson | project | feedback | reference
status: active | superseded | deprecated
scope: global | <proyecto>
confidence: 0-1
created / updated / last_confirmed: AAAA-MM-DD
supersedes / superseded_by: "[[Otra nota]]"
promoted_to: "<ruta>/AGENTS.md#seccion"
source: sesion AAAA-MM-DD
---
```

Cuerpo: `**Regla:**`, `**Por qué:**`, `**Cuándo aplica:**`,
`**Cuándo NO aplica:**`, `**Cómo verificar:**`, y opcional `## Notas` / `## Historial`.
Las notas viejas con `**Why:**` u otras etiquetas se respetan: no las reescribas
para "normalizarlas", el script ya maneja ambos formatos.

## Comandos

| Comando | Para |
|---|---|
| `config --vault "<ruta>"` | fijar el vault una vez |
| `vault` | ver que vault y carpeta usa |
| `doctor` | estado, notas sin tags, duplicados |
| `find --query "<t>" [--tag] [--type] [--limit]` | recall |
| `read --note "<titulo o ruta>"` | leer completa |
| `add --json <file>` | crear (falla si es duplicado) |
| `update --json <file>` | matizar, reconfirmar, cambiar estado |
| `supersede --old "<a>" --new "<b>"` | reemplazar regla |
| `review --days N` | retencion y preguntas |
| `promote` | bloque para AGENTS.md |
| `index` | regenerar `_Index.md` |
