import slugify from "Common/Server/Types/MarkdownSlugify";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { dashboardLabel, isDashboardLabel } from "./DocsDashboardLabels";

/*
 * The incident notes docs against the composer they describe.
 *
 * A note is written in one composer: inline on an event's Notes page, and in
 * a dialog from "Add Public Note" / "Add Private Note" in the feed's Actions
 * menu. The docs used to describe the feed's own four-field modal and the
 * Notes page's old form (Public Incident Note, Posted At, Create from
 * Template, Generate with AI). These read the labels from the dashboard's
 * source and check every language's page tells the same story.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");
const CONTENT_DIR: string = path.join(REPO_ROOT, "App/FeatureSet/Docs/Content");
const EVENT_NOTES_DIR: string = path.join(
  REPO_ROOT,
  "App/FeatureSet/Dashboard/src/Components/EventNotes",
);

const PAGE: string = "incidents/notes-owners-and-feed.md";

const HEADING: RegExp = /^#{1,6} /;

function readPage(language: string): string {
  return fs.readFileSync(path.join(CONTENT_DIR, language, PAGE), "utf8");
}

function readComposerSource(file: string): string {
  return fs.readFileSync(path.join(EVENT_NOTES_DIR, file), "utf8");
}

const LANGUAGES: Array<string> = fs
  .readdirSync(CONTENT_DIR, { withFileTypes: true })
  .filter((entry: fs.Dirent): boolean => {
    return (
      entry.isDirectory() &&
      fs.existsSync(path.join(CONTENT_DIR, entry.name, PAGE))
    );
  })
  .map((entry: fs.Dirent): string => {
    return entry.name;
  })
  .sort();

// The composer's controls, as the source labels them.
const CONTROLS: Array<{ label: string; file: string; source: string }> = [
  {
    label: "Templates",
    file: "NoteTemplateMenu.tsx",
    source: 'tx("Templates")',
  },
  {
    label: "Draft with AI",
    file: "EventNoteComposer.tsx",
    source: 'tx("Draft with AI")',
  },
  { label: "Attach", file: "NoteComposer.tsx", source: 'tx("Attach")' },
  { label: "Posted now", file: "NoteComposer.tsx", source: 'tx("Posted now")' },
  {
    label: "Notify status page subscribers",
    file: "EventNoteComposer.tsx",
    source: 'translationKey("Notify status page subscribers")',
  },
  {
    label: "Post update",
    file: "EventNotesUtil.ts",
    source: 'translationKey("Post update")',
  },
  {
    label: "Add note",
    file: "EventNotesUtil.ts",
    source: 'translationKey("Add note")',
  },
];

/*
 * The feed's note actions and the composer's controls a feed bullet names,
 * in English: each language's page names them as its Dashboard draws them.
 */
const PUBLIC_ACTION: string = "Add Public Note";
const PRIVATE_ACTION: string = "Add Private Note";
const PUBLIC_BULLET_LABELS: Array<string> = [
  "Post update",
  "Posted now",
  "Draft with AI",
  "Notify status page subscribers",
  // The link as it reads on screen, beside the checkbox.
  "Preview",
];
const PRIVATE_BULLET_LABELS: Array<string> = ["Add note"];

type BoldFunction = (language: string, english: string) => string;

const bold: BoldFunction = (language: string, english: string): string => {
  return `**${dashboardLabel(language, english)}**`;
};

function bulletStartingWith(page: string, label: string): string {
  return (
    page.split("\n").find((line: string): boolean => {
      return line.startsWith(`- ${label}`);
    }) || ""
  );
}

describe("the composer's controls are what the docs call them", () => {
  test.each(CONTROLS)(
    "$label is the composer's own label",
    (control: { label: string; file: string; source: string }) => {
      expect(readComposerSource(control.file)).toContain(control.source);
    },
  );

  test("the labels the feed bullets name are the Dashboard's", () => {
    for (const label of [
      PUBLIC_ACTION,
      PRIVATE_ACTION,
      ...PUBLIC_BULLET_LABELS,
      ...PRIVATE_BULLET_LABELS,
    ]) {
      expect({ label, inDashboard: isDashboardLabel(label) }).toEqual({
        label,
        inDashboard: true,
      });
    }
  });

  test("every language's page is found", () => {
    expect(LANGUAGES).toContain("en");
    expect(LANGUAGES).toContain("fa");
    expect(LANGUAGES.length).toBe(17);
  });
});

describe.each(LANGUAGES)("%s: the feed's note actions", (language: string) => {
  const page: string = readPage(language);
  const publicNote: string = bulletStartingWith(
    page,
    bold(language, PUBLIC_ACTION),
  );
  const privateNote: string = bulletStartingWith(
    page,
    bold(language, PRIVATE_ACTION),
  );

  test("Add Public Note is the composer: posted with Post update, backdated from Posted now", () => {
    expect(publicNote).not.toBe("");

    for (const label of PUBLIC_BULLET_LABELS) {
      expect({
        label,
        named: publicNote.includes(bold(language, label)),
      }).toEqual({ label, named: true });
    }

    expect(publicNote).not.toContain("**Preview notification**");
  });

  test("Add Private Note is the composer: posted with Add note", () => {
    expect(privateNote).not.toBe("");

    for (const label of PRIVATE_BULLET_LABELS) {
      expect({
        label,
        named: privateNote.includes(bold(language, label)),
      }).toEqual({ label, named: true });
    }
  });

  test("no longer describes the feed's old four-field form", () => {
    for (const line of [publicNote, privateNote]) {
      expect(line).not.toMatch(
        /four|vier|fire|quatre|cuatro|quattro|quatro|fyra|четыре|चार|4 つ|네 개|四个|四個|چهار/,
      );
    }
  });
});

describe.each(["en", "fa"])(
  "%s: writing a note is described as the composer",
  (language: string) => {
    const page: string = readPage(language);

    test("the public note table lists the composer's controls, with no Posted At or old form fields", () => {
      for (const label of [
        "Templates",
        "Draft with AI",
        "Attach",
        "Posted now",
        "Notify status page subscribers",
      ]) {
        expect(page).toContain(`| **${label}**`);
      }

      expect(page).not.toContain("| **Posted At**");
      expect(page).not.toContain("**Public Incident Note**");
      expect(page).not.toContain("**Private Incident Note**");
      expect(page).not.toContain("**Create from Template**");
      expect(page).not.toContain("**Generate with AI**");
    });

    test("says the same composer opens from the feed", () => {
      expect(page).toContain("**Add Public Note**");
      expect(page).toContain("**Add Private Note**");
      expect(page).toContain("**Post update**");
    });

    test("every link to a section of this page lands on a heading", () => {
      const slugs: Set<string> = new Set<string>(
        page
          .split("\n")
          .filter((line: string): boolean => {
            return HEADING.test(line);
          })
          .map((line: string): string => {
            return slugify(line.replace(HEADING, ""));
          }),
      );
      const anchors: Array<string> = Array.from(
        page.matchAll(/\]\(#([^)]+)\)/g),
      ).map((match: RegExpMatchArray): string => {
        return match[1] as string;
      });

      expect(anchors.length).toBeGreaterThanOrEqual(3);

      for (const anchor of anchors) {
        expect({ anchor, found: slugs.has(anchor) }).toEqual({
          anchor,
          found: true,
        });
      }
    });
  },
);
