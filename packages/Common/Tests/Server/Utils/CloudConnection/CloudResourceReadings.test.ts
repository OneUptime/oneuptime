import CloudResourceReadingsWriter, {
  CLOUD_READINGS_WRITE_BATCH_SIZE,
  CollectedCloudReadings,
  CloudReadingsWriteResult,
  collectCloudResourceReadings,
  readDatapointTimeMs,
} from "../../../../Server/Utils/CloudConnection/CloudResourceReadings";
import {
  CloudMetricGroup,
  OtlpAttribute,
  buildMetricsPayloads,
  connectionResourceAttributes,
  kvlistAttribute,
  stringAttribute,
} from "../../../../Server/Utils/CloudConnection/CloudMetricPayload";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import CloudResource from "../../../../Models/DatabaseModels/CloudResource";
import CloudResourceService from "../../../../Server/Services/CloudResourceService";
import {
  getAwsStoredMetricName,
  getAzureStoredMetricName,
} from "../../../../Types/Cloud/CloudKeyMetrics";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import {
  CLOUD_READINGS_STALE_MS,
  CloudHealthSeverity,
} from "../../../../Types/Cloud/CloudResourceHealth";
import {
  CloudMonitoredResource,
  buildCloudMonitoredResourceIdentifier,
} from "../../../../Types/Cloud/CloudMonitoredResource";
import { resolveCloudResourceOf } from "../../../../Server/Utils/CloudConnection/CloudMetricPayload";
import { CloudResourceKind } from "../../../../Types/Cloud/CloudResourceKind";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";

/*
 * A resource's readings, from what a cloud connection's read brought in
 * (CloudResourceReadings): the newest value of each metric its type is
 * judged by or leads with, per resource, from the OTLP payloads the read
 * hands the ingest - nothing of a metric no rule reads, nothing of a
 * datapoint whose resource cannot be told - and written onto the
 * connection's rows with the severity its rules find, in batches, pinned
 * to the project; stale severities are cleared, and a failure is logged,
 * never thrown. `jest` is the global one.
 */

const PROJECT: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const CONNECTION: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const ACCOUNT: string = "123456789012";
const NOW: Date = new Date("2026-11-03T10:00:00.000Z");
const T1: number = Date.parse("2026-11-03T09:50:00.000Z");
const T2: number = Date.parse("2026-11-03T09:55:00.000Z");

function awsGroup(
  metrics: Array<{
    namespace: string;
    metricName: string;
    dimensions: Array<{ name: string; value: string }>;
    points: Array<{ timeMs: number; value: number }>;
  }>,
): CloudMetricGroup {
  const group: CloudMetricGroup = {
    resourceAttributes: [
      ...connectionResourceAttributes({
        serviceName: "aws-production",
        connectionId: CONNECTION.toString(),
        cloudProvider: CloudProvider.AWS,
      }),
      stringAttribute("cloud.account.id", ACCOUNT),
      stringAttribute("cloud.region", "us-east-1"),
    ],
    metrics: [],
  };

  for (const metric of metrics) {
    const name: string = getAwsStoredMetricName(
      metric.namespace,
      metric.metricName,
    );
    let entry: CloudMetricGroup["metrics"][number] | undefined =
      group.metrics.find((candidate: { name: string }): boolean => {
        return candidate.name === name;
      });

    if (!entry) {
      entry = { name, unit: "Count", datapointSets: [] };
      group.metrics.push(entry);
    }

    entry.datapointSets.push({
      attributes: [
        stringAttribute("Namespace", metric.namespace),
        stringAttribute("MetricName", metric.metricName),
        kvlistAttribute(
          "Dimensions",
          metric.dimensions.map(
            (dimension: { name: string; value: string }): OtlpAttribute => {
              return stringAttribute(dimension.name, dimension.value);
            },
          ),
        ),
      ],
      points: metric.points,
    });
  }

  return group;
}

function instance(id: string): Array<{ name: string; value: string }> {
  return [{ name: "InstanceId", value: id }];
}

// The resource the ingest files a datapoint of these attributes under.
function resourceOf(group: CloudMetricGroup, metricIndex: number = 0): CloudMonitoredResource {
  const metric: CloudMetricGroup["metrics"][number] = group.metrics[metricIndex]!;
  return resolveCloudResourceOf({
    metricName: metric.name,
    resourceAttributes: group.resourceAttributes,
    datapointAttributes: metric.datapointSets[0]!.attributes,
  }) as CloudMonitoredResource;
}

function identifierOf(resource: CloudMonitoredResource): string {
  return buildCloudMonitoredResourceIdentifier(resource).toLowerCase();
}

describe("collectCloudResourceReadings", () => {
  test("keeps, per resource, the newest value of each metric its type reads", () => {
    const group: CloudMetricGroup = awsGroup([
      {
        namespace: "AWS/EC2",
        metricName: "StatusCheckFailed",
        dimensions: instance("i-0abc"),
        points: [
          { timeMs: T1, value: 1 },
          { timeMs: T2, value: 0 },
        ],
      },
      {
        namespace: "AWS/EC2",
        metricName: "CPUUtilization",
        dimensions: instance("i-0abc"),
        points: [
          { timeMs: T2, value: 41.5 },
          { timeMs: T1, value: 12 },
        ],
      },
    ]);

    const collected: Map<string, CollectedCloudReadings> =
      collectCloudResourceReadings(buildMetricsPayloads([group]));
    const resource: CloudMonitoredResource = resourceOf(group);

    expect(resource.resourceType).toBe("AWS::EC2::Instance");
    expect(Array.from(collected.keys())).toEqual([identifierOf(resource)]);
    expect(collected.get(identifierOf(resource))).toEqual({
      provider: CloudProvider.AWS,
      resourceType: "AWS::EC2::Instance",
      readings: {
        "aws/ec2/statuscheckfailed": {
          value: 0,
          time: new Date(T2).toISOString(),
        },
        "aws/ec2/cpuutilization": {
          value: 41.5,
          time: new Date(T2).toISOString(),
        },
      },
    });
  });

  test("leaves out a metric no rule reads and no page leads with", () => {
    const collected: Map<string, CollectedCloudReadings> =
      collectCloudResourceReadings(
        buildMetricsPayloads([
          awsGroup([
            {
              namespace: "AWS/EC2",
              metricName: "NetworkIn",
              dimensions: instance("i-0abc"),
              points: [{ timeMs: T2, value: 9000 }],
            },
          ]),
        ]),
      );

    expect(collected.size).toBe(0);
  });

  test("keeps two resources apart, and the metrics of each", () => {
    const group: CloudMetricGroup = awsGroup([
      {
        namespace: "AWS/EC2",
        metricName: "StatusCheckFailed",
        dimensions: instance("i-0abc"),
        points: [{ timeMs: T2, value: 1 }],
      },
      {
        namespace: "AWS/EC2",
        metricName: "StatusCheckFailed",
        dimensions: instance("i-0def"),
        points: [{ timeMs: T2, value: 0 }],
      },
    ]);

    const collected: Map<string, CollectedCloudReadings> =
      collectCloudResourceReadings(buildMetricsPayloads([group]));

    expect(collected.size).toBe(2);

    const values: Array<number> = Array.from(collected.values()).map(
      (entry: CollectedCloudReadings): number => {
        return entry.readings["aws/ec2/statuscheckfailed"]!.value;
      },
    );

    expect(values.sort()).toEqual([0, 1]);
  });

  test("reads Azure's stored names, whichever aggregation, by their key", () => {
    const armId: string =
      "/subscriptions/aaaaaaaa-0000-4000-8000-000000000001/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/web-01";
    const group: CloudMetricGroup = {
      resourceAttributes: [
        ...connectionResourceAttributes({
          serviceName: "azure-production",
          connectionId: CONNECTION.toString(),
          cloudProvider: CloudProvider.Azure,
        }),
        stringAttribute(
          "azuremonitor.subscription_id",
          "aaaaaaaa-0000-4000-8000-000000000001",
        ),
      ],
      metrics: [
        {
          name: getAzureStoredMetricName("VmAvailabilityMetric", "Average"),
          unit: "Count",
          datapointSets: [
            {
              attributes: [
                stringAttribute("azuremonitor.resource_id", armId),
                stringAttribute("name", "web-01"),
                stringAttribute("type", "Microsoft.Compute/virtualMachines"),
                stringAttribute("resource_group", "rg"),
                stringAttribute("location", "westeurope"),
              ],
              points: [{ timeMs: T2, value: 0 }],
            },
          ],
        },
      ],
    };

    const collected: Map<string, CollectedCloudReadings> =
      collectCloudResourceReadings(buildMetricsPayloads([group]));
    const entry: CollectedCloudReadings | undefined = Array.from(
      collected.values(),
    )[0];

    expect(entry?.provider).toBe(CloudProvider.Azure);
    expect(entry?.readings).toEqual({
      vmavailabilitymetric: { value: 0, time: new Date(T2).toISOString() },
    });
  });

  test("skips what cannot be read, and never throws on a malformed payload", () => {
    const collected: Map<string, CollectedCloudReadings> =
      collectCloudResourceReadings([
        {},
        { resourceMetrics: "nope" } as unknown as JSONObject,
        {
          resourceMetrics: [
            {
              resource: { attributes: [] },
              scopeMetrics: [
                {
                  metrics: [
                    {
                      name: "amazonaws.com/AWS/EC2/StatusCheckFailed",
                      gauge: {
                        dataPoints: [
                          // No resource: no Namespace or Dimensions.
                          { timeUnixNano: "1762163700000000000", asDouble: 1 },
                          // No time.
                          { asDouble: 1, attributes: [] },
                          // No value.
                          { timeUnixNano: "1762163700000000000" },
                        ],
                      },
                    },
                    { gauge: { dataPoints: [{}] } },
                  ],
                },
              ],
            },
          ],
        } as unknown as JSONObject,
      ]);

    expect(collected.size).toBe(0);
  });

  test("a datapoint's time is its nanoseconds in milliseconds", () => {
    expect(readDatapointTimeMs("1762163700000000000")).toBe(1762163700000);
    expect(readDatapointTimeMs(1762163700000000000)).toBe(1762163700000);
    expect(readDatapointTimeMs("12:00")).toBe(null);
    expect(readDatapointTimeMs("")).toBe(null);
    expect(readDatapointTimeMs(undefined)).toBe(null);
  });
});

describe("CloudResourceReadingsWriter", () => {
  let rows: Array<CloudResource>;
  let query: jest.Mock;
  let findBy: jest.SpiedFunction<typeof CloudResourceService.findBy>;

  function rowFor(
    id: string,
    identifier: string,
    type: string,
    properties?: JSONObject,
  ): CloudResource {
    const model: CloudResource = new CloudResource();
    model.id = new ObjectID(id);
    model.resourceIdentifier = identifier;
    model.cloudProvider = "aws";
    model.cloudResourceType = type;
    if (properties) {
      model.cloudProperties = properties;
    }
    return model;
  }

  function writes(): Array<{ sql: string; parameters: Array<unknown> }> {
    return query.mock.calls
      .map((call: Array<unknown>) => {
        return { sql: call[0] as string, parameters: call[1] as Array<unknown> };
      })
      .filter((item: { sql: string }): boolean => {
        return item.sql.includes(`SET "cloudReadings"`);
      });
  }

  function clears(): Array<{ sql: string; parameters: Array<unknown> }> {
    return query.mock.calls
      .map((call: Array<unknown>) => {
        return { sql: call[0] as string, parameters: call[1] as Array<unknown> };
      })
      .filter((item: { sql: string }): boolean => {
        return item.sql.includes(`SET "healthSeverity" = NULL`);
      });
  }

  beforeEach(() => {
    rows = [];
    findBy = jest
      .spyOn(CloudResourceService, "findBy")
      .mockImplementation((async () => {
        return rows;
      }) as never);
    query = jest.fn(async (_sql: string, parameters: Array<unknown>) => {
      const ids: Array<string> = (parameters.find(Array.isArray) ||
        []) as Array<string>;
      return [
        ids.map((id: string) => {
          return { _id: id };
        }),
        ids.length,
      ];
    });
    jest
      .spyOn(CloudResourceService, "getRepository")
      .mockReturnValue({ manager: { query } } as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function collectedOf(
    entries: Array<[string, CollectedCloudReadings]>,
  ): Map<string, CollectedCloudReadings> {
    return new Map(entries);
  }

  test("writes each linked resource's readings with the severity its rules find", async () => {
    rows = [
      rowFor("00000000-0000-4000-8000-000000000001", "AWS:Abc", "AWS::EC2::Instance"),
      rowFor("00000000-0000-4000-8000-000000000002", "aws:def", "AWS::EC2::Instance"),
      // Linked to the connection, but this read brought nothing of it.
      rowFor("00000000-0000-4000-8000-000000000003", "aws:quiet", "AWS::EC2::Instance"),
    ];

    const result: CloudReadingsWriteResult =
      await CloudResourceReadingsWriter.write({
        projectId: PROJECT,
        connectionId: CONNECTION,
        writtenAt: NOW,
        collected: collectedOf([
          [
            "aws:abc",
            {
              provider: "aws",
              resourceType: "AWS::EC2::Instance",
              readings: {
                "aws/ec2/statuscheckfailed": {
                  value: 1,
                  time: new Date(T2).toISOString(),
                },
              },
            },
          ],
          [
            "aws:def",
            {
              provider: "aws",
              resourceType: "AWS::EC2::Instance",
              readings: {
                "aws/ec2/statuscheckfailed": {
                  value: 0,
                  time: new Date(T2).toISOString(),
                },
              },
            },
          ],
          // Not linked to this connection: another one writes it.
          [
            "aws:elsewhere",
            {
              provider: "aws",
              resourceType: "AWS::EC2::Instance",
              readings: {
                "aws/ec2/statuscheckfailed": {
                  value: 1,
                  time: new Date(T2).toISOString(),
                },
              },
            },
          ],
        ]),
      });

    // Only the connection's own resources are read.
    expect(findBy.mock.calls[0]![0].query).toEqual({
      projectId: PROJECT,
      cloudConnectionId: CONNECTION,
      cloudResourceKind: CloudResourceKind.Resource,
    });

    expect(writes()).toHaveLength(1);
    const write: { sql: string; parameters: Array<unknown> } = writes()[0]!;
    expect(write.sql).toContain(`resource."projectId" = $1`);
    expect(write.sql).toContain(`resource."deletedAt" IS NULL`);
    expect(write.parameters[0]).toBe(PROJECT.toString());
    expect(write.parameters[1]).toBe(NOW);
    expect(write.parameters[2]).toEqual([
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000002",
    ]);
    expect(
      (write.parameters[3] as Array<string>).map((text: string) => {
        return JSON.parse(text);
      }),
    ).toEqual([
      {
        "aws/ec2/statuscheckfailed": {
          value: 1,
          time: new Date(T2).toISOString(),
        },
      },
      {
        "aws/ec2/statuscheckfailed": {
          value: 0,
          time: new Date(T2).toISOString(),
        },
      },
    ]);
    expect(write.parameters[4]).toEqual([CloudHealthSeverity.Critical, null]);

    expect(result.written).toBe(2);
    expect(result.needingAttention).toBe(1);
  });

  test("judges a database's storage by the allocation its row holds", async () => {
    rows = [
      rowFor(
        "00000000-0000-4000-8000-000000000001",
        "aws:db",
        "AWS::RDS::DBInstance",
        { AllocatedStorage: 100 },
      ),
    ];

    await CloudResourceReadingsWriter.write({
      projectId: PROJECT,
      connectionId: CONNECTION,
      writtenAt: NOW,
      collected: collectedOf([
        [
          "aws:db",
          {
            provider: "aws",
            resourceType: "AWS::RDS::DBInstance",
            readings: {
              "aws/rds/freestoragespace": {
                value: 4 * 1024 * 1024 * 1024,
                time: new Date(T2).toISOString(),
              },
            },
          },
        ],
      ]),
    });

    expect(writes()[0]!.parameters[4]).toEqual([CloudHealthSeverity.Critical]);
  });

  test("writes in batches of CLOUD_READINGS_WRITE_BATCH_SIZE", async () => {
    const entries: Array<[string, CollectedCloudReadings]> = [];

    for (let index: number = 0; index < CLOUD_READINGS_WRITE_BATCH_SIZE + 3; index++) {
      const identifier: string = `aws:r${index}`;
      rows.push(
        rowFor(
          `00000000-0000-4000-8000-${index.toString().padStart(12, "0")}`,
          identifier,
          "AWS::EC2::Instance",
        ),
      );
      entries.push([
        identifier,
        {
          provider: "aws",
          resourceType: "AWS::EC2::Instance",
          readings: {
            "aws/ec2/statuscheckfailed": {
              value: 0,
              time: new Date(T2).toISOString(),
            },
          },
        },
      ]);
    }

    const result: CloudReadingsWriteResult =
      await CloudResourceReadingsWriter.write({
        projectId: PROJECT,
        connectionId: CONNECTION,
        writtenAt: NOW,
        collected: collectedOf(entries),
      });

    expect(
      writes().map((write: { parameters: Array<unknown> }): number => {
        return (write.parameters[2] as Array<string>).length;
      }),
    ).toEqual([CLOUD_READINGS_WRITE_BATCH_SIZE, 3]);
    expect(result.written).toBe(CLOUD_READINGS_WRITE_BATCH_SIZE + 3);
  });

  test("clears the severity of the connection's resources whose readings went stale", async () => {
    const result: CloudReadingsWriteResult =
      await CloudResourceReadingsWriter.write({
        projectId: PROJECT,
        connectionId: CONNECTION,
        writtenAt: NOW,
        collected: new Map(),
      });

    // Nothing collected: no row is read or written, but stale ones are cleared.
    expect(findBy).not.toHaveBeenCalled();
    expect(writes()).toHaveLength(0);
    expect(clears()).toHaveLength(1);

    const clear: { sql: string; parameters: Array<unknown> } = clears()[0]!;
    expect(clear.sql).toContain(`"cloudConnectionId" = $2`);
    expect(clear.sql).toContain(`"healthSeverity" IS NOT NULL`);
    expect(clear.parameters).toEqual([
      PROJECT.toString(),
      CONNECTION.toString(),
      new Date(NOW.getTime() - CLOUD_READINGS_STALE_MS),
    ]);
    expect(result.cleared).toBe(0);
  });

  test("a failure is logged and answered with what was done, never thrown", async () => {
    query.mockImplementation(async () => {
      throw new Error("database is down");
    });
    rows = [
      rowFor("00000000-0000-4000-8000-000000000001", "aws:abc", "AWS::EC2::Instance"),
    ];

    const result: CloudReadingsWriteResult =
      await CloudResourceReadingsWriter.write({
        projectId: PROJECT,
        connectionId: CONNECTION,
        writtenAt: NOW,
        collected: collectedOf([
          [
            "aws:abc",
            {
              provider: "aws",
              resourceType: "AWS::EC2::Instance",
              readings: {
                "aws/ec2/statuscheckfailed": {
                  value: 1,
                  time: new Date(T2).toISOString(),
                },
              },
            },
          ],
        ]),
      });

    expect(result.written).toBe(0);
  });

  test("from a read's payloads, end to end: a failing instance is written critical", async () => {
    const group: CloudMetricGroup = awsGroup([
      {
        namespace: "AWS/EC2",
        metricName: "StatusCheckFailed",
        dimensions: instance("i-0abc"),
        points: [{ timeMs: T2, value: 1 }],
      },
    ]);
    const resource: CloudMonitoredResource = resourceOf(group);

    rows = [
      rowFor(
        "00000000-0000-4000-8000-000000000001",
        buildCloudMonitoredResourceIdentifier(resource),
        "AWS::EC2::Instance",
      ),
    ];

    const result: CloudReadingsWriteResult =
      await CloudResourceReadingsWriter.writeFromPayloads({
        projectId: PROJECT,
        connectionId: CONNECTION,
        writtenAt: NOW,
        payloads: buildMetricsPayloads([group]),
      });

    expect(result).toEqual({ written: 1, needingAttention: 1, cleared: 0 });
    expect(writes()[0]!.parameters[4]).toEqual([CloudHealthSeverity.Critical]);
  });
});
