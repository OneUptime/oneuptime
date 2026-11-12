import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import fs from "fs";
import path from "path";
import * as React from "react";
import { createTranslator, Translator } from "../../../Types/Translator";
import {
  getTraceSpanTypeItemLabel,
  TraceSpanType,
} from "../../../Types/Telemetry/TraceSpanType";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import TelemetryResultTotal, {
  TELEMETRY_RESULT_TOTAL_TEST_ID,
} from "../../../UI/Components/TelemetryViewer/components/TelemetryResultTotal";
import {
  GENERAL_TELEMETRY_TOTAL_TEMPLATES,
  getTelemetryTotalTemplates,
  TELEMETRY_TOTAL_TEMPLATES,
  TelemetryTotalTemplates,
} from "../../../UI/Components/TelemetryViewer/components/TelemetryItemLabel";
import {
  ResultTotal,
  ResultTotalStatus,
  ResultTotalUnavailableReason,
} from "../../../UI/Utils/Telemetry/ResultTotal";

/*
 * A TELEMETRY LIST'S TOTAL IN THE READER'S LANGUAGE (#6474).
 *
 * The head of a telemetry list counts its rows: "1,234 spans", or "50+
 * spans" when the total could not be counted. It was one sentence for every
 * kind of row, "{{count}} {{itemsName}}", with the kind's noun put in. Arabic
 * writes a count as a label and its count, "الامتدادات: 1,234"
 * (Locales/ARABIC.md), and Russian in the genitive, "Спанов: 1 234"; the
 * shared sentence read "1,234 الامتدادات". Each kind now has sentences of
 * its own, which each language words around its noun - read here from the
 * Dashboard's shipped locale files, as a reader gets them.
 */

const DASHBOARD_SRC: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src",
);
const LOCALES_DIR: string = path.join(DASHBOARD_SRC, "Locales");
const I18N_DIR: string = path.join(DASHBOARD_SRC, "../i18n");
const COMMON_UI: string = path.resolve(__dirname, "../../../UI");

function readLocale(locale: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, string>;
}

// Every language the Dashboard ships besides English.
const LOCALES: Array<string> = fs
  .readdirSync(LOCALES_DIR)
  .filter((file: string): boolean => {
    return file.endsWith(".json") && file !== "en.json";
  })
  .map((file: string): string => {
    return file.replace(/\.json$/, "");
  })
  .sort();

const GLOBAL_SAME_AS_ENGLISH: Array<string> = JSON.parse(
  fs.readFileSync(path.join(I18N_DIR, "SameAsEnglish.json"), "utf8"),
) as Array<string>;

function getSameAsEnglish(locale: string): Set<string> {
  const progress: { sameAsEnglish?: Array<string> } = JSON.parse(
    fs.readFileSync(path.join(I18N_DIR, `Progress/${locale}.json`), "utf8"),
  ) as { sameAsEnglish?: Array<string> };

  return new Set<string>([
    ...GLOBAL_SAME_AS_ENGLISH,
    ...(progress.sameAsEnglish || []),
  ]);
}

const EN: Record<string, string> = readLocale("en");
const AR: Record<string, string> = readLocale("ar");
const RU: Record<string, string> = readLocale("ru");
const DE: Record<string, string> = readLocale("de");
const FA: Record<string, string> = readLocale("fa");
const JA: Record<string, string> = readLocale("ja");

function translatorFor(
  locale: Record<string, string>,
  language: string,
): Translator {
  return createTranslator((key: string): string | undefined => {
    return locale[key];
  }, language);
}

const ARABIC: Translator = translatorFor(AR, "ar");
const RUSSIAN: Translator = translatorFor(RU, "ru");
const GERMAN: Translator = translatorFor(DE, "de");
const PERSIAN: Translator = translatorFor(FA, "fa");
const JAPANESE: Translator = translatorFor(JA, "ja");

// The kinds of rows the lists count, by the label each list passes.
const KINDS: Array<string> = Object.keys(TELEMETRY_TOTAL_TEMPLATES);

const TOO_MANY: ResultTotal = {
  status: ResultTotalStatus.Unavailable,
  unavailableReason: ResultTotalUnavailableReason.TooManyToCount,
};

const TOO_MANY_EXPLANATION: string =
  "Too many to count in time. Narrow the time range for an exact total.";

// `template`, as a locale words it, with its count filled in.
function filled(
  locale: Record<string, string>,
  key: string,
  count: string,
): string {
  const template: string | undefined = locale[key];

  expect({ key, worded: typeof template === "string" }).toEqual({
    key,
    worded: true,
  });

  return (template as string).split("{{count}}").join(count);
}

function drawnTotal(): string {
  return withoutIsolateMarks(
    screen.getByTestId(TELEMETRY_RESULT_TOTAL_TEST_ID).textContent || "",
  );
}

function renderExact(count: number, itemLabel?: string): string {
  render(
    <TelemetryResultTotal
      total={{ status: ResultTotalStatus.Exact, count }}
      rowsThroughPage={Math.min(count, 50)}
      itemLabel={itemLabel}
    />,
  );

  const text: string = drawnTotal();

  cleanup();

  return text;
}

function renderLowerBound(rowsThroughPage: number, itemLabel?: string): string {
  render(
    <TelemetryResultTotal
      total={TOO_MANY}
      rowsThroughPage={rowsThroughPage}
      itemLabel={itemLabel}
    />,
  );

  const text: string = drawnTotal();

  cleanup();

  return text;
}

// True when `language` has a form of its own for one: "1 span".
function hasOneForm(language: string): boolean {
  return new Intl.PluralRules(language)
    .resolvedOptions()
    .pluralCategories.includes("one");
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      en: { translation: EN },
      ar: { translation: AR },
      ru: { translation: RU },
      de: { translation: DE },
      fa: { translation: FA },
      ja: { translation: JA },
    },
    interpolation: { escapeValue: false },
  });
});

beforeEach(async () => {
  await i18next.changeLanguage("en");
});

afterEach(() => {
  cleanup();
});

describe("each kind of row has its own total sentences", () => {
  test("the kinds the lists count, each with an exact and a lower-bound sentence", () => {
    expect(KINDS).toEqual([
      "results",
      "traces",
      "spans",
      "logs",
      "metrics",
      "exceptions",
      "security events",
    ]);

    for (const kind of KINDS) {
      const totals: TelemetryTotalTemplates = getTelemetryTotalTemplates(kind);

      expect(totals).not.toBe(GENERAL_TELEMETRY_TOTAL_TEMPLATES);
      // Each names its kind and holds the count, no noun put in.
      for (const template of [
        totals.exact.one,
        totals.exact.other,
        totals.lowerBound,
      ]) {
        expect(template).toContain("{{count}}");
        expect(template).not.toContain("{{itemsName}}");
        expect(template).not.toContain("{{itemName}}");
      }
      expect(totals.exact.other).toBe(`{{count}} ${kind}`);
      expect(totals.lowerBound).toBe(`{{count}}+ ${kind}`);
      // English has them all: the keys a translator finds.
      expect(EN[totals.exact.other]).toBe(totals.exact.other);
      expect(EN[`${totals.exact.other}_one`]).toBe(totals.exact.one);
      expect(EN[totals.lowerBound]).toBe(totals.lowerBound);
    }
  });

  test("a label is looked up by its kind, whatever its case; a label of no kind reads the general sentence", () => {
    expect(getTelemetryTotalTemplates("Spans")).toBe(
      TELEMETRY_TOTAL_TEMPLATES["spans"],
    );
    expect(getTelemetryTotalTemplates(undefined)).toBe(
      TELEMETRY_TOTAL_TEMPLATES["results"],
    );
    expect(getTelemetryTotalTemplates("events")).toBe(
      GENERAL_TELEMETRY_TOTAL_TEMPLATES,
    );
    // An object's own property only, never one it inherits.
    expect(getTelemetryTotalTemplates("constructor")).toBe(
      GENERAL_TELEMETRY_TOTAL_TEMPLATES,
    );
    expect(getTelemetryTotalTemplates("toString")).toBe(
      GENERAL_TELEMETRY_TOTAL_TEMPLATES,
    );
  });

  /*
   * Every list that shows a total passes a label with its own sentences:
   * the four explorers on the shared shell, the logs toolbar, and the
   * traces explorer, which counts traces or spans by its span type.
   */
  test("every label a telemetry list passes has sentences of its own", () => {
    const sources: Array<string> = [
      path.join(DASHBOARD_SRC, "Components/Traces/TracesViewer.tsx"),
      path.join(
        DASHBOARD_SRC,
        "Components/SecurityEvents/SecurityEventsViewer.tsx",
      ),
      path.join(DASHBOARD_SRC, "Components/Metrics/MetricsViewer.tsx"),
      path.join(DASHBOARD_SRC, "Components/Exceptions/ExceptionsViewer.tsx"),
      path.join(
        COMMON_UI,
        "Components/LogsViewer/components/LogsViewerToolbar.tsx",
      ),
    ];
    const labels: Set<string> = new Set<string>();

    for (const source of sources) {
      const text: string = fs.readFileSync(source, "utf8");

      expect(text).toMatch(/<(TelemetryViewer|TelemetryResultTotal)\b/);
      for (const match of text.matchAll(/\bitemLabel="([^"]+)"/g)) {
        labels.add(match[1] as string);
      }
    }
    for (const spanType of Object.values(TraceSpanType)) {
      labels.add(getTraceSpanTypeItemLabel(spanType));
    }

    expect([...labels].sort()).toEqual([
      "exceptions",
      "logs",
      "metrics",
      "security events",
      "spans",
      "traces",
    ]);
    for (const label of labels) {
      expect({
        label,
        ownSentences:
          getTelemetryTotalTemplates(label) !==
          GENERAL_TELEMETRY_TOTAL_TEMPLATES,
      }).toEqual({ label, ownSentences: true });
    }
  });

  test("the lists that pass a label are every list that draws the shared shell", () => {
    const TELEMETRY_VIEWER_PATTERN: RegExp = /<TelemetryViewer\b/;
    const viewers: Array<string> = [];
    const walk: (directory: string) => void = (directory: string): void => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const full: string = path.join(directory, entry.name);

        if (entry.isDirectory()) {
          walk(full);
        } else if (
          entry.name.endsWith(".tsx") &&
          TELEMETRY_VIEWER_PATTERN.test(fs.readFileSync(full, "utf8"))
        ) {
          viewers.push(path.relative(DASHBOARD_SRC, full));
        }
      }
    };

    walk(path.join(DASHBOARD_SRC, "Components"));
    walk(path.join(DASHBOARD_SRC, "Pages"));

    expect(viewers.sort()).toEqual([
      "Components/Exceptions/ExceptionsViewer.tsx",
      "Components/Metrics/MetricsViewer.tsx",
      "Components/SecurityEvents/SecurityEventsViewer.tsx",
      "Components/Traces/TracesViewer.tsx",
    ]);
  });
});

describe("every language words each kind's totals", () => {
  test.each(LOCALES)(
    "%s: every kind's totals are worded, around a count",
    (locale: string) => {
      const translations: Record<string, string> = readLocale(locale);
      const sameAsEnglish: Set<string> = getSameAsEnglish(locale);
      const unworded: Array<string> = [];
      const keys: Array<string> = [];

      for (const kind of KINDS) {
        const totals: TelemetryTotalTemplates =
          getTelemetryTotalTemplates(kind);

        keys.push(totals.exact.other, totals.lowerBound);
        if (hasOneForm(locale)) {
          keys.push(`${totals.exact.other}_one`);
        }
      }

      for (const key of keys) {
        const value: string | undefined = translations[key];

        // A locale records a wording the same as English by its English.
        if (
          typeof value !== "string" ||
          !value.includes("{{count}}") ||
          (value === EN[key] && !sameAsEnglish.has(EN[key] as string))
        ) {
          unworded.push(`${key}: ${String(value)}`);
        }
      }

      expect(unworded).toEqual([]);
    },
  );

  test.each(LOCALES)(
    "%s: the '+' sentence keeps its '+' beside the count",
    (locale: string) => {
      const translations: Record<string, string> = readLocale(locale);

      for (const kind of KINDS) {
        const key: string = getTelemetryTotalTemplates(kind).lowerBound;

        expect({ key, value: translations[key] }).toEqual({
          key,
          value: expect.stringMatching(
            /\{\{count\}\}\+|\{\{count\}\} 件以上|\{\{count\}\}개 이상/,
          ),
        });
      }
    },
  );
});

describe("a list's total, drawn in the reader's language", () => {
  test("English reads as it always has, for every kind", async () => {
    expect(renderExact(712_345, "spans")).toBe("712,345 spans");
    expect(renderExact(1, "spans")).toBe("1 span");
    expect(renderExact(68_811, "traces")).toBe("68,811 traces");
    expect(renderExact(1234, "logs")).toBe("1,234 logs");
    expect(renderExact(1, "logs")).toBe("1 log");
    expect(renderExact(3, "metrics")).toBe("3 metrics");
    expect(renderExact(1, "metrics")).toBe("1 metric");
    expect(renderExact(12, "exceptions")).toBe("12 exceptions");
    expect(renderExact(1, "security events")).toBe("1 security event");
    expect(renderExact(48_210, "security events")).toBe(
      "48,210 security events",
    );
    expect(renderExact(5)).toBe("5 results");

    expect(renderLowerBound(50, "spans")).toBe(
      `50+ spans · ${TOO_MANY_EXPLANATION}`,
    );
    for (const kind of KINDS) {
      expect(renderLowerBound(50, kind)).toBe(
        `50+ ${kind} · ${TOO_MANY_EXPLANATION}`,
      );
    }
  });

  test("a label of no kind of its own still reads its noun after the count", async () => {
    expect(renderExact(1234, "events")).toBe("1,234 events");
    expect(renderExact(1, "events")).toBe("1 event");
    expect(renderLowerBound(50, "events")).toBe(
      `50+ events · ${TOO_MANY_EXPLANATION}`,
    );
  });

  test("Arabic puts the label first and the count after it, for every kind", async () => {
    await i18next.changeLanguage("ar");

    expect(renderExact(1234, "spans")).toBe("الامتدادات: 1,234");
    expect(renderLowerBound(50, "spans")).toMatch(/^الامتدادات: 50\+/);

    for (const kind of KINDS) {
      const totals: TelemetryTotalTemplates = getTelemetryTotalTemplates(kind);
      const exact: string = renderExact(1234, kind);
      const lowerBound: string = renderLowerBound(50, kind);

      expect(exact).toBe(
        filled(AR, totals.exact.other, ARABIC.formatNumber(1234)),
      );
      expect(
        lowerBound.startsWith(
          filled(AR, totals.lowerBound, ARABIC.formatNumber(50)),
        ),
      ).toBe(true);
      // Never the count before an English-ordered noun: "1,234 الامتدادات".
      expect(exact).not.toMatch(/^\d/);
      expect(lowerBound).not.toMatch(/^\d/);
      // Latin digits, as the product writes Arabic's numbers.
      expect(exact).toContain("1,234");
    }
  });

  test("Russian counts in the genitive, and says one for 21", async () => {
    await i18next.changeLanguage("ru");

    expect(renderExact(5, "spans")).toBe("Спанов: 5");
    expect(renderExact(21, "spans")).toBe(
      filled(RU, "{{count}} spans_one", "21"),
    );
    expect(renderLowerBound(50, "spans")).toMatch(/^Спанов: 50\+/);
    expect(renderExact(1234, "logs")).toBe(
      filled(RU, "{{count}} logs", RUSSIAN.formatNumber(1234)),
    );
    expect(renderLowerBound(50, "security events")).toMatch(
      /^Событий безопасности: 50\+/,
    );
  });

  test("German writes its own noun and its own grouping", async () => {
    await i18next.changeLanguage("de");

    expect(renderExact(1234, "spans")).toBe("1.234 Spans");
    expect(renderExact(1, "spans")).toBe("1 Span");
    expect(renderExact(1234, "metrics")).toBe(
      filled(DE, "{{count}} metrics", GERMAN.formatNumber(1234)),
    );
    expect(renderLowerBound(50, "logs")).toMatch(
      new RegExp(`^${filled(DE, "{{count}}+ logs", "50").replace("+", "\\+")}`),
    );
  });

  test("Persian writes its own digits; Japanese its own counter", async () => {
    await i18next.changeLanguage("fa");

    expect(renderExact(1234, "spans")).toBe(
      filled(FA, "{{count}} spans", PERSIAN.formatNumber(1234)),
    );
    expect(renderExact(1234, "spans")).toContain("۱٬۲۳۴");

    await i18next.changeLanguage("ja");

    expect(renderExact(1234, "traces")).toBe(
      filled(JA, "{{count}} traces", JAPANESE.formatNumber(1234)),
    );
    // Japanese has no form of its own for one: "スパン 1 件".
    expect(renderExact(1, "spans")).toBe(filled(JA, "{{count}} spans", "1"));
    expect(renderLowerBound(50, "spans")).toMatch(/^スパン 50 件以上/);
  });
});
