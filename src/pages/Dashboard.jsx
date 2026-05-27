import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getLessonStats } from '../lib/lessons';
import LoadingSpinner from '../components/LoadingSpinner.jsx';

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    getLessonStats()
      .then((s) => alive && setStats(s))
      .catch((e) => alive && setError(e.message || 'Failed to load stats'));
    return () => {
      alive = false;
    };
  }, []);

  if (!stats && !error) return <LoadingSpinner label="Loading dashboard..." />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-serif text-2xl text-umc-900">Lesson library</h1>
        <Link to="/lessons/new" className="btn-primary">
          + New lesson
        </Link>
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
          {error}
        </p>
      )}

      {stats && (
        <>
          <div className="card">
            <p className="text-sm text-gray-500">Total lessons</p>
            <p className="font-serif text-3xl text-umc-900 mt-1">
              {stats.total}
            </p>
          </div>

          <div className="card">
            <h2 className="font-serif text-lg text-umc-900 mb-3">
              Recently edited
            </h2>
            {stats.recent.length === 0 ? (
              <p className="text-sm text-gray-500">
                No lessons yet —{' '}
                <Link
                  to="/lessons/new"
                  className="text-umc-700 hover:underline"
                >
                  create your first one
                </Link>
                .
              </p>
            ) : (
              <ul className="divide-y">
                {stats.recent.map((l) => (
                  <li key={l.id} className="py-3 flex items-baseline gap-3">
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
                    <time className="text-xs text-gray-400 whitespace-nowrap">
                      {fmtDate(l.updated_at)}
                    </time>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
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
