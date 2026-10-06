/*
 * PasswordHash has a known, pre-existing TS5.9 compile failure under
 * ts-jest that breaks every suite whose import graph reaches it -
 * including all full-loop telemetry suites. Nothing here touches password
 * hashing; stub it before the service import graph drags it in.
 */
jest.mock("Common/Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: class PasswordHashStub {},
  };
});

import OtelMetricsIngestService from "../../FeatureSet/Telemetry/Services/OtelMetricsIngestService";
import MetricPipelineRuleService, {
  MetricRulesForProject,
} from "../../FeatureSet/Telemetry/Services/MetricPipelineRuleService";
import { TelemetryServiceMetadata } from "Common/Server/Services/OpenTelemetryIngestService";
import TelemetryUtil from "Common/Server/Utils/Telemetry/Telemetry";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import MetricPipelineRule from "Common/Models/DatabaseModels/MetricPipelineRule";
import {
  CloudMonitoredResource,
  CloudMonitoringSource,
} from "Common/Types/Cloud/CloudMonitoredResource";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import { JSONObject } from "Common/Types/JSON";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * Cloud resource discovery through the real metrics ingest loop
 * (OtelMetricsIngestService.processMetricsFromQueue), one request per
 * receiver, in the wire shape each sends:
 *
 *   - azure_monitor: the subscription on the resource, each resource's ARM
 *     id, name, type, group and location on its datapoints, many resources
 *     under one OTel resource;
 *   - CloudWatch, OpenTelemetry 1.0 (Metric Streams through awsfirehose, and
 *     the aws_cloudwatch receiver): a Summary per metric, `Namespace` and the
 *     `Dimensions` kvlist on the datapoint;
 *   - a CloudWatch JSON stream: one OTel resource per namespace, dimensions
 *     as datapoint attributes, InstanceId as service.instance.id;
 *   - googlecloudmonitoring: the monitored resource on the OTel resource.
 *
 * Pinned: which resources reach autoDiscoverCloudMonitoredResources (each
 * once, however many datapoints name it), that it runs after the rows are
 * written, that a datapoint the pipeline rules drop names no resource, that
 * ordinary telemetry costs it nothing, and that its failure never fails the
 * batch.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const START_MS: number = Date.UTC(2026, 9, 6, 10, 0, 0, 0);
const START_NANO: string = `${START_MS}000000`;
const SUBSCRIPTION: string = "7c4a1f2e-9d3b-4e5f-8a6b-1c2d3e4f5a6b";

type OtlpAttribute = {
  key: string;
  value: JSONObject;
};

function stringAttribute(key: string, value: string): OtlpAttribute {
  return { key: key, value: { stringValue: value } };
}

function kvlistAttribute(
  key: string,
  values: Array<OtlpAttribute>,
): OtlpAttribute {
  return {
    key: key,
    value: { kvlistValue: { values: values } } as unknown as JSONObject,
  };
}

const AUTO_DISCOVERY_METHODS: Array<string> = [
  "autoDiscoverKubernetesCluster",
  "autoDiscoverDockerHost",
  "autoDiscoverPodmanHost",
  "autoDiscoverProxmoxCluster",
  "autoDiscoverVMwareVCenter",
  "autoDiscoverCephCluster",
  "autoDiscoverStorageArray",
  "autoDiscoverDockerSwarmCluster",
  "autoDiscoverIoTFleet",
  "autoDiscoverHost",
  "autoDiscoverServerless",
  "autoDiscoverCloudResource",
  "autoDiscoverRum",
  "autoDiscoverDatabaseServer",
];

/* eslint-disable @typescript-eslint/no-explicit-any */
const service: Record<string, any> =
  OtelMetricsIngestService as unknown as Record<string, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

type Harness = {
  rows: Array<JSONObject>;
  discovered: Array<Array<CloudMonitoredResource>>;
  // The rows already submitted when discovery ran.
  rowsAtDiscovery: Array<number>;
  discover: jest.SpyInstance;
};

function setup(rules?: MetricRulesForProject): Harness {
  const harness: Harness = {
    rows: [],
    discovered: [],
    rowsAtDiscovery: [],
    discover: undefined as unknown as jest.SpyInstance,
  };

  jest.spyOn(service, "runBatchHostEnrichment").mockResolvedValue(undefined);
  jest
    .spyOn(service, "submitMetricsBuffer")
    .mockImplementation((...args: Array<unknown>): Promise<void> => {
      const buffer: Array<JSONObject> = args[0] as Array<JSONObject>;
      harness.rows.push(...buffer.splice(0, buffer.length));
      return Promise.resolve();
    });
  for (const method of AUTO_DISCOVERY_METHODS) {
    jest.spyOn(service, method).mockResolvedValue(null);
  }
  harness.discover = jest
    .spyOn(service, "autoDiscoverCloudMonitoredResources")
    .mockImplementation(
      async (data: {
        projectId: ObjectID;
        resources: Array<CloudMonitoredResource>;
      }): Promise<number> => {
        harness.discovered.push(data.resources);
        harness.rowsAtDiscovery.push(harness.rows.length);
        return data.resources.length;
      },
    );
  jest
    .spyOn(service, "resolveTelemetryResource")
    .mockImplementation(async (): Promise<TelemetryServiceMetadata> => {
      return {
        serviceName: "Unknown Service",
        primaryEntityId: PROJECT_ID,
        primaryEntityType: ServiceType.Unknown,
        entityKeys: [],
        dataRententionInDays: 15,
        serviceRetentionConfig: null,
        serviceRetentionInDays: null,
        projectRetentionConfig: null,
        projectRetentionInDays: 15,
      } as unknown as TelemetryServiceMetadata;
    });
  jest
    .spyOn(MetricPipelineRuleService, "loadRules")
    .mockResolvedValue(
      rules || { projectRules: [], rulesByServiceId: new Map() },
    );
  jest
    .spyOn(TelemetryUtil, "indexMetricNameServiceNameMap")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .mockResolvedValue(undefined as any);

  return harness;
}

afterEach(() => {
  jest.restoreAllMocks();
});

function gauge(
  name: string,
  datapoints: Array<Array<OtlpAttribute>>,
): JSONObject {
  return {
    name: name,
    unit: "Percent",
    gauge: {
      dataPoints: datapoints.map(
        (attributes: Array<OtlpAttribute>): JSONObject => {
          return {
            timeUnixNano: START_NANO,
            asDouble: 12.5,
            attributes: attributes,
          } as unknown as JSONObject;
        },
      ),
    },
  } as unknown as JSONObject;
}

// CloudWatch's OpenTelemetry 1.0 shape: one Summary per period.
function summary(
  name: string,
  datapoints: Array<Array<OtlpAttribute>>,
): JSONObject {
  return {
    name: name,
    unit: "{Count}",
    summary: {
      dataPoints: datapoints.map(
        (attributes: Array<OtlpAttribute>): JSONObject => {
          return {
            startTimeUnixNano: START_NANO,
            timeUnixNano: START_NANO,
            count: 1,
            sum: 3,
            quantileValues: [
              { quantile: 0, value: 3 },
              { quantile: 1, value: 3 },
            ],
            attributes: attributes,
          } as unknown as JSONObject;
        },
      ),
    },
  } as unknown as JSONObject;
}

function request(
  resources: Array<{
    attributes: Array<OtlpAttribute>;
    metrics: Array<JSONObject>;
  }>,
): TelemetryRequest {
  return {
    projectId: PROJECT_ID,
    body: {
      resourceMetrics: resources.map(
        (resource: {
          attributes: Array<OtlpAttribute>;
          metrics: Array<JSONObject>;
        }): JSONObject => {
          return {
            resource: { attributes: resource.attributes },
            scopeMetrics: [
              {
                scope: {
                  name: "github.com/open-telemetry/opentelemetry-collector-contrib",
                  version: "0.161.0",
                },
                metrics: resource.metrics,
              },
            ],
          } as unknown as JSONObject;
        },
      ),
    },
    headers: {},
  } as unknown as TelemetryRequest;
}

function azureDatapoint(
  type: string,
  path: string,
  name: string,
  extra: Array<OtlpAttribute> = [],
): Array<OtlpAttribute> {
  return [
    stringAttribute(
      "azuremonitor.resource_id",
      `/subscriptions/${SUBSCRIPTION}/resourceGroups/rg-prod/providers/${path}`,
    ),
    stringAttribute("name", name),
    stringAttribute("type", type),
    stringAttribute("resource_group", "rg-prod"),
    stringAttribute("location", "westeurope"),
    stringAttribute("timegrain", "PT1M"),
    ...extra,
  ];
}

const AZURE_RESOURCE: Array<OtlpAttribute> = [
  stringAttribute("azuremonitor.subscription_id", SUBSCRIPTION),
  stringAttribute("azuremonitor.tenant_id", "0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b"),
];

function summaryOf(
  resources: Array<CloudMonitoredResource>,
): Array<string> {
  return resources.map((resource: CloudMonitoredResource): string => {
    return `${resource.source} ${resource.resourceType} ${resource.name}`;
  });
}

describe("Azure Monitor", () => {
  test("a subscription's resources under one OTel resource are each discovered once", async () => {
    const harness: Harness = setup();

    await OtelMetricsIngestService.processMetricsFromQueue(
      request([
        {
          attributes: AZURE_RESOURCE,
          metrics: [
            gauge("azure_percentage_cpu_average", [
              azureDatapoint(
                "Microsoft.Compute/virtualMachines",
                "Microsoft.Compute/virtualMachines/vm-web-1",
                "vm-web-1",
              ),
              azureDatapoint(
                "Microsoft.Compute/virtualMachines",
                "Microsoft.Compute/virtualMachines/vm-web-2",
                "vm-web-2",
              ),
            ]),
            gauge("azure_network_in_total_total", [
              azureDatapoint(
                "Microsoft.Compute/virtualMachines",
                "Microsoft.Compute/virtualMachines/vm-web-1",
                "vm-web-1",
              ),
            ]),
            gauge("azure_availability_average", [
              azureDatapoint(
                "Microsoft.Storage/storageAccounts",
                "Microsoft.Storage/storageAccounts/stprod01",
                "stprod01",
                [stringAttribute("metadata_ApiName", "GetBlob")],
              ),
              azureDatapoint(
                "Microsoft.Storage/storageAccounts",
                "Microsoft.Storage/storageAccounts/stprod01",
                "stprod01",
                [stringAttribute("metadata_ApiName", "PutBlob")],
              ),
            ]),
          ],
        },
      ]),
    );

    expect(harness.discover).toHaveBeenCalledTimes(1);
    expect(summaryOf(harness.discovered[0]!)).toEqual([
      `${CloudMonitoringSource.AzureMonitor} Microsoft.Compute/virtualMachines vm-web-1`,
      `${CloudMonitoringSource.AzureMonitor} Microsoft.Compute/virtualMachines vm-web-2`,
      `${CloudMonitoringSource.AzureMonitor} Microsoft.Storage/storageAccounts stprod01`,
    ]);
    // Every datapoint was written before discovery ran.
    expect(harness.rows).toHaveLength(5);
    expect(harness.rowsAtDiscovery).toEqual([5]);
  });

  test("the resource's telemetry attributes are the stored row's", async () => {
    const harness: Harness = setup();

    await OtelMetricsIngestService.processMetricsFromQueue(
      request([
        {
          attributes: AZURE_RESOURCE,
          metrics: [
            gauge("azure_percentage_cpu_average", [
              azureDatapoint(
                "Microsoft.Compute/virtualMachines",
                "Microsoft.Compute/virtualMachines/vm-web-1",
                "vm-web-1",
              ),
            ]),
          ],
        },
      ]),
    );

    const resource: CloudMonitoredResource = harness.discovered[0]![0]!;
    const row: JSONObject = harness.rows[0]!;
    const stored: JSONObject = row["attributes"] as JSONObject;
    for (const [key, value] of Object.entries(resource.telemetryAttributes)) {
      expect(stored[key]).toBe(value);
    }
    expect(resource.accountId).toBe(SUBSCRIPTION);
  });
});

describe("CloudWatch", () => {
  test("OpenTelemetry 1.0 summaries: the Dimensions kvlist names each resource", async () => {
    const harness: Harness = setup();
    const resource: Array<OtlpAttribute> = [
      stringAttribute("cloud.provider", "aws"),
      stringAttribute("cloud.account.id", "123456789012"),
      stringAttribute("cloud.region", "us-east-1"),
      stringAttribute(
        "aws.exporter.arn",
        "arn:aws:cloudwatch:us-east-1:123456789012:metric-stream/oneuptime",
      ),
    ];

    await OtelMetricsIngestService.processMetricsFromQueue(
      request([
        {
          attributes: resource,
          metrics: [
            summary("amazonaws.com/AWS/EC2/CPUUtilization", [
              [
                stringAttribute("Namespace", "AWS/EC2"),
                stringAttribute("MetricName", "CPUUtilization"),
                kvlistAttribute("Dimensions", [
                  stringAttribute("InstanceId", "i-0abc123def"),
                ]),
              ],
              // EC2's per-type aggregate names no resource.
              [
                stringAttribute("Namespace", "AWS/EC2"),
                stringAttribute("MetricName", "CPUUtilization"),
                kvlistAttribute("Dimensions", [
                  stringAttribute("InstanceType", "m5.large"),
                ]),
              ],
            ]),
            summary("amazonaws.com/AWS/ApplicationELB/RequestCount", [
              [
                stringAttribute("Namespace", "AWS/ApplicationELB"),
                stringAttribute("MetricName", "RequestCount"),
                kvlistAttribute("Dimensions", [
                  stringAttribute(
                    "LoadBalancer",
                    "app/checkout/50dc6c495c0c9188",
                  ),
                  stringAttribute(
                    "TargetGroup",
                    "targetgroup/checkout-tg/73e2d6bc24d8a067",
                  ),
                ]),
              ],
            ]),
          ],
        },
      ]),
    );

    const discovered: Array<CloudMonitoredResource> = harness.discovered[0]!;
    expect(summaryOf(discovered)).toEqual([
      `${CloudMonitoringSource.AwsCloudWatch} AWS::EC2::Instance i-0abc123def`,
      `${CloudMonitoringSource.AwsCloudWatch} AWS::ElasticLoadBalancingV2::LoadBalancer checkout`,
    ]);
    expect(discovered[0]!.providerResourceId).toBe(
      "arn:aws:ec2:us-east-1:123456789012:instance/i-0abc123def",
    );
    expect(harness.rows).toHaveLength(3);
  });

  test("a JSON stream: InstanceId arrives as service.instance.id and names the same instance", async () => {
    const harness: Harness = setup();

    await OtelMetricsIngestService.processMetricsFromQueue(
      request([
        {
          attributes: [
            stringAttribute("cloud.provider", "aws"),
            stringAttribute("cloud.account.id", "123456789012"),
            stringAttribute("cloud.region", "us-east-1"),
            stringAttribute("service.namespace", "AWS"),
            stringAttribute("service.name", "EC2"),
            stringAttribute("aws.cloudwatch.metric_stream_name", "oneuptime"),
          ],
          metrics: [
            summary("CPUUtilization", [
              [stringAttribute("service.instance.id", "i-0abc123def")],
            ]),
          ],
        },
      ]),
    );

    expect(summaryOf(harness.discovered[0]!)).toEqual([
      `${CloudMonitoringSource.AwsCloudWatchJson} AWS::EC2::Instance i-0abc123def`,
    ]);
  });
});

describe("Google Cloud Monitoring", () => {
  test("the monitored resource on the OTel resource names it", async () => {
    const harness: Harness = setup();

    await OtelMetricsIngestService.processMetricsFromQueue(
      request([
        {
          attributes: [
            stringAttribute("gcp.resource_type", "gce_instance"),
            stringAttribute("project_id", "acme-prod"),
            stringAttribute("zone", "us-central1-a"),
            stringAttribute("instance_id", "4529012345678901234"),
            stringAttribute("name", 'string_value:"web-1"'),
          ],
          metrics: [
            gauge("compute.googleapis.com/instance/cpu/utilization", [[]]),
            gauge(
              "compute.googleapis.com/instance/network/received_bytes_count",
              [[stringAttribute("loadbalanced", "false")]],
            ),
          ],
        },
      ]),
    );

    expect(summaryOf(harness.discovered[0]!)).toEqual([
      `${CloudMonitoringSource.GoogleCloudMonitoring} gce_instance web-1`,
    ]);
  });
});

describe("what never names a resource", () => {
  test("ordinary telemetry hands discovery nothing", async () => {
    const harness: Harness = setup();

    await OtelMetricsIngestService.processMetricsFromQueue(
      request([
        {
          attributes: [
            stringAttribute("service.name", "checkout"),
            stringAttribute("cloud.provider", "aws"),
          ],
          metrics: [
            gauge("http.server.active_requests", [
              [stringAttribute("http.route", "/orders")],
            ]),
          ],
        },
      ]),
    );

    expect(harness.discovered).toEqual([[]]);
    expect(harness.rows).toHaveLength(1);
  });

  test("a datapoint the pipeline rules drop names no resource", async () => {
    const harness: Harness = setup({
      projectRules: [new MetricPipelineRule()],
      rulesByServiceId: new Map(),
    });
    jest
      .spyOn(MetricPipelineRuleService, "applyRules")
      .mockImplementation((row: JSONObject): JSONObject | null => {
        const attributes: JSONObject = row["attributes"] as JSONObject;
        return attributes["name"] === "vm-dropped" ? null : row;
      });

    await OtelMetricsIngestService.processMetricsFromQueue(
      request([
        {
          attributes: AZURE_RESOURCE,
          metrics: [
            gauge("azure_percentage_cpu_average", [
              azureDatapoint(
                "Microsoft.Compute/virtualMachines",
                "Microsoft.Compute/virtualMachines/vm-kept",
                "vm-kept",
              ),
              azureDatapoint(
                "Microsoft.Compute/virtualMachines",
                "Microsoft.Compute/virtualMachines/vm-dropped",
                "vm-dropped",
              ),
            ]),
          ],
        },
      ]),
    );

    expect(
      harness.discovered[0]!.map((resource: CloudMonitoredResource) => {
        return resource.name;
      }),
    ).toEqual(["vm-kept"]);
    expect(harness.rows).toHaveLength(1);
  });
});

describe("resilience", () => {
  test("a failing discovery never fails the batch whose rows already landed", async () => {
    const harness: Harness = setup();
    harness.discover.mockRejectedValue(new Error("Postgres said no"));

    await expect(
      OtelMetricsIngestService.processMetricsFromQueue(
        request([
          {
            attributes: AZURE_RESOURCE,
            metrics: [
              gauge("azure_percentage_cpu_average", [
                azureDatapoint(
                  "Microsoft.Compute/virtualMachines",
                  "Microsoft.Compute/virtualMachines/vm-web-1",
                  "vm-web-1",
                ),
              ]),
            ],
          },
        ]),
      ),
    ).resolves.toBeUndefined();

    expect(harness.rows).toHaveLength(1);
  });
});
