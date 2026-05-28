// Paste-textarea importer for plain-text lesson lists.
//
// Workflow:
//   1. Pastor pastes a list (one title per line, optional " — scripture"
//      or " | scripture" tail).
//   2. We parse defensively, surface the proposed rows in a table with
//      checkboxes (skipped rows shown but un-checked + dimmed).
//   3. Commit creates lessons one-by-one with title + scripture only.

import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { createLesson } from '../lib/lessons';
import { parseLessonList } from '../lib/parseLessonList';

export default function Import() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState(null);
  // Map from lineNo → selected boolean. Defaults to true for kept rows,
  // false for skipped rows.
  const [selected, setSelected] = useState({});
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [summary, setSummary] = useState(null);

  const handleParse = () => {
    const result = parseLessonList(text);
    setParsed(result);
    const initialSelected = {};
    for (const r of result.rows) {
      initialSelected[r.lineNo] = !r.skipped;
    }
    setSelected(initialSelected);
    setError(null);
    setSummary(null);
  };

  const toggleAll = (value) => {
    if (!parsed) return;
    const next = {};
    for (const r of parsed.rows) {
      // Don't auto-enable skipped rows when "check all" is hit — they
      // were skipped for a reason. Only the kept rows flip.
      next[r.lineNo] = value && !r.skipped;
    }
    setSelected(next);
  };

  const handleCommit = async () => {
    if (!parsed || !user?.id) return;
    const toCreate = parsed.rows.filter((r) => selected[r.lineNo]);
    if (toCreate.length === 0) {
      setError('Nothing selected.');
      return;
    }
    setCommitting(true);
    setError(null);
    setProgress({ done: 0, total: toCreate.length });
    let createdCount = 0;
    const failures = [];
    for (let i = 0; i < toCreate.length; i++) {
      const row = toCreate[i];
      try {
        await createLesson({
          ownerUserId: user.id,
          draft: {
            title: row.title,
            scripture_reference: row.scripture_reference || '',
            body: '',
            themes: [],
            class_notes: '',
          },
        });
        createdCount++;
      } catch (e) {
        failures.push({ row, message: e?.message || String(e) });
      }
      setProgress({ done: i + 1, total: toCreate.length });
    }
    setCommitting(false);
    setSummary({ createdCount, failures });
  };

  const counts = useMemo(() => {
    if (!parsed) return null;
    const selectedCount = parsed.rows.filter((r) => selected[r.lineNo]).length;
    return {
      total: parsed.rows.length,
      kept: parsed.kept,
      skipped: parsed.skippedCount,
      selected: selectedCount,
    };
  }, [parsed, selected]);

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/"
          className="text-xs text-gray-500 hover:text-gray-700"
        >
          ← Dashboard
        </Link>
        <h1 className="font-serif text-2xl text-umc-900">
          Import lesson titles
        </h1>
        <p className="text-sm text-gray-600 mt-1">
          Paste a list of lesson titles — one per line. Optional scripture
          can follow with " — ", " – ", or " | " (e.g.{' '}
          <code className="text-xs bg-gray-100 px-1 rounded">
            The Prodigal Son — Luke 15:11-32
          </code>
          ). Bullet markers like <code>1.</code>, <code>-</code>, or <code>•</code>{' '}
          are stripped automatically. This creates lessons with title and
          scripture only — you can fill in body and class notes later, or
          import the full content in Phase F.
        </p>
      </div>

      <div className="card space-y-3">
        <textarea
          className="input font-serif"
          rows={12}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={`The Prodigal Son — Luke 15:11-32
The Good Samaritan — Luke 10:25-37
Sermon on the Mount — Matthew 5-7
...`}
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleParse}
            className="btn-secondary"
            disabled={!text.trim()}
          >
            Parse
          </button>
          {parsed && (
            <span className="text-xs text-gray-500">
              {counts.kept} keepable · {counts.skipped} skipped ·{' '}
              {counts.selected} selected for import
            </span>
          )}
        </div>
      </div>

      {parsed && (
        <div className="card space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-serif text-lg text-umc-900">Preview</h2>
            <div className="flex gap-2 text-xs">
              <button
                type="button"
                onClick={() => toggleAll(true)}
                className="text-umc-700 hover:underline"
              >
                Check all
              </button>
              <span className="text-gray-400">·</span>
              <button
                type="button"
                onClick={() => toggleAll(false)}
                className="text-umc-700 hover:underline"
              >
                Uncheck all
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-gray-500">
                <tr>
                  <th className="py-1 pr-2 w-8"></th>
                  <th className="py-1 pr-2 w-10">Line</th>
                  <th className="py-1 pr-2">Title</th>
                  <th className="py-1 pr-2">Scripture</th>
                  <th className="py-1 pr-2 w-32">Note</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {parsed.rows.map((r) => (
                  <tr
                    key={r.lineNo}
                    className={r.skipped ? 'text-gray-400' : ''}
                  >
                    <td className="py-1 pr-2">
                      <input
                        type="checkbox"
                        checked={!!selected[r.lineNo]}
                        onChange={(e) =>
                          setSelected((prev) => ({
                            ...prev,
                            [r.lineNo]: e.target.checked,
                          }))
                        }
                      />
                    </td>
                    <td className="py-1 pr-2 text-xs text-gray-400">
                      {r.lineNo}
                    </td>
                    <td className="py-1 pr-2 truncate max-w-md">
                      {r.title || (
                        <span className="italic">(no title)</span>
                      )}
                    </td>
                    <td className="py-1 pr-2 text-xs text-gray-600 truncate max-w-xs">
                      {r.scripture_reference || (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="py-1 pr-2 text-xs italic">
                      {r.reason || ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex items-center justify-between border-t pt-3">
            <p className="text-xs text-gray-500">
              {committing
                ? `Importing ${progress.done} of ${progress.total}…`
                : counts.selected > 0
                  ? `Ready to import ${counts.selected} lesson${counts.selected === 1 ? '' : 's'}.`
                  : 'Select rows to import.'}
            </p>
            <button
              type="button"
              onClick={handleCommit}
              disabled={committing || counts.selected === 0}
              className="btn-primary disabled:opacity-50"
            >
              {committing
                ? `Importing… ${progress.done}/${progress.total}`
                : `Import ${counts.selected} lesson${counts.selected === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      )}

      {summary && (
        <div className="card space-y-2">
          <h2 className="font-serif text-lg text-umc-900">Done</h2>
          <p className="text-sm text-gray-700">
            Created <strong>{summary.createdCount}</strong> lesson
            {summary.createdCount === 1 ? '' : 's'}.
          </p>
          {summary.failures.length > 0 && (
            <>
              <p className="text-sm text-red-700">
                {summary.failures.length} failed:
              </p>
              <ul className="text-xs text-red-700 list-disc list-inside">
                {summary.failures.slice(0, 20).map((f, i) => (
                  <li key={i}>
                    Line {f.row.lineNo} — {f.row.title}: {f.message}
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="pt-2">
            <button
              type="button"
              onClick={() => navigate('/lessons')}
              className="btn-secondary"
            >
              Go to All lessons
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
