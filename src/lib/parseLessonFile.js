// Single-entry dispatcher for the bulk importer.
//
// Routes by extension:
//   .docx  → parseDocxLesson (mammoth: text + embedded images)
//   .pdf   → parsePdfLesson  (pdfjs text first, Claude OCR fallback)
//
// Both shapes return the same envelope so BulkImport can render them
// uniformly:
//
//   {
//     filename,
//     fileModifiedAt,
//     title,                     // from filename
//     scripture_reference,       // sniffed from body (may be '')
//     body,
//     images: [{ blob, contentType, suggestedExt }],
//     parseError,                // string if extraction failed
//     parseWarning,              // optional human-readable note
//     ocr,                       // optional { used: bool, truncated: bool, pageCount }
//   }

import { parseDocxLesson, titleFromFilename } from './parseDocxLesson';
import { extractPdfText } from './pdfText';
import { ocrPdf, OCR_MAX_PAGES } from './pdfOcr';
import { sniffScripture } from './sniffScripture';

// If the pdfjs text extraction yields fewer than this many characters
// for the whole doc, assume it's image-only and try OCR. Real lessons
// even with sparse text usually clear this comfortably.
const PDF_TEXT_SPARSE_THRESHOLD = 200;

/**
 * Parse one file. Always returns the envelope shape above — failures
 * surface as `parseError` rather than throwing.
 */
export async function parseLessonFile(file, { onOcrProgress } = {}) {
  const filename = file?.name || '(unnamed)';
  const lower = filename.toLowerCase();

  if (lower.endsWith('.docx')) {
    const out = await parseDocxLesson(file);
    return enrichWithScripture(out);
  }

  if (lower.endsWith('.pdf')) {
    return enrichWithScripture(await parsePdfLesson(file, { onOcrProgress }));
  }

  return {
    filename,
    fileModifiedAt: file?.lastModified
      ? new Date(file.lastModified).toISOString().slice(0, 10)
      : null,
    title: titleFromFilename(filename),
    scripture_reference: '',
    body: '',
    images: [],
    parseError:
      'Unsupported file type. Pick a .docx or .pdf file (other formats need conversion first).',
  };
}

// --- PDF branch -----------------------------------------------------

async function parsePdfLesson(file, { onOcrProgress } = {}) {
  const filename = file?.name || '(unnamed)';
  const fileModifiedAt = file?.lastModified
    ? new Date(file.lastModified).toISOString().slice(0, 10)
    : null;
  const base = {
    filename,
    fileModifiedAt,
    title: titleFromFilename(filename),
    scripture_reference: '',
    body: '',
    images: [],
  };

  // Stage 1: pdfjs text.
  let extracted;
  try {
    extracted = await extractPdfText(file);
  } catch (e) {
    return { ...base, parseError: `Couldn't read PDF: ${e.message || e}` };
  }
  const text = (extracted.text || '').trim();

  if (text.length >= PDF_TEXT_SPARSE_THRESHOLD) {
    // Good text PDF — use it directly.
    return { ...base, body: text };
  }

  // Stage 2: OCR fallback via Claude vision.
  try {
    const ocrResult = await ocrPdf(file, { onProgress: onOcrProgress });
    const warning = ocrResult.truncated
      ? `PDF has ${ocrResult.pageCount} pages; only the first ${OCR_MAX_PAGES} were OCRed. ` +
        `Open the lesson after import to fill in the rest if needed.`
      : '';
    return {
      ...base,
      body: ocrResult.text || '',
      parseWarning: warning,
      ocr: {
        used: true,
        truncated: ocrResult.truncated,
        pageCount: ocrResult.pageCount,
      },
    };
  } catch (e) {
    return {
      ...base,
      // Fall back to whatever sparse text pdfjs returned, but warn.
      body: text,
      parseWarning:
        `Couldn't OCR this PDF (${e.message || e}). ` +
        `Imported with whatever text pdfjs could extract — you may want ` +
        `to fill in the body manually.`,
    };
  }
}

// --- post-process ---------------------------------------------------

function enrichWithScripture(parsed) {
  if (!parsed || parsed.parseError || !parsed.body) return parsed;
  if (parsed.scripture_reference) return parsed; // already set
  const sniffed = sniffScripture(parsed.body);
  return sniffed ? { ...parsed, scripture_reference: sniffed } : parsed;
}
