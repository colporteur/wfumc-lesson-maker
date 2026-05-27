import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { createGroup, listGroups } from '../lib/lessonGroups';
import LoadingSpinner from '../components/LoadingSpinner.jsx';

export default function GroupList() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [groups, setGroups] = useState(null);
  const [error, setError] = useState(null);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let alive = true;
    setGroups(null);
    listGroups({ includeArchived })
      .then((rows) => alive && setGroups(rows))
      .catch((e) => alive && setError(e.message || 'Failed to load groups'));
    return () => {
      alive = false;
    };
  }, [includeArchived]);

  const handleCreate = async (e) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name || !user?.id) return;
    setCreating(true);
    setError(null);
    try {
      const created = await createGroup({
        ownerUserId: user.id,
        draft: { name },
      });
      navigate(`/groups/${created.id}`);
    } catch (err) {
      setError(err.message || 'Could not create group');
      setCreating(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-serif text-2xl text-umc-900">Groups</h1>
        <label className="text-xs text-gray-500 inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(e) => setIncludeArchived(e.target.checked)}
          />
          Include archived
        </label>
      </div>

      <form onSubmit={handleCreate} className="card flex gap-2 items-end">
        <div className="flex-1">
          <label className="label" htmlFor="new-group-name">
            New group
          </label>
          <input
            id="new-group-name"
            className="input"
            placeholder="e.g. Tuesday morning Bible study"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
        </div>
        <button
          type="submit"
          className="btn-primary"
          disabled={creating || !newName.trim()}
        >
          {creating ? 'Creating…' : '+ Create'}
        </button>
      </form>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
          {error}
        </p>
      )}

      {!groups ? (
        <LoadingSpinner label="Loading groups..." />
      ) : groups.length === 0 ? (
        <div className="card text-center text-gray-500 text-sm">
          No groups yet. Create your first one above.
        </div>
      ) : (
        <div className="card p-0 overflow-hidden">
          <ul className="divide-y">
            {groups.map((g) => (
              <li key={g.id}>
                <Link
                  to={`/groups/${g.id}`}
                  className="block px-4 py-3 hover:bg-gray-50"
                >
                  <div className="flex items-baseline gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-umc-900 font-medium truncate">
                        {g.name}
                        {!g.is_active && (
                          <span className="ml-2 text-xs text-gray-500">
                            (archived)
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {g.meeting_day_time || (
                          <span className="text-gray-400">No schedule</span>
                        )}
                        {g.location && (
                          <>
                            {' · '}
                            <span>{g.location}</span>
                          </>
                        )}
                      </p>
                    </div>
                    <span className="text-xs text-gray-500 whitespace-nowrap">
                      {g.member_count} member
                      {g.member_count === 1 ? '' : 's'}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
