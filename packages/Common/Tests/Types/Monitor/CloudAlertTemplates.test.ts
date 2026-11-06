import "../../Server/TestingUtils/Init";
import { describe, expect, test } from "@jest/globals";
import MetricMonitorCriteria from "../../../Server/Utils/Monitor/Criteria/MetricMonitorCriteria";
import AggregateModel from "../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import {
  AWS_CLOUDWATCH_RESOURCE_RULES,
  AwsCloudWatchResourceRule,
  GCP_MONITORED_RESOURCE_RULES,
  getCloudResourceTypeDescriptor,
} from "../../../Types/Cloud/CloudResourceCatalog";
import {
  AwsKeyMetric,
  GCP_KEY_METRICS,
  GcpKeyMetric,
  GcpTypeKeyMetrics,
  getAzureKeyMetrics,
} from "../../../Types/Cloud/CloudKeyMetrics";
import {
  CLOUD_AVAILABILITY_LOW_PERCENT,
  CLOUD_BACKLOG_AGE_SECONDS,
  CLOUD_CPU_HIGH_PERCENT,
  CLOUD_FAILED_SHARE_WARNING_PERCENT,
  CLOUD_HEALTH_MIN_REQUESTS,
  CLOUD_MEMORY_HIGH_PERCENT,
  CLOUD_STORAGE_HIGH_PERCENT,
  CloudResourceReadings,
  getCloudReadingKey,
} from "../../../Types/Cloud/CloudResourceHealth";
import {
  AWS_CLOUDWATCH_NAMESPACE_ATTRIBUTE,
  GCP_RESOURCE_TYPE_ATTRIBUTE,
} from "../../../Types/Cloud/CloudMonitoredResource";
import Dictionary from "../../../Types/Dictionary";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import MetricFormulaConfigData from "../../../Types/Metrics/MetricFormulaConfigData";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MetricsViewConfig from "../../../Types/Metrics/MetricsViewConfig";
import {
  CLOUD_ALERT_MONITORING_INTERVAL,
  CLOUD_ALERT_WINDOWS,
  CLOUD_COMPUTE_CPU_HIGH_PERCENT,
  CLOUD_RDS_FREE_STORAGE_LOW_PERCENT,
  CloudAlertMetric,
  CloudAlertQuery,
  CloudAlertTemplate,
  CloudAlertTemplateArgs,
  getAllCloudAlertTemplates,
  getAwsKeyMetricOf,
  getCloudAlertMetricReadingKey,
  getCloudAlertStoredMetricName,
  getCloudAlertTemplate,
  getCloudAlertTemplateReadingKeys,
  getCloudAlertTemplatesFor,
  getCloudAlertTemplatesForType,
  getCloudMonitoringServiceName,
  getCloudResourceTypesWithAlertTemplates,
  readAllocatedStorageGiB,
  readCloudTelemetryAttributes,
} from "../../../Types/Monitor/CloudAlertTemplates";
import {
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
  NoDataPolicy,
} from "../../../Types/Monitor/CriteriaFilter";
import MetricMonitorResponse from "../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import { MonitorStepMetricMonitorUtil } from "../../../Types/Monitor/MonitorStepMetricMonitor";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import RollingTime from "../../../Types/RollingTime/RollingTime";
import RollingTimeUtil from "../../../Types/RollingTime/RollingTimeUtil";
import MetricFormulaEvaluator from "../../../Utils/Metrics/MetricFormulaEvaluator";
import MetricWholeWindow from "../../../Utils/Metrics/MetricWholeWindow";

/*
 * THE MONITORS ONEUPTIME RECOMMENDS FOR A CLOUD RESOURCE
 * (Types/Monitor/CloudAlertTemplates).
 *
 * Three things are held here:
 *
 *   - the library: one template per thing people most need to be told
 *     about on each kind of resource, each reading only metrics its cloud's
 *     connection already reads (CloudKeyMetrics), by the name and the
 *     attributes they are stored under, on the health rules' thresholds;
 *   - which templates one resource is offered, from what its row says;
 *   - what each kind of template decides, through the criteria evaluator
 *     the telemetry worker runs, on data shaped as each connection writes
 *     it: a read-only AWS account's five-minute periods, 15 to 30 minutes
 *     late; a streamed account's minutes; Azure's and Google Cloud's
 *     minutes. A count and a share of counts are read whole
 *     (aggregatesWholeWindow), so both AWS connections read the same
 *     total and the same share.
 */

const RESOURCE_ID: string = "6f1c4f2a-0c1e-4a43-9a3b-2c1d6c1a7b10";

const EC2_ATTRIBUTES: Dictionary<string> = {
  [AWS_CLOUDWATCH_NAMESPACE_ATTRIBUTE]: "AWS/EC2",
  "Dimensions.InstanceId": "i-0abc123def",
  "resource.cloud.account.id": "123456789012",
  "resource.cloud.region": "eu-west-1",
};

const LAMBDA_ATTRIBUTES: Dictionary<string> = {
  [AWS_CLOUDWATCH_NAMESPACE_ATTRIBUTE]: "AWS/Lambda",
  "Dimensions.FunctionName": "checkout-worker",
  "resource.cloud.account.id": "123456789012",
  "resource.cloud.region": "eu-west-1",
};

const ALB_ATTRIBUTES: Dictionary<string> = {
  [AWS_CLOUDWATCH_NAMESPACE_ATTRIBUTE]: "AWS/ApplicationELB",
  "Dimensions.LoadBalancer": "app/web/0123456789abcdef",
  "resource.cloud.account.id": "123456789012",
  "resource.cloud.region": "eu-west-1",
};

const NLB_ATTRIBUTES: Dictionary<string> = {
  [AWS_CLOUDWATCH_NAMESPACE_ATTRIBUTE]: "AWS/NetworkELB",
  "Dimensions.LoadBalancer": "net/edge/0123456789abcdef",
  "resource.cloud.account.id": "123456789012",
  "resource.cloud.region": "eu-west-1",
};

const RDS_ATTRIBUTES: Dictionary<string> = {
  [AWS_CLOUDWATCH_NAMESPACE_ATTRIBUTE]: "AWS/RDS",
  "Dimensions.DBInstanceIdentifier": "orders-db",
  "resource.cloud.account.id": "123456789012",
  "resource.cloud.region": "eu-west-1",
};

const SQS_ATTRIBUTES: Dictionary<string> = {
  [AWS_CLOUDWATCH_NAMESPACE_ATTRIBUTE]: "AWS/SQS",
  "Dimensions.QueueName": "orders",
  "resource.cloud.account.id": "123456789012",
  "resource.cloud.region": "eu-west-1",
};

const AZURE_SQL_ID: string =
  "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/rg-prod/providers/Microsoft.Sql/servers/sql-prod/databases/orders";

const AZURE_SQL_ATTRIBUTES: Dictionary<string> = {
  "azuremonitor.resource_id": AZURE_SQL_ID,
};

const AZURE_VM_ATTRIBUTES: Dictionary<string> = {
  "azuremonitor.resource_id":
    "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/rg-prod/providers/Microsoft.Compute/virtualMachines/vm-prod-01",
};

const GCE_ATTRIBUTES: Dictionary<string> = {
  [GCP_RESOURCE_TYPE_ATTRIBUTE]: "gce_instance",
  "resource.project_id": "shop-prod",
  "resource.instance_id": "1234567890123456789",
  "resource.zone": "europe-west1-b",
};

const PUBSUB_ATTRIBUTES: Dictionary<string> = {
  [GCP_RESOURCE_TYPE_ATTRIBUTE]: "pubsub_subscription",
  "resource.project_id": "shop-prod",
  "resource.subscription_id": "orders-worker",
};

function template(id: string): CloudAlertTemplate {
  const found: CloudAlertTemplate | undefined = getCloudAlertTemplate(id);

  if (!found) {
    throw new Error(`No cloud alert template ${id}`);
  }

  return found;
}

function argsFor(
  attributes: Dictionary<string>,
  overrides: Partial<CloudAlertTemplateArgs> = {},
): CloudAlertTemplateArgs {
  return {
    cloudResourceId: RESOURCE_ID,
    telemetryAttributes: attributes,
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "orders",
    ...overrides,
  };
}

function viewConfigOf(step: MonitorStep): MetricsViewConfig {
  return MonitorStep.getMetricsViewConfig(step)!;
}

function instancesOf(step: MonitorStep): Array<MonitorCriteriaInstance> {
  return step.data!.monitorCriteria.data!.monitorCriteriaInstanceArray;
}

// The resource attributes a template's resource reports its metrics under.
const ATTRIBUTES_BY_PROVIDER: Record<CloudProvider, Dictionary<string>> = {
  [CloudProvider.AWS]: EC2_ATTRIBUTES,
  [CloudProvider.Azure]: AZURE_VM_ATTRIBUTES,
  [CloudProvider.GCP]: GCE_ATTRIBUTES,
};

function attributesFor(cloudTemplate: CloudAlertTemplate): Dictionary<string> {
  if (cloudTemplate.provider !== CloudProvider.AWS) {
    return ATTRIBUTES_BY_PROVIDER[cloudTemplate.provider];
  }

  // An AWS resource's namespace is its template's: the template reads it.
  return {
    ...EC2_ATTRIBUTES,
    [AWS_CLOUDWATCH_NAMESPACE_ATTRIBUTE]:
      cloudTemplate.queries[0]!.metric.namespace || "",
  };
}

function stepOf(cloudTemplate: CloudAlertTemplate): MonitorStep {
  return cloudTemplate.getMonitorStep(
    argsFor(attributesFor(cloudTemplate), { allocatedStorageGiB: 100 }),
  );
}

// ---------------------------------------------------------------------------
// The library
// ---------------------------------------------------------------------------

const ALL: Array<CloudAlertTemplate> = getAllCloudAlertTemplates();

describe("the cloud alert template library", () => {
  test("holds templates for each cloud", () => {
    const byProvider: Record<string, number> = {};

    for (const cloudTemplate of ALL) {
      byProvider[cloudTemplate.provider] =
        (byProvider[cloudTemplate.provider] || 0) + 1;
    }

    expect(byProvider[CloudProvider.AWS]).toBeGreaterThanOrEqual(30);
    expect(byProvider[CloudProvider.Azure]).toBeGreaterThanOrEqual(30);
    expect(byProvider[CloudProvider.GCP]).toBeGreaterThanOrEqual(8);
  });

  test("ids are unique, stable in shape and found by getCloudAlertTemplate", () => {
    const ids: Array<string> = ALL.map((cloudTemplate: CloudAlertTemplate) => {
      return cloudTemplate.id;
    });

    expect(new Set<string>(ids).size).toBe(ids.length);

    for (const cloudTemplate of ALL) {
      expect(cloudTemplate.id).toMatch(
        new RegExp(`^cloud-${cloudTemplate.provider}-[a-z0-9-]+$`),
      );
      expect(getCloudAlertTemplate(cloudTemplate.id)).toBe(cloudTemplate);
    }

    expect(getCloudAlertTemplate("cloud-aws-no-such-template")).toBeUndefined();
  });

  test.each(ALL.map((cloudTemplate: CloudAlertTemplate) => {
    return [cloudTemplate.id, cloudTemplate];
  }))(
    "%s is a Metrics monitor on its cloud's window, every five minutes",
    (_id: string, cloudTemplate: CloudAlertTemplate) => {
      expect(cloudTemplate.monitorType).toBe(MonitorType.Metrics);
      expect(cloudTemplate.rollingTime).toBe(
        CLOUD_ALERT_WINDOWS[cloudTemplate.provider],
      );
      expect(cloudTemplate.monitoringInterval).toBe(
        CLOUD_ALERT_MONITORING_INTERVAL,
      );
      expect(cloudTemplate.isBetterStreamed).toBe(
        cloudTemplate.provider === CloudProvider.AWS,
      );
      expect(cloudTemplate.name.trim().length).toBeGreaterThan(0);
      expect(cloudTemplate.summary.trim().length).toBeGreaterThan(0);
      expect(cloudTemplate.summary.length).toBeLessThanOrEqual(90);
      expect(cloudTemplate.incidentDescription.trim().length).toBeGreaterThan(
        40,
      );
      expect(cloudTemplate.resourceTypes.length).toBeGreaterThan(0);
    },
  );

  test("AWS reads 30 minutes, Azure and Google Cloud 15, each every five minutes", () => {
    expect(CLOUD_ALERT_WINDOWS[CloudProvider.AWS]).toBe(
      RollingTime.Past30Minutes,
    );
    expect(CLOUD_ALERT_WINDOWS[CloudProvider.Azure]).toBe(
      RollingTime.Past15Minutes,
    );
    expect(CLOUD_ALERT_WINDOWS[CloudProvider.GCP]).toBe(
      RollingTime.Past15Minutes,
    );
    expect(CLOUD_ALERT_MONITORING_INTERVAL).toBe("*/5 * * * *");
  });

  test("every description says where its numbers come from", () => {
    const sources: Record<CloudProvider, string> = {
      [CloudProvider.AWS]:
        "Read from Amazon CloudWatch by the account's connection, or streamed through Amazon Data Firehose.",
      [CloudProvider.Azure]:
        "Read from Azure Monitor by the subscription's connection.",
      [CloudProvider.GCP]:
        "Read from Google Cloud Monitoring by the project's connection.",
    };

    for (const cloudTemplate of ALL) {
      expect(cloudTemplate.description).toContain(
        sources[cloudTemplate.provider],
      );
    }

    expect(getCloudMonitoringServiceName("aws")).toBe("Amazon CloudWatch");
    expect(getCloudMonitoringServiceName("Azure")).toBe("Azure Monitor");
    expect(getCloudMonitoringServiceName(" gcp ")).toBe(
      "Google Cloud Monitoring",
    );
    expect(getCloudMonitoringServiceName("oracle")).toBeUndefined();
    expect(getCloudMonitoringServiceName(undefined)).toBeUndefined();
  });

  test("every resource type a template is for is one the catalog lists, for its cloud", () => {
    for (const cloudTemplate of ALL) {
      for (const type of cloudTemplate.resourceTypes) {
        expect(
          `${cloudTemplate.id} ${type}: ${Boolean(
            getCloudResourceTypeDescriptor(cloudTemplate.provider, type),
          )}`,
        ).toBe(`${cloudTemplate.id} ${type}: true`);
      }
    }
  });

  test("an AWS template reads a key metric of its resource types' own namespace, with its statistic", () => {
    for (const cloudTemplate of ALL.filter((candidate: CloudAlertTemplate) => {
      return candidate.provider === CloudProvider.AWS;
    })) {
      for (const query of cloudTemplate.queries) {
        const namespace: string = query.metric.namespace || "";
        const keyMetric: AwsKeyMetric | undefined = getAwsKeyMetricOf(
          namespace,
          query.metric.metricName,
        );

        // A connection reads it: the monitor costs no call to the cloud.
        expect(`${cloudTemplate.id} ${namespace} ${query.metric.metricName}: ${Boolean(keyMetric)}`).toBe(
          `${cloudTemplate.id} ${namespace} ${query.metric.metricName}: true`,
        );

        const statisticAggregation: Record<string, AggregationType> = {
          Average: AggregationType.Avg,
          Sum: AggregationType.Sum,
          Maximum: AggregationType.Max,
          Minimum: AggregationType.Min,
        };

        expect(query.metric.aggregationType).toBe(
          statisticAggregation[keyMetric!.statistic],
        );

        // Each of its resource types is discovered from that namespace.
        for (const type of cloudTemplate.resourceTypes) {
          const namespaces: Array<string> = AWS_CLOUDWATCH_RESOURCE_RULES.filter(
            (rule: AwsCloudWatchResourceRule): boolean => {
              return rule.type === type;
            },
          ).map((rule: AwsCloudWatchResourceRule): string => {
            return rule.namespace;
          });

          expect(namespaces).toContain(namespace);
        }
      }
    }
  });

  test("an Azure template reads a key metric of each of its resource types", () => {
    for (const cloudTemplate of ALL.filter((candidate: CloudAlertTemplate) => {
      return candidate.provider === CloudProvider.Azure;
    })) {
      for (const query of cloudTemplate.queries) {
        for (const type of cloudTemplate.resourceTypes) {
          const metrics: Array<string> =
            getAzureKeyMetrics(type)?.metrics || [];

          expect(`${cloudTemplate.id} ${type}: ${metrics.includes(query.metric.metricName)}`).toBe(
            `${cloudTemplate.id} ${type}: true`,
          );
        }

        expect(query.metric.azureAggregation).toBeTruthy();
      }
    }
  });

  test("a Google Cloud template reads a key metric of its monitored resource type", () => {
    for (const cloudTemplate of ALL.filter((candidate: CloudAlertTemplate) => {
      return candidate.provider === CloudProvider.GCP;
    })) {
      for (const type of cloudTemplate.resourceTypes) {
        const entry: GcpTypeKeyMetrics | undefined = GCP_KEY_METRICS.find(
          (candidate: GcpTypeKeyMetrics): boolean => {
            return candidate.resourceType === type;
          },
        );

        for (const query of cloudTemplate.queries) {
          expect(
            (entry?.metrics || []).some((metric: GcpKeyMetric): boolean => {
              return metric.metricType === query.metric.metricName;
            }),
          ).toBe(true);
        }

        expect(
          GCP_MONITORED_RESOURCE_RULES.some(
            (rule: { type: string }): boolean => {
              return rule.type === type;
            },
          ),
        ).toBe(true);
      }
    }
  });

  test("a count or a share of counts is read whole; nothing else is", () => {
    for (const cloudTemplate of ALL) {
      const step: MonitorStep = stepOf(cloudTemplate);
      const isWhole: boolean =
        cloudTemplate.measure === "total" || cloudTemplate.measure === "share";

      expect(
        `${cloudTemplate.id}: ${MonitorStepMetricMonitorUtil.aggregatesWholeWindow(
          step.data!.metricMonitor,
        )}`,
      ).toBe(`${cloudTemplate.id}: ${isWhole}`);
    }
  });

  /*
   * A Sum metric's points stand for a period: five minutes on a read-only
   * AWS account, one on a streamed one. Compared a point at a time, a
   * threshold on it would read five times less on one than the other, so
   * every template that reads one totals it over the window.
   */
  test("every template that reads a Sum metric totals it over the window", () => {
    for (const cloudTemplate of ALL) {
      const readsSum: boolean = cloudTemplate.queries.some(
        (query: CloudAlertQuery): boolean => {
          return query.metric.aggregationType === AggregationType.Sum;
        },
      );

      if (readsSum) {
        expect(`${cloudTemplate.id}: ${cloudTemplate.measure}`).toMatch(
          /: (total|share)$/,
        );
      }
    }
  });

  test("a level judged a point at a time must hold for the whole window; a broken state, an age and a window read whole fire on a point", () => {
    for (const cloudTemplate of ALL) {
      const step: MonitorStep = stepOf(cloudTemplate);
      const [unhealthy] = instancesOf(step);
      const fires: CriteriaFilter = unhealthy!.data!.filters[0]!;

      expect(fires.metricMonitorOptions?.metricAggregationType).toBe(
        cloudTemplate.measure === "sustained"
          ? EvaluateOverTimeType.AllValues
          : EvaluateOverTimeType.AnyValue,
      );
      expect(fires.metricMonitorOptions?.metricAlias).toBe(
        cloudTemplate.comparedAlias,
      );
    }
  });

  test("thresholds are the health rules' where a rule judges the metric", () => {
    expect(template("cloud-aws-rds-high-cpu").threshold).toBe(
      CLOUD_CPU_HIGH_PERCENT,
    );
    expect(template("cloud-aws-ecs-high-memory").threshold).toBe(
      CLOUD_MEMORY_HIGH_PERCENT,
    );
    expect(template("cloud-azure-sql-storage-full").threshold).toBe(
      CLOUD_STORAGE_HIGH_PERCENT,
    );
    expect(template("cloud-aws-alb-server-errors").threshold).toBe(
      CLOUD_FAILED_SHARE_WARNING_PERCENT,
    );
    expect(template("cloud-aws-alb-server-errors").minimumRequests?.value).toBe(
      CLOUD_HEALTH_MIN_REQUESTS,
    );
    expect(template("cloud-azure-availability-low").threshold).toBe(
      CLOUD_AVAILABILITY_LOW_PERCENT,
    );
    expect(template("cloud-aws-sqs-oldest-message").threshold).toBe(
      CLOUD_BACKLOG_AGE_SECONDS,
    );
    // Kinesis writes its age in milliseconds.
    expect(template("cloud-aws-kinesis-consumers-behind").threshold).toBe(
      CLOUD_BACKLOG_AGE_SECONDS * 1000,
    );
    // Where no rule judges it, an instance's CPU: 90%.
    expect(template("cloud-aws-ec2-high-cpu").threshold).toBe(
      CLOUD_COMPUTE_CPU_HIGH_PERCENT,
    );
    expect(CLOUD_RDS_FREE_STORAGE_LOW_PERCENT).toBe(
      100 - CLOUD_STORAGE_HIGH_PERCENT,
    );
  });

  test("a function's share is judged however few its invocations; every other share once 20 requests came", () => {
    for (const cloudTemplate of ALL.filter((candidate: CloudAlertTemplate) => {
      return candidate.measure === "share";
    })) {
      if (cloudTemplate.id === "cloud-aws-lambda-errors") {
        expect(cloudTemplate.minimumRequests).toBeUndefined();
      } else {
        expect(cloudTemplate.minimumRequests?.value).toBe(
          CLOUD_HEALTH_MIN_REQUESTS,
        );
      }
    }
  });

  /*
   * What the task asked to be watched on each cloud: an instance or VM's
   * status and CPU, a managed database's storage and connections, a load
   * balancer's 5xx and latency, a function's errors and throttles, a
   * queue's oldest message.
   */
  test.each([
    ["an EC2 instance's status checks", "cloud-aws-ec2-status-check-failed"],
    ["an EC2 instance's CPU", "cloud-aws-ec2-high-cpu"],
    ["an Azure VM's availability", "cloud-azure-vm-unavailable"],
    ["an Azure VM's CPU", "cloud-azure-vm-high-cpu"],
    ["a Compute Engine VM's CPU", "cloud-gcp-compute-high-cpu"],
    ["an RDS instance's storage", "cloud-aws-rds-low-storage"],
    ["an Azure SQL database's storage", "cloud-azure-sql-storage-full"],
    ["an Azure SQL database's sessions", "cloud-azure-sql-sessions-high"],
    ["an Azure SQL database's failed connections", "cloud-azure-sql-failed-connections"],
    ["a PostgreSQL flexible server's failed connections", "cloud-azure-postgresql-failed-connections"],
    ["a Cloud SQL instance's disk", "cloud-gcp-cloudsql-disk-full"],
    ["a classic load balancer's 5xx", "cloud-aws-elb-server-errors"],
    ["an application load balancer's 5xx", "cloud-aws-alb-server-errors"],
    ["an application load balancer's latency", "cloud-aws-alb-slow-responses"],
    ["an application gateway's failed requests", "cloud-azure-appgateway-failed-requests"],
    ["a Google Cloud load balancer's latency", "cloud-gcp-lb-slow-responses"],
    ["a Lambda function's errors", "cloud-aws-lambda-errors"],
    ["a Lambda function's throttles", "cloud-aws-lambda-throttles"],
    ["an SQS queue's oldest message", "cloud-aws-sqs-oldest-message"],
    ["a Pub/Sub subscription's oldest message", "cloud-gcp-pubsub-oldest-message"],
  ])("watches %s", (_what: string, id: string) => {
    expect(getCloudAlertTemplate(id)).toBeDefined();
  });

  test("the resource types with templates are listed once each, per cloud", () => {
    const all: Array<string> = getCloudResourceTypesWithAlertTemplates();
    const aws: Array<string> = getCloudResourceTypesWithAlertTemplates(
      CloudProvider.AWS,
    );

    expect(new Set<string>(all).size).toBe(all.length);
    expect(aws).toContain("AWS::EC2::Instance");
    expect(aws).not.toContain("Microsoft.Compute/virtualMachines");
    expect(all).toContain("Microsoft.Compute/virtualMachines");
    expect(all).toContain("gce_instance");
  });
});

// ---------------------------------------------------------------------------
// Which templates one resource is offered
// ---------------------------------------------------------------------------

function idsOf(templates: Array<CloudAlertTemplate>): Array<string> {
  return templates.map((cloudTemplate: CloudAlertTemplate): string => {
    return cloudTemplate.id;
  });
}

describe("getCloudAlertTemplatesFor", () => {
  test("an EC2 instance whose metrics arrived is offered its status checks and CPU", () => {
    expect(
      idsOf(
        getCloudAlertTemplatesFor({
          provider: "aws",
          resourceType: "AWS::EC2::Instance",
          telemetryAttributes: EC2_ATTRIBUTES,
        }),
      ),
    ).toEqual(["cloud-aws-ec2-status-check-failed", "cloud-aws-ec2-high-cpu"]);
  });

  test("nothing before its metrics arrive: a query filtered on nothing would read every resource's", () => {
    for (const attributes of [undefined, null, {}, { Namespace: "  " }]) {
      expect(
        getCloudAlertTemplatesFor({
          provider: "aws",
          resourceType: "AWS::EC2::Instance",
          telemetryAttributes: attributes as Dictionary<string> | null,
        }),
      ).toEqual([]);
    }
  });

  test("nothing for a cloud or a type it does not know", () => {
    expect(
      getCloudAlertTemplatesFor({
        provider: "oracle",
        resourceType: "AWS::EC2::Instance",
        telemetryAttributes: EC2_ATTRIBUTES,
      }),
    ).toEqual([]);
    expect(
      getCloudAlertTemplatesFor({
        provider: "aws",
        resourceType: "AWS::S3::Bucket",
        telemetryAttributes: EC2_ATTRIBUTES,
      }),
    ).toEqual([]);
    expect(
      getCloudAlertTemplatesForType({ provider: "", resourceType: "x" }),
    ).toEqual([]);
  });

  test("the cloud and the type are matched in any case", () => {
    expect(
      idsOf(
        getCloudAlertTemplatesFor({
          provider: "AWS",
          resourceType: "aws::ec2::instance",
          telemetryAttributes: EC2_ATTRIBUTES,
        }),
      ),
    ).toEqual(["cloud-aws-ec2-status-check-failed", "cloud-aws-ec2-high-cpu"]);
  });

  test("an application and a network load balancer are one type: each is offered its own namespace's", () => {
    expect(
      idsOf(
        getCloudAlertTemplatesFor({
          provider: "aws",
          resourceType: "AWS::ElasticLoadBalancingV2::LoadBalancer",
          telemetryAttributes: ALB_ATTRIBUTES,
        }),
      ),
    ).toEqual(["cloud-aws-alb-server-errors", "cloud-aws-alb-slow-responses"]);
    expect(
      getCloudAlertTemplatesFor({
        provider: "aws",
        resourceType: "AWS::ElasticLoadBalancingV2::LoadBalancer",
        telemetryAttributes: NLB_ATTRIBUTES,
      }),
    ).toEqual([]);
  });

  test("an AWS resource whose metrics come in the JSON stream shape is offered nothing: no template reads it", () => {
    expect(
      getCloudAlertTemplatesFor({
        provider: "aws",
        resourceType: "AWS::EC2::Instance",
        telemetryAttributes: {
          "resource.service.name": "EC2",
          "resource.service.namespace": "AWS",
          "service.instance.id": "i-0abc123def",
        },
      }),
    ).toEqual([]);
  });

  test("an RDS instance is offered Low Free Storage once its inventory lists its allocated storage", () => {
    const without: Array<string> = idsOf(
      getCloudAlertTemplatesFor({
        provider: "aws",
        resourceType: "AWS::RDS::DBInstance",
        telemetryAttributes: RDS_ATTRIBUTES,
      }),
    );
    const withStorage: Array<string> = idsOf(
      getCloudAlertTemplatesFor({
        provider: "aws",
        resourceType: "AWS::RDS::DBInstance",
        telemetryAttributes: RDS_ATTRIBUTES,
        allocatedStorageGiB: 200,
      }),
    );

    expect(without).toEqual(["cloud-aws-rds-high-cpu"]);
    expect(withStorage).toEqual([
      "cloud-aws-rds-high-cpu",
      "cloud-aws-rds-low-storage",
    ]);
    // An Aurora cluster has no allocated storage: its storage grows itself.
    expect(
      idsOf(
        getCloudAlertTemplatesFor({
          provider: "aws",
          resourceType: "AWS::RDS::DBCluster",
          telemetryAttributes: RDS_ATTRIBUTES,
          allocatedStorageGiB: 200,
        }),
      ),
    ).toEqual(["cloud-aws-rds-high-cpu"]);
  });

  test("Azure and Google Cloud resources are offered their type's templates", () => {
    expect(
      idsOf(
        getCloudAlertTemplatesFor({
          provider: "azure",
          resourceType: "Microsoft.Sql/servers/databases",
          telemetryAttributes: AZURE_SQL_ATTRIBUTES,
        }),
      ),
    ).toEqual([
      "cloud-azure-sql-storage-full",
      "cloud-azure-sql-high-cpu",
      "cloud-azure-sql-sessions-high",
      "cloud-azure-sql-failed-connections",
      // DTU Usage High waits for a reading: only a DTU database sends it.
      "cloud-azure-sql-deadlocks",
    ]);
    expect(
      idsOf(
        getCloudAlertTemplatesFor({
          provider: "gcp",
          resourceType: "pubsub_subscription",
          telemetryAttributes: PUBSUB_ATTRIBUTES,
        }),
      ),
    ).toEqual(["cloud-gcp-pubsub-oldest-message"]);
  });
});

describe("reading what a resource's row says", () => {
  test("telemetry attributes: only text values, as stored", () => {
    expect(
      readCloudTelemetryAttributes({
        Namespace: "AWS/EC2",
        empty: "",
        blank: "  ",
        count: 3,
        nested: { a: "b" },
      }),
    ).toEqual({ Namespace: "AWS/EC2" });
    expect(readCloudTelemetryAttributes(null)).toEqual({});
    expect(readCloudTelemetryAttributes(["Namespace"])).toEqual({});
    expect(readCloudTelemetryAttributes("Namespace")).toEqual({});
  });

  test("allocated storage: a positive number of GiB, as the inventory lists it", () => {
    expect(readAllocatedStorageGiB({ AllocatedStorage: 200 })).toBe(200);
    expect(readAllocatedStorageGiB({ AllocatedStorage: "50" })).toBe(50);
    expect(readAllocatedStorageGiB({ AllocatedStorage: 0 })).toBeNull();
    expect(readAllocatedStorageGiB({ AllocatedStorage: -1 })).toBeNull();
    expect(readAllocatedStorageGiB({ AllocatedStorage: "" })).toBeNull();
    expect(readAllocatedStorageGiB({ AllocatedStorage: "lots" })).toBeNull();
    expect(readAllocatedStorageGiB({})).toBeNull();
    expect(readAllocatedStorageGiB(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The monitor a template builds
// ---------------------------------------------------------------------------

describe("the monitor a template builds", () => {
  test("every query reads the resource's own metric, by its stored name and attributes, and names the resource", () => {
    for (const cloudTemplate of ALL) {
      const attributes: Dictionary<string> = attributesFor(cloudTemplate);
      const step: MonitorStep = stepOf(cloudTemplate);
      const queries: Array<MetricQueryConfigData> =
        viewConfigOf(step).queryConfigs;

      expect(queries.length).toBe(cloudTemplate.queries.length);

      queries.forEach((query: MetricQueryConfigData, index: number) => {
        const metric: CloudAlertMetric = cloudTemplate.queries[index]!.metric;
        const filterData: MetricQueryConfigData["metricQueryData"]["filterData"] =
          query.metricQueryData.filterData;

        expect(filterData.metricName).toBe(
          getCloudAlertStoredMetricName({ metric: metric }),
        );
        expect(filterData.metricName).toBe(
          String(filterData.metricName).toLowerCase(),
        );
        expect(filterData.attributes).toEqual(attributes);
        expect(filterData.aggegationType).toBe(metric.aggregationType);
        expect(query.eventScope).toEqual({ cloudResourceId: RESOURCE_ID });
        expect(query.metricAliasData?.metricVariable).toBe(
          cloudTemplate.queries[index]!.alias,
        );
      });

      expect(
        (viewConfigOf(step).formulaConfigs || []).length,
      ).toBe(cloudTemplate.formula ? 1 : 0);
    }
  });

  test("the stored names, as each cloud's read writes them", () => {
    expect(
      getCloudAlertStoredMetricName({
        metric: template("cloud-aws-ec2-status-check-failed").queries[0]!
          .metric,
      }),
    ).toBe("amazonaws.com/aws/ec2/statuscheckfailed");
    expect(
      getCloudAlertStoredMetricName({
        metric: template("cloud-azure-vm-high-cpu").queries[0]!.metric,
      }),
    ).toBe("azure_percentage_cpu_average");
    expect(
      getCloudAlertStoredMetricName({
        metric: template("cloud-gcp-compute-high-cpu").queries[0]!.metric,
      }),
    ).toBe("compute.googleapis.com/instance/cpu/utilization");
  });

  /*
   * An Azure metric is stored with the aggregation its definition calls
   * primary, which only the read knows: its reading of the metric says
   * the name, and the documented aggregation stands in until there is one.
   */
  test("an Azure metric is read under the name its own reading was stored with", () => {
    const metric: CloudAlertMetric = template("cloud-azure-sql-storage-full")
      .queries[0]!.metric;
    const key: string = getCloudAlertMetricReadingKey(metric)!;

    expect(key).toBe(getCloudReadingKey(CloudProvider.Azure, "azure_storage_percent_average"));

    const readings: CloudResourceReadings = {
      [key]: {
        value: 42,
        at: "2026-11-02T12:00:00.000Z",
        metric: "azure_storage_percent_maximum",
      },
    } as unknown as CloudResourceReadings;

    expect(getCloudAlertStoredMetricName({ metric: metric, readings })).toBe(
      "azure_storage_percent_maximum",
    );
    expect(getCloudAlertStoredMetricName({ metric: metric })).toBe(
      "azure_storage_percent_average",
    );

    const step: MonitorStep = template("cloud-azure-sql-storage-full").getMonitorStep(
      argsFor(AZURE_SQL_ATTRIBUTES, { readings: readings }),
    );

    expect(
      viewConfigOf(step).queryConfigs[0]!.metricQueryData.filterData.metricName,
    ).toBe("azure_storage_percent_maximum");
  });

  test("an AWS metric's name is fixed: a reading never renames it", () => {
    const metric: CloudAlertMetric = template("cloud-aws-ec2-high-cpu")
      .queries[0]!.metric;

    expect(
      getCloudAlertStoredMetricName({
        metric: metric,
        readings: {
          [getCloudAlertMetricReadingKey(metric)!]: {
            value: 1,
            at: "2026-11-02T12:00:00.000Z",
            metric: "something_else",
          },
        } as unknown as CloudResourceReadings,
      }),
    ).toBe("amazonaws.com/aws/ec2/cpuutilization");
  });

  test("Low Free Storage compares with 10% of the instance's own allocated storage, in bytes", () => {
    const step: MonitorStep = template("cloud-aws-rds-low-storage").getMonitorStep(
      argsFor(RDS_ATTRIBUTES, { allocatedStorageGiB: 200 }),
    );
    const [unhealthy, healthy] = instancesOf(step);
    const fires: CriteriaFilter = unhealthy!.data!.filters[0]!;

    expect(fires.filterType).toBe(FilterType.LessThan);
    expect(Number(fires.value)).toBe(Math.round(200 * 1024 ** 3 * 0.1));
    // Clears above a dead band, never at the line itself.
    expect(Number(healthy!.data!.filters[0]!.value)).toBeGreaterThan(
      Number(fires.value),
    );
  });

  test("incident and alert titles name the resource once", () => {
    const step: MonitorStep = template("cloud-aws-lambda-errors").getMonitorStep(
      argsFor(LAMBDA_ATTRIBUTES, { monitorName: "checkout-worker" }),
    );
    const [unhealthy] = instancesOf(step);

    expect(unhealthy!.data!.incidents[0]!.title).toBe(
      "[Cloud] Function Errors - checkout-worker",
    );
    expect(unhealthy!.data!.alerts[0]!.title).toBe(
      "[Cloud] Function Errors - checkout-worker",
    );
  });

  test("a share needs both its share and its request floor, and clears on either", () => {
    const step: MonitorStep = stepOf(template("cloud-aws-alb-server-errors"));
    const [unhealthy, healthy] = instancesOf(step);

    expect(unhealthy!.data!.filterCondition).toBe(FilterCondition.All);
    expect(
      unhealthy!.data!.filters.map((filter: CriteriaFilter) => {
        return [filter.metricMonitorOptions?.metricAlias, filter.filterType];
      }),
    ).toEqual([
      ["failed_share", FilterType.GreaterThanOrEqualTo],
      ["requests", FilterType.GreaterThanOrEqualTo],
    ]);
    expect(healthy!.data!.filterCondition).toBe(FilterCondition.Any);
  });

  test("a window read whole reads an empty window as zero when it recovers", () => {
    const step: MonitorStep = stepOf(template("cloud-aws-lambda-throttles"));
    const [, healthy] = instancesOf(step);

    expect(healthy!.data!.filters[0]!.metricMonitorOptions?.onNoDataPolicy).toBe(
      NoDataPolicy.TreatAsZero,
    );
  });
});

// ---------------------------------------------------------------------------
// What each kind of template decides
// ---------------------------------------------------------------------------

// The check that is evaluated: 12:30:30 UTC.
const NOW: Date = new Date(Date.UTC(2026, 10, 2, 12, 30, 30));
const MINUTE: number = 60_000;

// A point a connection wrote: when (12:mm UTC) and its value.
interface Point {
  minute: number;
  value: number;
}

function at(minute: number): Date {
  return new Date(Date.UTC(2026, 10, 2, 12, 0, 0) + minute * MINUTE);
}

/*
 * A read-only AWS account's points: one per five-minute CloudWatch period,
 * stamped with its start, the newest 15 minutes old - 12:05, 12:10, 12:15
 * in the 12:00:30 to 12:30:30 window.
 */
function readOnly(values: Array<number>): Array<Point> {
  const newest: number = 15;

  return values.map((value: number, index: number): Point => {
    return { minute: newest - (values.length - 1 - index) * 5, value: value };
  });
}

/*
 * A streamed AWS account's points, and Azure's and Google Cloud's: one a
 * minute, the newest a few minutes old.
 */
function everyMinute(data: {
  from: number;
  to: number;
  value: number | ((minute: number) => number);
}): Array<Point> {
  const points: Array<Point> = [];

  for (let minute: number = data.from; minute <= data.to; minute++) {
    points.push({
      minute: minute,
      value:
        typeof data.value === "function" ? data.value(minute) : data.value,
    });
  }

  return points;
}

function fold(aggregation: AggregationType, values: Array<number>): number {
  switch (aggregation) {
    case AggregationType.Sum:
      return values.reduce((sum: number, value: number) => {
        return sum + value;
      }, 0);
    case AggregationType.Max:
      return Math.max(...values);
    case AggregationType.Min:
      return Math.min(...values);
    default:
      return (
        values.reduce((sum: number, value: number) => {
          return sum + value;
        }, 0) / values.length
      );
  }
}

/*
 * What the telemetry worker hands the criteria evaluator for one of these
 * monitors (monitorMetric): each query's read of the points in its window -
 * a minute bucket per point, or, read whole, one row folded by its
 * aggregation and stamped at the earliest point (as the analytics store
 * does) before MetricWholeWindow stamps it at the window's end and makes an
 * empty count a zero - then the formula over them.
 */
function responseFor(data: {
  step: MonitorStep;
  window: InBetween<Date>;
  pointsByAlias: Record<string, Array<Point>>;
}): MetricMonitorResponse {
  const viewConfig: MetricsViewConfig = viewConfigOf(data.step);
  const wholeWindow: boolean = MonitorStepMetricMonitorUtil.aggregatesWholeWindow(
    data.step.data!.metricMonitor,
  );
  const startMs: number = (data.window.startValue as Date).getTime();
  const endMs: number = (data.window.endValue as Date).getTime();

  const results: Array<AggregatedResult> = viewConfig.queryConfigs.map(
    (query: MetricQueryConfigData): AggregatedResult => {
      const alias: string = query.metricAliasData?.metricVariable || "";
      const aggregation: AggregationType = query.metricQueryData.filterData
        .aggegationType as AggregationType;
      const points: Array<Point> = (data.pointsByAlias[alias] || []).filter(
        (point: Point): boolean => {
          const time: number = at(point.minute).getTime();
          return time >= startMs && time <= endMs;
        },
      );

      if (!wholeWindow) {
        return {
          data: points.map((point: Point): AggregateModel => {
            return { timestamp: at(point.minute), value: point.value };
          }),
        };
      }

      return MetricWholeWindow.toWholeWindowResult({
        result: {
          data:
            points.length === 0
              ? []
              : [
                  {
                    timestamp: at(points[0]!.minute),
                    value: fold(
                      aggregation,
                      points.map((point: Point): number => {
                        return point.value;
                      }),
                    ),
                  },
                ],
        },
        windowEnd: data.window.endValue as Date,
        aggregationType: aggregation,
        isGrouped: false,
      });
    },
  );

  const formulaConfigs: Array<MetricFormulaConfigData> =
    viewConfig.formulaConfigs || [];

  formulaConfigs.forEach(
    (formulaConfig: MetricFormulaConfigData, index: number): void => {
      results.push(
        MetricFormulaEvaluator.evaluateFormula({
          formula: formulaConfig.metricFormulaData.metricFormula,
          queryConfigs: viewConfig.queryConfigs,
          formulaConfigs: formulaConfigs.slice(0, index),
          results: results,
        }),
      );
    },
  );

  return {
    projectId: ObjectID.generate(),
    monitorId: ObjectID.generate(),
    metricViewConfig: viewConfig,
    metricResult: results,
    startAndEndDate: data.window,
  };
}

async function isInstanceMet(
  step: MonitorStep,
  instance: MonitorCriteriaInstance,
  response: MetricMonitorResponse,
): Promise<boolean> {
  const results: Array<boolean> = [];

  for (const filter of instance.data!.filters) {
    results.push(
      (await MetricMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
        dataToProcess: response,
        // A copy: the evaluator writes its context back onto the filter.
        criteriaFilter: JSON.parse(JSON.stringify(filter)) as CriteriaFilter,
        monitorStep: step,
      })) !== null,
    );
  }

  return instance.data!.filterCondition === FilterCondition.All
    ? results.every((met: boolean): boolean => {
        return met;
      })
    : results.some((met: boolean): boolean => {
        return met;
      });
}

interface Outcome {
  breached: boolean;
  healthy: boolean;
}

async function evaluate(data: {
  id: string;
  pointsByAlias: Record<string, Array<Point>>;
  args?: Partial<CloudAlertTemplateArgs> | undefined;
}): Promise<Outcome> {
  const cloudTemplate: CloudAlertTemplate = template(data.id);
  const step: MonitorStep = cloudTemplate.getMonitorStep(
    argsFor(attributesFor(cloudTemplate), {
      allocatedStorageGiB: 100,
      ...(data.args || {}),
    }),
  );
  const window: InBetween<Date> = RollingTimeUtil.convertToStartAndEndDate(
    cloudTemplate.rollingTime,
    NOW,
  );
  const response: MetricMonitorResponse = responseFor({
    step: step,
    window: window,
    pointsByAlias: data.pointsByAlias,
  });
  const [unhealthy, healthy] = instancesOf(step);

  return {
    breached: await isInstanceMet(step, unhealthy!, response),
    healthy: await isInstanceMet(step, healthy!, response),
  };
}

describe("a broken state fires on its first reading (Status Checks Failing)", () => {
  const id: string = "cloud-aws-ec2-status-check-failed";

  test("read-only: one failed period is enough", async () => {
    expect(
      await evaluate({ id, pointsByAlias: { value: readOnly([0, 0, 1]) } }),
    ).toEqual({ breached: true, healthy: false });
  });

  test("streamed: one failed minute is enough", async () => {
    expect(
      await evaluate({
        id,
        pointsByAlias: {
          value: everyMinute({
            from: 1,
            to: 27,
            value: (minute: number): number => {
              return minute === 20 ? 1 : 0;
            },
          }),
        },
      }),
    ).toEqual({ breached: true, healthy: false });
  });

  test("a window with no failure is healthy, on either connection", async () => {
    expect(
      await evaluate({ id, pointsByAlias: { value: readOnly([0, 0, 0]) } }),
    ).toEqual({ breached: false, healthy: true });
    expect(
      await evaluate({
        id,
        pointsByAlias: { value: everyMinute({ from: 1, to: 27, value: 0 }) },
      }),
    ).toEqual({ breached: false, healthy: true });
  });
});

describe("a level must hold for the whole window (High CPU)", () => {
  const id: string = "cloud-aws-ec2-high-cpu";

  test("read-only: every period at 90% or more", async () => {
    expect(
      await evaluate({ id, pointsByAlias: { value: readOnly([92, 95, 97]) } }),
    ).toEqual({ breached: true, healthy: false });
  });

  /*
   * The newest period is 15 to 30 minutes old, so the 30 minutes hold one
   * to three of them - the first always within a period of the window's
   * start, since every earlier period was read before: the window is
   * covered from its start to where the data reaches.
   */
  test("read-only: two periods in the window, the newest 20 minutes old, both at the line, are a breach", async () => {
    expect(
      (
        await evaluate({
          id,
          pointsByAlias: {
            value: [
              { minute: 5, value: 95 },
              { minute: 10, value: 96 },
            ],
          },
        })
      ).breached,
    ).toBe(true);
  });

  test("read-only: a window holding one period, 25 minutes old, is judged on it", async () => {
    expect(
      (
        await evaluate({
          id,
          pointsByAlias: { value: [{ minute: 5, value: 95 }] },
        })
      ).breached,
    ).toBe(true);
  });

  test("a period missing in the middle of the window is a hole: the level waits", async () => {
    expect(
      (
        await evaluate({
          id,
          pointsByAlias: {
            value: everyMinute({ from: 1, to: 27, value: 96 }).filter(
              (point: Point): boolean => {
                return point.minute < 8 || point.minute > 14;
              },
            ),
          },
        })
      ).breached,
    ).toBe(false);
  });

  test("read-only: one period under the line is no breach", async () => {
    expect(
      (await evaluate({ id, pointsByAlias: { value: readOnly([92, 60, 97]) } }))
        .breached,
    ).toBe(false);
  });

  test("streamed: every minute at 90% or more", async () => {
    expect(
      await evaluate({
        id,
        pointsByAlias: { value: everyMinute({ from: 1, to: 27, value: 96 }) },
      }),
    ).toEqual({ breached: true, healthy: false });
  });

  test("streamed: a spike of a few minutes is no breach", async () => {
    expect(
      (
        await evaluate({
          id,
          pointsByAlias: {
            value: everyMinute({
              from: 1,
              to: 27,
              value: (minute: number): number => {
                return minute >= 20 && minute <= 23 ? 99 : 40;
              },
            }),
          },
        })
      ).breached,
    ).toBe(false);
  });

  test("an idle instance is healthy", async () => {
    expect(
      await evaluate({ id, pointsByAlias: { value: readOnly([5, 6, 4]) } }),
    ).toEqual({ breached: false, healthy: true });
  });
});

/*
 * Errors over invocations, each totalled over the window. Read a minute at
 * a time, CloudWatch writes no point for a period with no error, so the
 * share would be read only for the periods that failed; read whole, both
 * connections read the window's own share.
 */
describe("a share of counts reads the window's own share (Function Errors)", () => {
  const id: string = "cloud-aws-lambda-errors";

  test("read-only: 20 errors of 300 invocations is 6.7%, a breach", async () => {
    expect(
      await evaluate({
        id,
        pointsByAlias: {
          // CloudWatch writes no Errors point for the periods without one.
          failed: [{ minute: 10, value: 20 }],
          requests: readOnly([100, 100, 100]),
        },
      }),
    ).toEqual({ breached: true, healthy: false });
  });

  test("streamed: the same errors and invocations, a minute at a time, read the same", async () => {
    expect(
      await evaluate({
        id,
        pointsByAlias: {
          failed: everyMinute({
            from: 10,
            to: 13,
            value: 5,
          }),
          requests: everyMinute({ from: 1, to: 27, value: 11 }),
        },
      }),
    ).toEqual({ breached: true, healthy: false });
  });

  /*
   * What reading the window whole is for: a quiet window with one bad
   * period. A point at a time, the formula joins the errors' one point
   * with that period's invocations and reads 6% - the bad period, not the
   * window. Read whole, it is 6 of 300: 2%.
   */
  test("one bad period in a quiet window is the window's 2%, not the period's 6%", async () => {
    expect(
      await evaluate({
        id,
        pointsByAlias: {
          failed: [{ minute: 10, value: 6 }],
          requests: readOnly([100, 100, 100]),
        },
      }),
    ).toEqual({ breached: false, healthy: true });
  });

  test("a few errors among many invocations is no breach", async () => {
    expect(
      await evaluate({
        id,
        pointsByAlias: {
          failed: [{ minute: 10, value: 2 }],
          requests: readOnly([100, 100, 100]),
        },
      }),
    ).toEqual({ breached: false, healthy: true });
  });

  test("a nightly job's one failed invocation of two is judged: no request floor", async () => {
    expect(
      (
        await evaluate({
          id,
          pointsByAlias: {
            failed: [{ minute: 10, value: 1 }],
            requests: [{ minute: 10, value: 2 }],
          },
        })
      ).breached,
    ).toBe(true);
  });

  test("a window with no invocation and no error neither fires nor changes anything", async () => {
    expect(
      (await evaluate({ id, pointsByAlias: { failed: [], requests: [] } }))
        .breached,
    ).toBe(false);
  });
});

/*
 * The load balancer's own 5xx and its targets', added up, over its
 * requests. A balancer whose targets failed while it did not has no
 * HTTPCode_ELB_5XX_Count point at all: read whole, that count is zero, and
 * the share is the targets' alone.
 */
describe("two counts over requests (an application load balancer's Server Errors)", () => {
  const id: string = "cloud-aws-alb-server-errors";

  test("the targets' errors alone breach, though the balancer's count has no point", async () => {
    expect(
      await evaluate({
        id,
        pointsByAlias: {
          failed: readOnly([10, 10, 10]),
          failed_second: [],
          requests: readOnly([100, 100, 100]),
        },
      }),
    ).toEqual({ breached: true, healthy: false });
  });

  test("both counts are added up", async () => {
    expect(
      (
        await evaluate({
          id,
          pointsByAlias: {
            failed: [{ minute: 10, value: 8 }],
            failed_second: [{ minute: 15, value: 8 }],
            requests: readOnly([100, 100, 100]),
          },
        })
      ).breached,
    ).toBe(true);
  });

  test("a share of too few requests is not judged, and counts as healthy", async () => {
    expect(
      await evaluate({
        id,
        pointsByAlias: {
          failed: [{ minute: 10, value: 5 }],
          failed_second: [],
          requests: [{ minute: 10, value: 10 }],
        },
      }),
    ).toEqual({ breached: false, healthy: true });
  });

  test("streamed: the same share, a minute at a time", async () => {
    expect(
      (
        await evaluate({
          id,
          pointsByAlias: {
            failed: everyMinute({ from: 5, to: 20, value: 2 }),
            failed_second: [],
            requests: everyMinute({ from: 1, to: 27, value: 20 }),
          },
        })
      ).breached,
    ).toBe(true);
  });
});

describe("a count totalled over the window (Function Throttled)", () => {
  const id: string = "cloud-aws-lambda-throttles";

  test("one throttled invocation fires, on either connection", async () => {
    expect(
      await evaluate({
        id,
        pointsByAlias: { failed: [{ minute: 10, value: 1 }] },
      }),
    ).toEqual({ breached: true, healthy: false });
    expect(
      (
        await evaluate({
          id,
          pointsByAlias: { failed: [{ minute: 24, value: 1 }] },
        })
      ).breached,
    ).toBe(true);
  });

  test("no point at all is no throttle: healthy", async () => {
    expect(await evaluate({ id, pointsByAlias: { failed: [] } })).toEqual({
      breached: false,
      healthy: true,
    });
  });

  test("a table's read and write throttles are added up", async () => {
    expect(
      (
        await evaluate({
          id: "cloud-aws-dynamodb-throttled",
          pointsByAlias: { failed: [], failed_second: [{ minute: 12, value: 3 }] },
        })
      ).breached,
    ).toBe(true);
  });
});

describe("an age fires on its first reading at the line (Oldest Message Waiting)", () => {
  const id: string = "cloud-aws-sqs-oldest-message";

  test("a message an hour old fires", async () => {
    expect(
      await evaluate({
        id,
        pointsByAlias: { value: readOnly([3000, 3400, 3700]) },
      }),
    ).toEqual({ breached: true, healthy: false });
  });

  test("consumers keeping up are healthy", async () => {
    expect(
      await evaluate({ id, pointsByAlias: { value: readOnly([20, 35, 12]) } }),
    ).toEqual({ breached: false, healthy: true });
  });
});

describe("Azure and Google Cloud, a minute at a time", () => {
  test("an Azure SQL database 90% full for 15 minutes", async () => {
    expect(
      await evaluate({
        id: "cloud-azure-sql-storage-full",
        pointsByAlias: { value: everyMinute({ from: 16, to: 26, value: 93 }) },
      }),
    ).toEqual({ breached: true, healthy: false });
  });

  test("an Azure VM that becomes unavailable fires on its first reading", async () => {
    expect(
      (
        await evaluate({
          id: "cloud-azure-vm-unavailable",
          pointsByAlias: {
            value: everyMinute({
              from: 16,
              to: 26,
              value: (minute: number): number => {
                return minute >= 24 ? 0 : 1;
              },
            }),
          },
        })
      ).breached,
    ).toBe(true);
  });

  test("an Azure SQL database's failed connections are totalled", async () => {
    expect(
      (
        await evaluate({
          id: "cloud-azure-sql-failed-connections",
          pointsByAlias: { failed: [{ minute: 20, value: 2 }] },
        })
      ).breached,
    ).toBe(true);
  });

  test("a Compute Engine VM's utilization, 0 to 1, is compared as a percent", async () => {
    expect(
      await evaluate({
        id: "cloud-gcp-compute-high-cpu",
        pointsByAlias: { value: everyMinute({ from: 16, to: 26, value: 0.95 }) },
      }),
    ).toEqual({ breached: true, healthy: false });
    expect(
      (
        await evaluate({
          id: "cloud-gcp-compute-high-cpu",
          pointsByAlias: {
            value: everyMinute({ from: 16, to: 26, value: 0.5 }),
          },
        })
      ).breached,
    ).toBe(false);
  });
});

describe("a resource's own threshold (Low Free Storage)", () => {
  const id: string = "cloud-aws-rds-low-storage";
  const gib: number = 1024 ** 3;

  test("under 10% of 100 GiB free for the whole window fires", async () => {
    expect(
      await evaluate({
        id,
        pointsByAlias: { value: readOnly([8 * gib, 7 * gib, 6 * gib]) },
      }),
    ).toEqual({ breached: true, healthy: false });
  });

  test("half of it free is healthy", async () => {
    expect(
      await evaluate({
        id,
        pointsByAlias: { value: readOnly([50 * gib, 50 * gib, 49 * gib]) },
      }),
    ).toEqual({ breached: false, healthy: true });
  });
});

// ---------------------------------------------------------------------------
// An Azure resource a connection reads: the names its metrics are stored under
// ---------------------------------------------------------------------------

/*
 * A connection stores each Azure metric under the aggregation its definition
 * calls primary ("azure_storage_percent_maximum"), which only the read
 * knows. A resource it reads is offered an Azure template once its readings
 * name each metric the template reads; a collector's resource, whose
 * receiver writes every aggregation, is read under the documented one.
 */
describe("an Azure resource a connection reads", () => {
  const time: string = "2026-11-02T12:20:00.000Z";

  const SQL_AGGREGATIONS: Record<string, string> = {
    storage_percent: "maximum",
    cpu_percent: "average",
    sessions_percent: "average",
    connection_failed: "total",
    deadlock: "total",
    dtu_consumption_percent: "average",
  };

  function sqlReadings(
    withNames: boolean,
    keys: Array<string> = [
      "storage_percent",
      "cpu_percent",
      "sessions_percent",
      "connection_failed",
      "deadlock",
    ],
  ): CloudResourceReadings {
    const readings: CloudResourceReadings = {};

    for (const key of keys) {
      readings[key] = withNames
        ? {
            value: 1,
            time,
            metric: `azure_${key}_${SQL_AGGREGATIONS[key] || "average"}`,
          }
        : { value: 1, time };
    }

    return readings;
  }

  test("before its readings name its metrics, a resource its connection reads is offered nothing", () => {
    for (const readings of [undefined, null, {}, sqlReadings(false)]) {
      expect(
        getCloudAlertTemplatesFor({
          provider: "azure",
          resourceType: "Microsoft.Sql/servers/databases",
          telemetryAttributes: AZURE_SQL_ATTRIBUTES,
          readings: readings as CloudResourceReadings | null | undefined,
          isReadByConnection: true,
        }),
      ).toEqual([]);
    }
  });

  test("once they do, it is offered each template whose metrics it reports", () => {
    expect(
      idsOf(
        getCloudAlertTemplatesFor({
          provider: "azure",
          resourceType: "Microsoft.Sql/servers/databases",
          telemetryAttributes: AZURE_SQL_ATTRIBUTES,
          readings: sqlReadings(true),
          isReadByConnection: true,
        }),
      ),
    ).toEqual([
      "cloud-azure-sql-storage-full",
      "cloud-azure-sql-high-cpu",
      "cloud-azure-sql-sessions-high",
      "cloud-azure-sql-failed-connections",
      "cloud-azure-sql-deadlocks",
    ]);
  });

  test("a template whose metric it has no reading of waits for one", () => {
    expect(
      idsOf(
        getCloudAlertTemplatesFor({
          provider: "azure",
          resourceType: "Microsoft.Sql/servers/databases",
          telemetryAttributes: AZURE_SQL_ATTRIBUTES,
          readings: sqlReadings(true, ["storage_percent", "cpu_percent"]),
          isReadByConnection: true,
        }),
      ),
    ).toEqual(["cloud-azure-sql-storage-full", "cloud-azure-sql-high-cpu"]);
  });

  test("its monitor reads each metric under the name its reading keeps", () => {
    const readings: CloudResourceReadings = sqlReadings(true);
    const step: MonitorStep = template(
      "cloud-azure-sql-storage-full",
    ).getMonitorStep(argsFor(AZURE_SQL_ATTRIBUTES, { readings }));

    expect(
      viewConfigOf(step).queryConfigs[0]!.metricQueryData.filterData
        .metricName,
    ).toBe("azure_storage_percent_maximum");
  });

  test("a collector's resource is read under the aggregation Azure documents", () => {
    expect(
      idsOf(
        getCloudAlertTemplatesFor({
          provider: "azure",
          resourceType: "Microsoft.Sql/servers/databases",
          telemetryAttributes: AZURE_SQL_ATTRIBUTES,
          isReadByConnection: false,
        }),
      ),
    ).toContain("cloud-azure-sql-storage-full");
  });

  test("AWS and Google Cloud never wait: their stored names are fixed", () => {
    expect(
      idsOf(
        getCloudAlertTemplatesFor({
          provider: "aws",
          resourceType: "AWS::EC2::Instance",
          telemetryAttributes: EC2_ATTRIBUTES,
          readings: {},
          isReadByConnection: true,
        }),
      ),
    ).toEqual(["cloud-aws-ec2-status-check-failed", "cloud-aws-ec2-high-cpu"]);
    expect(
      idsOf(
        getCloudAlertTemplatesFor({
          provider: "gcp",
          resourceType: "pubsub_subscription",
          telemetryAttributes: PUBSUB_ATTRIBUTES,
          readings: {},
          isReadByConnection: true,
        }),
      ),
    ).toEqual(["cloud-gcp-pubsub-oldest-message"]);
  });

  /*
   * DTUs are a metric of the DTU purchasing model: a vCore database never
   * sends one, so its monitor would watch nothing. Offered on a reading,
   * whoever reads the database.
   */
  test("DTU Usage High is offered only to a database that reports DTUs", () => {
    const withDtu: CloudResourceReadings = sqlReadings(true, [
      "storage_percent",
      "cpu_percent",
      "sessions_percent",
      "connection_failed",
      "deadlock",
      "dtu_consumption_percent",
    ]);

    expect(
      idsOf(
        getCloudAlertTemplatesFor({
          provider: "azure",
          resourceType: "Microsoft.Sql/servers/databases",
          telemetryAttributes: AZURE_SQL_ATTRIBUTES,
          readings: withDtu,
          isReadByConnection: true,
        }),
      ),
    ).toContain("cloud-azure-sql-dtu-high");

    for (const isReadByConnection of [true, false]) {
      expect(
        idsOf(
          getCloudAlertTemplatesFor({
            provider: "azure",
            resourceType: "Microsoft.Sql/servers/databases",
            telemetryAttributes: AZURE_SQL_ATTRIBUTES,
            readings: sqlReadings(true),
            isReadByConnection: isReadByConnection,
          }),
        ),
      ).not.toContain("cloud-azure-sql-dtu-high");
    }

    expect(template("cloud-azure-sql-dtu-high").requiresReading).toBe(true);
  });
});

describe("getCloudAlertTemplateReadingKeys", () => {
  test("an Azure type keeps a reading of every metric its templates read", () => {
    const keys: ReadonlySet<string> = getCloudAlertTemplateReadingKeys({
      provider: "azure",
      resourceType: "Microsoft.Sql/servers/databases",
    });

    for (const cloudTemplate of getCloudAlertTemplatesForType({
      provider: "azure",
      resourceType: "Microsoft.Sql/servers/databases",
    })) {
      for (const query of cloudTemplate.queries) {
        expect(keys.has(getCloudAlertMetricReadingKey(query.metric)!)).toBe(
          true,
        );
      }
    }

    expect(keys.has("dtu_consumption_percent")).toBe(true);
    expect(keys.has("deadlock")).toBe(true);
  });

  test("every Azure template's metrics are kept, for each of its types", () => {
    for (const cloudTemplate of ALL.filter((candidate: CloudAlertTemplate) => {
      return candidate.provider === CloudProvider.Azure;
    })) {
      for (const type of cloudTemplate.resourceTypes) {
        const keys: ReadonlySet<string> = getCloudAlertTemplateReadingKeys({
          provider: "AZURE",
          resourceType: type.toUpperCase(),
        });

        for (const query of cloudTemplate.queries) {
          const key: string = getCloudAlertMetricReadingKey(query.metric)!;

          expect(`${cloudTemplate.id} ${type} ${key}: ${keys.has(key)}`).toBe(
            `${cloudTemplate.id} ${type} ${key}: true`,
          );
        }
      }
    }
  });

  test("an AWS or Google Cloud type keeps none: their names are fixed", () => {
    expect(
      getCloudAlertTemplateReadingKeys({
        provider: "aws",
        resourceType: "AWS::EC2::Instance",
      }).size,
    ).toBe(0);
    expect(
      getCloudAlertTemplateReadingKeys({
        provider: "gcp",
        resourceType: "gce_instance",
      }).size,
    ).toBe(0);
    expect(
      getCloudAlertTemplateReadingKeys({ provider: "", resourceType: "" }).size,
    ).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Every Sum template, read-only and streamed
// ---------------------------------------------------------------------------

/*
 * A streamed AWS connection writes a Sum metric once a minute, a read-only
 * one once per five-minute CloudWatch period: the same failures are five
 * times smaller points on one than on the other, and CloudWatch writes no
 * point for a period without a failure. Every AWS template that reads a Sum
 * metric totals it over its window (aggregatesWholeWindow), so each reads
 * the same decision from both: a breach, a quiet window, and an empty one.
 */
const AWS_SUM_TEMPLATES: Array<CloudAlertTemplate> = ALL.filter(
  (cloudTemplate: CloudAlertTemplate): boolean => {
    return (
      cloudTemplate.provider === CloudProvider.AWS &&
      cloudTemplate.queries.some((query: CloudAlertQuery): boolean => {
        return query.metric.aggregationType === AggregationType.Sum;
      })
    );
  },
);

type Shape = "read-only" | "streamed";

const SHAPES: Array<Shape> = ["read-only", "streamed"];

/*
 * The same counts, as each connection writes them: `failed` failures and
 * `requests` requests in the window - a read-only account's in its three
 * five-minute periods (12:05, 12:10, 12:15), the failures in one of them; a
 * streamed account's a minute at a time, the failures spread over minutes.
 */
function countsAs(data: {
  shape: Shape;
  failed: number;
  requests: number;
}): { failed: Array<Point>; requests: Array<Point> } {
  if (data.shape === "read-only") {
    const third: number = data.requests / 3;

    return {
      failed: data.failed > 0 ? [{ minute: 10, value: data.failed }] : [],
      requests: data.requests > 0 ? readOnly([third, third, third]) : [],
    };
  }

  const failed: Array<Point> = [];

  for (let index: number = 0; index < data.failed; index++) {
    failed.push({ minute: 2 + (index % 25), value: 1 });
  }

  return {
    failed: failed,
    requests:
      data.requests > 0
        ? everyMinute({ from: 1, to: 25, value: data.requests / 25 })
        : [],
  };
}

function pointsFor(data: {
  cloudTemplate: CloudAlertTemplate;
  shape: Shape;
  failed: number;
  requests: number;
}): Record<string, Array<Point>> {
  const counts: { failed: Array<Point>; requests: Array<Point> } = countsAs({
    shape: data.shape,
    failed: data.failed,
    requests: data.requests,
  });
  const points: Record<string, Array<Point>> = {};

  for (const query of data.cloudTemplate.queries) {
    if (query.alias === "requests") {
      points[query.alias] = counts.requests;
    } else if (query.alias === "failed") {
      points[query.alias] = counts.failed;
    } else {
      // A second count (an ALB's own 5xx, a table's write throttles): none.
      points[query.alias] = [];
    }
  }

  return points;
}

describe.each(
  AWS_SUM_TEMPLATES.map((cloudTemplate: CloudAlertTemplate) => {
    return [cloudTemplate.id, cloudTemplate];
  }),
)(
  "%s, read-only and streamed",
  (_id: string, cloudTemplate: CloudAlertTemplate) => {
    async function outcomeOf(data: {
      shape: Shape;
      failed: number;
      requests: number;
    }): Promise<Outcome> {
      return await evaluate({
        id: cloudTemplate.id,
        pointsByAlias: pointsFor({ cloudTemplate, ...data }),
      });
    }

    test("is read whole", () => {
      expect(
        MonitorStepMetricMonitorUtil.aggregatesWholeWindow(
          stepOf(cloudTemplate).data!.metricMonitor,
        ),
      ).toBe(true);
    });

    test("a window that fails breaches on both, and is not healthy", async () => {
      // 12 failures of 200 requests: 6%, past 5% and over the 20-request floor.
      for (const shape of SHAPES) {
        expect({
          shape,
          ...(await outcomeOf({ shape, failed: 12, requests: 200 })),
        }).toEqual({ shape, breached: true, healthy: false });
      }
    });

    test("a quiet window is healthy on both", async () => {
      for (const shape of SHAPES) {
        const failed: number = cloudTemplate.measure === "share" ? 2 : 0;

        expect({
          shape,
          ...(await outcomeOf({ shape, failed, requests: 1000 })),
        }).toEqual({ shape, breached: false, healthy: true });
      }
    });

    test("an empty window fires on neither", async () => {
      for (const shape of SHAPES) {
        expect(
          (await outcomeOf({ shape, failed: 0, requests: 0 })).breached,
        ).toBe(false);
      }
    });

    test("both read the same decision, whatever the counts", async () => {
      for (const [failed, requests] of [
        [1, 25],
        [3, 40],
        [5, 100],
        [6, 120],
        [25, 500],
        [0, 60],
      ] as Array<[number, number]>) {
        expect(await outcomeOf({ shape: "read-only", failed, requests })).toEqual(
          await outcomeOf({ shape: "streamed", failed, requests }),
        );
      }
    });
  },
);
