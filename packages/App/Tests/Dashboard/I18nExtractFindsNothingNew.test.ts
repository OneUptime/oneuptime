import { afterEach, describe, expect, test } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";
import {
  ExtractedString,
  scanSourceText,
} from "../../FeatureSet/Dashboard/scripts/i18n/ExtractStrings";
import {
  ExtractSummary,
  getDefaultContext,
  I18nContext,
  runExtract,
} from "../../FeatureSet/Dashboard/scripts/i18n/I18n";
import {
  LocaleTree,
  serializeLocale,
} from "../../FeatureSet/Dashboard/scripts/i18n/LocaleFiles";
import {
  getLocaleStatus,
  LocaleStatus,
  readGlobalSameAsEnglish,
  readLocaleProgress,
} from "../../FeatureSet/Dashboard/scripts/i18n/LocaleStatus";

/*
 * EVERY STRING THE SOURCES GIVE IS ALREADY IN THE LOCALE FILES (#6913).
 *
 * npm run i18n:extract reads the Dashboard's sources - its pages, Common's
 * UI, the database and analytics models' names and column titles - and adds
 * what en.json lacks, in English, to every locale file. A pull request that
 * adds a user-facing string without running it leaves the string out of
 * every locale, and the next pull request that runs it adds the string in
 * English to every locale: to ar.json, where ArabicLocaleGuards holds Arabic
 * at nothing untranslated, and to every other locale's ratchet. Many pull
 * requests run it, since the locale README has everyone run it to resolve a
 * locale merge conflict. PR #6894 added the Project Milestone model that
 * way, and after #6923 ran the extractor main's Arabic was English in six
 * places.
 *
 * Here the extractor runs over the repository as the command does, writing
 * nothing, and must find nothing to add. The pull request that adds a string
 * runs it, and words the new keys in every locale, in its own diff.
 */

const FIX: string =
  "Run `npm run i18n:extract` in packages/App/FeatureSet/Dashboard, word the keys it adds in every locale (src/Locales/README.md), and commit src/Locales/*.json with the code that added them.";

const DEFAULT_CONTEXT: I18nContext = getDefaultContext();

// The extractor as npm run i18n:extract runs it, its report kept.
function quietContext(
  overrides: Partial<I18nContext>,
  printed: Array<string>,
): I18nContext {
  return {
    ...DEFAULT_CONTEXT,
    // A locale file with conflict markers is read from them, not from git.
    readStage: (): undefined => {
      return undefined;
    },
    write: (text: string): void => {
      printed.push(text);
    },
    ...overrides,
  };
}

// What a dry run would change: nothing, on a tree whose locales are current.
function changesOf(summary: ExtractSummary): {
  fix: string;
  addedKeys: Array<string>;
  addedNestedKeys: Array<string>;
  updatedPluralForms: Array<string>;
  localesGivenEnglishPlaceholders: Array<string>;
  localesHoldingKeysEnglishDropped: Array<string>;
  resolvedConflicts: Array<string>;
} {
  return {
    fix: FIX,
    addedKeys: summary.addedKeys,
    addedNestedKeys: summary.addedNestedKeys,
    updatedPluralForms: summary.updatedPluralForms,
    localesGivenEnglishPlaceholders: Object.keys(
      summary.placeholdersAdded,
    ).filter((code: string): boolean => {
      return (summary.placeholdersAdded[code] || 0) > 0;
    }),
    localesHoldingKeysEnglishDropped: Object.keys(summary.removedKeys).filter(
      (code: string): boolean => {
        return (summary.removedKeys[code] || []).length > 0;
      },
    ),
    resolvedConflicts: summary.resolvedConflicts,
  };
}

const NOTHING_TO_CHANGE: ReturnType<typeof changesOf> = {
  fix: FIX,
  addedKeys: [],
  addedNestedKeys: [],
  updatedPluralForms: [],
  localesGivenEnglishPlaceholders: [],
  localesHoldingKeysEnglishDropped: [],
  resolvedConflicts: [],
};

describe("npm run i18n:extract over the repository", () => {
  /*
   * The whole scan: some 20 seconds on a development machine, minutes on a
   * slow runner.
   */
  const WHOLE_SCAN_TIMEOUT_IN_MS: number = 600000;

  test(
    "finds no string the locale files lack, and would change no locale file",
    () => {
      const printed: Array<string> = [];
      const summary: ExtractSummary = runExtract(quietContext({}, printed), {
        dryRun: true,
      });

      // It read the sources: the Dashboard's tens of thousands of strings.
      expect(summary.scannedStrings).toBeGreaterThan(10000);
      expect(DEFAULT_CONTEXT.locales.length).toBeGreaterThanOrEqual(17);
      // A dry run writes nothing.
      expect(summary.changedFiles).toEqual([]);
      expect(printed.join("")).toContain("Dry run: nothing written.");

      expect(changesOf(summary)).toEqual(NOTHING_TO_CHANGE);
    },
    WHOLE_SCAN_TIMEOUT_IN_MS,
  );
});

/*
 * The model of #6894, read alone: what the check above holds every source
 * to, on the source that got past it.
 */
const PROJECT_MILESTONE_MODEL: string =
  "packages/Common/Models/DatabaseModels/ProjectMilestone.ts";

// The model's words the extractor reads: its names, column titles and description.
const PROJECT_MILESTONE_KEYS: Array<string> = [
  "Milestone",
  "Project Milestone",
  "Project Milestones",
  "Reached At",
  "Was Backfilled",
  "When a project first reached each activation milestone: its first monitor, check result, on-call page delivered, second member, status page with a monitor, telemetry of each kind and more.",
].sort();

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function readLocale(code: string): LocaleTree {
  return readJson(
    path.join(DEFAULT_CONTEXT.localesDirectory, `${code}.json`),
  ) as LocaleTree;
}

describe("the Project Milestone model's words (#6894, #6913)", () => {
  let scratch: string = "";

  afterEach(() => {
    if (scratch) {
      fs.rmSync(scratch, { recursive: true, force: true });
      scratch = "";
    }
  });

  test("the extractor reads the six from the model, and en.json has each", () => {
    const strings: Array<string> = scanSourceText(
      PROJECT_MILESTONE_MODEL,
      fs.readFileSync(
        path.join(DEFAULT_CONTEXT.repositoryRoot, PROJECT_MILESTONE_MODEL),
        "utf8",
      ),
      { kind: "models" },
    ).strings.map((entry: ExtractedString): string => {
      return entry.text;
    });

    expect(strings).toEqual(expect.arrayContaining(PROJECT_MILESTONE_KEYS));

    const printed: Array<string> = [];
    const summary: ExtractSummary = runExtract(
      quietContext(
        {
          sourceRoots: [{ directory: PROJECT_MILESTONE_MODEL, kind: "models" }],
        },
        printed,
      ),
      { dryRun: true },
    );

    expect(summary.scannedStrings).toBeGreaterThanOrEqual(
      PROJECT_MILESTONE_KEYS.length,
    );
    expect(changesOf(summary)).toEqual(NOTHING_TO_CHANGE);
  });

  /*
   * Main before #6923: en.json without the model's words. The dry run names
   * exactly them, so the check above fails the pull request that adds a
   * model without running the extractor.
   */
  test("against an en.json without them, a dry run names exactly those six keys", () => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "i18n-extract-6913-"));

    const english: LocaleTree = readLocale("en");

    for (const key of PROJECT_MILESTONE_KEYS) {
      expect(typeof english[key]).toBe("string");
      delete english[key];
    }

    fs.writeFileSync(path.join(scratch, "en.json"), serializeLocale(english));

    const printed: Array<string> = [];
    const summary: ExtractSummary = runExtract(
      quietContext(
        {
          localesDirectory: scratch,
          sourceRoots: [{ directory: PROJECT_MILESTONE_MODEL, kind: "models" }],
          locales: [],
        },
        printed,
      ),
      { dryRun: true },
    );

    expect([...summary.addedKeys].sort()).toEqual(PROJECT_MILESTONE_KEYS);
    expect(changesOf(summary)).not.toEqual(NOTHING_TO_CHANGE);
    expect(printed.join("")).toContain(
      `en.json: ${PROJECT_MILESTONE_KEYS.length} new keys`,
    );
    // Dry: the scratch en.json still lacks them.
    expect(
      Object.keys(readJson(path.join(scratch, "en.json")) as LocaleTree),
    ).not.toContain(PROJECT_MILESTONE_KEYS[0]);
  });

  /*
   * Worded in every language the Dashboard ships, Arabic included, as
   * npm run i18n:check counts it: not left in English without a record
   * that it reads the same.
   */
  test("each is worded in every language the Dashboard ships", () => {
    const english: LocaleTree = readLocale("en");
    const globalSameAsEnglish: Array<string> = readGlobalSameAsEnglish(
      path.join(DEFAULT_CONTEXT.trackingDirectory, "SameAsEnglish.json"),
    );
    const wanted: Set<string> = new Set<string>(PROJECT_MILESTONE_KEYS);
    const untranslatedByLanguage: Record<string, Array<string>> = {};

    for (const code of DEFAULT_CONTEXT.locales) {
      const locale: LocaleTree = readLocale(code);
      const status: LocaleStatus = getLocaleStatus({
        code: code,
        english: english,
        locale: locale,
        globalSameAsEnglish: globalSameAsEnglish,
        localeSameAsEnglish:
          readLocaleProgress(
            code,
            path.join(DEFAULT_CONTEXT.trackingDirectory, "Progress"),
          )?.sameAsEnglish || [],
      });

      untranslatedByLanguage[code] = status.untranslated
        .map((entry: { key: string }): string => {
          return entry.key;
        })
        .filter((key: string): boolean => {
          return wanted.has(key);
        })
        .sort();

      for (const key of PROJECT_MILESTONE_KEYS) {
        expect({ code, key, worded: typeof locale[key] === "string" }).toEqual({
          code,
          key,
          worded: true,
        });
      }
    }

    expect(Object.keys(untranslatedByLanguage)).toContain("ar");

    const nothingUntranslated: Record<string, Array<string>> = {};

    for (const code of Object.keys(untranslatedByLanguage)) {
      nothingUntranslated[code] = [];
    }

    expect(untranslatedByLanguage).toEqual(nothingUntranslated);
  });
});
