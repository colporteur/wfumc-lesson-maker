// Detect a scripture reference in the first few lines of a lesson body
// during bulk import. Conservative — we only suggest a reference if
// we're confident, leaving scripture_reference blank otherwise so the
// pastor isn't fighting wrong auto-fills.
//
// Strategy: walk the first N paragraphs and run a tight regex that
// requires a book name from BIBLE_BOOKS followed by a chapter (and
// optionally :verse). The first hit wins. If the hit is in the first
// 200 chars of the body OR on a line by itself, we treat it as the
// lesson's primary scripture; otherwise we ignore (it's probably a
// passing in-prose citation, not a header).

import { BIBLE_BOOKS } from './scripture';

// Build the book-name half of the regex from the canonical list.
// Allows "1 Corinthians", "II Kings", "Psalm" (alias of Psalms), etc.
function buildBookGroup() {
  const variants = new Set();
  for (const b of BIBLE_BOOKS) {
    variants.add(escapeRegex(b));
    // Common numeric → roman swap.
    if (/^1\s/.test(b)) variants.add('I\\s' + escapeRegex(b.slice(2)));
    if (/^2\s/.test(b)) variants.add('II\\s' + escapeRegex(b.slice(2)));
    if (/^3\s/.test(b)) variants.add('III\\s' + escapeRegex(b.slice(2)));
  }
  // Special aliases used in the wild.
  variants.add('Psalm');
  variants.add('Song of Songs');
  return Array.from(variants).join('|');
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const BOOK_GROUP = buildBookGroup();
// Citation: book + chapter, optional :verse(s), optional range, optional
// semicolon-chained continuation.
const CITATION_RE = new RegExp(
  `\\b(?:${BOOK_GROUP})\\s+\\d+(?::\\d+(?:[-–—]\\d+(?::\\d+)?)?)?` +
    `(?:\\s*[;,]\\s*\\d+(?::\\d+(?:[-–—]\\d+(?::\\d+)?)?)?)*`,
  'g'
);

const SCAN_PARAGRAPHS = 6;
const NEAR_TOP_CHARS = 200;

/**
 * Try to detect the primary scripture reference for a lesson body.
 * Returns a string (e.g. "Luke 15:11-32") or '' if nothing clean was found.
 */
export function sniffScripture(body) {
  if (!body || typeof body !== 'string') return '';

  // Take the first N non-empty paragraphs.
  const paragraphs = body
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .slice(0, SCAN_PARAGRAPHS);

  for (const para of paragraphs) {
    // Standalone-line case: the WHOLE paragraph is just a citation.
    // That's the strongest signal — e.g. a header line like "Luke 15:11-32".
    const lineMatch = para.match(
      new RegExp(`^\\s*(?:${BOOK_GROUP})\\s+\\d+(?::\\d+(?:[-–—]\\d+(?::\\d+)?)?)?\\.?\\s*$`)
    );
    if (lineMatch) {
      return cleanRef(lineMatch[0]);
    }
  }

  // Fall back to first inline citation in the early body.
  const intro = body.slice(0, NEAR_TOP_CHARS * 4); // give it a bit more room than NEAR_TOP_CHARS
  CITATION_RE.lastIndex = 0;
  const first = CITATION_RE.exec(intro);
  if (first && first.index <= NEAR_TOP_CHARS) {
    return cleanRef(first[0]);
  }

  return '';
}

function cleanRef(s) {
  return s
    .replace(/\s+/g, ' ')
    .replace(/[–—]/g, '-')
    .replace(/\.\s*$/, '')
    .trim();
}
