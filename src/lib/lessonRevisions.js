// Snapshot history for lessons.
//
// Every Claude turn in the Workspace snapshots the pre-revision body
// here, so any prior version can be reverted. Unlocking the body for
// manual edit also snapshots (so the manual edits can be undone too).

import { supabase, withTimeout } from './supabase';

// Source-tag values written by the app. Free-text in the DB, but the
// UI uses this small set; matching helps the revisions panel render
// friendlier labels.
export const REVISION_SOURCES = {
  CHAT_TURN: 'chat_turn',
  MANUAL_UNLOCK: 'manual_unlock',
  MANUAL_SAVE: 'manual_save',
  PRE_REVERT: 'pre_revert',
  IMPORT: 'import',
};

/**
 * Take a snapshot of the lesson's editable text RIGHT NOW. Called
 * before every potentially-destructive operation (chat turn, unlock,
 * revert) so we always have an undo point.
 */
export async function snapshotLesson({
  lessonId,
  ownerUserId,
  lesson,
  source,
  label,
}) {
  if (!lessonId) throw new Error('Missing lesson id');
  if (!ownerUserId) throw new Error('Missing owner');
  const { data, error } = await withTimeout(
    supabase
      .from('lesson_revisions')
      .insert({
        lesson_id: lessonId,
        owner_user_id: ownerUserId,
        snapshot_title: lesson?.title ?? null,
        snapshot_scripture_reference: lesson?.scripture_reference ?? null,
        snapshot_body: lesson?.body ?? null,
        snapshot_themes: Array.isArray(lesson?.themes) ? lesson.themes : null,
        snapshot_class_notes: lesson?.class_notes ?? null,
        source: source ?? null,
        label: label ?? null,
      })
      .select()
      .single()
  );
  if (error) throw error;
  return data;
}

export async function listRevisions(lessonId, { limit = 50 } = {}) {
  const { data, error } = await withTimeout(
    supabase
      .from('lesson_revisions')
      .select('*')
      .eq('lesson_id', lessonId)
      .order('created_at', { ascending: false })
      .limit(limit)
  );
  if (error) throw error;
  return data ?? [];
}

export async function getRevision(id) {
  const { data, error } = await withTimeout(
    supabase
      .from('lesson_revisions')
      .select('*')
      .eq('id', id)
      .maybeSingle()
  );
  if (error) throw error;
  return data;
}

/**
 * Restore the lesson row to the snapshot's values. We FIRST snapshot
 * the current state (source='pre_revert') so the revert itself can be
 * undone, then update the lesson row.
 */
export async function revertToRevision({
  lessonId,
  ownerUserId,
  revisionId,
  currentLesson,
}) {
  if (!lessonId || !revisionId) throw new Error('Missing ids');
  const revision = await getRevision(revisionId);
  if (!revision) throw new Error('Revision not found');

  // 1. snapshot the current state
  await snapshotLesson({
    lessonId,
    ownerUserId,
    lesson: currentLesson,
    source: REVISION_SOURCES.PRE_REVERT,
    label: 'Before revert',
  });

  // 2. write the revision's values back to the lesson row
  const restored = {
    title: revision.snapshot_title,
    scripture_reference: revision.snapshot_scripture_reference,
    body: revision.snapshot_body,
    themes: revision.snapshot_themes ?? [],
    class_notes: revision.snapshot_class_notes,
  };
  const { data, error } = await withTimeout(
    supabase
      .from('lessons')
      .update(restored)
      .eq('id', lessonId)
      .select()
      .single()
  );
  if (error) throw error;
  return data;
}

/**
 * Toggle body_locked on the lesson row. The Workspace calls this
 * AFTER taking a manual-unlock snapshot when locking → unlocked.
 */
export async function setBodyLocked(lessonId, locked) {
  const { data, error } = await withTimeout(
    supabase
      .from('lessons')
      .update({ body_locked: !!locked })
      .eq('id', lessonId)
      .select('id, body_locked')
      .single()
  );
  if (error) throw error;
  return data;
}
