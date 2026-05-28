// "In queue for" panel that lives on LessonDetail.
//
// Reverse view of GroupQueue: shows which groups currently have THIS
// lesson queued, with a remove button per entry and a picker to add it
// to additional groups' queues.

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { listGroups } from '../lib/lessonGroups';
import {
  addToQueue,
  listQueuesForLesson,
  removeFromQueue,
} from '../lib/lessonQueue';

export default function LessonQueues({ lessonId }) {
  const { user } = useAuth();
  const [entries, setEntries] = useState([]);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pickedGroupId, setPickedGroupId] = useState('');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!lessonId) return;
    let alive = true;
    setLoading(true);
    Promise.all([
      listQueuesForLesson(lessonId).catch(() => []),
      listGroups({ includeArchived: false }).catch(() => []),
    ])
      .then(([q, g]) => {
        if (!alive) return;
        setEntries(q);
        setGroups(g);
        setLoading(false);
      })
      .catch((e) => {
        if (!alive) return;
        setError(e.message || 'Failed to load queue info');
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [lessonId]);

  const queuedGroupIds = useMemo(
    () => new Set(entries.map((e) => e.group?.id).filter(Boolean)),
    [entries]
  );
  const availableGroups = useMemo(
    () => groups.filter((g) => !queuedGroupIds.has(g.id)),
    [groups, queuedGroupIds]
  );

  const handleAdd = async (e) => {
    e?.preventDefault?.();
    if (!pickedGroupId || !user?.id) return;
    setAdding(true);
    setError(null);
    try {
      await addToQueue({
        lessonId,
        groupId: pickedGroupId,
        ownerUserId: user.id,
      });
      // Re-fetch to get the joined group row in the right shape.
      const fresh = await listQueuesForLesson(lessonId);
      setEntries(fresh);
      setPickedGroupId('');
    } catch (e) {
      setError(e.message || 'Add failed');
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (entry) => {
    if (
      !window.confirm(
        `Remove this lesson from "${entry.group?.name || 'this group'}" queue?`
      )
    )
      return;
    setError(null);
    try {
      await removeFromQueue(entry.id);
      setEntries((prev) => prev.filter((e) => e.id !== entry.id));
    } catch (e) {
      setError(e.message || 'Remove failed');
    }
  };

  return (
    <div className="card space-y-3">
      <h2 className="font-serif text-lg text-umc-900">
        In queue for ({entries.length})
      </h2>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-gray-500 italic">
          This lesson isn't queued for any group yet.
        </p>
      ) : (
        <ul className="divide-y text-sm">
          {entries.map((q) => (
            <li key={q.id} className="py-2 flex items-baseline gap-3">
              <div className="flex-1 min-w-0">
                {q.group ? (
                  <Link
                    to={`/groups/${q.group.id}`}
                    className="text-umc-900 hover:underline"
                  >
                    {q.group.name}
                    {q.group.is_active === false && (
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
              <button
                type="button"
                onClick={() => handleRemove(q)}
                className="text-xs text-red-600 hover:underline"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {availableGroups.length > 0 && (
        <form
          onSubmit={handleAdd}
          className="flex flex-wrap items-end gap-2 pt-2 border-t"
        >
          <div className="flex-1 min-w-[180px]">
            <label className="label" htmlFor={`lq-add-${lessonId}`}>
              Queue for another group
            </label>
            <select
              id={`lq-add-${lessonId}`}
              className="input"
              value={pickedGroupId}
              onChange={(e) => setPickedGroupId(e.target.value)}
            >
              <option value="">Pick a group…</option>
              {availableGroups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className="btn-secondary"
            disabled={!pickedGroupId || adding}
          >
            {adding ? 'Adding…' : '+ Add to queue'}
          </button>
        </form>
      )}
      {availableGroups.length === 0 && groups.length > 0 && entries.length > 0 && (
        <p className="text-xs text-gray-500 italic">
          This lesson is already in every active group's queue.
        </p>
      )}
      {groups.length === 0 && (
        <p className="text-xs text-gray-500">
          No active groups yet. Create one on the{' '}
          <Link to="/groups" className="text-umc-700 hover:underline">
            Groups page
          </Link>{' '}
          to start queuing lessons.
        </p>
      )}
    </div>
  );
}
