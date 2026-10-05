import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup } from "@testing-library/react";
import * as React from "react";
import { ReactElement } from "react";

/*
 * A page's section is stated twice: once by the side menu, which highlights
 * it, and once by the breadcrumb trail above the page body. Moving a page
 * between sections changes the first; nothing forces the second to follow.
 * The failure is quiet and permanent — the menu highlights "Rules" while the
 * header still reads "Incidents / Settings / SLA Rules", and only a user
 * notices.
 *
 * The latest move gave Incidents and Alerts an AI section again, holding
 * the AI settings page (as "Settings") and the auto-remediation rules, which
 * left Settings and Rules for it.
 *
 * So rather than pinning the trails on their own, this derives the sections
 * from each rendered menu and requires the trails to agree. Adding a page to
 * Rules or AI without a matching breadcrumb fails here, for whichever of the
 * three products it was added to.
 *
 * Settings is checked more loosely — only that the trail still says
 * "Settings". Those trails predate this change and word some leaf titles
 * differently from the menu ("Event State" in the menu, "State" in the trail);
 * rewording them is not what this change is about.
 */
/*
 * ModelAPI.count backs the badge entries. Stubbed inline rather than through
 * the shared harness because jest.mock is hoisted above the imports — a helper
 * imported from another module is not initialised yet when it runs.
 */
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      count: () => {
        return Promise.resolve(0);
      },
    },
  };
});

import AlertsSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Alerts/SideMenu";
import IncidentsSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/SideMenu";
import ScheduledMaintenanceSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/ScheduledMaintenanceEvents/SideMenu";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import { getAlertsBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/AlertBreadcrumbs";
import { getIncidentsBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/IncidentBreadcrumbs";
import { getScheduleMaintenanceBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/ScheduledMaintenanceBreadcrumbs";
import Route from "../../../Types/API/Route";
import Link from "../../../Types/Link";
import {
  DESKTOP_WIDTH,
  PROJECT_ID,
  goTo,
  linksIn,
  renderMenu,
  sectionTitlesInOrder,
  setViewportWidth,
} from "./SideMenuHarness";

type BreadcrumbGetter = (path: string) => Array<Link> | undefined;

interface Product {
  name: string;
  productCrumb: string;
  menu: ReactElement;
  getBreadcrumbs: BreadcrumbGetter;
  landingRoute: string;
  // The pages of the product's AI section, with their menu titles, in order.
  aiPages: Array<[string, string]>;
  rulePages: Array<[string, string]>;
}

const PRODUCTS: Array<Product> = [
  {
    name: "Alerts",
    productCrumb: "Alerts",
    menu: <AlertsSideMenu />,
    getBreadcrumbs: getAlertsBreadcrumbs,
    landingRoute: PageMap.ALERTS,
    aiPages: [
      [PageMap.ALERTS_AI_INSIGHTS, "Insights"],
      [PageMap.ALERTS_AI_LOGS, "Logs"],
      [PageMap.ALERTS_SETTINGS_AI, "Settings"],
      [
        PageMap.ALERTS_SETTINGS_AUTO_REMEDIATION_RULES,
        "Auto Remediation Rules",
      ],
    ],
    rulePages: [
      [PageMap.ALERTS_SETTINGS_GROUPING_RULES, "Grouping Rules"],
      [PageMap.ALERTS_SETTINGS_ON_CALL_RULES, "On-Call Rules"],
      [PageMap.ALERTS_SETTINGS_OWNER_RULES, "Owner Rules"],
      [PageMap.ALERTS_SETTINGS_RUNBOOK_RULES, "Runbook Rules"],
      [PageMap.ALERTS_SETTINGS_PRIVACY_RULES, "Privacy Rules"],
      [PageMap.ALERTS_SETTINGS_LABEL_RULES, "Label Rules"],
      [PageMap.ALERTS_SETTINGS_REMINDER_RULES, "Reminder Rules"],
    ],
  },
  {
    name: "Incidents",
    productCrumb: "Incidents",
    menu: <IncidentsSideMenu />,
    getBreadcrumbs: getIncidentsBreadcrumbs,
    landingRoute: PageMap.INCIDENTS,
    aiPages: [
      [PageMap.INCIDENTS_AI_INSIGHTS, "Insights"],
      [PageMap.INCIDENTS_AI_LOGS, "Logs"],
      [PageMap.INCIDENTS_SETTINGS_AI, "Settings"],
      [
        PageMap.INCIDENTS_SETTINGS_AUTO_REMEDIATION_RULES,
        "Auto Remediation Rules",
      ],
    ],
    rulePages: [
      [PageMap.INCIDENTS_SETTINGS_GROUPING_RULES, "Grouping Rules"],
      [PageMap.INCIDENTS_SETTINGS_ON_CALL_RULES, "On-Call Rules"],
      [PageMap.INCIDENTS_SETTINGS_OWNER_RULES, "Owner Rules"],
      [PageMap.INCIDENTS_SETTINGS_RUNBOOK_RULES, "Runbook Rules"],
      [PageMap.INCIDENTS_SETTINGS_PRIVACY_RULES, "Privacy Rules"],
      [PageMap.INCIDENTS_SETTINGS_LABEL_RULES, "Label Rules"],
      [PageMap.INCIDENTS_SETTINGS_SLA_RULES, "SLA Rules"],
      [PageMap.INCIDENTS_SETTINGS_REMINDER_RULES, "Reminder Rules"],
    ],
  },
  {
    name: "Scheduled maintenance",
    productCrumb: "Scheduled Maintenance",
    menu: <ScheduledMaintenanceSideMenu />,
    getBreadcrumbs: getScheduleMaintenanceBreadcrumbs,
    landingRoute: PageMap.SCHEDULED_MAINTENANCE_EVENTS,
    aiPages: [],
    rulePages: [
      [
        PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_OWNER_RULES,
        "Owner Rules",
      ],
      [
        PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_RUNBOOK_RULES,
        "Runbook Rules",
      ],
      [
        PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_LABEL_RULES,
        "Label Rules",
      ],
      [
        PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_REMINDER_RULES,
        "Reminder Rules",
      ],
    ],
  },
];

function populatedRoute(pageMapKey: string): string {
  return RouteUtil.populateRouteParams(
    RouteMap[pageMapKey] as Route,
  ).toString();
}

function trailTitlesFor(
  product: Product,
  pageMapKey: string,
): Array<string> | undefined {
  /*
   * Trails resolve their links against the live location, so stand on the page
   * being asked about — the same context the app builds them in.
   */
  goTo(populatedRoute(pageMapKey));

  return product
    .getBreadcrumbs(RouteUtil.getRouteString(pageMapKey))
    ?.map((link: Link): string => {
      return link.title;
    });
}

/*
 * Populated href -> PageMap key, so a link scraped out of the menu can be
 * turned back into the key the breadcrumb map is indexed by. Built per call
 * rather than once at module load: populating a route reads the project id out
 * of the current URL, which is not set until the test starts.
 */
function buildRouteIndex(): Map<string, string> {
  const index: Map<string, string> = new Map();

  Object.keys(RouteMap).forEach((pageMapKey: string) => {
    index.set(populatedRoute(pageMapKey), pageMapKey);
  });

  return index;
}

interface MenuEntry {
  section: string;
  title: string;
  pageMapKey: string;
}

async function renderMenuEntries(product: Product): Promise<Array<MenuEntry>> {
  await renderMenu(product.menu);

  const routeIndex: Map<string, string> = buildRouteIndex();

  return sectionTitlesInOrder().flatMap((section: string): Array<MenuEntry> => {
    return linksIn(section).map((link: { title: string; href: string }) => {
      const pageMapKey: string | undefined = routeIndex.get(link.href);

      if (!pageMapKey) {
        throw new Error(
          `Side-menu link "${link.title}" points at ${link.href}, which is not in RouteMap.`,
        );
      }

      return { section, title: link.title, pageMapKey };
    });
  });
}

describe.each(
  PRODUCTS.map((product: Product): [string, Product] => {
    return [product.name, product];
  }),
)(
  "%s breadcrumbs follow the side menu sections",
  (_name: string, product: Product) => {
    beforeEach(() => {
      setViewportWidth(DESKTOP_WIDTH);
      /*
       * Seed a real project id in the URL first: populateRouteParams reads it
       * back out of window.location, so starting from a route that still says
       * ":projectId" would leave every href stuck on the placeholder.
       */
      goTo(`/dashboard/${PROJECT_ID}`);
      goTo(populatedRoute(product.landingRoute));
    });

    afterEach(() => {
      cleanup();
    });

    test("every page of the AI section is filed under AI, by its menu title", () => {
      product.aiPages.forEach(([pageMapKey, title]: [string, string]) => {
        expect(trailTitlesFor(product, pageMapKey)).toEqual([
          "Project",
          product.productCrumb,
          "AI",
          title,
        ]);
      });
    });

    test("the menu has an AI section exactly when the product has AI pages", async () => {
      await renderMenu(product.menu);

      expect(sectionTitlesInOrder().includes("AI")).toBe(
        product.aiPages.length > 0,
      );
    });

    test("every rule page is named Rules, not Settings", () => {
      expect(product.rulePages.length).toBeGreaterThan(0);

      product.rulePages.forEach(([pageMapKey, title]: [string, string]) => {
        expect(trailTitlesFor(product, pageMapKey)).toEqual([
          "Project",
          product.productCrumb,
          "Rules",
          title,
        ]);
      });
    });

    test("no trail files a rule or AI page under Settings, or uses the AI section's old page names", () => {
      [...product.rulePages, ...product.aiPages].forEach(
        ([pageMapKey]: [string, string]) => {
          const trail: Array<string> | undefined = trailTitlesFor(
            product,
            pageMapKey,
          );

          // "Settings" may only be the AI settings page's own title.
          expect(trail?.slice(0, 3)).not.toContain("Settings");
          expect(trail).not.toContain("Investigation");
          expect(trail).not.toContain("Remediation");
        },
      );

      // No rule page sits in the AI section, nor an AI page in Rules.
      product.rulePages.forEach(([pageMapKey]: [string, string]) => {
        expect(trailTitlesFor(product, pageMapKey)?.[2]).toBe("Rules");
      });
    });

    /*
     * The cross-check. Everything above pins one side; this one requires the two
     * sides to say the same thing, so a page added to AI or Rules later cannot
     * quietly keep a Settings trail (or no trail at all).
     */
    test("every Rules and AI entry has a trail naming its menu section and title", async () => {
      const entries: Array<MenuEntry> = await renderMenuEntries(product);

      const moved: Array<MenuEntry> = entries.filter(
        (entry: MenuEntry): boolean => {
          return entry.section === "Rules" || entry.section === "AI";
        },
      );

      // Guard against a vacuous pass if the menu stops rendering these entries.
      expect(moved.length).toBe(
        product.rulePages.length + product.aiPages.length,
      );
      expect(
        moved
          .filter((entry: MenuEntry): boolean => {
            return entry.section === "AI";
          })
          .map((entry: MenuEntry): [string, string] => {
            return [entry.pageMapKey, entry.title];
          }),
      ).toEqual(product.aiPages);

      moved.forEach((entry: MenuEntry) => {
        expect(trailTitlesFor(product, entry.pageMapKey)).toEqual([
          "Project",
          product.productCrumb,
          entry.section,
          entry.title,
        ]);
      });
    });

    test("every Settings entry has a Settings trail", async () => {
      const entries: Array<MenuEntry> = await renderMenuEntries(product);

      const settingsEntries: Array<MenuEntry> = entries.filter(
        (entry: MenuEntry): boolean => {
          return entry.section === "Settings";
        },
      );

      expect(settingsEntries.length).toBeGreaterThan(0);

      settingsEntries.forEach((entry: MenuEntry) => {
        const titles: Array<string> | undefined = trailTitlesFor(
          product,
          entry.pageMapKey,
        );

        expect(titles).toBeDefined();
        expect(titles?.slice(0, 3)).toEqual([
          "Project",
          product.productCrumb,
          "Settings",
        ]);
      });
    });

    test("every crumb resolves to a concrete route with no unfilled params", () => {
      const firstRulePage: string | undefined = product.rulePages[0]?.[0];

      expect(firstRulePage).toBeDefined();

      goTo(populatedRoute(firstRulePage!));

      const trail: Array<Link> | undefined = product.getBreadcrumbs(
        RouteUtil.getRouteString(firstRulePage!),
      );

      expect(trail).toBeDefined();

      trail?.forEach((link: Link) => {
        expect(link.to.toString()).not.toContain(":");
        expect(link.to.toString().startsWith("/dashboard/")).toBe(true);
      });
    });
  },
);

describe("breadcrumb sections across products", () => {
  afterEach(() => {
    cleanup();
  });

  /*
   * Scheduled maintenance has no AI page, so it must not gain an AI trail
   * either — an entry with nothing behind it in the menu would be matched by
   * a trail pointing nowhere.
   */
  test("scheduled maintenance declares no AI page", () => {
    const scheduledMaintenance: Product = PRODUCTS[2]!;

    expect(scheduledMaintenance.name).toBe("Scheduled maintenance");
    expect(scheduledMaintenance.aiPages).toEqual([]);
  });

  test("incidents and alerts each file their own AI pages under AI", () => {
    expect(
      PRODUCTS.map((product: Product): Array<string> => {
        return product.aiPages.map(([pageMapKey]: [string, string]) => {
          return pageMapKey;
        });
      }),
    ).toEqual([
      [
        PageMap.ALERTS_AI_INSIGHTS,
        PageMap.ALERTS_AI_LOGS,
        PageMap.ALERTS_SETTINGS_AI,
        PageMap.ALERTS_SETTINGS_AUTO_REMEDIATION_RULES,
      ],
      [
        PageMap.INCIDENTS_AI_INSIGHTS,
        PageMap.INCIDENTS_AI_LOGS,
        PageMap.INCIDENTS_SETTINGS_AI,
        PageMap.INCIDENTS_SETTINGS_AUTO_REMEDIATION_RULES,
      ],
      [],
    ]);
  });

  test("the products under test cover the three that were reorganised", () => {
    expect(
      PRODUCTS.map((product: Product): string => {
        return product.productCrumb;
      }),
    ).toEqual(["Alerts", "Incidents", "Scheduled Maintenance"]);
  });
});
