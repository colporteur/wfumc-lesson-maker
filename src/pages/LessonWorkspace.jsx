// Workspace-style chat-revise loop for a lesson.
//
// Layout (desktop): chat panel on the left, lesson body on the right.
//                  (stacks on mobile)
//
// Flow:
//   1. Pastor types an instruction in the chat box and submits.
//   2. We snapshot the current body (source='chat_turn') so it can be
//      reverted.
//   3. Claude is called with the voice guide + attached resources +
//      chat history; it returns a revised full body.
//   4. We write the revised body straight back to the lesson row and
//      append the assistant turn to the chat panel.
//   5. The body textarea is read-only by default (body_locked=true).
//      Unlock to make manual edits; unlocking auto-snapshots first.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { getLesson, updateLesson } from '../lib/lessons';
import {
  REVISION_SOURCES,
  listRevisions,
  revertToRevision,
  setBodyLocked,
  snapshotLesson,
} from '../lib/lessonRevisions';
import {
  formatResourcesContext,
  getResourcesByIds,
  setAttachedResourceIds,
} from '../lib/lessonResources';
import { reviseLessonBody } from '../lib/claude';
import { loadVoiceGuideForPrompt } from '../lib/voiceGuide';
import LoadingSpinner from '../components/LoadingSpinner.jsx';
import ResourcePicker from '../components/ResourcePicker.jsx';
import ScriptureSuggester from '../components/ScriptureSuggester.jsx';

export default function LessonWorkspace() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { id } = useParams();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lesson, setLesson] = useState(null);
  // The lesson body is mirrored into local state so the chat loop and
  // the textarea can both poke at it without round-tripping to the DB
  // on every keystroke. We write back on chat turns, on manual save,
  // and on lock toggle.
  const [body, setBody] = useState('');
  const [revisions, setRevisions] = useState([]);
  const [attachedResources, setAttachedResources] = useState([]);
  const [voicePrompt, setVoicePrompt] = useState('');

  // Chat state
  const [chat, setChat] = useState([]); // {role, content, revisionId?}
  const [instruction, setInstruction] = useState('');
  const [chatPending, setChatPending] = useState(false);

  // Modals
  const [pickerOpen, setPickerOpen] = useState(false);

  // Manual edit state
  const [unsavedManualEdits, setUnsavedManualEdits] = useState(false);
  const [savingManual, setSavingManual] = useState(false);

  const chatScrollRef = useRef(null);

  // --- initial load ----------------------------------------------------

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const row = await getLesson(id);
        if (!alive) return;
        if (!row) {
          setError('Lesson not found.');
          setLoading(false);
          return;
        }
        setLesson(row);
        setBody(row.body || '');

        // Side-loads — fire in parallel, but don't fail the page if any
        // single one errors (e.g. the user has no voice guide yet).
        const [revs, resources, voice] = await Promise.all([
          listRevisions(id).catch(() => []),
          row.attached_resource_ids?.length
            ? getResourcesByIds(row.attached_resource_ids).catch(() => [])
            : Promise.resolve([]),
          loadVoiceGuideForPrompt(user?.id).catch(() => ({ systemPrompt: '' })),
        ]);
        if (!alive) return;
        setRevisions(revs);
        setAttachedResources(resources);
        setVoicePrompt(voice?.systemPrompt || '');
        setLoading(false);
      } catch (e) {
        if (!alive) return;
        setError(e.message || 'Failed to load workspace');
        setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [id, user?.id]);

  // Auto-scroll chat panel on new turn.
  useEffect(() => {
    const el = chatScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [chat.length, chatPending]);

  // --- chat-revise -----------------------------------------------------

  const handleChatSubmit = async (e) => {
    e?.preventDefault?.();
    const text = instruction.trim();
    if (!text || chatPending || !lesson || !user?.id) return;

    setChatPending(true);
    setError(null);

    // 1. Snapshot the current body BEFORE we call Claude, so this turn
    //    can be reverted later.
    let snapshotId = null;
    try {
      const snap = await snapshotLesson({
        lessonId: lesson.id,
        ownerUserId: user.id,
        lesson: { ...lesson, body },
        source: REVISION_SOURCES.CHAT_TURN,
        label: text.length > 60 ? text.slice(0, 60) + '…' : text,
      });
      snapshotId = snap?.id ?? null;
      // Optimistically update the revisions panel.
      if (snap) setRevisions((prev) => [snap, ...prev]);
    } catch (snapErr) {
      // Don't abort the turn if snapshot fails — log + keep going.
      // eslint-disable-next-line no-console
      console.warn('Snapshot before chat turn failed:', snapErr);
    }

    // 2. Append the user turn to the chat now (visible while Claude
    //    is still thinking).
    setChat((prev) => [...prev, { role: 'user', content: text }]);
    setInstruction('');

    try {
      const resourcesContext = formatResourcesContext(attachedResources);
      // Build the prior-turn history for Claude — we send everything
      // EXCEPT the just-added user turn (it goes in as `instruction`).
      const history = chat.map(({ role, content }) => ({ role, content }));

      const revised = await reviseLessonBody({
        lesson,
        body,
        voiceSystemPrompt: voicePrompt,
        resourcesContext,
        history,
        instruction: text,
      });

      // 3. Persist the new body to the lesson row.
      const updated = await updateLesson(lesson.id, { body: revised });
      setLesson(updated);
      setBody(revised);
      setUnsavedManualEdits(false);

      // 4. Append assistant turn (with the revision id so Revert hooks
      //    up to the right snapshot).
      setChat((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: revised,
          revisionId: snapshotId,
        },
      ]);
    } catch (e) {
      setError(e.message || 'Claude revision failed');
      // Re-add the user's text so they don't lose it.
      setInstruction(text);
      // Roll back the user turn we appended optimistically.
      setChat((prev) => prev.slice(0, -1));
    } finally {
      setChatPending(false);
    }
  };

  // --- revert ----------------------------------------------------------

  const handleRevert = async (revisionId) => {
    if (!lesson || !user?.id) return;
    if (
      !window.confirm(
        'Revert the lesson to this earlier version? Your current body will be snapshot first so this revert can itself be undone.'
      )
    ) {
      return;
    }
    setError(null);
    try {
      const restored = await revertToRevision({
        lessonId: lesson.id,
        ownerUserId: user.id,
        revisionId,
        currentLesson: { ...lesson, body },
      });
      setLesson(restored);
      setBody(restored.body || '');
      setUnsavedManualEdits(false);
      // Refresh revisions to pick up the pre_revert snapshot.
      const revs = await listRevisions(lesson.id).catch(() => []);
      setRevisions(revs);
    } catch (e) {
      setError(e.message || 'Revert failed');
    }
  };

  // --- lock / unlock --------------------------------------------------

  const handleToggleLock = async () => {
    if (!lesson || !user?.id) return;
    setError(null);
    try {
      if (lesson.body_locked) {
        // Unlocking → snapshot current state first so manual edits are
        // recoverable.
        await snapshotLesson({
          lessonId: lesson.id,
          ownerUserId: user.id,
          lesson: { ...lesson, body },
          source: REVISION_SOURCES.MANUAL_UNLOCK,
          label: 'Before manual edit',
        });
        const updated = await setBodyLocked(lesson.id, false);
        setLesson((l) => ({ ...l, ...updated }));
      } else {
        // Locking → if there are unsaved manual edits, save them too.
        if (unsavedManualEdits) {
          const saved = await updateLesson(lesson.id, { body });
          setLesson((l) => ({ ...l, ...saved }));
          setUnsavedManualEdits(false);
        }
        const updated = await setBodyLocked(lesson.id, true);
        setLesson((l) => ({ ...l, ...updated }));
      }
      // Refresh revisions in case we just added one.
      const revs = await listRevisions(lesson.id).catch(() => []);
      setRevisions(revs);
    } catch (e) {
      setError(e.message || 'Lock toggle failed');
    }
  };

  // --- manual save (when unlocked) ------------------------------------

  const handleManualSave = async () => {
    if (!lesson || !user?.id) return;
    setSavingManual(true);
    setError(null);
    try {
      await snapshotLesson({
        lessonId: lesson.id,
        ownerUserId: user.id,
        lesson: { ...lesson, body },
        source: REVISION_SOURCES.MANUAL_SAVE,
        label: 'Manual save',
      });
      const saved = await updateLesson(lesson.id, { body });
      setLesson((l) => ({ ...l, ...saved }));
      setUnsavedManualEdits(false);
      const revs = await listRevisions(lesson.id).catch(() => []);
      setRevisions(revs);
    } catch (e) {
      setError(e.message || 'Save failed');
    } finally {
      setSavingManual(false);
    }
  };

  // --- attached resources ---------------------------------------------

  const handleResourcesChange = useCallback(
    async (ids) => {
      if (!lesson) return;
      try {
        await setAttachedResourceIds(lesson.id, ids);
        setLesson((l) => ({ ...l, attached_resource_ids: ids }));
        const rows = ids.length ? await getResourcesByIds(ids) : [];
        setAttachedResources(rows);
      } catch (e) {
        setError(e.message || 'Could not save attached resources');
      }
    },
    [lesson]
  );

  const handleRemoveResource = (resId) => {
    const next = (lesson?.attached_resource_ids || []).filter(
      (id) => id !== resId
    );
    handleResourcesChange(next);
  };

  // --- scripture insert ------------------------------------------------

  const handleInsertScripture = (text) => {
    // Append to the body with a leading blank line if there's existing
    // text; if the body is empty, just paste it.
    const sep = body.trim() ? '\n\n' : '';
    const newBody = body + sep + text;
    setBody(newBody);
    if (!lesson?.body_locked) {
      // Locked-state safety: if the body's unlocked we mark dirty so
      // the pastor remembers to save. If locked, the insert IS the
      // intended write — persist immediately and snapshot.
      setUnsavedManualEdits(true);
    } else {
      // Persist immediately for the locked case so the inserted
      // scripture doesn't get lost on a refresh.
      (async () => {
        if (!lesson || !user?.id) return;
        try {
          await snapshotLesson({
            lessonId: lesson.id,
            ownerUserId: user.id,
            lesson: { ...lesson, body },
            source: REVISION_SOURCES.MANUAL_SAVE,
            label: 'Before scripture insert',
          });
          const saved = await updateLesson(lesson.id, { body: newBody });
          setLesson((l) => ({ ...l, ...saved }));
          const revs = await listRevisions(lesson.id).catch(() => []);
          setRevisions(revs);
        } catch (e) {
          setError(e.message || 'Inserting scripture failed');
        }
      })();
    }
  };

  // --- derived --------------------------------------------------------

  const lockLabel = useMemo(() => {
    if (!lesson) return '';
    if (chatPending) return 'Locked (Claude is writing…)';
    return lesson.body_locked ? '🔒 Locked' : '✏️ Unlocked';
  }, [lesson, chatPending]);

  if (loading) return <LoadingSpinner label="Loading workspace..." />;
  if (error && !lesson) {
    return (
      <div className="card text-center text-red-600">{error}</div>
    );
  }
  if (!lesson) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <Link
            to={`/lessons/${lesson.id}`}
            className="text-xs text-gray-500 hover:text-gray-700"
          >
            ← {lesson.title || '(untitled)'}
          </Link>
          <h1 className="font-serif text-2xl text-umc-900 truncate">
            Workspace
          </h1>
          {lesson.scripture_reference && (
            <p className="text-xs text-gray-500 mt-0.5">
              {lesson.scripture_reference}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="btn-secondary text-xs"
          >
            + Resources ({attachedResources.length})
          </button>
          <button
            type="button"
            onClick={handleToggleLock}
            className="btn-secondary text-xs"
            disabled={chatPending}
            title={
              lesson.body_locked
                ? 'Unlock the body for manual editing'
                : 'Lock the body so only Claude can revise it through chat'
            }
          >
            {lockLabel}
          </button>
        </div>
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
          {error}
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Chat column */}
        <div className="card flex flex-col h-[70vh]">
          <div className="text-xs text-gray-500 mb-2">Chat with Claude</div>
          <div
            ref={chatScrollRef}
            className="flex-1 overflow-y-auto space-y-3 pr-1"
          >
            {chat.length === 0 && !chatPending && (
              <p className="text-sm text-gray-400">
                Tell Claude how to revise the lesson body. Examples:
                <br />
                <span className="italic">
                  "Add a discussion question after the second paragraph"
                </span>{' '}
                or{' '}
                <span className="italic">
                  "Tighten the intro to one paragraph"
                </span>
                .
              </p>
            )}
            {chat.map((turn, i) => (
              <ChatTurn
                key={i}
                turn={turn}
                onRevert={
                  turn.role === 'assistant' && turn.revisionId
                    ? () => handleRevert(turn.revisionId)
                    : null
                }
              />
            ))}
            {chatPending && (
              <div className="text-xs text-gray-500 italic">
                Claude is revising…
              </div>
            )}
          </div>

          <form onSubmit={handleChatSubmit} className="mt-3 space-y-2">
            <textarea
              className="input"
              rows={3}
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  handleChatSubmit(e);
                }
              }}
              placeholder="What should Claude change? (⌘/Ctrl+Enter to send)"
              disabled={chatPending}
            />
            <div className="flex items-center justify-between">
              <p className="text-[11px] text-gray-400">
                {voicePrompt ? 'Voice guide loaded' : 'No voice guide'}
                {' · '}
                {attachedResources.length} resource
                {attachedResources.length === 1 ? '' : 's'} attached
              </p>
              <button
                type="submit"
                className="btn-primary"
                disabled={chatPending || !instruction.trim()}
              >
                {chatPending ? 'Revising…' : 'Send'}
              </button>
            </div>
          </form>
        </div>

        {/* Body column */}
        <div className="card flex flex-col h-[70vh]">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs text-gray-500">Lesson body</div>
            {!lesson.body_locked && unsavedManualEdits && (
              <button
                type="button"
                onClick={handleManualSave}
                disabled={savingManual}
                className="text-xs btn-secondary"
              >
                {savingManual ? 'Saving…' : 'Save edits'}
              </button>
            )}
          </div>
          <textarea
            className="input flex-1 font-serif"
            value={body}
            readOnly={lesson.body_locked || chatPending}
            onChange={(e) => {
              setBody(e.target.value);
              setUnsavedManualEdits(true);
            }}
          />
        </div>
      </div>

      {/* Attached resources */}
      {attachedResources.length > 0 && (
        <div className="card">
          <h2 className="text-xs text-gray-500 mb-2">Attached resources</h2>
          <div className="flex flex-wrap gap-2">
            {attachedResources.map((r) => (
              <span
                key={r.id}
                className="inline-flex items-center gap-1 rounded-full bg-umc-50 text-umc-900 px-2.5 py-1 text-xs"
                title={r.content}
              >
                <span className="font-medium">
                  {r.title || `(${r.resource_type})`}
                </span>
                {r.scripture_refs && (
                  <span className="text-gray-500">· {r.scripture_refs}</span>
                )}
                <button
                  type="button"
                  onClick={() => handleRemoveResource(r.id)}
                  className="text-umc-900 hover:text-red-600"
                  aria-label={`Detach ${r.title || r.resource_type}`}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Scripture suggester */}
      <ScriptureSuggester
        lesson={lesson}
        body={body}
        onInsert={handleInsertScripture}
      />

      {/* Revisions list */}
      {revisions.length > 0 && (
        <div className="card">
          <h2 className="text-xs text-gray-500 mb-2">
            Snapshots ({revisions.length})
          </h2>
          <ul className="divide-y text-sm">
            {revisions.slice(0, 10).map((r) => (
              <li
                key={r.id}
                className="py-2 flex items-baseline gap-3"
              >
                <div className="flex-1 min-w-0">
                  <p className="truncate">
                    <span className="text-gray-500 text-xs mr-2">
                      [{r.source || 'snapshot'}]
                    </span>
                    {r.label || '(unlabeled)'}
                  </p>
                </div>
                <time className="text-xs text-gray-400 whitespace-nowrap">
                  {fmtDateTime(r.created_at)}
                </time>
                <button
                  type="button"
                  onClick={() => handleRevert(r.id)}
                  className="text-xs text-umc-700 hover:underline"
                >
                  Revert
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {pickerOpen && (
        <ResourcePicker
          lessonScriptureRef={lesson.scripture_reference || ''}
          attachedIds={lesson.attached_resource_ids || []}
          onClose={() => setPickerOpen(false)}
          onSave={async (ids) => {
            await handleResourcesChange(ids);
            setPickerOpen(false);
          }}
        />
      )}
    </div>
  );
}

function ChatTurn({ turn, onRevert }) {
  if (turn.role === 'user') {
    return (
      <div className="ml-6 bg-umc-50 rounded-lg px-3 py-2 text-sm whitespace-pre-wrap">
        {turn.content}
      </div>
    );
  }
  // Assistant turn — show a compact "revised body" header + revert
  // button. The full revised body lives in the right pane; no need
  // to repeat it in the chat.
  return (
    <div className="mr-6 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-gray-500">
          Claude revised the body
        </span>
        {onRevert && (
          <button
            type="button"
            onClick={onRevert}
            className="text-xs text-umc-700 hover:underline"
          >
            Revert this turn
          </button>
        )}
      </div>
    </div>
  );
}

function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
