import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  AWS_KEY_METRICS,
  AZURE_KEY_METRICS,
  AZURE_MAX_METRICS_PER_RESOURCE,
  AwsKeyMetric,
  AwsNamespaceKeyMetrics,
  AzureKeyMetric,
  AzureTypeKeyMetrics,
  GCP_KEY_METRICS,
  GcpKeyMetric,
  GcpTypeKeyMetrics,
  getAwsKeyMetrics,
  getAwsProbeMetricNames,
} from "../../../Types/Cloud/CloudKeyMetrics";
import {
  SelectedMetric,
  pickAzureGrain,
  selectAzureMetrics,
} from "../../../Server/Utils/CloudConnection/Azure/AzureCloudConnector";
import { AzureMetricDefinition } from "../../../Server/Utils/CloudConnection/Azure/AzureArm";

/*
 * EVERY KEY METRIC, HELD TO ITS CLOUD'S OWN REFERENCE.
 *
 * A key metric a cloud does not publish under that name reads nothing,
 * silently; one read with the wrong aggregation or unit reads the wrong
 * number. So every entry of CloudKeyMetrics is held here to the provider's
 * documentation, copied into ProviderMetricReference/ as the provider
 * publishes it (each file says where from, and when it was read):
 *
 *   - Azure: Microsoft's "Supported metrics" table of each type, generated
 *     by Microsoft from Azure Monitor's own metric definitions - each
 *     metric's REST API name, unit, aggregations, time grains, whether a
 *     diagnostic setting can export it, and whether it is a paid advanced
 *     platform metric.
 *   - Google Cloud: the metrics list of Cloud Monitoring - each metric
 *     type's launch stage, kind, value type, unit and monitored resources.
 *   - AWS: each service's CloudWatch metrics page - each metric's name,
 *     unit, statistics, dimensions, and whether it needs a paid or opt-in
 *     feature.
 *
 * To refresh a reference, read the provider's table again and replace the
 * rows of the metrics the catalog reads; a new key metric needs its row.
 */

interface AzureReferenceMetric {
  displayName: string;
  unit: string;
  aggregations: Array<string>;
  timeGrains: Array<string>;
  dsExport: boolean;
  advanced: boolean;
}

interface AzureReference {
  source: string;
  readOn: string;
  types: Record<
    string,
    {
      page: string;
      pageDate: string;
      metrics: Record<string, AzureReferenceMetric>;
    }
  >;
}

interface GcpReferenceMetric {
  displayName: string;
  launchStage: string;
  kind: string;
  valueType: string;
  unit: string;
  monitoredResources: Array<string>;
  page: string;
}

interface GcpReference {
  source: string;
  readOn: string;
  metrics: Record<string, GcpReferenceMetric>;
}

function readReference<T>(file: string): T {
  return JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "ProviderMetricReference", file),
      "utf8",
    ),
  ) as T;
}

const AZURE: AzureReference = readReference<AzureReference>(
  "AzureMonitorSupportedMetrics.json",
);
const GCP: GcpReference = readReference<GcpReference>(
  "GoogleCloudMonitoringMetrics.json",
);

// A display name Microsoft marks deprecated: "(deprecated) Server Side Latency".
const DEPRECATED: RegExp = /deprecated/i;

// Azure Monitor's time grains, as seconds.
const GRAIN_SECONDS: Record<string, number> = {
  PT1M: 60,
  PT5M: 300,
  PT15M: 900,
  PT30M: 1800,
  PT1H: 3600,
  PT6H: 21600,
  PT12H: 43200,
  P1D: 86400,
};

/*
 * Metrics Microsoft marks deprecated that a type still reads, each for a
 * reason: an Azure Cosmos DB account's ServerSideLatency is its headline
 * latency tile (CloudResourceHealth), beside the two that replace it.
 */
const AZURE_DEPRECATED_KEPT: Record<string, Array<string>> = {
  "Microsoft.DocumentDB/databaseAccounts": ["ServerSideLatency"],
};

/*
 * Metrics marked as a diagnostic setting cannot export though Microsoft's
 * table now says it can (see AZURE_VM_NETWORK_TOTALS in CloudKeyMetrics):
 * the read keeps writing them, and a stream that sends them is left alone.
 */
const AZURE_KEPT_FROM_STREAMS: Record<string, Array<string>> = {
  "Microsoft.Compute/virtualMachines": [
    "Network In Total",
    "Network Out Total",
  ],
  "Microsoft.Compute/virtualMachineScaleSets": [
    "Network In Total",
    "Network Out Total",
  ],
};

function azureReferenceOf(type: string): AzureReference["types"][string] {
  const reference: AzureReference["types"][string] | undefined =
    AZURE.types[type];

  expect({ type, documented: Boolean(reference) }).toEqual({
    type,
    documented: true,
  });

  return reference!;
}

describe("Azure key metrics, as Microsoft's supported-metrics tables document them", () => {
  test("the reference says where it is from and when it was read", () => {
    expect(AZURE.source).toContain("supported-metrics");
    expect(AZURE.readOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("every type the read reads has its table, and the table no type the read does not", () => {
    expect(
      AZURE_KEY_METRICS.map((entry: AzureTypeKeyMetrics): string => {
        return entry.type;
      }).sort(),
    ).toEqual(Object.keys(AZURE.types).sort());
  });

  test("every key metric is in its type's table, spelled as Azure Monitor's REST API names it", () => {
    for (const entry of AZURE_KEY_METRICS) {
      const documented: Array<string> = Object.keys(
        azureReferenceOf(entry.type).metrics,
      );

      for (const metric of entry.metrics) {
        expect({
          type: entry.type,
          metric: metric.name,
          documented: true,
        }).toEqual({
          type: entry.type,
          metric: metric.name,
          documented: documented.includes(metric.name),
        });
      }

      // The reference holds the key metrics' rows, and no other.
      expect(documented.sort()).toEqual(
        entry.metrics
          .map((metric: AzureKeyMetric): string => {
            return metric.name;
          })
          .sort(),
      );
    }
  });

  test("no key metric is a paid advanced platform metric", () => {
    for (const entry of AZURE_KEY_METRICS) {
      for (const [metric, row] of Object.entries(
        azureReferenceOf(entry.type).metrics,
      )) {
        expect({ type: entry.type, metric, advanced: row.advanced }).toEqual({
          type: entry.type,
          metric,
          advanced: false,
        });
      }
    }
  });

  test("no key metric is one Microsoft deprecates, but the few kept for a reason", () => {
    for (const entry of AZURE_KEY_METRICS) {
      for (const [metric, row] of Object.entries(
        azureReferenceOf(entry.type).metrics,
      )) {
        const isDeprecated: boolean = DEPRECATED.test(row.displayName);

        expect({ type: entry.type, metric, isDeprecated }).toEqual({
          type: entry.type,
          metric,
          isDeprecated: (AZURE_DEPRECATED_KEPT[entry.type] || []).includes(
            metric,
          ),
        });
      }
    }
  });

  test("each is read at a grain Azure Monitor offers it at, and a type at one grain finer than an hour at most: one call a read", () => {
    for (const entry of AZURE_KEY_METRICS) {
      const subHourly: Set<string> = new Set<string>();

      for (const [metric, row] of Object.entries(
        azureReferenceOf(entry.type).metrics,
      )) {
        const grain: string | undefined = pickAzureGrain(
          row.timeGrains.map((timeGrain: string): string => {
            // Recovery Services writes a day as PT24H.
            return timeGrain === "PT24H" ? "P1D" : timeGrain;
          }),
        );

        expect({ type: entry.type, metric, readable: Boolean(grain) }).toEqual({
          type: entry.type,
          metric,
          readable: true,
        });

        if (grain && GRAIN_SECONDS[grain]! < 3600) {
          subHourly.add(grain);
        }
      }

      expect({ type: entry.type, grains: subHourly.size <= 1 }).toEqual({
        type: entry.type,
        grains: true,
      });
    }
  });

  test("the read selects every key metric a resource publishes as documented, in one call's worth", () => {
    for (const entry of AZURE_KEY_METRICS) {
      const definitions: Array<AzureMetricDefinition> = Object.entries(
        azureReferenceOf(entry.type).metrics,
      ).map(
        ([name, row]: [
          string,
          AzureReferenceMetric,
        ]): AzureMetricDefinition => {
          return {
            name,
            unit: row.unit,
            primaryAggregationType: row.aggregations[0]!,
            timeGrains: row.timeGrains,
          };
        },
      );
      const selected: Array<SelectedMetric> = selectAzureMetrics(
        entry,
        definitions,
      );

      expect(selected.length).toBeLessThanOrEqual(
        AZURE_MAX_METRICS_PER_RESOURCE,
      );
      expect(
        selected.map((metric: SelectedMetric): string => {
          return metric.name;
        }),
      ).toEqual(
        entry.metrics.map((metric: AzureKeyMetric): string => {
          return metric.name;
        }),
      );

      // Each with Microsoft's own unit, and an aggregation it documents.
      for (const metric of selected) {
        const row: AzureReferenceMetric = azureReferenceOf(entry.type).metrics[
          metric.name
        ]!;

        expect(metric.unit).toBe(row.unit);
        expect(row.aggregations).toContain(metric.aggregation);
      }
    }
  });

  test("every key metric Microsoft marks No under DS Export is marked so, and the marks name no other but the kept ones", () => {
    for (const entry of AZURE_KEY_METRICS) {
      const notExported: Array<string> = Object.entries(
        azureReferenceOf(entry.type).metrics,
      )
        .filter(([, row]: [string, AzureReferenceMetric]): boolean => {
          return !row.dsExport;
        })
        .map(([name]: [string, AzureReferenceMetric]): string => {
          return name;
        });

      expect({
        type: entry.type,
        marked: [...(entry.notExportedByDiagnosticSettings || [])].sort(),
      }).toEqual({
        type: entry.type,
        marked: [
          ...notExported,
          ...(AZURE_KEPT_FROM_STREAMS[entry.type] || []),
        ].sort(),
      });
    }
  });
});

/*
 * The unit of a Cloud Monitoring metric once aligned: a gauge's mean or
 * maximum and a distribution's percentile keep the metric's unit, and a
 * count's rate is that unit a second. A percentage written as a fraction
 * ("10^2.%": a hundred percent, so 0.25 is 25%) is the plain number "1".
 */
function getAlignedGcpUnit(row: GcpReferenceMetric, aligner: string): string {
  const unit: string = row.unit === "10^2.%" ? "1" : row.unit;

  return aligner === "ALIGN_RATE" ? `${unit}/s` : unit;
}

// The aligners each kind and value type of metric can be read with.
function getGcpAligners(row: GcpReferenceMetric): Array<string> {
  if (row.valueType === "DISTRIBUTION") {
    return ["ALIGN_PERCENTILE_95"];
  }

  if (row.valueType !== "INT64" && row.valueType !== "DOUBLE") {
    // A BOOL or STRING metric has no number a read writes.
    return [];
  }

  return row.kind === "GAUGE" ? ["ALIGN_MEAN", "ALIGN_MAX"] : ["ALIGN_RATE"];
}

/*
 * A Cloud Monitoring metric Google deprecates that a type still reads, for
 * a reason: a Pub/Sub topic's publish operations are its headline tile,
 * and their replacement, a count of topic/message_sizes, is a distribution
 * count the read cannot take yet.
 */
const GCP_DEPRECATED_KEPT: Array<string> = [
  "pubsub.googleapis.com/topic/send_message_operation_count",
];

function gcpReferenceOf(metricType: string): GcpReferenceMetric {
  const reference: GcpReferenceMetric | undefined = GCP.metrics[metricType];

  expect({ metricType, documented: Boolean(reference) }).toEqual({
    metricType,
    documented: true,
  });

  return reference!;
}

describe("Google Cloud key metrics, as Cloud Monitoring's metrics list documents them", () => {
  test("the reference says where it is from and when it was read", () => {
    expect(GCP.source).toContain("cloud.google.com/monitoring/api/metrics");
    expect(GCP.readOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("every metric type read is in the list, and the reference holds no other", () => {
    const read: Set<string> = new Set<string>();

    for (const entry of GCP_KEY_METRICS) {
      for (const metric of entry.metrics) {
        gcpReferenceOf(metric.metricType);
        read.add(metric.metricType);
      }
    }

    expect(Array.from(read).sort()).toEqual(Object.keys(GCP.metrics).sort());
  });

  test("each is generally available or in beta, but the deprecated ones kept for a reason", () => {
    for (const entry of GCP_KEY_METRICS) {
      for (const metric of entry.metrics) {
        const stage: string = gcpReferenceOf(metric.metricType).launchStage;

        expect({ metric: metric.metricType, stage }).toEqual({
          metric: metric.metricType,
          stage: GCP_DEPRECATED_KEPT.includes(metric.metricType)
            ? "DEPRECATED"
            : expect.stringMatching(/^(GA|BETA)$/),
        });
      }
    }
  });

  test("each is a metric of the resource type it is listed under", () => {
    for (const entry of GCP_KEY_METRICS) {
      for (const metric of entry.metrics) {
        expect({
          type: entry.resourceType,
          metric: metric.metricType,
          reported: gcpReferenceOf(
            metric.metricType,
          ).monitoredResources.includes(entry.resourceType),
        }).toEqual({
          type: entry.resourceType,
          metric: metric.metricType,
          reported: true,
        });
      }
    }
  });

  test("each is aligned as its kind allows - a gauge's mean or maximum, a count's rate, a distribution's 95th percentile - in the unit that gives", () => {
    for (const entry of GCP_KEY_METRICS) {
      for (const metric of entry.metrics) {
        const row: GcpReferenceMetric = gcpReferenceOf(metric.metricType);

        expect({
          metric: metric.metricType,
          allowed: getGcpAligners(row).includes(metric.aligner),
        }).toEqual({ metric: metric.metricType, allowed: true });
        expect({ metric: metric.metricType, unit: metric.unit }).toEqual({
          metric: metric.metricType,
          unit: getAlignedGcpUnit(row, metric.aligner),
        });
      }
    }
  });

  test("a metric type listed under two resource types is read the same way for both", () => {
    const byType: Map<string, GcpKeyMetric> = new Map();

    for (const entry of GCP_KEY_METRICS as ReadonlyArray<GcpTypeKeyMetrics>) {
      for (const metric of entry.metrics) {
        const earlier: GcpKeyMetric | undefined = byType.get(metric.metricType);

        if (earlier) {
          expect(metric).toEqual(earlier);
        }

        byType.set(metric.metricType, metric);
      }
    }
  });
});

/*
 * ---- AWS: each service's CloudWatch metrics page -------------------------
 *
 * Several services' pages give no unit or no statistics for a metric (a
 * load balancer's, Lambda's, RDS's): a fact the page does not give is
 * null in the reference, and only what a page does give is held here.
 */

interface AwsReferenceMetric {
  exists: boolean;
  exactName: string;
  unit: string | null;
  statistics: Array<string> | null;
  // Whether a series with only the namespace's identity dimensions exists.
  identitySeries: boolean | null;
  publishedBy: string | null;
  page: string;
}

interface AwsReference {
  source: string;
  readOn: string;
  namespaces: Record<
    string,
    { pages: Array<string>; metrics: Record<string, AwsReferenceMetric> }
  >;
}

const AWS: AwsReference = readReference<AwsReference>(
  "AwsCloudWatchMetrics.json",
);

/*
 * A page's unit that is a description, not the unit CloudWatch publishes
 * the metric with, which the read writes on it: a T instance's
 * CPUCreditBalance is "Credits (vCPU-minutes)" on the page, a VPN tunnel's
 * TunnelState "Fractional value between 0 and 1", a certificate's
 * DaysToExpiry "Integer".
 */
const AWS_UNIT_AS_PUBLISHED: Record<string, Record<string, string>> = {
  "AWS/EC2": { CPUCreditBalance: "Count" },
  "AWS/VPN": { TunnelState: "None" },
  "AWS/CertificateManager": { DaysToExpiry: "None" },
};

/*
 * A statistic the read reads that the page does not call the most useful,
 * each for a reason: a Classic Load Balancer's UnHealthyHostCount is read
 * at its Maximum, the most hosts out in a period, as its health rule
 * judges it; API Gateway counts each request as 1, so the Sum of Count is
 * its SampleCount, read as every other count is.
 */
const AWS_STATISTIC_KEPT: Record<string, Record<string, string>> = {
  "AWS/ELB": { UnHealthyHostCount: "Maximum" },
  "AWS/ApiGateway": { Count: "Sum" },
};

/*
 * Metrics with no series on the namespace's identity dimensions alone,
 * read on the fewest dimensions they have (AwsCloudConnector): S3's daily
 * storage by bucket and storage type, and an MSK cluster's per-broker
 * metrics, a series per broker.
 */
const AWS_READ_ON_MORE_DIMENSIONS: Record<string, Array<string>> = {
  "AWS/S3": ["BucketSizeBytes", "NumberOfObjects"],
  "AWS/Kafka": [
    "UnderReplicatedPartitions",
    "KafkaDataLogsDiskUsed",
    "CpuUser",
  ],
};

function awsReferenceOf(namespace: string, metric: string): AwsReferenceMetric {
  const reference: AwsReferenceMetric | undefined =
    AWS.namespaces[namespace]?.metrics[metric];

  expect({ namespace, metric, documented: Boolean(reference) }).toEqual({
    namespace,
    metric,
    documented: true,
  });

  return reference!;
}

describe("AWS key metrics, as each service's CloudWatch metrics page documents them", () => {
  test("the reference says where it is from and when it was read", () => {
    expect(AWS.source).toContain("docs.aws.amazon.com");
    expect(AWS.readOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    for (const [namespace, entry] of Object.entries(AWS.namespaces)) {
      expect({ namespace, pages: entry.pages.length > 0 }).toEqual({
        namespace,
        pages: true,
      });

      for (const page of entry.pages) {
        expect(page).toMatch(/^https:\/\/docs\.aws\.amazon\.com\//);
      }
    }
  });

  test("every namespace read has its page, and the reference holds the key metrics' rows alone", () => {
    expect(
      AWS_KEY_METRICS.map((entry: AwsNamespaceKeyMetrics): string => {
        return entry.namespace;
      }).sort(),
    ).toEqual(Object.keys(AWS.namespaces).sort());

    for (const entry of AWS_KEY_METRICS) {
      expect(
        Object.keys(AWS.namespaces[entry.namespace]!.metrics).sort(),
      ).toEqual(
        entry.metrics
          .map((metric: AwsKeyMetric): string => {
            return metric.metricName;
          })
          .sort(),
      );
    }
  });

  test("every key metric exists under exactly that name", () => {
    for (const entry of AWS_KEY_METRICS) {
      for (const metric of entry.metrics) {
        const row: AwsReferenceMetric = awsReferenceOf(
          entry.namespace,
          metric.metricName,
        );

        expect({ metric: metric.metricName, exists: row.exists }).toEqual({
          metric: metric.metricName,
          exists: true,
        });
        expect(row.exactName).toBe(metric.metricName);
        expect(row.page).toMatch(/^https:\/\/docs\.aws\.amazon\.com\//);
      }
    }
  });

  test("each is written in the unit its page gives, where it gives one", () => {
    for (const entry of AWS_KEY_METRICS) {
      for (const metric of entry.metrics) {
        const row: AwsReferenceMetric = awsReferenceOf(
          entry.namespace,
          metric.metricName,
        );
        const published: string | undefined =
          AWS_UNIT_AS_PUBLISHED[entry.namespace]?.[metric.metricName];

        if (published !== undefined) {
          expect(metric.unit).toBe(published);
          // The exception names a page that does give another unit.
          expect(row.unit).not.toBe(published);
          continue;
        }

        if (row.unit !== null) {
          expect({
            namespace: entry.namespace,
            metric: metric.metricName,
            unit: metric.unit,
          }).toEqual({
            namespace: entry.namespace,
            metric: metric.metricName,
            unit: row.unit,
          });
        }
      }
    }
  });

  test("each is read with a statistic its page names, where it names some", () => {
    for (const entry of AWS_KEY_METRICS) {
      for (const metric of entry.metrics) {
        const row: AwsReferenceMetric = awsReferenceOf(
          entry.namespace,
          metric.metricName,
        );
        const kept: string | undefined =
          AWS_STATISTIC_KEPT[entry.namespace]?.[metric.metricName];

        if (kept !== undefined) {
          expect(metric.statistic).toBe(kept);
          expect(row.statistics || []).not.toContain(kept);
          continue;
        }

        // "All": the page says any statistic applies.
        if (row.statistics && !row.statistics.includes("All")) {
          expect({
            namespace: entry.namespace,
            metric: metric.metricName,
            documented: row.statistics.includes(metric.statistic),
          }).toEqual({
            namespace: entry.namespace,
            metric: metric.metricName,
            documented: true,
          });
        }
      }
    }
  });

  test("none needs a paid or opt-in feature turned on", () => {
    for (const entry of AWS_KEY_METRICS) {
      for (const metric of entry.metrics) {
        expect({
          namespace: entry.namespace,
          metric: metric.metricName,
          publishedBy: awsReferenceOf(entry.namespace, metric.metricName)
            .publishedBy,
        }).toEqual({
          namespace: entry.namespace,
          metric: metric.metricName,
          publishedBy: expect.stringMatching(
            /^(default|only-when-nonzero|only-some-resources)$/,
          ),
        });
      }
    }
  });

  test("each has a series on its namespace's identity dimensions alone, but those read on more", () => {
    for (const entry of AWS_KEY_METRICS) {
      for (const metric of entry.metrics) {
        const identitySeries: boolean | null = awsReferenceOf(
          entry.namespace,
          metric.metricName,
        ).identitySeries;
        const onMore: boolean = (
          AWS_READ_ON_MORE_DIMENSIONS[entry.namespace] || []
        ).includes(metric.metricName);

        expect({
          namespace: entry.namespace,
          metric: metric.metricName,
          identitySeries: onMore ? false : identitySeries !== false,
        }).toEqual({
          namespace: entry.namespace,
          metric: metric.metricName,
          identitySeries: onMore ? identitySeries : true,
        });
      }
    }
  });

  test("a namespace is swept for with metrics it reads, its first metric first", () => {
    for (const entry of AWS_KEY_METRICS) {
      const probes: Array<string> = getAwsProbeMetricNames(entry);

      expect(probes[0]).toBe(entry.metrics[0]!.metricName);

      for (const probe of probes) {
        expect(
          entry.metrics.some((metric: AwsKeyMetric): boolean => {
            return metric.metricName === probe;
          }),
        ).toBe(true);
      }
    }

    // An Amazon MQ broker's CPU, whichever engine it runs.
    expect(getAwsProbeMetricNames(getAwsKeyMetrics("AWS/AmazonMQ")!)).toEqual([
      "CpuUtilization",
      "SystemCpuUtilization",
    ]);
  });
});
