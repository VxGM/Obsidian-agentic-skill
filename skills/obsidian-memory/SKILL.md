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

`config` escribe en `~/.obsidian-memory.json` (configuracion de la maquina, no del
proyecto). Si no puedes o no quieres tocarla, exporta `OBSIDIAN_VAULT` con la
ruta del vault antes de cada comando: el script la respeta por encima de todo.

El script imprime JSON. Lee `ok` antes de asumir que algo funciono.

## Regla de oro

**Nunca escribas en el vault sin haber hecho las preguntas.** Guardar una regla
a medias es peor que no guardarla: queda como verdad falsa y se reutiliza.

## 1. RECALL — antes de trabajar

Antes de tocar codigo en un proyecto con historial, o cuando el tema suene a algo
ya discutido:

```
node $VM find --query "<stack o tema>" --limit 6
node $VM find --type rule
node $VM read --note "<titulo>"
```

- `--query` busca en titulo, tags y cuerpo: es el que sirve para "acuerdate de X".
- `--status active` filtra las vigentes. `find` **no** filtra por estado por
  defecto: devuelve tambien las `superseded`, y tu trabajo es no citarlas como
  ley vigente.
- `--type` filtra por el campo `type`. Usa `--type rule` y tambien
  `--type preference` / `decision` / `lesson`: **todas son restricciones**, no
  solo las reglas. `--tag` es otra cosa: filtra el tag del frontmatter, y una
  preferencia guardada como `[claude-memory, preference]` no aparece ahi.
- Trata lo que devuelve como **restricciones activas**, no como sugerencias.
  Una nota con `confidence` menor a 0.7 presentala como tentativa ("tengo
  anotado que..."), no como ley.
- Si una nota contradice lo que te acaban de pedir: **dilo**. "Esto contradice
  [[Nota X]] — ¿la regla cambio?" No elijas en silencio.
- Ignora notas con `status: superseded` salvo para entender historia.
- Si no hay coincidencias, no inventes memoria. Sigue normal.

### Como responder un recall

El usuario pregunto por su memoria, asi que el recall **es** la respuesta. No
sigas "normal" en silencio: di que encontraste, con wikilink y de donde sale.

```
En memoria hay 2 restricciones activas para la landing:
- [[Landing estilo editorial]] (regla, confianza 0.9): tipografia display grande...
- [[Sin gradientes genericos]] (preferencia, confianza 0.75): ...
Lo que NO tengo guardado: stack, secciones ni copy. ¿Lo capturamos?
```

Si no hay nada, dilo en una linea y ofrece guardarlo. Nunca rellenes el hueco
con una suposicion.

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

Un tema = una nota. Si una nota nueva trata dos cosas (un cambio de ORM es regla
*y* decision), quedate con una sola: `type: rule` y el motivo en `**Por qué:**`.
Duplicar el mismo tema en dos notas garantiza que se desincronicen.

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

Casos que la entrevista tiene que resolver sin bloquearte:

- **No hay `por que`.** Si el usuario no lo sabe o no lo da, **no escribas la
  nota**: una regla sin motivo se vuelve dogma y no se puede revisar despues.
  Ofrece guardarla como `confidence: 0.6` y `why: "sin definir"` solo si el
  usuario lo acepta explicitamente.
- **"Ninguno, siempre."** Es una respuesta valida pero deja el limite vacio.
  Escribelo literal ("Ninguna, sin excepciones") y sube la `confidence`; no
  inventes un limite que no existe.
- **Sin criterio de verificacion.** Puedes derivarlo de la propia regla ("el
  asunto del commit no contiene emoji") y decirlo como derivado. Si no sale,
  dejalo vacio: `review` lo marcara despues, que es justo lo que quieres.
- **Alcance ambiguo** ("commits sin emoji" ¿asunto o cuerpo?). Si cambia el
  sentido de la regla, gasta una pregunta; si no, guarda lo que dijo y no
  amplíes por tu cuenta.

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
node $VM add --json nota.json --supersedes "Nota vieja"   # regla que reemplaza a otra
```

- `title` humano y en espanol, no slug. Se convierte en el nombre del archivo,
  asi que dos notas no pueden compartir titulo (una nota que reemplaza a otra
  lleva titulo distinto y se enlazan por `supersedes`/`superseded_by`).
- `scope`: `global`, o el nombre del proyecto/stack.
- `confidence`: 0.9 si lo dijo claro; 0.6 si lo deduces o dudo.
- `type`: `rule`, `preference`, `decision`, `lesson`, `project`, `feedback`, `reference`.
- Si el script responde `reason: "posible duplicado"`: **no uses `--force`**.
  Lee el candidato y decide con el usuario:
  - es la misma regla → `update`
  - la reemplaza → `add --json ... --supersedes "<nota vieja>"` (crea la nueva y
    marca la vieja en un solo paso; no choca con el dedupe)
  - es otra cosa distinta → ahi si `--force`

### Patch de `update`

`update` acepta estas claves; todo lo que no mandes queda como estaba:

```json
{
  "note": "Tests antes de decir terminado",
  "rule": "texto nuevo de la regla (opcional)",
  "why": "...", "applies": "...", "not_applies": "...", "verify": "...",
  "tags": ["claude-memory", "rule"],
  "type": "rule", "status": "active", "scope": "global", "confidence": 0.9,
  "promoted_to": "<ruta>/AGENTS.md#seccion",
  "frontmatter": { "description": "metadatos libres que quieras corregir" },
  "confirm": true,
  "history": "motivo que queda escrito en el Historial"
}
```

- `confirm: true` solo renueva `last_confirmed` (para `review`, sin cambiar texto).
- `frontmatter` sirve para corregir claves libres (por ejemplo un `description`
  que quedo desactualizado); no lo uses para meter campos inventados.
- Si mandas `rule` distinto, el script guarda automaticamente el texto anterior
  en `## Historial`. No hace falta que lo copies a mano.
- `history` es el motivo legible de esta edicion. Usalo siempre que actualizas.
- El script solo reescribe las claves que tocas y conserva el orden de los
  bloques: las notas heredadas no se "normalizan".

## 5. EVOLVE — cuando la regla cambia

Este es el punto que mantiene la memoria viva. Cuando el usuario cambia de idea:

```
node $VM update --json patch.json                      # misma regla, matiz nuevo
node $VM add --json nueva.json --supersedes "A"        # la reemplaza (recomendado)
node $VM supersede --old "A" --new "B"                 # si la nueva ya existe
```

| Cambio | Como |
|---|---|
| Se aclara, se endurece, se agrega un limite | `update` |
| Se amplía el alcance ("ahora tambien mobile") | `update` (mismo tema, no la reemplaza) |
| Se invierte o contradice | `add --supersedes` |
| Ya no aplica, sin reemplazo | `update` con `status: "deprecated"` |

- `supersede` / `--supersedes` marcan la vieja `superseded`, la enlazan con la
  nueva y **no la borran**: la historia explica por que.
- `update` deja el texto anterior en el historial si cambias `rule`.
- No edites las notas a mano para "arreglar" esto: el script es el que mantiene
  el historial y los enlaces consistentes.

### Notas que no son reglas

Algunas notas viejas son solo un puntero ("la regla vive en AGENTS.md") y no
tienen `**Regla:**`. En ese caso **no inventes el texto de la regla**:

- Si el cambio es del puntero, actualiza solo `why`/`notas`.
- Si hay una regla nueva de verdad, crea la nota con `add` (`type: rule`) y, si
  corresponde, enlaza la vieja.
- Si el puntero apunta a `AGENTS.md`, la memoria y el archivo operativo ahora
  dicen cosas distintas: avisa y ofrece el bloque de `promote`. No edites
  `AGENTS.md` sin permiso.

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

**Limite:** solo promueve notas con `type: rule` o `type: preference` que tengan
texto de regla. Si la nota es un puntero ("la regla operativa vive en
AGENTS.md", tipicamente `type: feedback`), `promote` devuelve `count: 0` y no hay
bloque que ofrecer: en ese caso dile al usuario que hay que editar `AGENTS.md` a
mano, y deja el cambio registrado en `## Notas` / `## Historial` de la nota.

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
para "normalizarlas", el script ya maneja ambos formatos y conserva el orden de
los bloques que ya existian.

## Comandos

| Comando | Para |
|---|---|
| `config --vault "<ruta>"` | fijar el vault una vez |
| `vault` | ver que vault y carpeta usa |
| `doctor` | estado, notas sin tags, duplicados |
| `find --query "<t>" [--type] [--tag] [--status] [--limit]` | recall |
| `read --note "<titulo o ruta>"` | leer completa |
| `add --json <file>` | crear (falla si es duplicado) |
| `add --json <file> --supersedes "<nota>"` | crear y reemplazar en un paso |
| `update --json <file>` | matizar, reconfirmar, cambiar estado |
| `supersede --old "<a>" --new "<b>"` | enlazar dos notas que ya existen |
| `review --days N` | retencion y preguntas |
| `promote` | bloque para AGENTS.md |
| `index` | regenerar `_Index.md` |
