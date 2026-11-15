import {
  CallArguments,
  lineOf,
  readCallArguments,
} from "../../Helpers/CallScan";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * NO ROUTE STEPS DAYS ON THE SERVER'S OWN CALENDAR (issue #8236).
 *
 * OneUptimeDate.addRemoveDays (and addRemoveWeeks, addRemoveMonths,
 * addRemoveYears) without a zone steps the calendar of whatever zone the
 * server runs in. On a self-hosted server outside UTC, "the last 30 days"
 * stepped that way across a clock change is 719 or 721 hours: the Security
 * overview's windows, Data Security's fresh findings and Data
 * Observability's week of schema changes were each an hour short or long
 * twice a year, and CI, in UTC, never saw it (DaysAsLengthsOfTimeCases runs
 * them in other zones).
 *
 * So a route says which it means. A length of time is
 * addRemoveDurationInDays, or the getSomeDays family, which steps lengths
 * too. Calendar days - a day bar, the day a shift starts - are stepped in
 * the zone they are days of, passed as the step's third argument: the
 * reader's (Data Security's issue trend), a schedule's, or UTC.
 *
 * OnCallCalendarAPI works in calendar days on purpose, for shifts, and has
 * its own tests; it is the one file left out.
 */

const API_DIRECTORY: string = path.join(__dirname, "../../../Server/API");

// Also read: the server's other windows this issue moved off its calendar.
const ALSO_READ: ReadonlyArray<string> = [
  "../../../Server/Utils/DataSecurity/DataSecurityEvaluator.ts",
  "../../../Server/Utils/DataSecurity/DataSecurityFindingWriter.ts",
  "../../../Server/Utils/SecurityEvent/EntityRisk/SecurityEntityRiskRecorder.ts",
];

const LEFT_OUT: ReadonlyArray<string> = ["OnCallCalendarAPI.ts"];

const TYPESCRIPT_FILE: RegExp = /\.ts$/;

const CALENDAR_STEP: RegExp =
  /\b(addRemoveDays|addRemoveWeeks|addRemoveMonths|addRemoveYears)\s*\(/g;

// Every calendar step in `text` given no zone: "file:line addRemoveDays".
function findCalendarStepsWithoutAZone(
  file: string,
  text: string,
): Array<string> {
  const found: Array<string> = [];

  for (const match of text.matchAll(CALENDAR_STEP)) {
    const call: CallArguments | null = readCallArguments(
      text,
      match.index! + match[0].length - 1,
    );

    // A day, a week, a month or a year, and the zone it is one in.
    if (!call || call.count < 3) {
      found.push(`${file}:${lineOf(text, match.index!)} ${match[1]}`);
    }
  }

  return found;
}

function apiFiles(directory: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...apiFiles(full));
    } else if (
      TYPESCRIPT_FILE.test(entry.name) &&
      !LEFT_OUT.includes(entry.name)
    ) {
      files.push(full);
    }
  }

  return files;
}

describe("the server steps 'the last N days' as a length of time", () => {
  test("no route steps days, weeks, months or years without saying in which zone", () => {
    const files: Array<string> = [
      ...apiFiles(API_DIRECTORY),
      ...ALSO_READ.map((file: string): string => {
        return path.join(__dirname, file);
      }),
    ];
    const found: Array<string> = [];

    for (const file of files) {
      found.push(
        ...findCalendarStepsWithoutAZone(
          path.relative(API_DIRECTORY, file),
          fs.readFileSync(file, "utf8"),
        ),
      );
    }

    // The sweep reads the routes: there are dozens of files.
    expect(files.length).toBeGreaterThan(50);
    expect(found).toEqual([]);
  });

  test("the windows #8236 named are lengths of time now", () => {
    const read: (file: string) => string = (file: string): string => {
      return fs.readFileSync(path.join(API_DIRECTORY, file), "utf8");
    };

    expect(
      read("SecurityCaseAPI.ts").match(
        /OneUptimeDate\.addRemoveDurationInDays\(/g,
      )?.length,
    ).toBe(2);
    expect(
      read("DataObservabilityAPI.ts").match(
        /OneUptimeDate\.addRemoveDurationInDays\(/g,
      )?.length,
    ).toBe(1);
    expect(
      read("DataSecurityAPI.ts").match(
        /OneUptimeDate\.addRemoveDurationInDays\(/g,
      )?.length,
    ).toBe(1);
    // The issue trend's calendar days, stepped in the reader's zone.
    expect(read("DataSecurityAPI.ts")).toMatch(
      /addRemoveDays\(\s*now,\s*-\(TREND_DAYS - 1\),\s*timezone \|\| Timezone\.UTC,?\s*\)/,
    );
  });

  test("OnCallCalendarAPI, left out, still steps calendar days, as shifts need", () => {
    const text: string = fs.readFileSync(
      path.join(API_DIRECTORY, "OnCallCalendarAPI.ts"),
      "utf8",
    );

    expect(text).toMatch(CALENDAR_STEP);
  });

  test.each<[string, number]>([
    // The forms #8236 found, as they were.
    ["OneUptimeDate.addRemoveDays(now, -TREND_DAYS)", 1],
    [
      "OneUptimeDate.addRemoveDays(\n  OneUptimeDate.getCurrentDate(),\n  -FINDING_FRESHNESS_IN_DAYS,\n)",
      1,
    ],
    ["OneUptimeDate.addRemoveWeeks(start, 2)", 1],
    ["OneUptimeDate.addRemoveMonths(start, -1)", 1],
    ["OneUptimeDate.addRemoveYears(start, 1,)", 1],
    // A call inside an argument is the argument's own.
    ["OneUptimeDate.addRemoveDays(fn(a, b), -1)", 1],
    ["OneUptimeDate.addRemoveDays(x, -1, fn(a, b))", 0],
    // A zone, however it is given.
    ["OneUptimeDate.addRemoveDays(now, -29, timezone || Timezone.UTC)", 0],
    ['OneUptimeDate.addRemoveDays(now, -1, "UTC")', 0],
    ["OneUptimeDate.addRemoveDays(\n  now,\n  -1,\n  schedule.timezone,\n)", 0],
    // A string with a comma in it is one argument.
    ['OneUptimeDate.addRemoveWeeks(new Date("a, b"), 1)', 1],
    // Lengths of time.
    ["OneUptimeDate.addRemoveDurationInDays(now, -30)", 0],
    ["OneUptimeDate.getSomeDaysAgo(30)", 0],
    ["OneUptimeDate.addRemoveHours(now, -24)", 0],
  ])("finds %p %p time(s)", (source: string, count: number) => {
    expect(findCalendarStepsWithoutAZone("Example.ts", source)).toHaveLength(
      count,
    );
  });

  test("names the file and the line of each it finds", () => {
    expect(
      findCalendarStepsWithoutAZone(
        "Example.ts",
        [
          "const a = 1;",
          "const b = OneUptimeDate.addRemoveDays(now, -7);",
        ].join("\n"),
      ),
    ).toEqual(["Example.ts:2 addRemoveDays"]);
  });
});
