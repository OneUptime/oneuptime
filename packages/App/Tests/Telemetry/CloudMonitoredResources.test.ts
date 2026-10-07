jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

import CloudMonitoredResourceCollector, {
  CLOUD_MONITORED_RESOURCE_MAX_MEMO_KEY_LENGTH,
  CLOUD_MONITORED_RESOURCE_MAX_RESOURCES_PER_REQUEST,
  buildCloudMonitoredResourceMemoKey,
} from "../../FeatureSet/Telemetry/Services/CloudMonitoredResources";
import * as CloudMonitoredResourceModule from "Common/Types/Cloud/CloudMonitoredResource";
import {
  CloudMonitoredResource,
  CloudMonitoringSource,
} from "Common/Types/Cloud/CloudMonitoredResource";
import { CloudProvider } from "Common/Types/Cloud/CloudPlatform";
import logger from "Common/Server/Utils/Logger";
import { JSONObject } from "Common/Types/JSON";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The per-request half of cloud resource discovery
 * (CloudMonitoredResourceCollector): every FINAL metric row of an ingest
 * request goes through observeMetricRow, and the request ends with the
 * distinct cloud resources the rows named. Pinned here:
 *
 *   - rows that are not cloud monitoring are turned away without the
 *     resolver running at all;
 *   - each distinct resource is listed once, however many of its datapoints
 *     the request carries, and the resolver runs once per distinct set of
 *     resolver inputs (the memo);
 *   - the memo key holds exactly the inputs that can change the answer: two
 *     resources whose datapoints differ only in one of them are never
 *     confused, and an input the resolver does not read never splits one;
 *   - it never throws, and a resolver failure is logged once per request;
 *   - it is bounded.
 */

const SUBSCRIPTION: string = "7c4a1f2e-9d3b-4e5f-8a6b-1c2d3e4f5a6b";

function azureRow(
  name: string,
  resourceName: string,
  extra: Record<string, unknown> = {},
): JSONObject {
  return {
    name: name,
    attributes: {
      "resource.azuremonitor.subscription_id": SUBSCRIPTION,
      "azuremonitor.resource_id": `/subscriptions/${SUBSCRIPTION}/resourceGroups/rg-prod/providers/Microsoft.Compute/virtualMachines/${resourceName}`,
      name: resourceName,
      type: "Microsoft.Compute/virtualMachines",
      resource_group: "rg-prod",
      location: "westeurope",
      ...extra,
    },
  } as unknown as JSONObject;
}

function cloudWatchRow(
  namespace: string,
  dimensions: Record<string, string>,
  resource: Record<string, string> = {
    "resource.cloud.account.id": "123456789012",
    "resource.cloud.region": "us-east-1",
  },
): JSONObject {
  const attributes: Record<string, unknown> = {
    ...resource,
    Namespace: namespace,
    MetricName: "Metric",
  };
  for (const [key, value] of Object.entries(dimensions)) {
    attributes[`Dimensions.${key}`] = value;
  }
  return {
    name: `amazonaws.com/${namespace}/metric`.toLowerCase(),
    attributes: attributes,
  } as unknown as JSONObject;
}

function names(resources: Array<CloudMonitoredResource>): Array<string> {
  return resources.map((resource: CloudMonitoredResource): string => {
    return resource.name;
  });
}

let resolveSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  resolveSpy = jest.spyOn(
    CloudMonitoredResourceModule,
    "resolveCloudMonitoredResource",
  );
});

afterEach(() => {
  resolveSpy.mockRestore();
});

describe("observeMetricRow", () => {
  test("a row from each receiver names its resource", () => {
    const collector: CloudMonitoredResourceCollector =
      new CloudMonitoredResourceCollector();

    expect(
      collector.observeMetricRow(
        azureRow("azure_percentage_cpu_average", "vm-1"),
      ),
    ).toBe(true);
    expect(
      collector.observeMetricRow(
        cloudWatchRow("AWS/EC2", { InstanceId: "i-0abc" }),
      ),
    ).toBe(true);
    expect(
      collector.observeMetricRow({
        name: "cpuutilization",
        attributes: {
          "resource.cloud.account.id": "123456789012",
          "resource.cloud.region": "us-east-1",
          "resource.service.namespace": "AWS",
          "resource.service.name": "RDS",
          "resource.aws.cloudwatch.metric_stream_name": "oneuptime",
          DBInstanceIdentifier: "orders-db",
        },
      } as unknown as JSONObject),
    ).toBe(true);
    expect(
      collector.observeMetricRow({
        name: "compute.googleapis.com/instance/cpu/utilization",
        attributes: {
          "resource.gcp.resource_type": "gce_instance",
          "resource.project_id": "acme",
          "resource.zone": "us-central1-a",
          "resource.instance_id": "123",
        },
      } as unknown as JSONObject),
    ).toBe(true);

    const resources: Array<CloudMonitoredResource> = collector.getResources();
    expect(
      resources.map((resource: CloudMonitoredResource): string => {
        return `${resource.provider}:${resource.source}:${resource.resourceType}`;
      }),
    ).toEqual([
      `${CloudProvider.Azure}:${CloudMonitoringSource.AzureMonitor}:Microsoft.Compute/virtualMachines`,
      `${CloudProvider.AWS}:${CloudMonitoringSource.AwsCloudWatch}:AWS::EC2::Instance`,
      `${CloudProvider.AWS}:${CloudMonitoringSource.AwsCloudWatchJson}:AWS::RDS::DBInstance`,
      `${CloudProvider.GCP}:${CloudMonitoringSource.GoogleCloudMonitoring}:gce_instance`,
    ]);
  });

  test("a row that is not cloud monitoring costs no resolver work", () => {
    const collector: CloudMonitoredResourceCollector =
      new CloudMonitoredResourceCollector();

    for (const row of [
      {
        name: "http.server.request.duration",
        attributes: { "resource.service.name": "checkout" },
      },
      {
        name: "system.cpu.utilization",
        attributes: {
          "resource.host.name": "web-01",
          "resource.cloud.provider": "aws",
        },
      },
      // CloudWatch's attribute names on a metric that is not CloudWatch's.
      {
        name: "app.jobs",
        attributes: { Namespace: "AWS/EC2", "Dimensions.InstanceId": "i-1" },
      },
    ]) {
      expect(collector.observeMetricRow(row as unknown as JSONObject)).toBe(
        false,
      );
    }

    expect(resolveSpy).not.toHaveBeenCalled();
    expect(collector.getResources()).toEqual([]);
  });

  test("a cloud-monitoring row that names no resource is observed as none", () => {
    const collector: CloudMonitoredResourceCollector =
      new CloudMonitoredResourceCollector();

    expect(
      collector.observeMetricRow(
        cloudWatchRow("AWS/EC2", { InstanceType: "m5.large" }),
      ),
    ).toBe(false);
    expect(collector.getResources()).toEqual([]);
  });

  test("each resource is listed once, in first-seen order, however many of its datapoints arrive", () => {
    const collector: CloudMonitoredResourceCollector =
      new CloudMonitoredResourceCollector();

    collector.observeMetricRow(
      azureRow("azure_percentage_cpu_average", "vm-2"),
    );
    collector.observeMetricRow(
      azureRow("azure_percentage_cpu_average", "vm-1"),
    );
    collector.observeMetricRow(azureRow("azure_network_in_total", "vm-2"));
    collector.observeMetricRow(azureRow("azure_disk_read_bytes_total", "vm-1"));
    // The same VM's id in another case is the same VM.
    collector.observeMetricRow({
      name: "azure_x",
      attributes: {
        "azuremonitor.resource_id": `/subscriptions/${SUBSCRIPTION}/resourcegroups/RG-PROD/providers/Microsoft.Compute/virtualMachines/VM-2`,
      },
    } as unknown as JSONObject);

    expect(names(collector.getResources())).toEqual(["vm-2", "vm-1"]);
  });

  test("the resolver runs once per distinct set of its inputs", () => {
    const collector: CloudMonitoredResourceCollector =
      new CloudMonitoredResourceCollector();

    for (let index: number = 0; index < 50; index++) {
      collector.observeMetricRow(
        azureRow(`azure_metric_${index}_average`, "vm-1", {
          timegrain: "PT1M",
          metadata_lun: String(index),
        }),
      );
    }

    expect(resolveSpy).toHaveBeenCalledTimes(1);
    expect(names(collector.getResources())).toEqual(["vm-1"]);
  });

  test("datapoints that differ in a resolver input are resolved apart", () => {
    const collector: CloudMonitoredResourceCollector =
      new CloudMonitoredResourceCollector();

    // One queue name in two regions: the identity includes the region.
    collector.observeMetricRow(
      cloudWatchRow(
        "AWS/SQS",
        { QueueName: "orders" },
        {
          "resource.cloud.account.id": "123456789012",
          "resource.cloud.region": "us-east-1",
        },
      ),
    );
    collector.observeMetricRow(
      cloudWatchRow(
        "AWS/SQS",
        { QueueName: "orders" },
        {
          "resource.cloud.account.id": "123456789012",
          "resource.cloud.region": "eu-west-1",
        },
      ),
    );

    expect(resolveSpy).toHaveBeenCalledTimes(2);
    expect(
      collector.getResources().map((resource: CloudMonitoredResource) => {
        return resource.region;
      }),
    ).toEqual(["us-east-1", "eu-west-1"]);
  });

  test("never throws, and logs a resolver failure once per request", () => {
    resolveSpy.mockImplementation(() => {
      throw new Error("resolver bug");
    });
    const collector: CloudMonitoredResourceCollector =
      new CloudMonitoredResourceCollector();

    expect(collector.observeMetricRow(azureRow("azure_x", "vm-1"))).toBe(false);
    expect(collector.observeMetricRow(azureRow("azure_x", "vm-2"))).toBe(false);
    for (const row of [null, undefined, 42, "row", [], { attributes: null }]) {
      expect(collector.observeMetricRow(row as unknown as JSONObject)).toBe(
        false,
      );
    }

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect((logger.error as jest.Mock).mock.calls[0]![0]).toContain(
      "resolver bug",
    );
    expect(collector.getResources()).toEqual([]);
  });

  test("is bounded: past the per-request cap, further resources wait for a later request", () => {
    const collector: CloudMonitoredResourceCollector =
      new CloudMonitoredResourceCollector();

    for (
      let index: number = 0;
      index < CLOUD_MONITORED_RESOURCE_MAX_RESOURCES_PER_REQUEST + 10;
      index++
    ) {
      collector.observeMetricRow(azureRow("azure_x", `vm-${index}`));
    }

    expect(collector.getResources()).toHaveLength(
      CLOUD_MONITORED_RESOURCE_MAX_RESOURCES_PER_REQUEST,
    );
  });
});

describe("buildCloudMonitoredResourceMemoKey", () => {
  const base: Record<string, unknown> = azureRow("azure_x", "vm-1")[
    "attributes"
  ] as Record<string, unknown>;

  test("Azure: reads exactly what the resolver reads", () => {
    const key: string | null = buildCloudMonitoredResourceMemoKey(
      CloudMonitoringSource.AzureMonitor,
      base,
    );
    // A dimension or the time grain does not change the resource...
    expect(
      buildCloudMonitoredResourceMemoKey(CloudMonitoringSource.AzureMonitor, {
        ...base,
        metadata_lun: "0",
        timegrain: "PT5M",
      }),
    ).toBe(key);
    // ...the resource id, name and location do.
    for (const changed of [
      { "azuremonitor.resource_id": `${base["azuremonitor.resource_id"]}x` },
      { name: "vm-2" },
      { location: "northeurope" },
      { resource_group: "rg-other" },
    ]) {
      expect(
        buildCloudMonitoredResourceMemoKey(CloudMonitoringSource.AzureMonitor, {
          ...base,
          ...changed,
        }),
      ).not.toBe(key);
    }
  });

  test("CloudWatch: a dimension is an input, MetricName is not", () => {
    const row: Record<string, unknown> = cloudWatchRow("AWS/EC2", {
      InstanceId: "i-1",
    })["attributes"] as Record<string, unknown>;
    const key: string | null = buildCloudMonitoredResourceMemoKey(
      CloudMonitoringSource.AwsCloudWatch,
      row,
    );
    expect(
      buildCloudMonitoredResourceMemoKey(CloudMonitoringSource.AwsCloudWatch, {
        ...row,
        MetricName: "NetworkIn",
      }),
    ).toBe(key);
    expect(
      buildCloudMonitoringMemoKeyWith(row, { "Dimensions.InstanceId": "i-2" }),
    ).not.toBe(key);
  });

  test('a value\'s type is part of the key, so 1 and "1" never share an answer', () => {
    expect(
      buildCloudMonitoredResourceMemoKey(
        CloudMonitoringSource.AwsCloudWatchJson,
        {
          "resource.service.name": "EC2",
          InstanceId: 1,
        },
      ),
    ).not.toBe(
      buildCloudMonitoredResourceMemoKey(
        CloudMonitoringSource.AwsCloudWatchJson,
        {
          "resource.service.name": "EC2",
          InstanceId: "1",
        },
      ),
    );
  });

  test("an outsized input is not memoized", () => {
    expect(
      buildCloudMonitoredResourceMemoKey(CloudMonitoringSource.AzureMonitor, {
        ...base,
        name: "v".repeat(CLOUD_MONITORED_RESOURCE_MAX_MEMO_KEY_LENGTH),
      }),
    ).toBeNull();
  });

  function buildCloudMonitoringMemoKeyWith(
    row: Record<string, unknown>,
    changed: Record<string, unknown>,
  ): string | null {
    return buildCloudMonitoredResourceMemoKey(
      CloudMonitoringSource.AwsCloudWatch,
      { ...row, ...changed },
    );
  }
});
