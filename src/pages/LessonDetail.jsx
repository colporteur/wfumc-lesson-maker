import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import {
  createLesson,
  deleteLesson,
  getLesson,
  updateLesson,
} from '../lib/lessons';
import {
  addImageToLesson,
  listLessonImages,
  publicLessonImageUrl,
  removeLessonImage,
  rotateLessonImage,
} from '../lib/lessonImages';
import { prepareImageForUpload } from '../lib/imageHelpers';
import { downloadLessonDocx } from '../lib/exportLessonDocx';
import LoadingSpinner from '../components/LoadingSpinner.jsx';

const EMPTY_DRAFT = {
  title: '',
  scripture_reference: '',
  body: '',
  themes: [],
  class_notes: '',
};

export default function LessonDetail({ mode }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { id } = useParams();
  const isNew = mode === 'new';

  const [loading, setLoading] = useState(!isNew);
  const [lesson, setLesson] = useState(null);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [themeInput, setThemeInput] = useState('');
  const [images, setImages] = useState([]);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [uploadingImages, setUploadingImages] = useState(false);
  const [rotatingId, setRotatingId] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const fileInputRef = useRef(null);

  // Load existing lesson (edit mode).
  useEffect(() => {
    if (isNew) return;
    let alive = true;
    setLoading(true);
    setError(null);
    Promise.all([getLesson(id), listLessonImages(id)])
      .then(([row, imgs]) => {
        if (!alive) return;
        if (!row) {
          setError('Lesson not found.');
        } else {
          setLesson(row);
          setDraft({
            title: row.title || '',
            scripture_reference: row.scripture_reference || '',
            body: row.body || '',
            themes: Array.isArray(row.themes) ? row.themes : [],
            class_notes: row.class_notes || '',
          });
          setImages(imgs);
        }
        setLoading(false);
      })
      .catch((e) => {
        if (!alive) return;
        setError(e.message || 'Failed to load lesson');
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [id, isNew]);

  const update = (field, value) => {
    setDraft((d) => ({ ...d, [field]: value }));
  };

  const addTheme = () => {
    const t = themeInput.trim();
    if (!t) return;
    if (draft.themes.includes(t)) {
      setThemeInput('');
      return;
    }
    setDraft((d) => ({ ...d, themes: [...d.themes, t] }));
    setThemeInput('');
  };

  const removeTheme = (t) => {
    setDraft((d) => ({ ...d, themes: d.themes.filter((x) => x !== t) }));
  };

  const handleSave = async () => {
    if (!user?.id) return;
    setSaving(true);
    setError(null);
    try {
      if (isNew) {
        const created = await createLesson({
          ownerUserId: user.id,
          draft,
        });
        navigate(`/lessons/${created.id}`, { replace: true });
      } else {
        const updated = await updateLesson(id, draft);
        setLesson(updated);
        setSavedAt(new Date());
      }
    } catch (e) {
      setError(e.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (isNew || !lesson) return;
    if (!window.confirm(`Delete "${lesson.title || 'this lesson'}"? This cannot be undone.`)) {
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      await deleteLesson(id);
      navigate('/lessons', { replace: true });
    } catch (e) {
      setError(e.message || 'Delete failed');
      setDeleting(false);
    }
  };

  const handleImagePick = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = ''; // allow re-picking the same file later
    if (files.length === 0 || !lesson || !user?.id) return;
    setUploadingImages(true);
    setError(null);
    try {
      // Important: decode each file IMMEDIATELY into a fresh JPEG Blob.
      // On mobile PWAs the original File can become unreadable in
      // between user interactions, which we hit hard in the Sermons app
      // ("file could not be read"). Decoding now means subsequent
      // uploads use our own bytes, not the OS handle.
      const preparedItems = [];
      for (const f of files) {
        const { blob, mediaType } = await prepareImageForUpload(f);
        const safeName = renameToJpg(f.name || 'image');
        preparedItems.push(
          new File([blob], safeName, { type: mediaType })
        );
      }
      let order = images.length;
      const added = [];
      for (const file of preparedItems) {
        const row = await addImageToLesson({
          file,
          ownerUserId: user.id,
          lessonId: lesson.id,
          sortOrder: order++,
        });
        added.push(row);
      }
      setImages((prev) => [...prev, ...added]);
    } catch (err) {
      setError(err.message || 'Image upload failed');
    } finally {
      setUploadingImages(false);
    }
  };

  const handleRotate = async (img) => {
    if (!user?.id) return;
    setRotatingId(img.id);
    setError(null);
    try {
      const updated = await rotateLessonImage(img, user.id);
      setImages((prev) =>
        prev.map((x) => (x.id === img.id ? updated : x))
      );
    } catch (e) {
      setError(e.message || 'Rotate failed');
    } finally {
      setRotatingId(null);
    }
  };

  const handleRemoveImage = async (img) => {
    if (!window.confirm('Remove this image?')) return;
    setError(null);
    try {
      await removeLessonImage(img);
      setImages((prev) => prev.filter((x) => x.id !== img.id));
    } catch (e) {
      setError(e.message || 'Remove failed');
    }
  };

  const handleExport = async () => {
    if (!lesson) return;
    setExporting(true);
    setError(null);
    try {
      // Use the just-saved draft for the export, not the stale `lesson`
      // — that way an Export-without-Save still uses the user's latest text.
      const exportable = { ...lesson, ...draft };
      await downloadLessonDocx(exportable);
    } catch (e) {
      setError(e.message || 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const headerTitle = useMemo(() => {
    if (isNew) return 'New lesson';
    return draft.title?.trim() || lesson?.title || '(untitled)';
  }, [isNew, draft.title, lesson]);

  if (loading) return <LoadingSpinner label="Loading lesson..." />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <Link
            to="/lessons"
            className="text-xs text-gray-500 hover:text-gray-700"
          >
            ← All lessons
          </Link>
          <h1 className="font-serif text-2xl text-umc-900 truncate">
            {headerTitle}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {!isNew && (
            <button
              type="button"
              onClick={handleExport}
              disabled={exporting}
              className="btn-secondary disabled:opacity-50"
            >
              {exporting ? 'Exporting...' : '⤓ Word doc'}
            </button>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="btn-primary disabled:opacity-50"
          >
            {saving ? 'Saving...' : isNew ? 'Create lesson' : 'Save'}
          </button>
        </div>
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

      <div className="card space-y-4">
        <div>
          <label className="label" htmlFor="title">
            Title
          </label>
          <input
            id="title"
            className="input"
            value={draft.title}
            onChange={(e) => update('title', e.target.value)}
            placeholder="e.g. The Prodigal Son returns"
          />
        </div>

        <div>
          <label className="label" htmlFor="scripture">
            Scripture reference
          </label>
          <input
            id="scripture"
            className="input"
            value={draft.scripture_reference}
            onChange={(e) => update('scripture_reference', e.target.value)}
            placeholder="e.g. Luke 15:11-32"
          />
        </div>

        <div>
          <label className="label">Themes</label>
          <div className="flex flex-wrap gap-2 mb-2">
            {draft.themes.length === 0 ? (
              <span className="text-xs text-gray-400">No themes yet</span>
            ) : (
              draft.themes.map((t) => (
                <span
                  key={t}
                  className="inline-flex items-center gap-1 rounded-full bg-umc-50 text-umc-900 px-2.5 py-1 text-xs"
                >
                  {t}
                  <button
                    type="button"
                    onClick={() => removeTheme(t)}
                    className="text-umc-900 hover:text-red-600"
                    aria-label={`Remove theme ${t}`}
                  >
                    ✕
                  </button>
                </span>
              ))
            )}
          </div>
          <div className="flex gap-2">
            <input
              className="input flex-1"
              value={themeInput}
              onChange={(e) => setThemeInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addTheme();
                }
              }}
              placeholder="Add a theme and press Enter (e.g. forgiveness)"
            />
            <button
              type="button"
              className="btn-secondary"
              onClick={addTheme}
              disabled={!themeInput.trim()}
            >
              Add
            </button>
          </div>
        </div>
      </div>

      <div className="card space-y-4">
        <div>
          <label className="label" htmlFor="class_notes">
            Class notes{' '}
            <span className="text-xs font-normal text-gray-500">
              (announcements, handouts, things to do at the start of class —
              appear FIRST in the Word doc)
            </span>
          </label>
          <textarea
            id="class_notes"
            className="input"
            rows={4}
            value={draft.class_notes}
            onChange={(e) => update('class_notes', e.target.value)}
            placeholder="e.g. Pass out handouts. Remind class of next week's potluck."
          />
        </div>

        <div>
          <label className="label" htmlFor="body">
            Lesson body
          </label>
          <textarea
            id="body"
            className="input font-serif"
            rows={16}
            value={draft.body}
            onChange={(e) => update('body', e.target.value)}
            placeholder="Write or paste the lesson content here. Use blank lines to separate paragraphs."
          />
        </div>
      </div>

      {!isNew && (
        <div className="card space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-serif text-lg text-umc-900">Images</h2>
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={handleImagePick}
                className="hidden"
              />
              <button
                type="button"
                className="btn-secondary"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingImages}
              >
                {uploadingImages ? 'Uploading...' : '+ Add images'}
              </button>
            </div>
          </div>

          {images.length === 0 ? (
            <p className="text-sm text-gray-500">
              No images attached. Add photos, handout scans, or art that
              should appear after the lesson body in the Word doc.
            </p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {images.map((img) => (
                <div
                  key={img.id}
                  className="relative group rounded border bg-white overflow-hidden"
                >
                  <img
                    src={publicLessonImageUrl(img.image_path)}
                    alt={img.caption || 'lesson image'}
                    className="w-full h-40 object-cover"
                  />
                  <div className="absolute top-1 right-1 flex gap-1">
                    <button
                      type="button"
                      onClick={() => handleRotate(img)}
                      disabled={rotatingId === img.id}
                      className="bg-white/90 hover:bg-white text-gray-800 rounded-full w-7 h-7 text-sm shadow disabled:opacity-50"
                      title="Rotate 90° clockwise"
                    >
                      {rotatingId === img.id ? '…' : '↻'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRemoveImage(img)}
                      className="bg-white/90 hover:bg-white text-red-600 rounded-full w-7 h-7 text-sm shadow"
                      title="Remove image"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {!isNew && (
        <div className="card border-red-200">
          <h2 className="font-serif text-sm text-red-700 mb-2">
            Danger zone
          </h2>
          <p className="text-xs text-gray-500 mb-3">
            Deleting a lesson removes its content and all attached images.
            This cannot be undone.
          </p>
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className="text-sm text-red-700 hover:text-red-900 underline disabled:opacity-50"
          >
            {deleting ? 'Deleting...' : 'Delete this lesson'}
          </button>
        </div>
      )}
    </div>
  );
}

function renameToJpg(originalName) {
  const dot = originalName.lastIndexOf('.');
  const base = dot > 0 ? originalName.slice(0, dot) : originalName;
  return `${base}.jpg`;
}
