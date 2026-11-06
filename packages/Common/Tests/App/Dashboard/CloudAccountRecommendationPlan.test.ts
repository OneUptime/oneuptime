import { describe, expect, test } from "@jest/globals";
import CloudAccountRecommendationPlan, {
  CloudAccountRecommendationGapReason,
  CloudAccountRecommendationGaps,
  CloudAccountRecommendationGroup,
  CloudAccountRecommendationPlanItem,
  CloudAccountRecommendationResource,
  CloudAccountRecommendationRow,
  CloudAccountRecommendationTarget,
  getCloudAccountRecommendationArgs,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Recommendations/CloudAccountRecommendationPlan";
import { readCloudResourceRecommendationContext } from "../../../../App/FeatureSet/Dashboard/src/Components/Recommendations/RecommendationResourceRegistry";
import {
  RecommendationSeverityFilter,
  RecommendationStatus,
  RecommendationStatusFilter,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Recommendations/RecommendationViewModel";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import RecommendationDismissal from "../../../Models/DatabaseModels/RecommendationDismissal";
import { CLOUD_ALERT_MONITORING_INTERVAL } from "../../../Types/Monitor/CloudAlertTemplates";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../Types/Monitor/MonitorType";
import MonitorRecommendationCatalog from "../../../Types/Monitor/Recommendation/MonitorRecommendationCatalog";
import {
  MonitorRecommendation,
  MonitorRecommendationNotificationMode,
  MonitorRecommendationResourceType,
} from "../../../Types/Monitor/Recommendation/MonitorRecommendationTypes";
import ObjectID from "../../../Types/ObjectID";

/*
 * What a cloud account's Recommendations page is worked out from
 * (CloudAccountRecommendationPlan): each resource's recommendations, built
 * from what its own row says, joined by recommendation into a row per
 * resource type; which of them a monitor covers already and which the team
 * dismissed, per resource; the resources it leaves out and why; what one
 * Add creates; what the toolbar counts and filters. React-free, so held
 * here without a renderer.
 */

const AWS_ACCOUNT: string = "123456789012";

function uuid(number: number): string {
  return `40000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
}

function attributes(
  namespace: string,
  dimensions: Record<string, string>,
): Record<string, string> {
  const values: Record<string, string> = {
    Namespace: namespace,
    "resource.cloud.account.id": AWS_ACCOUNT,
    "resource.cloud.region": "us-east-1",
  };

  for (const [name, value] of Object.entries(dimensions)) {
    values[`Dimensions.${name}`] = value;
  }

  return values;
}

function resource(data: {
  id: number;
  name: string;
  provider?: string;
  type: string;
  attributes?: Record<string, string>;
  properties?: Record<string, unknown>;
  readings?: Record<string, unknown>;
  connection?: string | undefined;
}): CloudAccountRecommendationResource {
  const resourceId: string = uuid(data.id);

  return {
    resourceId: resourceId,
    resourceName: data.name,
    context: readCloudResourceRecommendationContext({
      cloudProvider: data.provider || "aws",
      cloudResourceType: data.type,
      telemetryAttributes: data.attributes || {},
      cloudProperties: data.properties || {},
      cloudReadings: data.readings || {},
      cloudConnectionId: data.connection,
    }),
  };
}

const WEB_1: CloudAccountRecommendationResource = resource({
  id: 1,
  name: "web-1",
  type: "AWS::EC2::Instance",
  attributes: attributes("AWS/EC2", { InstanceId: "i-1" }),
});
const WEB_2: CloudAccountRecommendationResource = resource({
  id: 2,
  name: "web-2",
  type: "AWS::EC2::Instance",
  attributes: attributes("AWS/EC2", { InstanceId: "i-2" }),
});
const WEB_3: CloudAccountRecommendationResource = resource({
  id: 3,
  name: "web-3",
  type: "AWS::EC2::Instance",
});
const CHECKOUT: CloudAccountRecommendationResource = resource({
  id: 4,
  name: "checkout",
  type: "AWS::Lambda::Function",
  attributes: attributes("AWS/Lambda", { FunctionName: "checkout" }),
});
const ORDERS_DB: CloudAccountRecommendationResource = resource({
  id: 5,
  name: "orders-db",
  type: "AWS::RDS::DBInstance",
  attributes: attributes("AWS/RDS", { DBInstanceIdentifier: "orders-db" }),
  properties: { AllocatedStorage: 200 },
});
const PROD_VPC: CloudAccountRecommendationResource = resource({
  id: 6,
  name: "prod-vpc",
  type: "AWS::EC2::VPC",
});
const EDGE_NLB: CloudAccountRecommendationResource = resource({
  id: 7,
  name: "edge-nlb",
  type: "AWS::ElasticLoadBalancingV2::LoadBalancer",
  attributes: attributes("AWS/NetworkELB", { LoadBalancer: "net/edge/1" }),
});
const AZURE_SQL: CloudAccountRecommendationResource = resource({
  id: 8,
  name: "orders-sql",
  provider: "azure",
  type: "Microsoft.Sql/servers/databases",
  attributes: { "azuremonitor.resource_id": "/subscriptions/x/orders" },
  // Read by a connection, before readings kept their stored names.
  readings: { storage_percent: { value: 12, time: "2026-11-02T12:00:00Z" } },
  connection: "20000000-0000-4000-8000-000000000001",
});

const ALL: Array<CloudAccountRecommendationResource> = [
  WEB_2,
  CHECKOUT,
  WEB_1,
  WEB_3,
  ORDERS_DB,
  PROD_VPC,
  EDGE_NLB,
  AZURE_SQL,
];

// A monitor made from one recommendation of a resource, as the page makes it.
function monitorOf(
  target: CloudAccountRecommendationResource,
  templateId: string,
): { monitorId: ObjectID; monitorSteps: Array<MonitorStep> } {
  const recommendation: MonitorRecommendation =
    MonitorRecommendationCatalog.getRecommendations(
      MonitorRecommendationResourceType.CloudResource,
      target.context,
    ).find((candidate: MonitorRecommendation): boolean => {
      return candidate.templateId === templateId;
    })!;
  const placeholder: ObjectID = ObjectID.getZeroObjectID();

  return {
    monitorId: ObjectID.generate(),
    monitorSteps: [
      recommendation.getMonitorStep(
        getCloudAccountRecommendationArgs({
          resource: target,
          defaults: {
            // The project's own ids: the fingerprint holds none of them.
            onlineMonitorStatusId: ObjectID.generate(),
            offlineMonitorStatusId: ObjectID.generate(),
            defaultMonitorStatusId: placeholder,
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
  dismissal.recommendationId = `CloudResource:${templateId}`;
  dismissal.recommendationType = "Monitor";
  dismissal.resourceType = MonitorRecommendationResourceType.CloudResource;
  dismissal.resourceId = new ObjectID(target.resourceId);
  return dismissal;
}

function groupsOf(data: {
  monitors?: Array<{ monitorId: ObjectID; monitorSteps: Array<MonitorStep> }>;
  dismissals?: Array<RecommendationDismissal>;
} = {}): Array<CloudAccountRecommendationGroup> {
  return CloudAccountRecommendationPlan.buildGroups({
    resources: ALL,
    existingMonitors: data.monitors || [],
    dismissals: data.dismissals || [],
  });
}

function groupOf(
  groups: Array<CloudAccountRecommendationGroup>,
  key: string,
): CloudAccountRecommendationGroup {
  return groups.find((group: CloudAccountRecommendationGroup): boolean => {
    return group.key === key;
  })!;
}

function rowOf(
  group: CloudAccountRecommendationGroup,
  templateId: string,
): CloudAccountRecommendationRow {
  return group.rows.find((row: CloudAccountRecommendationRow): boolean => {
    return row.recommendationId === `CloudResource:${templateId}`;
  })!;
}

function namesOf(targets: Array<CloudAccountRecommendationTarget>): Array<string> {
  return targets.map((target: CloudAccountRecommendationTarget): string => {
    return target.resource.resourceName;
  });
}

describe("buildGroups", () => {
  test("a group per resource type offered something, by the name the product gives it", () => {
    const groups: Array<CloudAccountRecommendationGroup> = groupsOf();

    expect(
      groups.map((group: CloudAccountRecommendationGroup): string => {
        return group.label;
      }),
    ).toEqual(["EC2 Instance", "Lambda Function", "RDS DB Instance"]);
    expect(groups[0]!.key).toBe("aws|aws::ec2::instance");
    expect(groups[0]!.provider).toBe("aws");
    expect(groups[0]!.resourceType).toBe("AWS::EC2::Instance");
  });

  test("a group holds the resources offered something, by name - not one waiting for its metrics", () => {
    const ec2: CloudAccountRecommendationGroup = groupOf(
      groupsOf(),
      "aws|aws::ec2::instance",
    );

    expect(
      ec2.resources.map((item: CloudAccountRecommendationResource) => {
        return item.resourceName;
      }),
    ).toEqual(["web-1", "web-2"]);
  });

  test("rows in the order the catalog declares them; each row's resources by name", () => {
    const ec2: CloudAccountRecommendationGroup = groupOf(
      groupsOf(),
      "aws|aws::ec2::instance",
    );

    expect(
      ec2.rows.map((row: CloudAccountRecommendationRow): string => {
        return row.recommendationId;
      }),
    ).toEqual([
      "CloudResource:cloud-aws-ec2-status-check-failed",
      "CloudResource:cloud-aws-ec2-high-cpu",
    ]);
    expect(namesOf(ec2.rows[0]!.targets)).toEqual(["web-1", "web-2"]);
    expect(ec2.rows[0]!.severity).toBe("Critical");
    expect(ec2.rows[0]!.summary).toBe(
      "The instance or the host it runs on fails a status check.",
    );
  });

  test("each target's recommendation is built for its own resource: its monitor reads that resource's metrics", () => {
    const row: CloudAccountRecommendationRow = rowOf(
      groupOf(groupsOf(), "aws|aws::ec2::instance"),
      "cloud-aws-ec2-high-cpu",
    );

    for (const target of row.targets) {
      const step: MonitorStep = target.recommendation.getMonitorStep(
        getCloudAccountRecommendationArgs({
          resource: target.resource,
          defaults: {
            onlineMonitorStatusId: ObjectID.generate(),
            offlineMonitorStatusId: ObjectID.generate(),
            defaultMonitorStatusId: ObjectID.generate(),
            defaultIncidentSeverityId: ObjectID.generate(),
            defaultAlertSeverityId: ObjectID.generate(),
          },
        }),
      );
      const query: Record<string, unknown> = MonitorStep.getMetricsViewConfig(
        step,
      )!.queryConfigs[0] as unknown as Record<string, unknown>;

      expect(
        (query["eventScope"] as Record<string, string>)["cloudResourceId"],
      ).toBe(target.resource.resourceId);
      expect(
        (
          (query["metricQueryData"] as Record<string, unknown>)[
            "filterData"
          ] as Record<string, Record<string, string>>
        )["attributes"]!["Dimensions.InstanceId"],
      ).toBe(target.resource.resourceName === "web-1" ? "i-1" : "i-2");
    }
  });

  test("a monitor covers its own resource's recommendation, never another's", () => {
    const groups: Array<CloudAccountRecommendationGroup> = groupsOf({
      monitors: [monitorOf(WEB_1, "cloud-aws-ec2-high-cpu")],
    });
    const row: CloudAccountRecommendationRow = rowOf(
      groupOf(groups, "aws|aws::ec2::instance"),
      "cloud-aws-ec2-high-cpu",
    );

    expect(
      row.targets.map((target: CloudAccountRecommendationTarget) => {
        return [target.resource.resourceName, target.status];
      }),
    ).toEqual([
      ["web-1", RecommendationStatus.Created],
      ["web-2", RecommendationStatus.Available],
    ]);
    expect(row.targets[0]!.monitorId).toBeDefined();
    expect(row.counts).toEqual({
      total: 2,
      available: 1,
      created: 1,
      dismissed: 0,
    });
  });

  test("a dismissal on a resource's tab dismisses it for that resource only", () => {
    const groups: Array<CloudAccountRecommendationGroup> = groupsOf({
      dismissals: [dismissalOf(WEB_2, "cloud-aws-ec2-status-check-failed")],
    });
    const row: CloudAccountRecommendationRow = rowOf(
      groupOf(groups, "aws|aws::ec2::instance"),
      "cloud-aws-ec2-status-check-failed",
    );

    expect(
      row.targets.map((target: CloudAccountRecommendationTarget) => {
        return [target.resource.resourceName, target.status];
      }),
    ).toEqual([
      ["web-1", RecommendationStatus.Available],
      ["web-2", RecommendationStatus.Dismissed],
    ]);
  });

  test("an RDS instance whose inventory lists its storage has Low Free Storage; the group adds up its rows", () => {
    const rds: CloudAccountRecommendationGroup = groupOf(
      groupsOf(),
      "aws|aws::rds::dbinstance",
    );

    expect(
      rds.rows.map((row: CloudAccountRecommendationRow): string => {
        return row.recommendationId;
      }),
    ).toEqual([
      "CloudResource:cloud-aws-rds-high-cpu",
      "CloudResource:cloud-aws-rds-low-storage",
    ]);
    expect(rds.counts).toEqual({
      total: 2,
      available: 2,
      created: 0,
      dismissed: 0,
    });
  });
});

describe("getGaps", () => {
  test("names each left-out resource, by name, with why", () => {
    const groups: Array<CloudAccountRecommendationGroup> = groupsOf();
    const gaps: CloudAccountRecommendationGaps =
      CloudAccountRecommendationPlan.getGaps({ resources: ALL, groups });

    expect(
      gaps.gaps.map((gap: { resource: CloudAccountRecommendationResource; reason: string }) => {
        return [gap.resource.resourceName, gap.reason];
      }),
    ).toEqual([
      ["edge-nlb", CloudAccountRecommendationGapReason.Unsupported],
      ["orders-sql", CloudAccountRecommendationGapReason.NextRead],
      ["prod-vpc", CloudAccountRecommendationGapReason.Unsupported],
      ["web-3", CloudAccountRecommendationGapReason.NoMetrics],
    ]);
    expect(
      gaps.byReason[CloudAccountRecommendationGapReason.Unsupported].map(
        (gap: { typeLabel: string }) => {
          return gap.typeLabel;
        },
      ),
    ).toEqual(["Elastic Load Balancer (ALB, NLB, GWLB)", "VPC"]);
  });

  test("an account whose every resource is offered something leaves none out", () => {
    const resources: Array<CloudAccountRecommendationResource> = [
      WEB_1,
      CHECKOUT,
    ];
    const groups: Array<CloudAccountRecommendationGroup> =
      CloudAccountRecommendationPlan.buildGroups({
        resources,
        existingMonitors: [],
        dismissals: [],
      });

    expect(
      CloudAccountRecommendationPlan.getGaps({ resources, groups }).gaps,
    ).toEqual([]);
  });

  test("why: a type with none, metrics not arrived, an Azure read to come, metrics no template reads", () => {
    expect(
      CloudAccountRecommendationPlan.getGapReason(PROD_VPC.context),
    ).toBe(CloudAccountRecommendationGapReason.Unsupported);
    expect(CloudAccountRecommendationPlan.getGapReason(WEB_3.context)).toBe(
      CloudAccountRecommendationGapReason.NoMetrics,
    );
    expect(
      CloudAccountRecommendationPlan.getGapReason(AZURE_SQL.context),
    ).toBe(CloudAccountRecommendationGapReason.NextRead);
    expect(
      CloudAccountRecommendationPlan.getGapReason(EDGE_NLB.context),
    ).toBe(CloudAccountRecommendationGapReason.Unsupported);
  });
});

describe("what one Add creates", () => {
  const DEFAULTS: {
    onlineMonitorStatusId: ObjectID;
    offlineMonitorStatusId: ObjectID;
    defaultMonitorStatusId: ObjectID;
    defaultIncidentSeverityId: ObjectID;
    defaultAlertSeverityId: ObjectID;
  } = {
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
  };

  test("the targets still to set up of a row, or of every row of a group", () => {
    const groups: Array<CloudAccountRecommendationGroup> = groupsOf({
      monitors: [monitorOf(WEB_1, "cloud-aws-ec2-high-cpu")],
    });
    const ec2: CloudAccountRecommendationGroup = groupOf(
      groups,
      "aws|aws::ec2::instance",
    );

    expect(
      namesOf(
        CloudAccountRecommendationPlan.getAvailableTargets(
          rowOf(ec2, "cloud-aws-ec2-high-cpu"),
        ),
      ),
    ).toEqual(["web-2"]);
    expect(
      namesOf(CloudAccountRecommendationPlan.getAvailableTargets(ec2)),
    ).toEqual(["web-1", "web-2", "web-2"]);
  });

  test("a monitor per target, named after its resource, every five minutes, linked to its resource", () => {
    const ec2: CloudAccountRecommendationGroup = groupOf(
      groupsOf(),
      "aws|aws::ec2::instance",
    );
    const plan: Array<CloudAccountRecommendationPlanItem> =
      CloudAccountRecommendationPlan.buildCreatePlan({
        targets: CloudAccountRecommendationPlan.getAvailableTargets(
          rowOf(ec2, "cloud-aws-ec2-status-check-failed"),
        ),
        defaults: DEFAULTS,
        notificationSettings: {
          notificationMode: MonitorRecommendationNotificationMode.Alert,
          labelIds: [new ObjectID("72000000-0000-4000-8000-000000000001")],
        },
      });

    expect(
      plan.map((item: CloudAccountRecommendationPlanItem): string => {
        return CloudAccountRecommendationPlan.getPlanItemName(item);
      }),
    ).toEqual(["web-1 - Status Checks Failing", "web-2 - Status Checks Failing"]);

    for (const item of plan) {
      const monitor: Monitor = item.monitor;
      expect(monitor.monitorType).toBe(MonitorType.Metrics);
      expect(monitor.monitoringInterval).toBe(CLOUD_ALERT_MONITORING_INTERVAL);
      expect(
        (monitor.cloudResources || []).map((cloud: CloudResource) => {
          return cloud.id?.toString();
        }),
      ).toEqual([item.target.resource.resourceId]);
      // The person's notification settings, on every monitor of the batch.
      expect(JSON.stringify(item.miscDataProps)).toBe(
        JSON.stringify(plan[0]!.miscDataProps),
      );
    }
  });

  test("a target created or dismissed since the page read it is left out", () => {
    const ec2: CloudAccountRecommendationGroup = groupOf(
      groupsOf({
        monitors: [monitorOf(WEB_1, "cloud-aws-ec2-high-cpu")],
        dismissals: [dismissalOf(WEB_2, "cloud-aws-ec2-high-cpu")],
      }),
      "aws|aws::ec2::instance",
    );

    expect(
      CloudAccountRecommendationPlan.buildCreatePlan({
        targets: rowOf(ec2, "cloud-aws-ec2-high-cpu").targets,
        defaults: DEFAULTS,
        notificationSettings: {},
      }),
    ).toEqual([]);
  });
});

describe("the toolbar's counts and filters", () => {
  test("one count per recommendation of each resource, by severity of what is still to set up", () => {
    const groups: Array<CloudAccountRecommendationGroup> = groupsOf({
      monitors: [monitorOf(WEB_1, "cloud-aws-ec2-status-check-failed")],
      dismissals: [dismissalOf(ORDERS_DB, "cloud-aws-rds-low-storage")],
    });

    expect(CloudAccountRecommendationPlan.getToolbarCounts(groups)).toEqual({
      // EC2: 2 x 2; Lambda: 2; RDS: 2.
      total: 8,
      available: 6,
      created: 1,
      dismissed: 1,
      // web-2's Status Checks Failing is the one Critical left.
      availableCritical: 1,
      availableWarning: 5,
    });
    expect(CloudAccountRecommendationPlan.getCounts(groups)).toEqual({
      total: 8,
      available: 6,
      created: 1,
      dismissed: 1,
    });
  });

  test("a row is in a status when one of its resources is", () => {
    const groups: Array<CloudAccountRecommendationGroup> = groupsOf({
      monitors: [monitorOf(WEB_1, "cloud-aws-ec2-status-check-failed")],
      dismissals: [dismissalOf(ORDERS_DB, "cloud-aws-rds-low-storage")],
    });

    function rowsFor(status: RecommendationStatusFilter): Array<string> {
      return CloudAccountRecommendationPlan.filterGroups({
        groups,
        filterState: {
          searchText: "",
          status,
          severity: RecommendationSeverityFilter.All,
        },
      }).flatMap((group: CloudAccountRecommendationGroup) => {
        return group.rows.map((row: CloudAccountRecommendationRow): string => {
          return row.recommendationId;
        });
      });
    }

    expect(rowsFor(RecommendationStatusFilter.Created)).toEqual([
      "CloudResource:cloud-aws-ec2-status-check-failed",
    ]);
    expect(rowsFor(RecommendationStatusFilter.Dismissed)).toEqual([
      "CloudResource:cloud-aws-rds-low-storage",
    ]);
    // Status Checks Failing has web-2 still to set up.
    expect(rowsFor(RecommendationStatusFilter.Available)).toContain(
      "CloudResource:cloud-aws-ec2-status-check-failed",
    );
    expect(rowsFor(RecommendationStatusFilter.Available)).not.toContain(
      "CloudResource:cloud-aws-rds-low-storage",
    );
    expect(rowsFor(RecommendationStatusFilter.All)).toHaveLength(6);
  });

  test("a group with no row left is left out; severity filters rows", () => {
    const critical: Array<CloudAccountRecommendationGroup> =
      CloudAccountRecommendationPlan.filterGroups({
        groups: groupsOf(),
        filterState: {
          searchText: "",
          status: RecommendationStatusFilter.All,
          severity: RecommendationSeverityFilter.Critical,
        },
      });

    expect(
      critical.map((group: CloudAccountRecommendationGroup): string => {
        return group.label;
      }),
    ).toEqual(["EC2 Instance"]);
    expect(critical[0]!.rows).toHaveLength(1);
  });

  test("search finds a row by its name, its words, its type and the names of its resources", () => {
    function found(searchText: string): Array<string> {
      return CloudAccountRecommendationPlan.filterGroups({
        groups: groupsOf(),
        filterState: {
          searchText,
          status: RecommendationStatusFilter.All,
          severity: RecommendationSeverityFilter.All,
        },
      }).flatMap((group: CloudAccountRecommendationGroup) => {
        return group.rows.map((row: CloudAccountRecommendationRow): string => {
          return row.name;
        });
      });
    }

    expect(found("throttled")).toEqual(["Function Throttled"]);
    expect(found("  STATUS check ")).toEqual(["Status Checks Failing"]);
    expect(found("lambda")).toEqual(["Function Errors", "Function Throttled"]);
    expect(found("orders-db")).toEqual(["High CPU", "Low Free Storage"]);
    expect(found("no such thing")).toEqual([]);
  });
});
