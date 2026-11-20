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
  AZURE_FIVE_MINUTE_GRAIN,
  AZURE_HOURLY_GRAIN,
  AZURE_KEY_METRICS,
  AZURE_SIX_HOURLY_GRAIN,
  CloudKeyMetricCadence,
  GCP_KEY_METRICS,
  GCP_OPS_AGENT,
  getAwsKeyMetrics,
  getAzureKeyMetrics,
} from "../../../Types/Cloud/CloudKeyMetrics";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import {
  CLOUD_LONGEST_READ_INTERVAL_MINUTES,
  CLOUD_UNREPORTED_FEW_TIMES_A_DAY,
  CLOUD_UNREPORTED_FIVE_MINUTES,
  CLOUD_UNREPORTED_HOURLY,
  CLOUD_UNREPORTED_ONCE_A_DAY,
  CLOUD_UNREPORTED_REASON_SENTENCES,
  CLOUD_UNREPORTED_SIX_HOURLY,
  CloudResourceKeyMetric,
  CloudUnreportedConnectionState,
  CloudUnreportedReason,
  CloudUnreportedReasonEntry,
  explainCloudUnreportedKeyMetric,
  getCloudKeyMetricKeyOfStoredName,
  getCloudKeyMetricNewestPointMaxAgeMs,
  getCloudKeyMetricsOfResource,
  getCloudUnreportedKeyMetrics,
  getCloudUnreportedReasonText,
  isCloudKeyMetricExpectedInRange,
  isCloudReadWarningAbout,
  readCloudUnreportedKeyMetricReports,
} from "../../../Types/Cloud/CloudUnreportedKeyMetrics";
import {
  AZURE_FIVE_MINUTE_CURSOR,
  AzureReadGroup,
  getAzureReadGroups,
} from "../../../Server/Utils/CloudConnection/Azure/AzureCloudConnector";
import {
  AWS_METRIC_DELAY_MS,
  MetricWindow,
  getMetricWindow,
  getMetricWindowPolicy,
} from "../../../Server/Utils/CloudConnection/CloudMetricWindows";
import { CLOUD_CONNECTION_READ_INTERVALS } from "../../../Types/CloudConnection/CloudConnectionCatalog";
import {
  CloudMetricNotRead,
  CloudMetricNotReadKind,
} from "../../../Types/Cloud/CloudResourceMetricCollection";

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

/*
 * #10026: A KEY METRIC WHOSE POINTS COME SELDOM IS NOT MISSING FROM A RANGE
 * TOO SHORT TO HOLD ONE.
 *
 * An hourly Azure metric's newest point is 2 to 3 hours old when it is
 * read, so the last hour holds none of it, and the Metrics card counted it
 * as not reported. It is counted only past its own interval and delay.
 */
describe("the key metrics a range can hold", () => {
  const MINUTE_MS: number = 60 * 1000;
  const HOUR_MS: number = 60 * MINUTE_MS;
  const NOW_MS: number = Date.parse("2026-11-19T10:00:00.000Z");
  const STORAGE: string = "Microsoft.Storage/storageAccounts";
  const SITES: string = "Microsoft.Web/sites";

  function pastHours(hours: number): { startMs: number; endMs: number } {
    return { startMs: NOW_MS - hours * HOUR_MS, endMs: NOW_MS };
  }

  function metricOf(
    provider: string,
    type: string,
    name: string,
  ): CloudResourceKeyMetric {
    return getCloudKeyMetricsOfResource({ provider, type }).find(
      (metric: CloudResourceKeyMetric): boolean => {
        return metric.name === name;
      },
    )!;
  }

  test("every marked Azure metric says how often it comes and is read, by its mark", () => {
    for (const entry of AZURE_KEY_METRICS) {
      for (const metric of getCloudKeyMetricsOfResource({
        provider: "azure",
        type: entry.type,
      })) {
        const grain: string | undefined = entry.metrics.find(
          (candidate: { name: string }): boolean => {
            return candidate.name === metric.name;
          },
        )?.grain;
        const expected: Partial<CloudResourceKeyMetric> =
          grain === AZURE_FIVE_MINUTE_GRAIN
            ? {
                intervalSeconds: 300,
                readEverySeconds: 900,
                cadence: CloudKeyMetricCadence.FiveMinutes,
              }
            : grain === AZURE_HOURLY_GRAIN
              ? {
                  intervalSeconds: 3600,
                  readEverySeconds: 3600,
                  cadence: CloudKeyMetricCadence.Hourly,
                }
              : grain === AZURE_SIX_HOURLY_GRAIN
                ? {
                    intervalSeconds: 21600,
                    readEverySeconds: 21600,
                    cadence: CloudKeyMetricCadence.SixHourly,
                  }
                : {
                    intervalSeconds: undefined,
                    readEverySeconds: undefined,
                    cadence: undefined,
                  };

        expect({
          type: entry.type,
          name: metric.name,
          intervalSeconds: metric.intervalSeconds,
          readEverySeconds: metric.readEverySeconds,
          cadence: metric.cadence,
        }).toEqual({ type: entry.type, name: metric.name, ...expected });
      }
    }
  });

  test("an AWS metric published a few times a day or once a day says so; one read at five minutes says nothing", () => {
    // Of every namespace, only the hourly and the daily ones have a cadence.
    for (const entry of AWS_KEY_METRICS) {
      for (const metric of getCloudKeyMetricsOfResource({
        provider: "aws",
        type: "",
        namespace: entry.namespace,
      })) {
        const period: number | undefined = entry.metrics.find(
          (candidate: { metricName: string }): boolean => {
            return candidate.metricName === metric.name;
          },
        )?.periodSeconds;

        expect([entry.namespace, metric.name, metric.cadence]).toEqual([
          entry.namespace,
          metric.name,
          period === 86400
            ? CloudKeyMetricCadence.Daily
            : period === 3600
              ? CloudKeyMetricCadence.FewTimesADay
              : undefined,
        ]);
      }
    }

    expect(metricOf("aws", "AWS::S3::Bucket", "BucketSizeBytes").cadence).toBe(
      CloudKeyMetricCadence.Daily,
    );
    expect(
      metricOf("aws", "AWS::CertificateManager::Certificate", "DaysToExpiry")
        .cadence,
    ).toBe(CloudKeyMetricCadence.FewTimesADay);
    expect(
      metricOf("aws", "AWS::EC2::Instance", "CPUUtilization").cadence,
    ).toBeUndefined();
    // Google Cloud's come a minute apart.
    expect(
      getCloudKeyMetricsOfResource({
        provider: "gcp",
        type: "gce_instance",
      }).every((metric: CloudResourceKeyMetric): boolean => {
        return metric.cadence === undefined;
      }),
    ).toBe(true);
  });

  test("how old the newest point can be: its delay, its interval and the reads between, at each interval", () => {
    const table: Record<string, Array<number>> = {};

    for (const cadence of Object.values(CloudKeyMetricCadence)) {
      table[cadence] = CLOUD_CONNECTION_READ_INTERVALS.map(
        (readIntervalInMinutes: number): number => {
          return (
            getCloudKeyMetricNewestPointMaxAgeMs({
              cadence,
              readIntervalInMinutes,
            }) / MINUTE_MS
          );
        },
      );
    }

    // Read every 5, 10, 15, 30 and 60 minutes.
    expect(CLOUD_CONNECTION_READ_INTERVALS).toEqual([5, 10, 15, 30, 60]);
    expect(table).toEqual({
      // 14 minutes old when read; a call every 15, 20, 15, 30 or 60 minutes.
      [CloudKeyMetricCadence.FiveMinutes]: [29, 34, 29, 44, 74],
      [CloudKeyMetricCadence.Hourly]: [185, 190, 195, 210, 240],
      [CloudKeyMetricCadence.SixHourly]: [1085, 1090, 1095, 1110, 1140],
      [CloudKeyMetricCadence.FewTimesADay]: [905, 910, 915, 930, 960],
      [CloudKeyMetricCadence.Daily]: [5045, 5050, 5055, 5070, 5100],
    });

    // Not knowing the connection's interval, the longest a connection waits.
    expect(CLOUD_LONGEST_READ_INTERVAL_MINUTES).toBe(60);
    expect(
      getCloudKeyMetricNewestPointMaxAgeMs({
        cadence: CloudKeyMetricCadence.Hourly,
      }),
    ).toBe(4 * HOUR_MS);
    expect(
      getCloudKeyMetricNewestPointMaxAgeMs({
        cadence: CloudKeyMetricCadence.Hourly,
        readIntervalInMinutes: null,
      }),
    ).toBe(4 * HOUR_MS);
  });

  test("a metric that comes every read is in any range; an hourly one in the last hour or three is not, in the last six it is", () => {
    const cpu: CloudResourceKeyMetric = metricOf("azure", VM, "Percentage CPU");
    const used: CloudResourceKeyMetric = metricOf(
      "azure",
      STORAGE,
      "UsedCapacity",
    );
    const expectedIn: (
      metric: CloudResourceKeyMetric,
      hours: number,
      readIntervalInMinutes?: number,
    ) => boolean = (
      metric: CloudResourceKeyMetric,
      hours: number,
      readIntervalInMinutes?: number,
    ): boolean => {
      return isCloudKeyMetricExpectedInRange({
        metric,
        range: pastHours(hours),
        nowMs: NOW_MS,
        readIntervalInMinutes,
      });
    };

    expect(expectedIn(cpu, 0.25)).toBe(true);
    expect(expectedIn(used, 1, 5)).toBe(false);
    expect(expectedIn(used, 3, 5)).toBe(false);
    // 3 hours and the 5 minutes between two reads.
    expect(expectedIn(used, 3 + 5 / 60, 5)).toBe(true);
    expect(expectedIn(used, 6, 5)).toBe(true);
    expect(expectedIn(used, 24, 60)).toBe(true);
    // Read every hour, its newest point can be an hour older.
    expect(expectedIn(used, 3.5, 60)).toBe(false);
    expect(expectedIn(used, 4, 60)).toBe(true);
  });

  test("an App Service app's file system is counted past 18 hours and a read, its health check past half an hour", () => {
    const fileSystem: CloudResourceKeyMetric = metricOf(
      "azure",
      SITES,
      "FileSystemUsage",
    );
    const health: CloudResourceKeyMetric = metricOf(
      "azure",
      SITES,
      "HealthCheckStatus",
    );

    for (const [hours, expected] of [
      [6, false],
      [12, false],
      [18, false],
      [18.25, true],
      [24, true],
      [24 * 7, true],
    ] as Array<[number, boolean]>) {
      expect([
        hours,
        isCloudKeyMetricExpectedInRange({
          metric: fileSystem,
          range: pastHours(hours),
          nowMs: NOW_MS,
          readIntervalInMinutes: 5,
        }),
      ]).toEqual([hours, expected]);
    }

    expect(
      isCloudKeyMetricExpectedInRange({
        metric: health,
        range: pastHours(0.25),
        nowMs: NOW_MS,
        readIntervalInMinutes: 5,
      }),
    ).toBe(false);
    expect(
      isCloudKeyMetricExpectedInRange({
        metric: health,
        range: pastHours(0.5),
        nowMs: NOW_MS,
        readIntervalInMinutes: 5,
      }),
    ).toBe(true);
    expect(
      isCloudKeyMetricExpectedInRange({
        metric: health,
        range: pastHours(1),
        nowMs: NOW_MS,
        readIntervalInMinutes: 60,
      }),
    ).toBe(false);
  });

  test("a range in the past holds a point of every whole interval its points are surely in by", () => {
    const used: CloudResourceKeyMetric = metricOf(
      "azure",
      STORAGE,
      "UsedCapacity",
    );

    // Yesterday's hour 09:00 to 10:00: long in, and an hour long.
    expect(
      isCloudKeyMetricExpectedInRange({
        metric: used,
        range: {
          startMs: NOW_MS - 25 * HOUR_MS,
          endMs: NOW_MS - 24 * HOUR_MS,
        },
        nowMs: NOW_MS,
        readIntervalInMinutes: 5,
      }),
    ).toBe(true);
    // Half an hour of it may hold no hour's start.
    expect(
      isCloudKeyMetricExpectedInRange({
        metric: used,
        range: {
          startMs: NOW_MS - 25 * HOUR_MS,
          endMs: NOW_MS - 24.5 * HOUR_MS,
        },
        nowMs: NOW_MS,
        readIntervalInMinutes: 5,
      }),
    ).toBe(false);
    // An hour that ended two hours ago may not be read yet.
    expect(
      isCloudKeyMetricExpectedInRange({
        metric: used,
        range: { startMs: NOW_MS - 3 * HOUR_MS, endMs: NOW_MS - 2 * HOUR_MS },
        nowMs: NOW_MS,
        readIntervalInMinutes: 5,
      }),
    ).toBe(false);
  });

  test("the list of what a resource did not report leaves out what its range cannot hold", () => {
    const keysIn: (data: {
      type: string;
      hours: number;
      readIntervalInMinutes?: number;
    }) => Array<string> = (data: {
      type: string;
      hours: number;
      readIntervalInMinutes?: number;
    }): Array<string> => {
      return keysOf(
        getCloudUnreportedKeyMetrics({
          provider: "azure",
          type: data.type,
          reportedMetricNames: [],
          range: pastHours(data.hours),
          nowMs: NOW_MS,
          readIntervalInMinutes: data.readIntervalInMinutes,
        }),
      );
    };

    expect(keysIn({ type: STORAGE, hours: 1 })).not.toContain("usedcapacity");
    expect(keysIn({ type: STORAGE, hours: 1 })).toContain("transactions");
    expect(keysIn({ type: STORAGE, hours: 6 })).toContain("usedcapacity");
    expect(keysIn({ type: SITES, hours: 6 })).not.toContain("filesystemusage");
    expect(keysIn({ type: SITES, hours: 24 })).toContain("filesystemusage");
    // Without a range, every key metric not reported, as before.
    expect(
      keysOf(
        getCloudUnreportedKeyMetrics({
          provider: "azure",
          type: STORAGE,
          reportedMetricNames: [],
        }),
      ),
    ).toContain("usedcapacity");
  });

  /*
   * The reads themselves, as each connection decides them
   * (CloudMetricWindows): at every read interval, at a read and just before
   * the next one, a range that ends now and that the rule says holds a
   * point does hold one of what the reads wrote - so a metric is never
   * counted as not reported because of how seldom it comes. And a range
   * of a day (a week for a daily metric) always counts it.
   */
  interface Simulated {
    name: string;
    metric: CloudResourceKeyMetric;
    periodMs: number;
    // The window a read reads now, or null.
    windowOf: (
      cursors: Record<string, string>,
      now: Date,
    ) => {
      window: MetricWindow | null;
      cursorKey: string;
    };
    // Whether the cloud published a point stamped then (ACM: twice a day).
    isPublished: (stampMs: number) => boolean;
    simulatedDays: number;
    alwaysHeldHours: number;
  }

  const SIMULATED: Array<Simulated> = [
    {
      name: "an Azure five-minute metric",
      metric: metricOf("azure", SITES, "HealthCheckStatus"),
      periodMs: 5 * MINUTE_MS,
      windowOf: (cursors: Record<string, string>, now: Date) => {
        const group: AzureReadGroup = getAzureReadGroups({ cursors, now }).get(
          AZURE_FIVE_MINUTE_CURSOR,
        )!;
        return { window: group.window, cursorKey: group.cursorKey };
      },
      isPublished: () => {
        return true;
      },
      simulatedDays: 1,
      alwaysHeldHours: 3,
    },
    {
      name: "an Azure hourly metric",
      metric: metricOf("azure", STORAGE, "UsedCapacity"),
      periodMs: HOUR_MS,
      windowOf: (cursors: Record<string, string>, now: Date) => {
        const group: AzureReadGroup = getAzureReadGroups({ cursors, now }).get(
          AZURE_HOURLY_GRAIN,
        )!;
        return { window: group.window, cursorKey: group.cursorKey };
      },
      isPublished: () => {
        return true;
      },
      simulatedDays: 3,
      alwaysHeldHours: 6,
    },
    {
      name: "an Azure six-hourly metric",
      metric: metricOf("azure", SITES, "FileSystemUsage"),
      periodMs: 6 * HOUR_MS,
      windowOf: (cursors: Record<string, string>, now: Date) => {
        const group: AzureReadGroup = getAzureReadGroups({ cursors, now }).get(
          AZURE_SIX_HOURLY_GRAIN,
        )!;
        return { window: group.window, cursorKey: group.cursorKey };
      },
      isPublished: () => {
        return true;
      },
      simulatedDays: 5,
      alwaysHeldHours: 24,
    },
    {
      name: "ACM's days to expiry, published twice a day",
      metric: metricOf(
        "aws",
        "AWS::CertificateManager::Certificate",
        "DaysToExpiry",
      ),
      periodMs: HOUR_MS,
      windowOf: (cursors: Record<string, string>, now: Date) => {
        return {
          window: getMetricWindow({
            policy: getMetricWindowPolicy({
              periodSeconds: 3600,
              delayMs: AWS_METRIC_DELAY_MS,
            }),
            cursor: cursors["3600"],
            now,
          }),
          cursorKey: "3600",
        };
      },
      isPublished: (stampMs: number): boolean => {
        return new Date(stampMs).getUTCHours() % 12 === 3;
      },
      simulatedDays: 5,
      alwaysHeldHours: 24,
    },
    {
      name: "S3's daily storage",
      metric: metricOf("aws", "AWS::S3::Bucket", "BucketSizeBytes"),
      periodMs: 24 * HOUR_MS,
      windowOf: (cursors: Record<string, string>, now: Date) => {
        return {
          window: getMetricWindow({
            policy: getMetricWindowPolicy({
              periodSeconds: 86400,
              delayMs: AWS_METRIC_DELAY_MS,
            }),
            cursor: cursors["86400"],
            now,
          }),
          cursorKey: "86400",
        };
      },
      isPublished: () => {
        return true;
      },
      simulatedDays: 12,
      alwaysHeldHours: 24 * 7,
    },
  ];

  const RANGES_IN_HOURS: Array<number> = [
    0.25,
    0.5,
    1,
    3,
    6,
    12,
    24,
    48,
    72,
    24 * 7,
  ];

  describe.each(SIMULATED)("$name", (simulated: Simulated) => {
    test.each(CLOUD_CONNECTION_READ_INTERVALS)(
      "read every %i minutes, a range the rule counts it in holds a point of it",
      (intervalInMinutes: number) => {
        const startMs: number = Date.parse("2026-11-01T00:07:00.000Z");
        const endMs: number = startMs + simulated.simulatedDays * 24 * HOUR_MS;
        const cursors: Record<string, string> = {};
        const arrived: Array<number> = [];
        let checked: number = 0;

        for (
          let at: number = startMs;
          at < endMs;
          at += intervalInMinutes * MINUTE_MS
        ) {
          const read: { window: MetricWindow | null; cursorKey: string } =
            simulated.windowOf(cursors, new Date(at));

          if (read.window) {
            for (
              let stamp: number = read.window.start.getTime();
              stamp < read.window.end.getTime();
              stamp += simulated.periodMs
            ) {
              if (simulated.isPublished(stamp)) {
                arrived.push(stamp);
              }
            }

            cursors[read.cursorKey] = read.window.end.toISOString();
          }

          // Once the first points are in.
          if (arrived.length === 0) {
            continue;
          }

          // At the read, and the minute before the next one.
          for (const nowMs of [at, at + intervalInMinutes * MINUTE_MS - 1]) {
            for (const hours of RANGES_IN_HOURS) {
              const rangeStartMs: number = nowMs - hours * HOUR_MS;

              // A range that starts before the reads did holds nothing read.
              if (rangeStartMs < startMs) {
                continue;
              }

              const isExpected: boolean = isCloudKeyMetricExpectedInRange({
                metric: simulated.metric,
                range: { startMs: rangeStartMs, endMs: nowMs },
                nowMs,
                readIntervalInMinutes: intervalInMinutes,
              });
              const holds: boolean = arrived.some((stamp: number): boolean => {
                return stamp >= rangeStartMs && stamp <= nowMs;
              });

              if (isExpected) {
                checked++;
                expect([hours, new Date(nowMs).toISOString(), holds]).toEqual([
                  hours,
                  new Date(nowMs).toISOString(),
                  true,
                ]);
              }

              if (hours >= simulated.alwaysHeldHours) {
                expect([hours, isExpected]).toEqual([hours, true]);
              }
            }
          }
        }

        expect(checked).toBeGreaterThan(0);
      },
    );
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
        cadence: CloudKeyMetricCadence.FiveMinutes,
      },
    ]);
    expect(
      explainCloudUnreportedKeyMetric({
        metric: metricOf("aws", "AWS::S3::Bucket", "BucketSizeBytes"),
        connection: healthy,
      }),
    ).toEqual([
      {
        reason: CloudUnreportedReason.Cadence,
        intervalSeconds: 86400,
        cadence: CloudKeyMetricCadence.Daily,
      },
    ]);
  });

  test("an hourly or a six-hourly Azure metric says it comes once an hour, or every 6 hours (#10026)", () => {
    expect(
      explainCloudUnreportedKeyMetric({
        metric: metricOf(
          "azure",
          "Microsoft.Storage/storageAccounts",
          "UsedCapacity",
        ),
        connection: healthy,
      }),
    ).toEqual([
      {
        reason: CloudUnreportedReason.Cadence,
        intervalSeconds: 3600,
        readEverySeconds: 3600,
        cadence: CloudKeyMetricCadence.Hourly,
      },
    ]);
    expect(
      explainCloudUnreportedKeyMetric({
        metric: metricOf("azure", "Microsoft.Web/sites", "FileSystemUsage"),
        connection: healthy,
      }),
    ).toEqual([
      {
        reason: CloudUnreportedReason.Cadence,
        intervalSeconds: 21600,
        readEverySeconds: 21600,
        cadence: CloudKeyMetricCadence.SixHourly,
      },
    ]);
    expect(
      explainCloudUnreportedKeyMetric({
        metric: metricOf(
          "aws",
          "AWS::CertificateManager::Certificate",
          "DaysToExpiry",
          "AWS/CertificateManager",
        ),
        connection: healthy,
      }),
    ).toEqual([
      {
        reason: CloudUnreportedReason.Cadence,
        intervalSeconds: 3600,
        cadence: CloudKeyMetricCadence.FewTimesADay,
      },
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

  test("what the last read could not read of the resource, in its cloud's words: not served, busy, failed - or the resource as a whole (#10291)", () => {
    const metric: CloudResourceKeyMetric = metricOf(
      "azure",
      VM,
      "Percentage CPU",
    );
    const since: string = "2026-11-19T10:00:00.000Z";
    const until: string = "2026-11-20T12:00:00.000Z";
    const notRead: (kind: CloudMetricNotReadKind) => CloudMetricNotRead = (
      kind: CloudMetricNotReadKind,
    ): CloudMetricNotRead => {
      return {
        name: "Percentage CPU",
        kind,
        error: "Azure's words",
        since,
        at: since,
        ...(kind === CloudMetricNotReadKind.Unsupported ? { until } : {}),
      };
    };

    expect(
      explainCloudUnreportedKeyMetric({
        metric,
        connection: healthy,
        notRead: notRead(CloudMetricNotReadKind.Unsupported),
      }),
    ).toEqual([
      {
        reason: CloudUnreportedReason.NotServed,
        error: "Azure's words",
        since,
        until,
      },
    ]);
    expect(
      explainCloudUnreportedKeyMetric({
        metric,
        connection: healthy,
        notRead: notRead(CloudMetricNotReadKind.Throttled),
      }),
    ).toEqual([
      {
        reason: CloudUnreportedReason.CloudBusy,
        error: "Azure's words",
        since,
      },
    ]);
    expect(
      explainCloudUnreportedKeyMetric({
        metric,
        connection: healthy,
        notRead: notRead(CloudMetricNotReadKind.Failed),
      }),
    ).toEqual([
      {
        reason: CloudUnreportedReason.ReadFailed,
        fix: "cloud-connect",
        error: "Azure's words",
        since,
      },
    ]);
    // The resource as a whole goes first.
    expect(
      explainCloudUnreportedKeyMetric({
        metric,
        connection: healthy,
        resourceFailure: { error: "HTTP 529", since },
        notRead: notRead(CloudMetricNotReadKind.Throttled),
      }),
    ).toEqual([
      {
        reason: CloudUnreportedReason.ReadFailed,
        fix: "cloud-connect",
        error: "HTTP 529",
        since,
      },
    ]);
    // A connection off, refused or failed says that instead.
    expect(
      reasonsOf(
        explainCloudUnreportedKeyMetric({
          metric,
          connection: { isEnabled: false },
          notRead: notRead(CloudMetricNotReadKind.Unsupported),
        }),
      ),
    ).toEqual([CloudUnreportedReason.ConnectionOff]);
    expect(
      explainCloudUnreportedKeyMetric({
        metric,
        connection: {
          isEnabled: true,
          lastReadStatus: "failed",
          lastReadFailureKind: "unavailable",
        },
        notRead: notRead(CloudMetricNotReadKind.Unsupported),
      }),
    ).toEqual([
      { reason: CloudUnreportedReason.ReadFailed, fix: "cloud-connect" },
    ]);
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
    // Said by how often it comes, which an hourly Azure metric's says apart.
    expect(
      getCloudUnreportedReasonText({
        reason: CloudUnreportedReason.Cadence,
        intervalSeconds: 3600,
        cadence: CloudKeyMetricCadence.Hourly,
      }),
    ).toBe(CLOUD_UNREPORTED_HOURLY);
    expect(
      getCloudUnreportedReasonText({
        reason: CloudUnreportedReason.Cadence,
        intervalSeconds: 21600,
        cadence: CloudKeyMetricCadence.SixHourly,
      }),
    ).toBe(CLOUD_UNREPORTED_SIX_HOURLY);
    expect(
      getCloudUnreportedReasonText({
        reason: CloudUnreportedReason.Cadence,
        intervalSeconds: 3600,
        cadence: CloudKeyMetricCadence.FewTimesADay,
      }),
    ).toBe(CLOUD_UNREPORTED_FEW_TIMES_A_DAY);

    // Every cadence has its sentence, each its own.
    const sentences: Set<string> = new Set<string>();

    for (const cadence of Object.values(CloudKeyMetricCadence)) {
      const sentence: string = getCloudUnreportedReasonText({
        reason: CloudUnreportedReason.Cadence,
        cadence,
      });

      expect(sentence.length).toBeGreaterThan(10);
      sentences.add(sentence);
    }

    expect(sentences.size).toBe(Object.values(CloudKeyMetricCadence).length);
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

  test("a reason's cloud words and times are read with it; ones that are not are left out (#10291)", () => {
    expect(
      readCloudUnreportedKeyMetricReports({
        metrics: [
          {
            key: "bytehitratio",
            name: "ByteHitRatio",
            lastReportedAt: null,
            isNeverReported: true,
            reasons: [
              {
                reason: "not-served",
                error: "Sampling type is not found.",
                since: "2026-11-19T10:00:00Z",
                until: "2026-11-20T10:00:00Z",
              },
              {
                reason: "cloud-busy",
                error: "   ",
                since: "not a time",
                until: 12,
              },
            ],
          },
        ],
      })[0]!.reasons,
    ).toEqual([
      {
        reason: CloudUnreportedReason.NotServed,
        error: "Sampling type is not found.",
        since: "2026-11-19T10:00:00.000Z",
        until: "2026-11-20T10:00:00.000Z",
      },
      { reason: CloudUnreportedReason.CloudBusy },
    ]);
  });

  test("a cadence is read with its reason, one it does not know is left out (#10026)", () => {
    expect(
      readCloudUnreportedKeyMetricReports({
        metrics: [
          {
            key: "usedcapacity",
            name: "UsedCapacity",
            lastReportedAt: null,
            isNeverReported: false,
            reasons: [
              {
                reason: "cadence",
                intervalSeconds: 3600,
                readEverySeconds: 3600,
                cadence: "hourly",
              },
              { reason: "cadence", intervalSeconds: 60, cadence: "weekly" },
              { reason: "cadence", intervalSeconds: 60, cadence: 7 },
            ],
          },
        ],
      })[0]?.reasons,
    ).toEqual([
      {
        reason: CloudUnreportedReason.Cadence,
        intervalSeconds: 3600,
        readEverySeconds: 3600,
        cadence: CloudKeyMetricCadence.Hourly,
      },
      { reason: CloudUnreportedReason.Cadence, intervalSeconds: 60 },
      { reason: CloudUnreportedReason.Cadence, intervalSeconds: 60 },
    ]);
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
