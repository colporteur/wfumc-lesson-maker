// CRUD for lesson_groups and lesson_group_members.
//
// Group fields: name (required), meeting_day_time, location,
// description, is_active. Members are pastoral_people ids attached via
// the lesson_group_members join table.

import { supabase, withTimeout } from './supabase';

// --- groups ---------------------------------------------------------

/**
 * List groups owned by the current user. By default only active
 * groups; pass includeArchived=true to surface archived ones too.
 * Includes a member_count via a sub-select so the list can show
 * "5 members" without a second round-trip.
 */
export async function listGroups({ includeArchived = false } = {}) {
  let q = supabase
    .from('lesson_groups')
    .select('id, name, meeting_day_time, location, description, is_active, updated_at, lesson_group_members(count)')
    .order('is_active', { ascending: false })
    .order('name', { ascending: true });
  if (!includeArchived) {
    q = q.eq('is_active', true);
  }
  const { data, error } = await withTimeout(q);
  if (error) throw error;
  // Flatten the count.
  return (data ?? []).map((g) => ({
    ...g,
    member_count: g.lesson_group_members?.[0]?.count ?? 0,
  }));
}

export async function getGroup(id) {
  const { data, error } = await withTimeout(
    supabase
      .from('lesson_groups')
      .select('*')
      .eq('id', id)
      .maybeSingle()
  );
  if (error) throw error;
  return data;
}

export async function createGroup({ ownerUserId, draft }) {
  if (!ownerUserId) throw new Error('Missing owner');
  const row = sanitizeGroupDraft(draft);
  if (!row.name) throw new Error('Group needs a name.');
  const { data, error } = await withTimeout(
    supabase
      .from('lesson_groups')
      .insert({ ...row, owner_user_id: ownerUserId })
      .select()
      .single()
  );
  if (error) throw error;
  return data;
}

export async function updateGroup(id, draft) {
  const row = sanitizeGroupDraft(draft);
  const { data, error } = await withTimeout(
    supabase
      .from('lesson_groups')
      .update(row)
      .eq('id', id)
      .select()
      .single()
  );
  if (error) throw error;
  return data;
}

export async function deleteGroup(id) {
  // Cascades to members and uses via FK ON DELETE CASCADE.
  const { error } = await withTimeout(
    supabase.from('lesson_groups').delete().eq('id', id)
  );
  if (error) throw error;
}

export async function setGroupActive(id, isActive) {
  const { data, error } = await withTimeout(
    supabase
      .from('lesson_groups')
      .update({ is_active: !!isActive })
      .eq('id', id)
      .select()
      .single()
  );
  if (error) throw error;
  return data;
}

function sanitizeGroupDraft(draft) {
  const out = {};
  const stringFields = ['name', 'meeting_day_time', 'location', 'description'];
  for (const f of stringFields) {
    if (Object.prototype.hasOwnProperty.call(draft, f)) {
      const v = draft[f];
      // Required field stays as-is (let DB reject if empty); optional
      // fields coerce empty → null.
      if (f === 'name') {
        out[f] = v == null ? null : String(v).trim();
      } else {
        out[f] = v == null || v === '' ? null : v;
      }
    }
  }
  if (Object.prototype.hasOwnProperty.call(draft, 'is_active')) {
    out.is_active = !!draft.is_active;
  }
  return out;
}

// --- members --------------------------------------------------------

/**
 * List members of a group with their pastoral_people row joined.
 * Sorted by sort_order, then by the person's last_name/first_name as
 * a tie-break.
 */
export async function listGroupMembers(groupId) {
  const { data, error } = await withTimeout(
    supabase
      .from('lesson_group_members')
      .select(
        'id, sort_order, person:pastoral_people(id, first_name, last_name, preferred_name)'
      )
      .eq('group_id', groupId)
      .order('sort_order', { ascending: true })
  );
  if (error) throw error;
  return data ?? [];
}

/**
 * Add a person to a group. Idempotent: if the person is already in the
 * group, returns the existing row (the unique index would otherwise
 * raise).
 */
export async function addGroupMember({ groupId, ownerUserId, personId }) {
  if (!groupId || !personId || !ownerUserId) {
    throw new Error('Missing groupId / personId / ownerUserId');
  }
  // Pull existing members so we can compute the next sort_order and
  // detect duplicates without relying on the DB error.
  const existing = await listGroupMembers(groupId);
  const dupe = existing.find((m) => m.person?.id === personId);
  if (dupe) return dupe;

  const nextOrder = existing.length
    ? Math.max(...existing.map((m) => m.sort_order ?? 0)) + 1
    : 0;

  const { data, error } = await withTimeout(
    supabase
      .from('lesson_group_members')
      .insert({
        group_id: groupId,
        owner_user_id: ownerUserId,
        person_id: personId,
        sort_order: nextOrder,
      })
      .select(
        'id, sort_order, person:pastoral_people(id, first_name, last_name, preferred_name)'
      )
      .single()
  );
  if (error) throw error;
  return data;
}

export async function removeGroupMember(memberId) {
  const { error } = await withTimeout(
    supabase.from('lesson_group_members').delete().eq('id', memberId)
  );
  if (error) throw error;
}
