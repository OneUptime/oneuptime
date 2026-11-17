// UX rule: Docs/ux/README.md#side-menus
import {
  MONITOR_ROW_STATUS_COLORS,
  MonitorRowStatusKind,
} from "Common/Utils/Monitor/MonitorRowStatus";
import { Gray500 } from "Common/Types/BrandColors";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * RED IS FOR WHAT BROKE, NEVER FOR A CHOICE (#9126).
 *
 * The Monitors menu filed Disabled under Attention Required, with the error
 * icon and a red count, beside Not Operational. Disabling a monitor is
 * something a person does on purpose; a red count that never goes away for
 * it taught people to ignore red, including the red that meant an outage.
 *
 * So a state someone chose (Disabled, Archived, Paused) is drawn calm
 * wherever it shows:
 *
 *   - in every side menu of the Dashboard, its entry carries no danger or
 *     warning badge and no error or alert icon;
 *   - a monitor's row status (the Monitors list, the Monitor List widget,
 *     the honeycomb, a public dashboard: Utils/Monitor/MonitorRowStatus)
 *     draws it in grey;
 *   - an SLO's Monitors page, which draws its own bubbles, draws it in grey.
 *
 * A new state someone chooses goes in DELIBERATE_TITLES.
 */

const DASHBOARD_SRC: string = path.resolve(
  __dirname,
  "../../FeatureSet/Dashboard/src",
);

// The menu titles of states a person chooses, never a fault.
const DELIBERATE_TITLES: ReadonlyArray<string> = [
  "Disabled",
  "Archived",
  "Paused",
];

const SIDE_MENU_FILE: RegExp = /SideMenu[^/]*\.tsx$/;

const ALARM_MARKS: ReadonlyArray<string> = [
  "BadgeType.DANGER",
  "BadgeType.WARNING",
  "IconProp.Error",
  "IconProp.Alert",
];

function sideMenuFiles(dir: string): Array<string> {
  const found: Array<string> = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full: string = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      found.push(...sideMenuFiles(full));
    } else if (SIDE_MENU_FILE.test(entry.name)) {
      found.push(full);
    }
  }

  return found;
}

/*
 * A menu entry's source: from its title to the next entry's title (or the
 * end of the file), which holds its icon and badge.
 */
function entriesTitled(
  source: string,
  title: string,
): Array<{ at: number; body: string }> {
  const entries: Array<{ at: number; body: string }> = [];
  const marker: string = `title: "${title}",`;
  let at: number = source.indexOf(marker);

  while (at !== -1) {
    const next: number = source.indexOf("title:", at + marker.length);
    entries.push({
      at: at,
      body: source.slice(at, next === -1 ? source.length : next),
    });
    at = source.indexOf(marker, at + marker.length);
  }

  return entries;
}

describe("a state someone chose is never drawn as danger", () => {
  const files: Array<string> = sideMenuFiles(path.join(DASHBOARD_SRC, "Pages"));

  test("the guard reads the Dashboard's side menus, the Monitors menu among them", () => {
    expect(files.length).toBeGreaterThan(20);
    expect(
      files.some((file: string): boolean => {
        return file.endsWith(path.join("Pages", "Monitor", "SideMenu.tsx"));
      }),
    ).toBe(true);
  });

  test("no side menu entry for Disabled, Archived or Paused carries a red or amber badge, or an alarm icon", () => {
    const offenders: Array<string> = [];

    for (const file of files) {
      const source: string = fs.readFileSync(file, "utf8");

      for (const title of DELIBERATE_TITLES) {
        for (const entry of entriesTitled(source, title)) {
          for (const mark of ALARM_MARKS) {
            if (entry.body.includes(mark)) {
              offenders.push(
                `${path.relative(DASHBOARD_SRC, file)}: "${title}" has ${mark}`,
              );
            }
          }
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  test("the Monitors menu's Disabled is counted in grey, with the pause icon its banner shows", () => {
    const source: string = fs.readFileSync(
      path.join(DASHBOARD_SRC, "Pages", "Monitor", "SideMenu.tsx"),
      "utf8",
    );
    const disabled: Array<{ at: number; body: string }> = entriesTitled(
      source,
      "Disabled",
    );

    expect(disabled).toHaveLength(1);
    expect(disabled[0]!.body).toContain("badgeType: BadgeType.NEUTRAL,");
    expect(disabled[0]!.body).toContain("icon: IconProp.Pause,");
    // Not filed under Attention Required, which lists what needs fixing.
    expect(disabled[0]!.at).toBeLessThan(
      source.indexOf('title: "Attention Required"'),
    );
  });

  test("a monitor's row draws Disabled, Archived and Paused in grey", () => {
    expect(MONITOR_ROW_STATUS_COLORS[MonitorRowStatusKind.MonitoringOff]).toBe(
      Gray500,
    );
    expect(MONITOR_ROW_STATUS_COLORS[MonitorRowStatusKind.Archived]).toBe(
      Gray500,
    );
    expect(
      MONITOR_ROW_STATUS_COLORS[MonitorRowStatusKind.PausedBeforeFirstCheck],
    ).toBe(Gray500);
  });

  test("an SLO's Monitors page draws Disabled and Archived in grey", () => {
    const source: string = fs.readFileSync(
      path.join(DASHBOARD_SRC, "Pages", "Slo", "View", "Monitors.tsx"),
      "utf8",
    );

    for (const word of ["Disabled", "Archived"]) {
      const at: number = source.indexOf(`text={"${word}"}`);
      expect(at).toBeGreaterThan(-1);
      const bubble: string = source.slice(
        source.lastIndexOf("<Statusbubble", at),
        at,
      );
      expect(bubble).toContain("color={Gray500}");
    }
  });
});
