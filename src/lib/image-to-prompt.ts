/**
 * Image → prompt (reverse engineering).
 *
 * Sends ONE image to OpenAI's vision-capable chat model and returns the exact
 * structured prompt (JSON) that would reproduce it, following the UGC system
 * prompt below. Reuses OPENAI_API_KEY (same key as the GPT Image engine).
 *
 *   POST https://api.openai.com/v1/chat/completions
 *   model: vision model (default gpt-4o), response_format: json_object
 */

const API_URL = 'https://api.openai.com/v1/chat/completions';
const API_KEY = process.env.OPENAI_API_KEY ?? '';
// Most advanced vision-capable model on the account. Override with OPENAI_VISION_MODEL.
const MODEL = process.env.OPENAI_VISION_MODEL || 'gpt-5.5';

// GPT-5 / o-series reasoning models use `max_completion_tokens` and only accept
// the default temperature (1); GPT-4.x use `max_tokens` and allow custom temps.
function isReasoningModel(model: string): boolean {
  return /^(gpt-5|o\d)/.test(model);
}

const TIMEOUT_MS = 180_000;

export const IMAGE_PROMPT_SYSTEM = `Você é um agente especializado em análise visual de imagens para criação de prompts de IA generativa voltados a conteúdo UGC (User Generated Content) realista de influenciadores.

Sua função: receber UMA imagem e retornar APENAS um JSON válido seguindo EXATAMENTE a estrutura abaixo, preenchendo cada campo com base no que você observa visualmente na imagem.

## ESTRUTURA OBRIGATÓRIA DO JSON DE SAÍDA

{
  "reference_override": "SE uma imagem de referência da pessoa for fornecida junto a este prompt ao modelo de geração, IGNORE completamente todas as descrições físicas faciais contidas em 'character_lock.face_identity' e use a identidade visual da imagem de referência como fonte única de verdade para rosto, traços, estrutura óssea e expressão característica. As descrições físicas textuais existem apenas como fallback para quando nenhuma imagem de referência estiver disponível. Demais campos (cena, roupa, iluminação, pose, câmera, acessórios) devem ser seguidos normalmente.",
  "configuracao_tecnica": {
    "aspect_ratio": "string (9:16, 1:1, 16:9 etc)",
    "quality": "ultra_photorealistic",
    "resolution": "8k",
    "camera": "string (ex: câmera frontal do iPhone 15 Pro Max OU câmera traseira do iPhone 15 Pro Max)",
    "lens": "string (ex: 24mm grande angular, 26mm principal, 77mm telefoto)",
    "style": "string descritiva do estilo fotográfico"
  },
  "character_lock": {
    "identity_source": "",
    "face_identity": ["array com 1 string longa descrevendo rosto: formato, sobrancelhas, olhos, nariz, boca, dentes, maçãs do rosto, queixo, assimetrias naturais, SEM NOMES PRÓPRIOS"],
    "regras_de_aparencia": {
      "descricao_geral": "string (cabelo, tom de pele, textura de pele, maquiagem)",
      "marcas_e_acessorios": "string (piercings, brincos, tatuagens, colares — apenas o que está visível)"
    }
  },
  "cena": {
    "ambiente": "string (local, contexto, elementos de fundo)",
    "objetos": "string (objetos relevantes na cena)",
    "clima_e_hora": "string (horário do dia, clima, atmosfera)"
  },
  "iluminacao": {
    "fonte": "string (natural, janela, sol, luz ambiente)",
    "qualidade": "string (suave, dura, difusa, contraluz)",
    "evitar": "string (estúdio, ring light, aparência profissional, flash estourado)"
  },
  "perspectiva_da_camera": {
    "tipo": "string (selfie / foto por terceiro)",
    "angulo": "string (altura dos olhos, de cima, de baixo)",
    "enquadramento": "string (close, plano médio, corpo inteiro)",
    "distancia": "string"
  },
  "assunto": {
    "pose": "string (postura, gesto, ação)",
    "expressao": "string (expressão facial, emoção)",
    "roupa": "string (peças, cores precisas, textos legíveis literais)"
  },
  "qualidade_da_imagem": {
    "realismo": "foto real de celular, NÃO CGI, NÃO 3D, NÃO estúdio",
    "imperfeicoes": "string (grão, leve desfoque de movimento, ruído de sensor — o que torna real)"
  }
}

## DIRETRIZES

1. RETORNE APENAS O JSON. Sem markdown, sem \`\`\`json, sem texto antes ou depois.
2. O CAMPO "reference_override" DEVE SER INCLUÍDO SEMPRE, no topo, com o texto acima.
3. DETECÇÃO DE SELFIE vs FOTO POR TERCEIRO: analise o ângulo, distância do braço e ponto de vista.
4. CHARACTER_LOCK descritivo e ancorado como fallback textual. Nunca use nomes próprios.
5. ILUMINAÇÃO em "evitar" sempre bloqueie estúdio, ring light, aparência profissional, flash estourado.
6. TEXTURA DE PELE reflete o contexto (suor, brilho, rubor, fosca).
7. ROUPA com cores precisas e textos legíveis literais.
8. NEGATIVE IMPLÍCITO em "qualidade_da_imagem": NÃO CGI, NÃO 3D, NÃO estúdio. SEMPRE foto real de celular.
9. SE CONTEÚDO INAPROPRIADO, retorne apenas: {"error": "conteudo_inapropriado"}

Analise a imagem enviada e retorne APENAS o JSON correspondente, sempre incluindo o campo "reference_override" no topo.`;

export class ImageToPromptError extends Error {
  code: 'auth_missing' | 'timeout' | 'rate_limited' | 'content_rejected' | 'upstream' | 'unexpected' | 'unknown';
  constructor(code: ImageToPromptError['code'], message: string) {
    super(message);
    this.name = 'ImageToPromptError';
    this.code = code;
  }
}

/**
 * Analyze a single image (passed as a `data:<mime>;base64,...` URI) and return
 * the raw JSON string produced by the model.
 */
export async function imageToPrompt(dataUri: string): Promise<string> {
  if (!API_KEY) throw new ImageToPromptError('auth_missing', 'OPENAI_API_KEY não configurada.');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const reasoning = isReasoningModel(MODEL);
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        // Reasoning models reject custom temperature and use a different token cap
        // (which also has to cover reasoning tokens, hence the larger budget).
        ...(reasoning ? { max_completion_tokens: 16000 } : { temperature: 0.2, max_tokens: 4000 }),
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: IMAGE_PROMPT_SYSTEM },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Analise esta imagem e retorne APENAS o JSON conforme a estrutura.' },
              { type: 'image_url', image_url: { url: dataUri, detail: 'high' } },
            ],
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      if (res.status === 401 || res.status === 403) throw new ImageToPromptError('auth_missing', `openai auth ${res.status}`);
      if (res.status === 429) throw new ImageToPromptError('rate_limited', 'openai rate limit (429)');
      if ((res.status === 400 || res.status === 422) && /safety|moderation|policy|content_policy|flagged/i.test(body)) {
        throw new ImageToPromptError('content_rejected', 'imagem rejeitada pela moderação do provedor');
      }
      if (res.status >= 500) throw new ImageToPromptError('upstream', `openai ${res.status}`);
      throw new ImageToPromptError('unknown', `openai ${res.status}: ${body.slice(0, 200)}`);
    }

    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = json.choices?.[0]?.message?.content?.trim();
    if (!content) throw new ImageToPromptError('unexpected', 'resposta vazia do modelo');
    return content;
  } catch (err) {
    if (err instanceof ImageToPromptError) throw err;
    if (err instanceof Error && err.name === 'AbortError') throw new ImageToPromptError('timeout', 'análise expirou');
    throw new ImageToPromptError('unknown', err instanceof Error ? err.message : String(err));
  } finally {
    clearTimeout(timer);
  }
}
