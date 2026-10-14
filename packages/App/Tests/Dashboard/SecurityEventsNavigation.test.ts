import { beforeAll, describe, expect, test } from "@jest/globals";
import {
  SECURITY_EVENTS_DETAIL_PAGES,
  SECURITY_EVENTS_LANDING_PAGE,
  SECURITY_EVENTS_MENU,
  SecurityEventsMenuItem,
  SecurityEventsMenuSection,
  getSecurityEventsMenuItems,
  getSecurityEventsPathSegment,
} from "../../FeatureSet/Dashboard/src/Utils/SecurityEventsNavigation";

/*
 * The Security Events menu, as data: its sections in the order the work
 * goes, every page in exactly one place, and the pages that open on their
 * own (a case, a playbook) in none. The rendered menu is pinned in
 * Common/Tests/App/Dashboard/SecurityEventsSideMenu.test.tsx.
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
  test("reads as the work does: overview, investigate, detect, respond, sources", () => {
    expect(
      SECURITY_EVENTS_MENU.map((section: SecurityEventsMenuSection): string => {
        return section.title;
      }),
    ).toEqual(["Overview", "Investigate", "Detect", "Respond", "Sources"]);
  });

  test("lists each section's pages in order, by the titles the docs use", () => {
    expect(
      SECURITY_EVENTS_MENU.map(
        (section: SecurityEventsMenuSection): Array<string> => {
          return section.items.map((item: SecurityEventsMenuItem): string => {
            return item.title;
          });
        },
      ),
    ).toEqual([
      ["Overview", "Security Cases"],
      ["Events", "Correlate", "Entities"],
      [
        "Detection Rules",
        "Rule Library",
        "ATT&CK Coverage",
        "Threat Intel",
        "Monitors",
      ],
      ["Playbooks", "Playbook Runs"],
      ["Connections", "Setup Guide"],
    ]);
  });

  test("puts every routed page in the menu exactly once, except the pages that open on their own", () => {
    const menuPages: Array<string> = getSecurityEventsMenuItems().map(
      (item: SecurityEventsMenuItem): string => {
        return item.page;
      },
    );

    expect(new Set(menuPages).size).toBe(menuPages.length);
    expect([...menuPages, ...SECURITY_EVENTS_DETAIL_PAGES].sort()).toEqual(
      Object.keys(SecurityEventsRoutePath).sort(),
    );
  });

  test("folds away the sections for setting up, and keeps the working ones open", () => {
    expect(
      SECURITY_EVENTS_MENU.map(
        (section: SecurityEventsMenuSection): [string, boolean] => {
          return [section.title, Boolean(section.startsCollapsed)];
        },
      ),
    ).toEqual([
      ["Overview", false],
      ["Investigate", false],
      ["Detect", true],
      // Playbook Runs' count of the steps waiting for approval stays on screen.
      ["Respond", false],
      ["Sources", true],
    ]);
  });

  test("counts what is waiting beside Cases and Playbook Runs, and nowhere else", () => {
    expect(
      getSecurityEventsMenuItems()
        .filter((item: SecurityEventsMenuItem): boolean => {
          return Boolean(item.badge);
        })
        .map((item: SecurityEventsMenuItem): [string, string] => {
          return [item.title, item.badge || ""];
        }),
    ).toEqual([
      ["Security Cases", "openCases"],
      ["Playbook Runs", "runsWaitingForApproval"],
    ]);
  });

  test("gives every entry an icon of its own within its section", () => {
    for (const section of SECURITY_EVENTS_MENU) {
      const icons: Array<string> = section.items.map(
        (item: SecurityEventsMenuItem): string => {
          return String(item.icon);
        },
      );

      expect([section.title, new Set(icons).size]).toEqual([
        section.title,
        icons.length,
      ]);
    }
  });

  test("opens on the overview, which is the first entry", () => {
    expect(SECURITY_EVENTS_LANDING_PAGE).toBe(
      SECURITY_EVENTS_MENU[0]!.items[0]!.page,
    );
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
