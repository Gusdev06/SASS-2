// One-time migration: pull selected prompt sections from the external API,
// upload their thumbnails to our own Supabase Storage, and emit a local
// src/data/prompts.json so the app no longer depends on the external API.
//
// Run from project root:  node scripts/migrate-prompts.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// --- load .env.local ---
const env = Object.fromEntries(
  fs
    .readFileSync(path.join(ROOT, '.env.local'), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    })
);

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) throw new Error('Missing Supabase env');

const BUCKET = 'prompt-thumbnails';
const API = 'https://clip-generator-geraew-api.ernvcw.easypanel.host/api/v1/prompts';

// Sections to migrate, in the order they should appear in the UI.
const WANTED = [
  '8-prompts-influencer-no-role-noite',
  '5-prompts-influencer-corredora',
  '41-prompts-de-influencer-de-i-a',
  '3-prompts-para-academia',
  '25-prompts-influencer-de-biquini',
];

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const publicUrl = (objectPath) =>
  `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${objectPath}`;

async function ensureBucket() {
  const { error } = await supabase.storage.createBucket(BUCKET, {
    public: true,
    fileSizeLimit: '5MB',
    allowedMimeTypes: ['image/webp', 'image/png', 'image/jpeg'],
  });
  if (error && !/already exists/i.test(error.message)) throw error;
  console.log(`bucket "${BUCKET}" ready`);
}

async function migrateOne(slug, prompt) {
  const src = prompt.thumbnailUrl ?? prompt.imageUrl;
  if (!src) return { ...prompt };
  const res = await fetch(src);
  if (!res.ok) throw new Error(`download ${res.status} for ${prompt.id}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const objectPath = `${slug}/${prompt.id}.webp`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(objectPath, buf, { contentType: 'image/webp', upsert: true });
  if (error) throw error;
  const url = publicUrl(objectPath);
  // Strip the external URLs; point both fields at our own copy.
  return { ...prompt, imageUrl: url, thumbnailUrl: url };
}

async function pool(items, size, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  }
  return out;
}

async function main() {
  await ensureBucket();

  const json = await (await fetch(API)).json();
  const bySlug = new Map(json.sections.map((s) => [s.slug, s]));

  let done = 0;
  const total = WANTED.reduce(
    (n, slug) =>
      n +
      (bySlug.get(slug)?.categories ?? []).reduce((m, c) => m + c.prompts.length, 0),
    0
  );

  const sections = [];
  for (const slug of WANTED) {
    const sec = bySlug.get(slug);
    if (!sec) {
      console.warn(`! section not found: ${slug}`);
      continue;
    }
    const categories = [];
    for (const cat of sec.categories) {
      const prompts = await pool(cat.prompts, 8, async (p) => {
        const migrated = await migrateOne(slug, p);
        console.log(`  [${++done}/${total}] ${slug} / ${p.id}`);
        return migrated;
      });
      categories.push({ id: cat.id, title: cat.title, prompts });
    }
    sections.push({
      id: sec.id,
      slug: sec.slug,
      title: sec.title,
      icon: sec.icon ?? null,
      categories,
    });
    console.log(`✓ ${sec.title} (${slug})`);
  }

  const outDir = path.join(ROOT, 'src', 'data');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'prompts.json');
  fs.writeFileSync(outFile, JSON.stringify({ sections }, null, 2));
  console.log(`\nWrote ${outFile} — ${sections.length} sections, ${total} prompts`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
