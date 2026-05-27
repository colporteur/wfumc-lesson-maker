// "Used by" panel that lives on LessonDetail.
//
// Shows the rotation history for this lesson (which groups used it
// when), and an inline form to record a new use.

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listGroups } from '../lib/lessonGroups';
import { listUsesForLesson, recordUse, removeUse } from '../lib/lessonUses';

function todayIso() {
  // Local-date YYYY-MM-DD (not UTC). Avoids off-by-one timezone surprises
  // when the pastor records a use late at night.
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

export default function LessonUses({ lessonId, ownerUserId }) {
  const [uses, setUses] = useState([]);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Inline-form state
  const [pickedGroupId, setPickedGroupId] = useState('');
  const [usedOn, setUsedOn] = useState(todayIso());
  const [recording, setRecording] = useState(false);

  useEffect(() => {
    if (!lessonId) return;
    let alive = true;
    setLoading(true);
    Promise.all([
      listUsesForLesson(lessonId).catch(() => []),
      listGroups({ includeArchived: false }).catch(() => []),
    ])
      .then(([u, g]) => {
        if (!alive) return;
        setUses(u);
        setGroups(g);
        // Pre-pick the first group if there's only one (common when
        // the pastor just has one Bible study).
        if (g.length === 1) setPickedGroupId(g[0].id);
        setLoading(false);
      })
      .catch((e) => {
        if (!alive) return;
        setError(e.message || 'Failed to load uses');
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [lessonId]);

  const handleRecord = async (e) => {
    e?.preventDefault?.();
    if (!pickedGroupId || !usedOn || !ownerUserId) return;
    setRecording(true);
    setError(null);
    try {
      const created = await recordUse({
        lessonId,
        groupId: pickedGroupId,
        ownerUserId,
        usedOn,
      });
      // recordUse joins the group row but not into the same shape as
      // listUsesForLesson (which also pulls is_active). Patch the
      // shape so the list-row renderer is happy.
      const groupLookup = groups.find((g) => g.id === pickedGroupId);
      setUses((prev) => [
        {
          id: created.id,
          used_on: created.used_on,
          group: {
            id: pickedGroupId,
            name: groupLookup?.name || created.group?.name || '',
            is_active: groupLookup?.is_active ?? true,
          },
        },
        ...prev,
      ]);
      setUsedOn(todayIso());
    } catch (e) {
      setError(e.message || 'Record failed');
    } finally {
      setRecording(false);
    }
  };

  const handleRemove = async (use) => {
    if (!window.confirm('Remove this use? (The lesson and group stay; only the use record is deleted.)')) {
      return;
    }
    setError(null);
    try {
      await removeUse(use.id);
      setUses((prev) => prev.filter((u) => u.id !== use.id));
    } catch (e) {
      setError(e.message || 'Remove failed');
    }
  };

  return (
    <div className="card space-y-3">
      <h2 className="font-serif text-lg text-umc-900">
        Used by ({uses.length})
      </h2>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
          {error}
        </p>
      )}

      {groups.length === 0 && !loading ? (
        <p className="text-sm text-gray-500">
          No active groups yet. Create one on the{' '}
          <Link to="/groups" className="text-umc-700 hover:underline">
            Groups page
          </Link>{' '}
          to start recording uses.
        </p>
      ) : (
        <form
          onSubmit={handleRecord}
          className="flex flex-wrap items-end gap-2"
        >
          <div className="flex-1 min-w-[180px]">
            <label className="label" htmlFor="use-group">
              Group
            </label>
            <select
              id="use-group"
              className="input"
              value={pickedGroupId}
              onChange={(e) => setPickedGroupId(e.target.value)}
            >
              <option value="">Pick a group…</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="use-date">
              Date used
            </label>
            <input
              id="use-date"
              type="date"
              className="input"
              value={usedOn}
              onChange={(e) => setUsedOn(e.target.value)}
            />
          </div>
          <button
            type="submit"
            className="btn-secondary"
            disabled={!pickedGroupId || !usedOn || recording}
          >
            {recording ? 'Recording…' : '+ Record use'}
          </button>
        </form>
      )}

      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : uses.length === 0 ? (
        <p className="text-sm text-gray-500 italic">
          This lesson hasn't been used yet.
        </p>
      ) : (
        <ul className="divide-y text-sm">
          {uses.map((u) => (
            <li key={u.id} className="py-2 flex items-baseline gap-3">
              <div className="flex-1 min-w-0">
                {u.group ? (
                  <Link
                    to={`/groups/${u.group.id}`}
                    className="text-umc-900 hover:underline"
                  >
                    {u.group.name}
                    {u.group.is_active === false && (
                      <span className="ml-2 text-xs text-gray-500">
                        (archived)
                      </span>
                    )}
                  </Link>
                ) : (
                  <span className="text-gray-400 italic">
                    (group deleted)
                  </span>
                )}
              </div>
              <time className="text-xs text-gray-400 whitespace-nowrap">
                {fmtDate(u.used_on)}
              </time>
              <button
                type="button"
                onClick={() => handleRemove(u)}
                className="text-xs text-red-600 hover:underline"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
