import {
  buildPageSearchCommandDescriptors,
  PageSearchAvailability,
  PageSearchCommandDescriptor,
} from "../../FeatureSet/Dashboard/src/Components/CommandPalette/DashboardCommandPaletteHelpers";
import { getPageSearchAreas } from "../../FeatureSet/Dashboard/src/Components/CommandPalette/PageSearchIndex";
import RouteMap from "../../FeatureSet/Dashboard/src/Utils/RouteMap";
import PageMap from "../../FeatureSet/Dashboard/src/Utils/PageMap";
import { isDashboardRouteTemplate } from "../../FeatureSet/Dashboard/src/Components/AIChat/AskAiPageLinks";
import Route from "Common/Types/API/Route";
import DashboardPageFinder, {
  AI_DASHBOARD_PAGES,
  AIDashboardPage,
  AIDashboardPageKind,
} from "Common/Server/Utils/AI/Docs/DashboardPageFinder";
import { describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * ASK AI'S LIST OF THE DASHBOARD'S PAGES IS SEARCH'S OWN (issue #6828).
 *
 * find_dashboard_page reads Common's DashboardPages.json, which the server
 * can read without the Dashboard's code. It is generated here from the page
 * index Search reads (PageSearchIndex.ts, held to the menus and RouteMap by
 * their own suites), so a page Search offers is a page Ask AI can send
 * someone to, under the same name, and nothing else. Run this suite with
 * UPDATE_AI_DASHBOARD_PAGES=1 to write the file again after the index
 * changes.
 */

/*
 * RouteMap fills in the current project from the browser's address
 * (Common/UI/Utils/Project); these read its route templates only.
 */
jest.mock("Common/UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): null => {
        return null;
      },
    },
  };
});

const CATALOG_PATH: string = path.resolve(
  __dirname,
  "../../../Common/Server/Utils/AI/Docs/DashboardPages.json",
);

const PROJECT_PLACEHOLDER: string = "__project__";

const getTemplate: (key: string) => string | undefined = (
  key: string,
): string | undefined => {
  const route: Route | undefined = RouteMap[key];
  return route ? route.toString() : undefined;
};

const describeIndex: (
  availability: PageSearchAvailability,
) => Array<PageSearchCommandDescriptor> = (
  availability: PageSearchAvailability,
): Array<PageSearchCommandDescriptor> => {
  return buildPageSearchCommandDescriptors({
    areas: getPageSearchAreas(),
    availability,
    getRouteTemplate: getTemplate,
    getRoutePath: (key: string): string | undefined => {
      return getTemplate(key)?.replace(":projectId", PROJECT_PLACEHOLDER);
    },
    getProductTitle: (): string | undefined => {
      return undefined;
    },
    translate: (text: string): string => {
      return text;
    },
    catalog: [],
  });
};

// What the catalog should hold: every page Search offers everyone, and the billing pages marked.
const deriveCatalog: () => Array<AIDashboardPage> =
  (): Array<AIDashboardPage> => {
    const everyone: Array<PageSearchCommandDescriptor> = describeIndex({
      isBillingEnabled: false,
      isMonitorGroupsEnabled: false,
      canDeleteProject: false,
    });
    const withBilling: Array<PageSearchCommandDescriptor> = describeIndex({
      isBillingEnabled: true,
      isMonitorGroupsEnabled: false,
      canDeleteProject: false,
    });
    const offeredToEveryone: Set<string> = new Set<string>(
      everyone.map((descriptor: PageSearchCommandDescriptor): string => {
        return descriptor.id;
      }),
    );

    return withBilling.map(
      (descriptor: PageSearchCommandDescriptor): AIDashboardPage => {
        return {
          title: descriptor.title,
          where: descriptor.breadcrumb,
          ...(descriptor.keywords.length > 0
            ? { keywords: descriptor.keywords }
            : {}),
          path: descriptor.routePath.replace(PROJECT_PLACEHOLDER, ":projectId"),
          kind: descriptor.isAction
            ? AIDashboardPageKind.Action
            : descriptor.isSetting
              ? AIDashboardPageKind.Setting
              : AIDashboardPageKind.Page,
          ...(offeredToEveryone.has(descriptor.id) ? {} : { billing: true }),
        };
      },
    );
  };

/*
 * The pages Search's own actions open to create something (Declare
 * Incident, Create Monitor: DashboardCommandPalette's actions), which the
 * page index leaves to them. The first thing a newcomer asks how to do.
 */
const CREATE_PAGES: Array<{
  title: string;
  where: Array<string>;
  keywords: Array<string>;
  page: PageMap;
}> = [
  {
    title: "Declare Incident",
    where: ["Incidents"],
    keywords: ["create incident", "new incident", "report outage"],
    page: PageMap.INCIDENT_CREATE,
  },
  {
    title: "Create Monitor",
    where: ["Monitors"],
    keywords: ["new monitor", "add monitor", "uptime check", "website check"],
    page: PageMap.MONITOR_CREATE,
  },
  {
    title: "Create Alert",
    where: ["Alerts"],
    keywords: ["new alert", "add alert"],
    page: PageMap.ALERT_CREATE,
  },
  {
    title: "Create Scheduled Maintenance",
    where: ["Scheduled Maintenance"],
    keywords: ["new maintenance", "downtime window", "planned maintenance"],
    page: PageMap.SCHEDULED_MAINTENANCE_EVENT_CREATE,
  },
  {
    title: "Create Announcement",
    where: ["Status Pages"],
    keywords: ["new announcement", "status page announcement", "post update"],
    page: PageMap.ANNOUNCEMENT_CREATE,
  },
];

const DERIVED: Array<AIDashboardPage> = [
  ...CREATE_PAGES.map(
    (createPage: {
      title: string;
      where: Array<string>;
      keywords: Array<string>;
      page: PageMap;
    }): AIDashboardPage => {
      return {
        title: createPage.title,
        where: createPage.where,
        keywords: createPage.keywords,
        path: getTemplate(createPage.page)!,
        kind: AIDashboardPageKind.Action,
      };
    },
  ),
  ...deriveCatalog(),
];

if (process.env["UPDATE_AI_DASHBOARD_PAGES"] === "1") {
  fs.writeFileSync(CATALOG_PATH, `${JSON.stringify(DERIVED, null, 2)}\n`);
}

const routeOf: (page: AIDashboardPage) => string = (
  page: AIDashboardPage,
): string => {
  return page.path.split(/[?#]/)[0]!;
};

describe("Ask AI's catalog of the Dashboard's pages", () => {
  test("is the page index Search reads, as generated from it (run with UPDATE_AI_DASHBOARD_PAGES=1 to write it again)", () => {
    expect(AI_DASHBOARD_PAGES.length).toBeGreaterThan(300);
    expect(JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8"))).toEqual(DERIVED);
  });

  test("every page in it opens one of the Dashboard's own routes, in the project, and nothing a route still waits a value for", () => {
    const templates: Set<string> = new Set<string>(
      Object.values(RouteMap).map((route: Route): string => {
        return route.toString();
      }),
    );

    for (const page of AI_DASHBOARD_PAGES) {
      expect(templates.has(routeOf(page))).toBe(true);
      expect(isDashboardRouteTemplate(page.path)).toBe(true);
      expect(routeOf(page).replace(":projectId", "")).not.toContain(":");
    }
  });

  test("marks the pages only OneUptime Cloud's billing shows, and offers them nowhere else", () => {
    const billing: Array<AIDashboardPage> = AI_DASHBOARD_PAGES.filter(
      (page: AIDashboardPage): boolean => {
        return Boolean(page.billing);
      },
    );

    expect(billing.length).toBeGreaterThan(0);

    for (const page of billing) {
      const found: Array<AIDashboardPage> = DashboardPageFinder.find({
        query: `${page.where.join(" ")} ${page.title}`,
        limit: 50,
        isBillingEnabled: false,
      });
      expect(found).not.toContain(page);
    }
  });

  test("leaves out what only some may do, and pages behind a project's flag", () => {
    const titles: Array<string> = AI_DASHBOARD_PAGES.map(
      (page: AIDashboardPage): string => {
        return page.title;
      },
    );

    expect(titles).not.toContain("Delete Project");
    expect(
      AI_DASHBOARD_PAGES.filter((page: AIDashboardPage): boolean => {
        return page.path.includes("monitor-groups");
      }),
    ).toEqual([]);
  });

  test("finds each of the pages a newcomer asks about by the name the menus give it", () => {
    const expectations: Array<{ query: string; path: string }> = [
      {
        query: "Create Monitor",
        path: "/dashboard/:projectId/monitors/create",
      },
      {
        query: "Notification Methods",
        path: "/dashboard/:projectId/user-settings/notification-methods",
      },
      {
        query: "Phone Numbers for SMS Notifications",
        path: "/dashboard/:projectId/user-settings/notification-methods",
      },
      {
        query: "Declare Incident",
        path: "/dashboard/:projectId/incidents/create",
      },
      { query: "API Keys", path: "/dashboard/:projectId/settings/api-keys" },
      {
        query: "On-Call Policies",
        path: "/dashboard/:projectId/on-call-duty/policies",
      },
      { query: "Status Pages", path: "/dashboard/:projectId/status-pages" },
    ];

    for (const expectation of expectations) {
      const found: Array<AIDashboardPage> = DashboardPageFinder.find({
        query: expectation.query,
        limit: 1,
        isBillingEnabled: true,
      });
      expect(found[0]?.path.split("?")[0]).toBe(expectation.path);
    }
  });
});
