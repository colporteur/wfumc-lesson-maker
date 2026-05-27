// "Lesson X was used by group Y on date Z" — the rotation tracker
// substrate.
//
// The two query helpers power the bidirectional rotation panels:
//   - listUsesForLesson  → LessonDetail "Used by" panel
//   - lessonsNotYetUsedByGroup → GroupDetail "Lessons not yet used"
// And the symmetric "lessons used by group" is just listUsesForGroup.

import { supabase, withTimeout } from './supabase';

/**
 * Record that a lesson was used by a group on a given date. used_on
 * is a YYYY-MM-DD string (Postgres DATE column).
 */
export async function recordUse({ lessonId, groupId, ownerUserId, usedOn }) {
  if (!lessonId || !groupId || !ownerUserId) {
    throw new Error('Missing lessonId / groupId / ownerUserId');
  }
  if (!usedOn) throw new Error('Missing date.');
  const { data, error } = await withTimeout(
    supabase
      .from('lesson_uses')
      .insert({
        lesson_id: lessonId,
        group_id: groupId,
        owner_user_id: ownerUserId,
        used_on: usedOn,
      })
      .select(
        'id, used_on, lesson_id, group_id, group:lesson_groups(id, name)'
      )
      .single()
  );
  if (error) throw error;
  return data;
}

export async function removeUse(useId) {
  const { error } = await withTimeout(
    supabase.from('lesson_uses').delete().eq('id', useId)
  );
  if (error) throw error;
}

/**
 * "Where has this lesson been used?" — list uses for one lesson, with
 * the group row joined. Most recent first.
 */
export async function listUsesForLesson(lessonId) {
  const { data, error } = await withTimeout(
    supabase
      .from('lesson_uses')
      .select(
        'id, used_on, group:lesson_groups(id, name, is_active)'
      )
      .eq('lesson_id', lessonId)
      .order('used_on', { ascending: false })
  );
  if (error) throw error;
  return data ?? [];
}

/**
 * "Which lessons has this group used?" — list uses for one group, with
 * the lesson row joined. Most recent first.
 */
export async function listUsesForGroup(groupId) {
  const { data, error } = await withTimeout(
    supabase
      .from('lesson_uses')
      .select(
        'id, used_on, lesson:lessons(id, title, scripture_reference)'
      )
      .eq('group_id', groupId)
      .order('used_on', { ascending: false })
  );
  if (error) throw error;
  return data ?? [];
}

/**
 * "Lessons not yet used by this group" — the rotation tracker workhorse.
 * Pulls all the user's lessons, subtracts any that already have a
 * lesson_use row for the given group. Returns lessons sorted by most-
 * recently-edited (so the freshest ideas float up).
 *
 * Two-query approach: cheap and avoids needing a NOT EXISTS subquery
 * Supabase doesn't support cleanly via PostgREST.
 */
export async function lessonsNotYetUsedByGroup(groupId, { limit = 200 } = {}) {
  // 1. lessons already used by this group.
  const { data: used, error: usedErr } = await withTimeout(
    supabase.from('lesson_uses').select('lesson_id').eq('group_id', groupId)
  );
  if (usedErr) throw usedErr;
  const usedIds = new Set((used ?? []).map((u) => u.lesson_id));

  // 2. all the user's lessons (RLS scopes to the current user).
  const { data: all, error: allErr } = await withTimeout(
    supabase
      .from('lessons')
      .select('id, title, scripture_reference, themes, updated_at')
      .order('updated_at', { ascending: false })
      .limit(limit)
  );
  if (allErr) throw allErr;

  return (all ?? []).filter((l) => !usedIds.has(l.id));
}
