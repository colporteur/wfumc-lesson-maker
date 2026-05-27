// "Suggest scriptures" panel for the Lesson Workspace.
//
// Clicking "Suggest scriptures" calls Claude with the lesson's
// metadata + body and gets back 3-5 candidate passages with one-line
// rationales. Each row has an Insert button that fetches the NRSVUe
// text and hands it back to the Workspace, which decides where to
// paste it (currently appends to the body).

import { useState } from 'react';
import {
  lookupScriptureNRSVUe,
  suggestScriptures,
} from '../lib/claude';

export default function ScriptureSuggester({ lesson, body, onInsert }) {
  const [suggestions, setSuggestions] = useState([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const [insertingRef, setInsertingRef] = useState(null);

  const handleSuggest = async () => {
    setPending(true);
    setError(null);
    try {
      const rows = await suggestScriptures({ lesson, body });
      setSuggestions(rows);
    } catch (e) {
      setError(e.message || 'Failed to get suggestions');
    } finally {
      setPending(false);
    }
  };

  const handleInsert = async (ref) => {
    setInsertingRef(ref);
    setError(null);
    try {
      const text = await lookupScriptureNRSVUe(ref);
      onInsert?.(text);
    } catch (e) {
      setError(e.message || 'Lookup failed');
    } finally {
      setInsertingRef(null);
    }
  };

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-serif text-base text-umc-900">
          Scripture suggester
        </h2>
        <button
          type="button"
          onClick={handleSuggest}
          disabled={pending}
          className="btn-secondary text-xs disabled:opacity-50"
        >
          {pending
            ? 'Asking Claude…'
            : suggestions.length > 0
              ? '↻ Suggest again'
              : '✨ Suggest scriptures'}
        </button>
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2 mb-2">
          {error}
        </p>
      )}

      {suggestions.length === 0 && !pending && !error && (
        <p className="text-xs text-gray-500">
          Get 3-5 supporting passages that connect to this lesson's
          scripture and themes. Each comes with a one-line rationale and
          an Insert button that pastes the NRSVue text into the body.
        </p>
      )}

      {suggestions.length > 0 && (
        <ul className="divide-y text-sm">
          {suggestions.map((s, i) => (
            <li key={i} className="py-2 flex items-baseline gap-3">
              <div className="flex-1 min-w-0">
                <p className="font-medium text-umc-900">{s.ref}</p>
                {s.rationale && (
                  <p className="text-xs text-gray-600 mt-0.5">
                    {s.rationale}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => handleInsert(s.ref)}
                disabled={insertingRef === s.ref}
                className="text-xs btn-secondary"
              >
                {insertingRef === s.ref ? '…' : 'Insert NRSVue'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
