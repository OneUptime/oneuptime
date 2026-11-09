import {
  ExtractedString,
  scanSourceRoots,
  SourceRoot,
} from "../../FeatureSet/Dashboard/scripts/i18n/ExtractStrings";
import {
  LOCALES_DIRECTORY,
  TRANSLATED_LOCALES,
} from "../../FeatureSet/Dashboard/scripts/i18n/LocaleFiles";
import {
  LocaleProgress,
  readGlobalSameAsEnglish,
  readLocaleProgress,
} from "../../FeatureSet/Dashboard/scripts/i18n/LocaleStatus";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * PUBLIC NOTE APPROVAL IN THE READER'S LANGUAGE (#5720).
 *
 * Public note approval shipped with its words in English in all sixteen
 * languages besides English: a German project admin found Genehmigung
 * nowhere on a page called Public Note Approval, among translated menus, and
 * the Notification Settings card asking to be told about notes that wait
 * read in English among German ones (BreadcrumbTitlesAreKeys and
 * TranslationBacklogNextLocales flagged two of them). Every word the
 * approval screens draw - the settings pages and their steps, the note's
 * approval panel, the composer's notice, the approval's notification
 * settings, the breadcrumb, the columns the API and the tables name - is
 * worded now in each language, as the toolchain counts it (`npm run
 * i18n:check`): a value of its own, or the same English the language keeps
 * on purpose, or text with no words, or a "one" form a language never
 * reads.
 *
 * A word added to these screens later is translated with it, or fails here.
 */

const APPROVAL_ROOTS: Array<SourceRoot> = [
  // The settings pages: the switch, the steps and who each names.
  {
    directory:
      "packages/App/FeatureSet/Dashboard/src/Components/PublicNoteApproval",
    kind: "ui",
  },
  {
    directory:
      "packages/App/FeatureSet/Dashboard/src/Pages/Incidents/Settings/IncidentPublicNoteApproval.tsx",
    kind: "ui",
  },
  {
    directory:
      "packages/App/FeatureSet/Dashboard/src/Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenancePublicNoteApproval.tsx",
    kind: "ui",
  },
  // A note's approval panel and the words it is drawn with.
  {
    directory:
      "packages/App/FeatureSet/Dashboard/src/Components/EventNotes/PublicNoteApproval",
    kind: "ui",
  },
];

/*
 * The approval's words drawn by screens it shares with everything else: the
 * notification settings it adds, its menu item and breadcrumb, and the
 * columns it adds to notes, steps and projects.
 */
const SHARED_KEYS: ReadonlyArray<string> = [
  "Public Note Approval",
  "Public note waiting for my approval",
  "A public note on an incident, episode or maintenance event waits for you, or a team you are on, to approve it. It reaches status pages and subscribers only once it is approved.",
  "My public note approved or rejected",
  "A public note you sent for approval is approved and published, or rejected with a reason.",
  "Notify me about public notes that wait for approval before they are published on status pages.",
  "Public Note Approval Step",
  "Public Note Approval Steps",
  "Who approves public notes before they are published on status pages and sent to subscribers, step by step",
  "Approver Teams",
  "Approval Status",
  "Is Published",
  "Edit Waiting for Approval",
  "Require Approval for Incident Public Notes",
  "Require Approval for Scheduled Maintenance Public Notes",
  "Status update sent for approval, not published yet",
];

// Languages whose plurals have no "one" form: their "_one" key is never read.
const LANGUAGES_WITHOUT_ONE: ReadonlyArray<string> = [
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
];

const PLACEHOLDER: RegExp = /\{\{\s*[\w.]+\s*\}\}/g;
const LETTER: RegExp = /\p{L}/u;

function readLocale(language: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIRECTORY, `${language}.json`), "utf8"),
  ) as Record<string, unknown>;
}

const ENGLISH: Record<string, unknown> = readLocale("en");
const GLOBAL_SAME_AS_ENGLISH: Set<string> = new Set<string>(
  readGlobalSameAsEnglish(),
);

interface ApprovalKey {
  key: string;
  file: string;
}

// Every key the approval screens read: each text, and a plural's "one" form.
function getApprovalKeys(): Array<ApprovalKey> {
  const keys: Map<string, string> = new Map<string, string>();

  for (const entry of scanSourceRoots(APPROVAL_ROOTS).strings) {
    if (entry.nestedPath) {
      continue;
    }

    const found: ExtractedString = entry;

    if (!keys.has(found.text)) {
      keys.set(found.text, found.file);
    }

    if (found.pluralOne !== undefined && !keys.has(`${found.text}_one`)) {
      keys.set(`${found.text}_one`, found.file);
    }
  }

  for (const key of SHARED_KEYS) {
    if (!keys.has(key)) {
      keys.set(key, "shared screens");
    }
  }

  return Array.from(keys.entries()).map(
    ([key, file]: [string, string]): ApprovalKey => {
      return { key, file };
    },
  );
}

const APPROVAL_KEYS: Array<ApprovalKey> = getApprovalKeys();

// Whether `language` words `key` its own way, as npm run i18n:check counts it.
function isWorded(data: {
  key: string;
  language: string;
  locale: Record<string, unknown>;
  sameAsEnglish: Set<string>;
}): boolean {
  const english: unknown = ENGLISH[data.key];
  const value: unknown = data.locale[data.key];

  if (typeof english !== "string" || typeof value !== "string") {
    return false;
  }

  if (!value.trim()) {
    return false;
  }

  if (value !== english) {
    return true;
  }

  if (
    data.key.endsWith("_one") &&
    LANGUAGES_WITHOUT_ONE.includes(data.language)
  ) {
    return true;
  }

  if (!LETTER.test(english.replace(PLACEHOLDER, ""))) {
    return true;
  }

  return GLOBAL_SAME_AS_ENGLISH.has(english) || data.sameAsEnglish.has(english);
}

describe("public note approval's words in every language", () => {
  test("the approval screens draw words, every one of them an English key", () => {
    expect(APPROVAL_KEYS.length).toBeGreaterThan(60);
    expect(
      APPROVAL_KEYS.filter((entry: ApprovalKey): boolean => {
        return typeof ENGLISH[entry.key] !== "string";
      }),
    ).toEqual([]);

    const keys: Set<string> = new Set<string>(
      APPROVAL_KEYS.map((entry: ApprovalKey): string => {
        return entry.key;
      }),
    );

    // The scan reads the screens: words each of them draws, among them.
    for (const key of [
      "Require approval before public notes are published",
      "Approval Steps",
      "Send for approval",
      "Waiting for {{approvers}}",
      "Withdraw edit",
      "Publish now",
      "Why are you rejecting it?",
    ]) {
      expect(keys.has(key)).toBe(true);
    }
  });

  test.each(TRANSLATED_LOCALES)(
    "%s words every one of them",
    (language: string) => {
      const progress: LocaleProgress | undefined = readLocaleProgress(language);
      const sameAsEnglish: Set<string> = new Set<string>(
        progress ? progress.sameAsEnglish : [],
      );
      const locale: Record<string, unknown> = readLocale(language);

      const unworded: Array<string> = APPROVAL_KEYS.filter(
        (entry: ApprovalKey): boolean => {
          return !isWorded({
            key: entry.key,
            language,
            locale,
            sameAsEnglish,
          });
        },
      ).map((entry: ApprovalKey): string => {
        return `${entry.key} (${path.basename(entry.file)})`;
      });

      expect(unworded).toEqual([]);
    },
  );

  /*
   * The menu path a step with nobody on it sends a project admin to names
   * the menu as each language draws it: its Settings section, then the
   * page's own name.
   */
  test.each(TRANSLATED_LOCALES)(
    "%s names the settings page as its menu does",
    (language: string) => {
      const locale: Record<string, unknown> = readLocale(language);
      const sentence: string = String(
        locale[
          "Nobody can approve this step yet. A project admin can add approvers in Settings > Public Note Approval."
        ],
      );

      expect(sentence).toContain(
        `${String(locale["Settings"])} > ${String(locale["Public Note Approval"])}`,
      );
    },
  );
});
