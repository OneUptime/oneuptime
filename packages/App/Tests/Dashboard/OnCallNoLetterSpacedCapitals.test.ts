import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * NO LETTER-SPACED CAPITALS ON THE ON-CALL PAGES (#5412's UI review).
 *
 * The Final schedule's labels gave up letter-spaced capitals in #5282 - "as
 * no other label in the product is any more" - but the policy pages kept
 * them: Policy at a glance, the escalation timeline, Responder readiness,
 * the readiness page's details, the schedule timeline's tags. Every label
 * there now takes the shared classes (Components/OnCallPolicy/
 * OnCallLabelClasses): in the reading's own case, grey-500 on white.
 *
 * This holds every on-call component and page to it: no `uppercase` class,
 * and no letter spacing (`tracking-wide`, `tracking-wider`), in any of their
 * source but where LEFT_AS_THEY_ARE says why.
 */

const DASHBOARD_SRC: string = path.resolve(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const ON_CALL_DIRECTORIES: Array<string> = [
  path.join(DASHBOARD_SRC, "Components", "OnCallPolicy"),
  path.join(DASHBOARD_SRC, "Pages", "OnCallDuty"),
];

const LABEL_CLASSES_FILE: string = path.join(
  DASHBOARD_SRC,
  "Components",
  "OnCallPolicy",
  "OnCallLabelClasses.ts",
);

/*
 * A shouting class: upper case, or letters spaced apart - as a class among
 * others in a class string ("text-xs uppercase", "tracking-wide").
 */
const SHOUTING_CLASS: RegExp =
  /(?:^|[\s"'`])(uppercase|tracking-(?:wide|wider|widest))(?=$|[\s"'`])/;

/*
 * Files that may keep one, each with why. A date tile's month ("NOV" over
 * "4") is drawn as a calendar page draws it, not as a label.
 */
const LEFT_AS_THEY_ARE: Record<string, string> = {
  "Components/OnCallPolicy/CalendarFeed/UpcomingShiftRow.tsx":
    "The upcoming shift's date tile writes its month as a calendar page does.",
};

function sourceFiles(directory: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...sourceFiles(full));
      continue;
    }

    if (
      (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
      !entry.name.includes(".test.")
    ) {
      files.push(full);
    }
  }

  return files;
}

function relative(file: string): string {
  return path.relative(DASHBOARD_SRC, file).split(path.sep).join("/");
}

describe("the on-call pages' labels", () => {
  const files: Array<string> = ON_CALL_DIRECTORIES.flatMap(sourceFiles);

  test("there are on-call components and pages to read", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  test("none shouts: no upper-case or letter-spaced class, but where a reason is written down", () => {
    const shouting: Array<string> = [];

    for (const file of files) {
      const name: string = relative(file);

      if (LEFT_AS_THEY_ARE[name]) {
        continue;
      }

      fs.readFileSync(file, "utf8")
        .split("\n")
        .forEach((line: string, index: number) => {
          const match: RegExpExecArray | null = SHOUTING_CLASS.exec(line);

          if (match) {
            shouting.push(`${name}:${index + 1}: ${match[1]}`);
          }
        });
    }

    expect(shouting).toEqual([]);
  });

  test("every file left as it is still exists, and still has its reason to", () => {
    for (const name of Object.keys(LEFT_AS_THEY_ARE)) {
      const file: string = path.join(DASHBOARD_SRC, name);

      expect({ name, exists: fs.existsSync(file) }).toEqual({
        name,
        exists: true,
      });
      expect({
        name,
        shouts: SHOUTING_CLASS.test(fs.readFileSync(file, "utf8")),
      }).toEqual({ name, shouts: true });
    }
  });

  test("the shared label classes are in the reading's own case, and grey-500 on white", () => {
    const source: string = fs.readFileSync(LABEL_CLASSES_FILE, "utf8");

    expect(SHOUTING_CLASS.test(source)).toBe(false);
    expect(source).toContain(
      'ON_CALL_SECTION_LABEL_COLOR_CLASS_NAME: string = "text-gray-500"',
    );
    expect(source).not.toContain("text-gray-400");
  });

  test("the pages #5412 named take the shared labels", () => {
    for (const name of [
      "Components/OnCallPolicy/OnCallPolicySummary.tsx",
      "Components/OnCallPolicy/EscalationRule/EscalationSummary.tsx",
      "Components/OnCallPolicy/EscalationRule/EscalationRuleReadiness.tsx",
      "Components/OnCallPolicy/Readiness/ResponderReadinessCard.tsx",
      "Components/OnCallPolicy/Readiness/CoverageMatrix.tsx",
      "Pages/OnCallDuty/Readiness.tsx",
    ]) {
      expect({
        name,
        uses: fs
          .readFileSync(path.join(DASHBOARD_SRC, name), "utf8")
          .includes("ON_CALL_SECTION_LABEL_ON_WHITE_CLASS_NAME"),
      }).toEqual({ name, uses: true });
    }
  });

  test("the pattern finds a shouting class, and not a word that only contains one", () => {
    for (const shouting of [
      'className="text-xs font-semibold uppercase tracking-wide"',
      "className={`uppercase ${x}`}",
      '"text-[10px] tracking-wider text-gray-400"',
    ]) {
      expect({ shouting, found: SHOUTING_CLASS.test(shouting) }).toEqual({
        shouting,
        found: true,
      });
    }

    for (const calm of [
      'className="text-xs font-semibold text-gray-500"',
      "// shown in uppercase-free words",
      "const isUppercaseFree: boolean = true;",
      '"tracking-normal"',
    ]) {
      expect({ calm, found: SHOUTING_CLASS.test(calm) }).toEqual({
        calm,
        found: false,
      });
    }
  });
});
