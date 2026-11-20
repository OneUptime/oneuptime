// UX rule: Docs/ux/README.md#in-every-language
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A DAY'S NAME STANDING ALONE GOES THROUGH writeStandAloneDayName (#7660).
 *
 * NounKeysDrawnAsLabelsGuard leaves a day's name out on purpose: whether it
 * takes a capital standing alone is its language's own rule, CLDR's
 * contextTransforms ("Lunes" on a Spanish button, "lundi" in a French
 * menu, "mandag" everywhere in Danish), which DateLanguage's
 * writeStandAloneDayName holds. This is its sibling: every place the front
 * ends draw a day's name on its own - a day button, its aria-label and
 * title, a menu of days, a calendar's or a timeline's header, a heading
 * that starts with the day - draws it through that helper, or is listed
 * here as drawing it inside a sentence, where the locale's own wording is
 * right.
 *
 * It reads three ways of drawing a day's name:
 *   - a read of a table of the locale's day keys (DAY_NAMES[day],
 *     WORKING_HOURS_DAY_SHORT_NAMES[day]): inside writeStandAloneDayName's
 *     call, in the same statement;
 *   - the DayOfWeek enum as a menu's options: handed to the helper right
 *     after;
 *   - an Intl formatter asked for a weekday (`weekday: "short"`): in a file
 *     that draws it through the helper, or listed with its reason.
 * OneUptimeDate.getDayOfWeekName draws its names through the helper too.
 */

const REPOSITORY: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
);

const SCANNED_FOLDERS: ReadonlyArray<string> = [
  "packages/App/FeatureSet/Dashboard/src",
  "packages/Common/UI",
  "packages/Common/Utils",
  "packages/Common/Types",
  "ee/AdminDashboard",
];

// The helper's own file, and OneUptimeDate's, which draws through it.
const HELPERS: ReadonlyArray<string> = [
  "packages/Common/Types/DateLanguage.ts",
  "packages/Common/Types/Date.ts",
];

const SKIPPED_FOLDER_NAMES: ReadonlyArray<string> = [
  "node_modules",
  "Tests",
  "build",
  "dist",
  "Locales",
];

const SOURCE_FILE: RegExp = /\.tsx?$/;
const TEST_FILE: RegExp = /\.(test|spec)\.tsx?$/;

const HELPER_CALL: string = "writeStandAloneDayName(";

// DAY_NAMES[day], WORKING_HOURS_DAY_SHORT_NAMES[day]!.
const DAY_KEY_TABLE_READ: RegExp = /\b[A-Z_]*DAY_(?:SHORT_)?NAMES\[/g;

const DAY_OF_WEEK_MENU: RegExp = /getDropdownOptionsFromEnum\(\s*DayOfWeek\b/g;

const INTL_WEEKDAY: RegExp = /\bweekday\s*:\s*["'](?:short|long)["']/g;

// How far after a menu of days its labels are handed to the helper.
const MENU_REACH: number = 600;

/*
 * Reads of a day table that draw the day inside a sentence, each for its
 * reason: the locale words a day there as the middle of a sentence does.
 */
const IN_A_SENTENCE: Readonly<Record<string, string>> = {
  "packages/App/FeatureSet/Dashboard/src/Components/OnCallRule/WorkingHoursText.ts":
    'The working hours\' days in a summary that fills a sentence: "Pages only Mon–Fri 09:00–17:00", "outside {{hours}}".',
  "packages/App/FeatureSet/Dashboard/src/Components/Runbook/Triggers/RunbookTriggersCopy.ts":
    'A schedule\'s days listed in its sentence: "Runs every Monday and Friday at 09:00".',
};

/*
 * Files that ask Intl for a weekday inside a longer date or a sentence, not
 * a day's name standing alone, each for its reason.
 */
const WEEKDAY_IN_A_PHRASE: Readonly<Record<string, string>> = {
  "packages/Common/Utils/CronScheduleText.ts":
    'A cron schedule\'s days, listed inside its sentence: "Every week on Monday and Friday at 09:30".',
  "packages/App/FeatureSet/Dashboard/src/Components/Runbook/Triggers/RunbookTriggersCopy.ts":
    'A run\'s time, the value of a sentence: "Next run: {{when}}".',
};

interface ScannedFile {
  file: string;
  text: string;
}

const sourceFiles: (directory: string) => Array<string> = (
  directory: string,
): Array<string> => {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (!SKIPPED_FOLDER_NAMES.includes(entry.name)) {
        files.push(...sourceFiles(full));
      }

      continue;
    }

    if (SOURCE_FILE.test(entry.name) && !TEST_FILE.test(entry.name)) {
      files.push(full);
    }
  }

  return files;
};

const readScannedFiles: () => Array<ScannedFile> = (): Array<ScannedFile> => {
  const scanned: Array<ScannedFile> = [];

  for (const folder of SCANNED_FOLDERS) {
    const full: string = path.join(REPOSITORY, folder);

    if (!fs.existsSync(full)) {
      continue;
    }

    for (const file of sourceFiles(full)) {
      scanned.push({
        file: path.relative(REPOSITORY, file).split(path.sep).join("/"),
        text: fs.readFileSync(file, "utf8"),
      });
    }
  }

  return scanned;
};

const lineOf: (text: string, index: number) => number = (
  text: string,
  index: number,
): number => {
  return text.slice(0, index).split("\n").length;
};

// Whether the read at `index` is inside the helper's call, in one statement.
const isInsideHelperCall: (text: string, index: number) => boolean = (
  text: string,
  index: number,
): boolean => {
  const before: string = text.slice(0, index);
  const helperAt: number = before.lastIndexOf(HELPER_CALL);

  return helperAt >= 0 && !before.slice(helperAt).includes(";");
};

/*
 * Every day's name `text` draws standing alone, not through the helper,
 * as "line what".
 */
export const findDayNamesOffTheHelper: (
  file: string,
  text: string,
) => Array<string> = (file: string, text: string): Array<string> => {
  if (HELPERS.includes(file)) {
    return [];
  }

  const found: Array<string> = [];

  if (!IN_A_SENTENCE[file]) {
    for (const match of text.matchAll(DAY_KEY_TABLE_READ)) {
      if (!isInsideHelperCall(text, match.index!)) {
        found.push(`${lineOf(text, match.index!)} ${match[0]}`);
      }
    }
  }

  for (const match of text.matchAll(DAY_OF_WEEK_MENU)) {
    const after: string = text.slice(match.index!, match.index! + MENU_REACH);

    if (!after.includes(HELPER_CALL)) {
      found.push(`${lineOf(text, match.index!)} ${match[0]}`);
    }
  }

  if (!WEEKDAY_IN_A_PHRASE[file] && !text.includes(HELPER_CALL)) {
    for (const match of text.matchAll(INTL_WEEKDAY)) {
      found.push(`${lineOf(text, match.index!)} ${match[0]}`);
    }
  }

  return found;
};

describe("a day's name standing alone is cased as its language writes it", () => {
  const scanned: Array<ScannedFile> = readScannedFiles();

  test("every day button, menu and header draws its day through writeStandAloneDayName", () => {
    const found: Array<string> = [];

    for (const source of scanned) {
      for (const where of findDayNamesOffTheHelper(source.file, source.text)) {
        found.push(`${source.file}:${where}`);
      }
    }

    expect(scanned.length).toBeGreaterThan(1000);
    expect(found).toEqual([]);
  });

  test("the places #7660 named all draw through it", () => {
    for (const file of [
      "packages/App/FeatureSet/Dashboard/src/Components/OnCallRule/WorkingHoursPicker.tsx",
      "packages/App/FeatureSet/Dashboard/src/Components/Runbook/Triggers/RunbookScheduleField.tsx",
      "packages/App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/RestrictionTimesFieldElement.tsx",
      "packages/App/FeatureSet/Dashboard/src/Components/OnCallPolicy/CalendarFeed/UpcomingShiftTime.ts",
      "packages/Common/UI/Components/Calendar/Calendar.tsx",
    ]) {
      const source: ScannedFile | undefined = scanned.find(
        (item: ScannedFile): boolean => {
          return item.file === file;
        },
      );

      expect({
        file,
        drawsThroughTheHelper: source?.text.includes(HELPER_CALL),
      }).toEqual({
        file,
        drawsThroughTheHelper: true,
      });
    }

    // The timeline's headers ask OneUptimeDate, which draws through it.
    expect(
      scanned
        .find((item: ScannedFile): boolean => {
          return item.file.endsWith("ScheduleTimeline/TimelineGrid.tsx");
        })
        ?.text.includes("OneUptimeDate.getDayOfWeekName("),
    ).toBe(true);
  });

  test("every place listed as a sentence is still there and still reads a day, with its reason", () => {
    for (const [file, reason] of [
      ...Object.entries(IN_A_SENTENCE),
      ...Object.entries(WEEKDAY_IN_A_PHRASE),
    ]) {
      const source: ScannedFile | undefined = scanned.find(
        (item: ScannedFile): boolean => {
          return item.file === file;
        },
      );

      expect(source).toBeDefined();
      expect(
        DAY_KEY_TABLE_READ.test(source!.text) ||
          INTL_WEEKDAY.test(source!.text),
      ).toBe(true);
      DAY_KEY_TABLE_READ.lastIndex = 0;
      INTL_WEEKDAY.lastIndex = 0;
      expect(reason.length).toBeGreaterThan(40);
    }
  });

  test.each<[string, string, number]>([
    // A button that draws the locale's word as it is: #7660's "lun", "Lun".
    [
      "Example.tsx",
      "{translator.translateText(WORKING_HOURS_DAY_SHORT_NAMES[day]!)}",
      1,
    ],
    [
      "Example.tsx",
      "aria-label={translator.translateText(DAY_NAMES[day]!)}",
      1,
    ],
    // Through the helper.
    [
      "Example.tsx",
      'const dayName: string = writeStandAloneDayName({\n  name: translator.translateText(DAY_NAMES[day]!)!,\n  language: translator.language,\n  context: "standAlone",\n});',
      0,
    ],
    // A statement after the helper's is not inside it.
    [
      "Example.tsx",
      "writeStandAloneDayName({ name, language, context });\nconst other = translator.translateText(DAY_NAMES[day]!);",
      1,
    ],
    // A menu of days handed to the helper, and one that is not.
    [
      "Example.tsx",
      'DropdownUtil.getDropdownOptionsFromEnum(DayOfWeek).map((option) => {\n  return { ...option, label: writeStandAloneDayName({ name: option.label, language, context: "menu" }) };\n});',
      0,
    ],
    [
      "Example.tsx",
      "options={DropdownUtil.getDropdownOptionsFromEnum(DayOfWeek)}",
      1,
    ],
    // Intl's weekday in a file that never asks the helper.
    ["Example.ts", 'const options = { weekday: "short", day: "numeric" };', 1],
    [
      "Example.ts",
      'const options = { weekday: "long" };\nwriteStandAloneDayName({ name: f.format(d), language, context: "standAlone" });',
      0,
    ],
    // A narrow name takes no capital in any language: not read.
    ["Example.ts", 'const options = { weekday: "narrow" };', 0],
  ])(
    "%s: %p is %p time(s) off the helper",
    (file: string, text: string, count: number) => {
      expect(findDayNamesOffTheHelper(file, text)).toHaveLength(count);
    },
  );

  test("a sentence's file may read its day table as the sentence words it", () => {
    expect(
      findDayNamesOffTheHelper(
        "packages/App/FeatureSet/Dashboard/src/Components/OnCallRule/WorkingHoursText.ts",
        "return translator.translateText(WORKING_HOURS_DAY_SHORT_NAMES[day]!)!;",
      ),
    ).toEqual([]);
    expect(
      findDayNamesOffTheHelper(
        "packages/App/FeatureSet/Dashboard/src/Components/Other.ts",
        "return translator.translateText(WORKING_HOURS_DAY_SHORT_NAMES[day]!)!;",
      ),
    ).toHaveLength(1);
  });
});
