import {
  FormColumnDescription,
  FormColumnDescriptionFinder,
} from "../../FeatureSet/Dashboard/scripts/i18n/FormColumnDescriptions";
import {
  listSourceFiles,
  SOURCE_ROOTS,
  SourceRoot,
} from "../../FeatureSet/Dashboard/scripts/i18n/ExtractStrings";
import {
  LocaleProgress,
  readGlobalSameAsEnglish,
  readLocaleProgress,
} from "../../FeatureSet/Dashboard/scripts/i18n/LocaleStatus";
import {
  FoundDescription,
  REPO_ROOT,
  scanProductDescriptions,
} from "./DescriptionScan";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * THE HELP UNDER A FORM FIELD IS IN THE READER'S LANGUAGE.
 *
 * "About 480 column descriptions that say more are still English" (the
 * maintainer's follow-ups, #5292). A form field with no description of its
 * own shows its model column's (BasicModelForm), and FieldLabel looks it up
 * in the locales of the frontend that draws the form. No locale had them:
 * the extractor never read a column's description, so every rule form's
 * "Leave empty to match any title." and every incident form's "List of
 * services affected by this incident." stayed English in sixteen
 * languages - on the status page's subscribe forms and the Admin
 * Dashboard's license forms too.
 *
 * The extractor now takes the descriptions a form draws (its "column" kind,
 * FormColumnDescriptions). Held here, against DescriptionScan's own reading
 * of the same forms (kind "column"):
 *
 *   - each such description is a key of the frontend that draws it, in all
 *     seventeen languages, translated in the sixteen besides English with
 *     its placeholders kept;
 *   - the extractor finds the same fields DescriptionScan does, file by
 *     file, so a form field added later reaches the locales or fails here.
 */

const FEATURE_SET: string = path.join(
  REPO_ROOT,
  "packages",
  "App",
  "FeatureSet",
);

const TRANSLATED_LANGUAGES: ReadonlyArray<string> = [
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "nl",
  "da",
  "no",
  "sv",
  "ru",
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
  "hi",
  "fa",
];

// Which frontend's locales a form found under each path looks its words up in.
const FRONTEND_OF_PATH: ReadonlyArray<{ prefix: string; frontend: string }> = [
  { prefix: "packages/App/FeatureSet/Dashboard/", frontend: "Dashboard" },
  { prefix: "packages/Common/UI/", frontend: "Dashboard" },
  { prefix: "ee/Dashboard/", frontend: "Dashboard" },
  {
    prefix: "packages/App/FeatureSet/AdminDashboard/",
    frontend: "AdminDashboard",
  },
  { prefix: "ee/AdminDashboard/", frontend: "AdminDashboard" },
  { prefix: "packages/App/FeatureSet/StatusPage/", frontend: "StatusPage" },
  { prefix: "packages/App/FeatureSet/Accounts/", frontend: "Accounts" },
  {
    prefix: "packages/App/FeatureSet/PublicDashboard/",
    frontend: "PublicDashboard",
  },
];

// The two trees the extractor's column pass and DescriptionScan both read whole.
const SHARED_TREES: ReadonlyArray<string> = [
  "packages/App/FeatureSet/Dashboard/src/",
  "packages/Common/UI/",
];

const PLACEHOLDER: RegExp = /\{\{[^{}]{1,40}\}\}/g;

const COLUMN_DESCRIPTIONS: Array<FoundDescription> =
  scanProductDescriptions().filter((description: FoundDescription): boolean => {
    return description.kind === "column";
  });

function fileOf(where: string): string {
  return where.replace(/:\d+$/, "");
}

function frontendOf(where: string): string | null {
  return (
    FRONTEND_OF_PATH.find((entry: { prefix: string }): boolean => {
      return where.startsWith(entry.prefix);
    })?.frontend || null
  );
}

const localeCache: Map<string, Record<string, unknown>> = new Map<
  string,
  Record<string, unknown>
>();

function readLocale(
  frontend: string,
  language: string,
): Record<string, unknown> {
  const file: string = path.join(
    FEATURE_SET,
    frontend,
    "src",
    "Locales",
    `${language}.json`,
  );
  let locale: Record<string, unknown> | undefined = localeCache.get(file);

  if (!locale) {
    locale = JSON.parse(fs.readFileSync(file, "utf8")) as Record<
      string,
      unknown
    >;
    localeCache.set(file, locale);
  }

  return locale;
}

function placeholdersOf(text: string): Array<string> {
  return (text.match(PLACEHOLDER) || []).sort();
}

// The Dashboard's words that read the same as English in a language, on purpose.
const globalSameAsEnglish: Set<string> = new Set<string>(
  readGlobalSameAsEnglish(),
);

function isSameOnPurpose(
  frontend: string,
  language: string,
  english: string,
): boolean {
  if (frontend !== "Dashboard") {
    return false;
  }

  const progress: LocaleProgress | undefined = readLocaleProgress(language);

  return (
    globalSameAsEnglish.has(english) ||
    Boolean(progress && progress.sameAsEnglish.includes(english))
  );
}

// "file -> its column descriptions, sorted", one entry per field.
function byFile(
  entries: ReadonlyArray<{ file: string; text: string }>,
): Record<string, Array<string>> {
  const files: Record<string, Array<string>> = {};

  for (const entry of entries) {
    const texts: Array<string> = files[entry.file] || [];

    texts.push(entry.text);
    files[entry.file] = texts;
  }

  for (const texts of Object.values(files)) {
    texts.sort();
  }

  return files;
}

describe("the column descriptions forms draw are in every frontend's locales", () => {
  test("the scan finds the forms that draw them, in more than one frontend", () => {
    /*
     * About 170 fields: the 480 of #5292 counted a rule's match conditions
     * too, which the conditions builder draws in their place, help and all
     * (RuleCriteriaModelForm).
     */
    expect(COLUMN_DESCRIPTIONS.length).toBeGreaterThan(150);

    const frontends: Set<string | null> = new Set<string | null>(
      COLUMN_DESCRIPTIONS.map((description: FoundDescription) => {
        return frontendOf(description.where);
      }),
    );

    /*
     * The status page's subscriber forms draw none: their fields say what
     * they are in the reader's words, and the model's column help ("Phone
     * number of subscriber") is the API's (hideColumnDescription).
     */
    expect(Array.from(frontends).sort()).toEqual(
      expect.arrayContaining(["AdminDashboard", "Dashboard"]),
    );
  });

  /*
   * Column help a form's field said nothing with, in any language: the
   * field's name again ("Status Page Favicon" under Favicon), the API's
   * words ("Relation to the Network Device this link starts from" under
   * From Device, "Phone number of subscriber" on a subscriber's own form),
   * a name the product no longer uses (a Runner's "agent"), or English
   * that was never right ("this event event is changed to ongoing?"). Each
   * field says nothing more now (hideColumnDescription), or, for a
   * template's "When the event is scheduled", what the event's own Create
   * form says (UI review of #5512).
   */
  test("help that only repeats its field, or is the API's, is drawn by no form", () => {
    const REPEATING: ReadonlyArray<string> = [
      "Status Page Cover Image",
      "Status Page Favicon",
      "Dashboard Favicon",
      "Copyright Text",
      "Relation to the Network Device this link starts from",
      "Relation to the Network Device this link ends at",
      "Relation to the Network Site this link starts from",
      "Relation to the Network Site this link ends at",
      "Optional description for this agent",
      "Should subscribers be notified about this event creation?",
      "Should subscribers be notified about this event event is changed to ongoing?",
      "Should subscribers be notified about this event event is changed to ended?",
      "Phone number of subscriber",
      "Email address of the subscriber.",
      "Name of the Slack workspace for validation and identification",
    ];

    expect(
      COLUMN_DESCRIPTIONS.filter((description: FoundDescription): boolean => {
        return REPEATING.includes(description.text);
      }).map((description: FoundDescription): string => {
        return `${description.where}: ${description.text}`;
      }),
    ).toEqual([]);
  });

  test("each is drawn by a frontend with locales of its own", () => {
    expect(
      COLUMN_DESCRIPTIONS.filter((description: FoundDescription): boolean => {
        return frontendOf(description.where) === null;
      }).map((description: FoundDescription): string => {
        return `${description.where}: add its frontend to FRONTEND_OF_PATH`;
      }),
    ).toEqual([]);
  });

  test("each is a key of the frontend that draws it, in English", () => {
    expect(
      COLUMN_DESCRIPTIONS.filter((description: FoundDescription): boolean => {
        const frontend: string | null = frontendOf(description.where);

        return (
          frontend !== null &&
          readLocale(frontend, "en")[description.text] !== description.text
        );
      }).map((description: FoundDescription): string => {
        return `${description.where}: "${description.text}" is not a key of ${frontendOf(description.where)}'s en.json`;
      }),
    ).toEqual([]);
  });

  test.each(TRANSLATED_LANGUAGES)(
    "%s has each in its own words, placeholders kept",
    (language: string) => {
      const problems: Set<string> = new Set<string>();

      for (const description of COLUMN_DESCRIPTIONS) {
        const frontend: string | null = frontendOf(description.where);

        if (!frontend) {
          continue;
        }

        const value: unknown = readLocale(frontend, language)[description.text];

        if (typeof value !== "string") {
          problems.add(`${frontend}: no "${description.text}"`);
        } else if (
          value === description.text &&
          !isSameOnPurpose(frontend, language, description.text)
        ) {
          problems.add(`${frontend}: "${description.text}" is still English`);
        } else if (
          placeholdersOf(value).join() !==
          placeholdersOf(description.text).join()
        ) {
          problems.add(
            `${frontend}: "${description.text}" lost a placeholder: ${value}`,
          );
        }
      }

      expect(Array.from(problems).sort()).toEqual([]);
    },
  );
});

describe("the extractor reads the same form fields DescriptionScan does", () => {
  const finder: FormColumnDescriptionFinder = new FormColumnDescriptionFinder(
    REPO_ROOT,
  );
  const extracted: Array<FormColumnDescription> = SOURCE_ROOTS.filter(
    (root: SourceRoot): boolean => {
      return root.kind === "ui";
    },
  ).flatMap((root: SourceRoot): Array<FormColumnDescription> => {
    return listSourceFiles(path.join(REPO_ROOT, root.directory)).flatMap(
      (file: string): Array<FormColumnDescription> => {
        return finder.find(file, fs.readFileSync(file, "utf8"));
      },
    );
  });

  function isShared(file: string): boolean {
    return SHARED_TREES.some((tree: string): boolean => {
      return file.startsWith(tree);
    });
  }

  test("finds the fields of the Dashboard's forms", () => {
    expect(extracted.length).toBeGreaterThan(150);
    expect(
      extracted.every((field: FormColumnDescription): boolean => {
        return field.text.length > 0 && field.model.length > 0;
      }),
    ).toBe(true);
  });

  test("file by file, the same fields with the same descriptions", () => {
    const fromScan: Record<string, Array<string>> = byFile(
      COLUMN_DESCRIPTIONS.filter((description: FoundDescription): boolean => {
        return isShared(description.where);
      }).map((description: FoundDescription) => {
        return { file: fileOf(description.where), text: description.text };
      }),
    );
    const fromExtractor: Record<string, Array<string>> = byFile(
      extracted.filter((field: FormColumnDescription): boolean => {
        return isShared(field.file);
      }),
    );

    expect(fromExtractor).toEqual(fromScan);
  });

  test("outside those trees, every field it finds is a Dashboard key too", () => {
    const english: Record<string, unknown> = readLocale("Dashboard", "en");

    expect(
      extracted
        .filter((field: FormColumnDescription): boolean => {
          return !isShared(field.file) && english[field.text] !== field.text;
        })
        .map((field: FormColumnDescription): string => {
          return `${field.file}:${field.line} "${field.text}"`;
        }),
    ).toEqual([]);
  });
});
