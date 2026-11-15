// UX rule: Docs/ux/README.md#numbers-dates-and-plurals
import { afterEach, describe, expect, test } from "@jest/globals";
import {
  DATABASE_RATE_UNITS,
  DATABASE_UNIT_COUNTS,
  DATABASE_UNIT_READINGS,
  formatDatabaseMetricValue,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Database/Utils/DatabaseServerPresentation";
import { formatMessageQueueMetricValue } from "../../../../App/FeatureSet/Dashboard/src/Components/MessageQueue/MessageQueueOverviewPresentation";
import { formatMessageQueueHeadlineFull } from "../../../../App/FeatureSet/Dashboard/src/Components/MessageQueue/Topology/MessageQueueTopologyPresentation";
import { MessageQueueHeadlineValue } from "../../../../App/FeatureSet/Dashboard/src/Components/MessageQueue/Topology/MessageQueueBrokerHeadlines";
import {
  DATABASE_SERVER_METRICS,
  DatabaseServerMetricKind,
} from "../../../Types/DatabaseServer/DatabaseServerMetricCatalog";
import {
  MESSAGE_QUEUE_METRICS,
  MessageQueueMetricDescriptor,
} from "../../../Types/MessageQueue/MessageQueueMetricCatalog";
import { setDateDisplayLanguage } from "../../../Types/DateLanguage";
import {
  createTranslator,
  DEFAULT_LANGUAGE,
  PluralTemplate,
  Translator,
} from "../../../Types/Translator";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  isWordedInDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * A DATABASE'S AND A QUEUE'S ENGINE METRIC TILES, THEIR UNIT IN THE
 * READER'S LANGUAGE (#8482).
 *
 * The tiles wrote their figure in the reader's digits (#8283) and the
 * catalog's English unit word after it, made singular by English's rules:
 * "۲۴ connections" on a Persian page, "12,5 commits/s" on a German one.
 * Under the rule for a figure and its unit (Docs/ux/README.md#numbers-
 * dates-and-plurals) the unit is the reader's too: each unit the catalogs
 * count in is a plural sentence of the locale, its noun agreeing with the
 * number by the language's own rules.
 *
 *   - English reads exactly as it always did, for every catalog unit;
 *   - German writes "1 Verbindung", "24 Verbindungen", "12,5 Commits/s";
 *   - Arabic writes Latin digits and its own words;
 *   - Persian writes no Latin digit and no English word.
 */

const LANGUAGES: ReadonlyArray<string> = ["en", "de", "ar", "fa"];

const translators: Record<string, Translator> = Object.fromEntries(
  LANGUAGES.map((language: string): [string, Translator] => {
    return [language, dashboardTranslator(language)];
  }),
);

// A unit the formatter writes its own way, not as a counted word.
const FORMATTED_UNITS: ReadonlyArray<string> = [
  "",
  "%",
  "bytes",
  "fraction",
  "ms",
  "s",
];

const LATIN_DIGIT: RegExp = /[0-9]/;
const LATIN_LETTER: RegExp = /[A-Za-z]/;
const PERSIAN_DIGIT: RegExp = /[\u{06F0}-\u{06F9}]/u;
const ARABIC_LETTER: RegExp = /[\u{0600}-\u{06FF}]/u;
// The scale letter a compact figure keeps ("۲٫۵k"): a figure's, not a word's.
const SCALE_LETTER_AFTER_A_FIGURE: RegExp =
  /(?<=[0-9\u{06F0}-\u{06F9}])[kMBT]/gu;

// A tile's text as read: no isolating marks, no-break spaces as spaces.
function spaced(text: string): string {
  return withoutIsolateMarks(text).replace(/[\u00a0\u202f]/g, " ");
}

function tile(
  value: number,
  unit: string,
  kind: DatabaseServerMetricKind,
  language?: string,
): string {
  return spaced(
    formatDatabaseMetricValue(
      value,
      unit,
      kind,
      language
        ? translators[language] || dashboardTranslator(language)
        : undefined,
    ),
  );
}

function inLanguages(
  value: number,
  unit: string,
  kind: DatabaseServerMetricKind,
): Record<string, string> {
  return Object.fromEntries(
    LANGUAGES.map((language: string): [string, string] => {
      return [language, tile(value, unit, kind, language)];
    }),
  );
}

// Every unit the two catalogs' tiles are written in, deduplicated.
function getCatalogUnits(): Array<string> {
  const units: Set<string> = new Set<string>();

  for (const metric of DATABASE_SERVER_METRICS) {
    units.add((metric.unit || "").trim());
  }
  for (const metric of MESSAGE_QUEUE_METRICS) {
    units.add((metric.unit || "").trim());
  }

  return [...units].sort();
}

const COUNTED_UNITS: ReadonlyArray<string> = Object.keys(DATABASE_UNIT_COUNTS);
const READING_UNITS: ReadonlyArray<string> = Object.keys(
  DATABASE_UNIT_READINGS,
);

// Values a tile meets: none, one, one rounded, a share, a few, thousands, millions.
const VALUES: ReadonlyArray<number> = [
  0, 1, 1.004, 1.5, 2, 5, 12.5, 21, 24, 999, 2500, 3_400_000,
];

const KINDS: ReadonlyArray<DatabaseServerMetricKind> = ["gauge", "counter"];

afterEach(() => {
  setDateDisplayLanguage("en");
});

describe("every unit the catalogs count in is a sentence of the locale", () => {
  test("each catalog unit is a counted word, a reading, a rate or a formatted unit", () => {
    const unworded: Array<string> = getCatalogUnits().filter(
      (unit: string): boolean => {
        return (
          !FORMATTED_UNITS.includes(unit) &&
          !COUNTED_UNITS.includes(unit) &&
          !READING_UNITS.includes(unit) &&
          !(unit in DATABASE_RATE_UNITS)
        );
      },
    );

    expect(unworded).toEqual([]);
  });

  test("the tables name no unit the catalogs do not use", () => {
    const units: Array<string> = getCatalogUnits();

    expect(
      [...COUNTED_UNITS, ...READING_UNITS, ...Object.keys(DATABASE_RATE_UNITS)]
        .filter((unit: string): boolean => {
          return !units.includes(unit);
        })
        .sort(),
    ).toEqual([]);
  });

  test("a rate's unit counts a unit the table words", () => {
    for (const counted of Object.values(DATABASE_RATE_UNITS)) {
      expect(COUNTED_UNITS).toContain(counted);
    }
  });

  test("each counted unit's English forms are the unit and its singular", () => {
    for (const unit of COUNTED_UNITS) {
      const template: PluralTemplate = DATABASE_UNIT_COUNTS[unit]!;

      expect(template.other).toBe(`{{count}} ${unit}`);
      expect(template.one).toMatch(/^\{\{count\}\} [a-z]+$/);
      expect(template.one).not.toBe(template.other);
    }
  });

  test("each reading's English is the figure, then the unit", () => {
    for (const unit of READING_UNITS) {
      expect(DATABASE_UNIT_READINGS[unit]).toBe(`{{value}} ${unit}`);
    }
  });

  test("every Dashboard language words every unit's sentence and its one form", () => {
    const missing: Array<string> = [];

    for (const language of DASHBOARD_LANGUAGES) {
      for (const unit of COUNTED_UNITS) {
        for (const key of [`{{count}} ${unit}`, `{{count}} ${unit}_one`]) {
          if (!isWordedInDashboardLocale(key, language)) {
            missing.push(`${language}: ${key}`);
          }
        }
      }
      for (const unit of READING_UNITS) {
        const key: string = `{{value}} ${unit}`;

        if (!isWordedInDashboardLocale(key, language)) {
          missing.push(`${language}: ${key}`);
        }
      }
    }

    expect(missing).toEqual([]);
  });
});

describe("English reads exactly as it always did", () => {
  const english: Translator = createTranslator(undefined, DEFAULT_LANGUAGE);

  test("the English translator and none write every catalog unit alike", () => {
    for (const unit of getCatalogUnits()) {
      for (const kind of KINDS) {
        for (const value of VALUES) {
          expect(formatDatabaseMetricValue(value, unit, kind, english)).toBe(
            formatDatabaseMetricValue(value, unit, kind),
          );
          expect(
            formatDatabaseMetricValue(value, unit, kind, translators["en"]!),
          ).toBe(formatDatabaseMetricValue(value, unit, kind));
        }
      }
    }
  });

  test("a count, its singular for exactly one, a rate and a reading", () => {
    expect(tile(1, "databases", "gauge", "en")).toBe("1 database");
    expect(tile(24, "connections", "gauge", "en")).toBe("24 connections");
    expect(tile(1.004, "connections", "gauge", "en")).toBe("1 connection");
    expect(tile(2500, "connections", "gauge", "en")).toBe("2.5k connections");
    expect(tile(1, "processes", "gauge", "en")).toBe("1 process");
    expect(tile(1, "queries", "gauge", "en")).toBe("1 query");
    expect(tile(12.5, "commits", "counter", "en")).toBe("12.5 commits/s");
    expect(tile(1, "commits", "counter", "en")).toBe("1 commit/s");
    expect(tile(12, "ops/s", "gauge", "en")).toBe("12 ops/s");
    expect(tile(1, "ops/s", "gauge", "en")).toBe("1 ops/s");
    expect(tile(0.75, "ratio", "gauge", "en")).toBe("0.75 ratio");
    expect(tile(1, "state", "gauge", "en")).toBe("1 state");
    expect(tile(0.5, "share", "gauge", "en")).toBe("0.5 share");
    expect(tile(2500, "widgets", "gauge", "en")).toBe("2.5k widgets");
  });
});

describe("a tile's count in German, Arabic and Persian", () => {
  test("a count of connections: the noun agrees with the number", () => {
    expect(inLanguages(1, "connections", "gauge")).toEqual({
      en: "1 connection",
      de: "1 Verbindung",
      ar: "1 اتصال",
      fa: "۱ اتصال",
    });
    expect(inLanguages(24, "connections", "gauge")).toEqual({
      en: "24 connections",
      de: "24 Verbindungen",
      ar: "الاتصالات: 24",
      fa: "۲۴ اتصال",
    });
    expect(inLanguages(2500, "connections", "gauge")).toEqual({
      en: "2.5k connections",
      de: "2,5k Verbindungen",
      ar: "الاتصالات: 2.5k",
      fa: "۲٫۵k اتصال",
    });
  });

  test("the form agrees with the number shown, not the number measured", () => {
    // 1.004 reads "1": one connection.
    expect(tile(1.004, "connections", "gauge", "de")).toBe("1 Verbindung");
    expect(tile(1.004, "connections", "gauge", "ar")).toBe("1 اتصال");
    // 1.5 is no "one" in German.
    expect(tile(1.5, "connections", "gauge", "de")).toBe("1,5 Verbindungen");
    expect(tile(0, "connections", "gauge", "de")).toBe("0 Verbindungen");
  });

  test("each language's own plural rules, not English's", () => {
    // French counts 0 as one; Russian counts 21 as one and 24 as neither.
    expect(tile(0, "connections", "gauge", "fr")).toBe("0 connexion");
    expect(tile(21, "connections", "gauge", "ru")).toBe("21 подключение");
    expect(tile(24, "connections", "gauge", "ru")).toBe("Подключений: 24");
    // Arabic's two, few and many read its general sentence.
    expect(tile(2, "connections", "gauge", "ar")).toBe("الاتصالات: 2");
    expect(tile(5, "connections", "gauge", "ar")).toBe("الاتصالات: 5");
    expect(tile(24, "connections", "gauge", "ar")).toBe("الاتصالات: 24");
  });

  test("a counter's rate: the count's sentence, per second", () => {
    expect(inLanguages(12.5, "commits", "counter")).toEqual({
      en: "12.5 commits/s",
      de: "12,5 Commits/s",
      // The sentence a git commit's count shares (AIReadTableWords).
      ar: "الإيداعات: 12.5/ث",
      fa: "۱۲٫۵ کامیت/ثانیه",
    });
    expect(inLanguages(1, "commits", "counter")).toEqual({
      en: "1 commit/s",
      de: "1 Commit/s",
      ar: "1 إيداع/ث",
      fa: "۱ کامیت/ثانیه",
    });
    expect(inLanguages(2500, "transactions", "counter")).toEqual({
      en: "2.5k transactions/s",
      de: "2,5k Transaktionen/s",
      ar: "المعاملات: 2.5k/ث",
      fa: "۲٫۵k تراکنش/ثانیه",
    });
  });

  test("a gauge already a rate (Redis's ops/s) counts operations per second", () => {
    expect(inLanguages(12, "ops/s", "gauge")).toEqual({
      en: "12 ops/s",
      de: "12 Vorgänge/s",
      ar: "العمليات: 12/ث",
      fa: "۱۲ عملیات/ثانیه",
    });
    expect(tile(1, "ops/s", "gauge", "de")).toBe("1 Vorgang/s");
  });

  test("a unit that counts no things reads as one sentence", () => {
    expect(inLanguages(0.75, "ratio", "gauge")).toEqual({
      en: "0.75 ratio",
      de: "Verhältnis 0,75",
      ar: "النسبة: 0.75",
      fa: "نسبت ۰٫۷۵",
    });
    expect(inLanguages(1, "state", "gauge")).toEqual({
      en: "1 state",
      de: "Status 1",
      ar: "الحالة: 1",
      fa: "وضعیت ۱",
    });
    expect(inLanguages(0.5, "share", "gauge")).toEqual({
      en: "0.5 share",
      de: "Anteil 0,5",
      ar: "الحصة: 0.5",
      fa: "سهم ۰٫۵",
    });
  });

  test("a unit no table words keeps its word, its figure in the reader's digits", () => {
    expect(inLanguages(2500, "widgets", "gauge")).toEqual({
      en: "2.5k widgets",
      de: "2,5k widgets",
      ar: "2.5k widgets",
      fa: "۲٫۵k widgets",
    });
  });

  test("the units a formatter writes its own way are unchanged by the tables", () => {
    expect(tile(2048, "bytes", "gauge", "de")).toBe("2,0 KiB");
    expect(tile(0.5, "fraction", "gauge", "de")).toBe("50 %");
    expect(tile(12, "", "gauge", "de")).toBe("12");
    expect(tile(3, "", "counter", "de")).toBe("3/s");
  });
});

describe("no English word on a German, Arabic or Persian tile", () => {
  test("German: every counted unit, gauge and rate, in German words", () => {
    for (const unit of COUNTED_UNITS) {
      for (const kind of KINDS) {
        const text: string = tile(24, unit, kind, "de");

        expect(text).not.toContain(` ${unit}`);
        expect(text).toMatch(/^24 /);
      }
    }
  });

  test("Arabic: every unit in Arabic words, its figures in Latin digits", () => {
    for (const unit of [...COUNTED_UNITS, ...READING_UNITS]) {
      for (const kind of KINDS) {
        for (const value of VALUES) {
          const text: string = tile(value, unit, kind, "ar");

          expect(text).toMatch(ARABIC_LETTER);
          expect(text).toMatch(LATIN_DIGIT);
          expect(text).not.toMatch(PERSIAN_DIGIT);
          expect(text.replace(SCALE_LETTER_AFTER_A_FIGURE, "")).not.toMatch(
            LATIN_LETTER,
          );
        }
      }
    }
  });

  test("Persian: every unit in Persian words, no Latin digit", () => {
    for (const unit of [...COUNTED_UNITS, ...READING_UNITS]) {
      for (const kind of KINDS) {
        for (const value of VALUES) {
          const text: string = tile(value, unit, kind, "fa");

          expect(text).toMatch(PERSIAN_DIGIT);
          expect(text).not.toMatch(LATIN_DIGIT);
          expect(text.replace(SCALE_LETTER_AFTER_A_FIGURE, "")).not.toMatch(
            LATIN_LETTER,
          );
        }
      }
    }
  });

  test("every language: a count of 24 of each unit is no English sentence", () => {
    const english: Array<string> = [];

    for (const language of DASHBOARD_LANGUAGES) {
      for (const unit of COUNTED_UNITS) {
        const text: string = tile(24, unit, "gauge", language);

        if (
          text === `24 ${unit}` &&
          isWordedInDashboardLocale(`{{count}} ${unit}`, language) === false
        ) {
          english.push(`${language}: ${text}`);
        }
      }
    }

    expect(english).toEqual([]);
  });
});

describe("a queue's broker tiles and topology headlines", () => {
  test("a broker metric's tile words its unit as the database's do", () => {
    expect(
      spaced(
        formatMessageQueueMetricValue(
          1500,
          { unit: "messages", kind: "gauge" },
          translators["de"]!,
        ),
      ),
    ).toBe("1,5k Nachrichten");
    expect(
      spaced(
        formatMessageQueueMetricValue(
          1,
          { unit: "consumers", kind: "gauge" },
          translators["de"]!,
        ),
      ),
    ).toBe("1 Consumer");
    expect(
      spaced(
        formatMessageQueueMetricValue(
          2.5,
          { unit: "messages", kind: "counter" },
          translators["fa"]!,
        ),
      ),
    ).toBe("۲٫۵ پیام/ثانیه");
    expect(
      spaced(
        formatMessageQueueMetricValue(
          1,
          { unit: "messages", kind: "gauge" },
          translators["ar"]!,
        ),
      ),
    ).toBe("1 رسالة");
    expect(
      formatMessageQueueMetricValue(1500, { unit: "messages", kind: "gauge" }),
    ).toBe("1.5k messages");
  });

  test("a topology headline reads as the tile does", () => {
    const descriptor: MessageQueueMetricDescriptor | undefined =
      MESSAGE_QUEUE_METRICS.find(
        (metric: MessageQueueMetricDescriptor): boolean => {
          return metric.unit === "messages" && metric.kind === "gauge";
        },
      );

    expect(descriptor).toBeDefined();

    const headline: MessageQueueHeadlineValue = {
      value: 24,
      descriptor: descriptor!,
    };

    expect(
      spaced(formatMessageQueueHeadlineFull(headline, translators["de"]!)),
    ).toBe("24 Nachrichten");
    expect(
      spaced(formatMessageQueueHeadlineFull(headline, translators["fa"]!)),
    ).toBe("۲۴ پیام");
    expect(spaced(formatMessageQueueHeadlineFull(headline))).toBe(
      "24 messages",
    );
  });
});
