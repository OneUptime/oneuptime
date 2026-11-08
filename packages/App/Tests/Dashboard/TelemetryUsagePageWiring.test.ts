import {
  SettingsMenu,
  SettingsMenuSection,
  projectSettingsMenu,
} from "./SettingsMenuPaths";
import PageMap from "../../FeatureSet/Dashboard/src/Utils/PageMap";
import RouteParams from "../../FeatureSet/Dashboard/src/Utils/RouteParams";
import { TELEMETRY_BILLING_EXCLUDED_ENTITY_TYPES } from "Common/Server/Services/TelemetryUsageBillingService";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import { TELEMETRY_USAGE_RESOURCE_NAME_SOURCES } from "Common/Server/Utils/TelemetryUsage/TelemetryUsageResourceNames";
import Route from "Common/Types/API/Route";
import { beforeAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * PROJECT SETTINGS > TELEMETRY & APM > USAGE (issue #5916).
 *
 * Usage was Billing and Invoices > Usage History: the one place a project's
 * telemetry usage was shown, and only where billing was on. It is counted
 * on every install now, so the page moved next to the project's other
 * telemetry settings - the same page at the same address, so every link to
 * it still works - and shows what usage cost only where billing is on.
 */

const DASHBOARD_SRC: string = path.resolve(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const read: (...parts: Array<string>) => string = (
  ...parts: Array<string>
): string => {
  return fs.readFileSync(path.join(DASHBOARD_SRC, ...parts), "utf8");
};

const MENU: SettingsMenu = projectSettingsMenu();

type RouteMapModule =
  typeof import("../../FeatureSet/Dashboard/src/Utils/RouteMap");
type UsageModule =
  typeof import("../../FeatureSet/Dashboard/src/Components/TelemetryUsage/ProjectTelemetryUsage");

let RouteMap: RouteMapModule["default"];
let TELEMETRY_USAGE_RESOURCE_PAGES: UsageModule["TELEMETRY_USAGE_RESOURCE_PAGES"];
let getTelemetryUsageResourceRoute: UsageModule["getTelemetryUsageResourceRoute"];

/*
 * The Dashboard's modules read the browser's window and storage as they
 * load, so they are imported once those are stubbed (as in
 * SessionReplayRoutes.test.ts).
 */
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

  RouteMap = (await import("../../FeatureSet/Dashboard/src/Utils/RouteMap"))
    .default;

  const usage: UsageModule = await import(
    "../../FeatureSet/Dashboard/src/Components/TelemetryUsage/ProjectTelemetryUsage"
  );

  TELEMETRY_USAGE_RESOURCE_PAGES = usage.TELEMETRY_USAGE_RESOURCE_PAGES;
  getTelemetryUsageResourceRoute = usage.getTelemetryUsageResourceRoute;
});

const sectionOf: (title: string) => SettingsMenuSection | undefined = (
  title: string,
): SettingsMenuSection | undefined => {
  return MENU.sections.find((section: SettingsMenuSection): boolean => {
    return section.title === title;
  });
};

describe("where the Usage page is", () => {
  test("Telemetry & APM, last, after the project's other telemetry settings", () => {
    expect(sectionOf("Telemetry & APM")?.items).toEqual([
      "Ingestion Keys",
      "Data Retention",
      "Usage",
    ]);
  });

  test("on every install: Billing and Invoices, shown only with billing, no longer holds it", () => {
    expect(sectionOf("Billing and Invoices")?.items).toEqual([
      "Billing",
      "Invoices",
    ]);

    const sideMenu: string = read("Pages", "Settings", "SideMenu.tsx");
    const billingStart: number = sideMenu.indexOf("if (BILLING_ENABLED) {");

    expect(billingStart).toBeGreaterThan(0);
    expect(sideMenu.slice(billingStart)).not.toContain(
      "PageMap.SETTINGS_USAGE_HISTORY",
    );
    expect(sideMenu.slice(0, billingStart)).toContain(
      "RouteMap[PageMap.SETTINGS_USAGE_HISTORY] as Route",
    );
  });

  test("at the address Usage History always had, so its links keep working", () => {
    expect((RouteMap[PageMap.SETTINGS_USAGE_HISTORY] as Route).toString()).toBe(
      "/dashboard/:projectId/settings/usage-history",
    );
  });

  test("found by search on every install, by its old name too", () => {
    const index: string = read(
      "Components",
      "CommandPalette",
      "PageSearchIndex.ts",
    );
    const entry: string = index.slice(
      index.indexOf("page: PageMap.SETTINGS_USAGE_HISTORY"),
      index.indexOf(
        "},",
        index.indexOf("page: PageMap.SETTINGS_USAGE_HISTORY"),
      ),
    );

    expect(entry).toContain('title: "Usage"');
    expect(entry).toContain('"usage history"');
    expect(entry).toContain('"telemetry usage"');
    expect(entry).not.toContain("gate:");

    // Under Telemetry & APM, not under the billing-gated section.
    const telemetry: number = index.indexOf('title: "Telemetry & APM"');
    const billing: number = index.indexOf('title: "Billing and Invoices"');

    expect(
      index.indexOf("page: PageMap.SETTINGS_USAGE_HISTORY"),
    ).toBeGreaterThan(telemetry);
    expect(index.indexOf("page: PageMap.SETTINGS_USAGE_HISTORY")).toBeLessThan(
      billing,
    );
  });

  test("its trail is Project > Settings > Usage", () => {
    const breadcrumbs: string = read(
      "Utils",
      "Breadcrumbs",
      "SettingsBreadcrumbs.ts",
    ).replace(/\s+/g, " ");

    expect(breadcrumbs).toContain(
      'BuildBreadcrumbLinksByTitles(PageMap.SETTINGS_USAGE_HISTORY, [ "Project", "Settings", "Usage", ])',
    );
  });
});

describe("what the page draws", () => {
  const page: string = read("Pages", "Settings", "UsageHistory.tsx");

  test("the overview first - each day by signal, each resource - read from the project's usage", () => {
    expect(page).toContain("<TelemetryUsageOverview");
    expect(page).toContain("fetchUsage={fetchProjectTelemetryUsage}");
    expect(page).toContain("getResourceRoute={getTelemetryUsageResourceRoute}");
    expect(page.indexOf("<TelemetryUsageOverview")).toBeLessThan(
      page.indexOf("<ModelTable<TelemetryUsageBilling>"),
    );
  });

  test("then the daily rows, whose Total Cost column is drawn only where billing is on", () => {
    const columns: string = page.slice(page.indexOf("columns={["));
    const costColumn: number = columns.indexOf('title: "Total Cost",');

    expect(costColumn).toBeGreaterThan(0);
    expect(
      columns.slice(columns.lastIndexOf("...(BILLING_ENABLED", costColumn)),
    ).toContain('title: "Total Cost",');
    expect(
      columns.lastIndexOf("...(BILLING_ENABLED", costColumn),
    ).toBeGreaterThan(0);
  });

  test("and says what the rows cost only where billing is on", () => {
    const cardProps: string = page.slice(
      page.indexOf("cardProps={{"),
      page.indexOf("noItemsMessage"),
    );

    expect(cardProps).toContain("description: BILLING_ENABLED");
    expect(cardProps).toContain(
      '"How much telemetry each service sent each day, and how long it is kept."',
    );
  });
});

describe("a resource's page", () => {
  test("is known for every kind of resource usage is counted for, and only those", () => {
    for (const type of Object.values(ServiceType) as Array<ServiceType>) {
      const isCounted: boolean =
        !TELEMETRY_BILLING_EXCLUDED_ENTITY_TYPES.includes(type) &&
        type !== ServiceType.Unknown;

      expect({
        type,
        hasPage: Boolean(TELEMETRY_USAGE_RESOURCE_PAGES[type]),
      }).toEqual({ type, hasPage: isCounted });

      // The server names the same kinds the page links.
      expect({
        type,
        isNamed: Boolean(TELEMETRY_USAGE_RESOURCE_NAME_SOURCES[type]),
      }).toEqual({ type, isNamed: isCounted });
    }
  });

  test("is a page the Dashboard has, opened on the resource itself", () => {
    for (const page of Object.values(TELEMETRY_USAGE_RESOURCE_PAGES)) {
      const route: Route | undefined = RouteMap[page as PageMap];

      expect({ page, route: route?.toString() }).toEqual({
        page,
        route: expect.stringContaining(`/${RouteParams.ModelID}`),
      });
    }
  });

  test("is linked only for a resource the reader may see: one the server named", () => {
    expect(
      getTelemetryUsageResourceRoute({
        primaryEntityId: "22222222-2222-4222-8222-222222222222",
        primaryEntityType: ServiceType.Host,
        name: null,
        byProduct: {},
        total: { dataIngestedInGB: 1 },
        retentionInDays: 15,
        sessionReplayRetentionInDays: null,
      }),
    ).toBeUndefined();

    const route: Route | undefined = getTelemetryUsageResourceRoute({
      primaryEntityId: "22222222-2222-4222-8222-222222222222",
      primaryEntityType: ServiceType.Host,
      name: "web-01",
      byProduct: {},
      total: { dataIngestedInGB: 1 },
      retentionInDays: 15,
      sessionReplayRetentionInDays: null,
    });

    expect(route?.toString()).toContain(
      "/host/22222222-2222-4222-8222-222222222222",
    );
  });

  test("of a legacy row of no type is a Service's", () => {
    const route: Route | undefined = getTelemetryUsageResourceRoute({
      primaryEntityId: "22222222-2222-4222-8222-222222222222",
      primaryEntityType: null,
      name: "checkout",
      byProduct: {},
      total: { dataIngestedInGB: 1 },
      retentionInDays: 15,
      sessionReplayRetentionInDays: null,
    });

    expect(route?.toString()).toBe(
      (RouteMap[PageMap.SERVICE_VIEW] as Route)
        .toString()
        .replace(RouteParams.ModelID, "22222222-2222-4222-8222-222222222222"),
    );
  });
});
