import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import ColumnBillingAccessControl from "Common/Types/BaseDatabase/ColumnBillingAccessControl";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import TableColumnType from "Common/Types/Database/TableColumnType";
import OneUptimeDate from "Common/Types/Date";
import EventInterval from "Common/Types/Events/EventInterval";
import Recurring from "Common/Types/Events/Recurring";
import PositiveNumber from "Common/Types/PositiveNumber";
import StatusPageReportPeriodType from "Common/Types/StatusPage/StatusPageReportPeriodType";
import Timezone from "Common/Types/Timezone";
import { StatusPageReportScheduleWrite } from "Common/Utils/StatusPage/ReportSchedule";
import {
  getReportCardSelect,
  getReportPeriodDates,
  getReportScheduleDraft,
  getReportScheduleFacts,
  getReportSwitchDescription,
  getShownReportColumns,
  pickReportColumns,
  REPORT_CARD_COLUMNS,
  REPORT_FREQUENCY_COPY,
  REPORT_PERIOD_TYPE_OPTIONS,
  REPORT_SCHEDULE_COLUMNS,
  REPORT_SWITCH_COLUMN,
  ReportScheduleColumns,
  ReportScheduleFacts,
  ROLLING_DAYS_TEMPLATE,
  StatusPageReportsCopy,
} from "../../FeatureSet/Dashboard/src/Components/StatusPage/StatusPageReportsCopy";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A status page's email reports are switched on and off in one place, with
 * nothing to fill in either way: the Email Reports card on Advanced ->
 * Reports (Components/StatusPage/StatusPageReportsCard).
 *
 * The page used to be a card with an Edit dialog of three steps - Reports,
 * Schedule, Reporting Period - whose first report date and interval had no
 * default and were required, so switching reports on meant making a
 * schedule up, and so did switching them off. Now the switch saves the
 * switch alone, the server gives a page switched on without a schedule the
 * default one (every month, on the 1st at 09:00 in the report timezone,
 * covering the month before), and Edit Schedule - offered only while
 * reports are on - is one short page.
 *
 * This holds the switch to its column, the page to the card, the switch
 * and the schedule to the card's own files (a second form that writes them
 * would bring the old dialog back), the schedule dialog to one page that
 * never asks for the switch, the copy helpers to the server's rules, and
 * every new string to a translation in all sixteen other Dashboard locales.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const STATUS_PAGE_COMPONENTS: string = path.join(
  DASHBOARD_SRC,
  "Components",
  "StatusPage",
);

const REPORTS_PAGE: string = path.join(
  DASHBOARD_SRC,
  "Pages",
  "StatusPages",
  "View",
  "Reports.tsx",
);

const COPY_FILE: string = "Components/StatusPage/StatusPageReportsCopy.ts";
const CARD_FILE: string = "Components/StatusPage/StatusPageReportsCard.tsx";
const FORM_FILE: string =
  "Components/StatusPage/StatusPageReportScheduleForm.tsx";

const LOCALES_DIR: string = path.join(DASHBOARD_SRC, "Locales");

const OTHER_LOCALES: Array<string> = [
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

// Without its comments, collapsed to one line.
function readSource(file: string): string {
  return fs
    .readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/\s+/g, " ");
}

const SOURCE_FILE: RegExp = /\.tsx?$/;

function listSources(directory: string): Array<string> {
  const found: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "Locales") {
        continue;
      }

      found.push(...listSources(full));
      continue;
    }

    if (SOURCE_FILE.test(entry.name)) {
      found.push(full);
    }
  }

  return found;
}

function relative(file: string): string {
  return path.relative(DASHBOARD_SRC, file).split(path.sep).join("/");
}

function readLocale(locale: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, unknown>;
}

function every(intervalType: EventInterval, intervalCount: number): Recurring {
  const recurring: Recurring = new Recurring();
  recurring.intervalType = intervalType;
  recurring.intervalCount = new PositiveNumber(intervalCount);
  return recurring;
}

const NOW: Date = OneUptimeDate.fromString("2026-10-04T12:00:00.000Z");

describe("the switch", () => {
  test("writes the status page's own report switch: a boolean that starts off", () => {
    const statusPage: StatusPage = new StatusPage();

    expect(REPORT_SWITCH_COLUMN).toBe("isReportEnabled");
    expect(statusPage.getTableColumnMetadata(REPORT_SWITCH_COLUMN)?.type).toBe(
      TableColumnType.Boolean,
    );
    expect(
      statusPage.getTableColumnMetadata(REPORT_SWITCH_COLUMN)?.defaultValue,
    ).toBe(false);
  });

  test("and the schedule's columns are the page's, read and written by the card", () => {
    const columns: Array<string> = new StatusPage().getTableColumns().columns;

    for (const column of REPORT_SCHEDULE_COLUMNS) {
      expect([column, columns.includes(column)]).toEqual([column, true]);
    }
  });

  test("the switch and the schedule need the same plan to change, so a switch the plan allows never saves a schedule it refuses", () => {
    const statusPage: StatusPage = new StatusPage();
    const plans: Array<PlanType | undefined> = [
      REPORT_SWITCH_COLUMN,
      ...REPORT_SCHEDULE_COLUMNS,
      "sendNextReportBy",
    ].map((column: string): PlanType | undefined => {
      const billing: ColumnBillingAccessControl | undefined =
        statusPage.getColumnBillingAccessControl(column);
      return billing?.update;
    });

    expect(new Set(plans)).toEqual(new Set([PlanType.Growth]));
  });
});

describe("the Reports page", () => {
  const page: string = readSource(REPORTS_PAGE);

  test("draws the Email Reports card, then Send Test Report", () => {
    expect(page).toContain("<StatusPageReportsCard statusPageId={modelId} />");
    expect(page.indexOf("<StatusPageReportsCard")).toBeLessThan(
      page.indexOf("Send Test Report"),
    );
  });

  test("has no Edit dialog of its own: no card with a form, no steps, and no report column", () => {
    expect(page).not.toContain("CardModelDetail");
    expect(page).not.toContain("formSteps");
    expect(page).not.toContain("stepId");

    for (const column of [REPORT_SWITCH_COLUMN, ...REPORT_SCHEDULE_COLUMNS]) {
      expect([column, page.includes(column)]).toEqual([column, false]);
    }
  });
});

describe("one place", () => {
  /*
   * The switch's column, and the two halves of the schedule. The other
   * report columns' names are also template variables
   * (report.reportTimezone) on the subscriber template pages.
   */
  const OWNED: Record<string, Array<string>> = {
    // The copy's column lists, and the card's switch and first read.
    isReportEnabled: [COPY_FILE, CARD_FILE],
    // The copy's column lists, and the dialog's field.
    reportStartDateTime: [COPY_FILE, FORM_FILE],
    // The same, and the card's permission check for Edit Schedule.
    reportRecurringInterval: [COPY_FILE, CARD_FILE, FORM_FILE],
  };

  const sources: Array<string> = listSources(DASHBOARD_SRC);

  test("finds the Dashboard's sources", () => {
    expect(sources.length).toBeGreaterThan(1000);
    expect(sources.map(relative)).toEqual(
      expect.arrayContaining([COPY_FILE, CARD_FILE, FORM_FILE]),
    );
  });

  test.each(Object.keys(OWNED))(
    "only the Email Reports card's own files name %s",
    (column: string) => {
      const pattern: RegExp = new RegExp(`\\b${column}\\b`);

      const naming: Array<string> = sources
        .filter((file: string): boolean => {
          return pattern.test(readSource(file));
        })
        .map(relative)
        .sort();

      expect(naming).toEqual([...OWNED[column]!].sort());
    },
  );
});

describe("the schedule dialog", () => {
  const form: string = readSource(
    path.join(STATUS_PAGE_COMPONENTS, "StatusPageReportScheduleForm.tsx"),
  );
  const card: string = readSource(
    path.join(STATUS_PAGE_COMPONENTS, "StatusPageReportsCard.tsx"),
  );

  // Where a field writing the column starts in the form's source, or -1.
  const fieldStart: (column: string) => number = (column: string): number => {
    return form.search(new RegExp(`field: \\{ ${column}: true,? \\}`));
  };

  test("never asks for the switch: switching reports off needs no schedule", () => {
    expect(form).not.toMatch(/\bisReportEnabled\b/);
  });

  test("is one page: no steps, here or where the card opens it", () => {
    expect(form).not.toContain("stepId");
    expect(card).not.toContain("formSteps");
    expect(card).not.toMatch(/\bsteps\s*:/);
  });

  test("asks for how often and the first report, and folds the timezone, the period and its days under More fields", () => {
    expect(form).toContain(
      "const MORE_FIELDS: FormFieldCollapsibleSection<StatusPage> = getAdvancedFormSection<StatusPage>();",
    );

    const folded: Array<string> = [
      "reportTimezone",
      "reportPeriodType",
      "reportDataInDays",
    ];

    for (const column of folded) {
      const start: number = fieldStart(column);
      const end: number = form.indexOf(
        "},",
        form.indexOf("collapsibleSection", start),
      );

      expect([column, start]).not.toEqual([column, -1]);
      expect([column, form.slice(start, end)]).toEqual([
        column,
        expect.stringContaining("collapsibleSection: MORE_FIELDS"),
      ]);
    }

    for (const column of ["reportRecurringInterval", "reportStartDateTime"]) {
      const start: number = fieldStart(column);
      const next: number = form.indexOf("field: {", start + 1);

      expect([column, start]).not.toEqual([column, -1]);
      expect([column, form.slice(start, next)]).not.toEqual([
        column,
        expect.stringContaining("collapsibleSection"),
      ]);
    }

    expect(form.match(/collapsibleSection: MORE_FIELDS/g)).toHaveLength(3);
  });

  test("the card reads, and the preview reads the form, through the copy's one list of columns", () => {
    expect(card).toContain("select: getReportCardSelect(),");
    expect(card).toContain("pickReportColumns(");
    expect(form).toContain("pickReportColumns(");

    expect(REPORT_CARD_COLUMNS).toEqual([
      REPORT_SWITCH_COLUMN,
      ...REPORT_SCHEDULE_COLUMNS,
      "sendNextReportBy",
    ]);
    expect(Object.keys(getReportCardSelect())).toEqual([
      ...REPORT_CARD_COLUMNS,
    ]);
    expect(
      pickReportColumns({
        isReportEnabled: true,
        reportTimezone: Timezone.UTC,
        name: "Acme Status",
        pageTitle: "Acme",
      }),
    ).toEqual({ isReportEnabled: true, reportTimezone: Timezone.UTC });
  });

  test("is offered only while reports are on", () => {
    expect(card).toMatch(
      /const buttons: Array<CardButtonSchema> = page && isOn &&/,
    );
  });
});

describe("what the card shows", () => {
  const offPage: ReportScheduleColumns = {
    isReportEnabled: false,
    reportTimezone: Timezone.UTC,
    reportPeriodType: StatusPageReportPeriodType.Rolling,
    reportDataInDays: 30,
  };

  test("a page just switched on shows the schedule the server adds, before it is read again", () => {
    const shown: ReportScheduleColumns = getShownReportColumns({
      page: offPage,
      isOn: true,
      now: NOW,
    });
    const facts: ReportScheduleFacts = getReportScheduleFacts({
      columns: shown,
      now: NOW,
    });

    expect(facts.nextSendAt?.toISOString()).toBe("2026-11-01T09:00:00.000Z");
    expect(facts.recurring?.toString()).toBe("1 Month");
    expect(facts.periodType).toBe(
      StatusPageReportPeriodType.PreviousCalendarPeriod,
    );
    expect(getReportPeriodDates(facts.period!)).toBe(
      "Oct 1, 2026 - Oct 31, 2026",
    );
  });

  test("a page that is on, or off, is shown as it is", () => {
    expect(getShownReportColumns({ page: offPage, isOn: false })).toBe(offPage);

    const onPage: ReportScheduleColumns = { ...offPage, isReportEnabled: true };

    expect(getShownReportColumns({ page: onPage, isOn: true })).toBe(onPage);
  });

  test("a rolling report covers the days before it is sent", () => {
    const facts: ReportScheduleFacts = getReportScheduleFacts({
      columns: {
        reportStartDateTime: OneUptimeDate.fromString(
          "2026-10-05T09:00:00.000Z",
        ),
        reportRecurringInterval: every(EventInterval.Week, 1),
        reportTimezone: Timezone.UTC,
        reportPeriodType: StatusPageReportPeriodType.Rolling,
        reportDataInDays: 7,
        sendNextReportBy: OneUptimeDate.fromString("2026-10-05T09:00:00.000Z"),
      },
      now: NOW,
    });

    expect(facts.rollingDays).toBe(7);
    expect(getReportPeriodDates(facts.period!)).toBe(
      "Sep 28, 2026 - Oct 5, 2026",
    );
  });

  test("a saved page the server has scheduled nothing for shows no next report, whatever its schedule says", () => {
    const facts: ReportScheduleFacts = getReportScheduleFacts({
      columns: {
        isReportEnabled: true,
        reportStartDateTime: OneUptimeDate.fromString(
          "2026-10-05T09:00:00.000Z",
        ),
        reportRecurringInterval: every(EventInterval.Week, 1),
        reportTimezone: Timezone.UTC,
      },
      now: NOW,
    });

    expect(facts.nextSendAt).toBeUndefined();
    expect(facts.period).toBeUndefined();
  });

  test("a draft is worked out from its schedule, not from a send time the server has not worked out yet", () => {
    const facts: ReportScheduleFacts = getReportScheduleFacts({
      columns: {
        reportStartDateTime: "2026-10-10T07:30:00.000Z",
        reportRecurringInterval: every(EventInterval.Day, 1).toJSON(),
        reportTimezone: Timezone.UTC,
        sendNextReportBy: OneUptimeDate.fromString("2027-01-01T00:00:00.000Z"),
      },
      isDraft: true,
      now: NOW,
    });

    expect(facts.nextSendAt?.toISOString()).toBe("2026-10-10T07:30:00.000Z");
  });

  test("the dialog starts a page on without a whole schedule from the default one, and any other page from what it has", () => {
    const draft: StatusPageReportScheduleWrite = getReportScheduleDraft(
      { ...offPage, isReportEnabled: true },
      NOW,
    );

    expect(draft.reportStartDateTime?.toISOString()).toBe(
      "2026-11-01T09:00:00.000Z",
    );
    expect(draft.reportRecurringInterval?.toString()).toBe("1 Month");
    expect(draft.reportPeriodType).toBe(
      StatusPageReportPeriodType.PreviousCalendarPeriod,
    );
    expect(draft.sendNextReportBy).toBeUndefined();

    expect(
      getReportScheduleDraft(
        {
          isReportEnabled: true,
          reportStartDateTime: OneUptimeDate.fromString(
            "2026-11-01T09:00:00.000Z",
          ),
          reportRecurringInterval: every(EventInterval.Month, 1),
        },
        NOW,
      ),
    ).toEqual({});
  });

  test("says how often for every interval a schedule can have", () => {
    for (const interval of Object.values(EventInterval)) {
      expect([interval, REPORT_FREQUENCY_COPY[interval]]).toEqual([
        interval,
        {
          single: expect.stringMatching(/^Every [a-z]+$/),
          several: {
            one: expect.stringContaining("{{count}}"),
            other: expect.stringContaining("{{count}}"),
          },
        },
      ]);
    }
  });

  test("the switch says what switching on will do: the default for a page that never had a schedule, its own for one that keeps any part of one", () => {
    expect(getReportSwitchDescription({ page: {}, isOn: true })).toBe(
      StatusPageReportsCopy.switchOnDescription,
    );
    expect(getReportSwitchDescription({ page: {}, isOn: false })).toBe(
      StatusPageReportsCopy.switchOffDescription,
    );

    for (const page of [
      { reportRecurringInterval: every(EventInterval.Week, 1) },
      {
        reportStartDateTime: OneUptimeDate.fromString(
          "2026-10-05T09:00:00.000Z",
        ),
      },
      {
        reportStartDateTime: OneUptimeDate.fromString(
          "2026-10-05T09:00:00.000Z",
        ),
        reportRecurringInterval: every(EventInterval.Month, 1),
      },
    ] as Array<ReportScheduleColumns>) {
      expect(getReportSwitchDescription({ page: page, isOn: false })).toBe(
        StatusPageReportsCopy.switchOffWithScheduleDescription,
      );
    }
  });

  test("offers the two reporting periods, calendar first", () => {
    expect(
      REPORT_PERIOD_TYPE_OPTIONS.map(
        (option: { value: StatusPageReportPeriodType }) => {
          return option.value;
        },
      ),
    ).toEqual([
      StatusPageReportPeriodType.PreviousCalendarPeriod,
      StatusPageReportPeriodType.Rolling,
    ]);
  });
});

describe("translations", () => {
  const english: Record<string, unknown> = readLocale("en");

  // The card's sentences, and the dialog's field titles and descriptions.
  const sentences: Array<string> = [
    StatusPageReportsCopy.cardTitle,
    StatusPageReportsCopy.cardDescription,
    StatusPageReportsCopy.switchTitle,
    StatusPageReportsCopy.switchOnDescription,
    StatusPageReportsCopy.switchOffDescription,
    StatusPageReportsCopy.switchOffWithScheduleDescription,
    StatusPageReportsCopy.editScheduleButton,
    StatusPageReportsCopy.editScheduleTitle,
    StatusPageReportsCopy.editScheduleDescription,
    StatusPageReportsCopy.nextReportTitle,
    StatusPageReportsCopy.howOftenTitle,
    StatusPageReportsCopy.coversTitle,
    StatusPageReportsCopy.timezoneTitle,
    StatusPageReportsCopy.notScheduled,
    StatusPageReportsCopy.covering,
    StatusPageReportsCopy.previousCalendarPeriod,
    StatusPageReportsCopy.previewNextReport,
    StatusPageReportsCopy.previewNoSchedule,
    StatusPageReportsCopy.previewTimezone,
    "First report on",
    "How often a report goes out, such as every month or every 2 weeks.",
    "Later reports follow it at the same time of day. Pick the 1st of a month to send on the 1st of every month.",
    "Report Timezone",
    "Reporting period",
    ...REPORT_PERIOD_TYPE_OPTIONS.map((option: { label: string }) => {
      return option.label;
    }),
    ...Object.values(REPORT_FREQUENCY_COPY).map(
      (copy: { single: string }): string => {
        return copy.single;
      },
    ),
  ];

  // Plural templates: the general form is the key, the "one" form `_one`.
  const plurals: Array<string> = [
    ROLLING_DAYS_TEMPLATE.other,
    ...Object.values(REPORT_FREQUENCY_COPY).map(
      (copy: { several: { other: string } }): string => {
        return copy.several.other;
      },
    ),
  ];

  test("every string is an English key", () => {
    for (const text of [...sentences, ...plurals]) {
      expect([text, english[text]]).toEqual([text, text]);
    }

    for (const text of plurals) {
      expect([text, typeof english[`${text}_one`]]).toEqual([text, "string"]);
    }
  });

  test.each(OTHER_LOCALES)(
    "%s has its own words for every one",
    (locale: string) => {
      const translations: Record<string, unknown> = readLocale(locale);

      for (const text of [...sentences, ...plurals]) {
        expect([text, typeof translations[text]]).toEqual([text, "string"]);
        expect([text, translations[text]]).not.toEqual([text, text]);
      }

      for (const text of plurals) {
        expect([text, translations[`${text}_one`]]).toEqual([
          text,
          expect.stringContaining("{{count}}"),
        ]);
      }

      // The values the sentences carry keep their places.
      expect(translations[StatusPageReportsCopy.covering]).toEqual(
        expect.stringContaining("{{dates}}"),
      );
      expect(translations[StatusPageReportsCopy.previewNextReport]).toEqual(
        expect.stringContaining("{{date}}"),
      );
      expect(translations[StatusPageReportsCopy.previewTimezone]).toEqual(
        expect.stringContaining("{{timezone}}"),
      );
    },
  );
});
