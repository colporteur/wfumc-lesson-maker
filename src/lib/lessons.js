// CRUD around the `lessons` table. Owner-scoped: RLS enforces
// owner_user_id = auth.uid() so we don't have to filter explicitly,
// but we do pass owner_user_id on insert for clarity.

import { supabase, withTimeout } from './supabase';

export async function listLessons({ search = '', limit = 200 } = {}) {
  let q = supabase
    .from('lessons')
    .select('id, title, scripture_reference, themes, updated_at, created_at')
    .order('updated_at', { ascending: false })
    .limit(limit);

  // Server-side text filter. Wrap in `%...%` for substring match across
  // title + scripture_reference. `ilike` is case-insensitive.
  if (search && search.trim()) {
    const term = `%${search.trim().replace(/[%_]/g, (m) => `\\${m}`)}%`;
    q = q.or(
      `title.ilike.${term},scripture_reference.ilike.${term}`
    );
  }

  const { data, error } = await withTimeout(q);
  if (error) throw error;
  return data || [];
}

export async function getLesson(id) {
  const { data, error } = await withTimeout(
    supabase.from('lessons').select('*').eq('id', id).maybeSingle()
  );
  if (error) throw error;
  return data;
}

export async function createLesson({ ownerUserId, draft }) {
  const row = sanitizeDraft(draft);
  const { data, error } = await withTimeout(
    supabase
      .from('lessons')
      .insert({
        ...row,
        owner_user_id: ownerUserId,
      })
      .select()
      .single()
  );
  if (error) throw error;
  return data;
}

export async function updateLesson(id, draft) {
  const row = sanitizeDraft(draft);
  const { data, error } = await withTimeout(
    supabase
      .from('lessons')
      .update(row)
      .eq('id', id)
      .select()
      .single()
  );
  if (error) throw error;
  return data;
}

export async function deleteLesson(id) {
  // RLS-scoped — the user only sees their own rows, so this is safe.
  const { error } = await withTimeout(
    supabase.from('lessons').delete().eq('id', id)
  );
  if (error) throw error;
}

// Strip out fields that shouldn't go to the DB; coerce empty strings to
// null so the column doesn't store "". Themes is an array column.
function sanitizeDraft(draft) {
  const out = {};
  const stringFields = ['title', 'scripture_reference', 'body', 'class_notes'];
  for (const f of stringFields) {
    if (Object.prototype.hasOwnProperty.call(draft, f)) {
      const v = draft[f];
      out[f] = v == null || v === '' ? null : v;
    }
  }
  if (Object.prototype.hasOwnProperty.call(draft, 'themes')) {
    const t = draft.themes;
    out.themes = Array.isArray(t)
      ? t.map((s) => String(s).trim()).filter(Boolean)
      : [];
  }
  return out;
}

/**
 * Append additional text to a lesson's body, separated by a blank line
 * plus a small header so the merge is visible in the body itself. Used
 * by the bulk importer's "merge" action.
 *
 * Returns the updated lesson row.
 */
export async function appendToBody(id, additionalBody, { headerLabel } = {}) {
  if (!id || !additionalBody) {
    // Nothing to append — return the current row unchanged.
    return await getLesson(id);
  }
  const current = await getLesson(id);
  if (!current) throw new Error('Lesson not found');
  const existing = (current.body || '').trim();
  const incoming = (additionalBody || '').trim();
  const header = headerLabel ? `--- ${headerLabel} ---\n\n` : '';
  const combined = existing
    ? `${existing}\n\n${header}${incoming}`
    : `${header}${incoming}`;
  return await updateLesson(id, { body: combined });
}

/**
 * Replace just the body of a lesson, leaving title / scripture / themes
 * / class notes alone. Used by the bulk importer's "replace" action.
 */
export async function replaceLessonBody(id, body) {
  return await updateLesson(id, { body: body ?? '' });
}

/**
 * Look up a lesson by exact title (case-insensitive). Returns the
 * lesson row or null. Used by BulkImport to find a merge target.
 */
export async function findLessonByTitle(title) {
  const t = (title || '').trim();
  if (!t) return null;
  const { data, error } = await withTimeout(
    supabase
      .from('lessons')
      .select('id, title')
      .ilike('title', t)
      .limit(1)
      .maybeSingle()
  );
  if (error) throw error;
  return data ?? null;
}

// Convenience used by Dashboard: total + most-recent.
export async function getLessonStats() {
  const [count, recent] = await Promise.all([
    withTimeout(
      supabase.from('lessons').select('id', { count: 'exact', head: true })
    ),
    withTimeout(
      supabase
        .from('lessons')
        .select('id, title, scripture_reference, updated_at')
        .order('updated_at', { ascending: false })
        .limit(5)
    ),
  ]);
  if (count.error) throw count.error;
  if (recent.error) throw recent.error;
  return {
    total: count.count || 0,
    recent: recent.data || [],
  };
}
