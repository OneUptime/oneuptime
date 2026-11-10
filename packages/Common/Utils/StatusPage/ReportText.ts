import OneUptimeDate from "../../Types/Date";
import {
  getNumberLocale,
  getDigitsOf,
  isEnglishDateLanguage,
} from "../../Types/DateLanguage";
import EventInterval from "../../Types/Events/EventInterval";
import StatusPageReportPeriodType from "../../Types/StatusPage/StatusPageReportPeriodType";
import {
  StatusPageReport,
  StatusPageReportGroup,
  StatusPageReportItem,
} from "../../Types/StatusPage/StatusPageReport";
import {
  createTranslator,
  DEFAULT_LANGUAGE,
  translationKey,
  Translator,
} from "../../Types/Translator";
import StatusPageReportTreeUtil from "./Report";

/*
 * THE WORDS AND FIGURES OF A STATUS PAGE'S UPTIME REPORT, IN A READER'S
 * LANGUAGE.
 *
 * The report (Types/StatusPage/StatusPageReport) is built once, in English:
 * what it covers ("the last 30 days", "July 2026", "the week of Jul 27,
 * 2026"), its dates, its percentages ("99.95%") and its durations ("4 hours,
 * 39 minutes"). Each subscriber is sent it in their own language, and a
 * page's custom report template is filled in the page's default language
 * (StatusPageService.sendEmailReport): writeReportInLanguage writes every
 * one of those texts again in the language of the translator it is given.
 *
 *   - the period's name and its dates, as the sentences below in the
 *     language (Common/Server/Locales holds them), each date the way the
 *     language writes one (OneUptimeDate, through Types/DateLanguage);
 *   - a percentage with the language's digits, decimal mark and percent
 *     sign ("99,95 %" in German, "۹۹٫۹۵٪" in Persian), from the English
 *     text's own digits, so it is never rounded differently from the
 *     English;
 *   - a duration from its minutes, the way OneUptimeDate writes one in the
 *     language ("4 Stunden, 39 Minuten").
 *
 * Its numbers (counts, uptime as a number) and every name in it - the
 * resources' and groups', which the team wrote - stay as they are. English
 * is the report exactly as it was built.
 *
 * Dates and durations follow the date display language, so a report is
 * written in a language inside Server/Utils/ServerTranslation's
 * writeInLanguage, which sets both to the translator's language. Pure and
 * synchronous, and in Common/Utils because StatusPageReportPeriodUtil writes
 * the English period texts with the same sentences, for the settings screen
 * as well as the server.
 */

// The sentences a report's period is described with (Common/Server/Locales).
export const StatusPageReportPeriodText: {
  readonly weekOf: string;
  readonly dateRange: string;
} = {
  // A weekly calendar report: "the week of Jul 27, 2026".
  weekOf: translationKey("the week of {{date}}"),
  // A calendar period that has no name of its own: two dates.
  dateRange: translationKey("{{startDate}} - {{endDate}}"),
};

/*
 * What a report's period is, for its texts to be written in a language:
 * the window, the zone its dates are read in, and how it was cut - the
 * rolling days, or the calendar unit and how many of them
 * (StatusPageReportPeriodUtil fills each of these).
 */
export interface StatusPageReportPeriodTextSource {
  startDate: Date;
  endDate: Date;
  numberOfDays: number;
  timezone: string;
  periodType: StatusPageReportPeriodType;
  // A calendar period's unit and count; absent for a rolling window.
  intervalType?: EventInterval | undefined;
  intervalCount?: number | undefined;
}

// The two texts a period has: its name in a sentence, and its dates.
export interface StatusPageReportPeriodTexts {
  // "the last 30 days", "July 2026": after "your status summary for ...".
  periodName: string;
  // "30 days (Jun 30, 2026 - Jul 30, 2026)", "Jul 1, 2026 - Jul 31, 2026".
  reportDates: string;
}

// The English translator: the texts exactly as they have always read.
const ENGLISH_TRANSLATOR: Translator = createTranslator(
  undefined,
  DEFAULT_LANGUAGE,
);

// A percentage as the report writes it in English: "99.95%", "100%".
const ENGLISH_PERCENT_TEXT_REGEX: RegExp = /^(\d+)(?:\.(\d+))?%$/;

// The parts of a formatted number that are the number itself.
const NUMBER_PART_TYPES: ReadonlyArray<string> = [
  "integer",
  "group",
  "decimal",
  "fraction",
];

const isEnglish: (language: string) => boolean = (
  language: string,
): boolean => {
  return isEnglishDateLanguage(language);
};

// "2026" in the language's own digits: "۲۰۲۶" in Persian.
const writeDigits: (text: string, language: string) => string = (
  text: string,
  language: string,
): string => {
  if (isEnglish(language)) {
    return text;
  }

  const digits: Array<string> = getDigitsOf(language);

  return text
    .split("")
    .map((character: string): string => {
      const code: number = character.charCodeAt(0);

      return code >= 0x30 && code <= 0x39
        ? digits[code - 0x30] || character
        : character;
    })
    .join("");
};

export default class StatusPageReportText {
  /*
   * A whole number as the report writes it in a sentence: as it is in
   * English ("1000 days", as it always read), with the language's digits
   * and no thousands mark otherwise.
   */
  public static writeCount(value: number, language: string): string {
    return writeDigits(String(value), language);
  }

  /*
   * A percentage the report wrote in English ("99.95%") as `language`
   * writes it: "99,95 %" in German, "۹۹٫۹۵٪" in Persian, "99.95%" in
   * Japanese. The digits are the English text's own, so the figure is the
   * very one the English reads; a text that is not such a percentage is
   * left as it is.
   */
  public static writePercent(text: string, language: string): string {
    const match: RegExpExecArray | null = ENGLISH_PERCENT_TEXT_REGEX.exec(text);

    if (!match || isEnglish(language)) {
      return text;
    }

    let parts: Array<Intl.NumberFormatPart>;

    try {
      parts = new Intl.NumberFormat(getNumberLocale(language), {
        style: "percent",
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      }).formatToParts(0.125);
    } catch {
      return text;
    }

    const decimalMark: string =
      parts.find((part: Intl.NumberFormatPart): boolean => {
        return part.type === "decimal";
      })?.value || ".";

    const figure: string =
      writeDigits(match[1] || "", language) +
      (match[2] ? decimalMark + writeDigits(match[2], language) : "");

    // The figure where the language puts its number, the rest as it is.
    let written: string = "";
    let isFigurePlaced: boolean = false;

    for (const part of parts) {
      if (NUMBER_PART_TYPES.includes(part.type)) {
        if (!isFigurePlaced) {
          written += figure;
          isFigurePlaced = true;
        }

        continue;
      }

      written += part.value;
    }

    return isFigurePlaced ? written : text;
  }

  /*
   * A day of the report, in its zone: "Jul 31, 2026", "31. Juli 2026" - in
   * the date display language (writeInLanguage sets it).
   */
  public static writeDay(date: Date, timezone: string): string {
    return OneUptimeDate.getDateAsCustomFormattedStringInTimezone({
      date: date,
      format: "MMM D, YYYY",
      timezone: timezone,
    });
  }

  /*
   * A period's name and its dates in `translator`'s language - English, as
   * they have always read, with the English translator (the default).
   */
  public static getPeriodTexts(
    period: StatusPageReportPeriodTextSource,
    translator: Translator = ENGLISH_TRANSLATOR,
  ): StatusPageReportPeriodTexts {
    const language: string = translator.language;
    const startDate: string = this.writeDay(period.startDate, period.timezone);
    const endDate: string = this.writeDay(period.endDate, period.timezone);
    const dateRange: string = translator.translateTemplate(
      StatusPageReportPeriodText.dateRange,
      { startDate: startDate, endDate: endDate },
    );

    if (
      period.periodType !== StatusPageReportPeriodType.PreviousCalendarPeriod
    ) {
      const count: string = this.writeCount(period.numberOfDays, language);

      /*
       * One day is a sentence of its own, "the last day", never a plural's
       * "one" form: Russian reads 21 and 31 as "one" too, so that form
       * always names its count.
       */
      return {
        periodName:
          period.numberOfDays === 1
            ? translator.translateText("the last day") || "the last day"
            : translator.translatePlural(
                {
                  one: "the last {{count}} day",
                  other: "the last {{count}} days",
                },
                period.numberOfDays,
                { count: count },
              ),
        reportDates: translator.translatePlural(
          {
            one: "{{count}} day ({{startDate}} - {{endDate}})",
            other: "{{count}} days ({{startDate}} - {{endDate}})",
          },
          period.numberOfDays,
          { count: count, startDate: startDate, endDate: endDate },
        ),
      };
    }

    return {
      periodName: this.getCalendarPeriodName({
        period: period,
        translator: translator,
        startDate: startDate,
        dateRange: dateRange,
      }),
      reportDates: dateRange,
    };
  }

  /*
   * Only a single-unit period has a name a reader already knows ("July
   * 2026"). Anything spanning several units, and an hourly period, reads
   * clearer as its dates.
   */
  private static getCalendarPeriodName(data: {
    period: StatusPageReportPeriodTextSource;
    translator: Translator;
    startDate: string;
    dateRange: string;
  }): string {
    const period: StatusPageReportPeriodTextSource = data.period;

    if (period.intervalCount !== 1) {
      return data.dateRange;
    }

    if (period.intervalType === EventInterval.Month) {
      return OneUptimeDate.getDateAsCustomFormattedStringInTimezone({
        date: period.startDate,
        format: "MMMM YYYY",
        timezone: period.timezone,
      });
    }

    if (period.intervalType === EventInterval.Year) {
      return writeDigits(
        OneUptimeDate.getDateAsCustomFormattedStringInTimezone({
          date: period.startDate,
          format: "YYYY",
          timezone: period.timezone,
        }),
        data.translator.language,
      );
    }

    if (period.intervalType === EventInterval.Week) {
      return data.translator.translateTemplate(
        StatusPageReportPeriodText.weekOf,
        { date: data.startDate },
      );
    }

    if (period.intervalType === EventInterval.Day) {
      return data.startDate;
    }

    return data.dateRange;
  }

  /*
   * The report as `translator`'s reader reads it: what it covers, its
   * dates, every percentage and every duration in their language (see
   * above). Its counts, names and structure are the report's own. English
   * is the report itself.
   *
   * Inside writeInLanguage, so its dates and durations are written in the
   * same language as its sentences.
   */
  public static writeReportInLanguage(data: {
    report: StatusPageReport;
    period: StatusPageReportPeriodTextSource;
    translator: Translator;
  }): StatusPageReport {
    const report: StatusPageReport = data.report;
    const language: string = data.translator.language;

    if (isEnglish(language)) {
      return report;
    }

    const duration: (
      minutes: number | undefined,
      englishText: string,
    ) => string = (
      minutes: number | undefined,
      englishText: string,
    ): string => {
      return typeof minutes === "number" && Number.isFinite(minutes)
        ? OneUptimeDate.convertMinutesToDaysHoursAndMinutes(minutes)
        : englishText;
    };

    /*
     * Each resource once: the flat list, the ungrouped ones and each
     * group's own hold the same items, and keep holding the same ones.
     */
    const itemsInLanguage: Map<StatusPageReportItem, StatusPageReportItem> =
      new Map<StatusPageReportItem, StatusPageReportItem>();

    const itemInLanguage: (
      item: StatusPageReportItem,
    ) => StatusPageReportItem = (
      item: StatusPageReportItem,
    ): StatusPageReportItem => {
      const known: StatusPageReportItem | undefined = itemsInLanguage.get(item);

      if (known) {
        return known;
      }

      const written: StatusPageReportItem = {
        ...item,
        uptimePercentAsString: this.writePercent(
          item.uptimePercentAsString,
          language,
        ),
        downtimeInHoursAndMinutes: duration(
          item.downtimeInMinutes,
          item.downtimeInHoursAndMinutes,
        ),
      };

      itemsInLanguage.set(item, written);

      return written;
    };

    const groupInLanguage: (
      group: StatusPageReportGroup,
    ) => StatusPageReportGroup = (
      group: StatusPageReportGroup,
    ): StatusPageReportGroup => {
      return {
        ...group,
        uptimePercentAsString: this.writePercent(
          group.uptimePercentAsString,
          language,
        ),
        downtimeInHoursAndMinutes: duration(
          group.downtimeInMinutes,
          group.downtimeInHoursAndMinutes,
        ),
        resources: group.resources.map(itemInLanguage),
        subGroups: group.subGroups.map(groupInLanguage),
      };
    };

    const groups: Array<StatusPageReportGroup> =
      report.groups.map(groupInLanguage);
    const ungroupedResources: Array<StatusPageReportItem> =
      report.ungroupedResources.map(itemInLanguage);
    const periodTexts: StatusPageReportPeriodTexts = this.getPeriodTexts(
      data.period,
      data.translator,
    );

    return {
      ...report,
      reportDates: periodTexts.reportDates,
      reportPeriodName: periodTexts.periodName,
      reportStartDate: this.writeDay(
        data.period.startDate,
        data.period.timezone,
      ),
      reportEndDate: this.writeDay(data.period.endDate, data.period.timezone),
      averageUptimePercent: this.writePercent(
        report.averageUptimePercent,
        language,
      ),
      totalDowntimeInHoursAndMinutes: duration(
        report.totalDowntimeInMinutes,
        report.totalDowntimeInHoursAndMinutes,
      ),
      resources: report.resources.map(itemInLanguage),
      groups: groups,
      ungroupedResources: ungroupedResources,
      // The same rows, in the same order, from the rows' own groups.
      rows: StatusPageReportTreeUtil.getRows({
        groups: groups,
        resourcesWithoutGroup: ungroupedResources,
      }),
    };
  }
}
