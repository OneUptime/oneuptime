import { describe, expect, test } from "@jest/globals";
import CloudAccountRecommendationPlan, {
  CloudAccountRecommendationDefaults,
  CloudAccountRecommendationGroup,
  CloudAccountRecommendationPlanItem,
  CloudAccountRecommendationResource,
  CloudAccountRecommendationRow,
  CloudAccountRecommendationTarget,
  getCloudAccountRecommendationArgs,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Recommendations/CloudAccountRecommendationPlan";
import CloudEnvironmentAppRecommendationPlan, {
  CLOUD_ENVIRONMENT_APPS_GROUP_KEY,
  CloudEnvironmentAppRecommendationGapReason,
  CloudEnvironmentAppRecommendationGaps,
  getCloudEnvironmentAppRecommendationScope,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Recommendations/CloudEnvironmentAppRecommendationPlan";
import {
  buildCloudAppRecommendationContext,
  readCloudAppRecommendationContext,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Recommendations/RecommendationResourceRegistry";
import {
  RecommendationSeverityFilter,
  RecommendationStatus,
  RecommendationStatusFilter,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Recommendations/RecommendationViewModel";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import RecommendationDismissal from "../../../Models/DatabaseModels/RecommendationDismissal";
import { getCloudEnvironmentKeyOfFilter } from "../../../Types/Cloud/CloudEnvironmentTelemetryScope";
import { getAllCloudAppAlertTemplates } from "../../../Types/Monitor/CloudAppAlertTemplates";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../Types/Monitor/MonitorType";
import MonitorRecommendationCatalog from "../../../Types/Monitor/Recommendation/MonitorRecommendationCatalog";
import {
  MonitorRecommendation,
  MonitorRecommendationContext,
  MonitorRecommendationNotificationMode,
  MonitorRecommendationResourceType,
} from "../../../Types/Monitor/Recommendation/MonitorRecommendationTypes";
import ObjectID from "../../../Types/ObjectID";

/*
 * What an App Platforms environment's Recommendations page is worked out
 * from (CloudEnvironmentAppRecommendationPlan): the cloud account's join
 * with an environment's scope - every app's recommended monitors in one
 * group, a row per recommendation, each app's own monitor built from the
 * same context its own Recommendations tab builds it from, so one made
 * there is recognised here; what the team dismissed on an app's tab; the
 * apps it leaves out and why; what one Add creates and what each monitor is
 * linked to - the environment. React-free, so held here without a renderer.
 */

const ENVIRONMENT_ID: string = "71000000-0000-4000-8000-000000000001";

const ENVIRONMENT: {
  cloudPlatform: string;
  cloudAccountId: string;
  cloudRegion: string;
} = {
  cloudPlatform: "aws_ecs",
  cloudAccountId: "123456789012",
  cloudRegion: "us-east-1",
};

function uuid(number: number): string {
  return `75000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
}

// An app of the environment, with the context its own tab reads it with.
function app(data: {
  id: number;
  name: string;
  attributes: Record<string, string>;
  detail?: string | undefined;
  environment?: typeof ENVIRONMENT | null;
}): CloudAccountRecommendationResource {
  return {
    resourceId: uuid(data.id),
    resourceName: data.name,
    context: buildCloudAppRecommendationContext({
      environmentId: ENVIRONMENT_ID,
      environment:
        data.environment === undefined ? ENVIRONMENT : data.environment,
      telemetryAttributes: data.attributes,
    }),
    ...(data.detail ? { detail: data.detail } : {}),
  };
}

const CHECKOUT_API: CloudAccountRecommendationResource = app({
  id: 1,
  name: "checkout-api",
  attributes: {
    "aws.ecs.task.family": "checkout-api",
    "aws.ecs.cluster.arn":
      "arn:aws:ecs:us-east-1:123456789012:cluster/production",
  },
  detail: "cluster production",
});
// Another app of the same name, in another cluster of the environment.
const CHECKOUT_API_STAGING: CloudAccountRecommendationResource = app({
  id: 2,
  name: "checkout-api",
  attributes: {
    "aws.ecs.task.family": "checkout-api",
    "aws.ecs.cluster.arn": "arn:aws:ecs:us-east-1:123456789012:cluster/staging",
  },
  detail: "cluster staging",
});
const INVENTORY: CloudAccountRecommendationResource = app({
  id: 3,
  name: "inventory",
  attributes: {
    "aws.ecs.task.family": "inventory",
    "aws.ecs.cluster.arn":
      "arn:aws:ecs:us-east-1:123456789012:cluster/production",
  },
  detail: "cluster production",
});
// Its name was too long to filter by: ingest stored no attribute for it.
const LONG_NAME: CloudAccountRecommendationResource = app({
  id: 4,
  name: "a-very-long-generated-task-family-name",
  attributes: {},
});

const ALL: Array<CloudAccountRecommendationResource> = [
  INVENTORY,
  LONG_NAME,
  CHECKOUT_API_STAGING,
  CHECKOUT_API,
];

const TEMPLATE_IDS: Array<string> = getAllCloudAppAlertTemplates().map(
  (template: { id: string }): string => {
    return template.id;
  },
);

const DEFAULTS: CloudAccountRecommendationDefaults = {
  onlineMonitorStatusId: new ObjectID("70000000-0000-4000-8000-000000000001"),
  offlineMonitorStatusId: new ObjectID("70000000-0000-4000-8000-000000000002"),
  defaultMonitorStatusId: new ObjectID("70000000-0000-4000-8000-000000000003"),
  defaultIncidentSeverityId: new ObjectID(
    "70000000-0000-4000-8000-000000000004",
  ),
  defaultAlertSeverityId: new ObjectID("70000000-0000-4000-8000-000000000005"),
};

function recommendationOf(
  target: CloudAccountRecommendationResource,
  templateId: string,
): MonitorRecommendation {
  return MonitorRecommendationCatalog.getRecommendations(
    MonitorRecommendationResourceType.CloudApp,
    target.context,
  ).find((candidate: MonitorRecommendation): boolean => {
    return candidate.templateId === templateId;
  })!;
}

// A monitor made from one recommendation of an app, as its own tab makes it.
function monitorOf(
  target: CloudAccountRecommendationResource,
  templateId: string,
): { monitorId: ObjectID; monitorSteps: Array<MonitorStep> } {
  return {
    monitorId: ObjectID.generate(),
    monitorSteps: [
      recommendationOf(target, templateId).getMonitorStep(
        getCloudAccountRecommendationArgs({
          resource: target,
          defaults: {
            // The project's own ids: the fingerprint holds none of them.
            onlineMonitorStatusId: ObjectID.generate(),
            offlineMonitorStatusId: ObjectID.generate(),
            defaultMonitorStatusId: ObjectID.generate(),
            defaultIncidentSeverityId: ObjectID.generate(),
            defaultAlertSeverityId: ObjectID.generate(),
          },
        }),
      ),
    ],
  };
}

function dismissalOf(
  target: CloudAccountRecommendationResource,
  templateId: string,
): RecommendationDismissal {
  const dismissal: RecommendationDismissal = new RecommendationDismissal();
  dismissal._id = ObjectID.generate().toString();
  dismissal.recommendationId = recommendationOf(
    target,
    templateId,
  ).recommendationId;
  dismissal.recommendationType = "Monitor";
  dismissal.resourceType = MonitorRecommendationResourceType.CloudApp;
  dismissal.resourceId = new ObjectID(target.resourceId);
  return dismissal;
}

function groupsOf(
  data: {
    resources?: Array<CloudAccountRecommendationResource>;
    monitors?: Array<{ monitorId: ObjectID; monitorSteps: Array<MonitorStep> }>;
    dismissals?: Array<RecommendationDismissal>;
  } = {},
): Array<CloudAccountRecommendationGroup> {
  return CloudEnvironmentAppRecommendationPlan.buildGroups({
    environmentId: ENVIRONMENT_ID,
    groupLabel: "Apps",
    resources: data.resources || ALL,
    existingMonitors: data.monitors || [],
    dismissals: data.dismissals || [],
  });
}

function rowOf(
  group: CloudAccountRecommendationGroup,
  templateId: string,
): CloudAccountRecommendationRow {
  return group.rows.find((row: CloudAccountRecommendationRow): boolean => {
    return row.recommendationId.endsWith(`:${templateId}`);
  })!;
}

function statusesOf(
  row: CloudAccountRecommendationRow,
): Array<[string, string, RecommendationStatus]> {
  return row.targets.map(
    (
      target: CloudAccountRecommendationTarget,
    ): [string, string, RecommendationStatus] => {
      return [
        target.resource.resourceName,
        target.resource.detail || "",
        target.status,
      ];
    },
  );
}

describe("an environment's apps, as one group", () => {
  test("every app whose telemetry can be told apart, in one group of the page's label, by name and then cluster", () => {
    const groups: Array<CloudAccountRecommendationGroup> = groupsOf();

    expect(groups).toHaveLength(1);
    expect(groups[0]!.key).toBe(CLOUD_ENVIRONMENT_APPS_GROUP_KEY);
    expect(groups[0]!.label).toBe("Apps");
    expect(
      groups[0]!.resources.map(
        (resource: CloudAccountRecommendationResource): string => {
          return `${resource.resourceName} (${resource.detail})`;
        },
      ),
    ).toEqual([
      "checkout-api (cluster production)",
      "checkout-api (cluster staging)",
      "inventory (cluster production)",
    ]);
  });

  test("a row per recommendation, in the catalog's order, each offered to every such app", () => {
    const group: CloudAccountRecommendationGroup = groupsOf()[0]!;

    expect(
      group.rows.map((row: CloudAccountRecommendationRow): string => {
        return row.recommendationId.split(":")[1] as string;
      }),
    ).toEqual(TEMPLATE_IDS);

    for (const row of group.rows) {
      expect(row.counts).toEqual({
        total: 3,
        available: 3,
        created: 0,
        dismissed: 0,
      });
    }

    expect(CloudAccountRecommendationPlan.getCounts(groupsOf()).available).toBe(
      3 * TEMPLATE_IDS.length,
    );
  });

  test("an environment with no app offers nothing, and no group", () => {
    expect(groupsOf({ resources: [] })).toEqual([]);
  });
});

describe("what covers a recommendation, app by app", () => {
  test("a monitor made on an app's own tab covers it there, and only for that app", () => {
    const row: CloudAccountRecommendationRow = rowOf(
      groupsOf({
        monitors: [monitorOf(CHECKOUT_API, "cloud-app-failed-operations")],
      })[0]!,
      "cloud-app-failed-operations",
    );

    expect(statusesOf(row)).toEqual([
      ["checkout-api", "cluster production", RecommendationStatus.Created],
      ["checkout-api", "cluster staging", RecommendationStatus.Available],
      ["inventory", "cluster production", RecommendationStatus.Available],
    ]);
    expect(row.counts).toEqual({
      total: 3,
      available: 2,
      created: 1,
      dismissed: 0,
    });
    // The monitor that covers it, for "View monitor".
    expect(row.targets[0]!.monitorId?.toString()).toBeTruthy();
  });

  test("the same recommendation of another app is another monitor: the staging app's covers nothing in production", () => {
    const row: CloudAccountRecommendationRow = rowOf(
      groupsOf({
        monitors: [monitorOf(CHECKOUT_API_STAGING, "cloud-app-latency-p95")],
      })[0]!,
      "cloud-app-latency-p95",
    );

    expect(statusesOf(row)[0]![2]).toBe(RecommendationStatus.Available);
    expect(statusesOf(row)[1]![2]).toBe(RecommendationStatus.Created);
  });

  test("a recommendation the team dismissed on an app's tab is dismissed for that app only", () => {
    const row: CloudAccountRecommendationRow = rowOf(
      groupsOf({
        dismissals: [dismissalOf(INVENTORY, "cloud-app-traffic-stopped")],
      })[0]!,
      "cloud-app-traffic-stopped",
    );

    expect(statusesOf(row)).toEqual([
      ["checkout-api", "cluster production", RecommendationStatus.Available],
      ["checkout-api", "cluster staging", RecommendationStatus.Available],
      ["inventory", "cluster production", RecommendationStatus.Dismissed],
    ]);
  });

  test("the context the page builds for an app is the one its own tab builds", () => {
    // What the app's tab reads off its row, then completes with its environment.
    const fromRow: MonitorRecommendationContext =
      readCloudAppRecommendationContext({
        cloudResourceId: ENVIRONMENT_ID,
        telemetryAttributes: {
          "aws.ecs.task.family": "checkout-api",
          "aws.ecs.cluster.arn":
            "arn:aws:ecs:us-east-1:123456789012:cluster/production",
        },
      });

    expect(fromRow.cloudAppEnvironmentId).toBe(ENVIRONMENT_ID);
    expect(CHECKOUT_API.context).toEqual(
      buildCloudAppRecommendationContext({
        environmentId: fromRow.cloudAppEnvironmentId,
        environment: ENVIRONMENT,
        telemetryAttributes: {
          "aws.ecs.task.family": "checkout-api",
          "aws.ecs.cluster.arn":
            "arn:aws:ecs:us-east-1:123456789012:cluster/production",
        },
      }),
    );
    // Its environment's platform, account and Region, and its own attributes.
    expect(CHECKOUT_API.context.cloudAppTelemetryFilters).toEqual({
      "resource.cloud.platform": "aws_ecs",
      "resource.cloud.account.id": "123456789012",
      "resource.cloud.region": "us-east-1",
      "resource.aws.ecs.task.family": "checkout-api",
      "resource.aws.ecs.cluster.arn":
        "arn:aws:ecs:us-east-1:123456789012:cluster/production",
    });
  });
});

describe("the apps left out, and why", () => {
  test("an app whose name was too long to filter by is named, by why", () => {
    const groups: Array<CloudAccountRecommendationGroup> = groupsOf();
    const gaps: CloudEnvironmentAppRecommendationGaps =
      CloudEnvironmentAppRecommendationPlan.getGaps({
        resources: ALL,
        groups: groups,
      });

    expect(
      gaps.gaps.map((gap: { resource: CloudAccountRecommendationResource }) => {
        return gap.resource.resourceName;
      }),
    ).toEqual(["a-very-long-generated-task-family-name"]);
    expect(
      gaps.byReason[CloudEnvironmentAppRecommendationGapReason.NotScoped],
    ).toHaveLength(1);
    expect(
      gaps.byReason[CloudEnvironmentAppRecommendationGapReason.PlatformUnknown],
    ).toEqual([]);
    // An app's kind needs no saying: no type label beside its name.
    expect(gaps.gaps[0]!.typeLabel).toBe("");
  });

  test("an environment no telemetry has named a platform for leaves every app out, until it does", () => {
    const unscoped: Array<CloudAccountRecommendationResource> = [
      app({
        id: 5,
        name: "worker",
        attributes: { "service.name": "worker" },
        environment: null,
      }),
      app({ id: 6, name: "api", attributes: {}, environment: null }),
    ];
    const groups: Array<CloudAccountRecommendationGroup> = groupsOf({
      resources: unscoped,
    });
    const gaps: CloudEnvironmentAppRecommendationGaps =
      CloudEnvironmentAppRecommendationPlan.getGaps({
        resources: unscoped,
        groups: groups,
      });

    expect(groups).toEqual([]);
    expect(
      gaps.byReason[
        CloudEnvironmentAppRecommendationGapReason.PlatformUnknown
      ].map((gap: { resource: CloudAccountRecommendationResource }) => {
        return gap.resource.resourceName;
      }),
    ).toEqual(["api", "worker"]);
  });

  test("the reason is the platform first: an app is told apart by its environment's platform before its own name", () => {
    expect(
      CloudEnvironmentAppRecommendationPlan.getGapReason({
        cloudAppTelemetryFilters: { "resource.service.name": "api" },
      }),
    ).toBe(CloudEnvironmentAppRecommendationGapReason.PlatformUnknown);
    expect(
      CloudEnvironmentAppRecommendationPlan.getGapReason({
        cloudAppTelemetryFilters: { "resource.cloud.platform": "aws_ecs" },
      }),
    ).toBe(CloudEnvironmentAppRecommendationGapReason.NotScoped);
    expect(CloudEnvironmentAppRecommendationPlan.getGapReason({})).toBe(
      CloudEnvironmentAppRecommendationGapReason.PlatformUnknown,
    );
  });
});

describe("what one Add creates", () => {
  test("a monitor per app still without it, named after the app, read by the app's own filter, linked to the environment", () => {
    const row: CloudAccountRecommendationRow = rowOf(
      groupsOf({
        monitors: [monitorOf(INVENTORY, "cloud-app-error-burst")],
      })[0]!,
      "cloud-app-error-burst",
    );
    const plan: Array<CloudAccountRecommendationPlanItem> =
      CloudEnvironmentAppRecommendationPlan.buildCreatePlan({
        environmentId: ENVIRONMENT_ID,
        targets: CloudAccountRecommendationPlan.getAvailableTargets(row),
        defaults: DEFAULTS,
        notificationSettings: {
          notificationMode: MonitorRecommendationNotificationMode.Alert,
        },
      });

    expect(
      plan.map((item: CloudAccountRecommendationPlanItem): string => {
        return CloudAccountRecommendationPlan.getPlanItemName(item);
      }),
    ).toEqual(["checkout-api - Error Burst", "checkout-api - Error Burst"]);

    for (const item of plan) {
      const monitor: Monitor = item.monitor;

      // A span count: a Traces monitor, as the app's tab makes it.
      expect(monitor.monitorType).toBe(MonitorType.Traces);
      // Linked to the environment, where an app's incidents are listed.
      expect(
        (monitor.cloudResources || []).map((cloud: CloudResource) => {
          return cloud.id?.toString();
        }),
      ).toEqual([ENVIRONMENT_ID]);

      const step: MonitorStep =
        monitor.monitorSteps!.data!.monitorStepsInstanceArray[0]!;
      const filter: Record<string, unknown> = step.data!.traceMonitor!
        .attributes as Record<string, unknown>;

      // The app's own filter, so the environment's maintenance holds it.
      expect(getCloudEnvironmentKeyOfFilter(filter)).toBe(
        "aws_ecs|123456789012|us-east-1",
      );
      expect(filter).toEqual(
        item.target.resource.context.cloudAppTelemetryFilters,
      );
    }

    // The production and staging apps each get their own monitor.
    expect(
      plan.map((item: CloudAccountRecommendationPlanItem): string => {
        return item.target.resource.detail || "";
      }),
    ).toEqual(["cluster production", "cluster staging"]);
  });

  test("a latency recommendation is a Metrics monitor of the app's request durations, scoped the same way", () => {
    const row: CloudAccountRecommendationRow = rowOf(
      groupsOf()[0]!,
      "cloud-app-latency-p99",
    );
    const plan: Array<CloudAccountRecommendationPlanItem> =
      CloudEnvironmentAppRecommendationPlan.buildCreatePlan({
        environmentId: ENVIRONMENT_ID,
        targets: [row.targets[2]!],
        defaults: DEFAULTS,
        notificationSettings: {},
      });

    expect(plan).toHaveLength(1);
    expect(plan[0]!.monitor.monitorType).toBe(MonitorType.Metrics);
    expect(plan[0]!.monitor.name).toBe(
      "inventory - Severe Request Latency (p99)",
    );
  });

  test("Add all is every recommendation still to set up on every app", () => {
    const group: CloudAccountRecommendationGroup = groupsOf({
      monitors: [monitorOf(CHECKOUT_API, "cloud-app-failed-operations")],
      dismissals: [dismissalOf(INVENTORY, "cloud-app-traffic-stopped")],
    })[0]!;
    const targets: Array<CloudAccountRecommendationTarget> =
      CloudAccountRecommendationPlan.getAvailableTargets(group);

    expect(targets).toHaveLength(3 * TEMPLATE_IDS.length - 2);
    expect(
      CloudEnvironmentAppRecommendationPlan.buildCreatePlan({
        environmentId: ENVIRONMENT_ID,
        targets: targets,
        defaults: DEFAULTS,
        notificationSettings: {},
      }),
    ).toHaveLength(3 * TEMPLATE_IDS.length - 2);
  });

  test("a target created or dismissed since the page read it is left out", () => {
    const row: CloudAccountRecommendationRow = rowOf(
      groupsOf({
        monitors: [monitorOf(CHECKOUT_API, "cloud-app-latency-p95")],
        dismissals: [dismissalOf(INVENTORY, "cloud-app-latency-p95")],
      })[0]!,
      "cloud-app-latency-p95",
    );

    expect(
      CloudEnvironmentAppRecommendationPlan.buildCreatePlan({
        environmentId: ENVIRONMENT_ID,
        targets: [row.targets[0]!, row.targets[2]!],
        defaults: DEFAULTS,
        notificationSettings: {},
      }),
    ).toEqual([]);
  });

  test("the scope links every monitor to the environment, whatever the app", () => {
    const monitor: Monitor = new Monitor();

    getCloudEnvironmentAppRecommendationScope({
      environmentId: ENVIRONMENT_ID,
      groupLabel: "Apps",
    }).linkMonitor({ monitor: monitor, resource: INVENTORY });

    expect(
      (monitor.cloudResources || []).map((cloud: CloudResource) => {
        return cloud.id?.toString();
      }),
    ).toEqual([ENVIRONMENT_ID]);
  });
});

describe("the toolbar's search", () => {
  test("finds an app by the cluster that tells it apart", () => {
    const groups: Array<CloudAccountRecommendationGroup> = groupsOf();

    const found: Array<CloudAccountRecommendationGroup> =
      CloudAccountRecommendationPlan.filterGroups({
        groups: groups,
        filterState: {
          searchText: "staging",
          status: RecommendationStatusFilter.All,
          severity: RecommendationSeverityFilter.All,
        },
      });

    expect(found).toHaveLength(1);
    expect(found[0]!.rows).toHaveLength(TEMPLATE_IDS.length);
    expect(
      CloudAccountRecommendationPlan.filterGroups({
        groups: groups,
        filterState: {
          searchText: "no such cluster",
          status: RecommendationStatusFilter.All,
          severity: RecommendationSeverityFilter.All,
        },
      }),
    ).toEqual([]);
  });
});
