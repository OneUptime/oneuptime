// UX rule: Docs/ux/README.md#in-every-language
import {
  ADMIN_DASHBOARD_SOURCE,
  REPOSITORY_ROOT,
  readAdminLocale,
} from "./AdminOwnPagesStrings";
import {
  UnseenText,
  findUnseenTexts,
  findUnseenTextsIn,
  readEnglishTexts,
} from "./AdminUnseenTexts";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * NO SENTENCE ON THE ADMIN'S PAGES IS HIDDEN FROM THE LOCALES (#8636).
 *
 * The string extractor finds a text by where it stands. One kept in a
 * variable first, or handed to a prop it does not know, has no entry, and
 * the page reads it in English: the bulk actions' "Block" and "Unblock",
 * the Feedback and Push Notifications switches' cards, the Telegram form's
 * messages, the Enterprise health pages' tile lines and job details. Each is
 * a key now - translationKey("...") where it is written, or a lookup where
 * it is drawn - and has an entry in all 18 locales.
 *
 * This reads every string literal of the Admin's src, and of
 * ee/AdminDashboard when the checkout has it (AdminUnseenTexts.ts): one that
 * reads as words and that English does not hold is named. What stays is
 * below, each with the reason it is not a person's words.
 */

const ENGLISH: Set<string> = readEnglishTexts(readAdminLocale("en"));

const ENTERPRISE_SOURCE: string = path.join(
  REPOSITORY_ROOT,
  "ee",
  "AdminDashboard",
);

const ENTERPRISE_PRESENT: boolean = fs.existsSync(ENTERPRISE_SOURCE);

// What reads as words but is no text a person reads, by file and text.
const NOT_A_PERSONS_WORDS: Readonly<Record<string, Record<string, string>>> = {
  "packages/App/FeatureSet/AdminDashboard/src/Components/User/BulkAddUsersToProject.ts":
    {
      "User ID not found.":
        "an invariant thrown when a row comes back without its id",
    },
  "packages/App/FeatureSet/AdminDashboard/src/Pages/Projects/Index.tsx": {
    "Project ID not found":
      "an invariant thrown when a row comes back without its id",
  },
  "packages/App/FeatureSet/AdminDashboard/src/Pages/Users/Index.tsx": {
    "User ID not found":
      "an invariant thrown when a row comes back without its id",
  },
  "packages/App/FeatureSet/AdminDashboard/src/Pages/Projects/View/TeamView.tsx":
    {
      "Project ID cannot be null":
        "an invariant thrown before a page with no project id loads",
    },
  "packages/App/FeatureSet/AdminDashboard/src/Pages/Projects/View/Teams.tsx": {
    "Project ID cannot be null":
      "an invariant thrown before a page with no project id loads",
  },
  "packages/App/FeatureSet/AdminDashboard/src/Pages/Projects/View/UserView.tsx":
    {
      "Project ID cannot be null":
        "an invariant thrown before a page with no project id loads",
    },
};

// The Enterprise pages' code, names and values that read as words.
const ENTERPRISE_NOT_A_PERSONS_WORDS: Readonly<
  Record<string, Record<string, string>>
> = {
  "ee/AdminDashboard/Backups/BackupRunsTable.tsx": {
    "Settings > Backups": "a table's analytics name",
    "Settings > Backups > Restores": "a table's analytics name",
  },
  "ee/AdminDashboard/Backups/BackupSettingsFormModal.tsx": {
    "Settings > Backups > Edit Backup Settings": "a form's analytics name",
    "Settings > Backups > Set Up Backups": "a form's analytics name",
  },
  "ee/AdminDashboard/EnterpriseLicenses/Components/OfflineLicenseTokenCard.tsx":
    {
      "Offline License Token": "a form's analytics name (formProps.name)",
    },
  "ee/AdminDashboard/EnterpriseLicenses/Components/useLicenseBulkActions.tsx": {
    "Item ID not found":
      "an invariant thrown when a row comes back without its id",
    "Change Enterprise License Expiry Date":
      "a form's analytics name (formProps.name)",
  },
  "ee/AdminDashboard/WhiteLabel/WhiteLabelProductNameCard.tsx": {
    "White Label Product Name": "a form's analytics name (formProps.name)",
  },
  "ee/AdminDashboard/License/LicenseDetails.tsx": {
    "Expand OneUptime license - over seat limit":
      "the subject of an email to OneUptime's sales team, written in English",
    "Expand OneUptime license - nearly out of seats":
      "the subject of an email to OneUptime's sales team, written in English",
    "Hi OneUptime,":
      "the body of an email to OneUptime's sales team, written in English",
    "We would like to expand the seat count on our enterprise license.":
      "the body of an email to OneUptime's sales team, written in English",
  },
  "ee/AdminDashboard/License/LicenseStatus.ts": {
    "The OneUptime Enterprise license has expired.":
      "a message the server sends, matched to leave out what the page already says",
    "No OneUptime Enterprise license is installed.":
      "a message the server sends, matched to leave out what the page already says",
  },
  "ee/AdminDashboard/Health/QueryConsole.tsx": {
    "SELECT pg_size_pretty(pg_database_size(current_database())) AS size;":
      "an example query, run as written",
    "SELECT relname AS table, pg_size_pretty(pg_total_relation_size(relid)) AS size\nFROM pg_stat_user_tables\nORDER BY pg_total_relation_size(relid) DESC\nLIMIT 20;":
      "an example query, run as written",
    "SELECT state, count(*)\nFROM pg_stat_activity\nWHERE datname = current_database()\nGROUP BY state\nORDER BY count DESC;":
      "an example query, run as written",
    "SELECT table_name\nFROM information_schema.tables\nWHERE table_schema = 'public'\nORDER BY table_name;":
      "an example query, run as written",
    "SELECT name, engine, total_rows, formatReadableSize(total_bytes) AS size\nFROM system.tables\nWHERE database = currentDatabase()\nORDER BY total_bytes DESC;":
      "an example query, run as written",
    "SELECT table, count() AS parts, formatReadableSize(sum(bytes_on_disk)) AS size\nFROM system.parts\nWHERE active\nGROUP BY table\nORDER BY sum(bytes_on_disk) DESC\nLIMIT 20;":
      "an example query, run as written",
    "SELECT name, code, value AS count, last_error_time\nFROM system.errors\nWHERE value > 0\nORDER BY last_error_time DESC\nLIMIT 20;":
      "an example query, run as written",
    "SELECT version();": "an example query, run as written",
    "INFO server": "an example Valkey command, run as written",
    "INFO memory": "an example Valkey command, run as written",
    "SCAN 0 COUNT 50": "an example Valkey command, run as written",
  },
  "ee/AdminDashboard/Health/PostgresCluster.tsx": {
    "CREATE EXTENSION pg_stat_statements;": "a SQL command, run as written",
  },
};

/*
 * Long-form copy still read in English, being translated as documents of
 * their own (#8677): the Telegram and WhatsApp setup guides. The health
 * tooltips' explanations are keys now. The list only shrinks.
 */
const LONG_FORM_COPY_LEFT: ReadonlyArray<string> = [
  "packages/App/FeatureSet/AdminDashboard/src/Pages/Settings/Telegram/TelegramSetupGuide.ts",
  "packages/App/FeatureSet/AdminDashboard/src/Pages/Settings/WhatsApp/Index.tsx",
];

const describeText: (text: UnseenText) => string = (
  text: UnseenText,
): string => {
  return `${text.file}:${text.line} ${JSON.stringify(text.text)}`;
};

// What is left once the reviewed values and the long-form copy are set aside.
const unexplained: (
  found: Array<UnseenText>,
  reviewed: Readonly<Record<string, Record<string, string>>>,
) => Array<string> = (
  found: Array<UnseenText>,
  reviewed: Readonly<Record<string, Record<string, string>>>,
): Array<string> => {
  return found
    .filter((text: UnseenText): boolean => {
      if (reviewed[text.file]?.[text.text] !== undefined) {
        return false;
      }

      return !LONG_FORM_COPY_LEFT.some((entry: string): boolean => {
        const [file, part] = entry.split("#");

        if (file !== text.file) {
          return false;
        }

        return part === undefined || isMetricExplanation(text);
      });
    })
    .map(describeText);
};

const BODY_LINE: RegExp = /^\s*body:/;

const BODY_KEY_ALONE: RegExp = /^\s*body:\s*$/;

// A health tooltip's explanation: a long sentence in a METRIC_INFO body.
const isMetricExplanation: (text: UnseenText) => boolean = (
  text: UnseenText,
): boolean => {
  const source: string = fs.readFileSync(
    path.join(REPOSITORY_ROOT, text.file),
    "utf8",
  );
  const line: string = source.split("\n")[text.line - 1] || "";
  const before: string = source.split("\n")[text.line - 2] || "";

  return BODY_LINE.test(line) || BODY_KEY_ALONE.test(before);
};

describe("the Admin Dashboard's own pages", () => {
  test("hold no sentence the locales cannot see: each is a key, or a value with its reason", () => {
    expect(
      unexplained(
        findUnseenTexts(REPOSITORY_ROOT, ADMIN_DASHBOARD_SOURCE, ENGLISH),
        NOT_A_PERSONS_WORDS,
      ),
    ).toEqual([]);
  });

  test("every reviewed value is still in its file, with its reason", () => {
    const found: Array<UnseenText> = findUnseenTexts(
      REPOSITORY_ROOT,
      ADMIN_DASHBOARD_SOURCE,
      ENGLISH,
    );

    for (const [file, texts] of Object.entries(NOT_A_PERSONS_WORDS)) {
      for (const [text, why] of Object.entries(texts)) {
        expect({
          file,
          text,
          found: found.some((unseen: UnseenText): boolean => {
            return unseen.file === file && unseen.text === text;
          }),
          explained: why.length > 15,
        }).toEqual({ file, text, found: true, explained: true });
      }
    }
  });
});

(ENTERPRISE_PRESENT ? describe : describe.skip)(
  "the Enterprise Edition's admin pages",
  () => {
    test("hold no sentence the locales cannot see, beyond the long-form copy left", () => {
      expect(
        unexplained(
          findUnseenTexts(REPOSITORY_ROOT, ENTERPRISE_SOURCE, ENGLISH),
          ENTERPRISE_NOT_A_PERSONS_WORDS,
        ),
      ).toEqual([]);
    });
  },
);

describe("what the guard names", () => {
  const FILE: string =
    "packages/App/FeatureSet/AdminDashboard/src/Pages/Fixture.tsx";

  test("a sentence kept in a variable and handed to a prop the extractor does not know", () => {
    expect(
      findUnseenTextsIn(
        FILE,
        [
          'const label: string = isBlocked ? "Block all" : "Unblock all";',
          'const card = <ModelSwitchCard cardTitle="Ask Everyone Here" />;',
        ].join("\n"),
        ENGLISH,
      ).map((text: UnseenText): string => {
        return text.text;
      }),
    ).toEqual(["Block all", "Unblock all", "Ask Everyone Here"]);
  });

  test("nothing English holds, and no code", () => {
    expect(
      findUnseenTextsIn(
        FILE,
        [
          'import Page from "Common/UI/Components/Page/Page";',
          'const a = translationKey("Block");',
          'const b = <div className="Flex Items" data-testid="A B" />;',
          'if (state === "Not Started Yet") {}',
          'enum Kind { First = "First Kind" }',
          'const c = { "Some Key": 1 };',
        ].join("\n"),
        ENGLISH,
      ),
    ).toEqual([]);
  });

  test("its lists name long-form copy that is still there", () => {
    for (const entry of LONG_FORM_COPY_LEFT) {
      const [file] = entry.split("#");

      if (file!.startsWith("ee/") && !ENTERPRISE_PRESENT) {
        continue;
      }

      expect(fs.existsSync(path.join(REPOSITORY_ROOT, file!))).toBe(true);
    }
  });
});
