import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A page goes by one name: its side-menu entry, its trail's last crumb and
 * the card on it (#4920's follow-up). Two labels disagreed:
 *
 *  - An incident's, alert's, episode's and maintenance event's "State
 *    Timeline" page held a card titled "Status Timeline" that spoke of
 *    "each status" - for records that have states, which the menu, the
 *    trail, the docs and the State Timeline's own form all call states.
 *    The card is "State Timeline" now, and its description, empty message
 *    and screen-reader name say "state". A monitor's and a network site's
 *    pages show statuses: they stay "Status Timeline", card and menu alike.
 *  - The on-call schedules list's "Timeline View" opened the page the menu,
 *    Search and the trail call "Schedule Timeline": it is named so now.
 *
 * Code is compared with all whitespace removed, so line wrapping chosen by
 * the formatter cannot break an assertion.
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

function compact(text: string): string {
  return text.replace(/\s+/g, "");
}

// A source file without its comments: what it draws, not what it says about it.
function read(relativePath: string): string {
  return fs
    .readFileSync(path.join(DASHBOARD_SRC, relativePath), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");
}

interface StateTimelinePage {
  page: string;
  menu: string;
  trail: string;
  pageMapKey: string;
  // How the page's sentences name the record.
  record: string;
}

const STATE_TIMELINE_PAGES: Array<StateTimelinePage> = [
  {
    page: "Pages/Incidents/View/StateTimeline.tsx",
    menu: "Pages/Incidents/View/SideMenu.tsx",
    trail: "Utils/Breadcrumbs/IncidentBreadcrumbs.ts",
    pageMapKey: "INCIDENT_VIEW_STATE_TIMELINE",
    record: "incident",
  },
  {
    page: "Pages/Alerts/View/StateTimeline.tsx",
    menu: "Pages/Alerts/View/SideMenu.tsx",
    trail: "Utils/Breadcrumbs/AlertBreadcrumbs.ts",
    pageMapKey: "ALERT_VIEW_STATE_TIMELINE",
    record: "alert",
  },
  {
    page: "Pages/Incidents/EpisodeView/StateTimeline.tsx",
    menu: "Pages/Incidents/EpisodeView/SideMenu.tsx",
    trail: "Utils/Breadcrumbs/IncidentBreadcrumbs.ts",
    pageMapKey: "INCIDENT_EPISODE_VIEW_STATE_TIMELINE",
    record: "episode",
  },
  {
    page: "Pages/Alerts/EpisodeView/StateTimeline.tsx",
    menu: "Pages/Alerts/EpisodeView/SideMenu.tsx",
    trail: "Utils/Breadcrumbs/AlertBreadcrumbs.ts",
    pageMapKey: "ALERT_EPISODE_VIEW_STATE_TIMELINE",
    record: "episode",
  },
  {
    page: "Pages/ScheduledMaintenanceEvents/View/StateTimeline.tsx",
    menu: "Pages/ScheduledMaintenanceEvents/View/SideMenu.tsx",
    trail: "Utils/Breadcrumbs/ScheduledMaintenanceBreadcrumbs.ts",
    pageMapKey: "SCHEDULED_MAINTENANCE_VIEW_STATE_TIMELINE",
    record: "maintenance event",
  },
];

const STATUS_TIMELINE_PAGES: Array<{ page: string; menu: string }> = [
  {
    page: "Pages/Monitor/View/StatusTimeline.tsx",
    menu: "Pages/Monitor/View/SideMenu.tsx",
  },
  {
    page: "Pages/NetworkSite/View/StatusTimeline.tsx",
    menu: "Pages/NetworkSite/View/SideMenu.tsx",
  },
];

/*
 * The title of the menu entry that links to a page: the nearest `title:`
 * written before the page's PageMap key, its spaces removed as compact()
 * removes them.
 */
function menuTitleFor(menuSource: string, pageMapKey: string): string {
  const code: string = compact(menuSource);
  const at: number = code.indexOf(`PageMap.${pageMapKey}]`);

  expect(at).toBeGreaterThan(-1);

  const titleAt: number = code.lastIndexOf('title:"', at);
  const start: number = titleAt + 'title:"'.length;

  return code.slice(start, code.indexOf('"', start));
}

/*
 * The last title of a page's trail: the last string of the list given to
 * BuildBreadcrumbLinksByTitles for its PageMap key, its spaces removed.
 */
function lastCrumbFor(trailSource: string, pageMapKey: string): string {
  const code: string = compact(trailSource);
  const at: number = code.indexOf(`(PageMap.${pageMapKey},[`);

  expect(at).toBeGreaterThan(-1);

  const list: string = code.slice(at, code.indexOf("]", at));
  const titles: Array<string> = list
    .split('"')
    .filter((_part: string, index: number): boolean => {
      return index % 2 === 1;
    });

  return titles[titles.length - 1] || "";
}

describe("a record with states: its timeline is the State Timeline throughout", () => {
  test.each(STATE_TIMELINE_PAGES)(
    "$page: menu, trail and card agree",
    (entry: StateTimelinePage) => {
      const page: string = compact(read(entry.page));

      expect(menuTitleFor(read(entry.menu), entry.pageMapKey)).toBe(
        compact("State Timeline"),
      );
      expect(lastCrumbFor(read(entry.trail), entry.pageMapKey)).toBe(
        compact("State Timeline"),
      );

      // The timeline view's card, and the table view's.
      expect(page).toContain(compact('title="State Timeline"'));
      expect(page).toContain(compact('title: "State Timeline",'));
      expect(page).not.toContain(compact('"Status Timeline"'));
    },
  );

  test.each(STATE_TIMELINE_PAGES)(
    "$page: its sentences say state, not status",
    (entry: StateTimelinePage) => {
      const page: string = compact(read(entry.page));
      const description: string = `Each state this ${entry.record} has been in, when it began and how long it lasted.`;
      const empty: string = `No state recorded for this ${entry.record} yet.`;

      expect(page).toContain(compact(`description="${description}"`));
      expect(page).toContain(compact(`"${description}"`));
      expect(page).toContain(
        compact(`ariaLabel="State timeline of this ${entry.record}"`),
      );
      expect(page).toContain(compact(`emptyMessage="${empty}"`));
      // The table view says it the same way, not "No status timeline created".
      expect(page).toContain(compact(`noItemsMessage={"${empty}"}`));

      for (const old of [
        `Each status this ${entry.record}`,
        `Status timeline of this ${entry.record}`,
        `No status recorded for this ${entry.record}`,
        "No status timeline created",
      ]) {
        expect(page).not.toContain(compact(old));
      }
    },
  );
});

describe("a record with statuses keeps its Status Timeline", () => {
  test.each(STATUS_TIMELINE_PAGES)(
    "$page: menu and card both say Status Timeline",
    (entry: { page: string; menu: string }) => {
      expect(compact(read(entry.menu))).toContain(
        compact('title: "Status Timeline",'),
      );
      expect(compact(read(entry.page))).toContain(
        compact('title="Status Timeline"'),
      );
    },
  );
});

describe("the schedules list names the page it opens", () => {
  test("Schedule Timeline, as the menu, the trail and Search call it", () => {
    const list: string = compact(
      read("Pages/OnCallDuty/OnCallDutySchedules.tsx"),
    );

    expect(list).toContain(
      compact('title: "Schedule Timeline", icon: IconProp.Timeline,'),
    );
    expect(list).not.toContain(compact('"Timeline View"'));
    expect(
      menuTitleFor(
        read("Pages/OnCallDuty/SideMenu.tsx"),
        "ON_CALL_DUTY_SCHEDULE_TIMELINE",
      ),
    ).toBe(compact("Schedule Timeline"));
    expect(
      lastCrumbFor(
        read("Utils/Breadcrumbs/OnCallDutyBreadcrumbs.ts"),
        "ON_CALL_DUTY_SCHEDULE_TIMELINE",
      ),
    ).toBe(compact("Schedule Timeline"));
  });
});

describe("every language says the new words", () => {
  const records: Array<string> = [
    "incident",
    "alert",
    "episode",
    "maintenance event",
  ];
  const KEYS: Array<string> = [
    "State Timeline",
    "Schedule Timeline",
    "Go to Overview",
    ...records.flatMap((record: string): Array<string> => {
      return [
        `Each state this ${record} has been in, when it began and how long it lasted.`,
        `State timeline of this ${record}`,
        `No state recorded for this ${record} yet.`,
      ];
    }),
  ];
  const english: Record<string, string> = JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, "en.json"), "utf8"),
  ) as Record<string, string>;
  const locales: Array<string> = fs
    .readdirSync(LOCALES_DIR)
    .filter((name: string): boolean => {
      return name.endsWith(".json") && name !== "en.json";
    })
    .map((name: string): string => {
      return name.replace(".json", "");
    });

  test("there are sixteen languages, and every key is English's", () => {
    expect(locales).toHaveLength(16);
    for (const key of KEYS) {
      expect({ key, english: english[key] }).toEqual({ key, english: key });
    }
  });

  test.each(locales)("%s translates them", (locale: string) => {
    const values: Record<string, string> = JSON.parse(
      fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
    ) as Record<string, string>;
    const left: Array<string> = KEYS.filter((key: string): boolean => {
      return !values[key] || values[key] === key;
    });

    expect(left).toEqual([]);
  });

  /*
   * The card's title is the menu's title in every language: one key, so
   * one translation.
   */
  test.each(locales)(
    "%s draws the card and the menu entry alike",
    (locale: string) => {
      const values: Record<string, string> = JSON.parse(
        fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
      ) as Record<string, string>;

      expect(values["State Timeline"]).toBeTruthy();
      // Where a language tells status and state apart, the card says state.
      if (values["Status Timeline"] !== values["State Timeline"]) {
        expect(values["State timeline of this incident"]).not.toBe(
          values["Status timeline of this incident"],
        );
      }
    },
  );
});
