// Parse a .docx file into a proposed lesson row plus extracted images.
//
// Two passes through mammoth:
//   1. extractRawText  → clean plain-text body
//   2. convertToHtml   → image collector callback fires for every
//                        embedded image
//
// Title is derived from the filename per the user spec (no first-
// heading sniffing). Images are returned as Blobs ready to be passed
// to addImageToLesson on commit. We do NOT upload here — the BulkImport
// page commits in batches so it can show progress and recover from
// per-file failures cleanly.

const DOCX_EXT = '.docx';

function readAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('read failed'));
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Strip extension + replace _/- with spaces; collapse multiple spaces
 * and trim. Keeps the pastor's intentional capitalization.
 */
export function titleFromFilename(filename) {
  if (!filename) return '';
  let base = filename;
  const slash = Math.max(base.lastIndexOf('/'), base.lastIndexOf('\\'));
  if (slash >= 0) base = base.slice(slash + 1);
  const dot = base.lastIndexOf('.');
  if (dot > 0) base = base.slice(0, dot);
  return base
    .replace(/[_]+/g, ' ')
    .replace(/\s+-\s+/g, ' — ') // " - " → " — " for nicer typography
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parse one .docx File. Returns:
 *   {
 *     filename,
 *     fileModifiedAt,        // ISO date or null
 *     title,                 // titleFromFilename(file.name)
 *     body,                  // plain text body
 *     images: [              // ready to hand to addImageToLesson
 *       { blob, contentType, suggestedExt }
 *     ],
 *     parseError,            // string if extraction failed; rest empty
 *   }
 */
export async function parseDocxLesson(file) {
  const filename = file?.name || '(unnamed)';
  const lower = filename.toLowerCase();
  const fileModifiedAt = file?.lastModified
    ? new Date(file.lastModified).toISOString().slice(0, 10)
    : null;

  if (!lower.endsWith(DOCX_EXT)) {
    return {
      filename,
      fileModifiedAt,
      title: titleFromFilename(filename),
      body: '',
      images: [],
      parseError: 'Only .docx files are supported in this importer.',
    };
  }

  try {
    const arrayBuffer = await readAsArrayBuffer(file);
    const mammoth = (await import('mammoth')).default;

    // Pass 1: plain-text body.
    const textResult = await mammoth.extractRawText({ arrayBuffer });
    const body = (textResult.value || '').trim();

    // Pass 2: image collector. We discard the HTML output — we only
    // care about the side effect of the convertImage callback firing
    // for every <pic> in the document.
    const images = [];
    await mammoth.convertToHtml(
      { arrayBuffer },
      {
        convertImage: mammoth.images.imgElement(async (image) => {
          try {
            // image.read() returns a Buffer / Uint8Array of the raw bytes.
            const bytes = await image.read();
            const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
            const contentType = image.contentType || 'image/png';
            const ext = contentTypeToExt(contentType);
            images.push({
              blob: new Blob([u8], { type: contentType }),
              contentType,
              suggestedExt: ext,
            });
          } catch (e) {
            // If a single image fails to read, swallow it — the rest of
            // the file can still import. Surface the count delta only.
            // eslint-disable-next-line no-console
            console.warn('Failed to read embedded image in', filename, e);
          }
          // Return an empty src so the HTML output is well-formed; we
          // discard the HTML anyway.
          return { src: '' };
        }),
      }
    );

    return {
      filename,
      fileModifiedAt,
      title: titleFromFilename(filename),
      body,
      images,
    };
  } catch (e) {
    return {
      filename,
      fileModifiedAt,
      title: titleFromFilename(filename),
      body: '',
      images: [],
      parseError: e?.message || String(e),
    };
  }
}

function contentTypeToExt(ct) {
  if (!ct) return 'png';
  const m = ct.match(/\/([a-z0-9+]+)$/i);
  if (!m) return 'png';
  const raw = m[1].toLowerCase();
  if (raw === 'jpeg') return 'jpg';
  if (raw === 'svg+xml') return 'svg';
  return raw;
}
