// Lightweight typeahead picker over pastoral_people.
//
// Renders a search input + dropdown of matches. Clicking a result
// fires onSelect(person). Used by GroupDetail to add members.
//
// Intentionally NO inline-create — the Pastoral Records app is the
// canonical place for that. If a person isn't found, the empty-state
// nudges the pastor over to PR.

import { useEffect, useRef, useState } from 'react';
import { formatPersonName, searchPeople } from '../lib/people';

export default function PersonPicker({
  onSelect,
  excludeIds = [],
  placeholder = 'Search for a person…',
}) {
  const [term, setTerm] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const containerRef = useRef(null);

  const excludeSet = new Set(excludeIds);

  // Debounced search.
  useEffect(() => {
    let alive = true;
    setLoading(true);
    const handle = setTimeout(async () => {
      try {
        const rows = await searchPeople({ search: term, limit: 25 });
        if (!alive) return;
        setResults(rows);
        setError(null);
      } catch (e) {
        if (!alive) return;
        setError(e.message || 'Search failed');
      } finally {
        if (alive) setLoading(false);
      }
    }, 200);
    return () => {
      alive = false;
      clearTimeout(handle);
    };
  }, [term]);

  // Close dropdown on outside click.
  useEffect(() => {
    const onDocClick = (e) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const filtered = results.filter((p) => !excludeSet.has(p.id));

  return (
    <div className="relative" ref={containerRef}>
      <input
        type="search"
        className="input"
        placeholder={placeholder}
        value={term}
        onChange={(e) => {
          setTerm(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
      />
      {open && (
        <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-md shadow-md max-h-72 overflow-y-auto">
          {error && (
            <p className="p-3 text-sm text-red-600">{error}</p>
          )}
          {loading && filtered.length === 0 && (
            <p className="p-3 text-sm text-gray-400">Searching…</p>
          )}
          {!loading && filtered.length === 0 && !error && (
            <p className="p-3 text-sm text-gray-500">
              No matches{term ? ` for "${term}"` : ''}. People are added in
              the Pastoral Records app.
            </p>
          )}
          {filtered.length > 0 && (
            <ul className="divide-y">
              {filtered.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onSelect?.(p);
                      setTerm('');
                      setOpen(false);
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-gray-50 text-sm"
                  >
                    {formatPersonName(p)}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
