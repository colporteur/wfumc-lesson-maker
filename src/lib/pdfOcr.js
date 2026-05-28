// PDF OCR fallback for scanned (image-only) PDFs.
//
// Strategy:
//   1. extractPdfText (pdfText.js) returns very little or no text.
//   2. We render each PDF page to a JPEG via pdfjs's canvas API.
//   3. Pages are sent to Claude vision in batches of 20 (transcribePdfPages).
//   4. The concatenated transcription becomes the lesson body.
//
// We cap total pages at 60 to keep cost + latency sane. Anything
// bigger gets a heads-up; the pastor can pick the lesson and revisit
// later if a slice is missing.

import { transcribePdfPages } from './claude';

const OCR_BATCH = 20;
const OCR_MAX_PAGES = 60;
const RENDER_SCALE = 1.5; // 1.5x for good legibility without bloat

// Borrow the same lazy pdfjs loader pattern as pdfText.
let _pdfjsPromise = null;
async function getPdfjs() {
  if (_pdfjsPromise) return _pdfjsPromise;
  _pdfjsPromise = (async () => {
    const pdfjsLib = await import('pdfjs-dist');
    const workerSrc = (
      await import('pdfjs-dist/build/pdf.worker.mjs?url')
    ).default;
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;
    return pdfjsLib;
  })();
  return _pdfjsPromise;
}

async function renderPageToJpegBlob(page) {
  const viewport = page.getViewport({ scale: RENDER_SCALE });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport }).promise;
  return await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) =>
        b ? resolve(b) : reject(new Error('toBlob returned null')),
      'image/jpeg',
      0.85
    );
  });
}

/**
 * OCR a PDF Blob by rendering pages and sending them to Claude vision
 * in batches. Returns { text, pageCount, ocrPageCount, truncated }.
 *
 * `truncated` is true if the PDF had more pages than OCR_MAX_PAGES.
 */
export async function ocrPdf(blob, { onProgress } = {}) {
  const pdfjs = await getPdfjs();
  const arrayBuffer = await blob.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: arrayBuffer }).promise;
  const totalPages = doc.numPages;
  const ocrPages = Math.min(totalPages, OCR_MAX_PAGES);
  const truncated = ocrPages < totalPages;

  // Render all pages first so OCR batches can be issued in parallel later
  // if we want; for now we do them sequentially batch by batch.
  const pageBlobs = [];
  for (let p = 1; p <= ocrPages; p++) {
    const page = await doc.getPage(p);
    const jpeg = await renderPageToJpegBlob(page);
    pageBlobs.push(jpeg);
    if (typeof onProgress === 'function') {
      onProgress({ phase: 'render', done: p, total: ocrPages });
    }
  }

  // OCR in batches of OCR_BATCH.
  const parts = [];
  for (let i = 0; i < pageBlobs.length; i += OCR_BATCH) {
    const batch = pageBlobs.slice(i, i + OCR_BATCH);
    const text = await transcribePdfPages(batch);
    if (text) parts.push(text);
    if (typeof onProgress === 'function') {
      onProgress({
        phase: 'ocr',
        done: Math.min(i + batch.length, pageBlobs.length),
        total: pageBlobs.length,
      });
    }
  }

  return {
    text: parts.join('\n\n').trim(),
    pageCount: totalPages,
    ocrPageCount: ocrPages,
    truncated,
  };
}

export { OCR_MAX_PAGES };
