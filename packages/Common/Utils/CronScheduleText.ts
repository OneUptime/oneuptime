import CronTab, { CronScheduleShape } from "./CronTab";
import { getDateLocale, isEnglishDateLanguage } from "../Types/DateLanguage";
import {
  composedValue,
  ComposedValue,
  translationKey,
  Translator,
} from "../UI/Utils/TranslateTemplate";

/*
 * A cron schedule in words, in a reader's language: "Alle 5 Minuten", "Jede
 * Woche am Montag und Freitag um 09:30 (UTC)".
 *
 * CronTab says what shape a schedule has (getScheduleShape) and words it in
 * English (getHumanReadableDescription). Here each shape's sentence is looked
 * up whole in the reader's locale, the way every other sentence is
 * (Common/UI/Utils/TranslateTemplate), and the names in it - weekdays, the
 * days of a month - are written the way the sentence's language writes them,
 * from the browser's Intl data, as dates are (Common/Types/DateLanguage). A
 * sentence the reader's language has not worded yet reads in English, names
 * and all.
 *
 * A schedule on given days of given months ("Jedes Jahr am 1. Januar um
 * 00:00 (UTC)") names its dates as the language writes a date, so the day
 * and the month take the case and order the language gives them; one that
 * names more than MAX_YEARLY_DATES_IN_WORDS dates reads in English, as does
 * one CronTab can only list field by field ("minute 5, 35, hour 3 (UTC)"),
 * which is cron's own terms rather than a sentence.
 *
 * Without a translator, and in English, this is getHumanReadableDescription
 * word for word. Null when the expression cannot be parsed.
 */

// 1 January 2023 was a Sunday: weekday 0.
const A_SUNDAY_MS: number = Date.UTC(2023, 0, 1);
const DAY_MS: number = 24 * 60 * 60 * 1000;

const formatEach: (data: {
  values: Array<number>;
  locale: string;
  options: Intl.DateTimeFormatOptions;
  toDate: (value: number) => Date;
}) => Array<string> | null = (data: {
  values: Array<number>;
  locale: string;
  options: Intl.DateTimeFormatOptions;
  toDate: (value: number) => Date;
}): Array<string> | null => {
  try {
    const format: Intl.DateTimeFormat = new Intl.DateTimeFormat(data.locale, {
      ...data.options,
      timeZone: "UTC",
    });

    return data.values.map((value: number): string => {
      return format.format(data.toDate(value));
    });
  } catch {
    return null;
  }
};

/*
 * The parts of Intl.ListFormat used here, typed structurally: Common
 * compiles against the ES2017 library, which does not declare it.
 */
interface ConjunctionList {
  format: (items: Array<string>) => string;
}

type ConjunctionListConstructor = new (
  locale: string,
  options: { type: "conjunction"; style: "long" },
) => ConjunctionList;

// "Montag und Freitag", "lundi et vendredi", "月曜日と金曜日".
const joinInLocale: (items: Array<string>, locale: string) => string = (
  items: Array<string>,
  locale: string,
): string => {
  try {
    const ListFormat: ConjunctionListConstructor | undefined = (
      Intl as unknown as {
        ListFormat?: ConjunctionListConstructor | undefined;
      }
    ).ListFormat;

    if (ListFormat) {
      return new ListFormat(locale, {
        type: "conjunction",
        style: "long",
      }).format(items);
    }
  } catch {
    // Joined with commas below.
  }

  return items.join(", ");
};

/*
 * A list of names in the sentence's language: English as CronTab writes it
 * when the sentence is English, the language's own names otherwise (and the
 * English again where Intl cannot write them).
 */
const namesInSentence: (data: {
  english: string;
  localized: (locale: string) => Array<string> | null;
}) => ComposedValue = (data: {
  english: string;
  localized: (locale: string) => Array<string> | null;
}): ComposedValue => {
  return composedValue((sentence: Translator): string => {
    if (isEnglishDateLanguage(sentence.language)) {
      return data.english;
    }

    const locale: string = getDateLocale(sentence.language);

    // A language Intl does not know reads English.
    if (locale.startsWith("en-")) {
      return data.english;
    }

    const names: Array<string> | null = data.localized(locale);

    return names && names.length > 0
      ? joinInLocale(names, locale)
      : data.english;
  });
};

// "Monday and Friday", "Montag und Freitag".
const weekdaysInSentence: (weekdays: Array<number>) => ComposedValue = (
  weekdays: Array<number>,
): ComposedValue => {
  return namesInSentence({
    english: CronTab.describeWeekdays(weekdays),
    localized: (locale: string): Array<string> | null => {
      return formatEach({
        values: weekdays,
        locale: locale,
        options: { weekday: "long" },
        toDate: (weekday: number): Date => {
          return new Date(A_SUNDAY_MS + weekday * DAY_MS);
        },
      });
    },
  });
};

/*
 * What follows a day of the month where a language writes one: German's
 * "15.", Japanese and Chinese "15日", Korean "15일". Spanish "15 de" and the
 * like are a date's words, not the day's, and stay out.
 */
const DAY_OF_MONTH_MARKER: RegExp = /^(\.|日|일)$/u;

/*
 * A day of the month as the language writes it in a date: "15." in German,
 * "15日" in Japanese, "15" in French. Intl has no format for a day on its
 * own that does this ("15" in German), so the day is read out of a whole
 * date with its marker.
 */
const formatDayOfMonth: (day: number, locale: string) => string | null = (
  day: number,
  locale: string,
): string | null => {
  try {
    const parts: Array<Intl.DateTimeFormatPart> = new Intl.DateTimeFormat(
      locale,
      { day: "numeric", month: "long", timeZone: "UTC" },
    ).formatToParts(new Date(Date.UTC(2023, 0, day)));
    const index: number = parts.findIndex(
      (part: Intl.DateTimeFormatPart): boolean => {
        return part.type === "day";
      },
    );

    if (index < 0) {
      return null;
    }

    const after: Intl.DateTimeFormatPart | undefined = parts[index + 1];
    const marker: string =
      after && after.type === "literal" ? after.value.trim() : "";

    return (
      parts[index]!.value + (DAY_OF_MONTH_MARKER.test(marker) ? marker : "")
    );
  } catch {
    return null;
  }
};

/*
 * The most dates a yearly schedule names in another language before it is
 * read in English, as CronTab lists it ("On the 1st and 15th of January
 * and July"): a sentence that names eight dates is no easier to read.
 */
export const MAX_YEARLY_DATES_IN_WORDS: number = 6;

// The sentence a yearly schedule is worded in, in a language that has it.
const EVERY_YEAR: string = translationKey(
  "Every year on {{dates}} at {{time}} (UTC)",
);

/*
 * A yearly schedule's dates as the language writes a day of a month:
 * "1. Januar", "1 января", "1 de enero", "1月1日" - Intl puts the day and
 * the month in the case and order the language's dates take, which a
 * sentence built from a day and a month name could not. Every day of each
 * month the schedule names, month by month; null when there are more than
 * MAX_YEARLY_DATES_IN_WORDS of them, or Intl cannot write one.
 */
const yearlyDatesInLocale: (data: {
  daysOfMonth: Array<number>;
  months: Array<number>;
  locale: string;
}) => Array<string> | null = (data: {
  daysOfMonth: Array<number>;
  months: Array<number>;
  locale: string;
}): Array<string> | null => {
  if (
    data.daysOfMonth.length * data.months.length >
    MAX_YEARLY_DATES_IN_WORDS
  ) {
    return null;
  }

  const dates: Array<Date> = [];

  for (const month of data.months) {
    for (const day of data.daysOfMonth) {
      // A leap year, so a schedule on 29 February can be named.
      const date: Date = new Date(Date.UTC(2024, month - 1, day));

      // A day the month does not have (31 April) never runs: no sentence.
      if (date.getUTCMonth() !== month - 1) {
        return null;
      }

      dates.push(date);
    }
  }

  return formatEach({
    values: dates.map((date: Date): number => {
      return date.getTime();
    }),
    locale: data.locale,
    options: { day: "numeric", month: "long" },
    toDate: (time: number): Date => {
      return new Date(time);
    },
  });
};

// "1st and 15th", "1. und 15.", "1日と15日".
const daysOfMonthInSentence: (days: Array<number>) => ComposedValue = (
  days: Array<number>,
): ComposedValue => {
  return namesInSentence({
    english: CronTab.describeDaysOfMonth(days),
    localized: (locale: string): Array<string> | null => {
      const names: Array<string> = [];

      for (const day of days) {
        const name: string | null = formatDayOfMonth(day, locale);

        if (!name) {
          return null;
        }

        names.push(name);
      }

      return names;
    },
  });
};

const describeShape: (data: {
  shape: CronScheduleShape;
  english: string;
  translator: Translator;
}) => string = (data: {
  shape: CronScheduleShape;
  english: string;
  translator: Translator;
}): string => {
  const shape: CronScheduleShape = data.shape;
  const t: Translator = data.translator;

  switch (shape.kind) {
    case "everyMinute":
      return t.translateTemplate("Every minute");

    case "everyMinutes":
      /*
       * Never 1 here (that is "Every minute"), but a language's "one" form
       * also covers counts like 21 (Russian): "Каждую 21 минуту".
       */
      return t.translatePlural(
        {
          one: "Every {{count}} minute",
          other: "Every {{count}} minutes",
        },
        shape.step,
      );

    case "everyHourOnTheHour":
      return t.translateTemplate("Every hour, on the hour");

    case "everyHours": {
      // "at minute 05", as CronTab writes it.
      const minute: string =
        shape.minute < 10 ? `0${shape.minute}` : `${shape.minute}`;

      if (shape.step === 1) {
        return shape.minute === 0
          ? t.translateTemplate("Every hour")
          : t.translateTemplate("Every hour at minute {{minute}}", {
              minute: minute,
            });
      }

      return shape.minute === 0
        ? t.translatePlural(
            { one: "Every {{count}} hour", other: "Every {{count}} hours" },
            shape.step,
          )
        : t.translatePlural(
            {
              one: "Every {{count}} hour at minute {{minute}}",
              other: "Every {{count}} hours at minute {{minute}}",
            },
            shape.step,
            { minute: minute },
          );
    }

    case "daily":
      return t.translateTemplate("Every day at {{time}} (UTC)", {
        time: CronTab.describeTimeOfDay(shape.hour, shape.minute),
      });

    case "weekly":
      return t.translateTemplate("Every week on {{days}} at {{time}} (UTC)", {
        days: weekdaysInSentence(shape.weekdays),
        time: CronTab.describeTimeOfDay(shape.hour, shape.minute),
      });

    case "monthly": {
      const values: {
        days: ComposedValue;
        time: string;
      } = {
        days: daysOfMonthInSentence(shape.daysOfMonth),
        time: CronTab.describeTimeOfDay(shape.hour, shape.minute),
      };

      return shape.monthStep === 1
        ? t.translateTemplate(
            "Every month on the {{days}} at {{time}} (UTC)",
            values,
          )
        : t.translatePlural(
            {
              one: "Every {{count}} month on the {{days}} at {{time}} (UTC)",
              other: "Every {{count}} months on the {{days}} at {{time}} (UTC)",
            },
            shape.monthStep,
            values,
          );
    }

    case "yearly": {
      /*
       * Only in a language that words the sentence, and Intl writes the
       * dates in: CronTab's English otherwise ("On the 1st of January at
       * 00:00 (UTC)"), the dates English too.
       */
      const locale: string = getDateLocale(t.language);

      if (
        !t.hasTranslation(EVERY_YEAR) ||
        isEnglishDateLanguage(t.language) ||
        locale.startsWith("en-")
      ) {
        return data.english;
      }

      const dates: Array<string> | null = yearlyDatesInLocale({
        daysOfMonth: shape.daysOfMonth,
        months: shape.months,
        locale: locale,
      });

      if (!dates || dates.length === 0) {
        return data.english;
      }

      return t.translateTemplate(EVERY_YEAR, {
        dates: joinInLocale(dates, locale),
        time: CronTab.describeTimeOfDay(shape.hour, shape.minute),
      });
    }

    default:
      // Field by field: cron's own terms, in English.
      return data.english;
  }
};

export const describeCronSchedule: (
  expression: string,
  translator?: Translator | undefined,
) => string | null = (
  expression: string,
  translator?: Translator | undefined,
): string | null => {
  const english: string | null =
    CronTab.getHumanReadableDescription(expression);

  if (english === null || !translator) {
    return english;
  }

  const shape: CronScheduleShape | null = CronTab.getScheduleShape(expression);

  if (!shape) {
    return english;
  }

  return describeShape({
    shape: shape,
    english: english,
    translator: translator,
  });
};
