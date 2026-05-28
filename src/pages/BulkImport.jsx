// Bulk import of .docx lesson files.
//
// Two-stage flow:
//   1. Pick files → parse each (mammoth: text + embedded images) →
//      show a preview table with editable titles and per-row checkbox.
//      Duplicate-by-title warnings come from a single up-front fetch
//      of every existing lesson title.
//   2. Commit selected → create lesson rows + upload each file's
//      images via addImageToLesson, with a progress counter and a
//      per-file failure list.

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { createLesson, listLessons } from '../lib/lessons';
import { addImageToLesson } from '../lib/lessonImages';
import { parseDocxLesson } from '../lib/parseDocxLesson';

export default function BulkImport() {
  const { user } = useAuth();
  const navigate = useNavigate();

  // existingTitles: lowercased set so duplicate-by-title warnings work.
  const [existingTitles, setExistingTitles] = useState(null);
  const [files, setFiles] = useState([]); // parsed file objects
  const [parsing, setParsing] = useState(false);
  const [parseProgress, setParseProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState(null);
  const [committing, setCommitting] = useState(false);
  const [commitProgress, setCommitProgress] = useState({ done: 0, total: 0 });
  const [summary, setSummary] = useState(null);

  useEffect(() => {
    let alive = true;
    listLessons({ limit: 1000 })
      .then((rows) => {
        if (!alive) return;
        setExistingTitles(
          new Set(
            (rows || [])
              .map((r) => (r.title || '').trim().toLowerCase())
              .filter(Boolean)
          )
        );
      })
      .catch((e) => alive && setError(e.message || 'Failed to load existing lessons'));
    return () => {
      alive = false;
    };
  }, []);

  const handleFilesPicked = async (e) => {
    const picked = Array.from(e.target.files || []);
    // Clear the input so the same file can be re-picked if needed.
    e.target.value = '';
    if (picked.length === 0) return;
    setError(null);
    setSummary(null);
    setParsing(true);
    setParseProgress({ done: 0, total: picked.length });
    const out = [];
    for (let i = 0; i < picked.length; i++) {
      try {
        const parsed = await parseDocxLesson(picked[i]);
        out.push({
          ...parsed,
          // Per-row state — editable title and a selected flag default true.
          editableTitle: parsed.title || '',
          selected: !parsed.parseError,
          status: 'pending', // 'pending' | 'creating' | 'created' | 'failed'
          createdId: null,
          failureMessage: '',
        });
      } catch (err) {
        out.push({
          filename: picked[i].name,
          editableTitle: picked[i].name,
          selected: false,
          parseError: err?.message || String(err),
          body: '',
          images: [],
          status: 'pending',
        });
      }
      setParseProgress({ done: i + 1, total: picked.length });
    }
    // Append to any previously parsed files so the pastor can pick in batches.
    setFiles((prev) => [...prev, ...out]);
    setParsing(false);
  };

  const updateFile = (idx, patch) => {
    setFiles((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], ...patch };
      return next;
    });
  };

  const toggleAll = (value) => {
    setFiles((prev) =>
      prev.map((f) => ({
        ...f,
        // Don't auto-enable files that failed to parse.
        selected: value && !f.parseError,
      }))
    );
  };

  const handleCommit = async () => {
    if (!user?.id) return;
    const toCreate = files
      .map((f, idx) => ({ f, idx }))
      .filter(({ f }) => f.selected && !f.parseError);
    if (toCreate.length === 0) {
      setError('Nothing selected.');
      return;
    }
    setError(null);
    setCommitting(true);
    setCommitProgress({ done: 0, total: toCreate.length });

    let createdCount = 0;
    let imageCount = 0;
    const failures = [];

    for (let i = 0; i < toCreate.length; i++) {
      const { f, idx } = toCreate[i];
      updateFile(idx, { status: 'creating' });
      try {
        const created = await createLesson({
          ownerUserId: user.id,
          draft: {
            title: (f.editableTitle || '').trim() || 'Untitled lesson',
            scripture_reference: '',
            body: f.body || '',
            themes: [],
            class_notes: '',
          },
        });
        // Upload images sequentially. If one fails we keep going so the
        // lesson row still gets the rest.
        let imageOk = 0;
        for (let j = 0; j < (f.images?.length || 0); j++) {
          const img = f.images[j];
          try {
            // addImageToLesson expects a File; wrap the Blob with a
            // synthetic filename so the storage path has the right ext.
            const ext = img.suggestedExt || 'png';
            const file = new File(
              [img.blob],
              `embedded-${j + 1}.${ext}`,
              { type: img.contentType || 'image/png' }
            );
            await addImageToLesson({
              file,
              ownerUserId: user.id,
              lessonId: created.id,
              sortOrder: j,
            });
            imageOk++;
          } catch (imgErr) {
            // eslint-disable-next-line no-console
            console.warn('Image upload failed for', f.filename, imgErr);
          }
        }
        imageCount += imageOk;
        createdCount++;
        updateFile(idx, {
          status: 'created',
          createdId: created.id,
        });
      } catch (e) {
        const message = e?.message || String(e);
        failures.push({ filename: f.filename, message });
        updateFile(idx, {
          status: 'failed',
          failureMessage: message,
        });
      }
      setCommitProgress({ done: i + 1, total: toCreate.length });
    }

    setCommitting(false);
    setSummary({ createdCount, imageCount, failures });
    // Refresh duplicate set so subsequent imports in the same session
    // catch the just-created titles.
    try {
      const rows = await listLessons({ limit: 1000 });
      setExistingTitles(
        new Set(
          (rows || [])
            .map((r) => (r.title || '').trim().toLowerCase())
            .filter(Boolean)
        )
      );
    } catch {
      // Non-fatal — existing-set is a UX nicety.
    }
  };

  const counts = useMemo(() => {
    const total = files.length;
    const selected = files.filter((f) => f.selected).length;
    const errored = files.filter((f) => f.parseError).length;
    const dupes = files.filter(
      (f) =>
        existingTitles &&
        (f.editableTitle || '').trim() &&
        existingTitles.has((f.editableTitle || '').trim().toLowerCase())
    ).length;
    const totalImages = files
      .filter((f) => f.selected)
      .reduce((acc, f) => acc + (f.images?.length || 0), 0);
    return { total, selected, errored, dupes, totalImages };
  }, [files, existingTitles]);

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
          Import Word doc lessons
        </h1>
        <p className="text-sm text-gray-600 mt-1">
          Pick one or more <code className="text-xs bg-gray-100 px-1 rounded">.docx</code>{' '}
          files. Each becomes a new lesson — title from filename, body
          from the document text, and embedded images uploaded to the
          lesson's gallery. You can edit each title before importing.
          Lessons with a matching title already in your library get a
          warning.
        </p>
      </div>

      <div className="card space-y-3">
        <div className="flex items-center gap-3">
          <label className="btn-secondary cursor-pointer">
            <input
              type="file"
              accept=".docx"
              multiple
              onChange={handleFilesPicked}
              className="hidden"
            />
            + Pick .docx files
          </label>
          {parsing && (
            <span className="text-xs text-gray-500">
              Parsing {parseProgress.done} of {parseProgress.total}…
            </span>
          )}
          {!parsing && files.length > 0 && (
            <span className="text-xs text-gray-500">
              {counts.total} parsed · {counts.selected} selected ·{' '}
              {counts.totalImages} image{counts.totalImages === 1 ? '' : 's'}
              {counts.errored > 0 && (
                <> · <span className="text-red-600">{counts.errored} failed</span></>
              )}
              {counts.dupes > 0 && (
                <>
                  {' '}
                  ·{' '}
                  <span className="text-amber-700">
                    {counts.dupes} duplicate title
                    {counts.dupes === 1 ? '' : 's'}
                  </span>
                </>
              )}
            </span>
          )}
        </div>
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
          {error}
        </p>
      )}

      {files.length > 0 && (
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
              <span className="text-gray-400">·</span>
              <button
                type="button"
                onClick={() => setFiles([])}
                className="text-red-600 hover:underline"
              >
                Clear list
              </button>
            </div>
          </div>

          <ul className="divide-y">
            {files.map((f, idx) => {
              const isDupe =
                existingTitles &&
                (f.editableTitle || '').trim() &&
                existingTitles.has(
                  (f.editableTitle || '').trim().toLowerCase()
                );
              return (
                <li
                  key={idx}
                  className={`py-3 ${
                    f.status === 'created' ? 'opacity-60' : ''
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={f.selected}
                      disabled={!!f.parseError || committing || f.status === 'created'}
                      onChange={(e) =>
                        updateFile(idx, { selected: e.target.checked })
                      }
                    />
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          type="text"
                          className="input flex-1 min-w-[200px]"
                          value={f.editableTitle}
                          disabled={committing || f.status === 'created'}
                          onChange={(e) =>
                            updateFile(idx, { editableTitle: e.target.value })
                          }
                        />
                        {f.images?.length > 0 && (
                          <span className="text-xs bg-umc-50 text-umc-900 rounded px-2 py-0.5">
                            {f.images.length} image
                            {f.images.length === 1 ? '' : 's'}
                          </span>
                        )}
                        {isDupe && (
                          <span className="text-xs bg-amber-50 text-amber-800 rounded px-2 py-0.5">
                            ⚠ title already exists
                          </span>
                        )}
                        {f.status === 'created' && (
                          <Link
                            to={`/lessons/${f.createdId}`}
                            className="text-xs text-green-700 hover:underline"
                          >
                            ✓ created — open
                          </Link>
                        )}
                      </div>
                      <p className="text-xs text-gray-500">
                        {f.filename}
                        {f.parseError && (
                          <span className="text-red-600 ml-2">
                            — {f.parseError}
                          </span>
                        )}
                        {f.status === 'failed' && (
                          <span className="text-red-600 ml-2">
                            — import failed: {f.failureMessage}
                          </span>
                        )}
                      </p>
                      {f.body && (
                        <p className="text-xs text-gray-600 line-clamp-2 font-serif">
                          {f.body.slice(0, 240)}
                          {f.body.length > 240 && '…'}
                        </p>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="flex items-center justify-between border-t pt-3">
            <p className="text-xs text-gray-500">
              {committing
                ? `Importing ${commitProgress.done} of ${commitProgress.total}…`
                : counts.selected > 0
                  ? `Ready to import ${counts.selected} lesson${counts.selected === 1 ? '' : 's'} (${counts.totalImages} image${counts.totalImages === 1 ? '' : 's'}).`
                  : 'Select rows to import.'}
            </p>
            <button
              type="button"
              onClick={handleCommit}
              disabled={committing || counts.selected === 0}
              className="btn-primary disabled:opacity-50"
            >
              {committing
                ? `Importing… ${commitProgress.done}/${commitProgress.total}`
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
            {summary.createdCount === 1 ? '' : 's'}, uploaded{' '}
            <strong>{summary.imageCount}</strong> image
            {summary.imageCount === 1 ? '' : 's'}.
          </p>
          {summary.failures.length > 0 && (
            <>
              <p className="text-sm text-red-700">
                {summary.failures.length} file
                {summary.failures.length === 1 ? '' : 's'} failed:
              </p>
              <ul className="text-xs text-red-700 list-disc list-inside">
                {summary.failures.slice(0, 20).map((f, i) => (
                  <li key={i}>
                    {f.filename}: {f.message}
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="pt-2 flex gap-2">
            <button
              type="button"
              onClick={() => navigate('/lessons')}
              className="btn-secondary"
            >
              Go to All lessons
            </button>
            <button
              type="button"
              onClick={() => {
                // Clear committed rows so the pastor can keep importing.
                setFiles((prev) =>
                  prev.filter((f) => f.status !== 'created')
                );
                setSummary(null);
              }}
              className="btn-secondary"
            >
              Import more
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
