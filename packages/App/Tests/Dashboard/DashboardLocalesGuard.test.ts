import {
  ENGLISH,
  getLocalePath,
  LocaleTree,
  parseLocaleText,
  TRACKING_DIRECTORY,
  TRANSLATED_LOCALES,
} from "../../FeatureSet/Dashboard/scripts/i18n/LocaleFiles";
import {
  getBaselineRegression,
  getEnglishProblems,
  getLocaleStatus,
  LocaleProblem,
  LocaleProblemKind,
  LocaleProgress,
  LocaleStatus,
  readGlobalSameAsEnglish,
  readLocaleProgress,
} from "../../FeatureSet/Dashboard/scripts/i18n/LocaleStatus";
import {
  DEFAULT_DASHBOARD_LANGUAGE,
  SUPPORTED_DASHBOARD_LANGUAGE_CODES,
} from "Common/Types/Dashboard/DashboardLanguage";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The Dashboard's translations can only move forward.
 *
 * en.json is the source of truth: every key there is the English text a page
 * shows (or a nested key a component reads), and every other locale must
 * have each of those keys - untranslated ones hold the English as a
 * placeholder - keep each {{placeholder}} of the English, and list its keys
 * in en.json's order, so one feature's keys land at the same spot in all
 * seventeen files.
 *
 * Each locale's i18n/Progress/<code>.json records how many of its keys were
 * untranslated when its baseline was taken. New strings arrive untranslated,
 * so the untranslated count may grow by the keys added since - and by no
 * more: a translation turned back into English, deleted or overwritten fails
 * here. Translators lower the baseline with npm run i18n:baseline.
 *
 * npm run i18n:check reports the same, with the keys to fix; npm run
 * i18n:extract repairs order, missing keys and merge conflicts. See
 * App/FeatureSet/Dashboard/src/Locales/README.md.
 */

const readText: (code: string) => string = (code: string): string => {
  return fs.readFileSync(getLocalePath(code), "utf8");
};

const englishText: string = readText(ENGLISH);
const english: LocaleTree = parseLocaleText(englishText);
const globalSameAsEnglish: Array<string> = readGlobalSameAsEnglish();

interface LocaleCheck {
  code: string;
  status: LocaleStatus;
  progress: LocaleProgress | undefined;
}

const checks: Array<LocaleCheck> = TRANSLATED_LOCALES.map(
  (code: string): LocaleCheck => {
    const text: string = readText(code);
    const progress: LocaleProgress | undefined = readLocaleProgress(code);

    return {
      code: code,
      progress: progress,
      status: getLocaleStatus({
        code: code,
        english: english,
        locale: parseLocaleText(text),
        localeText: text,
        globalSameAsEnglish: globalSameAsEnglish,
        localeSameAsEnglish: progress?.sameAsEnglish,
      }),
    };
  },
);

const problemKeys: (
  problems: ReadonlyArray<LocaleProblem>,
  kind: LocaleProblemKind,
) => Array<string> = (
  problems: ReadonlyArray<LocaleProblem>,
  kind: LocaleProblemKind,
): Array<string> => {
  return problems
    .filter((problem: LocaleProblem): boolean => {
      return problem.kind === kind;
    })
    .map((problem: LocaleProblem): string => {
      return problem.detail
        ? `${problem.key} (${problem.detail})`
        : problem.key;
    });
};

const checkFor: (code: string) => LocaleCheck = (code: string): LocaleCheck => {
  return checks.find((check: LocaleCheck): boolean => {
    return check.code === code;
  }) as LocaleCheck;
};

describe("Dashboard locales", () => {
  test("cover every Dashboard language", () => {
    expect([DEFAULT_DASHBOARD_LANGUAGE, ...TRANSLATED_LOCALES].sort()).toEqual(
      [...SUPPORTED_DASHBOARD_LANGUAGE_CODES].sort(),
    );

    for (const code of SUPPORTED_DASHBOARD_LANGUAGE_CODES) {
      expect([code, fs.existsSync(getLocalePath(code))]).toEqual([code, true]);
    }
  });

  test("en.json maps every flat key to itself, has nothing empty and is canonical", () => {
    expect(
      getEnglishProblems(english, englishText).map(
        (problem: LocaleProblem): string => {
          return `${problem.kind} ${problem.key}`;
        },
      ),
    ).toEqual([]);
  });

  test.each(TRANSLATED_LOCALES)(
    "%s has every key en.json has",
    (code: string) => {
      expect(problemKeys(checkFor(code).status.problems, "missing")).toEqual(
        [],
      );
      expect(
        problemKeys(checkFor(code).status.problems, "not-a-string"),
      ).toEqual([]);
    },
  );

  test.each(TRANSLATED_LOCALES)(
    "%s has no key en.json lacks, beyond its own plural forms",
    (code: string) => {
      expect(problemKeys(checkFor(code).status.problems, "extra")).toEqual([]);
    },
  );

  test.each(TRANSLATED_LOCALES)(
    "%s keeps every {{placeholder}} of the English",
    (code: string) => {
      expect(
        problemKeys(checkFor(code).status.problems, "placeholders"),
      ).toEqual([]);
    },
  );

  test.each(TRANSLATED_LOCALES)(
    "%s has no empty translation",
    (code: string) => {
      expect(problemKeys(checkFor(code).status.problems, "empty")).toEqual([]);
    },
  );

  test.each(TRANSLATED_LOCALES)(
    "%s lists its keys in en.json's order, formatted like en.json",
    (code: string) => {
      expect(
        problemKeys(checkFor(code).status.problems, "not-canonical"),
      ).toEqual([]);
    },
  );

  test.each(TRANSLATED_LOCALES)(
    "%s has a recorded baseline",
    (code: string) => {
      const progress: LocaleProgress | undefined = checkFor(code).progress;

      expect(progress).toBeDefined();
      expect(progress!.baseline.keys).toBeGreaterThan(0);
    },
  );

  /*
   * The ratchet: untranslated may grow only by the keys added since the
   * baseline. When this fails, a translation was lost - restore it rather
   * than raise the baseline.
   */
  test.each(TRANSLATED_LOCALES)(
    "%s lost no translation against its baseline",
    (code: string) => {
      const check: LocaleCheck = checkFor(code);

      expect({
        locale: code,
        lostTranslations: Math.max(
          0,
          getBaselineRegression(check.status, check.progress!.baseline),
        ),
      }).toEqual({ locale: code, lostTranslations: 0 });
    },
  );
});

describe("the same-as-English lists", () => {
  const englishValues: Set<string> = new Set<string>();

  const collect: (node: LocaleTree) => void = (node: LocaleTree): void => {
    for (const value of Object.values(node)) {
      if (typeof value === "string") {
        englishValues.add(value);
      } else {
        collect(value);
      }
    }
  };

  collect(english);

  const isSortedAndUnique: (values: ReadonlyArray<string>) => boolean = (
    values: ReadonlyArray<string>,
  ): boolean => {
    return values.every((value: string, index: number): boolean => {
      return index === 0 || (values[index - 1] as string) < value;
    });
  };

  test("the global list holds English en.json has, sorted and without repeats", () => {
    expect(
      fs.existsSync(path.join(TRACKING_DIRECTORY, "SameAsEnglish.json")),
    ).toBe(true);
    expect(globalSameAsEnglish.length).toBeGreaterThan(0);
    expect(isSortedAndUnique(globalSameAsEnglish)).toBe(true);
    expect(
      globalSameAsEnglish.filter((value: string): boolean => {
        return !englishValues.has(value);
      }),
    ).toEqual([]);
  });

  test.each(TRANSLATED_LOCALES)(
    "%s's list holds English en.json has, sorted and without repeats",
    (code: string) => {
      const list: Array<string> = checkFor(code).progress?.sameAsEnglish || [];

      expect(isSortedAndUnique(list)).toBe(true);
      expect(
        list.filter((value: string): boolean => {
          return !englishValues.has(value);
        }),
      ).toEqual([]);
    },
  );
});
