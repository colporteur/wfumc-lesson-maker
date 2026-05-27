// Cross-app query into the shared `resources` table populated by the
// Sermons app. The Lesson Maker doesn't own this table — it just reads
// and references rows by id (stored in lessons.attached_resource_ids).
//
// We re-implement search + scripture-overlap suggestion locally because
// it's simpler than importing utilities from the Sermons app.

import { supabase, withTimeout } from './supabase';
import {
  parseScriptureRanges,
  rangesOverlap,
  formatRange,
} from './scripture';

// All resource types the Sermons app supports. The picker shows them
// all by default; the type filter narrows.
export const RESOURCE_TYPES = ['story', 'quote', 'illustration', 'joke', 'note', 'photo'];

/**
 * Free-text search across the current user's resources. Matches
 * content, title, source, themes, and scripture_refs. Sorted by
 * most-recently-updated.
 */
export async function searchResources({
  search = '',
  type = '',
  limit = 50,
} = {}) {
  let q = supabase
    .from('resources')
    .select('id, resource_type, title, content, source, themes, scripture_refs, tone, updated_at')
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (type) q = q.eq('resource_type', type);
  if (search && search.trim()) {
    const term = `%${search.trim().replace(/[%_]/g, (m) => `\\${m}`)}%`;
    q = q.or(
      `title.ilike.${term},content.ilike.${term},source.ilike.${term},scripture_refs.ilike.${term}`
    );
  }
  const { data, error } = await withTimeout(q);
  if (error) throw error;
  return data ?? [];
}

/**
 * Suggest resources by scripture overlap. We pull a bounded set of
 * resources that have any scripture_refs at all, then filter
 * client-side using the shared scripture parser. Capped at 300
 * candidates — way more than typical, but a safety net.
 */
export async function suggestResourcesByScripture(lessonScriptureRef) {
  if (!lessonScriptureRef || !lessonScriptureRef.trim()) return [];
  const targetRanges = parseScriptureRanges(lessonScriptureRef);
  if (targetRanges.length === 0) return [];

  const { data, error } = await withTimeout(
    supabase
      .from('resources')
      .select('id, resource_type, title, content, source, themes, scripture_refs, tone, updated_at')
      .not('scripture_refs', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(300)
  );
  if (error) throw error;
  const rows = data ?? [];

  const matches = [];
  for (const r of rows) {
    const rRanges = parseScriptureRanges(r.scripture_refs);
    const overlapping = [];
    outer: for (const rr of rRanges) {
      for (const tr of targetRanges) {
        if (rangesOverlap(rr, tr)) {
          overlapping.push(rr);
          break outer;
        }
      }
    }
    if (overlapping.length > 0) {
      matches.push({
        ...r,
        // Stash which ranges matched, so the UI can show "matches
        // Acts 17:22" instead of just a green check.
        matched_ranges: overlapping,
        matched_label: overlapping.map(formatRange).join(', '),
      });
    }
  }
  return matches;
}

/**
 * Hydrate an array of resource IDs into full rows (in the order given).
 * Used by the Workspace to render attached-resource chips and to build
 * the Claude prompt context.
 */
export async function getResourcesByIds(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  const { data, error } = await withTimeout(
    supabase
      .from('resources')
      .select('id, resource_type, title, content, source, themes, scripture_refs, tone')
      .in('id', ids)
  );
  if (error) throw error;
  const rows = data ?? [];
  // Restore the caller's order — Supabase doesn't guarantee it on .in().
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

/**
 * Save the attached-resource id list back to the lesson row. Order
 * matters for display + prompt assembly.
 */
export async function setAttachedResourceIds(lessonId, ids) {
  const clean = Array.isArray(ids) ? ids.filter(Boolean) : [];
  const { data, error } = await withTimeout(
    supabase
      .from('lessons')
      .update({ attached_resource_ids: clean })
      .eq('id', lessonId)
      .select('id, attached_resource_ids')
      .single()
  );
  if (error) throw error;
  return data;
}

/**
 * Format an array of resource rows into the context block Claude reads
 * when revising the lesson body. Kept compact so we don't blow the
 * token budget on a 20-resource attachment.
 */
export function formatResourcesContext(resources) {
  if (!Array.isArray(resources) || resources.length === 0) return '';
  const parts = resources.map((r, i) => {
    const lines = [];
    lines.push(`## Resource ${i + 1} — ${r.resource_type}${r.title ? `: ${r.title}` : ''}`);
    if (r.source) lines.push(`Source: ${r.source}`);
    if (r.scripture_refs) lines.push(`Scripture: ${r.scripture_refs}`);
    if (Array.isArray(r.themes) && r.themes.length > 0)
      lines.push(`Themes: ${r.themes.join(', ')}`);
    if (r.tone) lines.push(`Tone: ${r.tone}`);
    lines.push('');
    lines.push(r.content || '');
    return lines.join('\n');
  });
  return parts.join('\n\n---\n\n');
}
