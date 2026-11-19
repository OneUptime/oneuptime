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
  AzureKeyMetric,
  AzureTypeKeyMetrics,
  DAILY_PERIOD_SECONDS,
  HOURLY_PERIOD_SECONDS,
  GCP_KEY_METRICS,
  GcpKeyMetric,
  GcpTypeKeyMetrics,
  getAwsKeyMetrics,
  getAwsNamespaceOfType,
  getAwsStoredMetricName,
  getAzureKeyMetricNames,
  getAzureKeyMetricOfStoredName,
  getAzureKeyMetrics,
  getAzureStoredMetricName,
  getCloudKeyMetricOfStoredName,
  getGcpKeyMetricTypes,
  getGcpResourceTypesOfMetric,
  getKeyMetricCount,
  compareCloudKeyMetrics,
  parseAwsStoredMetricName,
  CloudKeyMetricReference,
  isAzureKeyMetricExportedByDiagnosticSettings,
  isAzureKeyMetricStoredName,
  isAzureStreamedKeyMetric,
  isAzureStreamedKeyMetricStoredName,
  AWS_STREAM_TEMPLATE_UNVERSIONED,
  AWS_STREAM_TEMPLATE_VERSION,
  countAwsKeyMetricsAddedSince,
  getAwsKeyMetric,
  getAwsKeyMetricOfStoredName,
  getAwsProbeMetricNames,
  isAwsKeyMetricInTemplate,
  isAwsKeyMetricSeries,
  isAwsKeyMetricStreamable,
} from "../../../Types/Cloud/CloudKeyMetrics";
import { MESSAGE_QUEUE_METRICS } from "../../../Types/MessageQueue/MessageQueueMetricCatalog";
import {
  CLOUD_KEY_METRIC_GROUP_LABELS,
  CLOUD_KEY_METRIC_GROUP_ORDER,
  CloudKeyMetricGroup,
  getCloudKeyMetricGroupOrder,
} from "../../../Types/Cloud/CloudKeyMetricGroup";
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

// A type's key metrics by Azure Monitor's name, in order.
function namesOf(entry: AzureTypeKeyMetrics): Array<string> {
  return entry.metrics.map((metric: AzureKeyMetric): string => {
    return metric.name;
  });
}

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
          group: CloudKeyMetricGroup.Availability,
          periodSeconds: HOURLY_PERIOD_SECONDS,
          // No stream writes it: an hour sooner is nothing to a count of days.
          streamedSince: null,
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

/*
 * A stream's stack is made once, from the template of its day, and carries
 * the key metrics of its template's version (AwsKeyMetric.streamedSince):
 * 1 for those every stack has carried since streams began, 2 for every
 * other one read every five minutes. A metric read once an hour or a day
 * is the read's alone.
 */
describe("AWS key metrics a stream carries", () => {
  test("each is streamed since template 1 or 2 - or, read less often than every five minutes, never", () => {
    expect(AWS_STREAM_TEMPLATE_UNVERSIONED).toBe(1);
    expect(AWS_STREAM_TEMPLATE_VERSION).toBe(2);

    for (const entry of AWS_KEY_METRICS) {
      for (const metric of entry.metrics) {
        const where: string = `${entry.namespace}/${metric.metricName}`;

        if (metric.periodSeconds > AWS_DEFAULT_PERIOD_SECONDS) {
          expect({ where, streamedSince: metric.streamedSince }).toEqual({
            where,
            streamedSince: null,
          });
          expect(isAwsKeyMetricStreamable(metric)).toBe(false);
          continue;
        }

        expect({
          where,
          known: [1, 2].includes(metric.streamedSince as number),
        }).toEqual({ where, known: true });
        expect(isAwsKeyMetricStreamable(metric)).toBe(true);
      }
    }
  });

  test("a template carries its own version's metrics and every older one's, never a newer one's", () => {
    const cpu: AwsKeyMetric = getAwsKeyMetric("AWS/EC2", "CPUUtilization")!;
    const credits: AwsKeyMetric = getAwsKeyMetric(
      "AWS/EC2",
      "CPUCreditBalance",
    )!;
    const size: AwsKeyMetric = getAwsKeyMetric("AWS/S3", "BucketSizeBytes")!;

    expect(cpu.streamedSince).toBe(1);
    expect(credits.streamedSince).toBe(2);
    expect(isAwsKeyMetricInTemplate(cpu, 1)).toBe(true);
    expect(isAwsKeyMetricInTemplate(cpu, 2)).toBe(true);
    expect(isAwsKeyMetricInTemplate(credits, 1)).toBe(false);
    expect(isAwsKeyMetricInTemplate(credits, 2)).toBe(true);
    expect(isAwsKeyMetricInTemplate(credits, 3)).toBe(true);
    // S3's daily storage is in no template.
    expect(isAwsKeyMetricInTemplate(size, AWS_STREAM_TEMPLATE_VERSION)).toBe(
      false,
    );
  });

  test("running the command again streams every metric added since the stack's template", () => {
    let addedSinceTheFirst: number = 0;

    for (const entry of AWS_KEY_METRICS) {
      for (const metric of entry.metrics) {
        if (metric.streamedSince === 2) {
          addedSinceTheFirst++;
        }
      }
    }

    expect(addedSinceTheFirst).toBeGreaterThan(100);
    expect(countAwsKeyMetricsAddedSince(1)).toBe(addedSinceTheFirst);
    expect(countAwsKeyMetricsAddedSince(AWS_STREAM_TEMPLATE_VERSION)).toBe(0);
  });
});

describe("an AWS key metric by its stored name, and the series it is read from", () => {
  test("a stored name's key metric and its namespace as the catalog spells them, whatever the case", () => {
    expect(
      getAwsKeyMetricOfStoredName("amazonaws.com/aws/ec2/cpuutilization"),
    ).toEqual({
      namespace: "AWS/EC2",
      metric: getAwsKeyMetric("AWS/EC2", "CPUUtilization"),
    });
    // A metric name with dots: the namespace ends at the last slash.
    expect(
      getAwsKeyMetricOfStoredName(
        "amazonaws.com/AWS/Kinesis/GetRecords.IteratorAgeMilliseconds",
      )?.metric.metricName,
    ).toBe("GetRecords.IteratorAgeMilliseconds");
    expect(
      getAwsKeyMetricOfStoredName("amazonaws.com/AWS/EC2/DiskReadOps"),
    ).toBeNull();
    expect(getAwsKeyMetricOfStoredName("system.cpu.utilization")).toBeNull();
  });

  test("an HTTP API's errors and a REST API's are each their own metric", () => {
    expect(getAwsKeyMetric("AWS/ApiGateway", "5xx")?.metricName).toBe("5xx");
    expect(getAwsKeyMetric("AWS/ApiGateway", "5XXError")?.metricName).toBe(
      "5XXError",
    );
    expect(getAwsKeyMetric("AWS/ApiGateway", "4xx")?.metricName).toBe("4xx");
  });

  test("a metric read from some series only is read from those, or from a series without the dimension", () => {
    const received: AwsKeyMetric = getAwsKeyMetric(
      "AWS/NetworkFirewall",
      "ReceivedPackets",
    )!;
    const dropped: AwsKeyMetric = getAwsKeyMetric(
      "AWS/NetworkFirewall",
      "DroppedPackets",
    )!;
    const place: Record<string, string> = {
      FirewallName: "edge",
      AvailabilityZone: "eu-west-1a",
    };

    expect(received.onlyDimensionValues).toEqual({
      Engine: ["Stateless", "System"],
    });
    // A Classic policy's Stateless engine, a Next Generation policy's System.
    expect(
      isAwsKeyMetricSeries(received, { ...place, Engine: "Stateless" }),
    ).toBe(true);
    expect(isAwsKeyMetricSeries(received, { ...place, Engine: "System" })).toBe(
      true,
    );
    // The Firewall engine's would count some of the packets again.
    expect(
      isAwsKeyMetricSeries(received, { ...place, Engine: "Firewall" }),
    ).toBe(false);
    expect(
      isAwsKeyMetricSeries(received, { ...place, Engine: "Stateful" }),
    ).toBe(false);
    expect(isAwsKeyMetricSeries(received, place)).toBe(true);
    // A packet is dropped by one engine: every engine's drops are read.
    expect(isAwsKeyMetricSeries(dropped, { ...place, Engine: "IPS" })).toBe(
      true,
    );
  });
});

/*
 * #9567: services customers run widely that read no metrics before, each
 * from its own CloudWatch reference (CloudKeyMetricsProviderReference).
 */
describe("AWS services read since #9567", () => {
  test("each has its namespace, swept for with what every resource of it publishes", () => {
    const expected: Record<string, Array<string>> = {
      "AWS/WAFV2": ["AllowedRequests", "BlockedRequests"],
      "AWS/NetworkFirewall": ["ReceivedPackets"],
      "AWS/AppRunner": ["CPUUtilization"],
      "AWS/AutoScaling": ["GroupInServiceInstances"],
      "AWS/GlobalAccelerator": ["HealthyEndpointCount"],
      "AWS/Cognito": [
        "SignInSuccesses",
        "TokenRefreshSuccesses",
        "SignUpSuccesses",
      ],
      "AWS/ElasticBeanstalk": ["EnvironmentHealth"],
      "AWS/AppSync": ["Latency"],
      "AWS/SageMaker": ["Invocations"],
    };

    for (const [namespace, probes] of Object.entries(expected)) {
      const entry: AwsNamespaceKeyMetrics | undefined =
        getAwsKeyMetrics(namespace);

      expect({ namespace, read: Boolean(entry) }).toEqual({
        namespace,
        read: true,
      });
      expect(getAwsProbeMetricNames(entry!)).toEqual(probes);

      // Added since streams began: template 2 on carries them.
      for (const metric of entry!.metrics) {
        expect(metric.streamedSince).toBe(2);
      }
    }
  });

  test("Global Accelerator is read where it publishes, in US West (Oregon) alone", () => {
    expect(getAwsKeyMetrics("AWS/GlobalAccelerator")?.onlyRegion).toBe(
      "us-west-2",
    );
  });

  test("each new type is read from its own namespace, and counted for the cost estimate", () => {
    for (const [type, namespace] of [
      ["AWS::WAFv2::WebACL", "AWS/WAFV2"],
      ["AWS::NetworkFirewall::Firewall", "AWS/NetworkFirewall"],
      ["AWS::AppRunner::Service", "AWS/AppRunner"],
      ["AWS::GlobalAccelerator::Accelerator", "AWS/GlobalAccelerator"],
      ["AWS::Cognito::UserPool", "AWS/Cognito"],
      ["AWS::ElasticBeanstalk::Environment", "AWS/ElasticBeanstalk"],
      ["AWS::AppSync::GraphQLApi", "AWS/AppSync"],
      ["AWS::SageMaker::Endpoint", "AWS/SageMaker"],
    ] as Array<[string, string]>) {
      expect(getAwsNamespaceOfType(type)).toBe(namespace);
      expect(getKeyMetricCount(CloudProvider.AWS, type)).toBe(
        getAwsKeyMetrics(namespace)!.metrics.length,
      );
    }
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
      for (const metric of namesOf(getAzureKeyMetrics(type)!)) {
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

describe("Azure key metrics a diagnostic setting cannot export", () => {
  /*
   * Which metrics are marked - every one Microsoft's supported-metrics
   * tables mark No under DS Export - is held to those tables in
   * CloudKeyMetricsProviderReference.test.
   */
  test("each marked metric is a key metric of its own type, spelled as read, and marked once", () => {
    for (const entry of AZURE_KEY_METRICS) {
      const marks: Array<string> = entry.notExportedByDiagnosticSettings || [];

      // An empty list says nothing: a type with none has no list.
      expect({ type: entry.type, empty: marks.length === 0 }).toEqual({
        type: entry.type,
        empty: entry.notExportedByDiagnosticSettings === undefined,
      });
      expect(new Set(marks).size).toBe(marks.length);

      for (const metric of marks) {
        expect({ type: entry.type, metric, read: true }).toEqual({
          type: entry.type,
          metric,
          read: namesOf(entry).includes(metric),
        });
      }
    }
  });

  test("exported means a key metric of the type its tables do not mark, whatever its case", () => {
    const vm: string = "Microsoft.Compute/virtualMachines";

    expect(
      isAzureKeyMetricExportedByDiagnosticSettings(vm, "Percentage CPU"),
    ).toBe(true);
    expect(
      isAzureKeyMetricExportedByDiagnosticSettings(vm, "percentage cpu"),
    ).toBe(true);
    expect(
      isAzureKeyMetricExportedByDiagnosticSettings(vm, "Network In Total"),
    ).toBe(false);
    expect(
      isAzureKeyMetricExportedByDiagnosticSettings(
        "microsoft.compute/VIRTUALMACHINES",
        "NETWORK OUT TOTAL",
      ),
    ).toBe(false);
    // Not a key metric of the type, or no type the read reads: never exported here.
    expect(
      isAzureKeyMetricExportedByDiagnosticSettings(vm, "CPU Credits Consumed"),
    ).toBe(false);
    expect(
      isAzureKeyMetricExportedByDiagnosticSettings(
        "Microsoft.Nothing/things",
        "Percentage CPU",
      ),
    ).toBe(false);
    expect(isAzureKeyMetricExportedByDiagnosticSettings(vm, "")).toBe(false);
    expect(
      isAzureKeyMetricExportedByDiagnosticSettings(
        "Microsoft.ServiceBus/namespaces",
        "IncomingMessages",
      ),
    ).toBe(true);
    expect(
      isAzureKeyMetricExportedByDiagnosticSettings(
        "Microsoft.ServiceBus/namespaces",
        "ActiveMessages",
      ),
    ).toBe(false);
  });

  test("a stream writes an exported key metric of a type the read does not split, and nothing else", () => {
    for (const entry of AZURE_KEY_METRICS) {
      for (const metric of namesOf(entry)) {
        const marked: boolean = (
          entry.notExportedByDiagnosticSettings || []
        ).includes(metric);

        expect({
          type: entry.type,
          metric,
          streamed: isAzureStreamedKeyMetric(entry.type, metric),
        }).toEqual({
          type: entry.type,
          metric,
          streamed: !marked && !entry.splitByDimension,
        });
      }
    }
  });

  test("a Service Bus or Event Hubs namespace streams none of its metrics, even the two a diagnostic setting exports", () => {
    for (const type of [
      "Microsoft.ServiceBus/namespaces",
      "Microsoft.EventHub/namespaces",
    ]) {
      expect(
        isAzureKeyMetricExportedByDiagnosticSettings(type, "IncomingMessages"),
      ).toBe(true);
      expect(isAzureStreamedKeyMetric(type, "IncomingMessages")).toBe(false);
      expect(isAzureStreamedKeyMetric(type, "OutgoingMessages")).toBe(false);
    }

    expect(isAzureStreamedKeyMetric("Microsoft.Web/sites", "Requests")).toBe(
      true,
    );
    expect(
      isAzureStreamedKeyMetric("Microsoft.Nothing/things", "Requests"),
    ).toBe(false);
    expect(isAzureStreamedKeyMetric("", "Requests")).toBe(false);
  });

  test("by its stored name, whatever the aggregation it was read with and its case", () => {
    const vm: string = "Microsoft.Compute/virtualMachines";

    expect(
      isAzureStreamedKeyMetricStoredName(vm, "azure_percentage_cpu_average"),
    ).toBe(true);
    expect(
      isAzureStreamedKeyMetricStoredName(vm, "AZURE_PERCENTAGE_CPU_MAXIMUM"),
    ).toBe(true);
    expect(
      isAzureStreamedKeyMetricStoredName(vm, "azure_network_in_total_total"),
    ).toBe(false);
    expect(
      isAzureStreamedKeyMetricStoredName(
        "Microsoft.Compute/disks",
        "azure_composite_disk_read_bytes/sec_average",
      ),
    ).toBe(false);
    expect(
      isAzureStreamedKeyMetricStoredName(
        "Microsoft.ServiceBus/namespaces",
        "azure_incomingmessages_total",
      ),
    ).toBe(false);
    expect(
      isAzureStreamedKeyMetricStoredName(
        "Microsoft.Storage/storageAccounts",
        "azure_transactions_total",
      ),
    ).toBe(true);
    // Not a key metric of the type: no stream writes it.
    expect(
      isAzureStreamedKeyMetricStoredName(vm, "azure_os_disk_iops_average"),
    ).toBe(false);
    expect(isAzureStreamedKeyMetricStoredName(vm, "")).toBe(false);
  });

  test("a stored name's key metric is Azure Monitor's own spelling", () => {
    expect(
      getAzureKeyMetricOfStoredName(
        "Microsoft.Compute/virtualMachines",
        "azure_network_out_total_total",
      ),
    ).toBe("Network Out Total");
    expect(
      getAzureKeyMetricOfStoredName(
        "microsoft.containerservice/managedclusters",
        "AZURE_KUBE_POD_STATUS_READY_AVERAGE",
      ),
    ).toBe("kube_pod_status_ready");
    expect(
      getAzureKeyMetricOfStoredName(
        "Microsoft.Compute/virtualMachines",
        "azure_incomingmessages_total",
      ),
    ).toBeNull();
    expect(
      getAzureKeyMetricOfStoredName(
        "Microsoft.Nothing/things",
        "azure_x_total",
      ),
    ).toBeNull();
  });

  /*
   * The lookup reads a table built once from AZURE_KEY_METRICS: every key
   * metric of every type is found under the stored name of each
   * aggregation it can be read with, in any case and with spaces around,
   * and under no other type, nor under a name no key metric is stored as.
   */
  test("every key metric of every type is found by each of its stored names, and only on its own type", () => {
    const aggregations: Array<string> = [
      "Average",
      "Total",
      "Maximum",
      "Minimum",
      "Count",
    ];

    for (const entry of AZURE_KEY_METRICS) {
      for (const metric of namesOf(entry)) {
        for (const aggregation of aggregations) {
          const stored: string = getAzureStoredMetricName(metric, aggregation);

          expect({
            type: entry.type,
            stored,
            metric: getAzureKeyMetricOfStoredName(entry.type, stored),
          }).toEqual({ type: entry.type, stored, metric });
          expect(
            getAzureKeyMetricOfStoredName(
              ` ${entry.type.toUpperCase()} `,
              ` ${stored.toUpperCase()} `,
            ),
          ).toBe(metric);

          /*
           * Another type none of whose key metrics is stored under that
           * name does not know it. Two types' metrics of different names
           * can be stored alike - a virtual machine's "CPU Credits
           * Remaining" and a PostgreSQL server's cpu_credits_remaining -
           * and each type then knows the name as its own metric.
           */
          for (const other of AZURE_KEY_METRICS) {
            if (
              other.type !== entry.type &&
              !namesOf(other).some((candidate: string): boolean => {
                return aggregations.some((read: string): boolean => {
                  return getAzureStoredMetricName(candidate, read) === stored;
                });
              })
            ) {
              expect({
                type: other.type,
                stored,
                metric: getAzureKeyMetricOfStoredName(other.type, stored),
              }).toEqual({ type: other.type, stored, metric: null });
            }
          }
        }

        // A name the receiver never stores it as: the aggregation missing.
        expect(
          getAzureKeyMetricOfStoredName(
            entry.type,
            getAzureStoredMetricName(metric, "").slice(0, -1),
          ),
        ).toBeNull();
      }
    }
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
    expect(getKeyMetricCount(CloudProvider.AWS, "AWS/EC2")).toBe(7);
    expect(getKeyMetricCount(CloudProvider.AWS, "AWS::EC2::Instance")).toBe(7);
    expect(
      getKeyMetricCount(
        CloudProvider.Azure,
        "Microsoft.Compute/virtualMachines",
      ),
    ).toBe(17);
    expect(getKeyMetricCount(CloudProvider.GCP, "gce_instance")).toBe(9);
    expect(getKeyMetricCount(CloudProvider.GCP, "nope")).toBe(0);
  });
});

/*
 * An App Service read five metrics (#9505): CPU time, 4xx, 5xx, memory
 * and requests, out of the seven its type read at most eight of. Each type
 * now reads a curated set, as many as Azure Monitor answers in one call.
 */
describe("what each resource type reads", () => {
  test("an App Service app reads its requests, errors, response time, CPU, memory, connections, network and storage", () => {
    const names: Array<string> = getAzureKeyMetricNames("Microsoft.Web/sites");

    expect(names.length).toBeGreaterThanOrEqual(15);
    expect(names.length).toBeLessThanOrEqual(AZURE_MAX_METRICS_PER_RESOURCE);
    for (const metric of [
      "Requests",
      "Http2xx",
      "Http4xx",
      "Http5xx",
      "HttpResponseTime",
      "RequestsInApplicationQueue",
      "CpuTime",
      "MemoryWorkingSet",
      "PrivateBytes",
      "AppConnections",
      "BytesReceived",
      "BytesSent",
      "FileSystemUsage",
    ]) {
      expect(names).toContain(metric);
    }
  });

  test("the types the issue names each read what an operator asks of them", () => {
    const expected: Record<string, Array<string>> = {
      // CPU, memory, disk, network and availability.
      "Microsoft.Compute/virtualMachines": [
        "Percentage CPU",
        "Available Memory Percentage",
        "Disk Read Operations/Sec",
        "OS Disk Queue Depth",
        "Network In Total",
        "VmAvailabilityMetric",
      ],
      // CPU, DTU and vCore use, storage, connections and performance.
      "Microsoft.Sql/servers/databases": [
        "cpu_percent",
        "dtu_consumption_percent",
        "workers_percent",
        "storage_percent",
        "connection_successful",
        "connection_failed",
        "log_write_percent",
        "availability",
      ],
      // Memory, operations, connections, hits and misses, server load.
      "Microsoft.Cache/redisEnterprise": [
        "usedmemorypercentage",
        "operationsPerSecond",
        "connectedclients",
        "cachehits",
        "cachemisses",
        "serverLoad",
      ],
      // Data processed, health probes, traffic and availability.
      "Microsoft.Network/loadBalancers": [
        "ByteCount",
        "PacketCount",
        "DipAvailability",
        "VipAvailability",
        "UsedSnatPorts",
      ],
      // Capacity, transactions, availability and latency.
      "Microsoft.Storage/storageAccounts": [
        "UsedCapacity",
        "Transactions",
        "Availability",
        "SuccessE2ELatency",
        "SuccessServerLatency",
      ],
      // Traffic and packets.
      "Microsoft.Network/networkInterfaces": [
        "BytesReceivedRate",
        "BytesSentRate",
        "PacketsReceivedRate",
        "PacketsSentRate",
      ],
    };

    for (const [type, metrics] of Object.entries(expected)) {
      const names: Array<string> = getAzureKeyMetricNames(type);

      for (const metric of metrics) {
        expect({ type, metric, read: names.includes(metric) }).toEqual({
          type,
          metric,
          read: true,
        });
      }
    }
  });

  test("no type reads a metric twice, whatever its case", () => {
    for (const entry of AZURE_KEY_METRICS) {
      const lower: Array<string> = namesOf(entry).map(
        (name: string): string => {
          return name.toLowerCase();
        },
      );

      expect({ type: entry.type, unique: new Set(lower).size }).toEqual({
        type: entry.type,
        unique: lower.length,
      });
    }
  });
});

describe("what each key metric is about", () => {
  const groups: Array<string> = Object.values(CloudKeyMetricGroup);

  test("every key metric of every cloud is in a group", () => {
    for (const entry of AWS_KEY_METRICS) {
      for (const metric of entry.metrics) {
        expect(groups).toContain(metric.group);
      }
    }

    for (const entry of AZURE_KEY_METRICS) {
      for (const metric of entry.metrics) {
        expect(groups).toContain(metric.group);
      }
    }

    for (const entry of GCP_KEY_METRICS) {
      for (const metric of entry.metrics) {
        expect(groups).toContain(metric.group);
      }
    }
  });

  test("every group has its place and its heading, a word the Dashboard already says", () => {
    expect([...CLOUD_KEY_METRIC_GROUP_ORDER].sort()).toEqual(
      [...groups].sort(),
    );
    expect(new Set(CLOUD_KEY_METRIC_GROUP_ORDER).size).toBe(groups.length);
    expect(CLOUD_KEY_METRIC_GROUP_ORDER.slice(0, 4)).toEqual([
      CloudKeyMetricGroup.Availability,
      CloudKeyMetricGroup.Traffic,
      CloudKeyMetricGroup.Errors,
      CloudKeyMetricGroup.Latency,
    ]);

    for (const group of groups) {
      expect(
        CLOUD_KEY_METRIC_GROUP_LABELS[group as CloudKeyMetricGroup],
      ).toBeTruthy();
    }

    expect(CLOUD_KEY_METRIC_GROUP_LABELS[CloudKeyMetricGroup.Errors]).toBe(
      "Errors",
    );
    expect(getCloudKeyMetricGroupOrder(CloudKeyMetricGroup.Replication)).toBe(
      CLOUD_KEY_METRIC_GROUP_ORDER.length - 1,
    );
  });
});

describe("a key metric by its stored name", () => {
  test("a CloudWatch name splits at its last slash: the namespace keeps its own", () => {
    expect(
      parseAwsStoredMetricName("amazonaws.com/AWS/EC2/CPUUtilization"),
    ).toEqual({ namespace: "AWS/EC2", metricName: "CPUUtilization" });
    expect(
      parseAwsStoredMetricName(
        "amazonaws.com/aws/kinesis/getrecords.iteratoragemilliseconds",
      ),
    ).toEqual({
      namespace: "aws/kinesis",
      metricName: "getrecords.iteratoragemilliseconds",
    });
    expect(parseAwsStoredMetricName("azure_requests_total")).toBeNull();
    expect(parseAwsStoredMetricName("amazonaws.com/AWS/EC2/")).toBeNull();
    expect(parseAwsStoredMetricName("amazonaws.com/CPUUtilization")).toBeNull();
    expect(parseAwsStoredMetricName("")).toBeNull();
  });

  test("AWS: by namespace and metric, whatever the case ingest stored it in", () => {
    expect(
      getCloudKeyMetricOfStoredName({
        provider: CloudProvider.AWS,
        type: "AWS::EC2::Instance",
        metricName: "amazonaws.com/aws/ec2/cpuutilization",
      }),
    ).toEqual({
      name: "CPUUtilization",
      group: CloudKeyMetricGroup.Compute,
      rank: 0,
    });
    expect(
      getCloudKeyMetricOfStoredName({
        provider: CloudProvider.AWS,
        type: "AWS::EC2::Instance",
        metricName: "amazonaws.com/AWS/EC2/StatusCheckFailed",
      })?.group,
    ).toBe(CloudKeyMetricGroup.Availability);
    // A metric of the namespace no connection reads, and a namespace none reads.
    expect(
      getCloudKeyMetricOfStoredName({
        provider: CloudProvider.AWS,
        type: "AWS::EC2::Instance",
        metricName: "amazonaws.com/AWS/EC2/MetadataNoToken",
      }),
    ).toBeNull();
    expect(
      getCloudKeyMetricOfStoredName({
        provider: CloudProvider.AWS,
        type: "AWS::Logs::LogGroup",
        metricName: "amazonaws.com/AWS/Logs/IncomingBytes",
      }),
    ).toBeNull();
  });

  test("Azure: by the type's key metric, whatever aggregation it was read with", () => {
    expect(
      getCloudKeyMetricOfStoredName({
        provider: CloudProvider.Azure,
        type: "microsoft.web/SITES",
        metricName: "azure_http5xx_total",
      }),
    ).toEqual({
      name: "Http5xx",
      group: CloudKeyMetricGroup.Errors,
      rank: getAzureKeyMetricNames("Microsoft.Web/sites").indexOf("Http5xx"),
    });
    expect(
      getCloudKeyMetricOfStoredName({
        provider: CloudProvider.Azure,
        type: "Microsoft.Compute/virtualMachines",
        metricName: "AZURE_PERCENTAGE_CPU_MAXIMUM",
      })?.name,
    ).toBe("Percentage CPU");
    // Another type's key metric, or none at all.
    expect(
      getCloudKeyMetricOfStoredName({
        provider: CloudProvider.Azure,
        type: "Microsoft.Compute/virtualMachines",
        metricName: "azure_http5xx_total",
      }),
    ).toBeNull();
    expect(
      getCloudKeyMetricOfStoredName({
        provider: CloudProvider.Azure,
        type: "Microsoft.Web/sites",
        metricName: "http.server.request.duration",
      }),
    ).toBeNull();
  });

  test("Google Cloud: by metric type, its own resource type's place first", () => {
    const shared: string = "run.googleapis.com/container/cpu/utilizations";

    expect(getGcpResourceTypesOfMetric(shared)).toEqual([
      "cloud_run_revision",
      "cloud_run_job",
    ]);
    // Read once, under the first type it is listed under.
    expect(
      getGcpKeyMetricTypes().filter(
        (metric: GcpKeyMetric & { resourceType: string }): boolean => {
          return metric.metricType === shared;
        },
      ),
    ).toHaveLength(1);
    expect(
      getCloudKeyMetricOfStoredName({
        provider: CloudProvider.GCP,
        type: "cloud_run_job",
        metricName: shared,
      })?.rank,
    ).toBe(2);
    expect(
      getCloudKeyMetricOfStoredName({
        provider: CloudProvider.GCP,
        type: "cloud_run_revision",
        metricName: shared,
      })?.rank,
    ).toBe(3);
    expect(
      getCloudKeyMetricOfStoredName({
        provider: CloudProvider.GCP,
        type: "gce_instance",
        metricName: "compute.googleapis.com/instance/cpu/utilization",
      }),
    ).toEqual({
      name: "compute.googleapis.com/instance/cpu/utilization",
      group: CloudKeyMetricGroup.Compute,
      rank: 0,
    });
    expect(
      getCloudKeyMetricOfStoredName({
        provider: CloudProvider.GCP,
        type: "gce_instance",
        metricName: "agent.googleapis.com/memory/percent_used",
      }),
    ).toBeNull();
  });

  test("nothing for an unknown provider, or no name", () => {
    expect(
      getCloudKeyMetricOfStoredName({
        provider: "openstack",
        type: "nova",
        metricName: "cpu",
      }),
    ).toBeNull();
    expect(
      getCloudKeyMetricOfStoredName({
        provider: CloudProvider.AWS,
        type: "AWS::EC2::Instance",
        metricName: "",
      }),
    ).toBeNull();
    expect(
      getCloudKeyMetricOfStoredName({
        provider: undefined,
        type: undefined,
        metricName: "amazonaws.com/AWS/EC2/CPUUtilization",
      }),
    ).toBeNull();
  });

  test("two key metrics are ordered by their groups, then their place in the type", () => {
    const availability: CloudKeyMetricReference = {
      name: "VmAvailabilityMetric",
      group: CloudKeyMetricGroup.Availability,
      rank: 6,
    };
    const cpu: CloudKeyMetricReference = {
      name: "Percentage CPU",
      group: CloudKeyMetricGroup.Compute,
      rank: 0,
    };
    const credits: CloudKeyMetricReference = {
      name: "CPU Credits Remaining",
      group: CloudKeyMetricGroup.Compute,
      rank: 7,
    };

    expect(
      [credits, cpu, availability]
        .sort(compareCloudKeyMetrics)
        .map((metric: CloudKeyMetricReference): string => {
          return metric.name;
        }),
    ).toEqual([
      "VmAvailabilityMetric",
      "Percentage CPU",
      "CPU Credits Remaining",
    ]);
  });
});
