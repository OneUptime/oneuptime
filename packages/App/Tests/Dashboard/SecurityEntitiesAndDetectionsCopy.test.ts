import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  DEFAULT_ENTITY_WINDOW_IN_DAYS,
  ENTITIES_EMPTY_DESCRIPTION,
  ENTITIES_EMPTY_TITLE,
  ENTITIES_PER_PAGE,
  ENTITY_WINDOW_LABEL,
  EntityPage,
  OPEN_IN_CORRELATE,
  RISKIEST_ENTITIES_DESCRIPTION,
  getEntityPage,
  getEntityWindowOptionValue,
  readEntityWindowOption,
} from "../../FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEntitiesCopy";
import {
  DETECTION_RULES_EMPTY_DESCRIPTION,
  DETECTION_RULES_EMPTY_TITLE,
  OPEN_RULE_LIBRARY,
} from "../../FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityDetectionsCopy";
import { TRANSLATED_LOCALES } from "../../FeatureSet/Dashboard/scripts/i18n/LocaleFiles";
import { isSaidInLocale, readDashboardLocale } from "./SecurityLocaleSentences";

/*
 * Security Events > Entities ranks what the findings name over a window the
 * shared switch picks, and says what an entity is in its card; an empty
 * Detection Rules list leads to the Rule Library. These are the React-free
 * parts: the windows as the switch's values, and the words.
 */

const ENTITY_WINDOWS_IN_DAYS: Array<number> = [1, 7, 30];

describe("the Riskiest Entities window", () => {
  test("opens on a week", () => {
    expect(DEFAULT_ENTITY_WINDOW_IN_DAYS).toBe(7);
  });

  test("each window is the switch's value, and reads back as itself", () => {
    for (const windowInDays of ENTITY_WINDOWS_IN_DAYS) {
      const value: string = getEntityWindowOptionValue(windowInDays);

      expect(value).toBe(String(windowInDays));
      expect(readEntityWindowOption(value, ENTITY_WINDOWS_IN_DAYS)).toBe(
        windowInDays,
      );
    }
  });

  test("a window the switch does not offer reads as a week", () => {
    for (const value of ["", "2", "365", "seven", "-1", "7.5"]) {
      expect(readEntityWindowOption(value, ENTITY_WINDOWS_IN_DAYS)).toBe(7);
    }
  });

  test("the page offers the windows the docs name: a day, a week and a month", () => {
    const page: string = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../FeatureSet/Dashboard/src/Pages/SecurityEvents/Entities.tsx",
      ),
      "utf8",
    );

    expect(page).toContain(
      "export const ENTITY_WINDOWS_IN_DAYS: Array<number> = [1, 7, 30];",
    );
  });
});

describe("the words", () => {
  const SENTENCES: Array<string> = [
    ENTITY_WINDOW_LABEL,
    RISKIEST_ENTITIES_DESCRIPTION,
    ENTITIES_EMPTY_TITLE,
    ENTITIES_EMPTY_DESCRIPTION,
    OPEN_IN_CORRELATE,
    DETECTION_RULES_EMPTY_TITLE,
    DETECTION_RULES_EMPTY_DESCRIPTION,
    OPEN_RULE_LIBRARY,
  ];

  test("say what an entity is, and where an empty rules list goes", () => {
    expect(RISKIEST_ENTITIES_DESCRIPTION).toContain(
      "users, hosts, addresses and files",
    );
    expect(RISKIEST_ENTITIES_DESCRIPTION).toContain("Correlate");
    expect(DETECTION_RULES_EMPTY_DESCRIPTION).toContain("Rule Library");
    // A heading: no full stop.
    expect(DETECTION_RULES_EMPTY_TITLE.endsWith(".")).toBe(false);
  });

  test("are in every Dashboard locale, said in the language", () => {
    for (const locale of TRANSLATED_LOCALES) {
      const entries: Record<string, unknown> = readDashboardLocale(locale);

      for (const sentence of SENTENCES) {
        expect([locale, sentence, typeof entries[sentence]]).toEqual([
          locale,
          sentence,
          "string",
        ]);
      }

      // The page's new sentences; the rest were translated before.
      for (const sentence of [
        ENTITY_WINDOW_LABEL,
        RISKIEST_ENTITIES_DESCRIPTION,
        ENTITIES_EMPTY_DESCRIPTION,
        DETECTION_RULES_EMPTY_TITLE,
        DETECTION_RULES_EMPTY_DESCRIPTION,
        OPEN_RULE_LIBRARY,
      ]) {
        expect([
          locale,
          sentence,
          isSaidInLocale(locale, sentence, entries[sentence]),
        ]).toEqual([locale, sentence, true]);
      }
    }
  });
});

/*
 * Riskiest Entities reads the ranking whole (the server's top 100) and
 * pages it here, ten a page as every list starts.
 */
describe("a page of the ranking", () => {
  const RANKING: Array<number> = Array.from(
    { length: 23 },
    (_value: unknown, index: number): number => {
      return index + 1;
    },
  );

  test("ten a page, as every list of the product starts", () => {
    expect(ENTITIES_PER_PAGE).toBe(10);
  });

  test("the first, a middle and the last page hold their slice of the ranking", () => {
    expect(
      getEntityPage({ rows: RANKING, pageNumber: 1, perPage: 10 }),
    ).toEqual({ rows: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], pageNumber: 1 });
    expect(
      getEntityPage({ rows: RANKING, pageNumber: 2, perPage: 10 }).rows,
    ).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    expect(
      getEntityPage({ rows: RANKING, pageNumber: 3, perPage: 10 }),
    ).toEqual({ rows: [21, 22, 23], pageNumber: 3 });
  });

  test("a page past the end - a read that came back shorter - shows the last page, never an empty one", () => {
    const page: EntityPage<number> = getEntityPage({
      rows: RANKING.slice(0, 12),
      pageNumber: 5,
      perPage: 10,
    });

    expect(page).toEqual({ rows: [11, 12], pageNumber: 2 });
  });

  test("rows per page the reader picks page the same ranking", () => {
    expect(
      getEntityPage({ rows: RANKING, pageNumber: 1, perPage: 25 }),
    ).toEqual({ rows: RANKING, pageNumber: 1 });
    expect(
      getEntityPage({ rows: RANKING, pageNumber: 2, perPage: 5 }).rows,
    ).toEqual([6, 7, 8, 9, 10]);
  });

  test("an empty ranking is one empty page", () => {
    expect(getEntityPage({ rows: [], pageNumber: 3, perPage: 10 })).toEqual({
      rows: [],
      pageNumber: 1,
    });
  });

  test("a page or a size that is not a whole positive number reads as the first page of one at least", () => {
    expect(
      getEntityPage({ rows: RANKING, pageNumber: 0, perPage: 10 }).pageNumber,
    ).toBe(1);
    expect(
      getEntityPage({ rows: RANKING, pageNumber: -2, perPage: 10 }).pageNumber,
    ).toBe(1);
    expect(
      getEntityPage({ rows: RANKING, pageNumber: Number.NaN, perPage: 10 })
        .pageNumber,
    ).toBe(1);
    expect(
      getEntityPage({ rows: RANKING, pageNumber: 1, perPage: 0 }).rows,
    ).toEqual([1]);
    expect(
      getEntityPage({ rows: RANKING, pageNumber: 2.7, perPage: 10 }).rows,
    ).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
  });

  test("the page reads the ranking through it, and starts a new window at the top", () => {
    const page: string = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../FeatureSet/Dashboard/src/Pages/SecurityEvents/Entities.tsx",
      ),
      "utf8",
    );

    expect(page).toContain("data={isLoading ? [] : entityPage.rows}");
    expect(page).toContain("currentPageNumber={entityPage.pageNumber}");
    expect(page).not.toContain("disablePagination");
    expect(page).toContain("setPageNumber(1);");
  });
});

describe("the lookup's words", () => {
  const LOOKUP_WORDS: Array<string> = [
    "Any user, host, IP address, domain or file hash: how often it appears in your security events over the last 30 days, and in how many findings.",
    "e.g. alice@example.com, web-01 or 203.0.113.7",
  ];

  test("are the page's own", () => {
    const page: string = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../FeatureSet/Dashboard/src/Pages/SecurityEvents/Entities.tsx",
      ),
      "utf8",
    );

    for (const words of LOOKUP_WORDS) {
      expect(page).toContain(`"${words}"`);
    }
  });

  test("are said in every Dashboard locale, the example's values as written", () => {
    for (const locale of TRANSLATED_LOCALES) {
      const entries: Record<string, unknown> = readDashboardLocale(locale);

      for (const words of LOOKUP_WORDS) {
        expect([
          locale,
          words,
          isSaidInLocale(locale, words, entries[words]),
        ]).toEqual([locale, words, true]);
      }

      // The example's values are values: the same in every language.
      for (const value of ["alice@example.com", "web-01", "203.0.113.7"]) {
        expect([locale, String(entries[LOOKUP_WORDS[1]!])]).toEqual([
          locale,
          expect.stringContaining(value),
        ]);
      }
    }
  });
});
