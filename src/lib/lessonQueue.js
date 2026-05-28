// Per-group queue of upcoming lessons.
//
// The pastor builds up a queue ahead of time, then on meeting day
// uses Start From Queue to pull the top entry and pre-fill Record Use.
// recordUse in lessonUses.js calls removeQueueEntryIfPresent on
// success so completed lessons auto-pop.

import { supabase, withTimeout } from './supabase';

// --- queries --------------------------------------------------------

/**
 * List a group's queue in order, joined with the lesson row.
 */
export async function listQueueForGroup(groupId) {
  const { data, error } = await withTimeout(
    supabase
      .from('lesson_queue')
      .select(
        'id, sort_order, lesson:lessons(id, title, scripture_reference, themes, updated_at)'
      )
      .eq('group_id', groupId)
      .order('sort_order', { ascending: true })
  );
  if (error) throw error;
  return data ?? [];
}

/**
 * List queue entries for one lesson — which groups have it queued?
 * Joined with the group row.
 */
export async function listQueuesForLesson(lessonId) {
  const { data, error } = await withTimeout(
    supabase
      .from('lesson_queue')
      .select(
        'id, sort_order, group:lesson_groups(id, name, is_active)'
      )
      .eq('lesson_id', lessonId)
  );
  if (error) throw error;
  return data ?? [];
}

// --- mutations ------------------------------------------------------

/**
 * Idempotent add. If the lesson is already queued for the group,
 * returns the existing row. Otherwise appends to the end of the
 * group's queue and returns the new row.
 */
export async function addToQueue({ lessonId, groupId, ownerUserId }) {
  if (!lessonId || !groupId || !ownerUserId) {
    throw new Error('Missing lessonId / groupId / ownerUserId');
  }
  // Cheaper than catching the unique-violation: check first.
  const existing = await listQueueForGroup(groupId);
  const dupe = existing.find((q) => q.lesson?.id === lessonId);
  if (dupe) return dupe;

  const nextOrder = existing.length
    ? Math.max(...existing.map((q) => q.sort_order ?? 0)) + 1
    : 0;

  const { data, error } = await withTimeout(
    supabase
      .from('lesson_queue')
      .insert({
        lesson_id: lessonId,
        group_id: groupId,
        owner_user_id: ownerUserId,
        sort_order: nextOrder,
      })
      .select(
        'id, sort_order, lesson:lessons(id, title, scripture_reference, themes, updated_at)'
      )
      .single()
  );
  if (error) throw error;
  return data;
}

export async function removeFromQueue(entryId) {
  const { error } = await withTimeout(
    supabase.from('lesson_queue').delete().eq('id', entryId)
  );
  if (error) throw error;
}

/**
 * Find + delete the queue entry for a (lesson_id, group_id) pair if it
 * exists. Used by recordUse to auto-pop the queue. Best-effort — a
 * missing entry isn't an error.
 */
export async function removeQueueEntryIfPresent({ lessonId, groupId }) {
  if (!lessonId || !groupId) return;
  const { error } = await withTimeout(
    supabase
      .from('lesson_queue')
      .delete()
      .eq('lesson_id', lessonId)
      .eq('group_id', groupId)
  );
  if (error) {
    // Don't throw — recording the use already succeeded, and a stale
    // queue is a minor inconvenience the pastor can fix manually.
    // eslint-disable-next-line no-console
    console.warn('Failed to auto-pop queue entry', error);
  }
}

/**
 * Reorder a group's queue by writing new sort_order values. Pass
 * the entry IDs in the desired new order. Re-densifies (0..n-1)
 * so gaps from earlier removes get cleaned up at the same time.
 */
export async function reorderQueue(orderedIds) {
  if (!Array.isArray(orderedIds) || orderedIds.length === 0) return;
  // Sequential updates — small N (typical queues are <20), parallelism
  // not worth the complexity here.
  for (let i = 0; i < orderedIds.length; i++) {
    const { error } = await withTimeout(
      supabase
        .from('lesson_queue')
        .update({ sort_order: i })
        .eq('id', orderedIds[i])
    );
    if (error) throw error;
  }
}

/**
 * Move one queue entry up or down by one slot. Wrapper around
 * reorderQueue that does the array swap for the caller.
 */
export async function moveInQueue(groupId, entryId, direction) {
  const current = await listQueueForGroup(groupId);
  const idx = current.findIndex((q) => q.id === entryId);
  if (idx < 0) return current;
  const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (targetIdx < 0 || targetIdx >= current.length) return current;
  const ids = current.map((q) => q.id);
  [ids[idx], ids[targetIdx]] = [ids[targetIdx], ids[idx]];
  await reorderQueue(ids);
  return listQueueForGroup(groupId);
}
