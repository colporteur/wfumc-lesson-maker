import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import {
  addGroupMember,
  deleteGroup,
  getGroup,
  listGroupMembers,
  removeGroupMember,
  updateGroup,
} from '../lib/lessonGroups';
import {
  lessonsNotYetUsedByGroup,
  listUsesForGroup,
} from '../lib/lessonUses';
import { formatPersonName } from '../lib/people';
import LoadingSpinner from '../components/LoadingSpinner.jsx';
import PersonPicker from '../components/PersonPicker.jsx';

const EMPTY_DRAFT = {
  name: '',
  meeting_day_time: '',
  location: '',
  description: '',
  is_active: true,
};

export default function GroupDetail() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { id } = useParams();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [group, setGroup] = useState(null);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [members, setMembers] = useState([]);
  const [uses, setUses] = useState([]);
  const [unused, setUnused] = useState([]);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [addingMember, setAddingMember] = useState(false);

  // Initial load.
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const row = await getGroup(id);
        if (!alive) return;
        if (!row) {
          setError('Group not found.');
          setLoading(false);
          return;
        }
        setGroup(row);
        setDraft({
          name: row.name || '',
          meeting_day_time: row.meeting_day_time || '',
          location: row.location || '',
          description: row.description || '',
          is_active: !!row.is_active,
        });
        const [m, u, nu] = await Promise.all([
          listGroupMembers(id).catch(() => []),
          listUsesForGroup(id).catch(() => []),
          lessonsNotYetUsedByGroup(id).catch(() => []),
        ]);
        if (!alive) return;
        setMembers(m);
        setUses(u);
        setUnused(nu);
        setLoading(false);
      } catch (e) {
        if (!alive) return;
        setError(e.message || 'Failed to load group');
        setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  const update = (field, value) =>
    setDraft((d) => ({ ...d, [field]: value }));

  const handleSave = async () => {
    if (!draft.name.trim()) {
      setError('Group needs a name.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await updateGroup(id, draft);
      setGroup(updated);
      setSavedAt(new Date());
    } catch (e) {
      setError(e.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!group) return;
    if (
      !window.confirm(
        `Delete "${group.name}"? This also removes its members and lesson-use history. This cannot be undone.`
      )
    ) {
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      await deleteGroup(id);
      navigate('/groups', { replace: true });
    } catch (e) {
      setError(e.message || 'Delete failed');
      setDeleting(false);
    }
  };

  const handleAddMember = async (person) => {
    if (!person?.id || !user?.id) return;
    setAddingMember(true);
    setError(null);
    try {
      const newMember = await addGroupMember({
        groupId: id,
        ownerUserId: user.id,
        personId: person.id,
      });
      setMembers((prev) => {
        // Deduplicate just in case addGroupMember returned an existing row.
        if (prev.find((m) => m.id === newMember.id)) return prev;
        return [...prev, newMember];
      });
    } catch (e) {
      setError(e.message || 'Could not add member');
    } finally {
      setAddingMember(false);
    }
  };

  const handleRemoveMember = async (member) => {
    if (!window.confirm(`Remove ${formatPersonName(member.person)} from the group?`)) {
      return;
    }
    setError(null);
    try {
      await removeGroupMember(member.id);
      setMembers((prev) => prev.filter((m) => m.id !== member.id));
    } catch (e) {
      setError(e.message || 'Remove failed');
    }
  };

  const memberIds = useMemo(
    () => members.map((m) => m.person?.id).filter(Boolean),
    [members]
  );

  if (loading) return <LoadingSpinner label="Loading group..." />;
  if (!group) {
    return (
      <div className="card text-center text-red-600">
        {error || 'Group not found.'}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <Link
            to="/groups"
            className="text-xs text-gray-500 hover:text-gray-700"
          >
            ← All groups
          </Link>
          <h1 className="font-serif text-2xl text-umc-900 truncate">
            {draft.name?.trim() || group.name}
          </h1>
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="btn-primary disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
          {error}
        </p>
      )}
      {savedAt && !error && (
        <p className="text-xs text-gray-500">
          Saved {savedAt.toLocaleTimeString()}
        </p>
      )}

      {/* Group info */}
      <div className="card space-y-4">
        <div>
          <label className="label" htmlFor="g-name">
            Name
          </label>
          <input
            id="g-name"
            className="input"
            value={draft.name}
            onChange={(e) => update('name', e.target.value)}
          />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="label" htmlFor="g-day">
              Meeting day / time
            </label>
            <input
              id="g-day"
              className="input"
              placeholder="e.g. Tuesdays 10:00 AM"
              value={draft.meeting_day_time}
              onChange={(e) => update('meeting_day_time', e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="g-loc">
              Location
            </label>
            <input
              id="g-loc"
              className="input"
              placeholder="e.g. Fellowship Hall"
              value={draft.location}
              onChange={(e) => update('location', e.target.value)}
            />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="g-desc">
            Description / notes
          </label>
          <textarea
            id="g-desc"
            className="input"
            rows={3}
            value={draft.description}
            onChange={(e) => update('description', e.target.value)}
          />
        </div>
        <label className="inline-flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={draft.is_active}
            onChange={(e) => update('is_active', e.target.checked)}
          />
          Active (uncheck to archive)
        </label>
      </div>

      {/* Members */}
      <div className="card space-y-3">
        <h2 className="font-serif text-lg text-umc-900">
          Members ({members.length})
        </h2>
        <p className="text-xs text-gray-500">
          People come from your Pastoral Records app. If you can't find
          someone here, add them there first.
        </p>
        <PersonPicker
          onSelect={handleAddMember}
          excludeIds={memberIds}
          placeholder={
            addingMember ? 'Adding…' : 'Search for a person to add…'
          }
        />
        {members.length === 0 ? (
          <p className="text-sm text-gray-500 italic">
            No members yet.
          </p>
        ) : (
          <ul className="divide-y">
            {members.map((m) => (
              <li
                key={m.id}
                className="py-2 flex items-baseline gap-3"
              >
                <span className="flex-1 min-w-0 truncate">
                  {formatPersonName(m.person)}
                </span>
                <button
                  type="button"
                  onClick={() => handleRemoveMember(m)}
                  className="text-xs text-red-600 hover:underline"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Recent uses */}
      <div className="card space-y-3">
        <h2 className="font-serif text-lg text-umc-900">
          Recent lessons used ({uses.length})
        </h2>
        {uses.length === 0 ? (
          <p className="text-sm text-gray-500">
            This group hasn't used any lessons yet. Record a use from
            the lesson page.
          </p>
        ) : (
          <ul className="divide-y text-sm">
            {uses.map((u) => (
              <li key={u.id} className="py-2 flex items-baseline gap-3">
                <div className="flex-1 min-w-0">
                  {u.lesson ? (
                    <Link
                      to={`/lessons/${u.lesson.id}`}
                      className="text-umc-900 hover:underline"
                    >
                      {u.lesson.title || '(untitled)'}
                    </Link>
                  ) : (
                    <span className="text-gray-400 italic">
                      (lesson deleted)
                    </span>
                  )}
                  {u.lesson?.scripture_reference && (
                    <span className="text-xs text-gray-500 ml-2">
                      {u.lesson.scripture_reference}
                    </span>
                  )}
                </div>
                <time className="text-xs text-gray-400 whitespace-nowrap">
                  {fmtDate(u.used_on)}
                </time>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Not yet used */}
      <div className="card space-y-3">
        <h2 className="font-serif text-lg text-umc-900">
          Lessons not yet used ({unused.length})
        </h2>
        {unused.length === 0 ? (
          <p className="text-sm text-gray-500">
            Every lesson in your library has been used by this group at
            least once.
          </p>
        ) : (
          <ul className="divide-y text-sm">
            {unused.slice(0, 50).map((l) => (
              <li
                key={l.id}
                className="py-2 flex items-baseline gap-3"
              >
                <div className="flex-1 min-w-0">
                  <Link
                    to={`/lessons/${l.id}`}
                    className="text-umc-900 hover:underline"
                  >
                    {l.title || '(untitled)'}
                  </Link>
                  {l.scripture_reference && (
                    <span className="text-xs text-gray-500 ml-2">
                      {l.scripture_reference}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Danger zone */}
      <div className="card border-red-200">
        <h2 className="font-serif text-sm text-red-700 mb-2">
          Danger zone
        </h2>
        <p className="text-xs text-gray-500 mb-3">
          Deleting this group also removes its membership and lesson-use
          history. Lessons themselves are not deleted. This cannot be
          undone.
        </p>
        <button
          type="button"
          onClick={handleDelete}
          disabled={deleting}
          className="text-sm text-red-700 hover:text-red-900 underline disabled:opacity-50"
        >
          {deleting ? 'Deleting…' : 'Delete this group'}
        </button>
      </div>
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
