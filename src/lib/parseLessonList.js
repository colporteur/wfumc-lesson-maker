// Defensive parser for the pastor's plain-text lesson list.
//
// Accepts one lesson per line. The format is intentionally loose so the
// pastor can paste lists that came from notes, emails, table-of-contents
// scrapes, etc. We detect optional " — scripture" or " | scripture"
// separators and split into { title, scripture_reference }.
//
// Lines that look like headers, dates, page numbers, or empty are
// skipped — but the parser surfaces what it did so the pastor can
// see if it threw away anything important.

// Anything matching this looks like a scripture reference. Used to
// recognize the "tail" of a line as a citation when there's no
// explicit separator. Must contain at least one digit.
const SCRIPTURE_TAIL_RE =
  /\b(?:[1-3]\s)?[A-Z][a-z]+(?:\s[A-Z][a-z]+)?\s+\d+(?::\d+(?:[-–—]\d+(?::\d+)?)?)?$/;

// Lines we explicitly skip rather than turning into lessons.
const SKIP_PATTERNS = [
  /^\s*$/, // blank
  /^[-=_*~]{3,}\s*$/, // horizontal rules
  /^page\s+\d+\b/i,
  /^\d{1,3}\s*$/, // bare page numbers
  /^chapter\s+\d/i,
  /^section\s+\d/i,
  // ISO/US dates on their own line
  /^\d{1,4}[-/]\d{1,2}[-/]\d{1,4}\s*$/,
  // Tiny month-name + year headers ("January 2024")
  /^(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4}\s*$/i,
];

function shouldSkip(line) {
  return SKIP_PATTERNS.some((re) => re.test(line));
}

// Strip leading "1. ", "1) ", "•", "-", "*", "—" markers that come from
// numbered or bulleted lists.
function stripListMarker(line) {
  return line.replace(
    /^\s*(?:\d{1,3}[.)]\s+|[-*•–—]\s+)/,
    ''
  );
}

/**
 * Parse one cleaned line into { title, scripture_reference }.
 * Detects explicit "—", "–", or "|" separators first, then falls back
 * to sniffing a trailing-citation pattern.
 */
function parseLine(cleaned) {
  // Explicit separators.
  const sepMatch = cleaned.match(/^(.*?)\s*[—–|]\s+(.+?)\s*$/);
  if (sepMatch) {
    const left = sepMatch[1].trim();
    const right = sepMatch[2].trim();
    // If the right side looks like a scripture, treat it as one.
    // Otherwise, assume the dash is just stylistic — keep whole line as title.
    if (/\d/.test(right) && SCRIPTURE_TAIL_RE.test(right)) {
      return { title: left, scripture_reference: right };
    }
    return { title: cleaned, scripture_reference: '' };
  }

  // No separator: sniff a trailing-citation.
  const tail = cleaned.match(SCRIPTURE_TAIL_RE);
  if (tail && tail.index > 3) {
    const title = cleaned.slice(0, tail.index).trim();
    const ref = cleaned.slice(tail.index).trim();
    // Only split if the title still has substance.
    if (title.length >= 3) {
      return { title, scripture_reference: ref };
    }
  }

  return { title: cleaned, scripture_reference: '' };
}

/**
 * Parse a multi-line text blob into an array of parsed rows + a small
 * stats object. Each row is { lineNo, raw, title, scripture_reference,
 * skipped: bool, reason: string }.
 */
export function parseLessonList(text) {
  if (!text || typeof text !== 'string') {
    return { rows: [], skippedCount: 0, kept: 0, totalLines: 0 };
  }
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const rows = [];
  let skippedCount = 0;
  let kept = 0;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (shouldSkip(raw)) {
      if (raw.trim() === '') continue; // blank lines: don't even surface
      rows.push({
        lineNo: i + 1,
        raw,
        title: '',
        scripture_reference: '',
        skipped: true,
        reason: 'looked like a header or page number',
      });
      skippedCount++;
      continue;
    }
    const cleaned = stripListMarker(raw).trim();
    if (!cleaned) {
      // List marker with nothing after — treat as a blank.
      continue;
    }
    const parsed = parseLine(cleaned);
    if (!parsed.title || parsed.title.length < 2) {
      rows.push({
        lineNo: i + 1,
        raw,
        title: cleaned,
        scripture_reference: '',
        skipped: true,
        reason: 'too short to be a title',
      });
      skippedCount++;
      continue;
    }
    rows.push({
      lineNo: i + 1,
      raw,
      title: parsed.title,
      scripture_reference: parsed.scripture_reference,
      skipped: false,
    });
    kept++;
  }

  return { rows, skippedCount, kept, totalLines: lines.length };
}
