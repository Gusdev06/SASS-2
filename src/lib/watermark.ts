import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const FONT_REL = 'node_modules/geist/dist/fonts/geist-sans/Geist-Black.ttf';

let cachedFontDataUri: string | null = null;

function loadFontDataUri(): string {
  if (cachedFontDataUri) return cachedFontDataUri;
  const abs = path.join(process.cwd(), FONT_REL);
  const ttf = fs.readFileSync(abs);
  cachedFontDataUri = `data:font/ttf;base64,${ttf.toString('base64')}`;
  return cachedFontDataUri;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export async function applyWatermark(buf: Buffer): Promise<Buffer> {
  const meta = await sharp(buf).metadata();
  const W = meta.width ?? 1024;
  const H = meta.height ?? 1024;
  const diag = Math.sqrt(W * W + H * H);

  const tileFont = Math.max(28, Math.floor(W / 22));
  const centerFont = Math.max(72, Math.floor(W / 8));
  const subFont = Math.max(22, Math.floor(centerFont / 3.2));
  const cornerFont = Math.max(18, Math.floor(W / 36));

  const fontDataUri = loadFontDataUri();

  const tileText = 'goz.ai · FREE PREVIEW · ';
  const charsPerLine = Math.ceil((diag * 2.5) / (tileFont * 0.55));
  const tileLine = escapeXml(tileText.repeat(Math.ceil(charsPerLine / tileText.length)));
  const step = Math.floor(tileFont * 3.2);

  const lines: string[] = [];
  for (let y = -Math.floor(diag); y < diag; y += step) {
    lines.push(
      `<text x="${-Math.floor(diag)}" y="${y}" font-family="GozWM" font-weight="900" font-size="${tileFont}" fill="rgba(255,255,255,0.34)" stroke="rgba(0,0,0,0.6)" stroke-width="${Math.max(1, tileFont / 18)}">${tileLine}</text>`,
    );
  }

  const cx = Math.floor(W / 2);
  const cy = Math.floor(H / 2);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <defs>
      <style type="text/css">
        @font-face {
          font-family: 'GozWM';
          src: url('${fontDataUri}') format('truetype');
          font-weight: 100 900;
          font-style: normal;
        }
      </style>
    </defs>
    <g transform="rotate(-30 ${cx} ${cy})">${lines.join('')}</g>
    <g transform="rotate(-18 ${cx} ${cy})">
      <text x="${cx}" y="${cy - Math.floor(centerFont * 0.25)}" text-anchor="middle" font-family="GozWM" font-weight="900" font-size="${centerFont}" fill="rgba(212,255,0,0.92)" stroke="rgba(0,0,0,0.92)" stroke-width="${Math.max(3, centerFont / 14)}" paint-order="stroke">goz.ai</text>
      <text x="${cx}" y="${cy + Math.floor(centerFont * 0.55)}" text-anchor="middle" font-family="GozWM" font-weight="700" font-size="${subFont}" fill="rgba(244,237,228,0.98)" stroke="rgba(0,0,0,0.92)" stroke-width="${Math.max(1.5, subFont / 10)}" paint-order="stroke" letter-spacing="4">FREE PREVIEW · SIGN UP TO REMOVE</text>
    </g>
    <text x="${cornerFont * 1.2}" y="${cornerFont * 2}" font-family="GozWM" font-weight="700" font-size="${cornerFont}" fill="rgba(255,255,255,0.95)" stroke="rgba(0,0,0,0.9)" stroke-width="1" paint-order="stroke" letter-spacing="3">goz.ai</text>
    <text x="${W - cornerFont * 1.2}" y="${H - cornerFont * 1.2}" text-anchor="end" font-family="GozWM" font-weight="700" font-size="${cornerFont}" fill="rgba(212,255,0,0.95)" stroke="rgba(0,0,0,0.9)" stroke-width="1" paint-order="stroke" letter-spacing="3">FREE PREVIEW</text>
  </svg>`;

  return sharp(buf)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .jpeg({ quality: 88 })
    .toBuffer();
}
