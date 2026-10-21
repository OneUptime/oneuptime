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
import MetricPipelineRuleService from "../../FeatureSet/Telemetry/Services/MetricPipelineRuleService";
import { TelemetryServiceMetadata } from "Common/Server/Services/OpenTelemetryIngestService";
import TelemetryUtil from "Common/Server/Utils/Telemetry/Telemetry";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import {
  CLOUD_CONNECTION_ID_ATTRIBUTE,
  CloudMetricGroup,
  OtlpAttribute,
  buildMetricsPayloads,
  connectionResourceAttributes,
  kvlistAttribute,
  resolveCloudResourceOf,
  storedAttributesOf,
  stringAttribute,
} from "Common/Server/Utils/CloudConnection/CloudMetricPayload";
import {
  getAwsStoredMetricName,
  getAzureStoredMetricName,
} from "Common/Types/Cloud/CloudKeyMetrics";
import {
  CloudMonitoredResource,
  buildCloudMonitoredResourceIdentifier,
} from "Common/Types/Cloud/CloudMonitoredResource";
import { CloudProvider } from "Common/Types/Cloud/CloudPlatform";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import { JSONObject } from "Common/Types/JSON";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * What a cloud connection imports, through the real metrics ingest loop
 * (OtelMetricsIngestService.processMetricsFromQueue) - the path every read
 * takes (Workers/Jobs/Cloud/ReadCloudConnections) - in the shape each
 * connector builds it (CloudMetricPayload, as AwsCloudConnector,
 * AzureCloudConnector and GcpCloudConnector call it).
 *
 * The connection creates each resource it finds before its metrics are
 * written (CloudConnectionResourceSync), from the identity the connector
 * works out for it: resolveCloudResourceOf over the attributes it would
 * send, without the connection's service or id (an Azure resource from its
 * listing, before any metric). Pinned here: the ingest files the metrics
 * under that same resource - one Cloud Resource, never two - and stores
 * the attributes the connector expects it to (storedAttributesOf), the
 * connection's id among them.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const CONNECTION_ID: string = "33333333-3333-4333-8333-333333333333";
const SERVICE_NAME: string = "Production cloud";
const POINT_MS: number = Date.UTC(2026, 9, 21, 10, 0, 0, 0);
const SUBSCRIPTION: string = "7c4a1f2e-9d3b-4e5f-8a6b-1c2d3e4f5a6b";

/* eslint-disable @typescript-eslint/no-explicit-any */
const service: Record<string, any> =
  OtelMetricsIngestService as unknown as Record<string, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

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

type Harness = {
  rows: Array<JSONObject>;
  discovered: Array<CloudMonitoredResource>;
};

function setup(): Harness {
  const harness: Harness = { rows: [], discovered: [] };

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
  jest
    .spyOn(service, "autoDiscoverCloudMonitoredResources")
    .mockImplementation(async (...args: Array<unknown>): Promise<number> => {
      const data: { resources: Array<CloudMonitoredResource> } = args[0] as {
        resources: Array<CloudMonitoredResource>;
      };
      harness.discovered.push(...data.resources);
      return data.resources.length;
    });
  jest
    .spyOn(service, "resolveTelemetryResource")
    .mockImplementation(async (): Promise<TelemetryServiceMetadata> => {
      return {
        serviceName: SERVICE_NAME,
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
    .mockResolvedValue({ projectRules: [], rulesByServiceId: new Map() });
  jest
    .spyOn(TelemetryUtil, "indexMetricNameServiceNameMap")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .mockResolvedValue(undefined as any);

  return harness;
}

afterEach(() => {
  jest.restoreAllMocks();
});

async function ingest(groups: Array<CloudMetricGroup>): Promise<void> {
  for (const payload of buildMetricsPayloads(groups)) {
    await OtelMetricsIngestService.processMetricsFromQueue({
      projectId: PROJECT_ID,
      body: payload,
      headers: {},
    } as unknown as TelemetryRequest);
  }
}

function connection(cloud: CloudProvider): Array<OtlpAttribute> {
  return connectionResourceAttributes({
    serviceName: SERVICE_NAME,
    connectionId: CONNECTION_ID,
    cloudProvider: cloud,
  });
}

// A connector's identity for a resource: no service, no connection.
function unconnected(cloud: CloudProvider): Array<OtlpAttribute> {
  return connectionResourceAttributes({
    serviceName: "",
    connectionId: "",
    cloudProvider: cloud,
  });
}

function identifiers(resources: Array<CloudMonitoredResource>): Array<string> {
  return Array.from(
    new Set(
      resources.map((resource: CloudMonitoredResource): string => {
        return buildCloudMonitoredResourceIdentifier(resource);
      }),
    ),
  ).sort();
}

function expectStored(row: JSONObject, expected: Record<string, string>): void {
  const stored: JSONObject = row["attributes"] as JSONObject;

  for (const [key, value] of Object.entries(expected)) {
    expect({ key, value: stored[key] }).toEqual({ key, value });
  }
}

describe("AWS: CloudWatch read through a connection", () => {
  const RESOURCE: Array<OtlpAttribute> = [
    stringAttribute("cloud.account.id", "123456789012"),
    stringAttribute("cloud.region", "eu-west-1"),
  ];
  const EC2: Array<OtlpAttribute> = [
    stringAttribute("Namespace", "AWS/EC2"),
    stringAttribute("MetricName", "CPUUtilization"),
    kvlistAttribute("Dimensions", [
      stringAttribute("InstanceId", "i-0abc123def"),
    ]),
  ];
  const RDS: Array<OtlpAttribute> = [
    stringAttribute("Namespace", "AWS/RDS"),
    stringAttribute("MetricName", "FreeStorageSpace"),
    kvlistAttribute("Dimensions", [
      stringAttribute("DBInstanceIdentifier", "orders-db"),
    ]),
  ];

  test("each datapoint is filed under the resource the connection created, and stored as it expects", async () => {
    const harness: Harness = setup();

    await ingest([
      {
        resourceAttributes: [...connection(CloudProvider.AWS), ...RESOURCE],
        metrics: [
          {
            name: getAwsStoredMetricName("AWS/EC2", "CPUUtilization"),
            unit: "Percent",
            datapointSets: [
              {
                attributes: EC2,
                points: [
                  { timeMs: POINT_MS, value: 12.5 },
                  { timeMs: POINT_MS + 300000, value: 14 },
                ],
              },
            ],
          },
          {
            name: getAwsStoredMetricName("AWS/RDS", "FreeStorageSpace"),
            unit: "Bytes",
            datapointSets: [
              { attributes: RDS, points: [{ timeMs: POINT_MS, value: 1e9 }] },
            ],
          },
        ],
      },
    ]);

    const created: Array<CloudMonitoredResource> = [EC2, RDS].map(
      (datapoint: Array<OtlpAttribute>, index: number) => {
        return resolveCloudResourceOf({
          metricName: getAwsStoredMetricName(
            index === 0 ? "AWS/EC2" : "AWS/RDS",
            index === 0 ? "CPUUtilization" : "FreeStorageSpace",
          ),
          resourceAttributes: [...unconnected(CloudProvider.AWS), ...RESOURCE],
          datapointAttributes: datapoint,
        }) as CloudMonitoredResource;
      },
    );

    expect(identifiers(harness.discovered)).toEqual(identifiers(created));
    expect(created[0]!.providerResourceId).toBe(
      "arn:aws:ec2:eu-west-1:123456789012:instance/i-0abc123def",
    );
    expect(harness.rows).toHaveLength(3);

    // The ingest keeps metric names in lower case, a collector's as well.
    const ec2Row: JSONObject = harness.rows.find((row: JSONObject) => {
      return row["name"] === "amazonaws.com/aws/ec2/cpuutilization";
    }) as JSONObject;

    expectStored(ec2Row, {
      ...(storedAttributesOf(
        [...connection(CloudProvider.AWS), ...RESOURCE],
        EC2,
      ) as Record<string, string>),
      [`resource.${CLOUD_CONNECTION_ID_ATTRIBUTE}`]: CONNECTION_ID,
    });
  });
});

describe("Azure: Azure Monitor read through a connection", () => {
  const VM_ID: string = `/subscriptions/${SUBSCRIPTION}/resourceGroups/prod/providers/Microsoft.Compute/virtualMachines/vm-web-1`;
  const VM: {
    armId: string;
    name: string;
    type: string;
    resourceGroup: string;
    location: string;
  } = {
    armId: VM_ID,
    name: "vm-web-1",
    type: "Microsoft.Compute/virtualMachines",
    resourceGroup: "prod",
    location: "westeurope",
  };

  function datapoint(grain: string): Array<OtlpAttribute> {
    const attributes: Array<OtlpAttribute> = [
      stringAttribute("azuremonitor.resource_id", VM.armId),
      stringAttribute("name", VM.name),
      stringAttribute("type", VM.type),
      stringAttribute("resource_group", VM.resourceGroup),
      stringAttribute("location", VM.location),
    ];

    if (grain) {
      attributes.push(stringAttribute("timegrain", grain));
    }

    return attributes;
  }

  test("a resource found in the listing, before any metric, is the one its metrics are filed under", async () => {
    const harness: Harness = setup();

    await ingest([
      {
        resourceAttributes: [
          ...connection(CloudProvider.Azure),
          stringAttribute("azuremonitor.subscription_id", SUBSCRIPTION),
          stringAttribute(
            "azuremonitor.tenant_id",
            "b3c1b5fc-828c-45fa-a1e1-10d74f6d6e9c",
          ),
        ],
        metrics: [
          {
            name: getAzureStoredMetricName("Percentage CPU", "Average"),
            unit: "Percent",
            datapointSets: [
              {
                attributes: datapoint("PT1M"),
                points: [{ timeMs: POINT_MS, value: 31 }],
              },
            ],
          },
        ],
      },
    ]);

    // The connection's identity: from the listing, no metric, no grain.
    const listed: CloudMonitoredResource = resolveCloudResourceOf({
      metricName: "azure_inventory",
      resourceAttributes: [
        ...unconnected(CloudProvider.Azure),
        stringAttribute("azuremonitor.subscription_id", SUBSCRIPTION),
      ],
      datapointAttributes: datapoint(""),
    }) as CloudMonitoredResource;

    expect(identifiers(harness.discovered)).toEqual(identifiers([listed]));
    expect(listed.resourceType).toBe("Microsoft.Compute/virtualMachines");
    expect(harness.rows).toHaveLength(1);
    expect(harness.rows[0]!["name"]).toBe("azure_percentage_cpu_average");
    expectStored(harness.rows[0]!, {
      "azuremonitor.resource_id": VM_ID,
      "resource.azuremonitor.subscription_id": SUBSCRIPTION,
      [`resource.${CLOUD_CONNECTION_ID_ATTRIBUTE}`]: CONNECTION_ID,
    });
  });
});

describe("Google Cloud: Cloud Monitoring read through a connection", () => {
  const LABELS: Array<OtlpAttribute> = [
    stringAttribute("instance_id", "4567890123456789012"),
    stringAttribute("project_id", "acme-prod"),
    stringAttribute("zone", "europe-west1-b"),
  ];

  test("an instance's metrics are filed under the resource the connection created", async () => {
    const harness: Harness = setup();
    const resourceAttributes: Array<OtlpAttribute> = [
      stringAttribute("gcp.resource_type", "gce_instance"),
      ...LABELS,
      stringAttribute("name", "web-1"),
    ];

    await ingest([
      {
        resourceAttributes: [
          ...connection(CloudProvider.GCP),
          ...resourceAttributes,
        ],
        metrics: [
          {
            name: "compute.googleapis.com/instance/cpu/utilization",
            unit: "1",
            datapointSets: [
              {
                attributes: [stringAttribute("instance_name", "web-1")],
                points: [{ timeMs: POINT_MS, value: 0.42 }],
              },
            ],
          },
        ],
      },
    ]);

    const created: CloudMonitoredResource = resolveCloudResourceOf({
      metricName: "compute.googleapis.com/instance/cpu/utilization",
      resourceAttributes: [
        ...unconnected(CloudProvider.GCP),
        ...resourceAttributes,
      ],
      datapointAttributes: [stringAttribute("instance_name", "web-1")],
    }) as CloudMonitoredResource;

    expect(identifiers(harness.discovered)).toEqual(identifiers([created]));
    expect(created.accountId).toBe("acme-prod");
    expect(harness.rows).toHaveLength(1);
    expectStored(harness.rows[0]!, {
      "resource.gcp.resource_type": "gce_instance",
      "resource.instance_id": "4567890123456789012",
      [`resource.${CLOUD_CONNECTION_ID_ATTRIBUTE}`]: CONNECTION_ID,
    });
  });
});
