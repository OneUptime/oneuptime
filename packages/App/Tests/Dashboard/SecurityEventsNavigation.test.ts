import { beforeAll, describe, expect, test } from "@jest/globals";
import {
  SECURITY_EVENTS_DETAIL_PAGES,
  SECURITY_EVENTS_LANDING_PAGE,
  SECURITY_EVENTS_MENU,
  SECURITY_EVENTS_REDIRECTED_PAGES,
  SECURITY_EVENTS_TAB_GROUPS,
  SecurityEventsMenuItem,
  SecurityEventsTab,
  SecurityEventsTabGroup,
  getSecurityEventsMenuItemFor,
  getSecurityEventsMenuItemPages,
  getSecurityEventsPathSegment,
  getSecurityEventsTabGroup,
} from "../../FeatureSet/Dashboard/src/Utils/SecurityEventsNavigation";

/*
 * The Security Events menu, as data: six entries in the order the work
 * goes, the pages that belong together behind one entry as tabs, every
 * page reachable in exactly one place, and the pages that open on their own
 * (a case, a playbook) and the old addresses in none. The rendered menu and
 * tabs are pinned in Common/Tests/App/Dashboard/SecurityEventsSideMenu.test.tsx.
 *
 * Deferred imports with a browser stub: RouteMap pulls in Common/UI/Config,
 * which reads `window` at module load.
 */

type RouteMapModule =
  typeof import("../../FeatureSet/Dashboard/src/Utils/RouteMap");

let SecurityEventsRoutePath: RouteMapModule["SecurityEventsRoutePath"];
let RouteUtil: RouteMapModule["RouteUtil"];

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";

beforeAll(async () => {
  (globalThis as Record<string, unknown>)["window"] = {
    location: { pathname: "/", search: "", hash: "" },
    history: {
      state: null,
      replaceState: (): void => {
        // no-op; these tests never navigate.
      },
    },
  };

  for (const storageName of ["sessionStorage", "localStorage"]) {
    Object.defineProperty(globalThis, storageName, {
      value: {
        getItem: (): null => {
          return null;
        },
        setItem: (): void => {
          // no-op
        },
        removeItem: (): void => {
          // no-op
        },
      },
      configurable: true,
      writable: true,
    });
  }

  const routeMapModule: RouteMapModule = await import(
    "../../FeatureSet/Dashboard/src/Utils/RouteMap"
  );

  SecurityEventsRoutePath = routeMapModule.SecurityEventsRoutePath;
  RouteUtil = routeMapModule.RouteUtil;
});

function routeFor(pageMapKey: string): string {
  return RouteUtil.getRouteString(pageMapKey as never).replace(
    ":projectId",
    PROJECT_ID,
  );
}

describe("the Security Events menu", () => {
  test("reads as the work does: overview, cases, events, detections, playbooks, connections", () => {
    expect(
      SECURITY_EVENTS_MENU.map((item: SecurityEventsMenuItem): string => {
        return item.title;
      }),
    ).toEqual([
      "Overview",
      "Security Cases",
      "Events",
      "Detections",
      "Playbooks",
      "Connections",
    ]);
  });

  test("puts the pages that belong together behind one entry, as tabs, its own page first", () => {
    expect(
      SECURITY_EVENTS_TAB_GROUPS.map(
        (group: SecurityEventsTabGroup): [string, Array<string>] => {
          return [
            getSecurityEventsMenuItemFor(group.menuPage)?.title || "",
            group.tabs.map((tab: SecurityEventsTab): string => {
              return tab.title;
            }),
          ];
        },
      ),
    ).toEqual([
      ["Events", ["Events", "Entities", "Correlate"]],
      [
        "Detections",
        ["Detection Rules", "Rule Library", "Threat Intel", "ATT&CK Coverage"],
      ],
      ["Playbooks", ["Playbooks", "Playbook Runs"]],
      ["Connections", ["Connections", "Setup Guide"]],
    ]);

    for (const group of SECURITY_EVENTS_TAB_GROUPS) {
      expect(group.tabs[0]!.page).toBe(group.menuPage);
      expect(getSecurityEventsTabGroup(group.menuPage)).toBe(group);
    }
  });

  test("reaches every routed page from the menu exactly once, except the pages that open on their own and the old addresses", () => {
    const reachable: Array<string> = SECURITY_EVENTS_MENU.flatMap(
      (item: SecurityEventsMenuItem): Array<string> => {
        return getSecurityEventsMenuItemPages(item);
      },
    );

    expect(new Set(reachable).size).toBe(reachable.length);
    expect(
      [
        ...reachable,
        ...SECURITY_EVENTS_DETAIL_PAGES,
        ...SECURITY_EVENTS_REDIRECTED_PAGES,
      ].sort(),
    ).toEqual(Object.keys(SecurityEventsRoutePath).sort());
  });

  test("keeps every page of a group under its entry, so the entry stays lit on each tab", () => {
    for (const group of SECURITY_EVENTS_TAB_GROUPS) {
      for (const tab of group.tabs) {
        expect([
          tab.title,
          getSecurityEventsMenuItemFor(tab.page)?.page,
        ]).toEqual([tab.title, group.menuPage]);
      }
    }

    expect(getSecurityEventsMenuItemFor(undefined)).toBeUndefined();
    expect(
      getSecurityEventsMenuItemFor("SECURITY_CASE_VIEW" as never),
    ).toBeUndefined();
  });

  test("opens the old monitors address on Monitors, not in the menu", () => {
    expect(SECURITY_EVENTS_REDIRECTED_PAGES).toEqual([
      "SECURITY_EVENTS_MONITORS",
    ]);
    expect(
      getSecurityEventsMenuItemFor("SECURITY_EVENTS_MONITORS" as never),
    ).toBeUndefined();
  });

  test("counts what is waiting beside Security Cases and Playbooks, and nowhere else", () => {
    expect(
      SECURITY_EVENTS_MENU.filter((item: SecurityEventsMenuItem): boolean => {
        return Boolean(item.badge);
      }).map((item: SecurityEventsMenuItem): [string, string] => {
        return [item.title, item.badge || ""];
      }),
    ).toEqual([
      ["Security Cases", "openCases"],
      ["Playbooks", "runsWaitingForApproval"],
    ]);
  });

  test("gives every entry an icon of its own", () => {
    const icons: Array<string> = SECURITY_EVENTS_MENU.map(
      (item: SecurityEventsMenuItem): string => {
        return String(item.icon);
      },
    );

    expect(new Set(icons).size).toBe(icons.length);
  });

  test("opens on the overview, which is the first entry", () => {
    expect(SECURITY_EVENTS_LANDING_PAGE).toBe(SECURITY_EVENTS_MENU[0]!.page);
  });

  test("routes a case and a playbook under their lists, by id", () => {
    expect(SecurityEventsRoutePath["SECURITY_CASE_VIEW"]).toBe("cases/:id");
    expect(SecurityEventsRoutePath["SECURITY_PLAYBOOK_VIEW"]).toBe(
      "playbooks/:id",
    );
    expect(SecurityEventsRoutePath["SECURITY_CASES"]).toBe("cases");
    expect(SecurityEventsRoutePath["SECURITY_PLAYBOOKS"]).toBe("playbooks");
  });
});

describe("getSecurityEventsPathSegment", () => {
  test("names the segment after the product root", () => {
    expect(
      getSecurityEventsPathSegment(routeFor("SECURITY_EVENTS_DETECTION_RULES")),
    ).toBe("detection-rules");
    expect(getSecurityEventsPathSegment(routeFor("SECURITY_CASES"))).toBe(
      "cases",
    );
  });

  test("is the empty string at the product root and null off the product", () => {
    expect(getSecurityEventsPathSegment(routeFor("SECURITY_EVENTS"))).toBe("");
    expect(
      getSecurityEventsPathSegment(`${routeFor("SECURITY_EVENTS")}/`),
    ).toBe("");
    expect(getSecurityEventsPathSegment(`/dashboard/${PROJECT_ID}/logs`)).toBe(
      null,
    );
    expect(getSecurityEventsPathSegment("")).toBe(null);
  });

  test("a query string or a segment before the product root decides nothing", () => {
    expect(
      getSecurityEventsPathSegment(
        `${routeFor("SECURITY_EVENTS")}?search=cases&filters=playbooks`,
      ),
    ).toBe("");
    expect(
      getSecurityEventsPathSegment(
        "/dashboard/cases/security-events/playbooks",
      ),
    ).toBe("playbooks");
  });

  test("the wildcard react-router leaves on the product route is not a segment", () => {
    expect(
      getSecurityEventsPathSegment(
        `/dashboard/${PROJECT_ID}/security-events/*`,
      ),
    ).toBe("");
  });
});
