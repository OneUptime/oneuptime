import { describe, expect, test } from "@jest/globals";
import {
  AWS_DEFAULT_PERIOD_SECONDS,
  AWS_KEY_METRICS,
  AZURE_KEY_METRICS,
  AwsKeyMetric,
  AwsNamespaceKeyMetrics,
  AzureTypeKeyMetrics,
  DAILY_PERIOD_SECONDS,
  GCP_KEY_METRICS,
  GcpKeyMetric,
  GcpTypeKeyMetrics,
  getAwsStoredMetricName,
  getAzureStoredMetricName,
} from "../../../Types/Cloud/CloudKeyMetrics";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import {
  AWS_CLOUDWATCH_RESOURCE_RULES,
  AwsCloudWatchResourceRule,
  getCloudResourceTypeDescriptor,
} from "../../../Types/Cloud/CloudResourceCatalog";
import {
  CLOUD_BACKLOG_AGE_SECONDS,
  CLOUD_HEADLINE_READINGS,
  CLOUD_HEALTH_MIN_REQUESTS,
  CLOUD_HEALTH_RULES,
  CLOUD_READINGS_STALE_MS,
  CLOUD_STATUS_DEGRADED,
  CLOUD_STATUS_HEALTHY,
  CLOUD_STATUS_NOT_REPORTING,
  CLOUD_STATUS_REPORTING,
  CLOUD_STATUS_UNHEALTHY,
  CloudHealthAssessment,
  CloudHealthRow,
  CloudHealthSeverity,
  CloudHealthText,
  CloudResourceReadings,
  REASON_CONSUMERS_BEHIND,
  REASON_INVOCATIONS_FAILED,
  REASON_NOT_AVAILABLE,
  REASON_OLDEST_MESSAGE_WAITING,
  REASON_REQUESTS_FAILED,
  REASON_STATUS_CHECKS_FAILING,
  REASON_STORAGE_FULL,
  REASON_THROTTLED,
  REASON_UNHEALTHY_HOSTS,
  assessCloudResourceHealth,
  findCloudHealthProblems,
  formatCloudPercent,
  getCloudBacklogText,
  getCloudHeadlineReadings,
  getCloudHealthSeverity,
  getCloudReadingKey,
  getCloudReadingKeysForType,
  getCloudReadingPeriodSeconds,
  hasCloudHealthRules,
  hasFreshCloudReadings,
  readCloudResourceReadings,
} from "../../../Types/Cloud/CloudResourceHealth";
import { fillTemplate } from "../../../Types/Translator";

/*
 * What on a cloud resource needs someone, and how bad it is
 * (CloudResourceHealth): the one set of rules the Cloud Overview's and an
 * account's Needs attention, the lists' Status, a resource's hero and the
 * server's stored severity all follow. Every rule reads a metric a cloud
 * connection really reads, for a type the catalog knows; each judges at
 * both of its bounds; a resource that stopped reporting, or whose readings
 * are stale, is not judged; and the keys readings are kept under are the
 * ones the stored metric names give.
 */

const NOW: Date = new Date("2026-11-03T10:00:00.000Z");
const MINUTE: number = 60 * 1000;

function minutesAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * MINUTE);
}

function reading(
  value: number,
  at: Date = minutesAgo(5),
): {
  value: number;
  time: string;
} {
  return { value, time: at.toISOString() };
}

function row(data: {
  provider: CloudProvider;
  type: string;
  readings: CloudResourceReadings;
  properties?: Record<string, unknown> | undefined;
  status?: string | undefined;
  writtenAt?: Date | undefined;
}): CloudHealthRow {
  return {
    cloudProvider: data.provider,
    cloudResourceType: data.type,
    otelCollectorStatus: data.status ?? "connected",
    cloudReadings: data.readings,
    cloudReadingsAt: data.writtenAt ?? minutesAgo(2),
    cloudProperties: data.properties,
  };
}

function assess(data: Parameters<typeof row>[0]): CloudHealthAssessment {
  return assessCloudResourceHealth(row(data), { now: NOW });
}

// A reason as an English reader sees it: "one" for a count of 1.
function english(text: CloudHealthText): string {
  const template: string =
    text.plural && text.plural.count === 1 ? text.plural.one : text.text;
  return fillTemplate(template, text.values || {});
}

function reasonsOf(data: Parameters<typeof row>[0]): Array<string> {
  return assess(data).reasons.map(english);
}

const EC2: string = "AWS::EC2::Instance";
const ALB: string = "AWS::ElasticLoadBalancingV2::LoadBalancer";
const RDS: string = "AWS::RDS::DBInstance";
const GIB: number = 1024 * 1024 * 1024;

describe("CloudResourceHealth", () => {
  describe("reading keys", () => {
    test("an AWS stored name drops amazonaws.com/ and reads in lower case", () => {
      expect(
        getCloudReadingKey("aws", "amazonaws.com/AWS/EC2/StatusCheckFailed"),
      ).toBe("aws/ec2/statuscheckfailed");
      expect(
        getCloudReadingKey(
          "aws",
          "amazonaws.com/AWS/Kinesis/GetRecords.IteratorAgeMilliseconds",
        ),
      ).toBe("aws/kinesis/getrecords.iteratoragemilliseconds");
    });

    test("an Azure stored name drops azure_ and its aggregation, whichever it is", () => {
      for (const aggregation of [
        "Average",
        "Total",
        "Maximum",
        "Minimum",
        "Count",
      ]) {
        expect(
          getCloudReadingKey(
            "azure",
            getAzureStoredMetricName("Percentage CPU", aggregation),
          ),
        ).toBe("percentage_cpu");
      }
      // Only its last aggregation goes: a name that ends like one keeps the rest.
      expect(getCloudReadingKey("azure", "azure_connection_count_count")).toBe(
        "connection_count",
      );
    });

    test("a Google Cloud metric type is its own key", () => {
      expect(
        getCloudReadingKey(
          "gcp",
          "cloudsql.googleapis.com/database/disk/utilization",
        ),
      ).toBe("cloudsql.googleapis.com/database/disk/utilization");
    });

    test("a name of another cloud, or of no cloud, has no key", () => {
      expect(getCloudReadingKey("aws", "azure_percentage_cpu_average")).toBe(
        null,
      );
      expect(getCloudReadingKey("azure", "amazonaws.com/AWS/EC2/X")).toBe(null);
      expect(getCloudReadingKey("gcp", "system.cpu.utilization")).toBe(null);
      expect(getCloudReadingKey("aws", "")).toBe(null);
      expect(getCloudReadingKey("other", "amazonaws.com/AWS/EC2/X")).toBe(null);
    });
  });

  describe("every rule reads what a connection really reads", () => {
    // Every key a connection's reads can bring in, by provider.
    const readKeys: Record<string, Set<string>> = {
      aws: new Set<string>(),
      azure: new Set<string>(),
      gcp: new Set<string>(),
    };

    for (const namespace of AWS_KEY_METRICS as ReadonlyArray<AwsNamespaceKeyMetrics>) {
      for (const metric of namespace.metrics as Array<AwsKeyMetric>) {
        readKeys["aws"]!.add(
          getCloudReadingKey(
            "aws",
            getAwsStoredMetricName(namespace.namespace, metric.metricName),
          ) as string,
        );
      }
    }

    for (const entry of AZURE_KEY_METRICS as ReadonlyArray<AzureTypeKeyMetrics>) {
      for (const name of entry.metrics) {
        readKeys["azure"]!.add(
          getCloudReadingKey(
            "azure",
            getAzureStoredMetricName(name, "Average"),
          ) as string,
        );
      }
    }

    for (const entry of GCP_KEY_METRICS as ReadonlyArray<GcpTypeKeyMetrics>) {
      for (const metric of entry.metrics as Array<GcpKeyMetric>) {
        readKeys["gcp"]!.add(metric.metricType);
      }
    }

    test("each rule's types are catalogued types of its cloud", () => {
      for (const entry of CLOUD_HEALTH_RULES) {
        for (const type of entry.types) {
          expect({
            type,
            known: Boolean(
              getCloudResourceTypeDescriptor(entry.provider, type),
            ),
          }).toEqual({ type, known: true });
        }
      }
    });

    test("each rule's readings are key metrics its cloud's connection reads", () => {
      for (const entry of CLOUD_HEALTH_RULES) {
        for (const type of entry.types) {
          for (const key of getCloudReadingKeysForType(entry.provider, type)) {
            expect({
              type,
              key,
              read: readKeys[entry.provider]!.has(key),
            }).toEqual({
              type,
              key,
              read: true,
            });
          }
        }
      }
    });

    test("each headline reading is a key metric its cloud's connection reads", () => {
      for (const entry of CLOUD_HEADLINE_READINGS) {
        for (const headline of entry.readings) {
          expect({
            key: headline.key,
            read: readKeys[entry.provider]!.has(headline.key),
          }).toEqual({ key: headline.key, read: true });
        }

        for (const type of entry.types) {
          expect(
            Boolean(getCloudResourceTypeDescriptor(entry.provider, type)),
          ).toBe(true);
        }
      }
    });

    test("an AWS rule reads the namespace its type's metrics come from", () => {
      const namespacesOfType: Map<string, Set<string>> = new Map();

      for (const rule of AWS_CLOUDWATCH_RESOURCE_RULES as ReadonlyArray<AwsCloudWatchResourceRule>) {
        const set: Set<string> =
          namespacesOfType.get(rule.type.toLowerCase()) || new Set<string>();
        set.add(rule.namespace.toLowerCase());
        namespacesOfType.set(rule.type.toLowerCase(), set);
      }

      for (const entry of CLOUD_HEALTH_RULES) {
        if (entry.provider !== CloudProvider.AWS) {
          continue;
        }

        for (const type of entry.types) {
          for (const key of getCloudReadingKeysForType(entry.provider, type)) {
            const namespace: string = key.split("/").slice(0, 2).join("/");
            expect({
              type,
              key,
              namespaceOfType: Boolean(
                namespacesOfType.get(type.toLowerCase())?.has(namespace),
              ),
            }).toEqual({ type, key, namespaceOfType: true });
          }
        }
      }
    });

    test("a type with neither rules nor headline numbers keeps no reading", () => {
      expect(getCloudReadingKeysForType("aws", "AWS::S3::Bucket").size).toBe(0);
      expect(getCloudReadingKeysForType("aws", "AWS::EC2::VPC").size).toBe(0);
      expect(hasCloudHealthRules("aws", "AWS::S3::Bucket")).toBe(false);
    });

    test("a type keeps its rules' readings and its headline numbers, in any case", () => {
      const keys: ReadonlySet<string> = getCloudReadingKeysForType(
        "aws",
        "aws::rds::dbinstance",
      );

      expect(keys.has("aws/rds/freestoragespace")).toBe(true);
      expect(keys.has("aws/rds/cpuutilization")).toBe(true);
      expect(keys.has("aws/rds/databaseconnections")).toBe(true);
      expect(hasCloudHealthRules("AWS", RDS)).toBe(true);
      expect(getCloudHeadlineReadings("aws", RDS).length).toBe(3);
    });
  });

  describe("the rules, at their bounds", () => {
    test("an instance failing its status checks is unhealthy; one passing them is healthy", () => {
      const failing: CloudHealthAssessment = assess({
        provider: CloudProvider.AWS,
        type: EC2,
        readings: { "aws/ec2/statuscheckfailed": reading(1) },
      });

      expect(failing.state).toBe("unhealthy");
      expect(failing.severity).toBe(CloudHealthSeverity.Critical);
      expect(failing.tone).toBe("danger");
      expect(failing.status.text).toBe(CLOUD_STATUS_UNHEALTHY);
      expect(failing.reasons).toEqual([{ text: REASON_STATUS_CHECKS_FAILING }]);

      const passing: CloudHealthAssessment = assess({
        provider: CloudProvider.AWS,
        type: EC2,
        readings: { "aws/ec2/statuscheckfailed": reading(0) },
      });

      expect(passing.state).toBe("healthy");
      expect(passing.status.text).toBe(CLOUD_STATUS_HEALTHY);
      expect(passing.tone).toBe("positive");
    });

    test("a busy instance is not a problem by itself", () => {
      const busy: CloudHealthAssessment = assess({
        provider: CloudProvider.AWS,
        type: EC2,
        readings: {
          "aws/ec2/statuscheckfailed": reading(0),
          "aws/ec2/cpuutilization": reading(100),
        },
      });

      expect(busy.state).toBe("healthy");
    });

    test("a load balancer's failed share: under 5% is fine, from 5% a look, from 50% broken", () => {
      const at: Date = minutesAgo(5);
      const share: (failed: number, total: number) => CloudHealthAssessment = (
        failed: number,
        total: number,
      ): CloudHealthAssessment => {
        return assess({
          provider: CloudProvider.AWS,
          type: ALB,
          readings: {
            "aws/applicationelb/requestcount": reading(total, at),
            "aws/applicationelb/httpcode_target_5xx_count": reading(failed, at),
          },
        });
      };

      expect(share(49, 1000).state).toBe("healthy");
      expect(share(50, 1000).state).toBe("degraded");
      expect(share(50, 1000).reasons.map(english)).toEqual([
        "5% of requests failed",
      ]);
      expect(share(499, 1000).severity).toBe(CloudHealthSeverity.Warning);
      expect(share(500, 1000).severity).toBe(CloudHealthSeverity.Critical);
      expect(share(500, 1000).reasons[0]!.text).toBe(REASON_REQUESTS_FAILED);
    });

    test("the load balancer's own 5xx count with its targets'", () => {
      const at: Date = minutesAgo(5);

      expect(
        reasonsOf({
          provider: CloudProvider.AWS,
          type: ALB,
          readings: {
            "aws/applicationelb/requestcount": reading(200, at),
            "aws/applicationelb/httpcode_target_5xx_count": reading(6, at),
            "aws/applicationelb/httpcode_elb_5xx_count": reading(6, at),
          },
        }),
      ).toEqual(["6% of requests failed"]);
    });

    test("a quiet period's failures say nothing: fewer requests than the floor", () => {
      const at: Date = minutesAgo(5);

      expect(
        assess({
          provider: CloudProvider.AWS,
          type: ALB,
          readings: {
            "aws/applicationelb/requestcount": reading(
              CLOUD_HEALTH_MIN_REQUESTS - 1,
              at,
            ),
            "aws/applicationelb/httpcode_target_5xx_count": reading(10, at),
          },
        }).state,
      ).toBe("healthy");
    });

    test("failures of another period are not divided by this one's requests", () => {
      expect(
        assess({
          provider: CloudProvider.AWS,
          type: ALB,
          readings: {
            "aws/applicationelb/requestcount": reading(1000, minutesAgo(5)),
            "aws/applicationelb/httpcode_target_5xx_count": reading(
              900,
              minutesAgo(10),
            ),
          },
        }).state,
      ).toBe("healthy");
    });

    test("a classic load balancer counts its unhealthy hosts, in the right form", () => {
      expect(
        reasonsOf({
          provider: CloudProvider.AWS,
          type: "AWS::ElasticLoadBalancing::LoadBalancer",
          readings: { "aws/elb/unhealthyhostcount": reading(1) },
        }),
      ).toEqual(["1 unhealthy host"]);

      const two: CloudHealthAssessment = assess({
        provider: CloudProvider.AWS,
        type: "AWS::ElasticLoadBalancing::LoadBalancer",
        readings: { "aws/elb/unhealthyhostcount": reading(2) },
      });

      expect(two.reasons).toEqual([
        {
          text: REASON_UNHEALTHY_HOSTS.other,
          values: { count: "2" },
          plural: { one: REASON_UNHEALTHY_HOSTS.one, count: 2 },
        },
      ]);
      expect(two.severity).toBe(CloudHealthSeverity.Warning);
    });

    test("a database's storage, from what is free and what was allocated", () => {
      const storage: (freeGib: number) => CloudHealthAssessment = (
        freeGib: number,
      ): CloudHealthAssessment => {
        return assess({
          provider: CloudProvider.AWS,
          type: RDS,
          readings: { "aws/rds/freestoragespace": reading(freeGib * GIB) },
          properties: { AllocatedStorage: 100 },
        });
      };

      expect(storage(11).state).toBe("healthy");
      expect(storage(10).state).toBe("degraded");
      expect(storage(10).reasons.map(english)).toEqual(["90% full"]);
      expect(storage(5).state).toBe("unhealthy");
      expect(storage(5).reasons[0]!.text).toBe(REASON_STORAGE_FULL);
    });

    test("without its allocation a database's free storage judges nothing", () => {
      const unknown: CloudHealthAssessment = assess({
        provider: CloudProvider.AWS,
        type: RDS,
        readings: { "aws/rds/freestoragespace": reading(0) },
      });

      expect(unknown.severity).toBe(null);
      // It was read, so the database counts as checked.
      expect(unknown.state).toBe("healthy");
    });

    test("a function's failed invocations and its throttling", () => {
      const at: Date = minutesAgo(5);

      expect(
        reasonsOf({
          provider: CloudProvider.AWS,
          type: "AWS::Lambda::Function",
          readings: {
            "aws/lambda/invocations": reading(100, at),
            "aws/lambda/errors": reading(60, at),
            "aws/lambda/throttles": reading(3, at),
          },
        }),
      ).toEqual(["60% of invocations failed", "Throttled"]);

      const reasons: Array<CloudHealthText> = assess({
        provider: CloudProvider.AWS,
        type: "AWS::Lambda::Function",
        readings: {
          "aws/lambda/invocations": reading(100, at),
          "aws/lambda/errors": reading(60, at),
          "aws/lambda/throttles": reading(3, at),
        },
      }).reasons;

      expect(reasons[0]!.text).toBe(REASON_INVOCATIONS_FAILED);
      expect(reasons[1]!.text).toBe(REASON_THROTTLED);
    });

    test("a queue whose oldest message waits an hour, in hours, then in days", () => {
      const waiting: (seconds: number) => Array<string> = (
        seconds: number,
      ): Array<string> => {
        return reasonsOf({
          provider: CloudProvider.AWS,
          type: "AWS::SQS::Queue",
          readings: {
            "aws/sqs/approximateageofoldestmessage": reading(seconds),
          },
        });
      };

      expect(waiting(CLOUD_BACKLOG_AGE_SECONDS - 1)).toEqual([]);
      expect(waiting(CLOUD_BACKLOG_AGE_SECONDS)).toEqual([
        "Oldest message waiting 1 hour",
      ]);
      expect(waiting(5 * 3600 + 59)).toEqual([
        "Oldest message waiting 5 hours",
      ]);
      expect(waiting(47 * 3600)).toEqual(["Oldest message waiting 47 hours"]);
      expect(waiting(48 * 3600)).toEqual(["Oldest message waiting 2 days"]);
    });

    test("a stream's consumers read in milliseconds", () => {
      expect(
        reasonsOf({
          provider: CloudProvider.AWS,
          type: "AWS::Kinesis::Stream",
          readings: {
            "aws/kinesis/getrecords.iteratoragemilliseconds": reading(
              2 * 3600 * 1000,
            ),
          },
        }),
      ).toEqual(["Consumers 2 hours behind"]);
    });

    test("the backlog's words: each unit its own count-dependent sentence", () => {
      expect(
        getCloudBacklogText(REASON_OLDEST_MESSAGE_WAITING, 3 * 86400),
      ).toEqual({
        text: REASON_OLDEST_MESSAGE_WAITING.days.other,
        values: { count: "3" },
        plural: { one: REASON_OLDEST_MESSAGE_WAITING.days.one, count: 3 },
      });
      expect(getCloudBacklogText(REASON_CONSUMERS_BEHIND, 3600)).toEqual({
        text: REASON_CONSUMERS_BEHIND.hours.other,
        values: { count: "1" },
        plural: { one: REASON_CONSUMERS_BEHIND.hours.one, count: 1 },
      });
    });

    test("a VPN with its tunnels down, and a Route 53 health check failing", () => {
      expect(
        assess({
          provider: CloudProvider.AWS,
          type: "AWS::EC2::VPNConnection",
          readings: { "aws/vpn/tunnelstate": reading(0) },
        }).severity,
      ).toBe(CloudHealthSeverity.Critical);
      expect(
        assess({
          provider: CloudProvider.AWS,
          type: "AWS::EC2::VPNConnection",
          readings: { "aws/vpn/tunnelstate": reading(1) },
        }).state,
      ).toBe("healthy");
      expect(
        reasonsOf({
          provider: CloudProvider.AWS,
          type: "AWS::Route53::HealthCheck",
          readings: { "aws/route53/healthcheckstatus": reading(0) },
        }),
      ).toEqual(["Health check failing"]);
    });

    test("an Azure VM that is not available", () => {
      const down: CloudHealthAssessment = assess({
        provider: CloudProvider.Azure,
        type: "Microsoft.Compute/virtualMachines",
        readings: { vmavailabilitymetric: reading(0) },
      });

      expect(down.severity).toBe(CloudHealthSeverity.Critical);
      expect(down.reasons).toEqual([{ text: REASON_NOT_AVAILABLE }]);
      expect(
        assess({
          provider: CloudProvider.Azure,
          type: "microsoft.compute/VIRTUALMACHINES",
          readings: { vmavailabilitymetric: reading(1) },
        }).state,
      ).toBe("healthy");
    });

    test("an Azure storage account's availability: 99.9% is fine, under it a look, under 90% broken", () => {
      const availability: (percent: number) => CloudHealthAssessment = (
        percent: number,
      ): CloudHealthAssessment => {
        return assess({
          provider: CloudProvider.Azure,
          type: "Microsoft.Storage/storageAccounts",
          readings: { availability: reading(percent) },
        });
      };

      expect(availability(99.9).state).toBe("healthy");
      expect(availability(99.85).state).toBe("degraded");
      expect(availability(99.85).reasons.map(english)).toEqual([
        "Availability 99.8%",
      ]);
      expect(availability(89).severity).toBe(CloudHealthSeverity.Critical);
    });

    test("an Azure SQL database: storage before CPU, every reason said", () => {
      expect(
        reasonsOf({
          provider: CloudProvider.Azure,
          type: "Microsoft.Sql/servers/databases",
          readings: {
            storage_percent: reading(96),
            cpu_percent: reading(97),
            deadlock: reading(2),
            connection_failed: reading(1),
          },
        }),
      ).toEqual([
        "96% full",
        "CPU at 97%",
        "1 failed connection",
        "2 deadlocks",
      ]);
    });

    test("a Google Cloud SQL disk, from its 0-to-1 ratio", () => {
      expect(
        reasonsOf({
          provider: CloudProvider.GCP,
          type: "cloudsql_database",
          readings: {
            "cloudsql.googleapis.com/database/disk/utilization": reading(0.92),
          },
        }),
      ).toEqual(["92% full"]);
      expect(
        assess({
          provider: CloudProvider.GCP,
          type: "cloudsql_database",
          readings: {
            "cloudsql.googleapis.com/database/disk/utilization": reading(0.96),
          },
        }).severity,
      ).toBe(CloudHealthSeverity.Critical);
    });

    test("critical reasons come first, whatever order the rules are in", () => {
      const reasons: Array<CloudHealthText> = assess({
        provider: CloudProvider.AWS,
        type: "AWS::OpenSearchService::Domain",
        readings: {
          "aws/es/cpuutilization": reading(99),
          "aws/es/clusterstatus.red": reading(1),
        },
      }).reasons;

      expect(reasons.map(english)).toEqual([
        "Cluster status red",
        "CPU at 99%",
      ]);
    });
  });

  describe("what is judged", () => {
    test("a resource that stopped reporting is only that", () => {
      const silent: CloudHealthAssessment = assess({
        provider: CloudProvider.AWS,
        type: EC2,
        readings: { "aws/ec2/statuscheckfailed": reading(1) },
        status: "disconnected",
      });

      expect(silent.state).toBe("not-reporting");
      expect(silent.status.text).toBe(CLOUD_STATUS_NOT_REPORTING);
      expect(silent.severity).toBe(null);
      expect(silent.reasons).toEqual([]);
      expect(silent.tone).toBe("neutral");
    });

    test("readings an hour old are not judged: the resource is Reporting", () => {
      const stale: CloudHealthAssessment = assess({
        provider: CloudProvider.AWS,
        type: EC2,
        readings: { "aws/ec2/statuscheckfailed": reading(1) },
        writtenAt: new Date(NOW.getTime() - CLOUD_READINGS_STALE_MS - 1),
      });

      expect(stale.state).toBe("reporting");
      expect(stale.status.text).toBe(CLOUD_STATUS_REPORTING);
      expect(stale.severity).toBe(null);
      expect(stale.hasFreshReadings).toBe(false);

      expect(
        hasFreshCloudReadings(
          {
            cloudReadingsAt: new Date(NOW.getTime() - CLOUD_READINGS_STALE_MS),
          },
          NOW,
        ),
      ).toBe(true);
      expect(hasFreshCloudReadings({}, NOW)).toBe(false);
    });

    test("a type no rule speaks for is Reporting, never Healthy", () => {
      const bucket: CloudHealthAssessment = assess({
        provider: CloudProvider.AWS,
        type: "AWS::S3::Bucket",
        readings: { "aws/s3/bucketsizebytes": reading(1000) },
      });

      expect(bucket.state).toBe("reporting");
      expect(bucket.isChecked).toBe(false);
    });

    test("a resource whose rules had none of their readings is Reporting", () => {
      expect(
        assess({
          provider: CloudProvider.AWS,
          type: EC2,
          readings: { "aws/ec2/cpuutilization": reading(20) },
        }).state,
      ).toBe("reporting");
    });

    test("the stored severity is the worst the rules find", () => {
      expect(
        getCloudHealthSeverity({
          provider: "aws",
          type: EC2,
          readings: { "aws/ec2/statuscheckfailed": reading(1) },
        }),
      ).toBe(CloudHealthSeverity.Critical);
      expect(
        getCloudHealthSeverity({
          provider: "aws",
          type: "AWS::DynamoDB::Table",
          readings: { "aws/dynamodb/writethrottleevents": reading(4) },
        }),
      ).toBe(CloudHealthSeverity.Warning);
      expect(
        getCloudHealthSeverity({
          provider: "aws",
          type: EC2,
          readings: { "aws/ec2/statuscheckfailed": reading(0) },
        }),
      ).toBe(null);
      expect(
        findCloudHealthProblems({
          provider: "aws",
          type: "AWS::S3::Bucket",
          readings: {},
        }),
      ).toEqual({ findings: [], isChecked: false });
    });

    test("the status words are the ones every resource product uses", () => {
      expect([
        CLOUD_STATUS_HEALTHY,
        CLOUD_STATUS_DEGRADED,
        CLOUD_STATUS_UNHEALTHY,
        CLOUD_STATUS_REPORTING,
        CLOUD_STATUS_NOT_REPORTING,
      ]).toEqual([
        "Healthy",
        "Degraded",
        "Unhealthy",
        "Reporting",
        "Not reporting",
      ]);
    });
  });

  describe("reading what is stored", () => {
    test("a reading that is not a number, or not at a time, is left out", () => {
      expect(
        readCloudResourceReadings({
          "AWS/EC2/StatusCheckFailed": { value: 1, time: NOW.toISOString() },
          broken: { value: "x", time: NOW.toISOString() },
          empty: { value: "", time: NOW.toISOString() },
          missing: { value: null, time: NOW.toISOString() },
          timeless: { value: 3, time: "never" },
          list: [1, 2],
          text: "5",
        }),
      ).toEqual({
        "aws/ec2/statuscheckfailed": { value: 1, time: NOW.toISOString() },
      });
      expect(readCloudResourceReadings(null)).toEqual({});
      expect(readCloudResourceReadings([])).toEqual({});
      expect(readCloudResourceReadings("{}")).toEqual({});
    });

    test("a number written as text is read as the number", () => {
      expect(
        readCloudResourceReadings({ a: { value: "12.5", time: "2026-11-03" } }),
      ).toEqual({ a: { value: 12.5, time: "2026-11-03T00:00:00.000Z" } });
    });
  });

  describe("formats", () => {
    test("a percent is whole, and stays under 100 until it is", () => {
      expect(formatCloudPercent(96.4)).toBe("96%");
      expect(formatCloudPercent(99.95)).toBe("99.9%");
      expect(formatCloudPercent(99.5)).toBe("99.5%");
      expect(formatCloudPercent(100)).toBe("100%");
      expect(formatCloudPercent(5)).toBe("5%");
    });

    test("a reading's period: CloudWatch's own, a minute elsewhere", () => {
      expect(
        getCloudReadingPeriodSeconds("aws", "aws/applicationelb/requestcount"),
      ).toBe(AWS_DEFAULT_PERIOD_SECONDS);
      expect(
        getCloudReadingPeriodSeconds("aws", "aws/s3/bucketsizebytes"),
      ).toBe(DAILY_PERIOD_SECONDS);
      expect(getCloudReadingPeriodSeconds("aws", "aws/unknown/metric")).toBe(
        AWS_DEFAULT_PERIOD_SECONDS,
      );
      expect(getCloudReadingPeriodSeconds("azure", "requests")).toBe(60);
      expect(
        getCloudReadingPeriodSeconds("gcp", "run.googleapis.com/request_count"),
      ).toBe(60);
    });
  });
});
