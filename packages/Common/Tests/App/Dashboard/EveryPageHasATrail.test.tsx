import { afterEach, describe, expect, jest, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, render, screen, within } from "@testing-library/react";
import * as React from "react";
import { matchRoutes } from "react-router-dom";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import * as RouteMapModule from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import { getAIInsightsBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/AIInsightsBreadcrumbs";
import { getAlertsBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/AlertBreadcrumbs";
import { getCephBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/CephBreadcrumbs";
import { getCloudBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/CloudBreadcrumbs";
import { getCodeBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/CodeBreadcrumbs";
import { getDashboardBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/DashboardBreadCrumbs";
import { getDatabaseBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/DatabaseBreadcrumbs";
import { getDockerBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/DockerBreadcrumbs";
import { getDockerSwarmBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/DockerSwarmBreadcrumbs";
import { getExceptionsBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/ExceptionsBreadcrumbs";
import { getFormsBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/FormsBreadcrumbs";
import { getHostBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/HostBreadcrumbs";
import { getIncidentsBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/IncidentBreadcrumbs";
import { getInventoryBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/InventoryBreadcrumbs";
import { getIoTBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/IoTBreadcrumbs";
import { getKubernetesBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/KubernetesBreadcrumbs";
import { getLlmBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/LlmBreadcrumbs";
import { getLogsBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/LogsBreadcrumbs";
import { getMessageQueueBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/MessageQueueBreadcrumbs";
import { getMetricsBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/MetricsBreadcrumbs";
import { getMonitorBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/MonitorBreadcrumbs";
import { getMonitorGroupBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/MonitorGroupBreadcrumbs";
import {
  getIncomingCallPolicyBreadcrumbs,
  getOnCallDutyBreadcrumbs,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/OnCallDutyBreadcrumbs";
import { getPodmanBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/PodmanBreadcrumbs";
import { getProfilesBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/ProfilesBreadcrumbs";
import { getProxmoxBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/ProxmoxBreadcrumbs";
import { getRumBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/RumBreadcrumbs";
import { getRunbooksBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/RunbooksBreadcrumbs";
import { getScheduleMaintenanceBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/ScheduledMaintenanceBreadcrumbs";
import { getSecurityEventsBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/SecurityEventsBreadcrumbs";
import { getServerlessBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/ServerlessBreadcrumbs";
import { getServiceBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/ServiceBreadcrumbs";
import { getSettingsBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/SettingsBreadcrumbs";
import { getStatusPagesBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/StatusPagesBreadcrumbs";
import { getStorageArrayBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/StorageArrayBreadcrumbs";
import { getTeamsBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/TeamsBreadcrumbs";
import { getTracesBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/TracesBreadcrumbs";
import { getUserSettingsBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/UserSettingsBreadcrumbs";
import { getUsersBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/UsersBreadcrumbs";
import { getVMwareBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/VMwareBreadcrumbs";
import { getWorkflowsBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/WorkflowsBreadcrumbs";
import { getNetworkDeviceBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Pages/NetworkDevice/Utils/Breadcrumbs";
import { getNetworkSiteBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Pages/NetworkSite/Utils/Breadcrumbs";
import { getSloBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Pages/Slo/Utils/Breadcrumbs";
import Route from "../../../Types/API/Route";
import Dictionary from "../../../Types/Dictionary";
import Link from "../../../Types/Link";
import Page from "../../../UI/Components/Page/Page";
import Navigation from "../../../UI/Utils/Navigation";
import { goTo, PROJECT_ID } from "./SideMenuHarness";

jest.mock("../../../UI/Utils/Analytics", () => {
  return { __esModule: true, default: { capture: jest.fn() } };
});

/*
 * Every page of every product has a breadcrumb trail.
 *
 * A trail says where a page is and is the way back up from it. 73 pages
 * had none - the Archived list and the Owner Rules and Label Rules pages
 * of a dozen infrastructure and telemetry products, a host's, container
 * host's and service's Feed, Traces, Profiles and Audit Logs tabs, a
 * container's detail page, an RUM application's Clients - while every
 * page beside them had one, so the header jumped from "Project > Docker >
 * Hosts" to nothing as the reader moved down the same menu.
 * BreadcrumbCoverage holds nine products to complete trails; this holds
 * every route table the Dashboard's RouteMap exports, page by page, so a
 * page added to any product later has a trail too, or this fails.
 *
 * A product's route table is read through the trail getter its layouts
 * use. A new route table fails here until it is given one.
 */

type BreadcrumbGetter = (path: string) => Array<Link> | undefined;

const TRAIL_GETTERS: Dictionary<BreadcrumbGetter> = {
  MonitorsRoutePath: getMonitorBreadcrumbs,
  ServiceRoutePath: getServiceBreadcrumbs,
  CodeRoutePath: getCodeBreadcrumbs,
  KubernetesRoutePath: getKubernetesBreadcrumbs,
  NetworkDeviceRoutePath: getNetworkDeviceBreadcrumbs,
  SloRoutePath: getSloBreadcrumbs,
  NetworkSiteRoutePath: getNetworkSiteBreadcrumbs,
  DockerRoutePath: getDockerBreadcrumbs,
  PodmanRoutePath: getPodmanBreadcrumbs,
  ProxmoxRoutePath: getProxmoxBreadcrumbs,
  VMwareRoutePath: getVMwareBreadcrumbs,
  IoTRoutePath: getIoTBreadcrumbs,
  DockerSwarmRoutePath: getDockerSwarmBreadcrumbs,
  CephRoutePath: getCephBreadcrumbs,
  StorageArrayRoutePath: getStorageArrayBreadcrumbs,
  HostRoutePath: getHostBreadcrumbs,
  ServerlessRoutePath: getServerlessBreadcrumbs,
  CloudRoutePath: getCloudBreadcrumbs,
  DatabaseRoutePath: getDatabaseBreadcrumbs,
  MessageQueueRoutePath: getMessageQueueBreadcrumbs,
  RumRoutePath: getRumBreadcrumbs,
  WorkflowRoutePath: getWorkflowsBreadcrumbs,
  RunbookRoutePath: getRunbooksBreadcrumbs,
  FormsRoutePath: getFormsBreadcrumbs,
  AIInsightsRoutePath: getAIInsightsBreadcrumbs,
  LogsRoutePath: getLogsBreadcrumbs,
  SecurityEventsRoutePath: getSecurityEventsBreadcrumbs,
  MetricsRoutePath: getMetricsBreadcrumbs,
  TracesRoutePath: getTracesBreadcrumbs,
  ProfilesRoutePath: getProfilesBreadcrumbs,
  InventoryRoutePath: getInventoryBreadcrumbs,
  ExceptionsRoutePath: getExceptionsBreadcrumbs,
  LlmRoutePath: getLlmBreadcrumbs,
  DashboardsRoutePath: getDashboardBreadcrumbs,
  StatusPagesRoutePath: getStatusPagesBreadcrumbs,
  IncidentsRoutePath: getIncidentsBreadcrumbs,
  AlertsRoutePath: getAlertsBreadcrumbs,
  ScheduledMaintenanceEventsRoutePath: getScheduleMaintenanceBreadcrumbs,
  SettingsRoutePath: getSettingsBreadcrumbs,
  UsersRoutePath: getUsersBreadcrumbs,
  TeamsRoutePath: getTeamsBreadcrumbs,
  OnCallDutyRoutePath: (path: string): Array<Link> | undefined => {
    // Incoming call policies' pages have a getter of their own, as their layout does.
    return (
      getOnCallDutyBreadcrumbs(path) || getIncomingCallPolicyBreadcrumbs(path)
    );
  },
  MonitorGroupRoutePath: getMonitorGroupBreadcrumbs,
  UserSettingsRoutePath: getUserSettingsBreadcrumbs,
};

/*
 * Route tables drawn without a trail of their own, and why.
 */
const TABLES_WITHOUT_TRAILS: Dictionary<string> = {
  TopologyRoutePath:
    "Topology is drawn in the Inventory layout under its own title and the Inventory menu, with no trail - a page of its own kind; a trail for it is a follow-up.",
};

/*
 * Pages that are not drawn under a trail, each with the reason. Each must
 * still have none: one that gains a trail leaves this list.
 */
const PAGES_WITHOUT_TRAILS: Dictionary<string> = {
  [PageMap.SECURITY_EVENTS_MONITORS]:
    "An old address: it forwards to Monitors, where Security Events monitors are listed.",
  [PageMap.SECURITY_EVENTS_ENTITIES]:
    "An old address: it forwards to Entity Risk.",
  [PageMap.LLM_OVERVIEW]:
    "An old address: it forwards to Conversations, which carries the overview's numbers.",
  [PageMap.LLM_DOCUMENTATION]:
    "An old address: it forwards to Connect, which carries the setup snippets.",
  [PageMap.DASHBOARD_PLAYLIST_PLAY]:
    "A playlist playing over the whole window, with no page around it: no menu, no trail.",
  [PageMap.ANNOUNCEMENT_CREATE]:
    "Draws its own Page and trail, which starts from the record it was opened from (useRecordToCreateFrom).",
};

const modelId: string = "7b3b1548-23cd-46ab-8359-280eb34362af";
const subModelId: string = "9c4a2b1e-7d3f-4e8a-9b6c-1f2e3d4c5b6a";

const realRoutes: Array<{ path: string }> = Object.values(RouteMap)
  .map((route: Route): { path: string } => {
    return { path: route.toString() };
  })
  .filter((route: { path: string }): boolean => {
    return !route.path.includes("*");
  });

const routeTables: Dictionary<Dictionary<string>> = Object.fromEntries(
  Object.entries(RouteMapModule).filter(
    ([name, value]: [string, unknown]): boolean => {
      return name.endsWith("RoutePath") && typeof value === "object";
    },
  ),
) as Dictionary<Dictionary<string>>;

const visit: (page: string) => string = (page: string): string => {
  const path: string = RouteUtil.getRouteString(page)
    .replace(":projectId", PROJECT_ID)
    .replace(":id", modelId)
    .replace(":subModelId", subModelId);
  goTo(path);
  return path;
};

afterEach(() => {
  cleanup();
});

describe("every product's route table is read", () => {
  test("RouteMap exports the route tables this reads", () => {
    expect(Object.keys(routeTables).length).toBeGreaterThanOrEqual(45);
  });

  test("each route table has its trail getter here, or says why it has none", () => {
    const unread: Array<string> = Object.keys(routeTables).filter(
      (table: string): boolean => {
        return !TRAIL_GETTERS[table] && !TABLES_WITHOUT_TRAILS[table];
      },
    );

    expect(unread).toEqual([]);
  });

  test("every reason is a reason", () => {
    for (const reason of [
      ...Object.values(TABLES_WITHOUT_TRAILS),
      ...Object.values(PAGES_WITHOUT_TRAILS),
    ]) {
      expect(reason.length).toBeGreaterThan(30);
    }
  });
});

const cases: Array<[string, string]> = Object.entries(TRAIL_GETTERS).flatMap(
  ([table]: [string, BreadcrumbGetter]): Array<[string, string]> => {
    return Object.keys(routeTables[table] || {})
      .filter((page: string): boolean => {
        // Mount points that only nest other routes are not pages.
        return !RouteUtil.getRouteString(page).includes("*");
      })
      .map((page: string): [string, string] => {
        return [table, page];
      });
  },
);

describe("every page has a trail", () => {
  test("the pages are many", () => {
    expect(cases.length).toBeGreaterThanOrEqual(700);
  });

  test.each(cases)("%s: %s", (table: string, page: string) => {
    const currentPath: string = visit(page);
    const matchedPath: string = Navigation.getRoutePath(RouteUtil.getRoutes());
    const links: Array<Link> | undefined = TRAIL_GETTERS[table]!(matchedPath);

    if (PAGES_WITHOUT_TRAILS[page]) {
      // Stale: a page that gains a trail leaves the list.
      expect(links).toBeUndefined();
      return;
    }

    expect(links).toBeDefined();
    expect(links!.length).toBeGreaterThanOrEqual(2);
    expect(links![0]?.title).toBe("Project");
    expect(links![0]?.to.toString()).toBe(`/dashboard/${PROJECT_ID}`);
    expect(links![links!.length - 1]?.to.toString()).toBe(currentPath);

    for (const link of links!) {
      expect(link.title.trim().length).toBeGreaterThan(0);
      expect(link.to.toString()).not.toMatch(/[:*]/);
      expect(matchRoutes(realRoutes, link.to.toString())).not.toBeNull();
    }
  });
});

describe("a trail is drawn as the Page's header draws it", () => {
  test.each([
    PageMap.DOCKER_ARCHIVED,
    PageMap.HOST_SETTINGS_OWNER_RULES,
    PageMap.SERVICE_VIEW_FEED,
    PageMap.PODMAN_HOST_VIEW_CONTAINER_DETAIL,
    PageMap.RUM_APPLICATION_VIEW_CLIENTS,
    PageMap.USER_SETTINGS_ON_CALL_LOGS_TIMELINE,
  ])("%s", (page: string) => {
    const currentPath: string = visit(page);
    const table: string = Object.keys(routeTables).find(
      (candidate: string): boolean => {
        return Boolean(routeTables[candidate]![page]);
      },
    )!;
    const links: Array<Link> = TRAIL_GETTERS[table]!(
      Navigation.getRoutePath(RouteUtil.getRoutes()),
    )!;

    render(
      <Page title="Page" breadcrumbLinks={links}>
        <div>Page content</div>
      </Page>,
    );

    const trail: HTMLElement = screen.getByRole("navigation", {
      name: "Breadcrumb",
    });
    expect(within(trail).getAllByRole("listitem")).toHaveLength(links.length);
    // The page itself is the trail's last item, not a link to itself.
    within(trail)
      .getAllByRole("link")
      .forEach((anchor: HTMLElement) => {
        expect(anchor.getAttribute("href")).not.toBe(currentPath);
      });
  });
});
