import StatusPageGroup from "../../../Models/DatabaseModels/StatusPageGroup";
import StatusPageResource from "../../../Models/DatabaseModels/StatusPageResource";
import { writeInLanguage } from "../../../Server/Utils/ServerTranslation";
import OneUptimeDate from "../../../Types/Date";
import Dictionary from "../../../Types/Dictionary";
import EventInterval from "../../../Types/Events/EventInterval";
import Recurring from "../../../Types/Events/Recurring";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import {
  StatusPageReport,
  StatusPageReportGroup,
  StatusPageReportGroupMetrics,
  StatusPageReportItem,
  StatusPageReportRow,
} from "../../../Types/StatusPage/StatusPageReport";
import StatusPageReportPeriodType from "../../../Types/StatusPage/StatusPageReportPeriodType";
import Timezone from "../../../Types/Timezone";
import { createTranslator, Translator } from "../../../Types/Translator";
import StatusPageReportTreeUtil, {
  StatusPageReportResourceEntry,
  StatusPageReportStructure,
} from "../../../Utils/StatusPage/Report";
import StatusPageReportPeriodUtil, {
  StatusPageReportPeriod,
} from "../../../Utils/StatusPage/ReportPeriod";
import StatusPageReportText, {
  StatusPageReportPeriodTexts,
} from "../../../Utils/StatusPage/ReportText";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import { describe, expect, test } from "@jest/globals";
import { STATUS_PAGE_LANGUAGES } from "../../Helpers/TranslatedLanguages";

/*
 * A STATUS PAGE'S UPTIME REPORT, IN ITS READER'S LANGUAGE.
 *
 * The report is built once, in English (StatusPageService
 * .getReportByStatusPage), and each subscriber is sent it in their own
 * language (sendEmailReport): its period, its dates, its percentages and
 * its durations are written again there (Utils/StatusPage/ReportText),
 * inside writeInLanguage, as the email's own words are. These hold the
 * English to exactly what it always read, and every other language to its
 * own words, digits and marks - while the report's numbers, names and
 * structure stay the report's.
 */

// Any whitespace, the narrow and no-break spaces a percent sign follows included.
const WHITESPACE_REGEX: RegExp = /\s/g;
// An ASCII digit.
const LATIN_DIGIT_REGEX: RegExp = /[0-9]/;

const SENT_AT: Date = OneUptimeDate.fromString("2026-08-01T09:00:00.000Z");

function every(intervalType: EventInterval, intervalCount: number): Recurring {
  const recurring: Recurring = new Recurring();
  recurring.intervalType = intervalType;
  recurring.intervalCount = new PositiveNumber(intervalCount);
  return recurring;
}

function rolling(days: number): StatusPageReportPeriod {
  return StatusPageReportPeriodUtil.getReportPeriod({
    periodType: StatusPageReportPeriodType.Rolling,
    reportDataInDays: days,
    timezone: Timezone.UTC,
    sentAt: SENT_AT,
  });
}

function calendar(
  intervalType: EventInterval,
  intervalCount: number = 1,
): StatusPageReportPeriod {
  return StatusPageReportPeriodUtil.getReportPeriod({
    periodType: StatusPageReportPeriodType.PreviousCalendarPeriod,
    reportRecurringInterval: every(intervalType, intervalCount),
    timezone: Timezone.UTC,
    sentAt: SENT_AT,
  });
}

// The period's texts in `language`, as the report's sender writes them.
function textsIn(
  language: string,
  period: StatusPageReportPeriod,
): StatusPageReportPeriodTexts {
  return writeInLanguage(
    language,
    (translator: Translator): StatusPageReportPeriodTexts => {
      return StatusPageReportText.getPeriodTexts(period, translator);
    },
  );
}

function withoutSpaces(text: string): string {
  return text.replace(WHITESPACE_REGEX, "");
}

const EUROPE: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const PAYMENTS: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");

function group(id: ObjectID, name: string, parent?: ObjectID): StatusPageGroup {
  const value: StatusPageGroup = new StatusPageGroup();
  value._id = id.toString();
  value.name = name;
  value.order = 1;

  if (parent) {
    value.parentStatusPageGroupId = parent;
  }

  return value;
}

function entry(data: {
  name: string;
  uptime: number;
  minutes?: number | undefined;
  englishDowntime?: string | undefined;
  incidents: number;
  groupId?: ObjectID | undefined;
}): StatusPageReportResourceEntry {
  const resource: StatusPageResource = new StatusPageResource();
  resource.displayName = data.name;

  if (data.groupId) {
    resource.statusPageGroupId = data.groupId;
  }

  return {
    statusPageResource: resource,
    reportItem: {
      resourceName: data.name,
      totalIncidentCount: data.incidents,
      uptimePercent: data.uptime,
      uptimePercentAsString: `${data.uptime}%`,
      downtimeInHoursAndMinutes:
        data.englishDowntime ||
        OneUptimeDate.convertMinutesToDaysHoursAndMinutes(data.minutes || 0),
      ...(data.minutes === undefined
        ? {}
        : { downtimeInMinutes: data.minutes }),
    },
  };
}

function metrics(
  uptime: number,
  minutes: number,
  incidents: number,
): StatusPageReportGroupMetrics {
  return {
    uptimePercent: uptime,
    uptimePercentAsString: `${uptime}%`,
    downtimeInHoursAndMinutes:
      OneUptimeDate.convertMinutesToDaysHoursAndMinutes(minutes),
    downtimeInMinutes: minutes,
    totalIncidentCount: incidents,
  };
}

/*
 * A report as getReportByStatusPage builds it, in English: an ungrouped
 * website, and Europe > Payments with two resources - one of them read
 * before the report carried minutes, so it has none.
 */
function englishReport(period: StatusPageReportPeriod): StatusPageReport {
  const groupMetrics: Dictionary<StatusPageReportGroupMetrics> = {
    [EUROPE.toString()]: metrics(92.85, 279, 3),
    [PAYMENTS.toString()]: metrics(92.85, 279, 3),
  };

  const structure: StatusPageReportStructure = StatusPageReportTreeUtil.build({
    entries: [
      entry({ name: "Website", uptime: 99.95, minutes: 21, incidents: 1 }),
      entry({
        name: "Checkout (EU)",
        uptime: 85.71,
        minutes: 279,
        incidents: 3,
        groupId: PAYMENTS,
      }),
      entry({
        name: "Billing",
        uptime: 100,
        englishDowntime: "0 minutes",
        incidents: 0,
        groupId: PAYMENTS,
      }),
    ],
    statusPageGroups: [
      group(EUROPE, "Europe"),
      group(PAYMENTS, "Payments", EUROPE),
    ],
    groupMetricsByGroupId: groupMetrics,
  });

  return {
    reportDates: period.reportDates,
    reportPeriodName: period.periodName,
    reportStartDate: StatusPageReportText.writeDay(
      period.startDate,
      period.timezone,
    ),
    reportEndDate: StatusPageReportText.writeDay(
      period.endDate,
      period.timezone,
    ),
    reportTimezone: period.timezone,
    totalResources: structure.resources.length,
    totalIncidents: 4,
    averageUptimePercent: "95.22%",
    totalDowntimeInHoursAndMinutes:
      OneUptimeDate.convertMinutesToDaysHoursAndMinutes(300),
    totalDowntimeInMinutes: 300,
    resources: structure.resources,
    groups: structure.groups,
    ungroupedResources: structure.resourcesWithoutGroup,
    rows: structure.rows,
    hasGroups: true,
  };
}

function reportIn(
  language: string,
  report: StatusPageReport,
  period: StatusPageReportPeriod,
): StatusPageReport {
  return writeInLanguage(
    language,
    (translator: Translator): StatusPageReport => {
      return StatusPageReportText.writeReportInLanguage({
        report: report,
        period: period,
        translator: translator,
      });
    },
  );
}

describe("StatusPageReportText.writePercent", () => {
  test("English reads exactly as the report wrote it", () => {
    for (const text of ["99.95%", "100%", "0%", "99.995%", "85.7%"]) {
      expect(StatusPageReportText.writePercent(text, "en")).toBe(text);
    }
  });

  test("German, French, Russian and the Nordic languages write a decimal comma and set the sign apart", () => {
    for (const language of ["de", "fr", "es", "da", "no", "sv", "ru"]) {
      const written: string = StatusPageReportText.writePercent(
        "99.95%",
        language,
      );

      expect([language, withoutSpaces(written)]).toEqual([language, "99,95%"]);
      // The sign has a space - a no-break one - before it.
      expect([language, written.length]).toEqual([language, 7]);
    }

    expect(withoutSpaces(StatusPageReportText.writePercent("100%", "de"))).toBe(
      "100%",
    );
  });

  test("Italian, Portuguese and Dutch write a decimal comma and the sign right after", () => {
    for (const language of ["it", "pt", "nl"]) {
      expect([
        language,
        StatusPageReportText.writePercent("99.95%", language),
      ]).toEqual([language, "99,95%"]);
    }
  });

  test("Japanese, Korean, Chinese and Hindi read as English does", () => {
    for (const language of ["ja", "ko", "zh-CN", "zh-TW", "hi"]) {
      expect([
        language,
        StatusPageReportText.writePercent("99.95%", language),
      ]).toEqual([language, "99.95%"]);
    }
  });

  test("Persian writes its own digits, decimal mark and percent sign", () => {
    expect(StatusPageReportText.writePercent("99.95%", "fa")).toBe("۹۹٫۹۵٪");
    expect(StatusPageReportText.writePercent("100%", "fa")).toBe("۱۰۰٪");
  });

  test("keeps the English figure's own digits: never rounded again", () => {
    // Three decimals, as a resource with that precision reports.
    expect(
      withoutSpaces(StatusPageReportText.writePercent("99.995%", "de")),
    ).toBe("99,995%");
    // Trailing zeros as the English has them.
    expect(
      withoutSpaces(StatusPageReportText.writePercent("100.00%", "de")),
    ).toBe("100,00%");
  });

  test("leaves anything that is not such a percentage as it is", () => {
    for (const text of ["", "n/a", "99.95", "%", "-1%", "1,5%", "99.95% up"]) {
      expect(StatusPageReportText.writePercent(text, "de")).toBe(text);
    }
  });
});

describe("StatusPageReportText.writeCount", () => {
  test("a count in English is as it always was, with no thousands mark", () => {
    expect(StatusPageReportText.writeCount(1000, "en")).toBe("1000");
    expect(StatusPageReportText.writeCount(30, "de")).toBe("30");
    expect(StatusPageReportText.writeCount(1000, "de")).toBe("1000");
  });

  test("Persian writes its own digits", () => {
    expect(StatusPageReportText.writeCount(30, "fa")).toBe("۳۰");
    expect(StatusPageReportText.writeCount(2026, "fa")).toBe("۲۰۲۶");
  });
});

describe("StatusPageReportText.getPeriodTexts in English", () => {
  /*
   * The English translator is the default: the texts every custom template
   * was written against, character for character.
   */
  test("a rolling window reads as it always did", () => {
    expect(StatusPageReportText.getPeriodTexts(rolling(30))).toEqual({
      periodName: "the last 30 days",
      reportDates: "30 days (Jul 2, 2026 - Aug 1, 2026)",
    });
    expect(StatusPageReportText.getPeriodTexts(rolling(1)).periodName).toBe(
      "the last day",
    );
  });

  test("one day is one day, not '1 days'", () => {
    expect(StatusPageReportText.getPeriodTexts(rolling(1)).reportDates).toBe(
      "1 day (Jul 31, 2026 - Aug 1, 2026)",
    );
  });

  test("a calendar period has its own name, or its dates", () => {
    expect(
      StatusPageReportText.getPeriodTexts(calendar(EventInterval.Month)),
    ).toEqual({
      periodName: "July 2026",
      reportDates: "Jul 1, 2026 - Jul 31, 2026",
    });
    expect(
      StatusPageReportText.getPeriodTexts(calendar(EventInterval.Year))
        .periodName,
    ).toBe("2025");
    expect(
      StatusPageReportText.getPeriodTexts(calendar(EventInterval.Week))
        .periodName,
    ).toBe("the week of Jul 20, 2026");
    expect(
      StatusPageReportText.getPeriodTexts(calendar(EventInterval.Day))
        .periodName,
    ).toBe("Jul 31, 2026");
    expect(
      StatusPageReportText.getPeriodTexts(calendar(EventInterval.Month, 3))
        .periodName,
    ).toBe("May 1, 2026 - Jul 31, 2026");
    // An hourly period reads as its dates too.
    expect(
      StatusPageReportText.getPeriodTexts(calendar(EventInterval.Hour))
        .periodName,
    ).toBe("Aug 1, 2026 - Aug 1, 2026");
  });

  test("is what StatusPageReportPeriodUtil gives every period", () => {
    for (const period of [
      rolling(1),
      rolling(14),
      rolling(30),
      calendar(EventInterval.Month),
      calendar(EventInterval.Week),
      calendar(EventInterval.Year),
      calendar(EventInterval.Month, 3),
    ]) {
      expect(
        StatusPageReportText.getPeriodTexts(
          period,
          createTranslator(undefined, "en"),
        ),
      ).toEqual({
        periodName: period.periodName,
        reportDates: period.reportDates,
      });
    }
  });
});

describe("StatusPageReportText.getPeriodTexts in a reader's language", () => {
  test("German names the period, and writes its dates, in German", () => {
    expect(textsIn("de", rolling(30))).toEqual({
      periodName: "die letzten 30 Tage",
      reportDates: "30 Tage (2. Juli 2026 – 1. Aug. 2026)",
    });
    expect(textsIn("de", rolling(1)).periodName).toBe("den letzten Tag");
    expect(textsIn("de", calendar(EventInterval.Month))).toEqual({
      periodName: "Juli 2026",
      reportDates: "1. Juli 2026 – 31. Juli 2026",
    });
    expect(textsIn("de", calendar(EventInterval.Week)).periodName).toBe(
      "die Woche vom 20. Juli 2026",
    );
  });

  test("Japanese", () => {
    expect(textsIn("ja", rolling(30)).periodName).toBe("過去30日間");
    expect(textsIn("ja", calendar(EventInterval.Month)).periodName).toBe(
      "2026年7月",
    );
    expect(textsIn("ja", calendar(EventInterval.Week)).periodName).toBe(
      "2026年7月20日の週",
    );
  });

  /*
   * Russian reads 21 and 31 in its "one" form, which therefore names its
   * count: "the last day" is only ever one day.
   */
  test("Russian names a count of its 'one' form, and every other, by its count", () => {
    expect(textsIn("ru", rolling(1)).periodName).toBe("последние сутки");
    expect(textsIn("ru", rolling(21)).periodName).toBe("последние 21 сутки");
    expect(textsIn("ru", rolling(22)).periodName).toBe("последние 22 суток");
    expect(textsIn("ru", rolling(30)).periodName).toBe("последние 30 суток");
  });

  test("Persian writes the period in its own digits", () => {
    const texts: StatusPageReportPeriodTexts = textsIn("fa", rolling(30));

    expect(withoutIsolateMarks(texts.periodName)).toBe("۳۰ روز گذشته");
    expect(withoutIsolateMarks(texts.reportDates)).not.toMatch(
      LATIN_DIGIT_REGEX,
    );
    expect(
      withoutIsolateMarks(
        textsIn("fa", calendar(EventInterval.Year)).periodName,
      ),
    ).toBe("۲۰۲۵");
  });

  test("every language words the rolling period apart from English", () => {
    for (const language of [...STATUS_PAGE_LANGUAGES]) {
      const texts: StatusPageReportPeriodTexts = textsIn(language, rolling(30));

      expect([language, texts.periodName]).not.toEqual([
        language,
        "the last 30 days",
      ]);
      expect([language, texts.reportDates.startsWith("30 days")]).toEqual([
        language,
        false,
      ]);
    }
  });
});

describe("StatusPageReportText.writeReportInLanguage", () => {
  const period: StatusPageReportPeriod = calendar(EventInterval.Month);

  test("English is the report itself", () => {
    const report: StatusPageReport = englishReport(period);

    expect(reportIn("en", report, period)).toBe(report);
  });

  describe("in German", () => {
    const english: StatusPageReport = englishReport(period);
    const german: StatusPageReport = reportIn("de", english, period);

    test("what it covers, and its dates", () => {
      expect(german.reportPeriodName).toBe("Juli 2026");
      expect(german.reportDates).toBe("1. Juli 2026 – 31. Juli 2026");
      expect(german.reportStartDate).toBe("1. Juli 2026");
      expect(german.reportEndDate).toBe("31. Juli 2026");
      // The zone is a name, as it is.
      expect(german.reportTimezone).toBe("UTC");
    });

    test("the page's figures", () => {
      expect(withoutSpaces(german.averageUptimePercent)).toBe("95,22%");
      expect(german.totalDowntimeInHoursAndMinutes).toBe(
        "5 Stunden, 0 Minuten",
      );
      expect(german.totalIncidents).toBe(4);
      expect(german.totalResources).toBe(3);
      expect(german.hasGroups).toBe(true);
    });

    test("each resource's figures, its name and its numbers as they are", () => {
      const website: StatusPageReportItem = german.resources[0]!;

      expect(website.resourceName).toBe("Website");
      expect(withoutSpaces(website.uptimePercentAsString)).toBe("99,95%");
      expect(website.downtimeInHoursAndMinutes).toBe("21 Minuten");
      expect(website.uptimePercent).toBe(99.95);
      expect(website.totalIncidentCount).toBe(1);
      expect(website.downtimeInMinutes).toBe(21);
    });

    test("a resource without its minutes keeps the English duration it has", () => {
      const billing: StatusPageReportItem = german.resources[2]!;

      expect(billing.resourceName).toBe("Billing");
      expect(withoutSpaces(billing.uptimePercentAsString)).toBe("100%");
      expect(billing.downtimeInHoursAndMinutes).toBe("0 minutes");
    });

    test("each group's figures, down the tree", () => {
      const europe: StatusPageReportGroup = german.groups[0]!;
      const payments: StatusPageReportGroup = europe.subGroups[0]!;

      expect(europe.groupName).toBe("Europe");
      expect(withoutSpaces(europe.uptimePercentAsString)).toBe("92,85%");
      expect(europe.downtimeInHoursAndMinutes).toBe("4 Stunden, 39 Minuten");
      expect(payments.groupPath).toBe("Europe / Payments");
      expect(payments.downtimeInHoursAndMinutes).toBe("4 Stunden, 39 Minuten");
      expect(
        payments.resources.map((item: StatusPageReportItem): string => {
          return item.downtimeInHoursAndMinutes;
        }),
      ).toEqual(["4 Stunden, 39 Minuten", "0 minutes"]);
    });

    test("the same rows, in the same order, written in German", () => {
      expect(
        german.rows.map((row: StatusPageReportRow): Array<unknown> => {
          return [
            row.name,
            row.isGroup,
            row.depth,
            row.indentInPixels,
            row.totalIncidentCount,
            row.totalResources,
          ];
        }),
      ).toEqual(
        english.rows.map((row: StatusPageReportRow): Array<unknown> => {
          return [
            row.name,
            row.isGroup,
            row.depth,
            row.indentInPixels,
            row.totalIncidentCount,
            row.totalResources,
          ];
        }),
      );

      expect(
        german.rows.map((row: StatusPageReportRow): string => {
          return withoutSpaces(row.uptimePercentAsString);
        }),
      ).toEqual(["99,95%", "92,85%", "92,85%", "85,71%", "100%"]);
      expect(german.rows[0]!.downtimeInHoursAndMinutes).toBe("21 Minuten");
    });

    test("a resource is one item wherever the report holds it", () => {
      const checkout: StatusPageReportItem = german.resources[1]!;

      expect(german.groups[0]!.subGroups[0]!.resources[0]).toBe(checkout);
      expect(german.ungroupedResources[0]).toBe(german.resources[0]);
    });

    test("leaves the English report as it was", () => {
      expect(english.reportPeriodName).toBe("July 2026");
      expect(english.averageUptimePercent).toBe("95.22%");
      expect(english.resources[0]!.downtimeInHoursAndMinutes).toBe(
        "21 minutes",
      );
      expect(english.rows[1]!.uptimePercentAsString).toBe("92.85%");
    });
  });

  test("Persian writes every figure in its own digits", () => {
    const persian: StatusPageReport = reportIn(
      "fa",
      englishReport(period),
      period,
    );

    expect(persian.averageUptimePercent).toBe("۹۵٫۲۲٪");
    expect(persian.reportStartDate).not.toMatch(LATIN_DIGIT_REGEX);
    expect(persian.totalDowntimeInHoursAndMinutes).not.toMatch(
      LATIN_DIGIT_REGEX,
    );

    for (const row of persian.rows) {
      expect(row.uptimePercentAsString).not.toMatch(LATIN_DIGIT_REGEX);

      // Billing was read without its minutes, and keeps its English duration.
      if (row.name !== "Billing") {
        expect(row.downtimeInHoursAndMinutes).not.toMatch(LATIN_DIGIT_REGEX);
      }
    }
  });

  test("a report with no resources is written in the language too", () => {
    const empty: StatusPageReport = {
      ...englishReport(period),
      totalResources: 0,
      totalIncidents: 0,
      averageUptimePercent: "0%",
      totalDowntimeInHoursAndMinutes: "0",
      totalDowntimeInMinutes: 0,
      resources: [],
      groups: [],
      ungroupedResources: [],
      rows: [],
      hasGroups: false,
    };

    const german: StatusPageReport = reportIn("de", empty, period);

    expect(german.reportPeriodName).toBe("Juli 2026");
    expect(withoutSpaces(german.averageUptimePercent)).toBe("0%");
    expect(german.totalDowntimeInHoursAndMinutes).toBe("0 Minuten");
    expect(german.rows).toEqual([]);
  });

  test("leaves English dates and durations to English once written", () => {
    reportIn("de", englishReport(period), period);

    // writeInLanguage writes in German only while it runs.
    expect(OneUptimeDate.convertMinutesToDaysHoursAndMinutes(21)).toBe(
      "21 minutes",
    );
  });
});
