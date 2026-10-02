import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Every status and state timeline marks the state in effect with the shared
 * pulsing "Currently Active" marker and counts its duration up live. The
 * marker, the live duration and the two columns that hold them live in Common
 * (UI/Components/StateTimeline); this pins the Dashboard side of it, which no
 * render test can see whole:
 *
 *   - each timeline page takes both columns from the shared builders, with
 *     its own model type, and no longer works a duration out by hand;
 *   - nothing in the Dashboard writes "Currently Active" (or the network
 *     site's old "Ongoing") as grey text of its own any more;
 *   - the monitor overview's recent status changes use the same marker;
 *   - "Currently Active" is translated in all seventeen Dashboard locales, in
 *     the same place in each file.
 *
 * Code is compared with comments removed and whitespace squashed, so line
 * wrapping chosen by the formatter cannot break an assertion.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const LOCALES_DIR: string = path.join(DASHBOARD_SRC, "Locales");

const COMMON_STATE_TIMELINE: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "Common",
  "UI",
  "Components",
  "StateTimeline",
);

const CURRENTLY_ACTIVE: string = "Currently Active";

const BUILDERS_IMPORT: string =
  'import { getStateTimelineDurationColumn, getStateTimelineEndsAtColumn, } from "Common/UI/Components/StateTimeline/StateTimelineColumns";';

interface TimelinePageSource {
  file: string;
  model: string;
  // Arguments the Ends At builder is called with, if any.
  endsAtArguments: string;
}

const TIMELINE_PAGES: Array<TimelinePageSource> = [
  {
    file: "Pages/Monitor/View/StatusTimeline.tsx",
    model: "MonitorStatusTimeline",
    endsAtArguments: "",
  },
  {
    file: "Pages/Incidents/View/StateTimeline.tsx",
    model: "IncidentStateTimeline",
    endsAtArguments: "",
  },
  {
    file: "Pages/Incidents/EpisodeView/StateTimeline.tsx",
    model: "IncidentEpisodeStateTimeline",
    endsAtArguments: "",
  },
  {
    file: "Pages/Alerts/View/StateTimeline.tsx",
    model: "AlertStateTimeline",
    endsAtArguments: "",
  },
  {
    file: "Pages/Alerts/EpisodeView/StateTimeline.tsx",
    model: "AlertEpisodeStateTimeline",
    endsAtArguments: "",
  },
  {
    file: "Pages/ScheduledMaintenanceEvents/View/StateTimeline.tsx",
    model: "ScheduledMaintenanceStateTimeline",
    endsAtArguments: "",
  },
  {
    file: "Pages/NetworkSite/View/StatusTimeline.tsx",
    model: "NetworkSiteStatusTimeline",
    endsAtArguments: '{ title: "Until", indicatorSize: PillSize.Small, }',
  },
];

function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1 ");
}

function squash(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function readCode(relativePath: string): string {
  return squash(
    stripComments(
      fs.readFileSync(path.join(DASHBOARD_SRC, relativePath), "utf8"),
    ),
  );
}

function readLocale(file: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, file), "utf8"),
  ) as Record<string, unknown>;
}

const SOURCE_FILE_PATTERN: RegExp = /\.tsx?$/;

// Every .ts/.tsx file under a directory, as paths relative to DASHBOARD_SRC.
function listSourceFiles(directory: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...listSourceFiles(fullPath));
      continue;
    }

    if (SOURCE_FILE_PATTERN.test(entry.name)) {
      files.push(path.relative(DASHBOARD_SRC, fullPath));
    }
  }

  return files;
}

const localeFiles: Array<string> = fs
  .readdirSync(LOCALES_DIR)
  .filter((name: string): boolean => {
    return name.endsWith(".json");
  })
  .sort();

describe("the timeline pages", () => {
  test.each(TIMELINE_PAGES)(
    "$file imports the shared column builders",
    (page: TimelinePageSource) => {
      expect(readCode(page.file)).toContain(squash(BUILDERS_IMPORT));
    },
  );

  test.each(TIMELINE_PAGES)(
    "$file takes its Ends At and Duration columns from them, typed to its model",
    (page: TimelinePageSource) => {
      const code: string = readCode(page.file);

      expect(code).toContain(
        squash(
          `getStateTimelineEndsAtColumn<${page.model}>(${page.endsAtArguments}),`,
        ),
      );
      expect(code).toContain(
        squash(`getStateTimelineDurationColumn<${page.model}>(),`),
      );

      // Exactly once each: one table, one pair of columns.
      expect(code.split("getStateTimelineEndsAtColumn<").length - 1).toBe(1);
      expect(code.split("getStateTimelineDurationColumn<").length - 1).toBe(1);
    },
  );

  test.each(TIMELINE_PAGES)(
    "$file no longer works the duration out by hand",
    (page: TimelinePageSource) => {
      const code: string = readCode(page.file);

      // The once-at-render duration that never moved until a reload.
      expect(code).not.toContain("differenceBetweenTwoDatesAsFromattedString");
      expect(code).not.toContain(`noValueMessage: "${CURRENTLY_ACTIVE}"`);
      expect(code).not.toContain(`"${CURRENTLY_ACTIVE}"`);
    },
  );

  test("the network site timeline no longer says Ongoing in green text of its own", () => {
    const code: string = readCode("Pages/NetworkSite/View/StatusTimeline.tsx");

    expect(code).not.toContain("Ongoing");
    expect(code).not.toContain("text-emerald-700");
  });

  test("the pages keep the columns' order: status, start, end, duration", () => {
    for (const page of TIMELINE_PAGES) {
      const code: string = readCode(page.file);
      const columns: string = code.slice(code.indexOf("columns={["));

      const startsAt: number = columns.indexOf("startsAt: true");
      const endsAt: number = columns.indexOf("getStateTimelineEndsAtColumn<");
      const duration: number = columns.indexOf(
        "getStateTimelineDurationColumn<",
      );

      expect(startsAt).toBeGreaterThan(-1);
      expect(endsAt).toBeGreaterThan(startsAt);
      expect(duration).toBeGreaterThan(endsAt);
    }
  });
});

describe("the monitor overview's recent status changes", () => {
  const code: string = readCode(
    "Components/Monitor/Overview/MonitorStatusChangesCard.tsx",
  );

  test("mark the ongoing row with the shared Currently Active marker", () => {
    expect(code).toContain(
      'import CurrentlyActiveIndicator from "Common/UI/Components/StateTimeline/CurrentlyActiveIndicator";',
    );
    expect(code).toContain(
      "{row.isOngoing ? <CurrentlyActiveIndicator /> : <></>}",
    );
  });

  test('no longer say "ongoing" in grey text', () => {
    expect(code).not.toContain('"ongoing, "');
  });
});

describe("nowhere else in the Dashboard", () => {
  /*
   * The marker is the one way a timeline says its state is in effect. A page
   * that writes the words itself goes back to the grey text this replaced.
   */
  test('writes "Currently Active" itself', () => {
    const offenders: Array<string> = listSourceFiles(DASHBOARD_SRC).filter(
      (file: string): boolean => {
        return readCode(file).includes(`"${CURRENTLY_ACTIVE}"`);
      },
    );

    expect(offenders).toEqual([]);
  });
});

describe("the shared pieces in Common", () => {
  test("the marker looks its words up by the key the locale files carry", () => {
    const indicator: string = squash(
      stripComments(
        fs.readFileSync(
          path.join(COMMON_STATE_TIMELINE, "CurrentlyActiveIndicator.tsx"),
          "utf8",
        ),
      ),
    );

    expect(indicator).toContain(
      `export const CURRENTLY_ACTIVE_TEXT: string = "${CURRENTLY_ACTIVE}";`,
    );
    expect(indicator).toContain("translateString(CURRENTLY_ACTIVE_TEXT)");
    expect(indicator).toContain("isPulsing={true}");
  });
});

describe('"Currently Active" translations', () => {
  test("there are seventeen Dashboard locales", () => {
    expect(localeFiles).toHaveLength(17);
  });

  test("en.json maps it to itself", () => {
    expect(readLocale("en.json")[CURRENTLY_ACTIVE]).toBe(CURRENTLY_ACTIVE);
  });

  test.each(
    localeFiles.filter((file: string): boolean => {
      return file !== "en.json";
    }),
  )("%s carries a real translation", (file: string) => {
    const value: unknown = readLocale(file)[CURRENTLY_ACTIVE];

    expect(typeof value).toBe("string");
    expect((value as string).trim().length).toBeGreaterThan(0);
    expect(value).not.toBe(CURRENTLY_ACTIVE);
  });

  test("every locale has it in the same place, so the files stay line for line", () => {
    const englishIndex: number = Object.keys(readLocale("en.json")).indexOf(
      CURRENTLY_ACTIVE,
    );

    expect(englishIndex).toBeGreaterThan(-1);

    for (const file of localeFiles) {
      expect({
        file: file,
        index: Object.keys(readLocale(file)).indexOf(CURRENTLY_ACTIVE),
      }).toEqual({ file: file, index: englishIndex });
    }
  });
});
