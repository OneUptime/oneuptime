import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { getAlertsBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/AlertBreadcrumbs";
import { getIncidentsBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/IncidentBreadcrumbs";
import { getMonitorBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/MonitorBreadcrumbs";
import { getOnCallDutyBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/OnCallDutyBreadcrumbs";
import { getScheduleMaintenanceBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/ScheduledMaintenanceBreadcrumbs";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Route from "../../../Types/API/Route";
import Link from "../../../Types/Link";
import { PROJECT_ID, goTo, routeFor } from "./SideMenuHarness";

/*
 * Each product's Workspace page, the one its menu lists while nothing is
 * connected: a real route under the product, a breadcrumb trail that names
 * it, and mounted inside the product's own layout with that product's Slack
 * and Microsoft Teams pages, so its "Set up notifications" steps stay in
 * the product.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
);

interface Product {
  name: string;
  crumb: string;
  segment: string;
  routesFile: string;
  routePathTable: string;
  connect: string;
  slack: string;
  microsoftTeams: string;
  getBreadcrumbs: (path: string) => Array<Link> | undefined;
}

const PRODUCTS: Array<Product> = [
  {
    name: "Incidents",
    crumb: "Incidents",
    segment: "incidents",
    routesFile: "Routes/IncidentsRoutes.tsx",
    routePathTable: "IncidentsRoutePath",
    connect: "INCIDENTS_WORKSPACE_CONNECTIONS",
    slack: "INCIDENTS_WORKSPACE_CONNECTION_SLACK",
    microsoftTeams: "INCIDENTS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS",
    getBreadcrumbs: getIncidentsBreadcrumbs,
  },
  {
    name: "Alerts",
    crumb: "Alerts",
    segment: "alerts",
    routesFile: "Routes/AlertRoutes.tsx",
    routePathTable: "AlertsRoutePath",
    connect: "ALERTS_WORKSPACE_CONNECTIONS",
    slack: "ALERTS_WORKSPACE_CONNECTION_SLACK",
    microsoftTeams: "ALERTS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS",
    getBreadcrumbs: getAlertsBreadcrumbs,
  },
  {
    name: "Scheduled Maintenance",
    crumb: "Scheduled Maintenance Events",
    segment: "scheduled-maintenance-events",
    routesFile: "Routes/ScheduleMaintenanceEventsRoutes.tsx",
    routePathTable: "ScheduledMaintenanceEventsRoutePath",
    connect: "SCHEDULED_MAINTENANCE_EVENTS_WORKSPACE_CONNECTIONS",
    slack: "SCHEDULED_MAINTENANCE_EVENTS_WORKSPACE_CONNECTION_SLACK",
    microsoftTeams:
      "SCHEDULED_MAINTENANCE_EVENTS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS",
    getBreadcrumbs: getScheduleMaintenanceBreadcrumbs,
  },
  {
    name: "Monitors",
    crumb: "Monitors",
    segment: "monitors",
    routesFile: "Routes/MonitorsRoutes.tsx",
    routePathTable: "MonitorsRoutePath",
    connect: "MONITORS_WORKSPACE_CONNECTIONS",
    slack: "MONITORS_WORKSPACE_CONNECTION_SLACK",
    microsoftTeams: "MONITORS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS",
    getBreadcrumbs: getMonitorBreadcrumbs,
  },
  {
    name: "On-Call",
    crumb: "On-Call Duty",
    segment: "on-call-duty",
    routesFile: "Routes/OnCallDutyRoutes.tsx",
    routePathTable: "OnCallDutyRoutePath",
    connect: "ON_CALL_DUTY_WORKSPACE_CONNECTIONS",
    slack: "ON_CALL_DUTY_WORKSPACE_CONNECTION_SLACK",
    microsoftTeams: "ON_CALL_DUTY_WORKSPACE_CONNECTION_MICROSOFT_TEAMS",
    getBreadcrumbs: getOnCallDutyBreadcrumbs,
  },
];

const CASES: Array<[string, Product]> = PRODUCTS.map(
  (product: Product): [string, Product] => {
    return [product.name, product];
  },
);

function dense(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .replace(/\s+/g, "");
}

describe("each product's Workspace page", () => {
  test.each(CASES)(
    "%s: lives at <product>/workspace-connections",
    (_name: string, product: Product) => {
      expect(Object.values(PageMap)).toContain(product.connect);
      expect((RouteMap[product.connect] as Route).toString()).toBe(
        `/dashboard/:projectId/${product.segment}/workspace-connections`,
      );
    },
  );

  test.each(CASES)(
    "%s: does not collide with its Slack and Microsoft Teams pages",
    (_name: string, product: Product) => {
      const routes: Array<string> = [
        product.connect,
        product.slack,
        product.microsoftTeams,
      ].map((key: string): string => {
        return (RouteMap[key] as Route).toString();
      });

      expect(new Set(routes).size).toBe(3);
    },
  );

  test.each(CASES)(
    "%s: has a breadcrumb trail ending in Workspace, with real links",
    (_name: string, product: Product) => {
      goTo(`/dashboard/${PROJECT_ID}`);
      const page: string = routeFor(product.connect);
      goTo(page);

      const trail: Array<Link> | undefined = product.getBreadcrumbs(
        (RouteMap[product.connect] as Route).toString(),
      );

      expect(
        (trail || []).map((link: Link): string => {
          return link.title;
        }),
      ).toEqual(["Project", product.crumb, "Workspace"]);

      for (const link of trail || []) {
        expect(link.to.toString()).not.toContain(":");
      }
      expect(trail?.[trail.length - 1]?.to.toString()).toBe(page);
    },
  );

  test.each(CASES)(
    "%s: is mounted with the product's own Slack and Microsoft Teams pages",
    (_name: string, product: Product) => {
      const code: string = dense(
        fs.readFileSync(path.join(DASHBOARD_SRC, product.routesFile), "utf8"),
      );

      expect(code).toContain(
        'importWorkspaceConnectionsOverviewfrom"../Components/Workspace/WorkspaceConnectionsOverview";',
      );
      expect(code).toContain(
        `path={${product.routePathTable}[PageMap.${product.connect}]||""}element={<WorkspaceConnectionsOverviewslackPage={PageMap.${product.slack}}microsoftTeamsPage={PageMap.${product.microsoftTeams}}/>}`,
      );
    },
  );

  test.each(CASES)(
    "%s: sits next to its Slack and Microsoft Teams pages, inside the same layout",
    (_name: string, product: Product) => {
      const code: string = dense(
        fs.readFileSync(path.join(DASHBOARD_SRC, product.routesFile), "utf8"),
      );

      const slackAt: number = code.indexOf(
        `${product.routePathTable}[PageMap.${product.slack}]`,
      );
      const teamsAt: number = code.indexOf(
        `${product.routePathTable}[PageMap.${product.microsoftTeams}]`,
      );
      const connectAt: number = code.indexOf(
        `${product.routePathTable}[PageMap.${product.connect}]`,
      );

      expect(slackAt).toBeGreaterThan(-1);
      expect(teamsAt).toBeGreaterThan(slackAt);
      expect(connectAt).toBeGreaterThan(teamsAt);

      // No layout opens or closes between the Microsoft Teams page and this one.
      const between: string = code.slice(teamsAt, connectAt);

      expect(between).not.toContain("</PageRoute></Routes>");
      expect(between).not.toContain('path="/"element={<Layout');
    },
  );
});
