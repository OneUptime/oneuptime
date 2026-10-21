import { beforeAll, describe, expect, test } from "@jest/globals";
import {
  SECURITY_EVENTS_DETAIL_PAGES,
  SECURITY_EVENTS_LANDING_PAGE,
  SECURITY_EVENTS_MENU,
  SECURITY_EVENTS_REDIRECTED_PAGES,
  SecurityEventsMenuItem,
  SecurityEventsMenuSection,
  getSecurityEventsMenuItemFor,
  getSecurityEventsMenuItems,
  getSecurityEventsMenuSectionFor,
  getSecurityEventsPageTrail,
  getSecurityEventsPathSegment,
} from "../../FeatureSet/Dashboard/src/Utils/SecurityEventsNavigation";
import {
  SECURITY_CASE_QUEUE_VIEWS,
  SecurityCaseQueueView,
} from "../../FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCaseQueueViews";
import {
  SECURITY_PLAYBOOK_RUN_VIEWS,
  SecurityPlaybookRunView,
} from "../../FeatureSet/Dashboard/src/Components/SecurityPlaybook/SecurityPlaybookRunViews";

/*
 * The Security Events menu, as data: a section for each part of Security
 * and an entry - a page of its own - for everything that used to be a tab
 * across a page's top or a view along the top of a list. "Can we create
 * side menu sections instead and have different pages for these things?
 * ... if I look at security cases: it would be all, closed, assigned to me.
 * Could all of these things be different pages" (the maintainer).
 *
 * Pinned here: the sections and their pages in order, every routed page
 * reachable from exactly one entry, the sections folded until opened, the
 * counts, the old addresses, and where each page says it is. The rendered
 * menu is pinned in Common/Tests/App/Dashboard/SecurityEventsSideMenu.test.tsx.
 *
 * Deferred imports with a browser stub: RouteMap pulls in Common/UI/Config,
 * which reads `window` at module load.
 */

type RouteMapModule =
  typeof import("../../FeatureSet/Dashboard/src/Utils/RouteMap");

let SecurityEventsRoutePath: RouteMapModule["SecurityEventsRoutePath"];
let RouteUtil: RouteMapModule["RouteUtil"];

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";

// The start of a uuid, as a case id begins.
const UUID_START: RegExp = /^[0-9a-f]{8}-/;

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

function titlesOf(section: SecurityEventsMenuSection): Array<string> {
  return section.items.map((item: SecurityEventsMenuItem): string => {
    return item.title;
  });
}

function sectionTitled(title: string): SecurityEventsMenuSection {
  const section: SecurityEventsMenuSection | undefined =
    SECURITY_EVENTS_MENU.find(
      (candidate: SecurityEventsMenuSection): boolean => {
        return candidate.title === title;
      },
    );

  if (!section) {
    throw new Error(`No Security Events section titled "${title}".`);
  }

  return section;
}

describe("the Security Events menu", () => {
  test("is six sections, in the order Security works: overview, cases, events, detections, playbooks, connections", () => {
    expect(
      SECURITY_EVENTS_MENU.map((section: SecurityEventsMenuSection): string => {
        return section.title;
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

  test("gives every page an entry of its own, in its section, in order", () => {
    expect(
      SECURITY_EVENTS_MENU.map(
        (section: SecurityEventsMenuSection): [string, Array<string>] => {
          return [section.title, titlesOf(section)];
        },
      ),
    ).toEqual([
      ["Overview", ["Overview"]],
      [
        "Security Cases",
        [
          "Open Cases",
          "Assigned to Me",
          "Unassigned",
          "Closed Cases",
          "All Cases",
        ],
      ],
      ["Events", ["Events", "Entities", "Correlate"]],
      [
        "Detections",
        ["Detection Rules", "Rule Library", "Threat Intel", "ATT&CK Coverage"],
      ],
      ["Playbooks", ["Playbooks", "Waiting for Approval", "Playbook Runs"]],
      ["Connections", ["Connections", "Setup Guide"]],
    ]);
  });

  test("links each entry to its own page", () => {
    expect(
      getSecurityEventsMenuItems().map(
        (item: SecurityEventsMenuItem): [string, string] => {
          return [item.title, item.page];
        },
      ),
    ).toEqual([
      ["Overview", "SECURITY_EVENTS_OVERVIEW"],
      ["Open Cases", "SECURITY_CASES"],
      ["Assigned to Me", "SECURITY_CASES_ASSIGNED_TO_ME"],
      ["Unassigned", "SECURITY_CASES_UNASSIGNED"],
      ["Closed Cases", "SECURITY_CASES_CLOSED"],
      ["All Cases", "SECURITY_CASES_ALL"],
      ["Events", "SECURITY_EVENTS"],
      ["Entities", "SECURITY_EVENTS_ENTITIES"],
      ["Correlate", "SECURITY_EVENTS_CORRELATE"],
      ["Detection Rules", "SECURITY_EVENTS_DETECTION_RULES"],
      ["Rule Library", "SECURITY_EVENTS_RULE_LIBRARY"],
      ["Threat Intel", "SECURITY_EVENTS_THREAT_INTEL"],
      ["ATT&CK Coverage", "SECURITY_EVENTS_ATTACK_COVERAGE"],
      ["Playbooks", "SECURITY_PLAYBOOKS"],
      ["Waiting for Approval", "SECURITY_PLAYBOOK_RUNS_WAITING_FOR_APPROVAL"],
      ["Playbook Runs", "SECURITY_PLAYBOOK_RUNS"],
      ["Connections", "SECURITY_EVENTS_CONNECTIONS"],
      ["Setup Guide", "SECURITY_EVENTS_DOCUMENTATION"],
    ]);
  });

  test("reaches every routed page from exactly one entry, except the pages that open on their own and the old addresses", () => {
    const reachable: Array<string> = getSecurityEventsMenuItems().map(
      (item: SecurityEventsMenuItem): string => {
        return item.page;
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

  test("folds the sections set up once - Detections and Connections - and keeps the everyday ones open", () => {
    expect(
      SECURITY_EVENTS_MENU.map(
        (section: SecurityEventsMenuSection): [string, boolean] => {
          return [section.title, Boolean(section.startsCollapsed)];
        },
      ),
    ).toEqual([
      ["Overview", false],
      ["Security Cases", false],
      ["Events", false],
      ["Detections", true],
      // Open: a run held for an approval does nothing until somebody decides.
      ["Playbooks", false],
      ["Connections", true],
    ]);
  });

  test("counts what is waiting beside Open Cases, Assigned to Me and Waiting for Approval, and nowhere else", () => {
    expect(
      getSecurityEventsMenuItems()
        .filter((item: SecurityEventsMenuItem): boolean => {
          return Boolean(item.badge);
        })
        .map((item: SecurityEventsMenuItem): [string, string] => {
          return [item.title, item.badge || ""];
        }),
    ).toEqual([
      ["Open Cases", "openCases"],
      ["Assigned to Me", "myOpenCases"],
      ["Waiting for Approval", "runsWaitingForApproval"],
    ]);
  });

  test("gives every entry an icon of its own", () => {
    const icons: Array<string> = getSecurityEventsMenuItems().map(
      (item: SecurityEventsMenuItem): string => {
        return String(item.icon);
      },
    );

    expect(icons.every(Boolean)).toBe(true);
    expect(new Set(icons).size).toBe(icons.length);
  });

  test("opens on the overview, which is the first entry", () => {
    expect(SECURITY_EVENTS_LANDING_PAGE).toBe(
      SECURITY_EVENTS_MENU[0]!.items[0]!.page,
    );
  });

  test("uses no section title that every menu folds for another reason", () => {
    // "Security" is folded in every menu (a profile's sign-in settings).
    for (const section of SECURITY_EVENTS_MENU) {
      expect(section.title).not.toBe("Security");
    }
  });
});

describe("the case queue's pages are the queue's views", () => {
  test("Security Cases lists each view as its page, with its name and icon", () => {
    expect(
      sectionTitled("Security Cases").items.map(
        (item: SecurityEventsMenuItem): [string, string, string] => {
          return [item.title, item.page, String(item.icon)];
        },
      ),
    ).toEqual(
      SECURITY_CASE_QUEUE_VIEWS.map(
        (view: SecurityCaseQueueView): [string, string, string] => {
          return [view.title, view.page, String(view.icon)];
        },
      ),
    );
  });

  test("Playbooks lists the two runs pages after the playbooks, with their names and icons", () => {
    expect(
      sectionTitled("Playbooks")
        .items.slice(1)
        .map((item: SecurityEventsMenuItem): [string, string, string] => {
          return [item.title, item.page, String(item.icon)];
        }),
    ).toEqual(
      SECURITY_PLAYBOOK_RUN_VIEWS.map(
        (view: SecurityPlaybookRunView): [string, string, string] => {
          return [view.title, view.page, String(view.icon)];
        },
      ),
    );
  });
});

describe("the pages' addresses", () => {
  test("keep every page that was a tab at the address it had", () => {
    expect(
      [
        "SECURITY_EVENTS",
        "SECURITY_EVENTS_ENTITIES",
        "SECURITY_EVENTS_CORRELATE",
        "SECURITY_EVENTS_DETECTION_RULES",
        "SECURITY_EVENTS_RULE_LIBRARY",
        "SECURITY_EVENTS_THREAT_INTEL",
        "SECURITY_EVENTS_ATTACK_COVERAGE",
        "SECURITY_PLAYBOOKS",
        "SECURITY_EVENTS_CONNECTIONS",
        "SECURITY_EVENTS_DOCUMENTATION",
        "SECURITY_EVENTS_OVERVIEW",
      ].map((page: string): string => {
        return SecurityEventsRoutePath[page] as string;
      }),
    ).toEqual([
      "",
      "entities",
      "correlate",
      "detection-rules",
      "rule-library",
      "threat-intel",
      "attack-coverage",
      "playbooks",
      "connections",
      "documentation",
      "overview",
    ]);
  });

  test("keep the case queue's address on what it opened on, the open cases, with each other case page under it", () => {
    expect(SecurityEventsRoutePath["SECURITY_CASES"]).toBe("cases");
    expect(SecurityEventsRoutePath["SECURITY_CASES_ASSIGNED_TO_ME"]).toBe(
      "cases/assigned-to-me",
    );
    expect(SecurityEventsRoutePath["SECURITY_CASES_UNASSIGNED"]).toBe(
      "cases/unassigned",
    );
    expect(SecurityEventsRoutePath["SECURITY_CASES_CLOSED"]).toBe(
      "cases/closed",
    );
    expect(SecurityEventsRoutePath["SECURITY_CASES_ALL"]).toBe("cases/all");
    expect(SecurityEventsRoutePath["SECURITY_CASE_VIEW"]).toBe("cases/:id");
  });

  test("keep the runs page's address on what it opened on, the runs waiting for approval, with every run under it", () => {
    expect(
      SecurityEventsRoutePath["SECURITY_PLAYBOOK_RUNS_WAITING_FOR_APPROVAL"],
    ).toBe("playbook-runs");
    expect(SecurityEventsRoutePath["SECURITY_PLAYBOOK_RUNS"]).toBe(
      "playbook-runs/all",
    );
    expect(SecurityEventsRoutePath["SECURITY_PLAYBOOK_VIEW"]).toBe(
      "playbooks/:id",
    );
  });

  test("never name a case page's segment like a case id", () => {
    /*
     * A case's page is cases/:id. The words beside it are never an id, so
     * react-router ranks them first and a real case id never collides.
     */
    for (const view of SECURITY_CASE_QUEUE_VIEWS) {
      const path: string = SecurityEventsRoutePath[view.page] as string;
      const last: string = path.split("/").pop() || "";

      expect(path.startsWith("cases")).toBe(true);
      expect(last).not.toMatch(UUID_START);
    }
  });

  test("keep the Monitors address, which opens Monitors, out of the menu", () => {
    expect(SECURITY_EVENTS_REDIRECTED_PAGES).toEqual([
      "SECURITY_EVENTS_MONITORS",
    ]);
    expect(
      getSecurityEventsMenuItemFor("SECURITY_EVENTS_MONITORS" as never),
    ).toBeUndefined();
  });
});

describe("where each page says it is", () => {
  test("names the product, the section and the page, and a page named like its section once", () => {
    expect(
      getSecurityEventsMenuItems().map(
        (item: SecurityEventsMenuItem): Array<string> | undefined => {
          return getSecurityEventsPageTrail(item.page);
        },
      ),
    ).toEqual([
      ["Security Events", "Overview"],
      ["Security Events", "Security Cases", "Open Cases"],
      ["Security Events", "Security Cases", "Assigned to Me"],
      ["Security Events", "Security Cases", "Unassigned"],
      ["Security Events", "Security Cases", "Closed Cases"],
      ["Security Events", "Security Cases", "All Cases"],
      ["Security Events", "Events"],
      ["Security Events", "Events", "Entities"],
      ["Security Events", "Events", "Correlate"],
      ["Security Events", "Detections", "Detection Rules"],
      ["Security Events", "Detections", "Rule Library"],
      ["Security Events", "Detections", "Threat Intel"],
      ["Security Events", "Detections", "ATT&CK Coverage"],
      ["Security Events", "Playbooks"],
      ["Security Events", "Playbooks", "Waiting for Approval"],
      ["Security Events", "Playbooks", "Playbook Runs"],
      ["Security Events", "Connections"],
      ["Security Events", "Connections", "Setup Guide"],
    ]);
  });

  test("has no trail for a page outside the menu", () => {
    expect(
      getSecurityEventsPageTrail("SECURITY_CASE_VIEW" as never),
    ).toBeUndefined();
    expect(
      getSecurityEventsPageTrail("SECURITY_EVENTS_MONITORS" as never),
    ).toBeUndefined();
  });

  test("finds a page's section and entry, and nothing for a page the menu does not list", () => {
    expect(
      getSecurityEventsMenuSectionFor("SECURITY_CASES_CLOSED" as never)?.title,
    ).toBe("Security Cases");
    expect(
      getSecurityEventsMenuSectionFor(
        "SECURITY_PLAYBOOK_RUNS_WAITING_FOR_APPROVAL" as never,
      )?.title,
    ).toBe("Playbooks");
    expect(
      getSecurityEventsMenuItemFor("SECURITY_EVENTS_ENTITIES" as never)?.title,
    ).toBe("Entities");
    expect(getSecurityEventsMenuSectionFor(undefined)).toBeUndefined();
    expect(getSecurityEventsMenuItemFor(undefined)).toBeUndefined();
    expect(
      getSecurityEventsMenuItemFor("SECURITY_CASE_VIEW" as never),
    ).toBeUndefined();
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
    expect(
      getSecurityEventsPathSegment(routeFor("SECURITY_CASES_CLOSED")),
    ).toBe("cases");
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
