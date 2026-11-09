import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import {
  AWS_DEFAULT_PERIOD_SECONDS,
  AWS_KEY_METRICS,
  AZURE_DIMENSION_ATTRIBUTE_PREFIX,
  AZURE_ENTITY_NAME_ATTRIBUTE,
  AZURE_ENTITY_NAME_DIMENSION,
  AZURE_KEY_METRICS,
  AZURE_MAX_METRICS_PER_RESOURCE,
  AZURE_MAX_SPLIT_SERIES_PER_METRIC,
  AwsKeyMetric,
  AwsNamespaceKeyMetrics,
  AzureTypeKeyMetrics,
  DAILY_PERIOD_SECONDS,
  HOURLY_PERIOD_SECONDS,
  GCP_KEY_METRICS,
  GcpKeyMetric,
  GcpTypeKeyMetrics,
  getAwsKeyMetrics,
  getAwsNamespaceOfType,
  getAwsStoredMetricName,
  getAzureKeyMetrics,
  getAzureStoredMetricName,
  getGcpKeyMetricTypes,
  getKeyMetricCount,
  isAzureKeyMetricStoredName,
} from "../../../Types/Cloud/CloudKeyMetrics";
import { MESSAGE_QUEUE_METRICS } from "../../../Types/MessageQueue/MessageQueueMetricCatalog";
import {
  AWS_CLOUDWATCH_DISCOVERY_NAMESPACES,
  getCloudResourceTypeDescriptor,
  getGcpMonitoredResourceRule,
} from "../../../Types/Cloud/CloudResourceCatalog";
import {
  AWS_CLOUDWATCH_METRIC_NAME_PREFIX,
  getCloudMonitoringSource,
  CloudMonitoringSource,
} from "../../../Types/Cloud/CloudMonitoredResource";
import { describe, expect, test } from "@jest/globals";

/*
 * The key metrics a cloud connection reads are tied to the resource
 * catalog the ingest discovers resources with: every AWS namespace read is
 * one the catalog has a rule for, every Azure and Google Cloud type is one
 * it lists. And each stored name is the one the cloud's collector receiver
 * writes, so a resource's metrics read the same whichever way they came.
 */

describe("AWS", () => {
  test("every namespace read is one a Cloud Resource can be found from", () => {
    for (const entry of AWS_KEY_METRICS) {
      expect({
        namespace: entry.namespace,
        known: AWS_CLOUDWATCH_DISCOVERY_NAMESPACES.includes(entry.namespace),
      }).toEqual({ namespace: entry.namespace, known: true });
    }
  });

  test("no namespace twice, none without metrics, no metric twice", () => {
    const namespaces: Array<string> = AWS_KEY_METRICS.map(
      (entry: AwsNamespaceKeyMetrics): string => {
        return entry.namespace;
      },
    );

    expect(new Set(namespaces).size).toBe(namespaces.length);

    for (const entry of AWS_KEY_METRICS) {
      expect(entry.metrics.length).toBeGreaterThan(0);
      const names: Array<string> = entry.metrics.map(
        (metric: AwsKeyMetric): string => {
          return metric.metricName;
        },
      );
      expect(new Set(names).size).toBe(names.length);
    }
  });

  test("each metric reads one statistic, every 5 minutes, once an hour or once a day", () => {
    for (const entry of AWS_KEY_METRICS) {
      for (const metric of entry.metrics) {
        expect(["Average", "Sum", "Maximum", "Minimum"]).toContain(
          metric.statistic,
        );
        expect([
          AWS_DEFAULT_PERIOD_SECONDS,
          HOURLY_PERIOD_SECONDS,
          DAILY_PERIOD_SECONDS,
        ]).toContain(metric.periodSeconds);
        expect(metric.unit.length).toBeGreaterThan(0);
      }
    }

    // S3's storage figures are published once a day.
    expect(
      getAwsKeyMetrics("AWS/S3")!.metrics.map((metric: AwsKeyMetric) => {
        return metric.periodSeconds;
      }),
    ).toEqual([DAILY_PERIOD_SECONDS, DAILY_PERIOD_SECONDS]);
    expect(HOURLY_PERIOD_SECONDS).toBe(3600);
  });

  /*
   * ACM publishes DaysToExpiry twice a day for every certificate, and stops
   * once one expires: read once an hour, a 5-minute period would hold it
   * for one period in 144, and listed only when it reported in the last
   * three hours, a certificate would be found for a few hours after each
   * point and lost for the rest of the day.
   */
  test("a certificate's days to expiry are read once an hour, and listed whatever their last point's age", () => {
    const acm: AwsNamespaceKeyMetrics | undefined = getAwsKeyMetrics(
      "AWS/CertificateManager",
    );

    expect(acm).toEqual({
      namespace: "AWS/CertificateManager",
      isListedWhenQuiet: true,
      metrics: [
        {
          metricName: "DaysToExpiry",
          statistic: "Minimum",
          unit: "None",
          periodSeconds: HOURLY_PERIOD_SECONDS,
        },
      ],
    });
    // Certificates are a Region's own, read in every Region.
    expect(acm!.onlyRegion).toBeUndefined();
    // The catalog finds a certificate from the namespace, by its ARN.
    expect(getAwsNamespaceOfType("AWS::CertificateManager::Certificate")).toBe(
      "AWS/CertificateManager",
    );
    expect(
      getKeyMetricCount(
        CloudProvider.AWS,
        "AWS::CertificateManager::Certificate",
      ),
    ).toBe(1);
  });

  test("only a namespace published a few times a day is listed when quiet: every other keeps the last three hours", () => {
    const quiet: Array<string> = AWS_KEY_METRICS.filter(
      (entry: AwsNamespaceKeyMetrics): boolean => {
        return Boolean(entry.isListedWhenQuiet);
      },
    ).map((entry: AwsNamespaceKeyMetrics): string => {
      return entry.namespace;
    });

    expect(quiet).toEqual(["AWS/CertificateManager"]);

    // And each of its metrics is read less often than every 5 minutes.
    for (const entry of AWS_KEY_METRICS) {
      if (!entry.isListedWhenQuiet) {
        continue;
      }

      for (const metric of entry.metrics) {
        expect(metric.periodSeconds).toBeGreaterThanOrEqual(
          HOURLY_PERIOD_SECONDS,
        );
      }
    }
  });

  test("the global services are read where CloudWatch keeps them", () => {
    expect(getAwsKeyMetrics("AWS/CloudFront")?.onlyRegion).toBe("us-east-1");
    expect(getAwsKeyMetrics("AWS/Route53")?.onlyRegion).toBe("us-east-1");
    expect(getAwsKeyMetrics("AWS/EC2")?.onlyRegion).toBeUndefined();
  });

  test("lookups ignore case and spaces", () => {
    expect(getAwsKeyMetrics(" aws/ec2 ")?.namespace).toBe("AWS/EC2");
    expect(getAwsKeyMetrics("AWS/Nope")).toBeUndefined();
  });

  test("a stored name is the receivers' amazonaws.com/<namespace>/<metric>, which the ingest reads as CloudWatch", () => {
    const name: string = getAwsStoredMetricName("AWS/EC2", "CPUUtilization");

    expect(name).toBe("amazonaws.com/AWS/EC2/CPUUtilization");
    expect(name.startsWith(AWS_CLOUDWATCH_METRIC_NAME_PREFIX)).toBe(true);
    expect(getCloudMonitoringSource(name, { Namespace: "AWS/EC2" })).toBe(
      CloudMonitoringSource.AwsCloudWatch,
    );
  });

  test("a resource type is read from its rule's namespace", () => {
    expect(getAwsNamespaceOfType("AWS::EC2::Instance")).toBe("AWS/EC2");
    expect(getAwsNamespaceOfType("aws::rds::dbinstance")).toBe("AWS/RDS");
    expect(
      getAwsNamespaceOfType("AWS::ElasticLoadBalancingV2::LoadBalancer"),
    ).toBe("AWS/ApplicationELB");
    expect(getAwsNamespaceOfType("AWS::Nope::Thing")).toBeUndefined();
  });
});

describe("Azure", () => {
  test("every type read is one the catalog lists", () => {
    for (const entry of AZURE_KEY_METRICS) {
      expect({
        type: entry.type,
        listed: Boolean(
          getCloudResourceTypeDescriptor(CloudProvider.Azure, entry.type),
        ),
      }).toEqual({ type: entry.type, listed: true });
    }
  });

  test("no type twice; each reads one call's worth of metrics at most", () => {
    const types: Array<string> = AZURE_KEY_METRICS.map(
      (entry: AzureTypeKeyMetrics): string => {
        return entry.type.toLowerCase();
      },
    );

    expect(new Set(types).size).toBe(types.length);

    for (const entry of AZURE_KEY_METRICS) {
      expect(entry.metrics.length).toBeGreaterThan(0);
      expect(entry.metrics.length).toBeLessThanOrEqual(
        AZURE_MAX_METRICS_PER_RESOURCE,
      );
    }
  });

  test("lookups ignore case, as Azure Monitor spells types two ways", () => {
    expect(getAzureKeyMetrics("microsoft.compute/VIRTUALMACHINES")?.type).toBe(
      "Microsoft.Compute/virtualMachines",
    );
    expect(getAzureKeyMetrics("Microsoft.Nope/things")).toBeUndefined();
  });

  test("a stored name is the azure_monitor receiver's", () => {
    expect(getAzureStoredMetricName("Percentage CPU", "Average")).toBe(
      "azure_percentage_cpu_average",
    );
    expect(getAzureStoredMetricName("Http5xx", "Total")).toBe(
      "azure_http5xx_total",
    );
    expect(
      getAzureStoredMetricName("Composite Disk Read Bytes/sec", "Average"),
    ).toBe("azure_composite_disk_read_bytes/sec_average");
  });
});

describe("Azure Service Bus and Event Hubs, split per queue", () => {
  test("only their namespaces are split, by EntityName, as the azure_monitor receiver names it", () => {
    const split: Array<string> = AZURE_KEY_METRICS.filter(
      (entry: AzureTypeKeyMetrics): boolean => {
        return Boolean(entry.splitByDimension);
      },
    ).map((entry: AzureTypeKeyMetrics): string => {
      return entry.type;
    });

    expect(split).toEqual([
      "Microsoft.ServiceBus/namespaces",
      "Microsoft.EventHub/namespaces",
    ]);
    expect(
      getAzureKeyMetrics("microsoft.servicebus/Namespaces")?.splitByDimension,
    ).toBe(AZURE_ENTITY_NAME_DIMENSION);
    expect(AZURE_ENTITY_NAME_DIMENSION).toBe("EntityName");
    expect(AZURE_DIMENSION_ATTRIBUTE_PREFIX).toBe("metadata_");
    expect(AZURE_ENTITY_NAME_ATTRIBUTE).toBe("metadata_entityname");
    // As many queues a namespace as the Queues guide asks the receiver to read.
    expect(AZURE_MAX_SPLIT_SERIES_PER_METRIC).toBe(1000);
  });

  test("every metric read of a namespace, with its usual aggregation, is one the Queues catalog files on a queue", () => {
    const usual: Record<string, string> = {
      IncomingMessages: "Total",
      OutgoingMessages: "Total",
      ActiveMessages: "Average",
      DeadletteredMessages: "Average",
      ServerErrors: "Total",
      ThrottledRequests: "Total",
    };

    for (const [type, system] of [
      ["Microsoft.ServiceBus/namespaces", "servicebus"],
      ["Microsoft.EventHub/namespaces", "eventhubs"],
    ] as Array<[string, string]>) {
      for (const metric of getAzureKeyMetrics(type)!.metrics) {
        const stored: string = getAzureStoredMetricName(metric, usual[metric]!);

        expect(
          MESSAGE_QUEUE_METRICS.some(
            (descriptor: { system: string; metricName: string }): boolean => {
              return (
                descriptor.system === system && descriptor.metricName === stored
              );
            },
          ),
        ).toBe(true);
      }
    }
  });

  test("a stored name is a connection's when it is a key metric of the type, whatever its aggregation", () => {
    const serviceBus: string = "Microsoft.ServiceBus/namespaces";

    expect(
      isAzureKeyMetricStoredName(serviceBus, "azure_activemessages_average"),
    ).toBe(true);
    expect(
      isAzureKeyMetricStoredName(serviceBus, "AZURE_INCOMINGMESSAGES_TOTAL"),
    ).toBe(true);
    expect(
      isAzureKeyMetricStoredName(serviceBus, "azure_activemessages_maximum"),
    ).toBe(true);
    // A metric only a collector reads.
    expect(
      isAzureKeyMetricStoredName(serviceBus, "azure_scheduledmessages_average"),
    ).toBe(false);
    expect(isAzureKeyMetricStoredName(serviceBus, "azure_size_average")).toBe(
      false,
    );
    expect(
      isAzureKeyMetricStoredName(
        "Microsoft.EventHub/namespaces",
        "azure_activemessages_average",
      ),
    ).toBe(false);
    expect(
      isAzureKeyMetricStoredName("Microsoft.Nothing/things", "azure_x_total"),
    ).toBe(false);
    expect(isAzureKeyMetricStoredName(serviceBus, "")).toBe(false);
  });
});

describe("Google Cloud", () => {
  test("every resource type read is one the catalog has a rule for", () => {
    for (const entry of GCP_KEY_METRICS) {
      expect({
        type: entry.resourceType,
        rule: Boolean(getGcpMonitoredResourceRule(entry.resourceType)),
      }).toEqual({ type: entry.resourceType, rule: true });
    }
  });

  test("every metric type belongs to its resource type's service, once", () => {
    const all: Array<string> = getGcpKeyMetricTypes().map(
      (metric: GcpKeyMetric): string => {
        return metric.metricType;
      },
    );

    expect(new Set(all).size).toBe(all.length);

    for (const entry of GCP_KEY_METRICS) {
      for (const metric of entry.metrics) {
        expect(metric.metricType).toMatch(/^[a-z]+\.googleapis\.com\//);
        expect([
          "ALIGN_MEAN",
          "ALIGN_MAX",
          "ALIGN_RATE",
          "ALIGN_PERCENTILE_95",
        ]).toContain(metric.aligner);
      }
    }
  });

  test("a count is read as a rate per second", () => {
    for (const metric of getGcpKeyMetricTypes()) {
      if (metric.aligner === "ALIGN_RATE") {
        expect(metric.unit.endsWith("/s")).toBe(true);
      }
    }
  });

  test("each metric knows its resource type", () => {
    expect(
      getGcpKeyMetricTypes().find((metric: GcpKeyMetric) => {
        return (
          metric.metricType ===
          "compute.googleapis.com/instance/cpu/utilization"
        );
      })?.resourceType,
    ).toBe("gce_instance");
    expect(
      GCP_KEY_METRICS.map((entry: GcpTypeKeyMetrics) => {
        return entry.resourceType;
      }),
    ).toContain("cloud_run_revision");
  });
});

describe("key metric counts", () => {
  test("per cloud, by type or namespace", () => {
    expect(getKeyMetricCount(CloudProvider.AWS, "AWS/EC2")).toBe(4);
    expect(getKeyMetricCount(CloudProvider.AWS, "AWS::EC2::Instance")).toBe(4);
    expect(
      getKeyMetricCount(
        CloudProvider.Azure,
        "Microsoft.Compute/virtualMachines",
      ),
    ).toBe(7);
    expect(getKeyMetricCount(CloudProvider.GCP, "gce_instance")).toBe(3);
    expect(getKeyMetricCount(CloudProvider.GCP, "nope")).toBe(0);
  });
});
