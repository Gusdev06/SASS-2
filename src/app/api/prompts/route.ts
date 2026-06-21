import { NextResponse } from 'next/server';
import { fetchAllPrompts } from '@/lib/promptsApi';

export const dynamic = 'force-dynamic';

// Rota pública: lista todos os prompts ativos (lista única, mais novos primeiro).
export async function GET() {
  try {
    const data = await fetchAllPrompts();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json([], { status: 200 });
  }
}
