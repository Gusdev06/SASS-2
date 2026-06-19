/**
 * Drag-and-drop entre o histórico ("Recent renders") e o dropzone de upload do
 * GenPanel. Um render é arrastado carregando sua `output_url`; o dropzone lê
 * essa URL e a usa como imagem de entrada (o servidor busca a URL).
 */

/** Mime custom para distinguir um render arrastado de arquivos do sistema. */
export const RENDER_DND_MIME = 'application/x-goz-render';

/** Lê a URL de um render a partir de um drop, com fallback pros mimes padrão. */
export function readRenderUrl(dt: DataTransfer): string | null {
  const raw =
    dt.getData(RENDER_DND_MIME) ||
    dt.getData('text/uri-list') ||
    dt.getData('text/plain');
  if (!raw) return null;
  // text/uri-list pode ter várias linhas / comentários (#...).
  const line = raw
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith('#'));
  return line ?? null;
}
