// Cross-app query into the `pastoral_people` table populated by the
// Pastoral Records app. The Lesson Maker only reads — adding people
// happens in Pastoral Records (or via Daily Capture's inline create).
//
// Owner-scoped via RLS: we only ever see our own records.

import { supabase, withTimeout } from './supabase';

/**
 * Format a pastoral_people row into a single-line display name. Honors
 * preferred_name when set (mirroring the convention used elsewhere).
 */
export function formatPersonName(p) {
  if (!p) return '';
  const first = (p.preferred_name || p.first_name || '').trim();
  const last = (p.last_name || '').trim();
  return [first, last].filter(Boolean).join(' ') || '(unnamed)';
}

/**
 * Typeahead search across first_name, preferred_name, and last_name.
 * Returns at most `limit` rows, sorted alphabetically by last_name
 * then first_name (the natural directory ordering).
 */
export async function searchPeople({ search = '', limit = 30 } = {}) {
  let q = supabase
    .from('pastoral_people')
    .select('id, first_name, last_name, preferred_name')
    .order('last_name', { ascending: true, nullsFirst: false })
    .order('first_name', { ascending: true })
    .limit(limit);

  if (search && search.trim()) {
    const term = `%${search.trim().replace(/[%_]/g, (m) => `\\${m}`)}%`;
    q = q.or(
      `first_name.ilike.${term},last_name.ilike.${term},preferred_name.ilike.${term}`
    );
  }
  const { data, error } = await withTimeout(q);
  if (error) throw error;
  return data ?? [];
}

/**
 * Hydrate an array of person ids into rows (order preserved).
 */
export async function getPeopleByIds(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  const { data, error } = await withTimeout(
    supabase
      .from('pastoral_people')
      .select('id, first_name, last_name, preferred_name')
      .in('id', ids)
  );
  if (error) throw error;
  const rows = data ?? [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
}
