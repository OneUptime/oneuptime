import fs from "fs";
import path from "path";
import { describe, expect, test } from "@jest/globals";
import { createTranslator, Translator } from "../../UI/Utils/TranslateTemplate";
import CronTab, { CronScheduleShape } from "../../Utils/CronTab";
import { describeCronSchedule } from "../../Utils/CronScheduleText";
import MonitorCheckScheduleUtil from "../../Utils/Monitor/MonitorCheckScheduleUtil";

/*
 * A cron schedule in words in the reader's language: the monitor's
 * interval on its overview, a workflow's schedule in its trigger form.
 * CronTab says which shape a schedule has; each shape's sentence is looked
 * up whole, and the weekdays and days of a month in it are written the way
 * the sentence's language writes them. English, and no translator at all,
 * read exactly as CronTab always described them.
 */

const LOCALES_DIRECTORY: string = path.join(
  __dirname,
  "../../../App/FeatureSet/Dashboard/src/Locales",
);

const LANGUAGES: Array<string> = [
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

const readLocale: (language: string) => Record<string, unknown> = (
  language: string,
): Record<string, unknown> => {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIRECTORY, `${language}.json`), "utf8"),
  ) as Record<string, unknown>;
};

const translatorFor: (
  language: string,
  without?: Array<string>,
) => Translator = (language: string, without?: Array<string>): Translator => {
  const locale: Record<string, unknown> = readLocale(language);

  return createTranslator((text: string): string | undefined => {
    if (without && without.includes(text)) {
      return undefined;
    }

    const value: unknown = locale[text];

    return typeof value === "string" ? value : undefined;
  }, language);
};

const ENGLISH: Translator = createTranslator(undefined, "en");

// Every shape CronTab words as a sentence, and the field-by-field fallback.
const EXPRESSIONS: Array<string> = [
  "* * * * *",
  "*/1 * * * *",
  "*/5 * * * *",
  "*/20 * * * *",
  "*/30 * * * *",
  "0 * * * *",
  "15 * * * *",
  "0 */2 * * *",
  "5 */6 * * *",
  "0 */18 * * *",
  "0 0 * * *",
  "30 9 * * *",
  "0 9 * * 1",
  "0 0 * * 0",
  "0 9 * * 1,3,5",
  "0 0 1 * *",
  "0 12 1,15 * *",
  "0 0 1 */3 *",
  "0 0 1 */6 *",
  "0 0 1 1 *",
  "0 0 1,15 1,7 *",
  "15,45 8-10 * * *",
  "0 0 * * 1-5",
  "30 0 0 * * *",
];

describe("CronTab's schedule shapes", () => {
  const cases: Array<[string, CronScheduleShape]> = [
    ["* * * * *", { kind: "everyMinute" }],
    ["*/1 * * * *", { kind: "everyMinute" }],
    ["*/5 * * * *", { kind: "everyMinutes", step: 5 }],
    ["0 * * * *", { kind: "everyHourOnTheHour" }],
    ["15 * * * *", { kind: "everyHours", step: 1, minute: 15 }],
    ["0 */2 * * *", { kind: "everyHours", step: 2, minute: 0 }],
    ["5 */6 * * *", { kind: "everyHours", step: 6, minute: 5 }],
    ["30 9 * * *", { kind: "daily", hour: 9, minute: 30 }],
    [
      "0 9 * * 1,3,5",
      { kind: "weekly", weekdays: [1, 3, 5], hour: 9, minute: 0 },
    ],
    [
      "0 12 1,15 * *",
      {
        kind: "monthly",
        daysOfMonth: [1, 15],
        monthStep: 1,
        hour: 12,
        minute: 0,
      },
    ],
    [
      "0 0 1 */3 *",
      { kind: "monthly", daysOfMonth: [1], monthStep: 3, hour: 0, minute: 0 },
    ],
    [
      "0 0 1 1 *",
      { kind: "yearly", daysOfMonth: [1], months: [1], hour: 0, minute: 0 },
    ],
    ["15,45 8-10 * * *", { kind: "fieldByField" }],
    ["30 0 0 * * *", { kind: "fieldByField" }],
  ];

  test.each(cases)("%s", (expression: string, shape: CronScheduleShape) => {
    expect(CronTab.getScheduleShape(expression)).toEqual(shape);
  });

  test("an expression that cannot be parsed has no shape", () => {
    expect(CronTab.getScheduleShape("nonsense")).toBeNull();
  });
});

describe("in English, word for word as CronTab describes it", () => {
  test.each(EXPRESSIONS)("%s", (expression: string) => {
    const english: string | null =
      CronTab.getHumanReadableDescription(expression);

    expect(english).toBeTruthy();
    expect(describeCronSchedule(expression)).toBe(english);
    expect(describeCronSchedule(expression, ENGLISH)).toBe(english);
    expect(describeCronSchedule(expression, translatorFor("en"))).toBe(english);
  });

  test("an expression that cannot be parsed is described as nothing", () => {
    expect(describeCronSchedule("nonsense")).toBeNull();
    expect(describeCronSchedule("nonsense", translatorFor("de"))).toBeNull();
  });
});

describe("in German", () => {
  const GERMAN: Translator = translatorFor("de");

  const cases: Array<[string, string]> = [
    ["* * * * *", "Jede Minute"],
    ["*/5 * * * *", "Alle 5 Minuten"],
    ["0 * * * *", "Jede Stunde, zur vollen Stunde"],
    ["15 * * * *", "Jede Stunde zur Minute 15"],
    ["5 * * * *", "Jede Stunde zur Minute 05"],
    ["0 */2 * * *", "Alle 2 Stunden"],
    ["5 */6 * * *", "Alle 6 Stunden zur Minute 05"],
    ["30 9 * * *", "Jeden Tag um 09:30 (UTC)"],
    ["0 9 * * 1", "Jede Woche am Montag um 09:00 (UTC)"],
    [
      "0 9 * * 1,3,5",
      "Jede Woche am Montag, Mittwoch und Freitag um 09:00 (UTC)",
    ],
    ["0 0 1 * *", "Jeden Monat am 1. um 00:00 (UTC)"],
    ["0 12 1,15 * *", "Jeden Monat am 1. und 15. um 12:00 (UTC)"],
    ["0 0 1 */3 *", "Alle 3 Monate am 1. um 00:00 (UTC)"],
    // A yearly schedule names its dates as German writes a date.
    ["0 0 1 1 *", "Jedes Jahr am 1. Januar um 00:00 (UTC)"],
    [
      "0 0 1,15 3,9 *",
      "Jedes Jahr am 1. März, 15. März, 1. September und 15. September um 00:00 (UTC)",
    ],
    ["30 6 29 2 *", "Jedes Jahr am 29. Februar um 06:30 (UTC)"],
    // As many dates as a sentence names (MAX_YEARLY_DATES_IN_WORDS).
    [
      "0 0 1,10,20 2,9 *",
      "Jedes Jahr am 1. Februar, 10. Februar, 20. Februar, 1. September, 10. September und 20. September um 00:00 (UTC)",
    ],
  ];

  test.each(cases)("%s reads %s", (expression: string, german: string) => {
    expect(describeCronSchedule(expression, GERMAN)).toBe(german);
  });

  test("one only cron's fields can describe reads in English, and so does a year of more dates than a sentence can name", () => {
    for (const expression of [
      "15,45 8-10 * * *",
      // Three days of three months: nine dates.
      "0 0 1,10,20 2,9,11 *",
      // A day April does not have: it never runs.
      "0 0 31 4 *",
    ]) {
      expect(describeCronSchedule(expression, GERMAN)).toBe(
        CronTab.getHumanReadableDescription(expression),
      );
    }
  });

  test("a yearly schedule German has not worded reads in English, its dates too", () => {
    expect(
      describeCronSchedule(
        "0 0 1 1 *",
        translatorFor("de", ["Every year on {{dates}} at {{time}} (UTC)"]),
      ),
    ).toBe("On the 1st of January at 00:00 (UTC)");
  });

  test("a sentence German has not worded reads in English, its weekdays too", () => {
    expect(
      describeCronSchedule(
        "0 9 * * 1,3,5",
        translatorFor("de", ["Every week on {{days}} at {{time}} (UTC)"]),
      ),
    ).toBe("Every week on Monday, Wednesday and Friday at 09:00 (UTC)");
    expect(
      describeCronSchedule(
        "0 12 1,15 * *",
        translatorFor("de", ["Every month on the {{days}} at {{time}} (UTC)"]),
      ),
    ).toBe("Every month on the 1st and 15th at 12:00 (UTC)");
  });
});

describe("in every language", () => {
  test.each(LANGUAGES)(
    "%s: each shape worded as a sentence reads in the language",
    (language: string) => {
      const translator: Translator = translatorFor(language);

      for (const expression of [
        "*/5 * * * *",
        "0 * * * *",
        "15 * * * *",
        "0 */2 * * *",
        "5 */6 * * *",
        "30 9 * * *",
        "0 9 * * 1",
        "0 12 1,15 * *",
        "0 0 1 */3 *",
        "0 0 1 1 *",
      ]) {
        const english: string | null =
          CronTab.getHumanReadableDescription(expression);
        const translated: string | null = describeCronSchedule(
          expression,
          translator,
        );

        expect(translated).toBeTruthy();
        expect(translated).not.toBe(english);
        // None of the English sentence's own words is left in it.
        for (const words of [
          "Every",
          " at minute ",
          "on the hour",
          "day at",
          "January",
          "1st",
        ]) {
          expect(translated).not.toContain(words);
        }
      }
    },
  );

  test.each(LANGUAGES)(
    "%s: a weekday is the language's own",
    (language: string) => {
      const translated: string | null = describeCronSchedule(
        "0 9 * * 1",
        translatorFor(language),
      );

      expect(translated).not.toContain("Monday");
    },
  );

  /*
   * Intl writes a day of a month in the case its language's dates take:
   * Russian "1 января" (of January), Spanish "1 de enero".
   */
  test.each([
    ["ru", "Каждый год 1 января в 00:00 (UTC)"],
    ["es", "Cada año el 1 de enero a las 00:00 (UTC)"],
    ["fr", "Chaque année le 1 janvier à 00:00 (UTC)"],
    ["ja", "毎年 1月1日 00:00 (UTC)"],
    ["fa", "هر سال 1 ژانویه ساعت 00:00 (UTC)"],
  ])(
    "%s: a yearly schedule's date as the language writes a date",
    (language: string, expected: string) => {
      expect(describeCronSchedule("0 0 1 1 *", translatorFor(language))).toBe(
        expected,
      );
    },
  );

  /*
   * A language's "one" form covers more counts than 1: Russian reads 21
   * minutes in it. The "one" form of a step is never English's "Every
   * minute".
   */
  test("the one form of a step keeps its count", () => {
    const oneForm: Translator = createTranslator(
      (text: string): string | undefined => {
        return text === "Every {{count}} minutes_one"
          ? "Каждую {{count}} минуту"
          : text === "Every {{count}} minutes"
            ? "Каждые {{count}} минут"
            : undefined;
      },
      "ru",
    );

    expect(describeCronSchedule("*/20 * * * *", oneForm)).toBe(
      "Каждые 20 минут",
    );
    // 0, 21 and 42 past the hour: CronTab reads it as every 21 minutes.
    expect(describeCronSchedule("*/21 * * * *", oneForm)).toBe(
      "Каждую 21 минуту",
    );
  });
});

describe("a monitor's interval", () => {
  test("in English without a translator, as it always read", () => {
    expect(MonitorCheckScheduleUtil.describeInterval("*/5 * * * *")).toBe(
      "Every 5 minutes",
    );
    expect(MonitorCheckScheduleUtil.describeInterval(undefined)).toBe(
      "Every minute",
    );
  });

  test("in the reader's language with one, the fallback included", () => {
    const german: Translator = translatorFor("de");

    expect(
      MonitorCheckScheduleUtil.describeInterval("*/5 * * * *", german),
    ).toBe("Alle 5 Minuten");
    // No interval, or one that never runs, is checked every minute.
    expect(MonitorCheckScheduleUtil.describeInterval(undefined, german)).toBe(
      "Jede Minute",
    );
    expect(MonitorCheckScheduleUtil.describeInterval("5m", german)).toBe(
      "Alle 5 Minuten",
    );
  });
});
