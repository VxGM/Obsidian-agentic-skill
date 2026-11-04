#!/usr/bin/env node
// Memoria agentica en un vault de Obsidian. Sin dependencias, sin Obsidian abierto.
// Uso: node vault.mjs <comando> [flags]   -> imprime JSON a stdout
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const argv = process.argv.slice(2);
const cmd = argv[0];

function flag(name, def) {
  const i = argv.indexOf('--' + name);
  if (i === -1) return def;
  const v = argv[i + 1];
  if (v === undefined || v.startsWith('--')) return true;
  return v;
}

function die(msg) {
  out({ ok: false, error: msg });
  process.exit(1);
}

function out(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
}

// Local date, not UTC: the notes belong to the user, not to the server.
const today = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

// Language for new notes, set once with `config --labels es` (default English).
function memoryLabelsLang() {
  const l = readConfig().labels;
  return l && LANG_LABELS[l] ? l : 'en';
}

function vaultConfigPath() {
  if (process.platform === 'win32') return path.join(process.env.APPDATA || '', 'obsidian', 'obsidian.json');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'obsidian', 'obsidian.json');
  return path.join(os.homedir(), '.config', 'obsidian', 'obsidian.json');
}

const CONFIG_FILE = path.join(os.homedir(), '.obsidian-memory.json');

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function hasMemoryFolder(p) {
  return ['Claude Memory', 'Agent Memory'].some((c) => fs.existsSync(path.join(p, c)));
}

function resolveVault() {
  if (process.env.OBSIDIAN_VAULT) return path.resolve(process.env.OBSIDIAN_VAULT);

  const conf = readConfig();
  if (conf.vault && fs.existsSync(conf.vault)) return conf.vault;

  const cfg = vaultConfigPath();
  if (fs.existsSync(cfg)) {
    try {
      const j = JSON.parse(fs.readFileSync(cfg, 'utf8'));
      const vaults = Object.values(j.vaults || {}).filter((v) => fs.existsSync(v.path));
      const pick =
        vaults.find((v) => hasMemoryFolder(v.path)) ||
        vaults.find((v) => v.open) ||
        vaults[0];
      if (pick) return pick.path;
    } catch { /* ignore corrupt config */ }
  }
  die('Could not resolve the vault. Run: node vault.mjs config --vault "<path>"');
}

function memoryDir(vault) {
  const env = process.env.OBSIDIAN_MEMORY_DIR;
  if (env) return path.isAbsolute(env) ? env : path.join(vault, env);
  const conf = readConfig();
  if (conf.memory_dir) return path.isAbsolute(conf.memory_dir) ? conf.memory_dir : path.join(vault, conf.memory_dir);
  for (const c of ['Claude Memory', 'Agent Memory']) {
    if (fs.existsSync(path.join(vault, c))) return path.join(vault, c);
  }
  return path.join(vault, 'Agent Memory');
}

// Tag for new notes: follows the convention the vault already uses, so a
// memory folder created by another tool is not fragmented.
let cachedTag = null;
function memoryTag() {
  if (cachedTag) return cachedTag;
  const conf = readConfig();
  if (conf.tag) return (cachedTag = conf.tag);
  for (const n of listNotes(dir)) {
    const tags = Array.isArray(n.fm.tags) ? n.fm.tags : [];
    if (tags.includes('claude-memory')) return (cachedTag = 'claude-memory');
    if (tags.includes('agent-memory')) return (cachedTag = 'agent-memory');
  }
  return (cachedTag = 'agent-memory');
}

// ---------- frontmatter ----------
function unq(s) {
  let v = String(s).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  return v;
}

// Frontmatter is parsed as entries and the raw lines are kept, so block
// scalars (| >), block lists and unknown keys are never lost.
function parseYamlEntries(src) {
  const entries = [];
  for (const line of src.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const kv = /^([A-Za-z0-9_-]+):[ \t]*(.*)$/.exec(line);
    if (kv) entries.push({ key: kv[1], raw: [line], inline: kv[2].trim() });
    else if (entries.length) entries[entries.length - 1].raw.push(line);
  }
  return entries;
}

function entriesToFm(entries) {
  const fm = {};
  for (const e of entries) {
    const cont = e.raw.slice(1).map((l) => l.replace(/^[ \t]+/, ''));
    let val;
    if (/^[|>][-+]?$/.test(e.inline)) {
      val = cont.join('\n').trim();
    } else if (!e.inline) {
      val = cont.some((l) => /^-\s+/.test(l))
        ? cont.map((l) => unq(l.replace(/^-\s+/, ''))).filter((s) => s !== '')
        : cont.join('\n').trim();
    } else if (e.inline.startsWith('[') && e.inline.endsWith(']')) {
      val = e.inline.slice(1, -1).split(',').map((s) => unq(s)).filter((s) => s !== '');
    } else {
      val = unq(e.inline);
    }
    fm[e.key] = val;
  }
  return fm;
}

const FM_ORDER = ['tags', 'type', 'status', 'scope', 'confidence', 'created', 'updated', 'last_confirmed', 'supersedes', 'superseded_by', 'promoted_to', 'source'];

// Escapa solo cuando YAML lo exige. Antes se cambiaban las comillas por
// apostrofes, lo que alteraba el texto del usuario.
function yamlScalar(v) {
  const s = String(v);
  if (s === '') return '""';
  const risky =
    /^[\s\-?:,\[\]{}#&*!|>'"%@`]/.test(s) ||
    /: |\s#|[\r\n]/.test(s) ||
    /^(true|false|null|~)$/i.test(s);
  if (!risky) return s;
  return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\n') + '"';
}

function formatEntry(key, v) {
  if (Array.isArray(v)) return [`${key}: [${v.map((x) => yamlScalar(x)).join(', ')}]`];
  const s = String(v);
  if (s.includes('\n')) return [`${key}: |`, ...s.split('\n').map((l) => '  ' + l)];
  return [`${key}: ${yamlScalar(v)}`];
}

// Reescribe las claves tocadas en su sitio; el resto se emite tal cual estaba.
function toYaml(entries, fm, touched) {
  const out = [];
  const written = new Set();
  for (const e of entries) {
    if (!touched.has(e.key)) {
      out.push(...e.raw);
      continue;
    }
    written.add(e.key);
    if (fm[e.key] !== undefined && fm[e.key] !== '') out.push(...formatEntry(e.key, fm[e.key]));
  }
  for (const k of FM_ORDER) {
    if (touched.has(k) && !written.has(k) && fm[k] !== undefined && fm[k] !== '') out.push(...formatEntry(k, fm[k]));
  }
  // Claves libres del frontmatter (description, etc.) que el comando toco.
  for (const k of touched) {
    if (written.has(k) || FM_ORDER.includes(k)) continue;
    if (fm[k] !== undefined && fm[k] !== '') out.push(...formatEntry(k, fm[k]));
  }
  return out.join('\n');
}

function parseNote(file) {
  const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  const entries = m ? parseYamlEntries(m[1]) : [];
  const fm = entriesToFm(entries);
  const body = m ? m[2] : raw;
  return { file, title: path.basename(file, '.md'), fm, entries, body, ...parseBody(body) };
}

// Canonical block names are English; notes keep whichever language they already
// use. These aliases let notes written in any supported language be read and
// updated in place, and the original label is always preserved on rewrite.
const LANG_LABELS = {
  en: { Rule: 'Rule', Why: 'Why', 'When it applies': 'When it applies', 'When it does NOT apply': 'When it does NOT apply', 'How to verify': 'How to verify', history: 'History', notes: 'Notes' },
  es: { Rule: 'Regla', Why: 'Por qué', 'When it applies': 'Cuándo aplica', 'When it does NOT apply': 'Cuándo NO aplica', 'How to verify': 'Cómo verificar', history: 'Historial', notes: 'Notas' },
  pt: { Rule: 'Regra', Why: 'Por quê', 'When it applies': 'Quando se aplica', 'When it does NOT apply': 'Quando NÃO se aplica', 'How to verify': 'Como verificar', history: 'Histórico', notes: 'Notas' },
  fr: { Rule: 'Règle', Why: 'Pourquoi', 'When it applies': "Quand ça s'applique", 'When it does NOT apply': "Quand ça ne s'applique pas", 'How to verify': 'Comment vérifier', history: 'Historique', notes: 'Notes' },
  de: { Rule: 'Regel', Why: 'Warum', 'When it applies': 'Wann gilt es', 'When it does NOT apply': 'Wann gilt es nicht', 'How to verify': 'Wie prüfen', history: 'Verlauf', notes: 'Notizen' },
};

const LABEL_ALIASES = { rule: 'Rule', reason: 'Why', verification: 'How to verify', 'por que': 'Why', 'when to use': 'When it applies' };
for (const set of Object.values(LANG_LABELS)) {
  for (const [canon, label] of Object.entries(set)) {
    if (canon === 'history' || canon === 'notes') continue;
    LABEL_ALIASES[label.trim().toLowerCase().replace(/\s+/g, ' ')] = canon;
  }
}

function canonLabel(label) {
  const key = label.trim().toLowerCase().replace(/\s+/g, ' ');
  return LABEL_ALIASES[key] || label.trim();
}

const SECTION_ORDER = ['Rule', 'Why', 'When it applies', 'When it does NOT apply', 'How to verify'];

// Which language does this note already speak? Only switches away from English
// when there is positive evidence (labels or headings) of another language.
function detectLang(blocks, headings = []) {
  const texts = [...blocks.map((b) => b.label), ...headings.filter(Boolean)].map((t) => String(t).toLowerCase());
  let best = 'en';
  let bestScore = 0;
  for (const [lang, set] of Object.entries(LANG_LABELS)) {
    if (lang === 'en') continue;
    const labels = [...SECTION_ORDER.map((c) => set[c]), set.history, set.notes].map((x) => x.toLowerCase());
    const score = texts.filter((t) => labels.includes(t)).length;
    if (score > bestScore) {
      bestScore = score;
      best = lang;
    }
  }
  return best;
}

function labelFor(lang, canon) {
  const set = LANG_LABELS[lang] || LANG_LABELS.en;
  return set[canon] || canon;
}

// History lines follow the note's language, not the machine's.
const HISTORY_TEXT = {
  en: { created: (s) => `created (${s})`, supersededBy: (t) => `superseded by [[${t}]]`, supersedes: (t) => `supersedes [[${t}]]`, updated: () => 'updated', prevRule: (r) => `previous rule text: "${r}"` },
  es: { created: (s) => `creado (${s})`, supersededBy: (t) => `reemplazada por [[${t}]]`, supersedes: (t) => `reemplaza a [[${t}]]`, updated: () => 'actualizada', prevRule: (r) => `regla anterior: "${r}"` },
  pt: { created: (s) => `criado (${s})`, supersededBy: (t) => `substituído por [[${t}]]`, supersedes: (t) => `substitui [[${t}]]`, updated: () => 'atualizado', prevRule: (r) => `regra anterior: "${r}"` },
  fr: { created: (s) => `créé (${s})`, supersededBy: (t) => `remplacé par [[${t}]]`, supersedes: (t) => `remplace [[${t}]]`, updated: () => 'mis à jour', prevRule: (r) => `règle précédente : « ${r} »` },
  de: { created: (s) => `erstellt (${s})`, supersededBy: (t) => `ersetzt durch [[${t}]]`, supersedes: (t) => `ersetzt [[${t}]]`, updated: () => 'aktualisiert', prevRule: (r) => `vorherige Regel: "${r}"` },
};

function hist(lang, key, arg) {
  const t = HISTORY_TEXT[lang] || HISTORY_TEXT.en;
  return t[key](arg);
}

const H2_ALIASES = {
  history: Object.values(LANG_LABELS).map((s) => s.history.toLowerCase()),
  notes: Object.values(LANG_LABELS).map((s) => s.notes.toLowerCase()),
};

function parseBody(body) {
  const parts = body.split(/^## /m);
  const head = parts[0];
  const blocks = [];
  for (const line of head.split(/\r?\n/)) {
    const m = /^\*\*([^*]+):\*\*\s*(.*)$/.exec(line);
    if (m) blocks.push({ label: m[1].trim(), canon: canonLabel(m[1]), text: m[2].trim() });
  }
  const tail = parts.length > 1 ? '## ' + parts.slice(1).join('## ') : '';
  const grab = (kind) => {
    for (const alt of H2_ALIASES[kind]) {
      const r = new RegExp(`## ${alt}\\r?\\n([\\s\\S]*?)(?=\\r?\\n## |$)`, 'i').exec(tail);
      if (r) return { text: r[1].trim(), heading: r[0].split(/\r?\n/)[0].slice(3).trim() };
    }
    return { text: '', heading: null };
  };
  const hist = grab('history');
  const nt = grab('notes');
  return {
    blocks,
    sections: Object.fromEntries(blocks.map((b) => [b.canon, b.text])),
    historial: hist.text,
    historialHeading: hist.heading,
    notas: nt.text,
    notasHeading: nt.heading,
  };
}

function setBlock(blocks, label, text) {
  const canon = canonLabel(label);
  const found = blocks.find((b) => b.canon === canon);
  if (found) {
    found.text = text;
    return;
  }
  const entry = { label, canon, text };
  if (!SECTION_ORDER.includes(canon)) {
    blocks.push(entry);
    return;
  }
  // Inserts in canonical position without moving blocks that already existed.
  const next = blocks.find((b) => SECTION_ORDER.includes(b.canon) && SECTION_ORDER.indexOf(b.canon) > SECTION_ORDER.indexOf(canon));
  if (next) {
    blocks.splice(blocks.indexOf(next), 0, entry);
    return;
  }
  const lastKnown = [...blocks].reverse().find((b) => SECTION_ORDER.includes(b.canon));
  if (lastKnown) blocks.splice(blocks.indexOf(lastKnown) + 1, 0, entry);
  else blocks.unshift(entry);
}

// Keeps the order the user had: new blocks are added, existing ones never move.
function renderBody(note) {
  const blocks = (note.blocks || []).filter((b) => b.text);
  let body = blocks.map((b) => `**${b.label}:** ${b.text}`).join('\n\n');
  if (body) body += '\n';
  if (note.notas) body += `\n## ${note.notasHeading || 'Notes'}\n${note.notas}\n`;
  if (note.historial) body += `\n## ${note.historialHeading || 'History'}\n${note.historial}\n`;
  return body;
}

// ---------- index ----------
function listNotes(dir) {
  if (!fs.existsSync(dir)) return [];
  const acc = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.toLowerCase().endsWith('.md') && e.name !== '_Index.md') acc.push(parseNote(p));
    }
  };
  walk(dir);
  return acc;
}

const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const tokens = (s) => norm(s).split(/[^a-z0-9]+/).filter((w) => w.length > 2);

function search(notes, query, opts = {}) {
  const q = tokens(query);
  const res = [];
  for (const n of notes) {
    if (opts.type && n.fm.type !== opts.type) continue;
    if (opts.status && (n.fm.status || 'active') !== opts.status) continue;
    if (opts.tag) {
      const tags = Array.isArray(n.fm.tags) ? n.fm.tags.map(norm) : [];
      if (!tags.includes(norm(opts.tag))) continue;
    }
    const title = norm(n.title + ' ' + (n.fm.scope || ''));
    const tags = Array.isArray(n.fm.tags) ? norm(n.fm.tags.join(' ')) : '';
    const body = norm(n.body);
    let score = 0;
    for (const t of q) {
      if (title.includes(t)) score += 6;
      if (tags.includes(t)) score += 3;
      const hits = body.split(t).length - 1;
      score += Math.min(hits, 5);
    }
    if (!q.length) score = 1;
    if (score > 0) res.push({ score, note: n });
  }
  return res.sort((a, b) => b.score - a.score || a.note.title.localeCompare(b.note.title));
}

function brief(n) {
  return {
    title: n.title,
    type: n.fm.type || null,
    status: n.fm.status || 'active',
    scope: n.fm.scope || null,
    rule: n.sections.Rule || null,
    updated: n.fm.updated || null,
    path: n.file,
  };
}

function findNote(notes, ref) {
  if (!ref) return null;
  const target = norm(ref).replace(/\.md$/, '');
  return (
    notes.find((n) => norm(path.basename(n.file)) === target) ||
    notes.find((n) => norm(n.file).endsWith(norm(ref))) ||
    notes.find((n) => norm(n.title) === target) ||
    null
  );
}

function jaccard(a, b) {
  const A = new Set(tokens(a));
  const B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

function safeName(title) {
  return title
    .replace(/[\\/:*?"<>|#^[\]]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 90);
}

// ---------- commands ----------
if (cmd === 'config') {
  const v = flag('vault');
  if (!v || v === true) out({ ok: true, config_file: CONFIG_FILE, config: readConfig(), hint: 'To pin the vault: node vault.mjs config --vault "<path-to-vault>"' });
  else {
    if (!fs.existsSync(v)) die(`That path does not exist: ${v}`);
    const conf = { vault: path.resolve(v) };
    const md = flag('memory-dir');
    if (md && md !== true) conf.memory_dir = md;
    const lb = flag('labels');
    if (lb && lb !== true) conf.labels = lb;
    const tg = flag('tag');
    if (tg && tg !== true) conf.tag = tg;
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(conf, null, 2), 'utf8');
    out({ ok: true, saved: CONFIG_FILE, config: conf, memory_dir: memoryDir(conf.vault) });
  }
  process.exit(0);
}

const vault = resolveVault();
const dir = memoryDir(vault);

switch (cmd) {
  case 'vault': {
    out({ ok: true, vault, memory_dir: dir, exists: fs.existsSync(dir) });
    break;
  }

  case 'doctor': {
    const notes = listNotes(dir);
    const warnings = [];
    for (const n of notes) {
      const tags = Array.isArray(n.fm.tags) ? n.fm.tags : [];
      if (!tags.length) warnings.push({ title: n.title, issue: 'no tags (expected [agent-memory, <type>])' });
      if (!n.fm.type) warnings.push({ title: n.title, issue: 'no type' });
      if (!n.fm.status) warnings.push({ title: n.title, issue: 'no status (defaults to active)' });
      if (!n.sections.Rule && !n.sections.Why) warnings.push({ title: n.title, issue: 'missing a Rule/Why section' });
    }
    const titles = new Map();
    for (const n of notes) titles.set(norm(n.title), (titles.get(norm(n.title)) || 0) + 1);
    const dups = [...titles.entries()].filter(([, c]) => c > 1).map(([t]) => t);
    out({
      ok: true,
      vault,
      memory_dir: dir,
      notes: notes.length,
      by_status: notes.reduce((a, n) => ((a[n.fm.status || 'active'] = (a[n.fm.status || 'active'] || 0) + 1), a), {}),
      by_type: notes.reduce((a, n) => ((a[n.fm.type || 'untyped'] = (a[n.fm.type || 'untyped'] || 0) + 1), a), {}),
      duplicate_titles: dups,
      warnings,
    });
    break;
  }

  case 'find': {
    const q = flag('query', '');
    const notes = listNotes(dir);
    const res = search(notes, q, { type: flag('type'), status: flag('status'), tag: flag('tag') });
    const limit = Number(flag('limit', 8));
    out({ ok: true, query: q, total: res.length, matches: res.slice(0, limit).map((r) => ({ score: r.score, ...brief(r.note) })) });
    break;
  }

  case 'read': {
    const notes = listNotes(dir);
    const n = findNote(notes, flag('note'));
    if (!n) die(`Note not found: "${flag('note')}".`);
    out({ ok: true, ...brief(n), frontmatter: n.fm, body: n.body.trim() });
    break;
  }

  case 'add': {
    const jf = flag('json');
    if (!jf || jf === true) die('Missing --json <file.json>.');
    const data = JSON.parse(fs.readFileSync(path.resolve(jf), 'utf8'));
    if (!data.title) die('The JSON needs a "title".');
    const type = data.type || 'rule';
    const ruleText = data.rule || data.title;
    const notes = listNotes(dir);

    // --supersedes "<old note>": creates the replacement and marks the old one,
    // without tripping the duplicate detector (that was the dead end).
    let oldN = null;
    const supRef = flag('supersedes');
    if (supRef && supRef !== true) {
      oldN = findNote(notes, supRef);
      if (!oldN) die(`Note to supersede not found: "${supRef}".`);
    }

    const dups = notes
      .filter((n) => (n.fm.status || 'active') !== 'superseded')
      .filter((n) => !oldN || n.file !== oldN.file)
      .map((n) => ({ n, sim: Math.max(jaccard(n.title, data.title), jaccard(n.sections.Regla || '', ruleText)) }))
      .filter((x) => x.sim >= 0.6 || norm(x.n.title) === norm(data.title))
      .sort((a, b) => b.sim - a.sim);

    if (dups.length && !flag('force')) {
      out({
        ok: false,
        reason: 'possible duplicate or rule already stored',
        candidates: dups.slice(0, 3).map((d) => ({ similarity: Number(d.sim.toFixed(2)), ...brief(d.n) })),
        hint: oldN
          ? 'There are other similar notes besides the one you are superseding: review the candidates before forcing.'
          : 'Same rule: use update. It replaces it: add --supersedes "<old note>". Genuinely different: --force.',
      });
      process.exit(1);
    }

    const fm = {
      tags: [memoryTag(), type],
      type,
      status: data.status || 'active',
      scope: data.scope || 'global',
      confidence: data.confidence !== undefined ? data.confidence : 0.8,
      created: today(),
      updated: today(),
      last_confirmed: today(),
      supersedes: oldN ? `[[${oldN.title}]]` : data.supersedes || '',
      promoted_to: data.promoted_to || '',
      source: data.source || 'session',
    };
    const blocks = [];
    // `data.labels` lets the conversation pick the note language per note;
    // config `--labels` is only the machine-wide default.
    const lang = data.labels && LANG_LABELS[data.labels] ? data.labels : memoryLabelsLang();
    setBlock(blocks, labelFor(lang, 'Rule'), ruleText);
    for (const [k, label] of [['why', 'Why'], ['applies', 'When it applies'], ['not_applies', 'When it does NOT apply'], ['verify', 'How to verify']]) {
      if (data[k]) setBlock(blocks, labelFor(lang, label), data[k]);
    }
    const note = {
      blocks,
      notas: data.notes || '',
      notasHeading: lang === 'en' ? null : labelFor(lang, 'notes'),
      historial: `- ${today()} ${hist(lang, 'created', data.source || 'session')}` + (oldN ? `\n- ${today()} ${hist(lang, 'supersedes', oldN.title)}` : ''),
      historialHeading: lang === 'en' ? null : labelFor(lang, 'history'),
    };
    const fname = safeName(data.title) + '.md';
    const file = path.join(dir, fname);
    if (fs.existsSync(file)) die(`File already exists: ${fname}.`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, `---\n${toYaml([], fm, new Set(Object.keys(fm)))}\n---\n\n${renderBody(note)}`, 'utf8');

    if (oldN) {
      const fmOld = { ...oldN.fm, status: 'superseded', superseded_by: `[[${data.title}]]`, updated: today() };
      const oldLang = detectLang(oldN.blocks, [oldN.notasHeading, oldN.historialHeading]);
      const histOld = `${oldN.historial}\n- ${today()} ${hist(oldLang, 'supersededBy', data.title)}`.trim();
      fs.writeFileSync(oldN.file, `---\n${toYaml(oldN.entries, fmOld, new Set(['status', 'superseded_by', 'updated']))}\n---\n\n${renderBody({ blocks: oldN.blocks, notas: oldN.notas, notasHeading: oldN.notasHeading || labelFor(oldLang, 'notes'), historial: histOld, historialHeading: oldN.historialHeading || labelFor(oldLang, 'history') })}`, 'utf8');
    }

    out({ ok: true, created: file, title: data.title, type, superseded: oldN ? oldN.title : null, warnings: ruleText.length < 20 ? ['rule text is very short, make it explicit'] : [] });
    break;
  }

  case 'update': {
    const jf = flag('json');
    if (!jf || jf === true) die('Missing --json <file.json>.');
    const data = JSON.parse(fs.readFileSync(path.resolve(jf), 'utf8'));
    const notes = listNotes(dir);
    const n = findNote(notes, data.note);
    if (!n) die(`Note not found: "${data.note}".`);
    const fm = { ...n.fm };
    const touched = new Set(['updated']);
    for (const k of ['type', 'status', 'scope', 'confidence', 'promoted_to', 'source']) {
      if (data[k] !== undefined) {
        fm[k] = data[k];
        touched.add(k);
      }
    }
    if (data.tags) {
      fm.tags = Array.isArray(data.tags) ? data.tags : String(data.tags).split(',').map((s) => s.trim());
      touched.add('tags');
    }
    // Claves libres del frontmatter (description, aliases, ...).
    if (data.frontmatter && typeof data.frontmatter === 'object') {
      for (const [k, v] of Object.entries(data.frontmatter)) {
        fm[k] = v;
        touched.add(k);
      }
    }
    if (!Array.isArray(fm.tags)) {
      fm.tags = fm.tags ? [fm.tags] : [memoryTag()];
      touched.add('tags');
    }
    fm.updated = today();
    if (data.confirm || data.rule || data.why) {
      fm.last_confirmed = today();
      touched.add('last_confirmed');
    }

    const blocks = n.blocks.map((b) => ({ ...b }));
    const lang = detectLang(n.blocks, [n.notasHeading, n.historialHeading]);
    for (const [k, label] of [['rule', 'Rule'], ['why', 'Why'], ['applies', 'When it applies'], ['not_applies', 'When it does NOT apply'], ['verify', 'How to verify']]) {
      if (data[k] !== undefined) setBlock(blocks, labelFor(lang, label), data[k]);
    }
    let historial = n.historial;
    // If the rule text is rewritten, the previous text goes to History:
    // update must never erase what it said before without a trace.
    if (data.rule !== undefined && n.sections.Rule && data.rule.trim() !== n.sections.Rule.trim()) {
      historial += `\n- ${today()} ${hist(lang, 'prevRule', n.sections.Rule.replace(/"/g, "'"))}`;
    }
    if (data.history) historial += `\n- ${today()} ${data.history}`;
    else historial += `\n- ${today()} ${hist(lang, 'updated')}`;

    fs.writeFileSync(n.file, `---\n${toYaml(n.entries, fm, touched)}\n---\n\n${renderBody({ blocks, notas: data.notes !== undefined ? data.notes : n.notas, notasHeading: n.notasHeading || labelFor(lang, 'notes'), historial, historialHeading: n.historialHeading || labelFor(lang, 'history') })}`, 'utf8');
    out({ ok: true, updated: n.file, title: n.title, status: fm.status });
    break;
  }

  case 'supersede': {
    const notes = listNotes(dir);
    const oldN = findNote(notes, flag('old'));
    const newN = findNote(notes, flag('new'));
    if (!oldN) die(`Old note not found: "${flag('old')}".`);
    if (!newN) die(`New note not found: "${flag('new')}".`);
    if (oldN.file === newN.file) die('old and new are the same note.');
    const fmOld = { ...oldN.fm, status: 'superseded', superseded_by: `[[${newN.title}]]`, updated: today() };
    const langOld = detectLang(oldN.blocks, [oldN.notasHeading, oldN.historialHeading]);
    const histOld = `${oldN.historial}\n- ${today()} ${hist(langOld, 'supersededBy', newN.title)}`.trim();
    fs.writeFileSync(oldN.file, `---\n${toYaml(oldN.entries, fmOld, new Set(['status', 'superseded_by', 'updated']))}\n---\n\n${renderBody({ blocks: oldN.blocks, notas: oldN.notas, notasHeading: oldN.notasHeading || labelFor(langOld, 'notes'), historial: histOld, historialHeading: oldN.historialHeading || labelFor(langOld, 'history') })}`, 'utf8');
    const fmNew = { ...newN.fm, supersedes: `[[${oldN.title}]]`, updated: today() };
    const langNew = detectLang(newN.blocks, [newN.notasHeading, newN.historialHeading]);
    const histNew = `${newN.historial}\n- ${today()} ${hist(langNew, 'supersedes', oldN.title)}`.trim();
    fs.writeFileSync(newN.file, `---\n${toYaml(newN.entries, fmNew, new Set(['supersedes', 'updated']))}\n---\n\n${renderBody({ blocks: newN.blocks, notas: newN.notas, notasHeading: newN.notasHeading || labelFor(langNew, 'notes'), historial: histNew, historialHeading: newN.historialHeading || labelFor(langNew, 'history') })}`, 'utf8');
    out({ ok: true, superseded: oldN.title, by: newN.title });
    break;
  }

  case 'review': {
    const days = Number(flag('days', 60));
    const cutoff = new Date(Date.now() - days * 86400000);
    const p = (n) => String(n).padStart(2, '0');
    const cutoffStr = `${cutoff.getFullYear()}-${p(cutoff.getMonth() + 1)}-${p(cutoff.getDate())}`;
    const notes = listNotes(dir);
    const stale = notes.filter((n) => (n.fm.status || 'active') === 'active' && (n.fm.last_confirmed || n.fm.updated || '1970-01-01') < cutoffStr);
    const weak = notes.filter((n) => (n.fm.status || 'active') === 'active' && Number(n.fm.confidence ?? 1) < 0.7);
    const noVerify = notes.filter((n) => (n.fm.status || 'active') === 'active' && !n.sections['How to verify']);
    out({
      ok: true,
      cutoff: cutoffStr,
      total_active: notes.filter((n) => (n.fm.status || 'active') === 'active').length,
      stale: stale.map(brief),
      low_confidence: weak.map(brief),
      no_verification: noVerify.map(brief),
      suggested_questions: [
        'Which of these rules no longer reflect how you work today?',
        'Which of these became obvious and should move to AGENTS.md and leave the memory?',
        'Which of these changed in the last months while the note stayed old?',
      ],
    });
    break;
  }

  case 'promote': {
    const notes = listNotes(dir)
      .filter((n) => (n.fm.status || 'active') === 'active' && ['rule', 'preference'].includes(n.fm.type))
      .sort((a, b) => String(a.fm.scope).localeCompare(String(b.fm.scope)) || a.title.localeCompare(b.title));
    const byScope = {};
    for (const n of notes) (byScope[n.fm.scope || 'global'] ||= []).push(n);
    const md = Object.entries(byScope)
      .map(([scope, list]) => `### ${scope}\n` + list.map((n) => `- ${n.sections.Rule || n.title}  <!-- [[${n.title}]] -->`).join('\n'))
      .join('\n\n');
    out({ ok: true, count: notes.length, agents_md_block: md });
    break;
  }

  case 'index': {
    const notes = listNotes(dir);
    const byType = {};
    for (const n of notes) (byType[n.fm.type || 'untyped'] ||= []).push(n);
    const base = path.join(dir, path.basename(dir) + '.base');
    let md = `---\ntags: [${memoryTag()}, index]\n---\n\n# Agent memory\n\n`;
    md += 'Auto-generated by the `obsidian-memory` skill. Do not edit by hand.\n\n';
    if (fs.existsSync(base)) md += `![[${path.basename(base, '.base')}.base]]\n\n`;
    for (const [type, list] of Object.entries(byType).sort()) {
      md += `## ${type} (${list.length})\n`;
      for (const n of list.sort((a, b) => a.title.localeCompare(b.title))) {
        const flagTxt = (n.fm.status || 'active') === 'active' ? '' : ` — *${n.fm.status}*`;
        md += `- [[${n.title}]]${flagTxt}\n`;
      }
      md += '\n';
    }
    const file = path.join(dir, '_Index.md');
    fs.writeFileSync(file, md, 'utf8');
    out({ ok: true, index: file, notes: notes.length });
    break;
  }

  default:
    die('Commands: config | vault | doctor | find | read | add [--supersedes "<note>"] | update | supersede | review | promote | index');
}
