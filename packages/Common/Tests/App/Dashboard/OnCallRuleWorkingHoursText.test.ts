import { describe, expect, test } from "@jest/globals";
import DayOfWeek from "../../../Types/Day/DayOfWeek";
import OnCallRuleWhenToPage from "../../../Types/OnCallDutyPolicy/OnCallRuleWhenToPage";
import RestrictionTimes, {
  RestrictionType,
} from "../../../Types/OnCallDutyPolicy/RestrictionTimes";
import WorkingHours from "../../../Types/OnCallDutyPolicy/WorkingHours";
import {
  Translator,
  createTranslator,
} from "../../../UI/Utils/TranslateTemplate";
import {
  OnCallRuleRecord,
  WORKING_HOURS_RANGE_DASH,
  WORKING_HOURS_SUMMARIES,
  WorkingHoursOfRule,
  WorkingHoursTextOptions,
  describeDays,
  describeWorkingHours,
  formatClock,
  getWorkingHoursRowSummary,
  getWorkingHoursSummary,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallRule/WorkingHoursText";
import englishLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import germanLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/de.json";
import japaneseLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/ja.json";
import moment from "moment-timezone";

/*
 * AN ON-CALL RULE'S WORKING HOURS, IN THE READER'S WORDS.
 *
 * A rule that waits for working hours says so in one sentence under the
 * choice on its form, and in a few words under its name in the rules table:
 * the days in as few words as they take, the times on the reader's clock,
 * and the rule's zone. A rule that pages right away says nothing.
 */

type Locale = Record<string, unknown>;

const lookupIn: (locale: Locale) => (text: string) => string | undefined = (
  locale: Locale,
): ((text: string) => string | undefined) => {
  return (text: string): string | undefined => {
    const found: unknown = locale[text];
    return typeof found === "string" ? found : undefined;
  };
};

const english: Translator = createTranslator(
  lookupIn(englishLocale as Locale),
  "en",
);
const german: Translator = createTranslator(
  lookupIn(germanLocale as Locale),
  "de",
);
const japanese: Translator = createTranslator(
  lookupIn(japaneseLocale as Locale),
  "ja",
);

const ON_24: WorkingHoursTextOptions = {
  translator: english,
  use12HourFormat: false,
};
const ON_12: WorkingHoursTextOptions = {
  translator: english,
  use12HourFormat: true,
};

const LONDON: string = "Europe/London";

// The text as it reads: the ranges' word joiners left out.
function plain(text: string | null): string | null {
  return text === null ? null : text.replace(/⁠/g, "");
}

function rule(data: {
  days: Array<number>;
  from: string;
  to: string;
  timezone?: string | undefined;
  whenToPage?: OnCallRuleWhenToPage | undefined;
}): WorkingHoursOfRule {
  const timezone: string = data.timezone || LONDON;

  return {
    whenToPage: data.whenToPage || OnCallRuleWhenToPage.WorkingHours,
    workingHoursTimezone: timezone,
    workingHours: WorkingHours.fromSimpleHours({
      days: data.days,
      from: data.from,
      to: data.to,
      timezone: timezone,
    }),
  };
}

const WORKING_WEEK: WorkingHoursOfRule = rule({
  days: [0, 1, 2, 3, 4],
  from: "09:00",
  to: "17:00",
});

describe("the days", () => {
  test.each([
    [[0, 1, 2, 3, 4], "Mon–Fri"],
    [[0, 2, 4], "Mon, Wed, Fri"],
    [[0, 1, 2, 4], "Mon–Wed, Fri"],
    [[5, 6], "Sat, Sun"],
    [[3], "Thu"],
    [[0, 1, 2, 3, 4, 5, 6], "Every day"],
    [[4, 0, 4], "Mon, Fri"],
  ])("%j read as %s", (days: Array<number>, said: string) => {
    expect(plain(describeDays(days, english))).toBe(said);
  });

  test("in German, with the Dashboard's own day names", () => {
    expect(plain(describeDays([0, 1, 2, 3, 4], german))).toBe("Mo–Fr");
    expect(describeDays([0, 1, 2, 3, 4, 5, 6], german)).toBe("Jeden Tag");
  });

  test("a range's dash is held to the days on either side, so no line breaks inside it", () => {
    expect(describeDays([0, 1, 2, 3, 4], english)).toBe(
      `Mon${WORKING_HOURS_RANGE_DASH}Fri`,
    );
    expect(WORKING_HOURS_RANGE_DASH).toBe("⁠–⁠");
  });
});

describe("a time", () => {
  test("on a 24-hour clock is as it is kept", () => {
    expect(formatClock("09:00", ON_24)).toBe("09:00");
    expect(formatClock("17:30", ON_24)).toBe("17:30");
  });

  test("on a 12-hour clock carries AM or PM", () => {
    expect(formatClock("09:00", ON_12).replace(/\s/g, " ")).toBe("9:00 AM");
    expect(formatClock("17:30", ON_12).replace(/\s/g, " ")).toBe("5:30 PM");
  });

  test("that is not a time is left alone", () => {
    expect(formatClock("later", ON_12)).toBe("later");
  });
});

describe("the hours and their zone", () => {
  test("Monday to Friday, 09:00 to 17:00", () => {
    expect(plain(describeWorkingHours(WORKING_WEEK, ON_24))).toBe(
      "Mon–Fri 09:00–17:00 (Europe/London)",
    );
  });

  test("on a 12-hour clock", () => {
    expect(
      plain(describeWorkingHours(WORKING_WEEK, ON_12))!.replace(/\s/g, " "),
    ).toBe("Mon–Fri 9:00 AM – 5:00 PM (Europe/London)");
  });

  test("without the zone, for a line too short for it", () => {
    expect(
      plain(
        describeWorkingHours(WORKING_WEEK, { ...ON_24, withTimezone: false }),
      ),
    ).toBe("Mon–Fri 09:00–17:00");
  });

  test("a night desk reads as the hours it keeps", () => {
    expect(
      plain(
        describeWorkingHours(
          rule({
            days: [0, 1, 2, 3, 4],
            from: "22:00",
            to: "06:00",
            timezone: "America/Los_Angeles",
          }),
          ON_24,
        ),
      ),
    ).toBe("Mon–Fri 22:00–06:00 (America/Los_Angeles)");
  });

  test("different hours on some days are each said, in week order", () => {
    const hours: RestrictionTimes = WorkingHours.fromSimpleHours({
      days: [0, 1, 2, 3],
      from: "08:30",
      to: "18:00",
      timezone: LONDON,
    });
    const friday: RestrictionTimes = WorkingHours.fromSimpleHours({
      days: [4],
      from: "08:30",
      to: "15:00",
      timezone: LONDON,
    });
    hours.weeklyRestrictionTimes = [
      ...hours.weeklyRestrictionTimes,
      ...friday.weeklyRestrictionTimes,
    ];

    expect(
      plain(
        describeWorkingHours(
          {
            whenToPage: OnCallRuleWhenToPage.WorkingHours,
            workingHours: hours,
            workingHoursTimezone: LONDON,
          },
          ON_24,
        ),
      ),
    ).toBe("Mon–Thu 08:30–18:00; Fri 08:30–15:00 (Europe/London)");
  });

  test("hours over a weekend say where they begin and end", () => {
    const weekend: RestrictionTimes = new RestrictionTimes();
    weekend.restictionType = RestrictionType.Weekly;
    weekend.weeklyRestrictionTimes = [
      {
        startDay: DayOfWeek.Friday,
        endDay: DayOfWeek.Monday,
        startTime: moment.tz("2026-01-09 17:00", LONDON).toDate(),
        endTime: moment.tz("2026-01-12 09:00", LONDON).toDate(),
      },
    ];

    expect(
      plain(
        describeWorkingHours(
          { workingHours: weekend, workingHoursTimezone: LONDON },
          ON_24,
        ),
      ),
    ).toBe("Fri 17:00 – Mon 09:00 (Europe/London)");
  });

  test("hours that never open, or are in no zone OneUptime knows, are not said", () => {
    expect(
      describeWorkingHours(
        { workingHours: null, workingHoursTimezone: LONDON },
        ON_24,
      ),
    ).toBeNull();
    expect(
      describeWorkingHours(
        { ...WORKING_WEEK, workingHoursTimezone: "Nowhere/Nothing" },
        ON_24,
      ),
    ).toBeNull();
    expect(
      describeWorkingHours(
        rule({ days: [], from: "09:00", to: "17:00" }),
        ON_24,
      ),
    ).toBeNull();
  });
});

describe("what the rule does, in one sentence", () => {
  test("names the rule's records, the hours, and when paging starts", () => {
    expect(
      plain(
        getWorkingHoursSummary(WORKING_WEEK, OnCallRuleRecord.Alert, ON_24),
      ),
    ).toBe(
      "Alerts that match this rule outside Mon–Fri 09:00–17:00 (Europe/London) wait, and paging starts at 09:00.",
    );
  });

  test.each([
    [OnCallRuleRecord.Alert, "Alerts"],
    [OnCallRuleRecord.Incident, "Incidents"],
    [OnCallRuleRecord.AlertEpisode, "Alert episodes"],
    [OnCallRuleRecord.IncidentEpisode, "Incident episodes"],
  ])(
    "for %s rules, starts with %s",
    (record: OnCallRuleRecord, start: string) => {
      expect(getWorkingHoursSummary(WORKING_WEEK, record, ON_24)).toMatch(
        new RegExp(`^${start} that match this rule outside `),
      );
    },
  );

  test("days that begin at different times page when the hours begin", () => {
    const hours: RestrictionTimes = WorkingHours.fromSimpleHours({
      days: [0],
      from: "09:00",
      to: "17:00",
      timezone: LONDON,
    });
    hours.weeklyRestrictionTimes = [
      ...hours.weeklyRestrictionTimes,
      ...WorkingHours.fromSimpleHours({
        days: [1],
        from: "10:00",
        to: "17:00",
        timezone: LONDON,
      }).weeklyRestrictionTimes,
    ];

    expect(
      plain(
        getWorkingHoursSummary(
          {
            whenToPage: OnCallRuleWhenToPage.WorkingHours,
            workingHours: hours,
            workingHoursTimezone: LONDON,
          },
          OnCallRuleRecord.Incident,
          ON_24,
        ),
      ),
    ).toBe(
      "Incidents that match this rule outside Mon 09:00–17:00; Tue 10:00–17:00 (Europe/London) wait, and paging starts when working hours begin.",
    );
  });

  test("on the reader's 12-hour clock", () => {
    expect(
      plain(
        getWorkingHoursSummary(WORKING_WEEK, OnCallRuleRecord.Alert, ON_12),
      )!.replace(/\s/g, " "),
    ).toBe(
      "Alerts that match this rule outside Mon–Fri 9:00 AM – 5:00 PM (Europe/London) wait, and paging starts at 9:00 AM.",
    );
  });

  test("in German", () => {
    expect(
      plain(
        getWorkingHoursSummary(WORKING_WEEK, OnCallRuleRecord.Alert, {
          translator: german,
          use12HourFormat: false,
        }),
      ),
    ).toBe(
      "Warnungen, die außerhalb von Mo–Fr 09:00–17:00 (Europe/London) auf diese Regel zutreffen, warten, und die Alarmierung beginnt um 09:00.",
    );
  });

  test("in Japanese, with the Dashboard's own day names", () => {
    expect(
      plain(
        getWorkingHoursSummary(WORKING_WEEK, OnCallRuleRecord.Incident, {
          translator: japanese,
          use12HourFormat: false,
        }),
      ),
    ).toBe(
      "月–金 09:00–17:00 (Europe/London) 以外にこのルールに一致したインシデントは待機し、09:00 に呼び出しを開始します。",
    );
  });

  test("a rule that pages right away, or whose hours never open, says nothing", () => {
    expect(
      getWorkingHoursSummary(
        { ...WORKING_WEEK, whenToPage: OnCallRuleWhenToPage.RightAway },
        OnCallRuleRecord.Alert,
        ON_24,
      ),
    ).toBeNull();
    expect(
      getWorkingHoursSummary(
        rule({ days: [0], from: "09:00", to: "09:00" }),
        OnCallRuleRecord.Alert,
        ON_24,
      ),
    ).toBeNull();
  });

  test("every sentence keeps its placeholders in every language the Dashboard speaks", () => {
    const locales: Array<Locale> = [
      germanLocale as Locale,
      japaneseLocale as Locale,
    ];

    for (const templates of Object.values(WORKING_HOURS_SUMMARIES)) {
      for (const locale of locales) {
        expect(locale[templates.startsAt]).toEqual(
          expect.stringContaining("{{hours}}"),
        );
        expect(locale[templates.startsAt]).toEqual(
          expect.stringContaining("{{time}}"),
        );
        expect(locale[templates.startsWhenTheyBegin]).toEqual(
          expect.stringContaining("{{hours}}"),
        );
      }
    }
  });
});

describe("the rule's row", () => {
  test("says the hours it pages in", () => {
    expect(plain(getWorkingHoursRowSummary(WORKING_WEEK, ON_24))).toBe(
      "Pages only Mon–Fri 09:00–17:00 (Europe/London)",
    );
    expect(
      plain(
        getWorkingHoursRowSummary(WORKING_WEEK, {
          translator: german,
          use12HourFormat: false,
        }),
      ),
    ).toBe("Alarmiert nur Mo–Fr 09:00–17:00 (Europe/London)");
  });

  test("of a rule that pages right away, says nothing new", () => {
    expect(
      getWorkingHoursRowSummary(
        { ...WORKING_WEEK, whenToPage: OnCallRuleWhenToPage.RightAway },
        ON_24,
      ),
    ).toBeNull();
    expect(getWorkingHoursRowSummary({}, ON_24)).toBeNull();
  });
});
