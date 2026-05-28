// "Group back-page" Word doc.
//
// One page of context for a single group: header (name / when / where),
// roster, recent lessons used (with dates), upcoming queue. Used as a
// reference sheet — printed once a quarter or whenever the group's
// info changes, not paired with a specific lesson.
//
// Designed so it can later be appended to a lesson's docx as a second
// section if we ever want the "lesson on side 1, group context on side
// 2" handout flow — buildGroupBackPageSection returns a docx section
// object that buildGroupBackPageDocxBlob then wraps into its own doc.

import {
  Document,
  Paragraph,
  TextRun,
  AlignmentType,
  LineRuleType,
  convertInchesToTwip,
  Packer,
} from 'docx';
import { getGroup, listGroupMembers } from './lessonGroups';
import { listQueueForGroup } from './lessonQueue';
import { listUsesForGroup } from './lessonUses';
import { formatPersonName } from './people';

// --- formatting helpers ---------------------------------------------

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function sectionHeader(text) {
  return new Paragraph({
    spacing: { before: 200, after: 80 },
    children: [
      new TextRun({
        text: text,
        bold: true,
        size: 22, // 11pt
        color: '5B1A1A', // UMC maroon
      }),
    ],
  });
}

function smallNote(text) {
  return new Paragraph({
    spacing: { after: 60 },
    children: [
      new TextRun({
        text,
        italics: true,
        size: 18, // 9pt
        color: '666666',
      }),
    ],
  });
}

function plainPara(text, opts = {}) {
  return new Paragraph({
    spacing: { line: 280, lineRule: LineRuleType.AUTO, after: 60 },
    ...opts,
    children: [
      new TextRun({ text, size: 22 }), // 11pt
    ],
  });
}

function blank() {
  return new Paragraph({ children: [] });
}

// --- section builder ------------------------------------------------

/**
 * Build the children array for the back-page section. Pulled out so a
 * future "append to lesson docx" flow can re-use it.
 */
async function buildGroupBackPageChildren(groupId) {
  const group = await getGroup(groupId);
  if (!group) throw new Error('Group not found');

  const [members, uses, queue] = await Promise.all([
    listGroupMembers(groupId).catch(() => []),
    listUsesForGroup(groupId).catch(() => []),
    listQueueForGroup(groupId).catch(() => []),
  ]);

  const recentUses = uses.slice(0, 15);
  const upcomingQueue = queue.slice(0, 5);

  const children = [];

  // Header: group name, large + centered.
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 80 },
      children: [
        new TextRun({
          text: group.name || '(unnamed group)',
          bold: true,
          size: 32, // 16pt
        }),
      ],
    })
  );

  // Sub-header: meeting / location on one line, centered.
  const headerBits = [];
  if (group.meeting_day_time) headerBits.push(group.meeting_day_time);
  if (group.location) headerBits.push(group.location);
  if (headerBits.length > 0) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 200 },
        children: [
          new TextRun({
            text: headerBits.join(' · '),
            italics: true,
            size: 22, // 11pt
            color: '666666',
          }),
        ],
      })
    );
  } else {
    children.push(blank());
  }

  // Description (optional).
  if (group.description && group.description.trim()) {
    children.push(plainPara(group.description.trim()));
    children.push(blank());
  }

  // Roster.
  children.push(sectionHeader(`Members (${members.length})`));
  if (members.length === 0) {
    children.push(smallNote('No members listed yet.'));
  } else {
    // Names, comma-separated, in a single flowing paragraph. Saves
    // vertical space on what's meant to be a back-of-page.
    children.push(
      plainPara(
        members
          .map((m) => formatPersonName(m.person))
          .filter(Boolean)
          .join(', ')
      )
    );
  }

  // Upcoming queue.
  children.push(sectionHeader('Coming up'));
  if (upcomingQueue.length === 0) {
    children.push(smallNote('Nothing queued yet.'));
  } else {
    for (let i = 0; i < upcomingQueue.length; i++) {
      const q = upcomingQueue[i];
      const title = q.lesson?.title || '(untitled)';
      const ref = q.lesson?.scripture_reference
        ? ` — ${q.lesson.scripture_reference}`
        : '';
      children.push(
        new Paragraph({
          spacing: { after: 40 },
          children: [
            new TextRun({
              text: `${i + 1}. `,
              size: 22,
              color: '999999',
            }),
            new TextRun({ text: title, size: 22 }),
            new TextRun({
              text: ref,
              size: 20,
              italics: true,
              color: '666666',
            }),
          ],
        })
      );
    }
  }

  // Recent lessons.
  children.push(sectionHeader(`Recent lessons (${recentUses.length})`));
  if (recentUses.length === 0) {
    children.push(smallNote("No lessons recorded for this group yet."));
  } else {
    for (const u of recentUses) {
      const title = u.lesson?.title || '(untitled)';
      const ref = u.lesson?.scripture_reference
        ? ` — ${u.lesson.scripture_reference}`
        : '';
      children.push(
        new Paragraph({
          spacing: { after: 40 },
          children: [
            new TextRun({
              text: `${fmtDate(u.used_on)}  `,
              size: 20,
              color: '999999',
            }),
            new TextRun({ text: title, size: 22 }),
            new TextRun({
              text: ref,
              size: 20,
              italics: true,
              color: '666666',
            }),
          ],
        })
      );
    }
  }

  return children;
}

/**
 * Build the back-page as a standalone docx Blob.
 */
export async function buildGroupBackPageDocxBlob(groupId) {
  const children = await buildGroupBackPageChildren(groupId);
  const doc = new Document({
    creator: 'WFUMC Lesson Maker',
    title: 'Group sheet',
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertInchesToTwip(0.7),
              bottom: convertInchesToTwip(0.7),
              left: convertInchesToTwip(0.8),
              right: convertInchesToTwip(0.8),
            },
          },
        },
        children,
      },
    ],
  });
  return Packer.toBlob(doc);
}

/**
 * Convenience: trigger a browser download of the back-page docx for
 * the given group.
 */
export async function downloadGroupBackPageDocx(group) {
  if (!group?.id) throw new Error('No group');
  const blob = await buildGroupBackPageDocxBlob(group.id);
  const safeName = sanitizeFilename(group.name || 'group');
  triggerDownload(blob, `${safeName} - Group sheet.docx`);
}

function sanitizeFilename(name) {
  return (
    name
      .replace(/[\\/:*?"<>|]/g, '')
      .replace(/\s+/g, ' ')
      .trim() || 'group'
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
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
