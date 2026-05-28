// Per-group queue panel that lives on GroupDetail.
//
// Top entry shows a prominent "Start from queue" button that navigates
// to the lesson with queueGroupId + queueDate query params so the
// lesson's Record Use form pre-fills. The rest of the queue has up/
// down reorder + remove buttons.
//
// Add-lesson picker at the bottom: dropdown of all the pastor's
// lessons NOT already queued for this group.

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { listLessons } from '../lib/lessons';
import {
  addToQueue,
  listQueueForGroup,
  moveInQueue,
  removeFromQueue,
} from '../lib/lessonQueue';

function todayIso() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

export default function GroupQueue({ groupId }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [queue, setQueue] = useState([]);
  const [allLessons, setAllLessons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pickedLessonId, setPickedLessonId] = useState('');
  const [adding, setAdding] = useState(false);
  const [movingId, setMovingId] = useState(null);

  useEffect(() => {
    if (!groupId) return;
    let alive = true;
    setLoading(true);
    Promise.all([
      listQueueForGroup(groupId).catch(() => []),
      listLessons({ limit: 500 }).catch(() => []),
    ])
      .then(([q, l]) => {
        if (!alive) return;
        setQueue(q);
        setAllLessons(l);
        setLoading(false);
      })
      .catch((e) => {
        if (!alive) return;
        setError(e.message || 'Failed to load queue');
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [groupId]);

  const queuedIds = useMemo(
    () => new Set(queue.map((q) => q.lesson?.id).filter(Boolean)),
    [queue]
  );
  const availableLessons = useMemo(
    () => allLessons.filter((l) => !queuedIds.has(l.id)),
    [allLessons, queuedIds]
  );

  const handleAdd = async (e) => {
    e?.preventDefault?.();
    if (!pickedLessonId || !user?.id) return;
    setAdding(true);
    setError(null);
    try {
      const newEntry = await addToQueue({
        lessonId: pickedLessonId,
        groupId,
        ownerUserId: user.id,
      });
      // Refresh from server so the join row + new sort_order are right.
      const fresh = await listQueueForGroup(groupId);
      setQueue(fresh);
      setPickedLessonId('');
      // Silence the unused-var warning while keeping the variable for
      // future debug hooks.
      void newEntry;
    } catch (e) {
      setError(e.message || 'Add failed');
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (entry) => {
    if (
      !window.confirm(
        `Remove "${entry.lesson?.title || '(untitled)'}" from this group's queue?`
      )
    )
      return;
    setError(null);
    try {
      await removeFromQueue(entry.id);
      setQueue((prev) => prev.filter((q) => q.id !== entry.id));
    } catch (e) {
      setError(e.message || 'Remove failed');
    }
  };

  const handleMove = async (entryId, direction) => {
    setMovingId(entryId);
    setError(null);
    try {
      const fresh = await moveInQueue(groupId, entryId, direction);
      setQueue(fresh);
    } catch (e) {
      setError(e.message || 'Reorder failed');
    } finally {
      setMovingId(null);
    }
  };

  const handleStartFromQueue = () => {
    const top = queue[0];
    if (!top?.lesson?.id) return;
    // Pre-fill Record Use via query params; LessonUses reads them on mount.
    const params = new URLSearchParams({
      queueGroupId: groupId,
      queueDate: todayIso(),
    });
    navigate(`/lessons/${top.lesson.id}?${params.toString()}`);
  };

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-serif text-lg text-umc-900">
          Queue ({queue.length})
        </h2>
        {queue.length > 0 && (
          <button
            type="button"
            onClick={handleStartFromQueue}
            className="btn-primary text-sm"
            title={`Open "${queue[0].lesson?.title || ''}" with today's date pre-filled`}
          >
            ▶ Start from queue
          </button>
        )}
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : queue.length === 0 ? (
        <p className="text-sm text-gray-500 italic">
          No lessons queued for this group yet. Pick one below.
        </p>
      ) : (
        <ol className="divide-y text-sm">
          {queue.map((q, idx) => (
            <li key={q.id} className="py-2 flex items-baseline gap-3">
              <span className="text-xs text-gray-400 w-6 text-right">
                {idx + 1}.
              </span>
              <div className="flex-1 min-w-0">
                {q.lesson ? (
                  <Link
                    to={`/lessons/${q.lesson.id}`}
                    className="text-umc-900 hover:underline"
                  >
                    {q.lesson.title || '(untitled)'}
                  </Link>
                ) : (
                  <span className="text-gray-400 italic">
                    (lesson deleted)
                  </span>
                )}
                {q.lesson?.scripture_reference && (
                  <span className="text-xs text-gray-500 ml-2">
                    {q.lesson.scripture_reference}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => handleMove(q.id, 'up')}
                disabled={idx === 0 || movingId === q.id}
                className="text-xs text-gray-500 hover:text-gray-800 disabled:opacity-30 px-1"
                title="Move up"
              >
                ▲
              </button>
              <button
                type="button"
                onClick={() => handleMove(q.id, 'down')}
                disabled={idx === queue.length - 1 || movingId === q.id}
                className="text-xs text-gray-500 hover:text-gray-800 disabled:opacity-30 px-1"
                title="Move down"
              >
                ▼
              </button>
              <button
                type="button"
                onClick={() => handleRemove(q)}
                className="text-xs text-red-600 hover:underline"
              >
                Remove
              </button>
            </li>
          ))}
        </ol>
      )}

      <form
        onSubmit={handleAdd}
        className="flex flex-wrap items-end gap-2 pt-2 border-t"
      >
        <div className="flex-1 min-w-[180px]">
          <label className="label" htmlFor={`q-add-${groupId}`}>
            Add a lesson
          </label>
          <select
            id={`q-add-${groupId}`}
            className="input"
            value={pickedLessonId}
            onChange={(e) => setPickedLessonId(e.target.value)}
          >
            <option value="">Pick a lesson…</option>
            {availableLessons.map((l) => (
              <option key={l.id} value={l.id}>
                {l.title || '(untitled)'}
                {l.scripture_reference ? ` — ${l.scripture_reference}` : ''}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          className="btn-secondary"
          disabled={!pickedLessonId || adding}
        >
          {adding ? 'Adding…' : '+ Add to queue'}
        </button>
      </form>
      {availableLessons.length === 0 && allLessons.length > 0 && !loading && (
        <p className="text-xs text-gray-500 italic">
          All your lessons are already queued for this group.
        </p>
      )}
    </div>
  );
}
