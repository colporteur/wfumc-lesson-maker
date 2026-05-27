// Cross-app voice-guide loader.
//
// The Sermons app owns the pastoral_voice_guides + voice_exemplars
// tables and the settings UI for editing them. The Lesson Maker only
// READS — we want Claude to write lessons in the same voice as
// sermons, so we load the guide + exemplars and assemble them into a
// system-prompt block exactly like the Sermons Workspace does.
//
// If/when the pastor decides he wants a distinct lesson voice (e.g.
// more conversational), this loader is the single seam to swap.

import { supabase, withTimeout } from './supabase';

// --- guide + exemplars fetch ----------------------------------------

async function fetchVoiceGuide(userId) {
  if (!userId) return null;
  const { data, error } = await withTimeout(
    supabase
      .from('pastoral_voice_guides')
      .select('*')
      .eq('owner_user_id', userId)
      .maybeSingle()
  );
  if (error) throw error;
  return data ?? null;
}

async function fetchExemplars(guideId) {
  if (!guideId) return [];
  const { data, error } = await withTimeout(
    supabase
      .from('voice_exemplars')
      .select(
        'id, sort_order, note, sermon:sermons(id, title, scripture_reference, manuscript_text)'
      )
      .eq('voice_guide_id', guideId)
      .order('sort_order', { ascending: true })
  );
  if (error) throw error;
  return data ?? [];
}

// --- prompt assembly ------------------------------------------------

/**
 * Load the pastor's voice guide (from the Sermons app's tables) and
 * render the system-prompt block that goes into Claude calls. Returns:
 *   { guide, exemplars, systemPrompt }
 *
 * systemPrompt is empty string if the pastor hasn't set up a voice
 * guide yet — that's the signal for the Workspace to skip injecting it.
 *
 * Note: we slightly soften the wording vs. the Sermons-app version so
 * the lesson context is acknowledged ("the pastor's preaching voice
 * applied to a teaching context").
 */
export async function loadVoiceGuideForPrompt(userId) {
  if (!userId) {
    return { guide: null, exemplars: [], systemPrompt: '' };
  }
  const guide = await fetchVoiceGuide(userId);
  const exemplars = guide ? await fetchExemplars(guide.id) : [];

  const parts = [];
  if (guide?.guide_text?.trim()) {
    parts.push(
      `# Pastoral Voice Guide\n\nThe following describes how this pastor writes (originally for sermons). Match this voice — vocabulary, sentence rhythm, theological framing, characteristic moves — adapted for a Bible-study teaching context. Do not editorialize about the voice; just write in it.\n\n${guide.guide_text.trim()}`
    );
  }
  const usableExemplars = exemplars.filter(
    (e) => e.sermon?.manuscript_text?.trim()
  );
  if (usableExemplars.length > 0) {
    const samples = usableExemplars
      .map((e, i) => {
        const title = e.sermon?.title || `Exemplar ${i + 1}`;
        const ref = e.sermon?.scripture_reference
          ? ` (${e.sermon.scripture_reference})`
          : '';
        const noteLine = e.note ? `\nNote: ${e.note}` : '';
        return `## Exemplar ${i + 1}: ${title}${ref}${noteLine}\n\n${e.sermon.manuscript_text.trim()}`;
      })
      .join('\n\n---\n\n');
    parts.push(
      `\n# Voice Exemplars\n\nThese are past sermons by this pastor. Use them as the primary source of truth for voice and rhythm. Do not copy phrasings or content from them; learn how the writer sounds and write fresh prose in that same voice — but pitched for a small-group discussion setting, not preaching.\n\n${samples}`
    );
  }

  return {
    guide,
    exemplars,
    systemPrompt: parts.join('\n\n'),
  };
}
