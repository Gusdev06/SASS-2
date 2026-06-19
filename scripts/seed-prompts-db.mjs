// One-shot migration: creates public.prompts and seeds it from src/data/prompts.json.
// Run with: node scripts/seed-prompts-db.mjs
// Idempotent — re-running upserts by id and re-applies the DDL safely.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Load .env.local (the app's real env) without extra deps.
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}

const mod = await import(pathToFileURL(new URL('../src/generated/prisma/index.js', import.meta.url).pathname).href);
const PrismaClient = mod.PrismaClient ?? mod.default?.PrismaClient;
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });

const DDL = [
  `create extension if not exists pgcrypto`,
  `create table if not exists public.prompts (
    id text primary key default gen_random_uuid()::text,
    section_id text not null, section_slug text not null, section_title text not null, section_icon text,
    category_id text not null, category_title text not null,
    title text not null, type text, prompt text not null,
    image_url text, thumbnail_url text, ai_model text,
    sort_order integer not null default 0, active boolean not null default true,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now()
  )`,
  `create index if not exists prompts_section_idx on public.prompts(section_slug, sort_order)`,
  `create index if not exists prompts_order_idx on public.prompts(sort_order)`,
  `alter table public.prompts enable row level security`,
  `drop policy if exists "prompts_select_active" on public.prompts`,
  `create policy "prompts_select_active" on public.prompts for select using (active = true)`,
];

const data = JSON.parse(readFileSync(new URL('../src/data/prompts.json', import.meta.url), 'utf8'));

async function main() {
  console.log('Applying DDL…');
  for (const stmt of DDL) await prisma.$executeRawUnsafe(stmt);

  let order = 0;
  let count = 0;
  for (const s of data.sections) {
    for (const c of s.categories) {
      for (const p of c.prompts) {
        await prisma.$executeRawUnsafe(
          `insert into public.prompts
             (id, section_id, section_slug, section_title, section_icon,
              category_id, category_title, title, type, prompt,
              image_url, thumbnail_url, ai_model, sort_order, active)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,true)
           on conflict (id) do update set
             section_id=excluded.section_id, section_slug=excluded.section_slug,
             section_title=excluded.section_title, section_icon=excluded.section_icon,
             category_id=excluded.category_id, category_title=excluded.category_title,
             title=excluded.title, type=excluded.type, prompt=excluded.prompt,
             image_url=excluded.image_url, thumbnail_url=excluded.thumbnail_url,
             ai_model=excluded.ai_model, sort_order=excluded.sort_order, updated_at=now()`,
          p.id, s.id, s.slug, s.title, s.icon ?? null,
          c.id, c.title, p.title, p.type ?? null, p.prompt,
          p.imageUrl ?? null, p.thumbnailUrl ?? null, p.aiModel ?? null, order++,
        );
        count++;
      }
    }
  }
  const [{ n }] = await prisma.$queryRawUnsafe('select count(*)::int as n from public.prompts');
  console.log(`Seeded ${count} prompts. Rows in table: ${n}`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
