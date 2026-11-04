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
  return v && !v.startsWith('--') ? v : true;
}

function die(msg) {
  out({ ok: false, error: msg });
  process.exit(1);
}

function out(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
}

// Fecha local, no UTC: las notas son del usuario, no del servidor.
const today = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

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
    } catch { /* ignora config corrupta */ }
  }
  die('No resolvi el vault. Corre: node vault.mjs config --vault "<ruta>"');
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

// ---------- frontmatter ----------
function unq(s) {
  let v = String(s).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  return v;
}

// Frontmatter: se parsea por entradas y se conservan las lineas crudas, para no
// perder block scalars (| >), listas en bloque ni claves que no conocemos.
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

const LABEL_ALIASES = {
  regla: 'Regla', rule: 'Regla',
  'por que': 'Por qué', 'por qué': 'Por qué', why: 'Por qué',
  'cuando aplica': 'Cuándo aplica', 'cuándo aplica': 'Cuándo aplica',
  'cuando no aplica': 'Cuándo NO aplica', 'cuándo no aplica': 'Cuándo NO aplica',
  'como verificar': 'Cómo verificar', 'cómo verificar': 'Cómo verificar',
};

function canonLabel(label) {
  return LABEL_ALIASES[label.trim().toLowerCase()] || label.trim();
}

function parseBody(body) {
  const parts = body.split(/^## /m);
  const head = parts[0];
  const blocks = [];
  for (const line of head.split(/\r?\n/)) {
    const m = /^\*\*([^*]+):\*\*\s*(.*)$/.exec(line);
    if (m) blocks.push({ label: m[1].trim(), canon: canonLabel(m[1]), text: m[2].trim() });
  }
  const tail = parts.length > 1 ? '## ' + parts.slice(1).join('## ') : '';
  const grab = (name) => {
    const r = new RegExp(`## ${name}\\r?\\n([\\s\\S]*?)(?=\\r?\\n## |$)`).exec(tail);
    return r ? r[1].trim() : '';
  };
  return {
    blocks,
    sections: Object.fromEntries(blocks.map((b) => [b.canon, b.text])),
    historial: grab('Historial'),
    notas: grab('Notas'),
  };
}

const SECTION_ORDER = ['Regla', 'Por qué', 'Cuándo aplica', 'Cuándo NO aplica', 'Cómo verificar'];

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
  // Se inserta en su lugar canonico sin mover los bloques que ya existian.
  const next = blocks.find((b) => SECTION_ORDER.includes(b.canon) && SECTION_ORDER.indexOf(b.canon) > SECTION_ORDER.indexOf(canon));
  if (next) {
    blocks.splice(blocks.indexOf(next), 0, entry);
    return;
  }
  const lastKnown = [...blocks].reverse().find((b) => SECTION_ORDER.includes(b.canon));
  if (lastKnown) blocks.splice(blocks.indexOf(lastKnown) + 1, 0, entry);
  else blocks.unshift(entry);
}

// Respeta el orden en que el usuario tenia sus bloques: solo se agregan los
// nuevos, nunca se reordena lo que ya estaba.
function renderBody(note) {
  const blocks = (note.blocks || []).filter((b) => b.text);
  let body = blocks.map((b) => `**${b.label}:** ${b.text}`).join('\n\n');
  if (body) body += '\n';
  if (note.notas) body += `\n## Notas\n${note.notas}\n`;
  if (note.historial) body += `\n## Historial\n${note.historial}\n`;
  return body;
}

// ---------- indice ----------
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
    rule: n.sections.Regla || null,
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

// ---------- comandos ----------
if (cmd === 'config') {
  const v = flag('vault');
  if (!v || v === true) out({ ok: true, config_file: CONFIG_FILE, config: readConfig(), hint: 'Para fijar el vault: node vault.mjs config --vault "C:\\ruta\\al\\vault"' });
  else {
    if (!fs.existsSync(v)) die(`Esa ruta no existe: ${v}`);
    const conf = { vault: path.resolve(v) };
    const md = flag('memory-dir');
    if (md && md !== true) conf.memory_dir = md;
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
      if (!tags.length) warnings.push({ title: n.title, issue: 'sin tags (deberia tener [claude-memory, <tipo>])' });
      if (!n.fm.type) warnings.push({ title: n.title, issue: 'sin type' });
      if (!n.fm.status) warnings.push({ title: n.title, issue: 'sin status (se asume active)' });
      if (!n.sections.Regla && !n.sections['Por qué']) warnings.push({ title: n.title, issue: 'sin seccion Regla/Por que' });
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
      by_type: notes.reduce((a, n) => ((a[n.fm.type || 'sin-tipo'] = (a[n.fm.type || 'sin-tipo'] || 0) + 1), a), {}),
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
    if (!n) die(`No encontre la nota "${flag('note')}".`);
    out({ ok: true, ...brief(n), frontmatter: n.fm, body: n.body.trim() });
    break;
  }

  case 'add': {
    const jf = flag('json');
    if (!jf || jf === true) die('Falta --json <archivo.json>.');
    const data = JSON.parse(fs.readFileSync(path.resolve(jf), 'utf8'));
    if (!data.title) die('El JSON necesita "title".');
    const type = data.type || 'rule';
    const ruleText = data.rule || data.title;
    const notes = listNotes(dir);

    // --supersedes "<nota vieja>": crea la nota que reemplaza y marca la vieja,
    // sin chocar con el detector de duplicados (era el callejon sin salida).
    let oldN = null;
    const supRef = flag('supersedes');
    if (supRef && supRef !== true) {
      oldN = findNote(notes, supRef);
      if (!oldN) die(`No encontre la nota a reemplazar "${supRef}".`);
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
        reason: 'posible duplicado o regla ya existente',
        candidates: dups.slice(0, 3).map((d) => ({ similitud: Number(d.sim.toFixed(2)), ...brief(d.n) })),
        hint: oldN
          ? 'Quedan otras notas parecidas ademas de la que reemplazas: revisa los candidatos antes de forzar.'
          : 'Si es la misma regla: update. Si la reemplaza: add --supersedes "<nota vieja>". Si de verdad es otra: --force.',
      });
      process.exit(1);
    }

    const fm = {
      tags: ['claude-memory', type],
      type,
      status: data.status || 'active',
      scope: data.scope || 'global',
      confidence: data.confidence !== undefined ? data.confidence : 0.8,
      created: today(),
      updated: today(),
      last_confirmed: today(),
      supersedes: oldN ? `[[${oldN.title}]]` : data.supersedes || '',
      promoted_to: data.promoted_to || '',
      source: data.source || 'sesion',
    };
    const blocks = [];
    setBlock(blocks, 'Regla', ruleText);
    for (const [k, label] of [['why', 'Por qué'], ['applies', 'Cuándo aplica'], ['not_applies', 'Cuándo NO aplica'], ['verify', 'Cómo verificar']]) {
      if (data[k]) setBlock(blocks, label, data[k]);
    }
    const note = {
      blocks,
      notas: data.notes || '',
      historial: `- ${today()} creado (${data.source || 'sesion'})`,
    };
    const fname = safeName(data.title) + '.md';
    const file = path.join(dir, fname);
    if (fs.existsSync(file)) die(`Ya existe el archivo ${fname}.`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, `---\n${toYaml([], fm, new Set(Object.keys(fm)))}\n---\n\n${renderBody(note)}`, 'utf8');

    if (oldN) {
      const fmOld = { ...oldN.fm, status: 'superseded', superseded_by: `[[${data.title}]]`, updated: today() };
      const histOld = `${oldN.historial}\n- ${today()} reemplazada por [[${data.title}]]`.trim();
      fs.writeFileSync(oldN.file, `---\n${toYaml(oldN.entries, fmOld, new Set(['status', 'superseded_by', 'updated']))}\n---\n\n${renderBody({ blocks: oldN.blocks, notas: oldN.notas, historial: histOld })}`, 'utf8');
    }

    out({ ok: true, created: file, title: data.title, type, superseded: oldN ? oldN.title : null, warnings: ruleText.length < 20 ? ['la regla es muy corta, revisa que sea explicita'] : [] });
    break;
  }

  case 'update': {
    const jf = flag('json');
    if (!jf || jf === true) die('Falta --json <archivo.json>.');
    const data = JSON.parse(fs.readFileSync(path.resolve(jf), 'utf8'));
    const notes = listNotes(dir);
    const n = findNote(notes, data.note);
    if (!n) die(`No encontre la nota "${data.note}".`);
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
      fm.tags = fm.tags ? [fm.tags] : ['claude-memory'];
      touched.add('tags');
    }
    fm.updated = today();
    if (data.confirm || data.rule || data.why) {
      fm.last_confirmed = today();
      touched.add('last_confirmed');
    }

    const blocks = n.blocks.map((b) => ({ ...b }));
    for (const [k, label] of [['rule', 'Regla'], ['why', 'Por qué'], ['applies', 'Cuándo aplica'], ['not_applies', 'Cuándo NO aplica'], ['verify', 'Cómo verificar']]) {
      if (data[k] !== undefined) setBlock(blocks, label, data[k]);
    }
    let historial = n.historial;
    // Si se reescribe la regla, el texto anterior queda en el historial: update
    // nunca debe borrar lo que decia antes sin dejar rastro.
    if (data.rule !== undefined && n.sections.Regla && data.rule.trim() !== n.sections.Regla.trim()) {
      historial += `\n- ${today()} regla anterior: "${n.sections.Regla.replace(/"/g, "'")}"`;
    }
    if (data.history) historial += `\n- ${today()} ${data.history}`;
    else historial += `\n- ${today()} actualizado`;

    fs.writeFileSync(n.file, `---\n${toYaml(n.entries, fm, touched)}\n---\n\n${renderBody({ blocks, notas: data.notes !== undefined ? data.notes : n.notas, historial })}`, 'utf8');
    out({ ok: true, updated: n.file, title: n.title, status: fm.status });
    break;
  }

  case 'supersede': {
    const notes = listNotes(dir);
    const oldN = findNote(notes, flag('old'));
    const newN = findNote(notes, flag('new'));
    if (!oldN) die(`No encontre la nota vieja "${flag('old')}".`);
    if (!newN) die(`No encontre la nota nueva "${flag('new')}".`);
    if (oldN.file === newN.file) die('old y new son la misma nota.');
    const fmOld = { ...oldN.fm, status: 'superseded', superseded_by: `[[${newN.title}]]`, updated: today() };
    const histOld = `${oldN.historial}\n- ${today()} reemplazada por [[${newN.title}]]`.trim();
    fs.writeFileSync(oldN.file, `---\n${toYaml(oldN.entries, fmOld, new Set(['status', 'superseded_by', 'updated']))}\n---\n\n${renderBody({ blocks: oldN.blocks, notas: oldN.notas, historial: histOld })}`, 'utf8');
    const fmNew = { ...newN.fm, supersedes: `[[${oldN.title}]]`, updated: today() };
    const histNew = `${newN.historial}\n- ${today()} reemplaza a [[${oldN.title}]]`.trim();
    fs.writeFileSync(newN.file, `---\n${toYaml(newN.entries, fmNew, new Set(['supersedes', 'updated']))}\n---\n\n${renderBody({ blocks: newN.blocks, notas: newN.notas, historial: histNew })}`, 'utf8');
    out({ ok: true, superseded: oldN.title, by: newN.title });
    break;
  }

  case 'review': {
    const days = Number(flag('days', 60));
    const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    const notes = listNotes(dir);
    const stale = notes.filter((n) => (n.fm.status || 'active') === 'active' && (n.fm.last_confirmed || n.fm.updated || '1970-01-01') < cutoff);
    const weak = notes.filter((n) => (n.fm.status || 'active') === 'active' && Number(n.fm.confidence ?? 1) < 0.7);
    const noVerify = notes.filter((n) => (n.fm.status || 'active') === 'active' && !n.sections['Cómo verificar']);
    out({
      ok: true,
      cutoff,
      total_active: notes.filter((n) => (n.fm.status || 'active') === 'active').length,
      stale: stale.map(brief),
      low_confidence: weak.map(brief),
      sin_criterio_de_verificacion: noVerify.map(brief),
      preguntas_sugeridas: [
        '¿Cuales de estas reglas ya no reflejan como trabajas hoy?',
        '¿Alguna de estas se volvio obvia y deberia pasar a AGENTS.md y borrarse de la memoria?',
        '¿Cual de estas cambio en los ultimos meses y la nota sigue vieja?',
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
      .map(([scope, list]) => `### ${scope}\n` + list.map((n) => `- ${n.sections.Regla || n.title}  <!-- [[${n.title}]] -->`).join('\n'))
      .join('\n\n');
    out({ ok: true, count: notes.length, bloque_agents_md: md });
    break;
  }

  case 'index': {
    const notes = listNotes(dir);
    const byType = {};
    for (const n of notes) (byType[n.fm.type || 'sin-tipo'] ||= []).push(n);
    const base = path.join(dir, path.basename(dir) + '.base');
    let md = '---\ntags: [claude-memory, index]\n---\n\n# Memoria de agentes\n\n';
    md += 'Indice auto-generado por la skill `obsidian-memory`. No editar a mano.\n\n';
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
    die('Comandos: config | vault | doctor | find | read | add [--supersedes "<nota>"] | update | supersede | review | promote | index');
}
