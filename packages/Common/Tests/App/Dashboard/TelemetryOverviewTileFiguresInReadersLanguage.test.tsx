// UX rule: Docs/ux/README.md#numbers-dates-and-plurals
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "@jest/globals";
import { act, cleanup, render } from "@testing-library/react";
import fs from "fs";
import i18next from "i18next";
import path from "path";
import React from "react";
import { initReactI18next } from "react-i18next";
import {
  CloudAppSignalCell,
  CloudAppSignalKind,
  CloudAppSignalsSummaryCell,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AppPlatforms/CloudAppCells";
import {
  formatBytes,
  formatCompact,
  formatPercent,
} from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/telemetryFormat";
import {
  formatBytes as reExportedBytes,
  formatCompact as reExportedCompact,
  formatPercent as reExportedPercent,
} from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/telemetryMetrics";
import {
  describeExceptionsTile,
  describePageLoadsTile,
  PageLoadTileStats,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Rum/View/OverviewHelpers";
import { CloudAppSignals } from "../../../../App/FeatureSet/Dashboard/src/Pages/AppPlatforms/Utils/CloudApps";
import { setDateDisplayLanguage } from "../../../Types/DateLanguage";
import {
  createTranslator,
  DEFAULT_LANGUAGE,
  Translator,
} from "../../../Types/Translator";
import {
  dashboardTranslator,
  readDashboardLocaleAsDrawn,
} from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * THE TELEMETRY OVERVIEW TILES' FIGURES, IN THE READER'S LANGUAGE (#8481).
 *
 * A service's, a function's, a site's and a cloud app's Overview wrote the
 * Requests, Error rate and Memory tiles (and the cloud apps' list cells)
 * with telemetryFormat's English helpers: "1.2k", "2.5%", "1.5 GiB" in
 * Latin digits beside a p95 tile and charts in the reader's. Under the rule
 * for a figure (Docs/ux/README.md#numbers-dates-and-plurals) each helper,
 * handed the reader's translator, writes their digits, decimal sign and
 * percent sign, its scale letter and unit kept, and every tile hands it.
 *
 *   - English reads exactly as it always did, with a translator or none;
 *   - German writes its decimal comma and its percent sign's space;
 *   - Arabic writes Latin digits;
 *   - Persian writes no Latin digit.
 */

const LANGUAGES: ReadonlyArray<string> = ["en", "de", "ar", "fa"];

const translators: Record<string, Translator> = Object.fromEntries(
  LANGUAGES.map((language: string): [string, Translator] => {
    return [language, dashboardTranslator(language)];
  }),
);

const LATIN_DIGIT: RegExp = /[0-9]/;
const PERSIAN_DIGIT: RegExp = /[\u{06F0}-\u{06F9}]/u;
const ARABIC_INDIC_DIGIT: RegExp = /[\u{0660}-\u{0669}]/u;
const DIRECTION_MARKS: RegExp = /[\u200e\u200f\u061c]/g;

// A figure as read: no isolating or direction marks, no-break spaces as spaces.
function spaced(text: string): string {
  return withoutIsolateMarks(text)
    .replace(DIRECTION_MARKS, "")
    .replace(/[\u00a0\u202f]/g, " ");
}

function inLanguages(
  write: (translator: Translator) => string,
): Record<string, string> {
  return Object.fromEntries(
    LANGUAGES.map((language: string): [string, string] => {
      return [language, spaced(write(translators[language]!))];
    }),
  );
}

const COUNTS: ReadonlyArray<number> = [
  0, 1, 7.4, 42, 999, 1000, 1234, 12_500, 999_949, 1_000_000, 3_456_789,
];
const PERCENTS: ReadonlyArray<number> = [0, 0.04, 2.5, 12.345, 50, 100];
const SIZES: ReadonlyArray<number> = [
  0,
  5,
  1023,
  1536,
  10 * 1024 * 1024,
  1.5 * 1024 * 1024 * 1024,
  6 * 1024 ** 4,
];

afterEach(() => {
  setDateDisplayLanguage("en");
});

describe("English reads exactly as it always did", () => {
  const english: Translator = createTranslator(undefined, DEFAULT_LANGUAGE);

  test("each helper writes the same with the English translator as with none", () => {
    for (const value of COUNTS) {
      expect(formatCompact(value, english)).toBe(formatCompact(value));
      expect(formatCompact(value, translators["en"]!)).toBe(
        formatCompact(value),
      );
    }
    for (const value of PERCENTS) {
      expect(formatPercent(value, english)).toBe(formatPercent(value));
      expect(formatPercent(value, translators["en"]!)).toBe(
        formatPercent(value),
      );
    }
    for (const value of SIZES) {
      expect(formatBytes(value, english)).toBe(formatBytes(value));
      expect(formatBytes(value, translators["en"]!)).toBe(formatBytes(value));
    }
  });

  test("the figures every English test pins", () => {
    expect(formatCompact(42)).toBe("42");
    expect(formatCompact(1234)).toBe("1.2k");
    expect(formatCompact(1000)).toBe("1k");
    expect(formatCompact(3_456_789)).toBe("3.5M");
    expect(formatPercent(2.5)).toBe("2.5%");
    expect(formatPercent(0)).toBe("0.0%");
    // A size's figure is held to its unit by a no-break space (#8457).
    expect(formatBytes(5)).toBe("5\u00A0B");
    expect(formatBytes(1536)).toBe("1.5\u00A0KiB");
    expect(formatBytes(10 * 1024 * 1024)).toBe("10\u00A0MiB");
  });

  test("a missing figure is a dash in every language", () => {
    for (const language of LANGUAGES) {
      const translator: Translator = translators[language]!;

      expect(formatCompact(null, translator)).toBe("—");
      expect(formatCompact(NaN, translator)).toBe("—");
      expect(formatPercent(null, translator)).toBe("—");
      expect(formatPercent(Infinity, translator)).toBe("—");
      expect(formatBytes(null, translator)).toBe("—");
      expect(formatBytes(NaN, translator)).toBe("—");
    }
  });

  test("telemetryMetrics re-exports the same helpers", () => {
    expect(reExportedCompact).toBe(formatCompact);
    expect(reExportedPercent).toBe(formatPercent);
    expect(reExportedBytes).toBe(formatBytes);
  });
});

describe("a tile's figure in German, Arabic and Persian", () => {
  test("Requests: a compact count, its scale letter kept", () => {
    expect(
      inLanguages((t: Translator): string => {
        return formatCompact(1234, t);
      }),
    ).toEqual({ en: "1.2k", de: "1,2k", ar: "1.2k", fa: "۱٫۲k" });
    expect(
      inLanguages((t: Translator): string => {
        return formatCompact(42, t);
      }),
    ).toEqual({ en: "42", de: "42", ar: "42", fa: "۴۲" });
    expect(
      inLanguages((t: Translator): string => {
        return formatCompact(3_456_789, t);
      }),
    ).toEqual({ en: "3.5M", de: "3,5M", ar: "3.5M", fa: "۳٫۵M" });
  });

  test("Error rate: the reader's decimal and percent signs", () => {
    expect(
      inLanguages((t: Translator): string => {
        return formatPercent(2.5, t);
      }),
    ).toEqual({ en: "2.5%", de: "2,5 %", ar: "2.5%", fa: "۲٫۵٪" });
    expect(
      inLanguages((t: Translator): string => {
        return formatPercent(0, t);
      }),
    ).toEqual({ en: "0.0%", de: "0,0 %", ar: "0.0%", fa: "۰٫۰٪" });
  });

  test("Memory: the figure in the reader's digits, its unit kept", () => {
    expect(
      inLanguages((t: Translator): string => {
        return formatBytes(1.5 * 1024 * 1024 * 1024, t);
      }),
    ).toEqual({ en: "1.5 GiB", de: "1,5 GiB", ar: "1.5 GiB", fa: "۱٫۵ GiB" });
    expect(
      inLanguages((t: Translator): string => {
        return formatBytes(5, t);
      }),
    ).toEqual({ en: "5 B", de: "5 B", ar: "5 B", fa: "۵ B" });
  });

  test("Persian: no Latin digit in any figure", () => {
    const persian: Translator = translators["fa"]!;

    for (const value of COUNTS) {
      const text: string = formatCompact(value, persian);

      expect(text).toMatch(PERSIAN_DIGIT);
      expect(text).not.toMatch(LATIN_DIGIT);
    }
    for (const value of PERCENTS) {
      expect(formatPercent(value, persian)).not.toMatch(LATIN_DIGIT);
    }
    for (const value of SIZES) {
      expect(formatBytes(value, persian)).not.toMatch(LATIN_DIGIT);
    }
  });

  test("Arabic: Latin digits in every figure, never Arabic-Indic", () => {
    const arabic: Translator = translators["ar"]!;
    const texts: Array<string> = [
      ...COUNTS.map((value: number): string => {
        return formatCompact(value, arabic);
      }),
      ...PERCENTS.map((value: number): string => {
        return formatPercent(value, arabic);
      }),
      ...SIZES.map((value: number): string => {
        return formatBytes(value, arabic);
      }),
    ];

    for (const text of texts) {
      expect(text).toMatch(LATIN_DIGIT);
      expect(text).not.toMatch(ARABIC_INDIC_DIGIT);
      expect(text).not.toMatch(PERSIAN_DIGIT);
    }
  });

  test("German: a decimal comma wherever English writes a point", () => {
    const german: Translator = translators["de"]!;

    for (const value of COUNTS) {
      expect(spaced(formatCompact(value, german))).toBe(
        formatCompact(value).replace(".", ","),
      );
    }
    for (const value of SIZES.filter((size: number): boolean => {
      return size !== 1023;
    })) {
      // German keeps the no-break space English holds its unit with (#8457).
      expect(formatBytes(value, german)).toBe(
        formatBytes(value).replace(".", ","),
      );
    }
    // A whole number of bytes from a thousand up: German's thousands point.
    expect(formatBytes(1023)).toBe("1023\u00A0B");
    expect(formatBytes(1023, german)).toBe("1.023\u00A0B");
  });
});

/*
 * The cloud apps' list and Overview cells, drawn: each reads its numbers
 * with the reader's translator (useTranslator), over the locale files the
 * Dashboard ships.
 */
describe("a cloud app's signal cells, drawn in the reader's language", () => {
  const SIGNALS: CloudAppSignals = {
    requests: 12_500,
    errors: 312,
    errorRatePercent: 2.5,
    p95Ms: 42,
  };

  beforeAll(async () => {
    const resources: Record<string, { translation: Record<string, string> }> =
      {};

    for (const language of LANGUAGES) {
      resources[language] = {
        translation: readDashboardLocaleAsDrawn(language),
      };
    }

    await i18next.use(initReactI18next).init({
      lng: "en",
      fallbackLng: "en",
      resources: resources,
      keySeparator: false,
      nsSeparator: false,
      interpolation: { escapeValue: false },
    });
  });

  afterEach(async () => {
    cleanup();
    await act(async () => {
      await i18next.changeLanguage("en");
    });
  });

  afterAll(async () => {
    await i18next.changeLanguage("en");
  });

  async function drawn(
    language: string,
    element: React.ReactElement,
    testId: string,
  ): Promise<string> {
    await act(async () => {
      await i18next.changeLanguage(language);
    });

    const { getAllByTestId } = render(element);

    return spaced(getAllByTestId(testId)[0]!.textContent || "");
  }

  test("the Requests and Error rate cells", async () => {
    const requests: Record<string, string> = {};
    const errorRate: Record<string, string> = {};

    for (const language of LANGUAGES) {
      requests[language] = await drawn(
        language,
        <CloudAppSignalCell
          kind={CloudAppSignalKind.Requests}
          signals={SIGNALS}
        />,
        "cloud-app-requests",
      );
      cleanup();
      errorRate[language] = await drawn(
        language,
        <CloudAppSignalCell
          kind={CloudAppSignalKind.ErrorRate}
          signals={SIGNALS}
        />,
        "cloud-app-error-rate",
      );
      cleanup();
    }

    expect(requests).toEqual({
      en: "12.5k",
      de: "12,5k",
      ar: "12.5k",
      fa: "۱۲٫۵k",
    });
    expect(errorRate).toEqual({
      en: "2.5%",
      de: "2,5 %",
      ar: "2.5%",
      fa: "۲٫۵٪",
    });
  });

  test("the list's one-cell summary: its rate and requests in the reader's digits", async () => {
    for (const language of LANGUAGES) {
      const summary: string = await drawn(
        language,
        <CloudAppSignalsSummaryCell signals={SIGNALS} />,
        "cloud-app-requests",
      );

      if (language === "fa") {
        expect(summary).toContain("۱۲٫۵k");
        expect(summary).not.toMatch(LATIN_DIGIT);
      } else if (language === "de") {
        expect(summary).toContain("12,5k");
      } else {
        expect(summary).toContain("12.5k");
      }
      cleanup();
    }
  });
});

describe("a site's Page loads and Exceptions tiles", () => {
  const STATS: PageLoadTileStats = {
    count: 1234,
    errorCount: 0,
    p50DurationMs: 800,
    p95DurationMs: 2400,
  };

  beforeAll(async () => {
    if (!i18next.isInitialized) {
      const resources: Record<string, { translation: Record<string, string> }> =
        {};

      for (const language of LANGUAGES) {
        resources[language] = {
          translation: readDashboardLocaleAsDrawn(language),
        };
      }

      await i18next.use(initReactI18next).init({
        lng: "en",
        fallbackLng: "en",
        resources: resources,
        keySeparator: false,
        nsSeparator: false,
        interpolation: { escapeValue: false },
      });
    }
  });

  afterEach(async () => {
    await i18next.changeLanguage("en");
  });

  async function tilesIn(language: string): Promise<Array<string>> {
    await i18next.changeLanguage(language);

    return [
      describePageLoadsTile({
        stats: STATS,
        failed: false,
        eventsTotal: 10,
      }).value,
      describePageLoadsTile({
        stats: { ...STATS, count: 0 },
        failed: false,
        eventsTotal: 0,
      }).value,
      describeExceptionsTile({
        exceptions: { total: 3_456_789, failed: false },
      }).value,
    ].map(spaced);
  }

  test("each tile's figure, in English, German, Arabic and Persian", async () => {
    expect(await tilesIn("en")).toEqual(["1.2k", "0", "3.5M"]);
    expect(await tilesIn("de")).toEqual(["1,2k", "0", "3,5M"]);
    expect(await tilesIn("ar")).toEqual(["1.2k", "0", "3.5M"]);
    expect(await tilesIn("fa")).toEqual(["۱٫۲k", "۰", "۳٫۵M"]);
  });
});

/*
 * Every tile hands the helpers the reader's translator: a call that leaves
 * it out writes English digits on every page, which is the bug.
 */
describe("every telemetry tile hands the helpers the reader's translator", () => {
  const DASHBOARD_SRC: string = path.resolve(
    __dirname,
    "../../../../App/FeatureSet/Dashboard/src",
  );
  const HELPERS: ReadonlyArray<string> = [
    "formatCompact",
    "formatPercent",
    "formatBytes",
  ];
  const TELEMETRY_IMPORT: RegExp =
    /import\s*\{([^}]*)\}\s*from\s*"[^"]*TelemetryResource\/telemetry(?:Format|Metrics)"|import\s*\{([^}]*)\}\s*from\s*"\.\/telemetry(?:Format|Metrics)"/g;
  const SOURCE_FILE: RegExp = /\.tsx?$/;
  // A call that is the first argument of writeFigureInLanguage.
  const IN_WRITE_FIGURE: RegExp = /writeFigureInLanguage\(\s*$/;

  function walk(dir: string): Array<string> {
    const files: Array<string> = [];

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full: string = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        files.push(...walk(full));
      } else if (SOURCE_FILE.test(entry.name)) {
        files.push(full);
      }
    }

    return files;
  }

  // The helpers a file imports from telemetryFormat or telemetryMetrics, by local name.
  function importedHelpers(source: string): Array<string> {
    const names: Array<string> = [];

    for (const match of source.matchAll(TELEMETRY_IMPORT)) {
      const list: string = match[1] || match[2] || "";

      for (const part of list.split(",")) {
        const [imported, local] = part
          .trim()
          .split(/\s+as\s+/)
          .map((name: string): string => {
            return name.trim();
          });

        if (imported && HELPERS.includes(imported)) {
          names.push(local || imported);
        }
      }
    }

    return names;
  }

  // Each call's top-level arguments, and the text just before it.
  function callsOf(
    source: string,
    name: string,
  ): Array<{ args: Array<string>; before: string }> {
    const calls: Array<{ args: Array<string>; before: string }> = [];
    const pattern: RegExp = new RegExp(`\\b${name}\\(`, "g");

    for (const match of source.matchAll(pattern)) {
      let depth: number = 0;
      let current: string = "";
      const args: Array<string> = [];
      let index: number = match.index! + match[0].length;

      for (; index < source.length; index++) {
        const char: string = source[index]!;

        if (char === "(" || char === "[" || char === "{") {
          depth++;
        } else if (char === ")" || char === "]" || char === "}") {
          if (depth === 0) {
            break;
          }
          depth--;
        } else if (char === "," && depth === 0) {
          args.push(current.trim());
          current = "";
          continue;
        }
        current += char;
      }
      if (current.trim()) {
        args.push(current.trim());
      }

      calls.push({
        args: args,
        before: source.slice(Math.max(0, match.index! - 40), match.index!),
      });
    }

    return calls;
  }

  test("each call passes a translator, or is written in the reader's language around it", () => {
    const offenders: Array<string> = [];
    let checked: number = 0;

    for (const file of walk(DASHBOARD_SRC)) {
      const source: string = fs.readFileSync(file, "utf8");

      for (const name of importedHelpers(source)) {
        for (const call of callsOf(source, name)) {
          checked++;

          const wrapped: boolean = IN_WRITE_FIGURE.test(call.before);

          if (call.args.length < 2 && !wrapped) {
            offenders.push(
              `${path.relative(DASHBOARD_SRC, file)}: ${name}(${call.args.join(", ")})`,
            );
          }
        }
      }
    }

    expect(offenders).toEqual([]);
    // The scan reached the tiles: a service's, a function's, a site's, a cloud app's.
    expect(checked).toBeGreaterThan(20);
  });

  test("the Overview pages the issue names are among the files scanned", () => {
    const pages: ReadonlyArray<string> = [
      "Pages/Service/View/Index.tsx",
      "Pages/Serverless/View/Overview.tsx",
      "Pages/Rum/View/Overview.tsx",
      "Pages/Rum/View/OverviewHelpers.ts",
      "Pages/AppPlatforms/View/Overview.tsx",
      "Pages/AppPlatforms/View/Instances.tsx",
      "Components/AppPlatforms/CloudAppCells.tsx",
      "Components/AppPlatforms/CloudAppOverviewTab.tsx",
      "Components/AppPlatforms/CloudAppAzureMonitorCard.tsx",
    ];

    for (const page of pages) {
      const source: string = fs.readFileSync(
        path.join(DASHBOARD_SRC, page),
        "utf8",
      );

      expect(importedHelpers(source).length).toBeGreaterThan(0);
    }
  });
});
