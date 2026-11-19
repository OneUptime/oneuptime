import { describe, expect, test } from "@jest/globals";
import {
  CLOUD_KEY_METRIC_CONDITION_REASONS,
  CloudKeyMetricCondition,
  isCloudKeyMetricCondition,
} from "../../../Types/Cloud/CloudKeyMetricCondition";
import {
  CloudKeyMetricGroup,
  getCloudKeyMetricGroupOrder,
} from "../../../Types/Cloud/CloudKeyMetricGroup";
import {
  AWS_KEY_METRICS,
  AZURE_KEY_METRICS,
  GCP_KEY_METRICS,
  GCP_OPS_AGENT,
  getAwsKeyMetrics,
  getAzureKeyMetrics,
} from "../../../Types/Cloud/CloudKeyMetrics";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import {
  CLOUD_UNREPORTED_FEW_TIMES_A_DAY,
  CLOUD_UNREPORTED_FIVE_MINUTES,
  CLOUD_UNREPORTED_ONCE_A_DAY,
  CLOUD_UNREPORTED_REASON_SENTENCES,
  CloudResourceKeyMetric,
  CloudUnreportedConnectionState,
  CloudUnreportedReason,
  CloudUnreportedReasonEntry,
  explainCloudUnreportedKeyMetric,
  getCloudKeyMetricKeyOfStoredName,
  getCloudKeyMetricsOfResource,
  getCloudUnreportedKeyMetrics,
  getCloudUnreportedReasonText,
  isCloudReadWarningAbout,
  readCloudUnreportedKeyMetricReports,
} from "../../../Types/Cloud/CloudUnreportedKeyMetrics";

/*
 * Which key metrics a cloud resource did not report, and why (#9569): the
 * key metrics a resource of a type reports, the ones a list of reported
 * names leaves out, and the likely reasons - from the catalog's conditions,
 * an agent, how often a metric comes, and what OneUptime knows of the
 * resource's connection.
 */

function keysOf(metrics: Array<CloudResourceKeyMetric>): Array<string> {
  return metrics.map((metric: CloudResourceKeyMetric): string => {
    return metric.key;
  });
}

function reasonsOf(entries: Array<CloudUnreportedReasonEntry>): Array<string> {
  return entries.map((entry: CloudUnreportedReasonEntry): string => {
    return entry.reason;
  });
}

const VM: string = "Microsoft.Compute/virtualMachines";

describe("the key metrics a resource reports", () => {
  test("an Azure type's, in its sections' order, each by its name in lower case, stored under any aggregation", () => {
    const metrics: Array<CloudResourceKeyMetric> = getCloudKeyMetricsOfResource(
      { provider: "azure", type: VM },
    );

    expect(metrics).toHaveLength(getAzureKeyMetrics(VM)!.metrics.length);
    // Availability first: a VM's availability leads its list.
    expect(metrics[0]!.key).toBe("vmavailabilitymetric");
    expect(metrics[0]!.group).toBe(CloudKeyMetricGroup.Availability);

    for (let index: number = 1; index < metrics.length; index++) {
      const before: CloudResourceKeyMetric = metrics[index - 1]!;
      const after: CloudResourceKeyMetric = metrics[index]!;

      expect(
        getCloudKeyMetricGroupOrder(before.group) <
          getCloudKeyMetricGroupOrder(after.group) ||
          (before.group === after.group && before.rank < after.rank),
      ).toBe(true);
    }

    const cpu: CloudResourceKeyMetric = metrics.find(
      (metric: CloudResourceKeyMetric): boolean => {
        return metric.name === "Percentage CPU";
      },
    )!;

    expect(cpu.storedNames).toEqual([
      "azure_percentage_cpu_average",
      "azure_percentage_cpu_total",
      "azure_percentage_cpu_maximum",
      "azure_percentage_cpu_minimum",
      "azure_percentage_cpu_count",
    ]);
  });

  test("a burstable VM's credits say when they are reported; an App Service's health check comes every 5 minutes, read every 15", () => {
    const credits: CloudResourceKeyMetric | undefined =
      getCloudKeyMetricsOfResource({ provider: "azure", type: VM }).find(
        (metric: CloudResourceKeyMetric): boolean => {
          return metric.name === "CPU Credits Remaining";
        },
      );

    expect(credits?.onlyWhen).toBe(CloudKeyMetricCondition.Burstable);

    const health: CloudResourceKeyMetric | undefined =
      getCloudKeyMetricsOfResource({
        provider: "azure",
        type: "Microsoft.Web/sites",
      }).find((metric: CloudResourceKeyMetric): boolean => {
        return metric.name === "HealthCheckStatus";
      });

    expect(health).toEqual(
      expect.objectContaining({
        intervalSeconds: 300,
        readEverySeconds: 900,
        onlyWhen: CloudKeyMetricCondition.Setup,
      }),
    );
  });

  test("an AWS resource's are its own namespace's, when its attributes name it", () => {
    const alb: Array<CloudResourceKeyMetric> = getCloudKeyMetricsOfResource({
      provider: "aws",
      type: "AWS::ElasticLoadBalancingV2::LoadBalancer",
      namespace: "AWS/ApplicationELB",
    });
    const nlb: Array<CloudResourceKeyMetric> = getCloudKeyMetricsOfResource({
      provider: "aws",
      type: "AWS::ElasticLoadBalancingV2::LoadBalancer",
      namespace: "AWS/NetworkELB",
    });

    expect(alb).toHaveLength(
      getAwsKeyMetrics("AWS/ApplicationELB")!.metrics.length,
    );
    expect(
      alb.every((metric: CloudResourceKeyMetric): boolean => {
        return metric.namespace === "AWS/ApplicationELB";
      }),
    ).toBe(true);
    expect(
      nlb.every((metric: CloudResourceKeyMetric): boolean => {
        return metric.namespace === "AWS/NetworkELB";
      }),
    ).toBe(true);
    expect(alb[0]!.key).toBe(
      `aws/applicationelb|${alb[0]!.name.toLowerCase()}`,
    );
    expect(alb[0]!.storedNames).toEqual([
      `amazonaws.com/aws/applicationelb/${alb[0]!.name.toLowerCase()}`,
    ]);
  });

  test("without a namespace, every namespace its type is read from: an Auto Scaling group's EC2 and Auto Scaling metrics", () => {
    const namespaces: Set<string> = new Set<string>(
      getCloudKeyMetricsOfResource({
        provider: "aws",
        type: "AWS::AutoScaling::AutoScalingGroup",
      }).map((metric: CloudResourceKeyMetric): string => {
        return metric.namespace || "";
      }),
    );

    expect(Array.from(namespaces).sort()).toEqual([
      "AWS/AutoScaling",
      "AWS/EC2",
    ]);
  });

  test("a namespace's metric only another of its types reports is left out: an ECS service has no reservations, an HTTP API no 5XXError", () => {
    const names: (type: string, namespace: string) => Array<string> = (
      type: string,
      namespace: string,
    ): Array<string> => {
      return getCloudKeyMetricsOfResource({
        provider: "aws",
        type,
        namespace,
      }).map((metric: CloudResourceKeyMetric): string => {
        return metric.name;
      });
    };

    expect(names("AWS::ECS::Service", "AWS/ECS")).not.toContain(
      "CPUReservation",
    );
    expect(names("AWS::ECS::Cluster", "AWS/ECS")).toContain("CPUReservation");
    expect(names("AWS::ApiGatewayV2::Api", "AWS/ApiGateway")).toEqual(
      expect.arrayContaining(["5xx", "4xx", "Count", "Latency"]),
    );
    expect(names("AWS::ApiGatewayV2::Api", "AWS/ApiGateway")).not.toContain(
      "5XXError",
    );
    expect(names("AWS::ApiGateway::RestApi", "AWS/ApiGateway")).not.toContain(
      "5xx",
    );
  });

  test("an AWS metric published a few times a day or daily says how often", () => {
    const bucket: Array<CloudResourceKeyMetric> = getCloudKeyMetricsOfResource({
      provider: "aws",
      type: "AWS::S3::Bucket",
    });

    expect(
      bucket.map((metric: CloudResourceKeyMetric) => {
        return metric.intervalSeconds;
      }),
    ).toEqual([86400, 86400]);
  });

  test("a Compute Engine VM's Ops Agent metrics say who reports them", () => {
    const agent: Array<CloudResourceKeyMetric> = getCloudKeyMetricsOfResource({
      provider: "gcp",
      type: "gce_instance",
    }).filter((metric: CloudResourceKeyMetric): boolean => {
      return Boolean(metric.reportedBy);
    });

    expect(
      agent.map((metric: CloudResourceKeyMetric): string => {
        return metric.name;
      }),
    ).toEqual([
      "agent.googleapis.com/memory/percent_used",
      "agent.googleapis.com/disk/percent_used",
    ]);
    expect(agent[0]!.reportedBy).toBe(GCP_OPS_AGENT);
  });

  test("nothing for an unknown provider or type", () => {
    expect(
      getCloudKeyMetricsOfResource({ provider: "oracle", type: VM }),
    ).toEqual([]);
    expect(
      getCloudKeyMetricsOfResource({ provider: "azure", type: "Nope/nope" }),
    ).toEqual([]);
    expect(
      getCloudKeyMetricsOfResource({ provider: null, type: null }),
    ).toEqual([]);
  });

  test("every key metric of every type of every cloud has one key in its resource's list", () => {
    for (const entry of AZURE_KEY_METRICS) {
      const metrics: Array<CloudResourceKeyMetric> =
        getCloudKeyMetricsOfResource({ provider: "azure", type: entry.type });

      expect(new Set(keysOf(metrics)).size).toBe(metrics.length);
    }

    for (const entry of GCP_KEY_METRICS) {
      const metrics: Array<CloudResourceKeyMetric> =
        getCloudKeyMetricsOfResource({
          provider: "gcp",
          type: entry.resourceType,
        });

      expect(new Set(keysOf(metrics)).size).toBe(metrics.length);
    }

    for (const entry of AWS_KEY_METRICS) {
      const metrics: Array<CloudResourceKeyMetric> =
        getCloudKeyMetricsOfResource({
          provider: "aws",
          type: "",
          namespace: entry.namespace,
        });

      expect(metrics).toHaveLength(entry.metrics.length);
    }
  });
});

describe("the key of the key metric a stored name is", () => {
  test("AWS by its namespace and name, Azure by its name whatever the aggregation, Google Cloud by its stored name", () => {
    expect(
      getCloudKeyMetricKeyOfStoredName({
        provider: "aws",
        type: "AWS::EC2::Instance",
        metricName: "amazonaws.com/aws/ec2/cpuutilization",
      }),
    ).toBe("aws/ec2|cpuutilization");
    expect(
      getCloudKeyMetricKeyOfStoredName({
        provider: "azure",
        type: VM,
        metricName: "azure_percentage_cpu_maximum",
      }),
    ).toBe("percentage cpu");
    expect(
      getCloudKeyMetricKeyOfStoredName({
        provider: "gcp",
        type: "gce_instance",
        metricName: "compute.googleapis.com/instance/cpu/utilization",
      }),
    ).toBe("compute.googleapis.com/instance/cpu/utilization");
  });

  test("null for a name no connection reads as a key metric", () => {
    expect(
      getCloudKeyMetricKeyOfStoredName({
        provider: "aws",
        type: "AWS::EC2::Instance",
        metricName: "amazonaws.com/AWS/EC2/MetadataNoToken",
      }),
    ).toBeNull();
    expect(
      getCloudKeyMetricKeyOfStoredName({
        provider: "azure",
        type: VM,
        metricName: "http.server.duration",
      }),
    ).toBeNull();
    expect(
      getCloudKeyMetricKeyOfStoredName({
        provider: "gcp",
        type: "gce_instance",
        metricName: "",
      }),
    ).toBeNull();
    expect(
      getCloudKeyMetricKeyOfStoredName({
        provider: "oracle",
        type: VM,
        metricName: "azure_percentage_cpu_average",
      }),
    ).toBeNull();
  });
});

describe("the key metrics a resource did not report", () => {
  test("those none of the reported names is, in their sections' order", () => {
    const unreported: Array<CloudResourceKeyMetric> =
      getCloudUnreportedKeyMetrics({
        provider: "azure",
        type: VM,
        reportedMetricNames: [
          "azure_percentage_cpu_average",
          "azure_available_memory_bytes_average",
          "azure_network_in_total_total",
          // An app's own metric on the same resource: not a key metric.
          "http.server.duration",
        ],
      });
    const all: Array<CloudResourceKeyMetric> = getCloudKeyMetricsOfResource({
      provider: "azure",
      type: VM,
    });

    expect(unreported).toHaveLength(all.length - 3);
    expect(keysOf(unreported)).not.toContain("percentage cpu");
    expect(keysOf(unreported)).toEqual(
      keysOf(all).filter((key: string): boolean => {
        return ![
          "percentage cpu",
          "available memory bytes",
          "network in total",
        ].includes(key);
      }),
    );
  });

  test("every key metric when none is reported, none when all are", () => {
    const all: Array<CloudResourceKeyMetric> = getCloudKeyMetricsOfResource({
      provider: "gcp",
      type: "cloudsql_database",
    });

    expect(
      getCloudUnreportedKeyMetrics({
        provider: "gcp",
        type: "cloudsql_database",
        reportedMetricNames: [],
      }),
    ).toEqual(all);
    expect(
      getCloudUnreportedKeyMetrics({
        provider: "gcp",
        type: "cloudsql_database",
        reportedMetricNames: all.flatMap(
          (metric: CloudResourceKeyMetric): Array<string> => {
            return metric.storedNames;
          },
        ),
      }),
    ).toEqual([]);
  });
});

describe("why a key metric was not reported", () => {
  const healthy: CloudUnreportedConnectionState = {
    isEnabled: true,
    lastReadStatus: "success",
    lastReadWarnings: [],
  };

  function metricOf(
    provider: string,
    type: string,
    name: string,
    namespace?: string,
  ): CloudResourceKeyMetric {
    return getCloudKeyMetricsOfResource({ provider, type, namespace }).find(
      (metric: CloudResourceKeyMetric): boolean => {
        return metric.name === name;
      },
    )!;
  }

  test("no cloud connection reads the resource", () => {
    expect(
      explainCloudUnreportedKeyMetric({
        metric: metricOf("azure", VM, "Percentage CPU"),
        connection: null,
      }),
    ).toEqual([
      { reason: CloudUnreportedReason.NoConnection, fix: "cloud-connect" },
    ]);
  });

  test("its connection is off, refused, failed, or could not read this metric", () => {
    const metric: CloudResourceKeyMetric = metricOf(
      "azure",
      VM,
      "Percentage CPU",
    );

    expect(
      reasonsOf(
        explainCloudUnreportedKeyMetric({
          metric,
          connection: { isEnabled: false },
        }),
      ),
    ).toEqual([CloudUnreportedReason.ConnectionOff]);
    expect(
      reasonsOf(
        explainCloudUnreportedKeyMetric({
          metric,
          connection: {
            isEnabled: true,
            lastReadStatus: "failed",
            lastReadFailureKind: "permission",
          },
        }),
      ),
    ).toEqual([CloudUnreportedReason.NoPermission]);
    expect(
      reasonsOf(
        explainCloudUnreportedKeyMetric({
          metric,
          connection: {
            isEnabled: true,
            lastReadStatus: "failed",
            lastReadFailureKind: "unavailable",
          },
        }),
      ),
    ).toEqual([CloudUnreportedReason.ReadFailed]);
    expect(
      reasonsOf(
        explainCloudUnreportedKeyMetric({
          metric,
          connection: {
            isEnabled: true,
            lastReadStatus: "partial",
            lastReadWarnings: [
              "Azure Monitor could not read Percentage CPU of 3 resources: Throttled",
            ],
          },
        }),
      ),
    ).toEqual([CloudUnreportedReason.ReadFailed]);
    // A warning about another metric says nothing of this one.
    expect(
      reasonsOf(
        explainCloudUnreportedKeyMetric({
          metric,
          connection: {
            isEnabled: true,
            lastReadStatus: "partial",
            lastReadWarnings: [
              "Azure Monitor could not read Percentage CPU Credits of 3 resources",
            ],
          },
        }),
      ),
    ).toEqual([]);
  });

  test("the resource does not publish it, with the catalog's condition after", () => {
    expect(
      explainCloudUnreportedKeyMetric({
        metric: metricOf("azure", VM, "CPU Credits Remaining"),
        connection: healthy,
        isPublished: false,
        isPublishedByType: true,
      }),
    ).toEqual([
      { reason: CloudUnreportedReason.NotPublished },
      {
        reason: CloudUnreportedReason.Condition,
        condition: CloudKeyMetricCondition.Burstable,
      },
    ]);
  });

  test("the resources of its type checked do not publish it, said only when its own definitions are not known", () => {
    const metric: CloudResourceKeyMetric = metricOf(
      "azure",
      "Microsoft.Sql/servers/databases",
      "dtu_consumption_percent",
    );

    expect(
      reasonsOf(
        explainCloudUnreportedKeyMetric({
          metric,
          connection: healthy,
          isPublished: null,
          isPublishedByType: false,
        }),
      ),
    ).toEqual([
      CloudUnreportedReason.Condition,
      CloudUnreportedReason.NotPublishedByType,
    ]);
    expect(
      reasonsOf(
        explainCloudUnreportedKeyMetric({
          metric,
          connection: healthy,
          isPublished: true,
          isPublishedByType: false,
        }),
      ),
    ).toEqual([
      CloudUnreportedReason.Condition,
      CloudUnreportedReason.NotPublishedByType,
    ]);
  });

  test("only the Ops Agent reports it, and what fixes it is installing the agent", () => {
    expect(
      explainCloudUnreportedKeyMetric({
        metric: metricOf(
          "gcp",
          "gce_instance",
          "agent.googleapis.com/memory/percent_used",
        ),
        connection: healthy,
      }),
    ).toEqual([{ reason: CloudUnreportedReason.NeedsAgent, fix: "ops-agent" }]);
  });

  test("CloudWatch publishes it only when it is not zero", () => {
    expect(
      explainCloudUnreportedKeyMetric({
        metric: metricOf(
          "aws",
          "AWS::ElasticLoadBalancingV2::LoadBalancer",
          "HTTPCode_ELB_5XX_Count",
          "AWS/ApplicationELB",
        ),
        connection: healthy,
      }),
    ).toEqual([
      {
        reason: CloudUnreportedReason.Condition,
        condition: CloudKeyMetricCondition.NonZero,
      },
    ]);
  });

  test("its stream sends it and none came; it comes every 5 minutes, or once a day", () => {
    expect(
      explainCloudUnreportedKeyMetric({
        metric: metricOf(
          "aws",
          "AWS::EC2::Instance",
          "CPUUtilization",
          "AWS/EC2",
        ),
        connection: healthy,
        isLeftToStream: true,
      }),
    ).toEqual([
      { reason: CloudUnreportedReason.Streamed, fix: "cloud-connect" },
    ]);
    expect(
      explainCloudUnreportedKeyMetric({
        metric: metricOf("azure", "Microsoft.Web/sites", "HealthCheckStatus"),
        connection: healthy,
      }),
    ).toEqual([
      {
        reason: CloudUnreportedReason.Condition,
        condition: CloudKeyMetricCondition.Setup,
      },
      {
        reason: CloudUnreportedReason.Cadence,
        intervalSeconds: 300,
        readEverySeconds: 900,
      },
    ]);
    expect(
      explainCloudUnreportedKeyMetric({
        metric: metricOf("aws", "AWS::S3::Bucket", "BucketSizeBytes"),
        connection: healthy,
      }),
    ).toEqual([
      { reason: CloudUnreportedReason.Cadence, intervalSeconds: 86400 },
    ]);
  });

  test("nothing known: no reason", () => {
    expect(
      explainCloudUnreportedKeyMetric({
        metric: metricOf("azure", VM, "Percentage CPU"),
        connection: healthy,
      }),
    ).toEqual([]);
  });
});

describe("a reason in words", () => {
  test("each reason a sentence, a condition's and a cadence's their own", () => {
    for (const reason of Object.values(CloudUnreportedReason)) {
      const entry: CloudUnreportedReasonEntry =
        reason === CloudUnreportedReason.Condition
          ? { reason, condition: CloudKeyMetricCondition.Replica }
          : { reason, intervalSeconds: 300 };

      expect(getCloudUnreportedReasonText(entry).length).toBeGreaterThan(10);
    }

    expect(
      getCloudUnreportedReasonText({
        reason: CloudUnreportedReason.Condition,
        condition: CloudKeyMetricCondition.NonZero,
      }),
    ).toBe(CLOUD_KEY_METRIC_CONDITION_REASONS[CloudKeyMetricCondition.NonZero]);
    expect(
      getCloudUnreportedReasonText({
        reason: CloudUnreportedReason.Cadence,
        intervalSeconds: 300,
      }),
    ).toBe(CLOUD_UNREPORTED_FIVE_MINUTES);
    expect(
      getCloudUnreportedReasonText({
        reason: CloudUnreportedReason.Cadence,
        intervalSeconds: 3600,
      }),
    ).toBe(CLOUD_UNREPORTED_FEW_TIMES_A_DAY);
    expect(
      getCloudUnreportedReasonText({
        reason: CloudUnreportedReason.Cadence,
        intervalSeconds: 86400,
      }),
    ).toBe(CLOUD_UNREPORTED_ONCE_A_DAY);
    expect(
      getCloudUnreportedReasonText({
        reason: CloudUnreportedReason.NeedsAgent,
      }),
    ).toBe(CLOUD_UNREPORTED_REASON_SENTENCES[CloudUnreportedReason.NeedsAgent]);
  });

  test("a condition is one of the catalog's", () => {
    expect(isCloudKeyMetricCondition("replica")).toBe(true);
    expect(isCloudKeyMetricCondition("sometimes")).toBe(false);
    expect(isCloudKeyMetricCondition(3)).toBe(false);
  });
});

describe("whether a warning is about a metric", () => {
  const cpu: CloudResourceKeyMetric = getCloudKeyMetricsOfResource({
    provider: "aws",
    type: "AWS::EC2::Instance",
    namespace: "AWS/EC2",
  }).find((metric: CloudResourceKeyMetric): boolean => {
    return metric.name === "CPUUtilization";
  })!;
  const vmCpu: CloudResourceKeyMetric = getCloudKeyMetricsOfResource({
    provider: "azure",
    type: VM,
  }).find((metric: CloudResourceKeyMetric): boolean => {
    return metric.name === "Percentage CPU";
  })!;

  test("AWS: its namespace could not be listed in a Region", () => {
    expect(
      isCloudReadWarningAbout({
        warning: "Could not list AWS/EC2 in us-east-1: Throttling",
        metric: cpu,
      }),
    ).toBe(true);
    expect(
      isCloudReadWarningAbout({
        warning: "Could not list AWS/EC2Spot in us-east-1",
        metric: cpu,
      }),
    ).toBe(false);
  });

  test("Azure: the metric, as a whole name, could not be read; or its type's definitions could not", () => {
    expect(
      isCloudReadWarningAbout({
        warning:
          "Azure Monitor could not read Percentage CPU of 3 resources: Throttled",
        metric: vmCpu,
      }),
    ).toBe(true);
    expect(
      isCloudReadWarningAbout({
        warning:
          "Azure Monitor could not read Percentage CPU Credits of 3 resources",
        metric: vmCpu,
      }),
    ).toBe(false);
    expect(
      isCloudReadWarningAbout({
        warning: `Could not read which metrics ${VM} publishes: Forbidden`,
        metric: vmCpu,
        type: VM,
      }),
    ).toBe(true);
    expect(
      isCloudReadWarningAbout({
        warning:
          "Could not read which metrics Microsoft.Sql/servers/databases publishes",
        metric: vmCpu,
        type: VM,
      }),
    ).toBe(false);
  });
});

describe("the server's answer, read", () => {
  test("each report with its reasons; what is not one is dropped", () => {
    expect(
      readCloudUnreportedKeyMetricReports({
        metrics: [
          {
            key: "percentage cpu",
            name: "Percentage CPU",
            lastReportedAt: "2026-11-19T10:00:00Z",
            isNeverReported: false,
            reasons: [
              { reason: "condition", condition: "burstable" },
              {
                reason: "cadence",
                intervalSeconds: 300,
                readEverySeconds: 900,
              },
              { reason: "streamed", fix: "cloud-connect" },
              { reason: "made-up" },
              { reason: "condition", condition: "made-up" },
              "nope",
            ],
          },
          { key: "", name: "No key" },
          {
            key: "never",
            name: "Never",
            lastReportedAt: "not a time",
            isNeverReported: true,
          },
          null,
        ],
      }),
    ).toEqual([
      {
        key: "percentage cpu",
        name: "Percentage CPU",
        lastReportedAt: "2026-11-19T10:00:00.000Z",
        isNeverReported: false,
        reasons: [
          {
            reason: CloudUnreportedReason.Condition,
            condition: CloudKeyMetricCondition.Burstable,
          },
          {
            reason: CloudUnreportedReason.Cadence,
            intervalSeconds: 300,
            readEverySeconds: 900,
          },
          { reason: CloudUnreportedReason.Streamed, fix: "cloud-connect" },
          { reason: CloudUnreportedReason.Condition },
        ],
      },
      {
        key: "never",
        name: "Never",
        lastReportedAt: null,
        isNeverReported: true,
        reasons: [],
      },
    ]);
    expect(readCloudUnreportedKeyMetricReports(undefined)).toEqual([]);
    expect(readCloudUnreportedKeyMetricReports({ metrics: "x" })).toEqual([]);
  });
});

describe("the catalog's conditions", () => {
  test("every condition has a reason a person reads, and every Azure and Google Cloud condition is one of them", () => {
    for (const condition of Object.values(CloudKeyMetricCondition)) {
      expect(CLOUD_KEY_METRIC_CONDITION_REASONS[condition]).toMatch(/\.$/);
    }

    for (const entry of AZURE_KEY_METRICS) {
      for (const metric of entry.metrics) {
        if (metric.onlyWhen) {
          expect(isCloudKeyMetricCondition(metric.onlyWhen)).toBe(true);
        }
      }
    }

    for (const entry of GCP_KEY_METRICS) {
      for (const metric of entry.metrics) {
        if (metric.onlyWhen) {
          expect(isCloudKeyMetricCondition(metric.onlyWhen)).toBe(true);
        }
      }
    }
  });

  test("the conditions the issue names are filed: burstable credits, a replica's lag, a Basic load balancer's metrics", () => {
    expect(
      getAzureKeyMetrics(VM)!.metrics.find((metric: { name: string }) => {
        return metric.name === "CPU Credits Remaining";
      })?.onlyWhen,
    ).toBe(CloudKeyMetricCondition.Burstable);
    expect(
      getAwsKeyMetrics("AWS/RDS")!.metrics.find(
        (metric: { metricName: string }) => {
          return metric.metricName === "ReplicaLag";
        },
      )?.onlyWhen,
    ).toBe(CloudKeyMetricCondition.Replica);
    expect(
      getAzureKeyMetrics("Microsoft.Network/loadBalancers")!.metrics.every(
        (metric: { onlyWhen?: CloudKeyMetricCondition | undefined }) => {
          return metric.onlyWhen === CloudKeyMetricCondition.Tier;
        },
      ),
    ).toBe(true);
    expect(CloudProvider.Azure).toBe("azure");
  });
});
