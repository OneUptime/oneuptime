import { beforeAll, describe, expect, test } from "@jest/globals";
import {
  SECURITY_CASE_CRUMB,
  SECURITY_CASE_MENU,
  SecurityCaseMenuItem,
  SecurityCaseMenuSection,
  getSecurityCaseMenuItemFor,
  getSecurityCasePageTrail,
  getSecurityCasePages,
  isSecurityCasePage,
} from "../../FeatureSet/Dashboard/src/Utils/SecurityCaseNavigation";
import {
  SECURITY_EVENTS_DETAIL_PAGES,
  SECURITY_EVENTS_MENU,
  SecurityEventsMenuItem,
  SecurityEventsMenuSection,
} from "../../FeatureSet/Dashboard/src/Utils/SecurityEventsNavigation";
import { SECURITY_CASE_QUEUE_VIEWS } from "../../FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCaseQueueViews";
import PageMap from "../../FeatureSet/Dashboard/src/Utils/PageMap";
import IconProp from "Common/Types/Icon/IconProp";

/*
 * A security case's own side menu, as data: "When I open the case, can I
 * have a side menu (on the similar lines that we do for incidents / alerts
 * / scheduled maintenance)" (the maintainer). The one long page became a
 * page for each of the case's parts, under an incident's sections, in an
 * incident's order.
 *
 * Pinned here: the sections and their pages in order and with their icons,
 * every page of a case reachable from exactly one entry, its address under
 * the case's own (the case's address is still its Overview, so every link
 * to a case lands where it did), where each page says it is, and the one
 * count. The rendered menu is pinned in
 * Common/Tests/App/Dashboard/SecurityCaseSideMenu.test.tsx, and the menu
 * beside an incident's in RecordMenusReadTheSame.test.tsx.
 *
 * Deferred imports with a browser stub: RouteMap pulls in Common/UI/Config,
 * which reads `window` at module load.
 */

type RouteMapModule =
  typeof import("../../FeatureSet/Dashboard/src/Utils/RouteMap");

let SecurityEventsRoutePath: RouteMapModule["SecurityEventsRoutePath"];
let RouteUtil: RouteMapModule["RouteUtil"];

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const CASE_ID: string = "22222222-2222-4222-8222-222222222222";

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
  return RouteUtil.getRouteString(pageMapKey as never)
    .replace(":projectId", PROJECT_ID)
    .replace(":id", CASE_ID);
}

function itemsOf(
  section: SecurityCaseMenuSection,
): Array<[string, string, string]> {
  return section.items.map(
    (item: SecurityCaseMenuItem): [string, string, string] => {
      return [item.title, item.page, item.icon];
    },
  );
}

describe("a case's side menu", () => {
  test("has an incident's sections, in an incident's order, where a case has pages for them", () => {
    expect(
      SECURITY_CASE_MENU.map((section: SecurityCaseMenuSection): string => {
        return section.title;
      }),
    ).toEqual(["Overview", "Investigation", "Notes", "Advanced"]);
  });

  test("lists every part of a case as a page of its own, each with its icon", () => {
    expect(SECURITY_CASE_MENU.map(itemsOf)).toEqual([
      [
        ["Overview", "SECURITY_CASE_VIEW", IconProp.Info],
        ["Timeline", "SECURITY_CASE_VIEW_TIMELINE", IconProp.Timeline],
      ],
      [
        ["Detections", "SECURITY_CASE_VIEW_DETECTIONS", IconProp.Bolt],
        ["Entities", "SECURITY_CASE_VIEW_ENTITIES", IconProp.Fingerprint],
        [
          "Connected Signals",
          "SECURITY_CASE_VIEW_CONNECTED_SIGNALS",
          IconProp.Link,
        ],
        ["Playbooks", "SECURITY_CASE_VIEW_PLAYBOOK_RUNS", IconProp.Play],
      ],
      [["Private Notes", "SECURITY_CASE_VIEW_NOTES", IconProp.Lock]],
      [
        ["Audit Logs", "SECURITY_CASE_VIEW_AUDIT_LOGS", IconProp.List],
        ["Delete Case", "SECURITY_CASE_VIEW_DELETE", IconProp.Trash],
      ],
    ]);
  });

  test("opens on the case's Overview, the first entry", () => {
    expect(getSecurityCasePages()[0]).toBe(PageMap.SECURITY_CASE_VIEW);
  });

  /*
   * A case's page that lists what a Security Events page lists, for the case
   * alone, draws that page's icon: its Entities, and its Playbooks - the
   * runs on the case, as Playbook Runs lists every run.
   */
  test("draws a page the Security Events menu has with that menu's icon", () => {
    const productItems: Array<SecurityEventsMenuItem> =
      SECURITY_EVENTS_MENU.flatMap(
        (section: SecurityEventsMenuSection): Array<SecurityEventsMenuItem> => {
          return section.items;
        },
      );

    for (const [caseTitle, productTitle] of [
      ["Entities", "Entities"],
      ["Playbooks", "Playbook Runs"],
    ]) {
      const productItem: SecurityEventsMenuItem | undefined = productItems.find(
        (item: SecurityEventsMenuItem): boolean => {
          return item.title === productTitle;
        },
      );
      const caseItem: SecurityCaseMenuItem | undefined =
        SECURITY_CASE_MENU.flatMap(
          (section: SecurityCaseMenuSection): Array<SecurityCaseMenuItem> => {
            return section.items;
          },
        ).find((item: SecurityCaseMenuItem): boolean => {
          return item.title === caseTitle;
        });

      expect({ caseTitle, icon: caseItem?.icon }).toEqual({
        caseTitle,
        icon: productItem?.icon,
      });
      expect(productItem?.icon).toBeDefined();
    }
  });

  test("counts one thing beside an entry: the case's runs waiting for an approval, beside Playbooks", () => {
    const counted: Array<[string, string | undefined]> =
      SECURITY_CASE_MENU.flatMap(
        (section: SecurityCaseMenuSection): Array<SecurityCaseMenuItem> => {
          return section.items;
        },
      )
        .filter((item: SecurityCaseMenuItem): boolean => {
          return Boolean(item.badge);
        })
        .map((item: SecurityCaseMenuItem): [string, string | undefined] => {
          return [item.title, item.badge];
        });

    expect(counted).toEqual([["Playbooks", "runsWaitingForApproval"]]);
  });

  test("draws one entry as a deletion: Delete Case, last, under Advanced", () => {
    const destructive: Array<string> = SECURITY_CASE_MENU.flatMap(
      (section: SecurityCaseMenuSection): Array<SecurityCaseMenuItem> => {
        return section.items;
      },
    )
      .filter((item: SecurityCaseMenuItem): boolean => {
        return Boolean(item.isDestructive);
      })
      .map((item: SecurityCaseMenuItem): string => {
        return item.title;
      });

    expect(destructive).toEqual(["Delete Case"]);

    const advanced: SecurityCaseMenuSection =
      SECURITY_CASE_MENU[SECURITY_CASE_MENU.length - 1]!;

    expect(advanced.title).toBe("Advanced");
    expect(advanced.items[advanced.items.length - 1]!.title).toBe(
      "Delete Case",
    );
  });

  test("names every page once", () => {
    const titles: Array<string> = SECURITY_CASE_MENU.flatMap(
      (section: SecurityCaseMenuSection): Array<string> => {
        return section.items.map((item: SecurityCaseMenuItem): string => {
          return item.title;
        });
      },
    );

    expect(new Set(titles).size).toBe(titles.length);
  });
});

describe("a case's pages and their addresses", () => {
  test("every page of a case has an entry, and every entry is a page of a case", () => {
    const casePageKeys: Array<string> = Object.values(PageMap).filter(
      (key: string): boolean => {
        return (
          key === "SECURITY_CASE_VIEW" || key.startsWith("SECURITY_CASE_VIEW_")
        );
      },
    );

    expect([...getSecurityCasePages()].sort()).toEqual(casePageKeys.sort());
    expect(new Set(getSecurityCasePages()).size).toBe(
      getSecurityCasePages().length,
    );
  });

  test("the case's address stays its Overview, and each other page is one level under it", () => {
    expect(SecurityEventsRoutePath["SECURITY_CASE_VIEW"]).toBe("cases/:id");
    expect(
      getSecurityCasePages()
        .slice(1)
        .map((page: PageMap): string => {
          return SecurityEventsRoutePath[page] || "";
        }),
    ).toEqual([
      "cases/:id/timeline",
      "cases/:id/detections",
      "cases/:id/entities",
      "cases/:id/connected-signals",
      "cases/:id/playbook-runs",
      "cases/:id/notes",
      "cases/:id/audit-logs",
      "cases/:id/delete",
    ]);
  });

  test("each page's address is the case's, with its own word after it", () => {
    for (const page of getSecurityCasePages().slice(1)) {
      const address: string = routeFor(page);

      expect(
        address.startsWith(`${routeFor(PageMap.SECURITY_CASE_VIEW)}/`),
      ).toBe(true);
      expect(address.split("/").length).toBe(
        routeFor(PageMap.SECURITY_CASE_VIEW).split("/").length + 1,
      );
    }

    expect(routeFor(PageMap.SECURITY_CASE_VIEW_DETECTIONS)).toBe(
      `/dashboard/${PROJECT_ID}/security-events/cases/${CASE_ID}/detections`,
    );
  });

  test("no page's word is ever a case id, nor one of the case queue's pages", () => {
    const queueWords: Array<string> = SECURITY_CASE_QUEUE_VIEWS.map(
      (view: { page: PageMap }): string => {
        return (
          (SecurityEventsRoutePath[view.page] || "").split("/").pop() || ""
        );
      },
    );

    for (const page of getSecurityCasePages().slice(1)) {
      const word: string =
        (SecurityEventsRoutePath[page] || "").split("/").pop() || "";

      expect(word).not.toMatch(UUID_START);
      expect(queueWords).not.toContain(word);
    }
  });

  test("a case's pages open on their own, outside the product's menu, with the playbook's page", () => {
    expect([...SECURITY_EVENTS_DETAIL_PAGES].sort()).toEqual(
      [...getSecurityCasePages(), PageMap.SECURITY_PLAYBOOK_VIEW].sort(),
    );
  });

  test("tells a case's page from any other", () => {
    for (const page of getSecurityCasePages()) {
      expect(isSecurityCasePage(page)).toBe(true);
    }

    expect(isSecurityCasePage(PageMap.SECURITY_CASES)).toBe(false);
    expect(isSecurityCasePage(PageMap.SECURITY_CASES_CLOSED)).toBe(false);
    expect(isSecurityCasePage(PageMap.SECURITY_PLAYBOOK_VIEW)).toBe(false);
    expect(isSecurityCasePage(PageMap.INCIDENT_VIEW)).toBe(false);
    expect(isSecurityCasePage(undefined)).toBe(false);
  });
});

describe("where each page of a case says it is", () => {
  test("the case, then the page as the menu names it; the Overview is the case itself", () => {
    expect(SECURITY_CASE_CRUMB).toBe("View Case");
    expect(
      getSecurityCasePages().map((page: PageMap): Array<string> | undefined => {
        return getSecurityCasePageTrail(page);
      }),
    ).toEqual([
      ["View Case"],
      ["View Case", "Timeline"],
      ["View Case", "Detections"],
      ["View Case", "Entities"],
      ["View Case", "Connected Signals"],
      ["View Case", "Playbooks"],
      ["View Case", "Private Notes"],
      ["View Case", "Audit Logs"],
      ["View Case", "Delete Case"],
    ]);
  });

  test("has no trail and no entry for a page that is not a case's", () => {
    expect(getSecurityCasePageTrail(PageMap.SECURITY_CASES)).toBeUndefined();
    expect(getSecurityCaseMenuItemFor(PageMap.SECURITY_CASES)).toBeUndefined();
    expect(getSecurityCaseMenuItemFor(undefined)).toBeUndefined();
    expect(getSecurityCaseMenuItemFor(PageMap.SECURITY_CASE_VIEW)?.title).toBe(
      "Overview",
    );
  });
});
