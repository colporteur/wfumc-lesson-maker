# WFUMC Lesson Maker

Pastor's library of Bible study / Sunday school lessons. Phase A is
the minimum viable product:

- Create + edit lessons (title, scripture reference, body, themes,
  class notes, images)
- Attach images to lessons with rotate + remove
- Generate a Word document for each lesson — class notes appear near
  the top, then title, scripture reference, body, then any attached
  images
- Lesson archive list with search

Future phases (sketched in the project notes, not yet built):

- **B**: Workspace-style chat-revise loop with Claude + pull-from-sermons
  resource picker + Claude scripture suggester with NRSVue inline insert
- **C**: Groups + member rosters (cross-ref with Pastoral Records),
  lesson uses (date / group / location / picker), rotation tracker
- **D**: Per-group queue of upcoming lessons, "Start from queue" flow
- **E**: "Back page" Word doc — previous lessons + queue + roster +
  this-week-picker + next-week-picker
- **F**: Bulk import of existing lessons (Word/PDF, with embedded
  images), Claude-assisted titling

## Local development

```bash
npm install
cp .env.example .env.local
# Fill VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY (same as other WFUMC apps)
npm run dev
```

Default port: **5179**.

## Database schema

Migration `0056_lessons.sql` lives in the WFUMC Bulletin App's
`supabase/migrations/` directory (all WFUMC apps share one Supabase
project, so all migrations live there). Apply via Supabase SQL Editor
before running this app for the first time.

Tables:

- `lessons` — the lesson content
- `lesson_images` — multi-image attachments
- `lesson-images` storage bucket (public-read, RLS on table rows
  controls access)

Owner-scoped RLS throughout.

## Deploy

Push to `main` → GitHub Actions builds + deploys to GitHub Pages.
Repo secrets:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

(Same values as the other WFUMC repos.)
