// Claude integration for the Lesson Maker.
//
// Routes through the shared `claude-proxy` Edge Function. The proxy is
// pulled from the same Supabase project that powers every other WFUMC
// app, so the Anthropic key lives server-side in church_settings.
//
// Phase B helpers:
//   - reviseLessonBody    — chat-revise loop, returns full revised body
//   - suggestScriptures   — proposes supporting scripture passages
//   - lookupScriptureNRSVUe — paste-ready NRSVue text
//   - suggestThemes       — light helper for the metadata side

import { callClaude } from './supabase';

// --- low-level helpers ----------------------------------------------

function extractText(response) {
  const block = response?.content?.find((c) => c.type === 'text');
  return block?.text ?? '';
}

function parseJsonArrayLoose(text) {
  if (!text) return null;
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenceMatch ? fenceMatch[1] : text;
  const start = candidate.indexOf('[');
  const end = candidate.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    // Try trailing-comma cleanup.
    try {
      const cleaned = candidate
        .slice(start, end + 1)
        .replace(/,(\s*[\]\}])/g, '$1');
      return JSON.parse(cleaned);
    } catch {
      return null;
    }
  }
}

// --- chat-revise loop -----------------------------------------------

/**
 * Chat-revise a lesson body. Mirrors the Sermons app's reviseSermonManuscript
 * pattern: synthetic anchor turn with the current body, then prior chat
 * history, then the new instruction. Returns the full revised body text.
 *
 * @param {Object} args
 * @param {Object} args.lesson — { title, scripture_reference, themes, class_notes }
 * @param {string} args.body — the CURRENT body text (after any pastor edits)
 * @param {string} [args.voiceSystemPrompt] — voice guide block
 * @param {string} [args.resourcesContext] — already-formatted block of
 *   selected resource text (the workspace formats this; the helper
 *   just slots it into the system prompt)
 * @param {Array<{role:'user'|'assistant', content:string}>} [args.history]
 * @param {string} args.instruction — the new turn's user instruction
 */
export async function reviseLessonBody({
  lesson,
  body,
  voiceSystemPrompt = '',
  resourcesContext = '',
  history = [],
  instruction,
}) {
  if (!instruction || !instruction.trim()) {
    throw new Error('Tell Claude what to change.');
  }

  const baseSystem = [
    'You are helping a United Methodist pastor write and revise Bible-study /',
    'Sunday-school lessons. The pastor leads small-group discussion, so the',
    'lesson body should be written as discussion-friendly teaching prose with',
    'open-ended questions woven in — not a sermon, not a worksheet.',
    '',
    '== Output rules ==',
    '- Return ONLY the full revised lesson body. No preamble like "Here is...",',
    '  no closing remarks, no explanation of what you changed, no markdown',
    '  code fences.',
    '- Preserve hand edits the pastor made between turns. Do not silently',
    "  undo a change he made unless his current instruction explicitly asks",
    '  you to.',
    '- If the instruction is small (tweak this question), make a small',
    '  targeted change and leave the rest alone.',
    '- If the instruction is large (rewrite the second section), do the',
    "  rewrite, but keep parts the instruction didn't address.",
    '- Use blank lines to separate paragraphs. Plain text only — no markdown',
    '  bullets, no headers.',
    '- Do not editorialize about the voice or theology you are matching.',
    '  Just write in the voice.',
  ].join('\n');

  const systemParts = [baseSystem];
  if (voiceSystemPrompt && voiceSystemPrompt.trim()) {
    systemParts.push(voiceSystemPrompt.trim());
  }
  if (resourcesContext && resourcesContext.trim()) {
    systemParts.push(
      '# Selected resources for this lesson\n\n' +
        'These are stories, illustrations, and quotes the pastor selected. ' +
        'Use them only if the instruction calls for them; do not force them in.\n\n' +
        resourcesContext.trim()
    );
  }

  // Metadata header so Claude knows the lesson's scripture + title.
  const lessonHeader = [];
  if (lesson?.title) lessonHeader.push(`Lesson title: ${lesson.title}`);
  if (lesson?.scripture_reference)
    lessonHeader.push(`Scripture reference: ${lesson.scripture_reference}`);
  if (Array.isArray(lesson?.themes) && lesson.themes.length > 0)
    lessonHeader.push(`Themes: ${lesson.themes.join(', ')}`);

  const anchor = [
    lessonHeader.length ? lessonHeader.join('\n') + '\n\n' : '',
    body && body.trim()
      ? '== CURRENT LESSON BODY ==\n\n' + body
      : '== NO LESSON BODY YET ==\n\nStart from scratch. Draft a new lesson body based on the scripture, themes, and the instruction below.',
  ].join('');

  const messages = [
    { role: 'user', content: anchor },
    {
      role: 'assistant',
      content:
        "Got it. I have the current lesson body and context. Tell me what to change.",
    },
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: instruction.trim() },
  ];

  const response = await callClaude(
    {
      system: systemParts.join('\n\n'),
      messages,
      max_tokens: 12000,
    },
    { timeoutMs: 180000 }
  );
  const text = extractText(response);
  return (text || '').trim();
}

// --- scripture suggester --------------------------------------------

/**
 * Propose 3-5 additional scripture passages that connect to this
 * lesson's existing scripture + themes + body. Returns:
 *   [{ ref: 'Luke 15:11-32', rationale: '...' }, ...]
 */
export async function suggestScriptures({
  lesson,
  body,
  maxSuggestions = 5,
}) {
  const ctxLines = [];
  if (lesson?.title) ctxLines.push(`Lesson title: ${lesson.title}`);
  if (lesson?.scripture_reference)
    ctxLines.push(`Primary scripture: ${lesson.scripture_reference}`);
  if (Array.isArray(lesson?.themes) && lesson.themes.length > 0)
    ctxLines.push(`Themes: ${lesson.themes.join(', ')}`);
  if (body && body.trim()) {
    // Cap the body excerpt to keep the prompt tight.
    const excerpt = body.length > 2000 ? body.slice(0, 2000) + '…' : body;
    ctxLines.push('Lesson body:\n' + excerpt);
  }

  const response = await callClaude(
    {
      system: [
        'You are helping a United Methodist pastor pick supporting scripture',
        "passages for a Bible-study / Sunday-school lesson he's writing.",
        '',
        `Suggest ${maxSuggestions} passages that:`,
        '- Connect to the primary scripture and/or themes',
        '- Open up new angles for discussion (not just restate the primary text)',
        '- Are short enough to read aloud in a small group (1-12 verses ideal)',
        '',
        'Prefer NRSVue-accessible references. Avoid duplicating the primary scripture.',
        '',
        'Return ONLY a JSON array of objects with exactly two string keys:',
        '  ref       — the canonical reference (e.g. "Luke 15:11-32")',
        '  rationale — one sentence explaining how it connects to the lesson',
        '',
        'No prose, no markdown, no code fences. Just the JSON array.',
      ].join('\n'),
      messages: [
        {
          role: 'user',
          content: ctxLines.join('\n\n'),
        },
      ],
      max_tokens: 2000,
    },
    { timeoutMs: 60000 }
  );
  const text = extractText(response);
  const arr = parseJsonArrayLoose(text);
  if (!Array.isArray(arr)) {
    throw new Error(
      'Claude did not return a parseable list of scripture suggestions.'
    );
  }
  // Defensive shape-check.
  return arr
    .map((x) => ({
      ref: String(x?.ref || '').trim(),
      rationale: String(x?.rationale || '').trim(),
    }))
    .filter((x) => x.ref);
}

// --- single-reference NRSVue lookup ---------------------------------

/**
 * Returns the verse text in NRSVue, as continuous prose, followed by a
 * blank line and the reference on its own line. Suitable for pasting
 * directly into the lesson body.
 */
export async function lookupScriptureNRSVUe(reference) {
  const ref = (reference || '').trim();
  if (!ref) throw new Error('No scripture reference provided.');
  const response = await callClaude(
    {
      system:
        'You are helping prepare a Bible-study handout. When asked for a scripture passage, return ONLY the verse text — no verse numbers, no brackets, no introduction, no commentary, no copyright notice. Run the verses together as continuous prose. After all the verses, output a blank line, then the full scripture reference on its own line (e.g. "Luke 15:11-32"). Use plain text only — no markdown.',
      messages: [
        {
          role: 'user',
          content: `Please provide ${ref} in the NRSVue translation.`,
        },
      ],
      max_tokens: 2000,
    },
    { timeoutMs: 60000 }
  );
  const text = extractText(response).trim();
  if (!text) throw new Error('Claude returned no text.');
  return text;
}
