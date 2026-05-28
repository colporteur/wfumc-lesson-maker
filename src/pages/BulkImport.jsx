// Bulk import of .docx and .pdf lesson files.
//
// Two-stage flow:
//   1. Pick files → parse each (Word: mammoth text+images; PDF: pdfjs
//      text with Claude-vision OCR fallback) → sniff a scripture
//      reference from the body → show a preview table.
//   2. Each row whose title matches an existing lesson exposes a
//      Dupe action dropdown: merge (default) / replace / create new /
//      skip. Commit honors the per-row action.

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import {
  appendToBody,
  createLesson,
  findLessonByTitle,
  listLessons,
  replaceLessonBody,
} from '../lib/lessons';
import { addImageToLesson } from '../lib/lessonImages';
import { parseLessonFile } from '../lib/parseLessonFile';

// Dupe-action constants. Free-text in state, but keep them centralized.
const ACTIONS = {
  MERGE: 'merge',
  REPLACE: 'replace',
  CREATE_NEW: 'create_new',
  SKIP: 'skip',
};

export default function BulkImport() {
  const { user } = useAuth();
  const navigate = useNavigate();

  // existingTitlesMap: title-lowercase → existing lesson id, so dupe
  // rows can show the target and merge/replace can target it directly.
  const [existingTitlesMap, setExistingTitlesMap] = useState(null);
  const [files, setFiles] = useState([]);
  const [parsing, setParsing] = useState(false);
  const [parseProgress, setParseProgress] = useState({
    done: 0,
    total: 0,
    label: '',
  });
  const [error, setError] = useState(null);
  const [committing, setCommitting] = useState(false);
  const [commitProgress, setCommitProgress] = useState({ done: 0, total: 0 });
  const [summary, setSummary] = useState(null);

  // --- existing-titles fetch (for dupe detection) -------------------

  const refreshExistingTitles = async () => {
    try {
      const rows = await listLessons({ limit: 1000 });
      const map = new Map();
      for (const r of rows || []) {
        const key = (r.title || '').trim().toLowerCase();
        if (key) map.set(key, r.id);
      }
      setExistingTitlesMap(map);
    } catch (e) {
      setError(e.message || 'Failed to load existing lessons');
    }
  };

  useEffect(() => {
    refreshExistingTitles();
    // refreshExistingTitles is stable for our purposes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- file picking + parsing ---------------------------------------

  const handleFilesPicked = async (e) => {
    const picked = Array.from(e.target.files || []);
    e.target.value = '';
    if (picked.length === 0) return;
    setError(null);
    setSummary(null);
    setParsing(true);
    setParseProgress({ done: 0, total: picked.length, label: '' });

    const out = [];
    for (let i = 0; i < picked.length; i++) {
      const f = picked[i];
      setParseProgress({
        done: i,
        total: picked.length,
        label: f.name,
      });
      const parsed = await parseLessonFile(f, {
        onOcrProgress: (info) => {
          // Surface OCR progress under the file name so the pastor
          // knows long PDFs aren't stuck.
          setParseProgress({
            done: i,
            total: picked.length,
            label: `${f.name} — ${info.phase}: ${info.done}/${info.total}`,
          });
        },
      });
      out.push({
        ...parsed,
        // Editable per-row state.
        editableTitle: parsed.title || '',
        editableScripture: parsed.scripture_reference || '',
        selected: !parsed.parseError,
        // dupeAction default depends on whether a match exists at commit
        // time; we resolve it lazily.
        dupeAction: ACTIONS.MERGE,
        status: 'pending',
        createdId: null,
        failureMessage: '',
      });
      setParseProgress({
        done: i + 1,
        total: picked.length,
        label: f.name,
      });
    }
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
        selected: value && !f.parseError,
      }))
    );
  };

  // --- commit -------------------------------------------------------

  const handleCommit = async () => {
    if (!user?.id) return;
    const toProcess = files
      .map((f, idx) => ({ f, idx }))
      .filter(({ f }) => f.selected && !f.parseError);
    if (toProcess.length === 0) {
      setError('Nothing selected.');
      return;
    }
    setError(null);
    setCommitting(true);
    setCommitProgress({ done: 0, total: toProcess.length });

    let createdCount = 0;
    let mergedCount = 0;
    let replacedCount = 0;
    let skippedCount = 0;
    let imageCount = 0;
    const failures = [];

    for (let i = 0; i < toProcess.length; i++) {
      const { f, idx } = toProcess[i];
      updateFile(idx, { status: 'creating' });

      const title = (f.editableTitle || '').trim() || 'Untitled lesson';
      const scripture = (f.editableScripture || '').trim();
      const body = f.body || '';
      const images = f.images || [];

      // Look up the existing target by title (case-insensitive).
      let existingId = null;
      try {
        const existing = await findLessonByTitle(title);
        existingId = existing?.id ?? null;
      } catch (e) {
        // Non-fatal — treat as no existing.
        // eslint-disable-next-line no-console
        console.warn('findLessonByTitle failed', e);
      }

      const action = existingId ? f.dupeAction : ACTIONS.CREATE_NEW;

      try {
        let targetId = null;
        if (action === ACTIONS.SKIP) {
          skippedCount++;
          updateFile(idx, { status: 'skipped' });
        } else if (action === ACTIONS.MERGE && existingId) {
          await appendToBody(existingId, body, {
            headerLabel: `imported from ${f.filename}`,
          });
          targetId = existingId;
          mergedCount++;
          updateFile(idx, { status: 'merged', createdId: existingId });
        } else if (action === ACTIONS.REPLACE && existingId) {
          await replaceLessonBody(existingId, body);
          targetId = existingId;
          replacedCount++;
          updateFile(idx, { status: 'replaced', createdId: existingId });
        } else {
          // CREATE_NEW (or fallback if existingId disappeared).
          const created = await createLesson({
            ownerUserId: user.id,
            draft: {
              title,
              scripture_reference: scripture,
              body,
              themes: [],
              class_notes: '',
            },
          });
          targetId = created.id;
          createdCount++;
          updateFile(idx, { status: 'created', createdId: created.id });
        }

        // Upload images for merge/replace/create — but NOT for skip.
        // Replace operates only on the body per the spec (so it doesn't
        // silently double up someone's existing image gallery).
        if (targetId && action !== ACTIONS.SKIP && action !== ACTIONS.REPLACE) {
          for (let j = 0; j < images.length; j++) {
            const img = images[j];
            try {
              const ext = img.suggestedExt || 'png';
              const file = new File(
                [img.blob],
                `embedded-${j + 1}.${ext}`,
                { type: img.contentType || 'image/png' }
              );
              await addImageToLesson({
                file,
                ownerUserId: user.id,
                lessonId: targetId,
                sortOrder: j,
              });
              imageCount++;
            } catch (imgErr) {
              // eslint-disable-next-line no-console
              console.warn('Image upload failed for', f.filename, imgErr);
            }
          }
        }
      } catch (e) {
        const message = e?.message || String(e);
        failures.push({ filename: f.filename, action, message });
        updateFile(idx, {
          status: 'failed',
          failureMessage: message,
        });
      }
      setCommitProgress({ done: i + 1, total: toProcess.length });
    }

    setCommitting(false);
    setSummary({
      createdCount,
      mergedCount,
      replacedCount,
      skippedCount,
      imageCount,
      failures,
    });
    await refreshExistingTitles();
  };

  // --- derived ------------------------------------------------------

  const dupesInList = useMemo(() => {
    if (!existingTitlesMap) return new Set();
    const out = new Set();
    for (let i = 0; i < files.length; i++) {
      const key = (files[i].editableTitle || '').trim().toLowerCase();
      if (key && existingTitlesMap.has(key)) out.add(i);
    }
    return out;
  }, [files, existingTitlesMap]);

  const counts = useMemo(() => {
    const total = files.length;
    const selected = files.filter((f) => f.selected).length;
    const errored = files.filter((f) => f.parseError).length;
    const dupes = dupesInList.size;
    const totalImages = files
      .filter((f) => f.selected)
      .reduce((acc, f) => acc + (f.images?.length || 0), 0);
    const ocrPdfs = files.filter((f) => f.ocr?.used).length;
    return { total, selected, errored, dupes, totalImages, ocrPdfs };
  }, [files, dupesInList]);

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
          Import lesson files
        </h1>
        <p className="text-sm text-gray-600 mt-1">
          Pick one or more <code className="text-xs bg-gray-100 px-1 rounded">.docx</code>{' '}
          or <code className="text-xs bg-gray-100 px-1 rounded">.pdf</code>{' '}
          files. Each becomes a lesson — title from filename, body from
          the document text, scripture sniffed from the first lines when
          recognizable, embedded images uploaded (Word only). Scanned
          PDFs are OCR'd by Claude vision. Titles that already exist let
          you merge, replace, create new, or skip per row.
        </p>
      </div>

      <div className="card space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <label className="btn-secondary cursor-pointer">
            <input
              type="file"
              accept=".docx,.pdf"
              multiple
              onChange={handleFilesPicked}
              className="hidden"
            />
            + Pick .docx / .pdf files
          </label>
          {parsing && (
            <span className="text-xs text-gray-500">
              Parsing {parseProgress.done} of {parseProgress.total}…
              {parseProgress.label && (
                <span className="text-gray-400 ml-1">
                  ({parseProgress.label})
                </span>
              )}
            </span>
          )}
          {!parsing && files.length > 0 && (
            <span className="text-xs text-gray-500">
              {counts.total} parsed · {counts.selected} selected ·{' '}
              {counts.totalImages} image{counts.totalImages === 1 ? '' : 's'}
              {counts.ocrPdfs > 0 && (
                <> · {counts.ocrPdfs} PDF{counts.ocrPdfs === 1 ? '' : 's'} OCR'd</>
              )}
              {counts.errored > 0 && (
                <> · <span className="text-red-600">{counts.errored} failed</span></>
              )}
              {counts.dupes > 0 && (
                <>
                  {' '}
                  · <span className="text-amber-700">
                    {counts.dupes} title match
                    {counts.dupes === 1 ? '' : 'es'}
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
              const isDupe = dupesInList.has(idx);
              return (
                <li
                  key={idx}
                  className={`py-3 ${
                    f.status === 'created' ||
                    f.status === 'merged' ||
                    f.status === 'replaced' ||
                    f.status === 'skipped'
                      ? 'opacity-60'
                      : ''
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={f.selected}
                      disabled={
                        !!f.parseError ||
                        committing ||
                        ['created', 'merged', 'replaced', 'skipped'].includes(
                          f.status
                        )
                      }
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
                          disabled={committing}
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
                        {f.ocr?.used && (
                          <span className="text-xs bg-blue-50 text-blue-800 rounded px-2 py-0.5">
                            OCR'd ({f.ocr.pageCount}p
                            {f.ocr.truncated ? ', truncated' : ''})
                          </span>
                        )}
                        {isDupe && f.status === 'pending' && (
                          <select
                            className="text-xs border rounded px-1 py-0.5 bg-amber-50 text-amber-900"
                            value={f.dupeAction}
                            disabled={committing}
                            onChange={(e) =>
                              updateFile(idx, {
                                dupeAction: e.target.value,
                              })
                            }
                            title="A lesson with this title already exists. Pick how to handle it."
                          >
                            <option value={ACTIONS.MERGE}>
                              ⚠ merge into existing
                            </option>
                            <option value={ACTIONS.REPLACE}>
                              replace existing body
                            </option>
                            <option value={ACTIONS.CREATE_NEW}>
                              create new (allow dupe)
                            </option>
                            <option value={ACTIONS.SKIP}>skip</option>
                          </select>
                        )}
                        {f.status === 'created' && (
                          <Link
                            to={`/lessons/${f.createdId}`}
                            className="text-xs text-green-700 hover:underline"
                          >
                            ✓ created — open
                          </Link>
                        )}
                        {f.status === 'merged' && (
                          <Link
                            to={`/lessons/${f.createdId}`}
                            className="text-xs text-green-700 hover:underline"
                          >
                            ✓ merged — open
                          </Link>
                        )}
                        {f.status === 'replaced' && (
                          <Link
                            to={`/lessons/${f.createdId}`}
                            className="text-xs text-green-700 hover:underline"
                          >
                            ✓ replaced — open
                          </Link>
                        )}
                        {f.status === 'skipped' && (
                          <span className="text-xs text-gray-500">
                            skipped
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          className="input flex-1 max-w-sm text-xs"
                          placeholder="(no scripture sniffed — optional)"
                          value={f.editableScripture}
                          disabled={committing}
                          onChange={(e) =>
                            updateFile(idx, {
                              editableScripture: e.target.value,
                            })
                          }
                        />
                      </div>
                      <p className="text-xs text-gray-500">
                        {f.filename}
                        {f.parseError && (
                          <span className="text-red-600 ml-2">
                            — {f.parseError}
                          </span>
                        )}
                        {f.parseWarning && (
                          <span className="text-amber-700 ml-2">
                            — {f.parseWarning}
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
            <strong>{summary.createdCount}</strong> created
            {summary.mergedCount > 0 && (
              <>, <strong>{summary.mergedCount}</strong> merged</>
            )}
            {summary.replacedCount > 0 && (
              <>, <strong>{summary.replacedCount}</strong> replaced</>
            )}
            {summary.skippedCount > 0 && (
              <>, <strong>{summary.skippedCount}</strong> skipped</>
            )}
            . <strong>{summary.imageCount}</strong> image
            {summary.imageCount === 1 ? '' : 's'} uploaded.
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
                    {f.filename} ({f.action}): {f.message}
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
                setFiles((prev) =>
                  prev.filter(
                    (f) =>
                      !['created', 'merged', 'replaced', 'skipped'].includes(
                        f.status
                      )
                  )
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
