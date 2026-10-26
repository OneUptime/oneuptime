import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A timeline is shown with the timeline's icon (IconProp.Timeline), wherever
 * the Dashboard offers a way into one.
 *
 * The maintainer: "Timeline icon should be better and more relevant." The
 * Timeline | Table switch on a status timeline drew a bar chart for Timeline;
 * it now draws IconProp.Timeline - three stretches of time stepping along -
 * and so does every menu entry that opens a page drawing a timeline: the
 * Status / State Timeline of each record that has one (they drew the list
 * icon Audit Logs draws), and the on-call Schedule Timeline (ViewColumns),
 * its entry in Cmd+K and the schedules list's Timeline View button.
 *
 * A menu entry added later for a new timeline page would otherwise pick
 * whatever icon its author reached for. So this reads the Dashboard's menus
 * (every *SideMenu file and the Cmd+K page index): an entry titled
 * "<something> Timeline" carries IconProp.Timeline, and IconProp.Timeline
 * marks nothing else there. A menu entry titled just "Timeline" is a
 * sub-entry, under an execution log, for the log of that one run: it keeps
 * its parent's own icon. The menus themselves are rendered in
 * Common/Tests/App/Dashboard/TimelineMenuIcons, and the switch in
 * Common/Tests/UI/Components/StatusTimeline/StatusTimelineView.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const COMMAND_PALETTE_INDEX: string = path.join(
  "Components",
  "CommandPalette",
  "PageSearchIndex.ts",
);

const TITLE_OPENER: string = 'title: "';
const TIMELINE_SUFFIX: string = " Timeline";
const TIMELINE_ICON: string = "IconProp.Timeline";
const ICON_PREFIX: string = "IconProp.";

// The keys an entry names its icon with, in an object or as a JSX prop.
const ICON_KEYS: Array<string> = ["icon: IconProp.", "icon={IconProp."];

const WHITESPACE_RUN: RegExp = /\s+/g;
const ICON_NAME_CHARACTER: RegExp = /[A-Za-z0-9]/;

// Comments hold prose, not code: dropped without a pattern, by position.
const withoutComments: (text: string) => string = (text: string): string => {
  let code: string = "";
  let cursor: number = 0;

  while (cursor < text.length) {
    const open: number = text.indexOf("/*", cursor);

    if (open < 0) {
      code += text.slice(cursor);
      break;
    }

    code += text.slice(cursor, open);

    const close: number = text.indexOf("*/", open + 2);

    cursor = close < 0 ? text.length : close + 2;
  }

  return code
    .split("\n")
    .filter((line: string): boolean => {
      return !line.trim().startsWith("//");
    })
    .join("\n");
};

const readCode: (file: string) => string = (file: string): string => {
  return withoutComments(fs.readFileSync(file, "utf8")).replace(
    WHITESPACE_RUN,
    " ",
  );
};

const listFiles: (dir: string) => Array<string> = (
  dir: string,
): Array<string> => {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry: fs.Dirent): Array<string> => {
      const full: string = path.join(dir, entry.name);

      return entry.isDirectory() ? listFiles(full) : [full];
    });
};

const isSourceFile: (file: string) => boolean = (file: string): boolean => {
  return file.endsWith(".ts") || file.endsWith(".tsx");
};

interface SourceFile {
  file: string;
  code: string;
}

const DASHBOARD_FILES: Array<SourceFile> = listFiles(DASHBOARD_SRC)
  .filter(isSourceFile)
  .map((file: string): SourceFile => {
    return { file: path.relative(DASHBOARD_SRC, file), code: readCode(file) };
  });

// The Dashboard's menus: every side menu, and the Cmd+K page index.
const MENU_FILES: Array<SourceFile> = DASHBOARD_FILES.filter(
  (source: SourceFile): boolean => {
    const name: string = path.basename(source.file);

    return (
      name.startsWith("SideMenu.") ||
      name.endsWith("SideMenu.tsx") ||
      name.endsWith("SideMenu.ts") ||
      source.file === COMMAND_PALETTE_INDEX
    );
  },
);

interface TitledEntry {
  file: string;
  title: string;
  // The icon named after the title and before the next entry's, if any.
  icon: string | null;
}

// The name after "IconProp." at a position: letters and digits.
const iconNameAt: (code: string, start: number) => string = (
  code: string,
  start: number,
): string => {
  let end: number = start;

  while (end < code.length && ICON_NAME_CHARACTER.test(code.charAt(end))) {
    end++;
  }

  return `${ICON_PREFIX}${code.slice(start, end)}`;
};

// Every `title: "..."` in a file, with the icon its entry names.
const titledEntries: (source: SourceFile) => Array<TitledEntry> = (
  source: SourceFile,
): Array<TitledEntry> => {
  const found: Array<TitledEntry> = [];
  let at: number = source.code.indexOf(TITLE_OPENER);

  while (at >= 0) {
    const titleStart: number = at + TITLE_OPENER.length;
    const titleEnd: number = source.code.indexOf('"', titleStart);
    const next: number = source.code.indexOf(TITLE_OPENER, titleEnd + 1);
    const entry: string = source.code.slice(
      titleEnd + 1,
      next < 0 ? source.code.length : next,
    );

    let icon: string | null = null;

    for (const key of ICON_KEYS) {
      const keyAt: number = entry.indexOf(key);

      if (keyAt >= 0) {
        icon = iconNameAt(entry, keyAt + key.length);
        break;
      }
    }

    found.push({
      file: source.file,
      title: source.code.slice(titleStart, titleEnd),
      icon: icon,
    });

    at = next;
  }

  return found;
};

// An entry for a page named "<something> Timeline".
const opensATimeline: (entry: TitledEntry) => boolean = (
  entry: TitledEntry,
): boolean => {
  return (
    entry.title.endsWith(TIMELINE_SUFFIX) &&
    entry.title.length > TIMELINE_SUFFIX.length
  );
};

const MENU_ENTRIES: Array<TitledEntry> = MENU_FILES.flatMap(titledEntries);

const TIMELINE_ENTRIES: Array<TitledEntry> =
  MENU_ENTRIES.filter(opensATimeline);

const describeEntry: (entry: TitledEntry) => string = (
  entry: TitledEntry,
): string => {
  return `${entry.file}: ${entry.title}`;
};

describe("a timeline is shown with the timeline's icon", () => {
  test("the menus are read, and their timeline entries found", () => {
    // Read from the files, so the checks below are not vacuous.
    expect(MENU_FILES.length).toBeGreaterThan(50);
    expect(
      MENU_FILES.map((source: SourceFile): string => {
        return source.file;
      }),
    ).toContain(COMMAND_PALETTE_INDEX);

    expect(TIMELINE_ENTRIES.map(describeEntry)).toEqual(
      expect.arrayContaining([
        `${path.join("Pages", "Monitor", "View", "SideMenu.tsx")}: Status Timeline`,
        `${path.join("Pages", "Incidents", "View", "SideMenu.tsx")}: State Timeline`,
        `${path.join("Pages", "Incidents", "EpisodeView", "SideMenu.tsx")}: State Timeline`,
        `${path.join("Pages", "Alerts", "View", "SideMenu.tsx")}: State Timeline`,
        `${path.join("Pages", "Alerts", "EpisodeView", "SideMenu.tsx")}: State Timeline`,
        `${path.join("Pages", "ScheduledMaintenanceEvents", "View", "SideMenu.tsx")}: State Timeline`,
        `${path.join("Pages", "NetworkSite", "View", "SideMenu.tsx")}: Status Timeline`,
        `${path.join("Pages", "OnCallDuty", "SideMenu.tsx")}: Schedule Timeline`,
        `${COMMAND_PALETTE_INDEX}: Schedule Timeline`,
      ]),
    );
  });

  test("every menu entry for a timeline page draws IconProp.Timeline", () => {
    const otherwise: Array<string> = TIMELINE_ENTRIES.filter(
      (entry: TitledEntry): boolean => {
        return entry.icon !== TIMELINE_ICON;
      },
    ).map((entry: TitledEntry): string => {
      return `${describeEntry(entry)} draws ${entry.icon || "no icon"}`;
    });

    expect(otherwise).toEqual([]);
  });

  test("in the menus, IconProp.Timeline marks timelines only", () => {
    const markingSomethingElse: Array<string> = MENU_ENTRIES.filter(
      (entry: TitledEntry): boolean => {
        return entry.icon === TIMELINE_ICON && !opensATimeline(entry);
      },
    ).map(describeEntry);

    expect(markingSomethingElse).toEqual([]);

    // And no menu names it anywhere an entry's title does not lead to it.
    const uses: number = MENU_FILES.reduce(
      (count: number, source: SourceFile): number => {
        return count + source.code.split(TIMELINE_ICON).length - 1;
      },
      0,
    );

    expect(uses).toBe(TIMELINE_ENTRIES.length);
  });

  /*
   * The schedules list's action is named as the page it opens, Schedule
   * Timeline, where it said "Timeline View", and draws its icon.
   */
  test("the schedules list's Schedule Timeline action draws IconProp.Timeline", () => {
    const schedulesList: string = path.join(
      "Pages",
      "OnCallDuty",
      "OnCallDutySchedules.tsx",
    );
    const buttons: Array<TitledEntry> = DASHBOARD_FILES.flatMap(
      titledEntries,
    ).filter((entry: TitledEntry): boolean => {
      return entry.file === schedulesList && opensATimeline(entry);
    });

    expect(buttons.map(describeEntry)).toEqual([
      `${schedulesList}: Schedule Timeline`,
    ]);
    expect(buttons[0]?.icon).toBe(TIMELINE_ICON);
    expect(
      DASHBOARD_FILES.flatMap(titledEntries).filter(
        (entry: TitledEntry): boolean => {
          return entry.title === "Timeline View";
        },
      ),
    ).toEqual([]);
  });
});

describe("reading a menu's entries", () => {
  /*
   * The checks above are only as good as this reader; one that found no
   * icon, or the wrong entry's, would make them pass or fail for nothing.
   */
  test("pairs each title with the icon its own entry names, as an object key or a JSX prop", () => {
    const code: string = [
      '{ link: { title: "Overview", to: x }, icon: IconProp.Info },',
      '<SideMenuItem link={{ title: "State Timeline", to: y }} icon={IconProp.Timeline} />',
      '{ title: "Timeline", to: z },',
      '{ link: { title: "Audit Logs", to: w }, icon: IconProp.List }',
    ].join(" ");

    expect(titledEntries({ file: "Menu.tsx", code: code })).toEqual([
      { file: "Menu.tsx", title: "Overview", icon: "IconProp.Info" },
      { file: "Menu.tsx", title: "State Timeline", icon: "IconProp.Timeline" },
      { file: "Menu.tsx", title: "Timeline", icon: null },
      { file: "Menu.tsx", title: "Audit Logs", icon: "IconProp.List" },
    ]);
  });

  test("a page named '<something> Timeline' is a timeline; a bare 'Timeline' sub-entry is not", () => {
    const entry: (title: string) => TitledEntry = (
      title: string,
    ): TitledEntry => {
      return { file: "Menu.tsx", title: title, icon: null };
    };

    expect(opensATimeline(entry("Status Timeline"))).toBe(true);
    expect(opensATimeline(entry("Schedule Timeline"))).toBe(true);
    expect(opensATimeline(entry("Timeline"))).toBe(false);
    expect(opensATimeline(entry("Timeline View"))).toBe(false);
    expect(opensATimeline(entry("Audit Logs"))).toBe(false);
  });

  test("drops comments, so prose about an icon is not read as code", () => {
    expect(
      withoutComments(
        [
          "/* icon: IconProp.List */ a",
          "// icon: IconProp.List",
          "b /* two",
          "lines */ c",
        ].join("\n"),
      ).replace(WHITESPACE_RUN, " "),
    ).toBe(" a b c");
  });
});
