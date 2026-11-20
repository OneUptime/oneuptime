import {
  CallArguments,
  lineOf,
  readCallArguments,
} from "../../Helpers/CallScan";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * NOTHING ON THE SERVER STEPS OR COUNTS DAYS ON ITS OWN CALENDAR (issues
 * #8236, #8473).
 *
 * OneUptimeDate.addRemoveDays (and addRemoveWeeks, addRemoveMonths,
 * addRemoveYears) without a zone steps the calendar of whatever zone the
 * server runs in. On a self-hosted server outside UTC, "the last 30 days"
 * stepped that way across a clock change is 719 or 721 hours: the Security
 * overview's windows, Data Security's fresh findings, a telemetry row's
 * retention date, a token's grace period were each an hour short or long
 * twice a year, and CI, in UTC, never saw it (DaysAsLengthsOfTimeCases
 * runs them in other zones). getDaysBetweenTwoDates and
 * getNumberOfDaysBetweenDates count calendar days of that zone the same
 * way: an event 7 x 24 hours old across the change was 6 days old.
 *
 * So the server says which it means. A length of time is
 * addRemoveDurationInDays (or the getSomeDays family, which steps lengths
 * too), and getWholeDaysOfTimeBetween counts one. Calendar days - a day
 * bar, the day a shift starts - are stepped in the zone they are days of,
 * passed as the step's third argument: the reader's, a schedule's, or UTC.
 *
 * OnCallCalendarAPI works in calendar days on purpose, for shifts, and has
 * its own tests; it is the one file left out.
 */

const REPOSITORY: string = path.resolve(__dirname, "../../../../..");
const API_DIRECTORY: string = path.join(
  REPOSITORY,
  "packages/Common/Server/API",
);

// Every server: Common's, the App's server feature sets, the enterprise one.
const SERVER_DIRECTORIES: ReadonlyArray<string> = [
  "packages/Common/Server",
  "packages/App/FeatureSet/BaseAPI",
  "packages/App/FeatureSet/Identity",
  "packages/App/FeatureSet/MCP",
  "packages/App/FeatureSet/Notification",
  "packages/App/FeatureSet/Runbook",
  "packages/App/FeatureSet/Telemetry",
  "packages/App/FeatureSet/Workers",
  "packages/App/FeatureSet/Workflow",
  "ee/Server",
];

const LEFT_OUT: ReadonlyArray<string> = [
  "packages/Common/Server/API/OnCallCalendarAPI.ts",
];

const SKIPPED_DIRECTORIES: ReadonlyArray<string> = [
  "node_modules",
  "Tests",
  "__tests__",
  "build",
  "dist",
];

const TYPESCRIPT_FILE: RegExp = /\.ts$/;
const TEST_FILE: RegExp = /\.(test|spec)\.ts$/;

const CALENDAR_STEP: RegExp =
  /\b(addRemoveDays|addRemoveWeeks|addRemoveMonths|addRemoveYears)\s*\(/g;

// Calendar day counts of the runtime's zone, which take no zone at all.
const CALENDAR_COUNT: RegExp =
  /\.(getDaysBetweenTwoDates|getDaysBetweenTwoDatesInclusive|getNumberOfDaysBetweenDates|getNumberOfDaysBetweenDatesInclusive)\s*\(/g;

/*
 * Every calendar step in `text` given no zone, and every calendar day
 * count: "file:line addRemoveDays".
 */
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

  for (const match of text.matchAll(CALENDAR_COUNT)) {
    found.push(`${file}:${lineOf(text, match.index!)} ${match[1]}`);
  }

  return found;
}

function serverFiles(directory: string): Array<string> {
  const files: Array<string> = [];

  if (!fs.existsSync(directory)) {
    return files;
  }

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.includes(entry.name)) {
        files.push(...serverFiles(full));
      }
    } else if (
      TYPESCRIPT_FILE.test(entry.name) &&
      !TEST_FILE.test(entry.name)
    ) {
      files.push(full);
    }
  }

  return files;
}

function relativeOf(file: string): string {
  return path.relative(REPOSITORY, file).split(path.sep).join("/");
}

describe("the server steps 'the last N days' as a length of time", () => {
  test("nothing on the server steps or counts days, weeks, months or years without saying in which zone", () => {
    const files: Array<string> = SERVER_DIRECTORIES.flatMap(
      (directory: string): Array<string> => {
        return serverFiles(path.join(REPOSITORY, directory));
      },
    ).filter((file: string): boolean => {
      return !LEFT_OUT.includes(relativeOf(file));
    });
    const found: Array<string> = [];

    for (const file of files) {
      found.push(
        ...findCalendarStepsWithoutAZone(
          relativeOf(file),
          fs.readFileSync(file, "utf8"),
        ),
      );
    }

    // The sweep reads the servers: thousands of files.
    expect(files.length).toBeGreaterThan(1000);
    expect(files.map(relativeOf)).toContain(
      "packages/App/FeatureSet/Workers/Jobs/Slo/EvaluateSlos.ts",
    );
    expect(found).toEqual([]);
  });

  test("the windows #8236 named are lengths of time, and the overviews' days the reader's", () => {
    const read: (file: string) => string = (file: string): string => {
      return fs.readFileSync(path.join(API_DIRECTORY, file), "utf8");
    };

    expect(
      read("DataObservabilityAPI.ts").match(
        /OneUptimeDate\.addRemoveDurationInDays\(/g,
      )?.length,
    ).toBe(1);
    /*
     * The findings OneUptime AI reads of a telemetry issue, read where every
     * Data Security AI read is since #10365 (DataSecurityAiReads).
     */
    expect(
      fs
        .readFileSync(
          path.join(
            API_DIRECTORY,
            "..",
            "Utils",
            "AI",
            "DataSecurity",
            "DataSecurityAiReads.ts",
          ),
          "utf8",
        )
        .match(/OneUptimeDate\.addRemoveDurationInDays\(/g)?.length,
    ).toBe(1);
    // The issue trend's and the Security overview's days, the reader's (#8474).
    expect(read("DataSecurityAPI.ts")).toMatch(/getLastCalendarDays\(/);
    expect(read("SecurityCaseAPI.ts")).toMatch(/getLastCalendarDays\(/);
  });

  test("OnCallCalendarAPI, left out, still steps calendar days, as shifts need", () => {
    const text: string = fs.readFileSync(
      path.join(API_DIRECTORY, "OnCallCalendarAPI.ts"),
      "utf8",
    );

    expect(text).toMatch(CALENDAR_STEP);
  });

  test.each<[string, number]>([
    // The forms #8236 and #8473 found, as they were.
    ["OneUptimeDate.addRemoveDays(now, -TREND_DAYS)", 1],
    [
      "OneUptimeDate.addRemoveDays(\n  OneUptimeDate.getCurrentDate(),\n  -FINDING_FRESHNESS_IN_DAYS,\n)",
      1,
    ],
    ["OneUptimeDate.addRemoveDays(ingestionDate, retentionDays,)", 1],
    ["OneUptimeDate.addRemoveWeeks(start, 2)", 1],
    ["OneUptimeDate.addRemoveMonths(start, -1)", 1],
    ["OneUptimeDate.addRemoveYears(start, 1,)", 1],
    [
      "const age: number = OneUptimeDate.getNumberOfDaysBetweenDates(eventTime, now);",
      1,
    ],
    ["OneUptimeDate.getDaysBetweenTwoDates(now, expiresAt)", 1],
    ["OneUptimeDate.getDaysBetweenTwoDatesInclusive(start, end) > 90", 1],
    // A call inside an argument is the argument's own.
    ["OneUptimeDate.addRemoveDays(fn(a, b), -1)", 1],
    ["OneUptimeDate.addRemoveDays(x, -1, fn(a, b))", 0],
    // A zone, however it is given.
    ["OneUptimeDate.addRemoveDays(now, -29, timezone || Timezone.UTC)", 0],
    ['OneUptimeDate.addRemoveDays(now, -1, "UTC")', 0],
    ['OneUptimeDate.addRemoveYears(from, 1, "UTC")', 0],
    ["OneUptimeDate.addRemoveDays(\n  now,\n  -1,\n  schedule.timezone,\n)", 0],
    // A string with a comma in it is one argument.
    ['OneUptimeDate.addRemoveWeeks(new Date("a, b"), 1)', 1],
    // Lengths of time.
    ["OneUptimeDate.addRemoveDurationInDays(now, -30)", 0],
    ["OneUptimeDate.getSomeDaysAgo(30)", 0],
    ["OneUptimeDate.addRemoveHours(now, -24)", 0],
    ["OneUptimeDate.getWholeDaysOfTimeBetween(now, expiresAt)", 0],
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
          "const c = OneUptimeDate.getDaysBetweenTwoDates(a, b);",
        ].join("\n"),
      ),
    ).toEqual([
      "Example.ts:2 addRemoveDays",
      "Example.ts:3 getDaysBetweenTwoDates",
    ]);
  });
});
