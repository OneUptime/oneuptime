import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * NOT MONITORED, IN EVERY STATUS PAGE LANGUAGE (#6478).
 *
 * A status page draws a resource nothing checks - its monitor's monitoring
 * is off, or every monitor of its monitor group has it off - as Not
 * monitored (overview.notMonitored), and a page nothing on which is checked
 * says so in its banner (overview.noResourcesAreMonitored). Both are said in
 * each of the page's languages, and Not monitored in the very words the
 * Dashboard uses for a monitor whose monitoring is off, so a team reads the
 * same thing on both.
 */

const STATUS_PAGE_LOCALES: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/StatusPage/src/Locales",
);

const DASHBOARD_LOCALES: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const LANGUAGES: Array<string> = fs
  .readdirSync(STATUS_PAGE_LOCALES)
  .filter((name: string): boolean => {
    return name.endsWith(".json");
  })
  .map((name: string): string => {
    return name.slice(0, -".json".length);
  })
  .sort();

type Words = Record<string, unknown>;

function read(folder: string, language: string): Words {
  return JSON.parse(
    fs.readFileSync(path.join(folder, `${language}.json`), "utf-8"),
  ) as Words;
}

function overviewOf(language: string): Record<string, unknown> {
  return read(STATUS_PAGE_LOCALES, language)["overview"] as Record<
    string,
    unknown
  >;
}

const ENGLISH: Record<string, unknown> = overviewOf("en");

describe("the status page's Not monitored words", () => {
  test("every language the status page has", () => {
    expect(LANGUAGES).toEqual([
      "ar",
      "da",
      "de",
      "en",
      "es",
      "fa",
      "fr",
      "hi",
      "it",
      "ja",
      "ko",
      "nl",
      "no",
      "pt",
      "ru",
      "sv",
      "zh-CN",
      "zh-TW",
    ]);
  });

  test("English says them plainly", () => {
    expect(ENGLISH["notMonitored"]).toBe("Not monitored");
    expect(ENGLISH["noResourcesAreMonitored"]).toBe(
      "No Resources are monitored right now",
    );
  });

  test.each(LANGUAGES)(
    "%s has both, as text of its own",
    (language: string) => {
      const overview: Record<string, unknown> = overviewOf(language);

      for (const key of ["notMonitored", "noResourcesAreMonitored"]) {
        const value: unknown = overview[key];

        expect({ language, key, type: typeof value }).toEqual({
          language,
          key,
          type: "string",
        });
        expect((value as string).trim().length).toBeGreaterThan(0);
        expect(value as string).toBe((value as string).trim());
        // Plain words: no placeholder to fill and no markup.
        expect(value as string).not.toMatch(/[{}<>]/);

        if (language !== "en") {
          expect({ language, key, value }).not.toEqual({
            language,
            key,
            value: ENGLISH[key],
          });
        }
      }
    },
  );

  test.each(LANGUAGES)(
    "%s says Not monitored in the Dashboard's words for it",
    (language: string) => {
      const dashboard: Words = read(DASHBOARD_LOCALES, language);

      expect(overviewOf(language)["notMonitored"]).toBe(
        dashboard["Not monitored"],
      );
    },
  );

  test.each(LANGUAGES)(
    "%s keeps them beside the words they go with",
    (language: string) => {
      const keys: Array<string> = Object.keys(overviewOf(language));

      expect(keys.indexOf("notMonitored")).toBe(
        keys.indexOf("operational") + 1,
      );
      expect(keys.indexOf("noResourcesAreMonitored")).toBe(
        keys.indexOf("someResourcesAreUnder") + 1,
      );
    },
  );
});
