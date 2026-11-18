import ProductKey from "../../../Types/Product/ProductKey";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A SWITCHED-OFF PRODUCT'S OWN ROUTES ARE REFUSED (#7479).
 *
 * Beside the CRUD API (BaseAPI, which refuses every record of a product
 * that is off), each product has routes of its own. Every route of these
 * files that is not a GET either names its product with
 * ServerProductRoutes.refuseWhileOff - refused, with who can switch it on,
 * while the server has the product off - or is listed below as one that is
 * left alone, with why: it only reads (products that stay on show records
 * of others), or it is the published page's own (a public status page, a
 * public form, a public dashboard keep working, as switching a product off
 * promises), or something outside OneUptime calls it (a webhook: what
 * already runs keeps running).
 *
 * A new route in one of these files is a decision, never a write that
 * slips through. A write a route makes with its caller's props is refused
 * again where every write is (ProductWriteRefusal).
 */

const PACKAGES: string = path.join(__dirname, "../../../..");

const READ: string = "It only reads.";
const PUBLIC_PAGE: string =
  "The published page's own: it stays up while the product is off.";

interface ProductRoutes {
  product: ProductKey;
  // Path text of a route left alone, as the file writes it -> why.
  leftAlone: Record<string, string>;
}

const FILES: Record<string, ProductRoutes> = {
  "Common/Server/API/StatusPageAPI.ts": {
    product: ProductKey.StatusPages,
    leftAlone: {
      unsubscribeApiPath: PUBLIC_PAGE,
      "`${new this.entityType().getCrudApiPath()?.toString()}/listing-monitors`":
        READ,
      "`${new this.entityType().getCrudApiPath()?.toString()}/domain`":
        PUBLIC_PAGE,
      "`${new this.entityType() .getCrudApiPath() ?.toString()}/master-page/:statusPageId`":
        PUBLIC_PAGE,
      "`${new this.entityType() .getCrudApiPath() ?.toString()}/master-password/:statusPageId`":
        PUBLIC_PAGE,
      "`${new this.entityType().getCrudApiPath()?.toString()}/sso/:statusPageId`":
        PUBLIC_PAGE,
      "`${new this.entityType().getCrudApiPath()?.toString()}/oidc/:statusPageId`":
        PUBLIC_PAGE,
      "`${new this.entityType() .getCrudApiPath() ?.toString()}/resources/:statusPageId`":
        PUBLIC_PAGE,
      "`${new this.entityType() .getCrudApiPath() ?.toString()}/uptime/:statusPageId`":
        PUBLIC_PAGE,
      overviewApiPath: PUBLIC_PAGE,
      summaryApiPath: PUBLIC_PAGE,
      "`${new this.entityType() .getCrudApiPath() ?.toString()}/update-subscription/:statusPageId/:subscriberId/:token`":
        PUBLIC_PAGE,
      "`${new this.entityType() .getCrudApiPath() ?.toString()}/get-subscription/:statusPageId/:subscriberId/:token`":
        PUBLIC_PAGE,
      "`${new this.entityType() .getCrudApiPath() ?.toString()}/subscribe/:statusPageId`":
        PUBLIC_PAGE,
      "`${new this.entityType() .getCrudApiPath() ?.toString()}/manage-subscription/:statusPageId`":
        PUBLIC_PAGE,
      incidentsListApiPath: PUBLIC_PAGE,
      scheduledMaintenanceEventsListApiPath: PUBLIC_PAGE,
      announcementsListApiPath: PUBLIC_PAGE,
      "`${new this.entityType() .getCrudApiPath() ?.toString()}/incidents/:statusPageIdOrDomain/:incidentId`":
        PUBLIC_PAGE,
      "`${new this.entityType() .getCrudApiPath() ?.toString()}/scheduled-maintenance-events/:statusPageIdOrDomain/:scheduledMaintenanceId`":
        PUBLIC_PAGE,
      "`${new this.entityType() .getCrudApiPath() ?.toString()}/announcements/:statusPageIdOrDomain/:announcementId`":
        PUBLIC_PAGE,
      "`${new this.entityType() .getCrudApiPath() ?.toString()}/episodes/:statusPageIdOrDomain`":
        PUBLIC_PAGE,
      "`${new this.entityType() .getCrudApiPath() ?.toString()}/episodes/:statusPageIdOrDomain/:episodeId`":
        PUBLIC_PAGE,
    },
  },
  "Common/Server/API/MonitorAPI.ts": {
    product: ProductKey.Monitors,
    leftAlone: {},
  },
  "Common/Server/API/MonitorGroupAPI.ts": {
    product: ProductKey.Monitors,
    leftAlone: {
      "`${new this.entityType() .getCrudApiPath() ?.toString()}/current-status/:monitorGroupId`":
        READ,
      "`${new this.entityType() .getCrudApiPath() ?.toString()}/timeline/:monitorGroupId`":
        READ,
      "`${new this.entityType() .getCrudApiPath() ?.toString()}/monitoring-summary/:monitorGroupId`":
        READ,
    },
  },
  "Common/Server/API/MonitorTemplateAPI.ts": {
    product: ProductKey.Monitors,
    leftAlone: {},
  },
  "Common/Server/API/IncidentAPI.ts": {
    product: ProductKey.Incidents,
    leftAlone: {
      "`${new this.entityType() .getCrudApiPath() ?.toString()}/subscriber-audience`":
        READ,
    },
  },
  "Common/Server/API/IncidentEpisodeAPI.ts": {
    product: ProductKey.Incidents,
    leftAlone: {},
  },
  "Common/Server/API/IncidentEpisodeMemberAPI.ts": {
    product: ProductKey.Incidents,
    leftAlone: {},
  },
  "Common/Server/API/IncidentPostmortemActionItemAPI.ts": {
    product: ProductKey.Incidents,
    leftAlone: {},
  },
  "Common/Server/API/IncidentVideoCallAPI.ts": {
    product: ProductKey.Incidents,
    leftAlone: {},
  },
  "Common/Server/API/AlertAPI.ts": {
    product: ProductKey.Alerts,
    leftAlone: {},
  },
  "Common/Server/API/AlertEpisodeMemberAPI.ts": {
    product: ProductKey.Alerts,
    leftAlone: {},
  },
  "Common/Server/API/OnCallCalendarAPI.ts": {
    product: ProductKey.OnCall,
    leftAlone: {},
  },
  "Common/Server/API/OnCallDutyPolicyScheduleAPI.ts": {
    product: ProductKey.OnCall,
    leftAlone: {},
  },
  "Common/Server/API/OnCallDutyPolicyUserOverrideAPI.ts": {
    product: ProductKey.OnCall,
    leftAlone: {},
  },
  "Common/Server/API/OnCallReadinessAPI.ts": {
    product: ProductKey.OnCall,
    leftAlone: {},
  },
  "Common/Server/API/OnCallTestPageAPI.ts": {
    product: ProductKey.OnCall,
    leftAlone: {
      "`${ON_CALL_TEST_PAGE_API_PATH}/preview`": READ,
      "`${ON_CALL_TEST_PAGE_API_PATH}/fire-drill/preview`": READ,
    },
  },
  "Common/Server/API/ScheduledMaintenanceAPI.ts": {
    product: ProductKey.ScheduledMaintenance,
    leftAlone: {},
  },
  "Common/Server/API/ScheduledMaintenanceCalendarAPI.ts": {
    product: ProductKey.ScheduledMaintenance,
    leftAlone: {},
  },
  "Common/Server/API/ScheduledMaintenanceExternalCalendarAPI.ts": {
    product: ProductKey.ScheduledMaintenance,
    leftAlone: {},
  },
  "Common/Server/API/ServiceLevelObjectiveAPI.ts": {
    product: ProductKey.Slos,
    leftAlone: {
      releaseCheckPath:
        "It only reads: whether an SLO's error budget lets a release go out.",
    },
  },
  "Common/Server/API/ServiceLevelObjectiveBurnRateRuleAPI.ts": {
    product: ProductKey.Slos,
    leftAlone: {
      "`${basePath}${SLO_RECOMMENDED_BURN_RATE_RULES_ROUTE}`": READ,
      "`${basePath}${SLO_BULK_RECOMMENDED_BURN_RATE_RULES_ROUTE}`": READ,
    },
  },
  "Common/Server/API/ServiceLevelObjectiveErrorBudgetPolicyTierAPI.ts": {
    product: ProductKey.Slos,
    leftAlone: {
      "`${basePath}${SLO_RECOMMENDED_POLICY_ROUTE}`": READ,
    },
  },
  "Common/Server/API/TelemetryExceptionAPI.ts": {
    product: ProductKey.Exceptions,
    leftAlone: {
      "`${new this.entityType() .getCrudApiPath() ?.toString()}/similar/:telemetryExceptionId`":
        READ,
      "`${new this.entityType().getCrudApiPath()?.toString()}/list-stats`":
        READ,
      "`${new this.entityType().getCrudApiPath()?.toString()}/by-fingerprints`":
        READ,
      "`${new this.entityType().getCrudApiPath()?.toString()}/group-fingerprints`":
        READ,
      "`${new this.entityType().getCrudApiPath()?.toString()}/dashboard-summary`":
        READ,
    },
  },
  "Common/Server/API/LlmObservabilityConnectionAPI.ts": {
    product: ProductKey.Llm,
    leftAlone: {},
  },
  "Common/Server/API/CloudConnectionAPI.ts": {
    product: ProductKey.Cloud,
    leftAlone: {},
  },
  "Common/Server/API/NetworkControllerConnectionAPI.ts": {
    product: ProductKey.Network,
    leftAlone: {},
  },
  "Common/Server/API/NetworkDeviceDiscoveryImportAPI.ts": {
    product: ProductKey.Network,
    leftAlone: {},
  },
  "Common/Server/API/NetworkDeviceNamingAPI.ts": {
    product: ProductKey.Network,
    leftAlone: {
      '"/network-device-naming/preview-scan"': READ,
      '"/network-device-naming/preview-discovered-devices"': READ,
      '"/network-device-naming/plan"': READ,
    },
  },
  "Common/Server/API/NetworkDiscoveredDeviceAPI.ts": {
    product: ProductKey.Network,
    leftAlone: {
      '"/network-discovered-device/list"': READ,
      '"/network-discovered-device/ids"': READ,
    },
  },
  "Common/Server/API/NetworkDeviceRefreshAPI.ts": {
    product: ProductKey.Network,
    leftAlone: {},
  },
  "Common/Server/API/PacketCaptureAPI.ts": {
    product: ProductKey.Network,
    leftAlone: {
      "`${path}/:packetCaptureId/download`": READ,
    },
  },
  "App/FeatureSet/BaseAPI/API/NetworkRuleRun.ts": {
    product: ProductKey.Network,
    leftAlone: {},
  },
  "App/FeatureSet/BaseAPI/API/NetworkTraffic.ts": {
    product: ProductKey.Network,
    leftAlone: {
      '"/network-traffic/summary"': READ,
      '"/network-traffic/find-address"': READ,
      '"/network-traffic/usage-summary"': READ,
      '"/network-traffic/usage-list"': READ,
      '"/network-traffic/usage-appliances"': READ,
    },
  },
  "Common/Server/API/ProxmoxResourceAPI.ts": {
    product: ProductKey.Proxmox,
    leftAlone: {
      "`${new this.entityType() .getCrudApiPath() ?.toString()}/inventory-summary/:clusterId`":
        READ,
    },
  },
  "Common/Server/API/SecurityCaseAPI.ts": {
    product: ProductKey.SecurityEvents,
    leftAlone: {
      "`${basePath}/overview`": READ,
      "`${basePath}/entity-activity`": READ,
      "`${basePath}/connections`": READ,
      "`${basePath}/connections/telemetry`": READ,
      "`${basePath}/resource-security`": READ,
      "`${basePath}/resource-security-scope`": READ,
      "`${basePath}/incident-security`": READ,
      "`${basePath}/setup/status`": READ,
      "`${basePath}/:caseId/ai-triage`": READ,
      "`${basePath}/:caseId/ai-triage/evidence`": READ,
    },
  },
  "Common/Server/API/SecurityCaseEvidenceAPI.ts": {
    product: ProductKey.SecurityEvents,
    leftAlone: {},
  },
  "Common/Server/API/SecurityEventConnectionAPI.ts": {
    product: ProductKey.SecurityEvents,
    leftAlone: {},
  },
  "Common/Server/API/SecurityEventDestinationAPI.ts": {
    product: ProductKey.SecurityEvents,
    leftAlone: {},
  },
  "Common/Server/API/SecurityPlaybookRunAPI.ts": {
    product: ProductKey.SecurityEvents,
    leftAlone: {},
  },
  "Common/Server/API/SecurityWatchlistAPI.ts": {
    product: ProductKey.SecurityEvents,
    leftAlone: {},
  },
  "Common/Server/API/DetectionRuleAPI.ts": {
    product: ProductKey.SecurityEvents,
    leftAlone: {},
  },
  "Common/Server/API/AIInsightAPI.ts": {
    product: ProductKey.AIInsights,
    leftAlone: {
      AI_INSIGHT_HIGHLIGHTS_PATH: READ,
    },
  },
  "Common/Server/API/AIChatAPI.ts": {
    product: ProductKey.AIChat,
    leftAlone: {
      '"/ai-chat/send-message"':
        "Refused in its handler, once the caller is known to be a member (ServerProducts.assertProductIsOn).",
      '"/ai-chat/providers"': READ,
    },
  },
  "Common/Server/API/DashboardAPI.ts": {
    product: ProductKey.Dashboards,
    leftAlone: {
      overviewApiPath: READ,
      "`${new this.entityType().getCrudApiPath()?.toString()}/domain`":
        PUBLIC_PAGE,
      "`${new this.entityType() .getCrudApiPath() ?.toString()}/metadata/:dashboardId`":
        PUBLIC_PAGE,
      "`${new this.entityType() .getCrudApiPath() ?.toString()}/view-config/:dashboardId`":
        PUBLIC_PAGE,
      "`${new this.entityType() .getCrudApiPath() ?.toString()}/attribute-values/:dashboardId`":
        PUBLIC_PAGE,
      "`${new this.entityType() .getCrudApiPath() ?.toString()}/metric-types/:dashboardId`":
        PUBLIC_PAGE,
      "`${new this.entityType() .getCrudApiPath() ?.toString()}/metrics-aggregate/:dashboardId`":
        PUBLIC_PAGE,
      "`${new this.entityType() .getCrudApiPath() ?.toString()}/resource-list/:dashboardId/:resourceType`":
        PUBLIC_PAGE,
      "`${new this.entityType() .getCrudApiPath() ?.toString()}/slo-history-aggregate/:dashboardId`":
        PUBLIC_PAGE,
      "`${new this.entityType() .getCrudApiPath() ?.toString()}/master-password/:dashboardId`":
        PUBLIC_PAGE,
    },
  },
  "Common/Server/API/DataSourceAPI.ts": {
    product: ProductKey.Dashboards,
    leftAlone: {
      "`${new this.entityType().getCrudApiPath()?.toString()}/query`": READ,
    },
  },
  "Common/Server/API/FormAPI.ts": {
    product: ProductKey.Forms,
    leftAlone: {
      "`${new this.entityType() .getCrudApiPath() ?.toString()}/public/:shareKey/submit`":
        PUBLIC_PAGE,
      "`${crudApiPath}${FORM_CUSTOM_DOMAIN_SUBMIT_ROUTE}`": PUBLIC_PAGE,
    },
  },
  "Common/Server/API/WorkflowVariableAPI.ts": {
    product: ProductKey.Workflows,
    leftAlone: {},
  },
  "App/FeatureSet/Workflow/API/Manual.ts": {
    product: ProductKey.Workflows,
    leftAlone: {},
  },
  "App/FeatureSet/Workflow/API/RunStep.ts": {
    product: ProductKey.Workflows,
    leftAlone: {},
  },
  "App/FeatureSet/Workflow/API/RunRecords.ts": {
    product: ProductKey.Workflows,
    leftAlone: {},
  },
  "App/FeatureSet/Runbook/API/Runbook.ts": {
    product: ProductKey.Runbooks,
    leftAlone: {},
  },
  "App/FeatureSet/Runbook/API/RunbookWebhook.ts": {
    product: ProductKey.Runbooks,
    leftAlone: {
      WEBHOOK_ROUTE:
        "Something outside OneUptime calls it: what already runs keeps running.",
    },
  },
};

interface Registration {
  method: string;
  path: string;
  // The handler chain's first few hundred characters.
  head: string;
}

// Every non-GET route a file registers, with the path text as the file writes it.
const readRegistrations: (source: string) => Array<Registration> = (
  source: string,
): Array<Registration> => {
  const registrations: Array<Registration> = [];
  const call: RegExp = /(?:router|this\.router)\.(post|put|delete|patch)\(\s*/g;
  let match: RegExpExecArray | null = call.exec(source);

  while (match) {
    const rest: string = source.slice(match.index + match[0].length);
    let depth: number = 0;
    let end: number = 0;

    for (; end < rest.length; end++) {
      const character: string = rest[end]!;

      if (character === "(" || character === "{" || character === "[") {
        depth++;
      } else if (character === ")" || character === "}" || character === "]") {
        depth--;
      } else if (character === "," && depth === 0) {
        break;
      }
    }

    registrations.push({
      method: match[1]!.toUpperCase(),
      path: rest.slice(0, end).replace(/\s+/g, " ").trim(),
      head: rest.slice(end, end + 400),
    });

    match = call.exec(source);
  }

  return registrations;
};

describe("a switched-off product's own routes", () => {
  for (const [file, routes] of Object.entries(FILES)) {
    test(`${file}: every route but its reads names ${routes.product}`, () => {
      const source: string = fs.readFileSync(
        path.join(PACKAGES, file),
        "utf8",
      );
      const registrations: Array<Registration> = readRegistrations(source);
      const unaccounted: Array<string> = [];
      const wrongProduct: Array<string> = [];

      for (const registration of registrations) {
        const guard: RegExpMatchArray | null = registration.head.match(
          /ServerProductRoutes\.refuseWhileOff\(ProductKey\.([A-Za-z]+)\)/,
        );

        if (guard) {
          if (
            (ProductKey as unknown as Record<string, string>)[guard[1]!] !==
            routes.product
          ) {
            wrongProduct.push(`${registration.method} ${registration.path}`);
          }

          continue;
        }

        if (
          !Object.prototype.hasOwnProperty.call(
            routes.leftAlone,
            registration.path,
          )
        ) {
          unaccounted.push(`${registration.method} ${registration.path}`);
        }
      }

      expect({ file, unaccounted, wrongProduct }).toEqual({
        file,
        unaccounted: [],
        wrongProduct: [],
      });

      // Nothing listed as left alone that is not one of its routes any more.
      const paths: Set<string> = new Set(
        registrations.map((registration: Registration): string => {
          return registration.path;
        }),
      );
      const stale: Array<string> = Object.keys(routes.leftAlone).filter(
        (routePath: string): boolean => {
          return !paths.has(routePath);
        },
      );

      expect({ file, stale }).toEqual({ file, stale: [] });
    });
  }

  test.each([
    ["Common/Server/API/DataObservabilityAPI.ts", "DataObservability"],
    ["Common/Server/API/DataSecurityAPI.ts", "DataSecurity"],
  ])(
    "%s: every route its helper registers but the reads names %s",
    (file: string, product: string) => {
      const source: string = fs.readFileSync(path.join(PACKAGES, file), "utf8");
      const helper: string = source.slice(source.indexOf("  private post("));

      expect(helper).toContain("permissions === READ_PERMISSIONS");
      expect(helper).toContain(
        `ServerProductRoutes.refuseWhileOff(ProductKey.${product})`,
      );
    },
  );

  test("the routes named in the issue are among them", () => {
    // #7479: MonitorAPI's and StatusPageAPI's own routes, and /workflow/... runs.
    expect(Object.keys(FILES)).toEqual(
      expect.arrayContaining([
        "Common/Server/API/MonitorAPI.ts",
        "Common/Server/API/StatusPageAPI.ts",
        "App/FeatureSet/Workflow/API/Manual.ts",
        "App/FeatureSet/Workflow/API/RunStep.ts",
      ]),
    );
  });
});
