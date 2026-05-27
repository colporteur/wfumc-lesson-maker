// Modal for picking resources to attach to the lesson.
//
// Two stacked sections:
//   1. Suggested — auto-computed by scripture overlap with the lesson's
//      scripture_reference (no search needed). Empty if the lesson has
//      no scripture set or no matching resources.
//   2. Search — free-text + type filter against the user's entire
//      resource library (populated by the Sermons app).
//
// Selections persist locally inside the modal until "Save" — we don't
// commit to the lesson row until then.

import { useEffect, useMemo, useState } from 'react';
import {
  RESOURCE_TYPES,
  searchResources,
  suggestResourcesByScripture,
} from '../lib/lessonResources';

export default function ResourcePicker({
  lessonScriptureRef,
  attachedIds,
  onClose,
  onSave,
}) {
  const [selectedIds, setSelectedIds] = useState(
    () => new Set(attachedIds || [])
  );
  const [suggested, setSuggested] = useState(null); // null = loading
  const [searchResults, setSearchResults] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Initial load: suggestions + an empty-search baseline list.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [sug, baseline] = await Promise.all([
          suggestResourcesByScripture(lessonScriptureRef).catch(() => []),
          searchResources({ limit: 30 }).catch(() => []),
        ]);
        if (!alive) return;
        setSuggested(sug);
        setSearchResults(baseline);
      } catch (e) {
        if (!alive) return;
        setError(e.message || 'Failed to load resources');
      }
    })();
    return () => {
      alive = false;
    };
  }, [lessonScriptureRef]);

  // Debounced search.
  useEffect(() => {
    let alive = true;
    setSearching(true);
    const handle = setTimeout(async () => {
      try {
        const rows = await searchResources({
          search: searchTerm,
          type: typeFilter,
          limit: 50,
        });
        if (!alive) return;
        setSearchResults(rows);
      } catch (e) {
        if (!alive) return;
        setError(e.message || 'Search failed');
      } finally {
        if (alive) setSearching(false);
      }
    }, 250);
    return () => {
      alive = false;
      clearTimeout(handle);
    };
  }, [searchTerm, typeFilter]);

  const toggle = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      // Preserve attach-order: keep originally attached ids first, then
      // append any new ones in the order they were picked. For a
      // simpler model: just dump the set in original-attached-then-new
      // ordering.
      const original = (attachedIds || []).filter((id) => selectedIds.has(id));
      const additions = [...selectedIds].filter(
        (id) => !original.includes(id)
      );
      const ids = [...original, ...additions];
      await onSave(ids);
    } catch (e) {
      setError(e.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const suggestedIds = useMemo(
    () => new Set((suggested || []).map((r) => r.id)),
    [suggested]
  );

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center overflow-y-auto p-4"
      onClick={onClose}
    >
      <div
        className="card max-w-3xl w-full my-8 max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-serif text-lg text-umc-900">Pick resources</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 text-xl"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2 mb-3">
            {error}
          </p>
        )}

        <div className="flex-1 overflow-y-auto space-y-5 pr-1">
          {/* Suggestions */}
          <section>
            <h3 className="text-xs font-medium text-gray-600 mb-2">
              Suggested by scripture overlap
              {lessonScriptureRef ? ` — ${lessonScriptureRef}` : ''}
            </h3>
            {suggested === null ? (
              <p className="text-sm text-gray-400">Loading…</p>
            ) : !lessonScriptureRef ? (
              <p className="text-sm text-gray-400 italic">
                Set the lesson's scripture reference to see suggestions.
              </p>
            ) : suggested.length === 0 ? (
              <p className="text-sm text-gray-400 italic">
                No resources match this scripture yet.
              </p>
            ) : (
              <ul className="space-y-2">
                {suggested.map((r) => (
                  <ResourceRow
                    key={r.id}
                    resource={r}
                    selected={selectedIds.has(r.id)}
                    onToggle={() => toggle(r.id)}
                    matchedLabel={r.matched_label}
                  />
                ))}
              </ul>
            )}
          </section>

          {/* Search */}
          <section>
            <h3 className="text-xs font-medium text-gray-600 mb-2">
              Search the library
            </h3>
            <div className="flex gap-2 mb-2">
              <input
                type="search"
                placeholder="Search resources..."
                className="input flex-1"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
              <select
                className="input w-auto"
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
              >
                <option value="">All types</option>
                {RESOURCE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            {searching ? (
              <p className="text-sm text-gray-400">Searching…</p>
            ) : searchResults.length === 0 ? (
              <p className="text-sm text-gray-400 italic">
                No resources match.
              </p>
            ) : (
              <ul className="space-y-2">
                {searchResults
                  // Hide ones already shown in suggestions section.
                  .filter((r) => !suggestedIds.has(r.id))
                  .map((r) => (
                    <ResourceRow
                      key={r.id}
                      resource={r}
                      selected={selectedIds.has(r.id)}
                      onToggle={() => toggle(r.id)}
                    />
                  ))}
              </ul>
            )}
          </section>
        </div>

        <div className="mt-4 flex items-center justify-between border-t pt-3">
          <p className="text-xs text-gray-500">
            {selectedIds.size} selected
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="btn-primary disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Attach'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ResourceRow({ resource, selected, onToggle, matchedLabel }) {
  const r = resource;
  return (
    <li
      className={`border rounded p-3 cursor-pointer transition ${
        selected
          ? 'border-umc-700 bg-umc-50'
          : 'border-gray-200 hover:bg-gray-50'
      }`}
      onClick={onToggle}
    >
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          onClick={(e) => e.stopPropagation()}
          className="mt-1"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-xs uppercase tracking-wide text-gray-500">
              {r.resource_type}
            </span>
            <span className="font-medium text-umc-900">
              {r.title || '(untitled)'}
            </span>
            {matchedLabel && (
              <span className="text-xs bg-umc-100 text-umc-900 rounded px-1.5 py-0.5">
                matches {matchedLabel}
              </span>
            )}
          </div>
          {r.source && (
            <p className="text-xs text-gray-500 mt-0.5">— {r.source}</p>
          )}
          <p className="text-sm text-gray-700 mt-1 line-clamp-3">
            {r.content}
          </p>
        </div>
      </div>
    </li>
  );
}
