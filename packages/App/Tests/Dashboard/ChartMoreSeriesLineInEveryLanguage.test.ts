import {
  ExtractedString,
  scanSourceText,
} from "../../FeatureSet/Dashboard/scripts/i18n/ExtractStrings";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  ADMIN_DASHBOARD_LANGUAGES,
  DASHBOARD_LANGUAGES,
} from "Common/Tests/Helpers/TranslatedLanguages";
import {
  createTranslator,
  PluralTemplate,
  Translator,
} from "Common/Types/Translator";

/*
 * A CHART'S "+N MORE SERIES" LINE, AND WHY A DRIFT MONITOR'S CHART CAN SHOW
 * MORE, IN EVERY LANGUAGE (#7625).
 *
 * An area, bar or line chart with more series than it draws says so under
 * it: "+3 more series — highest values shown"
 * (Common/UI/Components/Charts/ChartLibrary). The line was English in 14 of
 * the Dashboard's 17 languages, and its "one" form in 15: only Spanish,
 * Arabic and Japanese worded it, though the shorter "+{{count}} more
 * series" is worded in every language. A monitor made from a drift
 * insight on one entity says why its chart, while the monitor is edited,
 * can show more series than the monitor watches (Dashboard
 * Utils/AIInsightMonitorPrefill) - English in 15 languages.
 *
 * The words are read the way the Dashboard's extraction reads them (npm run
 * i18n:extract), and the line the way a reader reads it: through the
 * Translator, for counts each language puts in each of its plural forms
 * (one, few, many, other). A form left in English is a placeholder there,
 * not a translation, and the reader gets the English line - so a language
 * whose "one" form, or whose general form behind "few" and "many", is
 * English fails here with the count it fails for. The Admin Dashboard draws
 * the same charts from its own locale files, and reads the line the same.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../..");

const CHART_FILES: ReadonlyArray<string> = [
  "packages/Common/UI/Components/Charts/ChartLibrary/AreaChart/AreaChart.tsx",
  "packages/Common/UI/Components/Charts/ChartLibrary/BarChart/BarChart.tsx",
  "packages/Common/UI/Components/Charts/ChartLibrary/LineChart/LineChart.tsx",
];

const PREFILL_FILE: string =
  "packages/App/FeatureSet/Dashboard/src/Utils/AIInsightMonitorPrefill.ts";

const DASHBOARD_LOCALES: string = path.join(
  REPOSITORY_ROOT,
  "packages/App/FeatureSet/Dashboard/src/Locales",
);

const ADMIN_LOCALES: string = path.join(
  REPOSITORY_ROOT,
  "packages/App/FeatureSet/AdminDashboard/src/Locales",
);

const MORE_SERIES: PluralTemplate = {
  one: "+{{count}} more series — highest values shown",
  other: "+{{count}} more series — highest values shown",
};

const DRIFT_NOTE: string =
  "Only the entity the drift was found on is evaluated, so the chart while editing can show more series than the monitor watches.";

/*
 * Counts in every plural form the languages have: one (1; 21 in Russian;
 * 0 in French), few (2, 3, 22 in Russian), many (5, 11, 25, 100 in
 * Russian), other (the rest), and a count written with a group separator.
 */
const COUNTS: ReadonlyArray<number> = [
  0, 1, 2, 3, 5, 11, 21, 22, 25, 100, 1234,
];

type Locale = Record<string, unknown>;

function readLocale(folder: string, code: string): Locale {
  return JSON.parse(
    fs.readFileSync(path.join(folder, `${code}.json`), "utf8"),
  ) as Locale;
}

function translatorFor(folder: string, code: string): Translator {
  const words: Locale = readLocale(folder, code);

  return createTranslator((text: string): string | undefined => {
    const worded: unknown = words[text];

    return typeof worded === "string" ? worded : undefined;
  }, code);
}

// What the extraction reads in a file.
function extracted(file: string): Array<ExtractedString> {
  return scanSourceText(
    file,
    fs.readFileSync(path.join(REPOSITORY_ROOT, file), "utf8"),
    { kind: "ui" },
  ).strings as Array<ExtractedString>;
}

/*
 * The counts for which `translator` gives the English line: the reader of
 * that language reads it in English.
 */
function countsReadInEnglish(translator: Translator): Array<number> {
  return COUNTS.filter((count: number): boolean => {
    const line: string = translator.translatePlural(MORE_SERIES, count);

    return line.includes("more series") || line.includes("highest values");
  });
}

describe("a chart's +N more series line, as the extraction reads it", () => {
  test.each([...CHART_FILES])("%s says it, one and other", (file: string) => {
    const lines: Array<ExtractedString> = extracted(file).filter(
      (entry: ExtractedString): boolean => {
        return entry.text === MORE_SERIES.other;
      },
    );

    expect(
      lines.map((entry: ExtractedString) => {
        return { kind: entry.kind, one: entry.pluralOne };
      }),
    ).toEqual([{ kind: "plural", one: MORE_SERIES.one }]);
  });

  test("the drift monitor's prefill says why its chart can show more series", () => {
    expect(
      extracted(PREFILL_FILE).map((entry: ExtractedString): string => {
        return entry.text;
      }),
    ).toContain(DRIFT_NOTE);
  });

  test("each is a key of the Dashboard's English, as itself", () => {
    const english: Locale = readLocale(DASHBOARD_LOCALES, "en");

    expect({
      other: english[MORE_SERIES.other],
      one: english[`${MORE_SERIES.other}_one`],
      drift: english[DRIFT_NOTE],
    }).toEqual({
      other: MORE_SERIES.other,
      one: MORE_SERIES.one,
      drift: DRIFT_NOTE,
    });
  });

  test("English reads it for every count, as the check below reads it", () => {
    const english: Translator = translatorFor(DASHBOARD_LOCALES, "en");

    expect(countsReadInEnglish(english)).toEqual([...COUNTS]);
    expect(english.translatePlural(MORE_SERIES, 3)).toBe(
      "+3 more series — highest values shown",
    );
  });
});

describe.each([...DASHBOARD_LANGUAGES])(
  "the Dashboard in %s",
  (code: string) => {
    test("reads the +N more series line in its own words, for every count", () => {
      const translator: Translator = translatorFor(DASHBOARD_LOCALES, code);

      expect({ code, readInEnglish: countsReadInEnglish(translator) }).toEqual({
        code,
        readInEnglish: [],
      });

      // And says the count, written the language's way.
      for (const count of COUNTS) {
        expect(translator.translatePlural(MORE_SERIES, count)).toContain(
          translator.formatNumber(count),
        );
      }
    });

    test("words the drift monitor's note its own way, not in English", () => {
      const worded: unknown = readLocale(DASHBOARD_LOCALES, code)[DRIFT_NOTE];

      expect({
        code,
        worded:
          typeof worded === "string" &&
          worded.trim() !== "" &&
          worded !== DRIFT_NOTE,
      }).toEqual({ code, worded: true });
    });
  },
);

describe.each([...ADMIN_DASHBOARD_LANGUAGES])(
  "the Admin Dashboard in %s",
  (code: string) => {
    test("reads the +N more series line in its own words, for every count", () => {
      const translator: Translator = translatorFor(ADMIN_LOCALES, code);

      expect({
        code,
        readInEnglish: countsReadInEnglish(translator),
      }).toEqual({ code, readInEnglish: [] });
    });
  },
);
