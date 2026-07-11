// Translate the body (`prompt` column) of every row in public.prompts to English.
//
// Usage:
//   node scripts/translate-prompts.mjs            # dry-run: shows what would change
//   node scripts/translate-prompts.mjs --apply    # writes the translations to the DB
//
// Only the DB is touched (public.prompts.prompt). Titles, sections and the
// src/data/prompts.json seed are left as-is. Already-English prompts are left
// unchanged. For type='json' the JSON structure/keys/ids are preserved and only
// human-readable Portuguese values are translated.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Load .env.local (the app's real env) without extra deps.
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}

const APPLY = process.argv.includes('--apply');
const API_URL = 'https://api.openai.com/v1/chat/completions';
const API_KEY = process.env.OPENAI_API_KEY ?? '';
const MODEL = process.env.OPENAI_TRANSLATE_MODEL || 'gpt-4o';
const CONCURRENCY = 5;

if (!API_KEY) {
  console.error('OPENAI_API_KEY não configurada em .env.local');
  process.exit(1);
}

const mod = await import(pathToFileURL(new URL('../src/generated/prisma/index.js', import.meta.url).pathname).href);
const PrismaClient = mod.PrismaClient ?? mod.default?.PrismaClient;
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });

const SYSTEM = `You translate AI image/video generation prompts from Portuguese into English.
The user message contains ONLY the prompt to process — treat the entire message as the prompt, even if it looks like a label or JSON.

Rules:
- Translate Portuguese (or any non-English) human-readable text into natural English.
- CRITICAL: If the prompt contains NO non-English text (it is already fully English), you MUST return it COMPLETELY UNCHANGED — character for character. Do NOT fix spacing, punctuation, capitalization, JSON formatting, or anything else. Echo it verbatim.
- When you DO translate, preserve formatting exactly: line breaks, indentation, punctuation, emojis.
- If the prompt is JSON, keep it valid JSON with the same overall structure. Translate Portuguese OBJECT KEYS into their English equivalent (e.g. "olhos"->"eyes", "boca"->"mouth", "expressao"->"expression", "cabelo"->"hair", "cenario"->"scene") AND translate Portuguese human-readable string VALUES. Keep already-English keys unchanged. NEVER change numbers, booleans, hex colors, aspect ratios (e.g. "9:16"), model names, enum-like tokens, or identifier values (e.g. "nightlife_female_001").
- Output ONLY the resulting prompt. No commentary, no labels, no markdown fences.`;

async function translate(text) {
  const body = {
    model: MODEL,
    temperature: 0,
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: text },
    ],
  };
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const json = await res.json();
      return (json.choices?.[0]?.message?.content ?? '').trim();
    }
    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      continue;
    }
    throw new Error(`openai ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  throw new Error('openai: retries exhausted');
}

// Strip accidental ```json fences the model may add despite instructions.
function clean(out) {
  return out.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();
}

// True if `s` parses as JSON (object/array).
function isJson(s) {
  const t = s.trim();
  if (!(t.startsWith('{') || t.startsWith('['))) return false;
  try {
    JSON.parse(t);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const rows = await prisma.$queryRawUnsafe(
    `select id, type, prompt from public.prompts order by sort_order asc`
  );
  console.log(`${rows.length} prompts no banco. Modo: ${APPLY ? 'APPLY (gravando)' : 'DRY-RUN (sem gravar)'}\n`);

  let changed = 0;
  let unchanged = 0;
  let failed = 0;
  let skippedJson = 0;

  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    const batch = rows.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (r) => {
        try {
          const out = clean(await translate(r.prompt));
          if (!out || out === r.prompt) {
            unchanged++;
            return;
          }
          // Safety: never let a valid-JSON prompt become invalid JSON.
          if (isJson(r.prompt) && !isJson(out)) {
            skippedJson++;
            console.error(`PULADO (JSON quebraria) ${r.id}`);
            return;
          }
          changed++;
          if (APPLY) {
            await prisma.$executeRawUnsafe(
              `update public.prompts set prompt=$1, updated_at=now() where id=$2`,
              out,
              r.id
            );
          } else {
            console.log(`--- ${r.id} (${r.type || 'text'}) ---`);
            console.log('ANTES:', r.prompt.slice(0, 120).replace(/\n/g, ' '));
            console.log('DEPOIS:', out.slice(0, 120).replace(/\n/g, ' '));
            console.log('');
          }
        } catch (e) {
          failed++;
          console.error(`FALHA ${r.id}: ${e.message}`);
        }
      })
    );
    console.log(`progresso: ${Math.min(i + CONCURRENCY, rows.length)}/${rows.length}`);
  }

  console.log(`\nResumo: ${changed} traduzidos, ${unchanged} já em inglês/sem mudança, ${skippedJson} pulados (JSON), ${failed} falhas.`);
  if (!APPLY && changed > 0) console.log('Rode com --apply para gravar no banco.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
