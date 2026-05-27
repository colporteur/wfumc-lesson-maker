// Image upload + gallery helpers for lessons. Mirrors the
// resourceImages.js convention used by the Sermons app: one row per
// image in `lesson_images`, owner-scoped storage paths in the
// `lesson-images` bucket, idempotent dedupe by content_hash.

import { supabase, withTimeout } from './supabase';
import { fileHash, rotateImageBlob90CW } from './imageHelpers';

export const LESSON_BUCKET = 'lesson-images';

/**
 * Upload a File/Blob to the lesson-images bucket. Returns the path.
 */
export async function uploadLessonImage({
  file,
  ownerUserId,
  lessonId,
  contentType,
}) {
  if (!file) throw new Error('No file selected');
  if (!ownerUserId) throw new Error('Missing owner');
  if (!lessonId) throw new Error('Missing lesson id');

  let ext = 'bin';
  const name = file.name || '';
  const dot = name.lastIndexOf('.');
  if (dot > 0 && dot < name.length - 1) {
    ext = name.slice(dot + 1).toLowerCase();
  } else if (file.type || contentType) {
    const m = (file.type || contentType).match(/\/([a-z0-9]+)$/i);
    if (m) ext = m[1] === 'jpeg' ? 'jpg' : m[1].toLowerCase();
  }
  const path = `${ownerUserId}/${lessonId}/${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}.${ext}`;

  const { error } = await withTimeout(
    supabase.storage.from(LESSON_BUCKET).upload(path, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type || contentType || `image/${ext}`,
    }),
    60000
  );
  if (error) throw error;
  return path;
}

export function publicLessonImageUrl(path) {
  if (!path) return null;
  return supabase.storage
    .from(LESSON_BUCKET)
    .getPublicUrl(path).data.publicUrl;
}

export async function listLessonImages(lessonId) {
  const { data, error } = await withTimeout(
    supabase
      .from('lesson_images')
      .select('*')
      .eq('lesson_id', lessonId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })
  );
  if (error) throw error;
  return data ?? [];
}

export async function attachImageRow({
  lessonId,
  ownerUserId,
  imagePath,
  sortOrder,
  caption,
  contentHash,
}) {
  const { data, error } = await withTimeout(
    supabase
      .from('lesson_images')
      .insert({
        lesson_id: lessonId,
        owner_user_id: ownerUserId,
        image_path: imagePath,
        sort_order: sortOrder ?? 0,
        caption: caption ?? null,
        content_hash: contentHash ?? null,
      })
      .select()
      .single()
  );
  if (error) throw error;
  return data;
}

export async function addImageToLesson({
  file,
  ownerUserId,
  lessonId,
  sortOrder,
  caption,
}) {
  const hash = await fileHash(file);
  const path = await uploadLessonImage({ file, ownerUserId, lessonId });
  return attachImageRow({
    lessonId,
    ownerUserId,
    imagePath: path,
    sortOrder,
    caption,
    contentHash: hash,
  });
}

export async function removeLessonImage(image) {
  const { error: dbErr } = await withTimeout(
    supabase.from('lesson_images').delete().eq('id', image.id)
  );
  if (dbErr) throw dbErr;
  await deleteStorageObject(image.image_path);
}

export async function deleteStorageObject(path) {
  if (!path) return;
  try {
    await withTimeout(
      supabase.storage.from(LESSON_BUCKET).remove([path]),
      15000
    );
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('Failed to delete lesson image', path, e);
  }
}

/**
 * Rotate an attached image 90° clockwise: download, rotate, re-upload
 * to a new path, swap the lesson_images row to the new path, then
 * best-effort delete the old object. Returns the updated row.
 */
export async function rotateLessonImage(image, ownerUserId) {
  if (!image) throw new Error('No image');
  const url = publicLessonImageUrl(image.image_path);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch image for rotation (${res.status}).`);
  }
  const originalBlob = await res.blob();
  const rotated = await rotateImageBlob90CW(originalBlob);
  const newPath = await uploadLessonImage({
    file: rotated,
    ownerUserId,
    lessonId: image.lesson_id,
    contentType: 'image/jpeg',
  });

  const { data, error } = await withTimeout(
    supabase
      .from('lesson_images')
      .update({ image_path: newPath })
      .eq('id', image.id)
      .select()
      .single()
  );
  if (error) throw error;

  // Best-effort cleanup of the old object.
  await deleteStorageObject(image.image_path);
  return data;
}

/**
 * Reorder: takes an array of image ids in the new order and writes the
 * sort_order column to match. Quietly ignores rows that don't belong
 * to the caller (RLS handles that).
 */
export async function reorderLessonImages(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return;
  // Batched updates in sequence — small N (<20 typical), no need to
  // optimize with a single SQL.
  for (let i = 0; i < ids.length; i++) {
    const { error } = await withTimeout(
      supabase
        .from('lesson_images')
        .update({ sort_order: i })
        .eq('id', ids[i])
    );
    if (error) throw error;
  }
}
