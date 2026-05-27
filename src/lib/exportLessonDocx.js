// Generate a styled .docx for a lesson. Order:
//
//   1. CLASS NOTES (always at the top, called out)
//   2. Title (large, centered)
//   3. Scripture reference (italic, centered, under title)
//   4. Themes line (small, italic, centered) — if any
//   5. Body (split on blank lines into paragraphs)
//   6. Attached images (each on its own paragraph at the end)
//
// Class notes go FIRST because they're things the pastor needs to do
// before/at the start of class (read these announcements, pass these
// handouts, etc.) — not buried at the bottom.

import {
  Document,
  Paragraph,
  TextRun,
  ImageRun,
  AlignmentType,
  LineRuleType,
  convertInchesToTwip,
  Packer,
} from 'docx';
import { listLessonImages, publicLessonImageUrl } from './lessonImages';

// --- Helpers --------------------------------------------------------

function splitParagraphs(text) {
  if (!text) return [];
  // Split on blank lines; keep single newlines inside a paragraph as
  // intentional line breaks.
  return text
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function paragraphWithLineBreaks(text, runOpts = {}, paraOpts = {}) {
  const lines = text.split('\n');
  const children = [];
  lines.forEach((line, i) => {
    if (i > 0) children.push(new TextRun({ break: 1 }));
    if (line.length > 0) {
      children.push(new TextRun({ text: line, ...runOpts }));
    }
  });
  return new Paragraph({
    spacing: { line: 360, lineRule: LineRuleType.AUTO, after: 120 },
    ...paraOpts,
    children,
  });
}

function blankParagraph() {
  return new Paragraph({ children: [] });
}

// Fetch image bytes for embedding. Returns { bytes, dim: {w, h} } or
// null if the fetch failed.
async function fetchImageForEmbed(image) {
  try {
    const url = publicLessonImageUrl(image.image_path);
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    // Decode to get natural dimensions (so we can scale).
    const dim = await new Promise((resolve) => {
      const objectUrl = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(objectUrl);
        resolve({ w: img.naturalWidth, h: img.naturalHeight });
      };
      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        resolve({ w: 800, h: 600 });
      };
      img.src = objectUrl;
    });
    return { bytes, dim };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('Failed to fetch lesson image for export', image, e);
    return null;
  }
}

// Compute scaled width/height (points) so the longer side fits within
// `maxLongerInches` inches. 1 inch = 72 docx points (the docx ImageRun
// transformation expects pixels but pptx/docx are flexible; docx uses
// EMU internally and accepts width/height in pixels).
function scaleFit(dim, maxLongerPx = 540) {
  const w = dim.w || 1;
  const h = dim.h || 1;
  const longer = Math.max(w, h);
  if (longer <= maxLongerPx) return { width: w, height: h };
  const ratio = maxLongerPx / longer;
  return {
    width: Math.round(w * ratio),
    height: Math.round(h * ratio),
  };
}

// --- Main builder ---------------------------------------------------

export async function buildLessonDocxBlob(lesson) {
  if (!lesson) throw new Error('No lesson');

  const images = await listLessonImages(lesson.id);
  const imageEmbeds = [];
  for (const img of images) {
    const fetched = await fetchImageForEmbed(img);
    if (fetched) imageEmbeds.push({ ...fetched, image: img });
  }

  const children = [];

  // 1. CLASS NOTES — pastor-only "do this before/at start of class"
  //    block. Boxed-ish presentation via a "CLASS NOTES" header line
  //    followed by the content. (We don't draw an actual border; the
  //    bold label is enough to draw the eye.)
  if (lesson.class_notes && lesson.class_notes.trim()) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.LEFT,
        spacing: { after: 120 },
        children: [
          new TextRun({
            text: 'CLASS NOTES',
            bold: true,
            size: 22, // 11pt
            color: '8B0000',
          }),
        ],
      })
    );
    for (const para of splitParagraphs(lesson.class_notes)) {
      children.push(
        paragraphWithLineBreaks(
          para,
          { size: 22 }, // 11pt
          { alignment: AlignmentType.LEFT }
        )
      );
    }
    // Visual gap before the lesson proper.
    children.push(blankParagraph());
  }

  // 2. Title.
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 80 },
      children: [
        new TextRun({
          text: lesson.title || 'Untitled lesson',
          bold: true,
          size: 36, // 18pt
        }),
      ],
    })
  );

  // 3. Scripture reference.
  if (lesson.scripture_reference && lesson.scripture_reference.trim()) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 80 },
        children: [
          new TextRun({
            text: lesson.scripture_reference.trim(),
            italics: true,
            size: 26, // 13pt
          }),
        ],
      })
    );
  }

  // 4. Themes (small italic).
  if (Array.isArray(lesson.themes) && lesson.themes.length > 0) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 200 },
        children: [
          new TextRun({
            text: lesson.themes.join(' · '),
            italics: true,
            size: 20, // 10pt
            color: '666666',
          }),
        ],
      })
    );
  } else {
    children.push(blankParagraph());
  }

  // 5. Body.
  if (lesson.body && lesson.body.trim()) {
    for (const para of splitParagraphs(lesson.body)) {
      children.push(
        paragraphWithLineBreaks(
          para,
          { size: 24 }, // 12pt
          { alignment: AlignmentType.LEFT }
        )
      );
    }
  }

  // 6. Images.
  if (imageEmbeds.length > 0) {
    children.push(blankParagraph());
    children.push(
      new Paragraph({
        alignment: AlignmentType.LEFT,
        spacing: { after: 120 },
        children: [
          new TextRun({
            text: imageEmbeds.length === 1 ? 'Image' : 'Images',
            bold: true,
            size: 22,
            color: '666666',
          }),
        ],
      })
    );
    for (const embed of imageEmbeds) {
      const { width, height } = scaleFit(embed.dim, 540);
      children.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 80 },
          children: [
            new ImageRun({
              data: embed.bytes,
              transformation: { width, height },
            }),
          ],
        })
      );
      if (embed.image.caption) {
        children.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 200 },
            children: [
              new TextRun({
                text: embed.image.caption,
                italics: true,
                size: 20,
                color: '666666',
              }),
            ],
          })
        );
      }
    }
  }

  const doc = new Document({
    creator: 'WFUMC Lesson Maker',
    title: lesson.title || 'Lesson',
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertInchesToTwip(0.8),
              bottom: convertInchesToTwip(0.8),
              left: convertInchesToTwip(0.9),
              right: convertInchesToTwip(0.9),
            },
          },
        },
        children,
      },
    ],
  });

  return Packer.toBlob(doc);
}

// Convenience: download as filename.docx.
export async function downloadLessonDocx(lesson) {
  const blob = await buildLessonDocxBlob(lesson);
  const safeTitle = sanitizeFilename(lesson.title || 'lesson');
  const filename = `${safeTitle}.docx`;
  triggerDownload(blob, filename);
}

function sanitizeFilename(name) {
  return (
    name
      // Strip filesystem-unfriendly characters but keep spaces.
      .replace(/[\\/:*?"<>|]/g, '')
      .replace(/\s+/g, ' ')
      .trim() || 'lesson'
  );
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke a beat later so Safari finishes the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
