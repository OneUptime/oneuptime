import {
  alignLocale,
  insertEnglishKeys,
  LocaleTree,
  mergeLocaleTrees,
  serializeLocale,
} from "../../FeatureSet/Dashboard/scripts/i18n/LocaleFiles";
import {
  getBaselineRegression,
  getEnglishProblems,
  getExpectedEntries,
  getLocaleStatus,
  LocaleProblem,
  LocaleProgress,
  LocaleStatus,
  readGlobalSameAsEnglish,
  readLocaleProgress,
  serializeLocaleProgress,
  serializeSameAsEnglish,
  writeLocaleProgress,
} from "../../FeatureSet/Dashboard/scripts/i18n/LocaleStatus";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";

/*
 * What counts as untranslated, what makes a locale file broken, and the
 * baseline that keeps translations from ever being lost. See
 * App/FeatureSet/Dashboard/src/Locales/README.md for the rules in prose.
 */

const ENGLISH: LocaleTree = {
  navbar: { items: { kubernetesTitle: "Kubernetes", formsTitle: "Forms" } },
  Save: "Save",
  "Create {{itemName}}": "Create {{itemName}}",
  "{{count}} rows": "{{count}} rows",
  "{{count}} rows_one": "{{count}} row",
  "1-10": "1-10",
  Status: "Status",
};

const keysOf: (status: LocaleStatus) => Array<string> = (
  status: LocaleStatus,
): Array<string> => {
  return status.untranslated.map((entry: { key: string }): string => {
    return entry.key;
  });
};

const problemsOf: (status: LocaleStatus) => Array<string> = (
  status: LocaleStatus,
): Array<string> => {
  return status.problems.map((problem: LocaleProblem): string => {
    return `${problem.kind} ${problem.key}`;
  });
};

describe("the keys a locale must have", () => {
  /*
   * Every locale has exactly en.json's keys, in any language: a sentence that
   * depends on a count has a general form and a "_one" form, and a language
   * with more forms (Russian) words its general form so it reads right for
   * any count.
   */
  test("are exactly en.json's leaves, whatever the language", () => {
    for (const code of ["de", "ru", "ja"]) {
      expect([
        code,
        getExpectedEntries(ENGLISH, code).map((entry: { key: string }) => {
          return entry.key;
        }),
      ]).toEqual([
        code,
        [
          "navbar › items › kubernetesTitle",
          "navbar › items › formsTitle",
          "Save",
          "Create {{itemName}}",
          "{{count}} rows",
          "{{count}} rows_one",
          "1-10",
          "Status",
        ],
      ]);
    }
  });

  test("a one form is unused in a language without one", () => {
    const one: { isUnusedForm: boolean } | undefined = getExpectedEntries(
      ENGLISH,
      "ja",
    ).find((entry: { key: string }) => {
      return entry.key === "{{count}} rows_one";
    });

    expect(one?.isUnusedForm).toBe(true);
    expect(
      getExpectedEntries(ENGLISH, "de").find((entry: { key: string }) => {
        return entry.key === "{{count}} rows_one";
      })?.isUnusedForm,
    ).toBe(false);
  });
});

describe("untranslated", () => {
  test("a fresh locale of English placeholders is untranslated, except what cannot be", () => {
    const locale: LocaleTree = alignLocale(ENGLISH, {}).tree;
    const status: LocaleStatus = getLocaleStatus({
      code: "de",
      english: ENGLISH,
      locale: locale,
      localeText: serializeLocale(locale),
    });

    expect(keysOf(status)).toEqual([
      "navbar › items › kubernetesTitle",
      "navbar › items › formsTitle",
      "Save",
      "Create {{itemName}}",
      "{{count}} rows",
      "{{count}} rows_one",
      "Status",
    ]);
    // "1-10" has no letters: there is nothing to translate.
    expect(status.sameAsEnglish).toBe(1);
    expect(status.keys).toBe(8);
    expect(status.problems).toEqual([]);
  });

  test("a translation is translated, and the lists excuse what reads the same", () => {
    const locale: LocaleTree = alignLocale(ENGLISH, {
      navbar: { items: { formsTitle: "Formulare" } },
      Save: "Speichern",
      "Create {{itemName}}": "{{itemName}} erstellen",
      "{{count}} rows": "{{count}} Zeilen",
      "{{count}} rows_one": "{{count}} Zeile",
    }).tree;

    const status: LocaleStatus = getLocaleStatus({
      code: "de",
      english: ENGLISH,
      locale: locale,
      globalSameAsEnglish: ["Kubernetes"],
      localeSameAsEnglish: ["Status"],
    });

    expect(keysOf(status)).toEqual([]);
    expect(status.sameAsEnglish).toBe(3);
  });

  test("Japanese never has to translate the one form it does not use", () => {
    const locale: LocaleTree = alignLocale(ENGLISH, {
      "{{count}} rows": "{{count}} 行",
    }).tree;

    expect(
      keysOf(getLocaleStatus({ code: "ja", english: ENGLISH, locale })),
    ).not.toContain("{{count}} rows_one");
  });

  test("Russian translates the general form and the one form, nothing more", () => {
    const locale: LocaleTree = alignLocale(ENGLISH, {
      "{{count}} rows": "Строк: {{count}}",
      "{{count}} rows_one": "{{count}} строка",
    }).tree;
    const status: LocaleStatus = getLocaleStatus({
      code: "ru",
      english: ENGLISH,
      locale,
    });

    expect(keysOf(status)).not.toContain("{{count}} rows");
    expect(keysOf(status)).not.toContain("{{count}} rows_one");
    expect(status.problems).toEqual([]);
  });
});

describe("problems", () => {
  test("a missing key, an extra key and a broken placeholder", () => {
    const status: LocaleStatus = getLocaleStatus({
      code: "de",
      english: { Save: "Save", "Create {{itemName}}": "Create {{itemName}}" },
      locale: {
        "Create {{itemName}}": "{{name}} erstellen",
        Extra: "Zusätzlich",
      },
    });

    expect(problemsOf(status)).toEqual([
      "missing Save",
      "placeholders Create {{itemName}}",
      "extra Extra",
    ]);
    expect(status.problems[1]?.detail).toBe(
      'expected ["itemName"], found ["name"]',
    );
    // A missing key is also untranslated.
    expect(keysOf(status)).toEqual(["Save"]);
  });

  test("an empty translation blanks the screen", () => {
    expect(
      problemsOf(
        getLocaleStatus({
          code: "de",
          english: { Save: "Save" },
          locale: { Save: "  " },
        }),
      ),
    ).toEqual(["empty Save"]);
  });

  test("an object where a string belongs, and a string where an object belongs", () => {
    expect(
      problemsOf(
        getLocaleStatus({
          code: "de",
          english: { Save: "Save", navbar: { a: "A" } },
          locale: { Save: { x: "y" }, navbar: "Navigation" } as LocaleTree,
        }),
      ),
    ).toEqual([
      "not-a-string Save",
      "missing navbar › a",
      "extra Save › x",
      "extra navbar",
    ]);
  });

  test("a plural form en.json does not have is extra, in any language", () => {
    for (const code of ["de", "ru"]) {
      expect([
        code,
        problemsOf(
          getLocaleStatus({
            code: code,
            english: ENGLISH,
            locale: {
              ...alignLocale(ENGLISH, {}).tree,
              "{{count}} rows_few": "{{count}} строки",
            },
          }),
        ),
      ]).toEqual([code, ["extra {{count}} rows_few"]]);
    }
  });

  test("keys out of en.json's order make the file not canonical", () => {
    const locale: LocaleTree = alignLocale(ENGLISH, {}).tree;
    const reordered: LocaleTree = { Status: "Status" };

    for (const key of Object.keys(locale)) {
      reordered[key] = locale[key] as string;
    }

    expect(
      problemsOf(
        getLocaleStatus({
          code: "de",
          english: ENGLISH,
          locale: reordered,
          localeText: serializeLocale(reordered),
        }),
      ),
    ).toEqual(["not-canonical "]);
    expect(
      problemsOf(
        getLocaleStatus({
          code: "de",
          english: ENGLISH,
          locale: locale,
          localeText: JSON.stringify(locale),
        }),
      ),
    ).toEqual(["not-canonical "]);
  });
});

describe("en.json's own problems", () => {
  test("a flat key's English is the key itself, a one form aside", () => {
    expect(getEnglishProblems(ENGLISH, serializeLocale(ENGLISH))).toEqual([]);
    expect(
      getEnglishProblems({ Save: "Store", x_one: "orphan one" }).map(
        (problem: LocaleProblem) => {
          return `${problem.kind} ${problem.key}`;
        },
      ),
    ).toEqual(["english-value Save", "english-value x_one"]);
  });

  test("nothing in en.json may be empty, and the file must be canonical", () => {
    expect(
      getEnglishProblems({ navbar: { a: "" } }).map(
        (problem: LocaleProblem) => {
          return `${problem.kind} ${problem.key}`;
        },
      ),
    ).toEqual(["empty navbar › a"]);
    expect(
      getEnglishProblems({ Save: "Save" }, '{"Save":"Save"}').map(
        (problem: LocaleProblem) => {
          return problem.kind;
        },
      ),
    ).toEqual(["not-canonical"]);
  });
});

describe("the baseline", () => {
  const statusWith: (keys: number, untranslated: number) => LocaleStatus = (
    keys: number,
    untranslated: number,
  ): LocaleStatus => {
    return {
      locale: "de",
      keys: keys,
      untranslated: Array.from(
        { length: untranslated },
        (_x: unknown, i: number) => {
          return { key: `k${i}`, english: `k${i}` };
        },
      ),
      sameAsEnglish: 0,
      problems: [],
    };
  };

  test("translating lowers the untranslated count", () => {
    expect(
      getBaselineRegression(statusWith(100, 40), {
        keys: 100,
        untranslated: 50,
      }),
    ).toBe(-10);
  });

  test("new keys arrive untranslated and are not a regression", () => {
    expect(
      getBaselineRegression(statusWith(120, 70), {
        keys: 100,
        untranslated: 50,
      }),
    ).toBe(0);
  });

  test("a translation turned back into English is a regression", () => {
    expect(
      getBaselineRegression(statusWith(100, 51), {
        keys: 100,
        untranslated: 50,
      }),
    ).toBe(1);
    expect(
      getBaselineRegression(statusWith(110, 61), {
        keys: 100,
        untranslated: 50,
      }),
    ).toBe(1);
  });

  /*
   * One branch adds strings while another translates: merged, neither
   * branch's work is mistaken for a loss.
   */
  test("strings added on one branch and translations on another merge without a regression", () => {
    const english: LocaleTree = { A: "A", B: "B", C: "C" };
    const base: LocaleTree = alignLocale(english, {}).tree;
    const baseline: { keys: number; untranslated: number } = {
      keys: 3,
      untranslated: 3,
    };

    // Branch 1 adds two strings (placeholders in every locale).
    const englishWithMore: LocaleTree = insertEnglishKeys(english, {
      D: "D",
      E: "E",
    }).tree;
    const added: LocaleTree = alignLocale(englishWithMore, base).tree;

    // Branch 2 translates A and B and lowers its baseline.
    const translated: LocaleTree = { ...base, A: "Ä", B: "Bé" };
    const loweredBaseline: { keys: number; untranslated: number } = {
      keys: 3,
      untranslated: 1,
    };

    const merged: LocaleTree = alignLocale(
      englishWithMore,
      mergeLocaleTrees({ ours: added, theirs: translated, base: base }),
    ).tree;
    const status: LocaleStatus = getLocaleStatus({
      code: "de",
      english: englishWithMore,
      locale: merged,
    });

    expect(keysOf(status)).toEqual(["C", "D", "E"]);
    expect(getBaselineRegression(status, baseline)).toBeLessThanOrEqual(0);
    expect(getBaselineRegression(status, loweredBaseline)).toBe(0);
  });
});

describe("tracking files", () => {
  let directory: string = "";

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "i18n-progress-"));
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  test("a progress file round-trips with its list sorted and unique", () => {
    const progress: LocaleProgress = {
      baseline: { keys: 10, untranslated: 4 },
      sameAsEnglish: ["Status", "Name", "Status"],
    };

    writeLocaleProgress("de", progress, directory);

    expect(fs.readFileSync(path.join(directory, "de.json"), "utf8")).toBe(
      serializeLocaleProgress(progress),
    );
    expect(readLocaleProgress("de", directory)).toEqual({
      baseline: { keys: 10, untranslated: 4 },
      sameAsEnglish: ["Name", "Status"],
    });
    expect(serializeLocaleProgress(progress)).toBe(
      '{\n  "baseline": {\n    "keys": 10,\n    "untranslated": 4\n  },\n  "sameAsEnglish": [\n    "Name",\n    "Status"\n  ]\n}\n',
    );
  });

  test("a missing progress file is undefined, a partial one defaults", () => {
    expect(readLocaleProgress("fr", directory)).toBeUndefined();

    fs.writeFileSync(path.join(directory, "it.json"), "{}");

    expect(readLocaleProgress("it", directory)).toEqual({
      baseline: { keys: 0, untranslated: 0 },
      sameAsEnglish: [],
    });
  });

  test("the global list is an array, sorted when written", () => {
    const filePath: string = path.join(directory, "SameAsEnglish.json");

    expect(readGlobalSameAsEnglish(filePath)).toEqual([]);

    fs.writeFileSync(filePath, serializeSameAsEnglish(["Slack", "API", "API"]));

    expect(readGlobalSameAsEnglish(filePath)).toEqual(["API", "Slack"]);

    fs.writeFileSync(filePath, '{"not": "a list"}');

    expect(() => {
      return readGlobalSameAsEnglish(filePath);
    }).toThrow();
  });
});
