import {
  ScheduledMaintenanceTemplateSchedule,
  getTemplateNextEventAt,
} from "../../FeatureSet/Dashboard/src/Utils/ScheduledMaintenanceTemplateSchedule";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * When a scheduled maintenance template's next event comes, as the
 * Dashboard says it (Utils/ScheduledMaintenanceTemplateSchedule).
 *
 * A template turned off used to keep the time its next event was due, and
 * the templates list went on saying "Next event will be scheduled at ..."
 * while the job (ScheduleRecurringEvents) created no more events: the job
 * reads only templates whose Recurring Event switch is on. The Dashboard
 * reads a next event the same way - the switch on and a time set - in the
 * templates list and on a template's page, and nowhere shows the time
 * without that rule. The words it says it in are translated in every
 * language, and so is the recurrence field's description, which names
 * every unit the interval picker offers.
 */

const DASHBOARD_SOURCE: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const LOCALES_DIR: string = path.join(DASHBOARD_SOURCE, "Locales");

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

const NEXT_EVENT: string = "Next event will be scheduled at {{date}}";
const INTERVAL_DESCRIPTION: string =
  "A number and a unit: hours, days, weeks, months or years.";
const RETIRED_INTERVAL_DESCRIPTION: string =
  "How often would you like this event to recur? You can choose from daily, weekly, monthly, or yearly.";

const AT: Date = new Date("2030-06-10T09:00:00.000Z");

// A {{placeholder}} of a translated sentence.
const PLACEHOLDER: RegExp = /\{\{[a-zA-Z]+\}\}/g;

function readLocale(locale: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, string>;
}

function readDashboardSource(relative: string): string {
  return fs.readFileSync(path.join(DASHBOARD_SOURCE, relative), "utf8");
}

// Every .ts and .tsx file under a directory, as paths relative to it.
function sourceFiles(directory: string, relative: string = ""): Array<string> {
  return fs
    .readdirSync(path.join(directory, relative), { withFileTypes: true })
    .flatMap((entry: fs.Dirent): Array<string> => {
      const entryPath: string = path.join(relative, entry.name);

      if (entry.isDirectory()) {
        return entry.name === "node_modules"
          ? []
          : sourceFiles(directory, entryPath);
      }

      return entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")
        ? [entryPath]
        : [];
    });
}

describe("getTemplateNextEventAt", () => {
  test("is the template's next time while it recurs", () => {
    expect(
      getTemplateNextEventAt({ isRecurringEvent: true, scheduleNextEventAt: AT }),
    ).toBe(AT);
  });

  test("is no time for a template turned off, whatever time it still holds", () => {
    expect(
      getTemplateNextEventAt({
        isRecurringEvent: false,
        scheduleNextEventAt: AT,
      }),
    ).toBeNull();
  });

  test("is no time for a template whose switch was never read or set", () => {
    expect(getTemplateNextEventAt({ scheduleNextEventAt: AT })).toBeNull();
  });

  test("is no time for a recurring template with no time worked out", () => {
    expect(getTemplateNextEventAt({ isRecurringEvent: true })).toBeNull();
    expect(
      getTemplateNextEventAt({
        isRecurringEvent: true,
        scheduleNextEventAt: null,
      } as unknown as ScheduledMaintenanceTemplateSchedule),
    ).toBeNull();
  });

  test("is no time for a template that never recurred", () => {
    expect(getTemplateNextEventAt({ isRecurringEvent: false })).toBeNull();
    expect(getTemplateNextEventAt({})).toBeNull();
  });
});

describe("where the Dashboard shows a template's next event", () => {
  const LIST: string = readDashboardSource(
    "Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceTemplates.tsx",
  );
  const VIEW: string = readDashboardSource(
    "Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceTemplateView.tsx",
  );

  test("the templates list reads the switch beside the time, and draws the column from the rule", () => {
    expect(LIST).toContain(
      "selectMoreFields={{\n          // The Recurring Event column reads the switch beside the next time.\n          isRecurringEvent: true,\n        }}",
    );

    const column: string = LIST.slice(
      LIST.indexOf(
        '{\n            field: {\n              scheduleNextEventAt: true,\n            },\n            title: "Recurring Event",',
      ),
    );

    expect(column).toContain(
      "const nextEventAt: Date | null = getTemplateNextEventAt(item);",
    );
    expect(column).toContain(
      "OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(\n                        nextEventAt,\n                      ),",
    );
    // Never the stored time itself.
    expect(column.slice(0, column.indexOf("],"))).not.toContain(
      "item.scheduleNextEventAt",
    );
  });

  test("a template's page shows the time only while the rule gives one", () => {
    expect(VIEW).toContain(
      'title: "Next event will be automatically scheduled at",\n              fieldType: FieldType.DateTime,\n              showIf: (item: ScheduledMaintenanceTemplate): boolean => {\n                return getTemplateNextEventAt(item) !== null;\n              },',
    );
  });

  test("no other Dashboard file reads the time without the rule", () => {
    const readers: Array<string> = sourceFiles(DASHBOARD_SOURCE)
      .filter((file: string): boolean => {
        return (
          !file.startsWith(`Locales${path.sep}`) &&
          readDashboardSource(file).includes("scheduleNextEventAt")
        );
      })
      .sort();

    expect(readers).toEqual(
      [
        path.join(
          "Pages",
          "ScheduledMaintenanceEvents",
          "Settings",
          "ScheduledMaintenanceTemplateView.tsx",
        ),
        path.join(
          "Pages",
          "ScheduledMaintenanceEvents",
          "Settings",
          "ScheduledMaintenanceTemplates.tsx",
        ),
        path.join("Utils", "ScheduledMaintenanceTemplateSchedule.ts"),
      ].sort(),
    );

    for (const file of readers) {
      if (file.startsWith("Utils")) {
        continue;
      }

      expect([file, readDashboardSource(file)]).toEqual([
        file,
        expect.stringContaining(
          'import { getTemplateNextEventAt } from "../../../Utils/ScheduledMaintenanceTemplateSchedule";',
        ),
      ]);
    }
  });
});

describe("the words, in every language", () => {
  const ENGLISH: Record<string, string> = readLocale("en");

  test("English keys them as they are written", () => {
    expect(ENGLISH[NEXT_EVENT]).toBe(NEXT_EVENT);
    expect(ENGLISH[INTERVAL_DESCRIPTION]).toBe(INTERVAL_DESCRIPTION);
    expect(ENGLISH["No"]).toBe("No");
  });

  test("the recurrence field's old description is gone from every locale", () => {
    for (const locale of ["en", ...OTHER_LOCALES]) {
      expect([locale, RETIRED_INTERVAL_DESCRIPTION in readLocale(locale)]).toEqual(
        [locale, false],
      );
    }
  });

  test.each(OTHER_LOCALES)(
    "%s translates when the next event is scheduled, keeping the date",
    (locale: string) => {
      const sentence: string | undefined = readLocale(locale)[NEXT_EVENT];

      expect(sentence).toBeDefined();
      expect(sentence).not.toBe(NEXT_EVENT);
      expect(sentence!.match(PLACEHOLDER)).toEqual(["{{date}}"]);
    },
  );

  test.each(OTHER_LOCALES)(
    "%s translates the recurrence field's description as one sentence",
    (locale: string) => {
      const sentence: string | undefined =
        readLocale(locale)[INTERVAL_DESCRIPTION];

      expect(sentence).toBeDefined();
      expect(sentence).not.toBe(INTERVAL_DESCRIPTION);
      expect(sentence).not.toContain("{{");
    },
  );

  /*
   * The docs' table describes the field in the same words, page by page:
   * the Dashboard says it as each language's docs page does.
   */
  test.each(OTHER_LOCALES)(
    "%s words it as its docs page's Recurring events table does",
    (locale: string) => {
      const page: string = fs.readFileSync(
        path.join(
          __dirname,
          "..",
          "..",
          "FeatureSet",
          "Docs",
          "Content",
          locale,
          "scheduled-maintenance",
          "templates.md",
        ),
        "utf8",
      );

      expect(page).toContain(` | ${readLocale(locale)[INTERVAL_DESCRIPTION]}`);
    },
  );
});
