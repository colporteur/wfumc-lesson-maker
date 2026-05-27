import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { listLessons } from '../lib/lessons';
import LoadingSpinner from '../components/LoadingSpinner.jsx';

export default function LessonList() {
  const [params, setParams] = useSearchParams();
  const search = params.get('q') || '';
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [draftSearch, setDraftSearch] = useState(search);

  useEffect(() => {
    let alive = true;
    setItems(null);
    listLessons({ search })
      .then((rows) => alive && setItems(rows))
      .catch((e) => alive && setError(e.message || 'Failed to load lessons'));
    return () => {
      alive = false;
    };
  }, [search]);

  // Sync local input box with URL on back/forward.
  useEffect(() => {
    setDraftSearch(search);
  }, [search]);

  const handleSubmit = (e) => {
    e.preventDefault();
    const next = new URLSearchParams(params);
    if (draftSearch.trim()) {
      next.set('q', draftSearch.trim());
    } else {
      next.delete('q');
    }
    setParams(next, { replace: true });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-serif text-2xl text-umc-900">All lessons</h1>
        <Link to="/lessons/new" className="btn-primary">
          + New lesson
        </Link>
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="search"
          placeholder="Search by title or scripture..."
          className="input flex-1"
          value={draftSearch}
          onChange={(e) => setDraftSearch(e.target.value)}
        />
        <button type="submit" className="btn-secondary">
          Search
        </button>
        {search && (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              const next = new URLSearchParams(params);
              next.delete('q');
              setParams(next, { replace: true });
            }}
          >
            Clear
          </button>
        )}
      </form>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
          {error}
        </p>
      )}

      {!items ? (
        <LoadingSpinner label="Loading lessons..." />
      ) : items.length === 0 ? (
        <div className="card text-center text-gray-500 text-sm">
          {search
            ? `No lessons match "${search}".`
            : 'No lessons yet. Create your first one above.'}
        </div>
      ) : (
        <div className="card p-0 overflow-hidden">
          <ul className="divide-y">
            {items.map((l) => (
              <li key={l.id}>
                <Link
                  to={`/lessons/${l.id}`}
                  className="block px-4 py-3 hover:bg-gray-50"
                >
                  <div className="flex items-baseline gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-umc-900 font-medium truncate">
                        {l.title || '(untitled)'}
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {l.scripture_reference || (
                          <span className="text-gray-400">No scripture</span>
                        )}
                        {Array.isArray(l.themes) && l.themes.length > 0 && (
                          <>
                            {' · '}
                            <span className="italic">
                              {l.themes.join(', ')}
                            </span>
                          </>
                        )}
                      </p>
                    </div>
                    <time className="text-xs text-gray-400 whitespace-nowrap">
                      {fmtDate(l.updated_at)}
                    </time>
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

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
