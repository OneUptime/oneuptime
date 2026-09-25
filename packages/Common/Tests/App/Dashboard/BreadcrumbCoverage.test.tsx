import { afterEach, describe, expect, jest, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, render, screen, within } from "@testing-library/react";
import * as React from "react";
import { matchRoutes } from "react-router-dom";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  AlertsRoutePath,
  DatabaseRoutePath,
  IncidentsRoutePath,
  MonitorsRoutePath,
  ScheduledMaintenanceEventsRoutePath,
  SettingsRoutePath,
  SloRoutePath,
  RouteUtil,
  WorkflowRoutePath,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import { getSloBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Pages/Slo/Utils/Breadcrumbs";
import { getAlertsBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/AlertBreadcrumbs";
import { getDatabaseBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/DatabaseBreadcrumbs";
import { getIncidentsBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/IncidentBreadcrumbs";
import { getMonitorBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/MonitorBreadcrumbs";
import { getScheduleMaintenanceBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/ScheduledMaintenanceBreadcrumbs";
import { getSettingsBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/SettingsBreadcrumbs";
import { getWorkflowsBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/WorkflowsBreadcrumbs";
import Route from "../../../Types/API/Route";
import Dictionary from "../../../Types/Dictionary";
import Link from "../../../Types/Link";
import Page from "../../../UI/Components/Page/Page";
import Navigation from "../../../UI/Utils/Navigation";
import { goTo, PROJECT_ID } from "./SideMenuHarness";

jest.mock("../../../UI/Utils/Analytics", () => {
  return { __esModule: true, default: { capture: jest.fn() } };
});

type BreadcrumbGetter = (path: string) => Array<Link> | undefined;

interface Product {
  name: string;
  landing: PageMap;
  routes: Dictionary<string>;
  getBreadcrumbs: BreadcrumbGetter;
}

const products: Array<Product> = [
  {
    name: "Alerts",
    landing: PageMap.ALERTS,
    routes: AlertsRoutePath,
    getBreadcrumbs: getAlertsBreadcrumbs,
  },
  {
    name: "Incidents",
    landing: PageMap.INCIDENTS,
    routes: IncidentsRoutePath,
    getBreadcrumbs: getIncidentsBreadcrumbs,
  },
  {
    name: "Monitors",
    landing: PageMap.MONITORS,
    routes: MonitorsRoutePath,
    getBreadcrumbs: getMonitorBreadcrumbs,
  },
  {
    name: "Scheduled maintenance",
    landing: PageMap.SCHEDULED_MAINTENANCE_EVENTS,
    routes: ScheduledMaintenanceEventsRoutePath,
    getBreadcrumbs: getScheduleMaintenanceBreadcrumbs,
  },
  {
    name: "Project settings",
    landing: PageMap.SETTINGS,
    routes: SettingsRoutePath,
    getBreadcrumbs: getSettingsBreadcrumbs,
  },
  {
    /*
     * SloRoutePath mixes list-layout pages (archived) with the `:id` view
     * pages, so this also proves `archived` is not matched as an SLO id.
     */
    name: "SLOs",
    landing: PageMap.SLOS,
    routes: SloRoutePath,
    getBreadcrumbs: getSloBreadcrumbs,
  },
  {
    /*
     * DatabaseRoutePath mixes list-layout pages (archived, documentation,
     * settings/label-rules/:id) with the `:id` view pages, so this also
     * proves `archived` and `documentation` are not matched as a database
     * id — and the Archived list, unlike some older products, has a trail.
     */
    name: "Databases",
    landing: PageMap.DATABASE_SERVERS,
    routes: DatabaseRoutePath,
    getBreadcrumbs: getDatabaseBreadcrumbs,
  },
  {
    /*
     * WorkflowRoutePath puts the global variable view page
     * (variables/:id) next to the workflow view page (:id) and nests a
     * workflow's own variable page two ids deep (:id/variables/:subModelId),
     * so this also proves `variables` is not matched as a workflow id.
     */
    name: "Workflows",
    landing: PageMap.WORKFLOWS,
    routes: WorkflowRoutePath,
    getBreadcrumbs: getWorkflowsBreadcrumbs,
  },
];

const modelId: string = "7b3b1548-23cd-46ab-8359-280eb34362af";
// A rule's view page nested below its resource (an SLO's monitor rules) also carries :subModelId.
const subModelId: string = "9c4a2b1e-7d3f-4e8a-9b6c-1f2e3d4c5b6a";
const realRoutes: Array<{ path: string }> = Object.values(RouteMap)
  .map((route: Route): { path: string } => {
    return { path: route.toString() };
  })
  .filter((route: { path: string }): boolean => {
    return !route.path.includes("*");
  });

function visit(page: string): string {
  const path: string = RouteUtil.getRouteString(page)
    .replace(":projectId", PROJECT_ID)
    .replace(":id", modelId)
    .replace(":subModelId", subModelId);
  goTo(path);
  return path;
}

afterEach(() => {
  cleanup();
});

describe.each(products)("$name breadcrumb coverage", (product: Product) => {
  /*
   * Use the router's inventory, not a second list of pages that can omit the
   * same new page as the breadcrumb map.
   */
  test.each([product.landing, ...Object.keys(product.routes)])(
    "%s has a complete, navigable trail through the Page header",
    (page: string) => {
      const currentPath: string = visit(page);
      const matchedPath: string = Navigation.getRoutePath(
        RouteUtil.getRoutes(),
      );
      expect(matchedPath).toBe(RouteUtil.getRouteString(page));

      const links: Array<Link> | undefined =
        product.getBreadcrumbs(matchedPath);
      expect(links).toBeDefined();
      expect(links!.length).toBeGreaterThanOrEqual(2);
      expect(links![0]?.title).toBe("Project");
      expect(links![0]?.to.toString()).toBe(`/dashboard/${PROJECT_ID}`);
      expect(links![links!.length - 1]?.to.toString()).toBe(currentPath);

      links!.forEach((link: Link) => {
        expect(link.title.trim().length).toBeGreaterThan(0);
        expect(link.to.toString()).not.toMatch(/[:*]/);
        expect(matchRoutes(realRoutes, link.to.toString())).not.toBeNull();
      });

      render(
        <Page title={product.name} breadcrumbLinks={links}>
          <div>Page content</div>
        </Page>,
      );
      const trail: HTMLElement = screen.getByRole("navigation", {
        name: "Breadcrumb",
      });
      expect(within(trail).getAllByRole("listitem")).toHaveLength(
        links!.length,
      );
      expect(trail).not.toHaveClass("hidden");
      expect(screen.getByText("Page content")).toBeInTheDocument();
      within(trail)
        .getAllByRole("link")
        .forEach((anchor: HTMLElement) => {
          expect(anchor.getAttribute("href")).not.toBe(currentPath);
        });
    },
  );

  test("does not invent breadcrumbs for an unknown page", () => {
    visit(product.landing);
    expect(product.getBreadcrumbs("/not-a-page")).toBeUndefined();
  });
});

describe("restored breadcrumb hierarchy", () => {
  test.each([
    [
      PageMap.INCIDENT_EPISODE_VIEW_AUDIT_LOGS,
      getIncidentsBreadcrumbs,
      ["Project", "Incidents", "Episodes", "View Episode", "Audit Logs"],
      PageMap.INCIDENT_EPISODE_VIEW,
    ],
    [
      PageMap.ALERT_EPISODE_VIEW_REMEDIATION,
      getAlertsBreadcrumbs,
      ["Project", "Alerts", "Episodes", "View Episode", "Remediation"],
      PageMap.ALERT_EPISODE_VIEW,
    ],
    [
      PageMap.MONITORS_SETTINGS_TEMPLATES_VIEW,
      getMonitorBreadcrumbs,
      ["Project", "Monitors", "Settings", "Templates", "View Template"],
      PageMap.MONITORS_SETTINGS_TEMPLATES,
    ],
    [
      PageMap.SETTINGS_TELEMETRY_INGESTION_KEY_VIEW,
      getSettingsBreadcrumbs,
      ["Project", "Settings", "Telemetry Ingestion Keys", "View Key"],
      PageMap.SETTINGS_TELEMETRY_INGESTION_KEYS,
    ],
    [
      PageMap.WORKFLOWS_VARIABLE_VIEW,
      getWorkflowsBreadcrumbs,
      ["Project", "Workflows", "Variables", "View Variable"],
      PageMap.WORKFLOWS_VARIABLES,
    ],
    [
      PageMap.WORKFLOW_VARIABLE_VIEW,
      getWorkflowsBreadcrumbs,
      ["Project", "Workflows", "View Workflow", "Variables", "View Variable"],
      PageMap.WORKFLOW_VARIABLES,
    ],
    [
      PageMap.WORKFLOW_VIEW_AUDIT_LOGS,
      getWorkflowsBreadcrumbs,
      ["Project", "Workflows", "View Workflow", "Audit Logs"],
      PageMap.WORKFLOW_VIEW,
    ],
  ] as Array<[PageMap, BreadcrumbGetter, Array<string>, PageMap]>)(
    "%s preserves its parent link and leaf title",
    (
      page: PageMap,
      getBreadcrumbs: BreadcrumbGetter,
      titles: Array<string>,
      parent: PageMap,
    ) => {
      visit(page);
      const links: Array<Link> = getBreadcrumbs(
        RouteUtil.getRouteString(page),
      )!;
      expect(
        links.map((link: Link): string => {
          return link.title;
        }),
      ).toEqual(titles);
      expect(links[links.length - 2]?.to.toString()).toBe(
        RouteUtil.getRouteString(parent)
          .replace(":projectId", PROJECT_ID)
          .replace(":id", modelId),
      );
    },
  );
});
