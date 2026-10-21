import MonitorStep from "Common/Types/Monitor/MonitorStep";
import ObjectID from "Common/Types/ObjectID";
import Dictionary from "Common/Types/Dictionary";
import { JSONObject } from "Common/Types/JSON";
import { describe, expect, test, beforeEach, afterEach } from "@jest/globals";
import RollingTime from "Common/Types/RollingTime/RollingTime";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import BadDataException from "Common/Types/Exception/BadDataException";
import MetricMonitorResponse, {
  StorageArrayAffectedResource,
  StorageArrayResourceBreakdown,
} from "Common/Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MonitorStepStorageArrayMonitor, {
  MonitorStepStorageArrayMonitorUtil,
  StorageArrayResourceFilters,
  StorageArrayResourceScope,
} from "Common/Types/Monitor/MonitorStepStorageArrayMonitor";
import { getStorageArrayAlertTemplateById } from "Common/Types/Monitor/StorageArrayAlertTemplates";
import StorageSystem from "Common/Types/StorageArray/StorageSystem";

/*
 * The Storage Array monitor's evaluation (monitorStorageArray), driven with
 * MetricService / MetricTypeService stubbed: what every query is scoped to,
 * how the step's resource filters become datapoint-label filters, and the
 * per-query "Affected Resources" breakdown and unit map the criteria
 * evaluator reads.
 *
 * The contract mirrors the Ceph monitor: every query is scoped to
 * `resource.storage.array.name = arrayIdentifier` (the agent stamps it on
 * every batch), and object identity lives in Pure's DATAPOINT labels —
 * `name`, `host`, `component_name`, `local_pod`, `summary` — stored
 * unprefixed.
 */

// Keep the heavy worker module from touching Redis at import time.
jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: { addJob: jest.fn() },
    QueueName: { Telemetry: "Telemetry" },
  };
});

// The worker transitively loads the native `isolated-vm` addon; stub it.
jest.mock("Common/Server/Utils/VM/VMRunner", () => {
  return { __esModule: true, default: {} };
});

jest.mock("Common/Server/Services/MetricService", () => {
  return {
    __esModule: true,
    default: { aggregateBy: jest.fn(), findBy: jest.fn() },
  };
});
jest.mock("Common/Server/Services/MetricTypeService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

import MetricService from "Common/Server/Services/MetricService";
import MetricTypeService from "Common/Server/Services/MetricTypeService";
import {
  StorageArrayResourceFilterScopes,
  applyStorageArrayResourceFilters,
  monitorStorageArray,
} from "../../../../FeatureSet/Workers/Jobs/TelemetryMonitor/MonitorTelemetryMonitor";

const metricAggregateBy: jest.Mock =
  MetricService.aggregateBy as unknown as jest.Mock;
const metricFindBy: jest.Mock = MetricService.findBy as unknown as jest.Mock;
const metricTypeFindBy: jest.Mock =
  MetricTypeService.findBy as unknown as jest.Mock;

const monitorId: ObjectID = ObjectID.generate();
const projectId: ObjectID = ObjectID.generate();

const sampleTime: Date = new Date("2026-10-05T10:00:30.000Z");

interface RawRow {
  time: Date;
  value: number;
  attributes: JSONObject;
}

interface QueryArgs {
  query: { name: string; attributes?: Dictionary<string> };
  limit?: number;
}

function row(value: number, attributes: JSONObject): RawRow {
  return { time: sampleTime, value: value, attributes: attributes };
}

function mockRawRows(rowsByMetricName: Dictionary<Array<RawRow>>): void {
  metricFindBy.mockImplementation(async (args: unknown) => {
    return rowsByMetricName[(args as QueryArgs).query.name] || [];
  });
}

function mockDeclaredUnits(unitsByMetricName: Dictionary<string>): void {
  metricTypeFindBy.mockResolvedValue(
    Object.keys(unitsByMetricName).map((name: string) => {
      return { name: name, unit: unitsByMetricName[name] };
    }),
  );
}

function queryConfig(input: {
  alias: string;
  metricName: string;
  attributes?: Dictionary<string>;
  groupByAttributeKeys?: Array<string> | undefined;
}): MetricQueryConfigData {
  return {
    metricAliasData: {
      metricVariable: input.alias,
      title: input.alias,
      description: input.alias,
      legend: input.alias,
      legendUnit: undefined,
    },
    metricQueryData: {
      filterData: {
        metricName: input.metricName,
        attributes: input.attributes || {},
        aggegationType: MetricsAggregationType.Max,
        aggregateBy: {},
      },
      ...(input.groupByAttributeKeys
        ? { groupByAttributeKeys: input.groupByAttributeKeys }
        : {}),
    },
  };
}

function storageArrayStep(
  config: Partial<MonitorStepStorageArrayMonitor>,
): MonitorStep {
  const step: MonitorStep = new MonitorStep();
  step.setStorageArrayMonitor({
    ...MonitorStepStorageArrayMonitorUtil.getDefault(),
    arrayIdentifier: "pure-prod-01",
    rollingTime: RollingTime.Past5Minutes,
    ...config,
  });
  return step;
}

const templateArgs: {
  arrayIdentifier: string;
  onlineMonitorStatusId: ObjectID;
  offlineMonitorStatusId: ObjectID;
  defaultIncidentSeverityId: ObjectID;
  defaultAlertSeverityId: ObjectID;
  monitorName: string;
} = {
  arrayIdentifier: "pure-prod-01",
  onlineMonitorStatusId: ObjectID.generate(),
  offlineMonitorStatusId: ObjectID.generate(),
  defaultIncidentSeverityId: ObjectID.generate(),
  defaultAlertSeverityId: ObjectID.generate(),
  monitorName: "Prod",
};

function templateStep(templateId: string): MonitorStep {
  return getStorageArrayAlertTemplateById(templateId)!.getMonitorStep(
    templateArgs,
  );
}

// Every attribute filter MetricService was queried with, per metric name.
function queriedAttributes(metricName: string): Array<Dictionary<string>> {
  const calls: Array<QueryArgs> = [
    ...metricFindBy.mock.calls,
    ...metricAggregateBy.mock.calls,
  ].map((call: Array<unknown>) => {
    return call[0] as QueryArgs;
  });

  return calls
    .filter((args: QueryArgs) => {
      return args.query.name === metricName;
    })
    .map((args: QueryArgs) => {
      return args.query.attributes || {};
    });
}

beforeEach(() => {
  metricAggregateBy.mockReset().mockResolvedValue({ data: [] });
  metricFindBy.mockReset().mockResolvedValue([]);
  metricTypeFindBy.mockReset().mockResolvedValue([]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("monitorStorageArray: scoping", () => {
  test("every query is scoped to the array's storage.array.name, keeping the query's own filters", async () => {
    const step: MonitorStep = storageArrayStep({
      metricViewConfig: {
        queryConfigs: [
          queryConfig({
            alias: "read_latency",
            metricName: "purefa_array_performance_latency_usec",
            attributes: { dimension: "usec_per_read_op" },
          }),
          queryConfig({
            alias: "used",
            metricName: "purefa_array_space_utilization",
          }),
        ],
        formulaConfigs: [],
      },
    });

    await monitorStorageArray({ monitorStep: step, monitorId, projectId });

    for (const attributes of queriedAttributes(
      "purefa_array_performance_latency_usec",
    )) {
      expect(attributes).toEqual({
        dimension: "usec_per_read_op",
        "resource.storage.array.name": "pure-prod-01",
      });
    }
    for (const attributes of queriedAttributes(
      "purefa_array_space_utilization",
    )) {
      expect(attributes).toEqual({
        "resource.storage.array.name": "pure-prod-01",
      });
    }
    expect(
      queriedAttributes("purefa_array_performance_latency_usec").length,
    ).toBeGreaterThan(0);
  });

  test("a step without a storage array config is refused", async () => {
    const step: MonitorStep = new MonitorStep();

    await expect(
      monitorStorageArray({ monitorStep: step, monitorId, projectId }),
    ).rejects.toThrow(BadDataException);
  });
});

describe("applyStorageArrayResourceFilters", () => {
  function filtered(input: {
    resourceFilters: StorageArrayResourceFilters | undefined;
    storageSystem?: string | undefined;
    metricName: string;
  }): Dictionary<string> {
    const attributes: Dictionary<string> = {};
    applyStorageArrayResourceFilters({
      attributes: attributes,
      resourceFilters: input.resourceFilters,
      storageSystem: input.storageSystem,
      metricName: input.metricName,
    });
    return attributes;
  }

  test("has a scope for every resource filter the step can carry", () => {
    expect(Object.keys(StorageArrayResourceFilterScopes).sort()).toEqual(
      [
        "bucketName",
        "componentName",
        "fileSystemName",
        "hostName",
        "podName",
        "volumeName",
      ].sort(),
    );
    expect(StorageArrayResourceFilterScopes.volumeName).toBe(
      StorageArrayResourceScope.Volume,
    );
    expect(StorageArrayResourceFilterScopes.componentName).toBe(
      StorageArrayResourceScope.Hardware,
    );
  });

  test.each([
    [
      { volumeName: "vol-db-01" },
      "purefa_volume_performance_latency_usec",
      { name: "vol-db-01" },
    ],
    [
      { hostName: "esx-01" },
      "purefa_host_performance_latency_usec",
      { host: "esx-01" },
    ],
    [{ podName: "pod-a" }, "purefa_pod_space_bytes", { name: "pod-a" }],
    [
      { fileSystemName: "fs-home" },
      "purefb_file_systems_space_bytes",
      { name: "fs-home" },
    ],
    [
      { bucketName: "bkt-logs" },
      "purefb_buckets_space_bytes",
      { name: "bkt-logs" },
    ],
  ])(
    "%j on %s filters %j",
    (
      resourceFilters: StorageArrayResourceFilters,
      metricName: string,
      expected: Dictionary<string>,
    ) => {
      expect(
        filtered({
          resourceFilters: resourceFilters,
          storageSystem: StorageSystem.PureStorageFlashArray,
          metricName: metricName,
        }),
      ).toEqual(expected);
    },
  );

  test("a component filter is component_name on a FlashArray and name on a FlashBlade", () => {
    expect(
      filtered({
        resourceFilters: { componentName: "CT0.FAN0" },
        storageSystem: StorageSystem.PureStorageFlashArray,
        metricName: "purefa_hw_component_status",
      }),
    ).toEqual({ component_name: "CT0.FAN0" });

    expect(
      filtered({
        resourceFilters: { componentName: "CH1.FB2" },
        storageSystem: StorageSystem.PureStorageFlashBlade,
        metricName: "purefb_hardware_health",
      }),
    ).toEqual({ name: "CH1.FB2" });
  });

  test("a pod filter on a replica-link series filters its local_pod label", () => {
    /*
     * purefa_pod_replica_links_* carry the pod as `local_pod`; a `name`
     * filter would match none of them and the monitor would never fire.
     */
    expect(
      filtered({
        resourceFilters: { podName: "pod-a" },
        storageSystem: StorageSystem.PureStorageFlashArray,
        metricName: "purefa_pod_replica_links_lag_max_msec",
      }),
    ).toEqual({ local_pod: "pod-a" });
  });

  test("values are trimmed; blank, numeric and object filters are ignored", () => {
    expect(
      filtered({
        resourceFilters: {
          volumeName: "  vol-db-01  ",
          hostName: "   ",
          podName: 42 as unknown as string,
          bucketName: { name: "x" } as unknown as string,
        },
        metricName: "purefa_volume_space_bytes",
      }),
    ).toEqual({ name: "vol-db-01" });
  });

  test("no filters, or a malformed filter object, add nothing", () => {
    expect(
      filtered({ resourceFilters: undefined, metricName: "purefa_info" }),
    ).toEqual({});
    expect(
      filtered({
        resourceFilters: "vol-db-01" as unknown as StorageArrayResourceFilters,
        metricName: "purefa_info",
      }),
    ).toEqual({});
  });

  test("the step's resource filters reach the query next to the array scope", async () => {
    const step: MonitorStep = storageArrayStep({
      storageSystem: StorageSystem.PureStorageFlashArray,
      resourceFilters: { volumeName: "vol-db-01" },
      metricViewConfig: {
        queryConfigs: [
          queryConfig({
            alias: "vol_read_latency",
            metricName: "purefa_volume_performance_latency_usec",
            attributes: { dimension: "usec_per_read_op" },
          }),
        ],
        formulaConfigs: [],
      },
    });

    await monitorStorageArray({ monitorStep: step, monitorId, projectId });

    const attributes: Array<Dictionary<string>> = queriedAttributes(
      "purefa_volume_performance_latency_usec",
    );
    expect(attributes.length).toBeGreaterThan(0);
    for (const queried of attributes) {
      expect(queried).toEqual({
        dimension: "usec_per_read_op",
        "resource.storage.array.name": "pure-prod-01",
        name: "vol-db-01",
      });
    }
  });
});

describe("monitorStorageArray: one breakdown per query", () => {
  test("a hardware template groups by component_name and names each component", async () => {
    mockRawRows({
      purefa_hw_component_status: [
        row(1, {
          "resource.storage.array.name": "pure-prod-01",
          component_name: "CT0.FAN0",
          component_type: "cooling",
          component_status: "critical",
        }),
        row(1, {
          "resource.storage.array.name": "pure-prod-01",
          component_name: "CH0.PWR1",
          component_type: "power_supply",
          component_status: "critical",
        }),
      ],
    });

    const response: MetricMonitorResponse = await monitorStorageArray({
      monitorStep: templateStep("purefa-hardware-critical"),
      monitorId,
      projectId,
    });

    const breakdowns: Array<StorageArrayResourceBreakdown> =
      response.storageArrayResourceBreakdowns!;
    expect(breakdowns).toHaveLength(1);
    expect(breakdowns[0]!.metricAlias).toBe("critical_components");
    expect(breakdowns[0]!.arrayName).toBe("pure-prod-01");
    expect(breakdowns[0]!.metricName).toBe("purefa_hw_component_status");
    expect(breakdowns[0]!.attributes).toEqual({
      component_status: "critical",
      "resource.storage.array.name": "pure-prod-01",
    });
    expect(breakdowns[0]!.affectedResources).toEqual([
      {
        objectName: undefined,
        hostName: undefined,
        componentName: "CT0.FAN0",
        componentType: "cooling",
        podName: undefined,
        alertSummary: undefined,
        metricValue: 1,
        lowestMetricValue: 1,
      },
      {
        objectName: undefined,
        hostName: undefined,
        componentName: "CH0.PWR1",
        componentType: "power_supply",
        podName: undefined,
        alertSummary: undefined,
        metricValue: 1,
        lowestMetricValue: 1,
      },
    ] satisfies Array<StorageArrayAffectedResource>);

    // Grouped by the component: one series per component.
    expect(
      response.seriesBreakdown!.map((series: { labels: JSONObject }) => {
        return series.labels["component_name"];
      }),
    ).toEqual(expect.arrayContaining(["CT0.FAN0", "CH0.PWR1"]));
  });

  test("read and write latency on one metric name get their own friendly names", async () => {
    mockRawRows({
      purefa_array_performance_latency_usec: [
        row(6200, {
          "resource.storage.array.name": "pure-prod-01",
          dimension: "usec_per_read_op",
        }),
      ],
    });

    const read: MetricMonitorResponse = await monitorStorageArray({
      monitorStep: templateStep("purefa-read-latency-high"),
      monitorId,
      projectId,
    });
    const write: MetricMonitorResponse = await monitorStorageArray({
      monitorStep: templateStep("purefa-write-latency-high"),
      monitorId,
      projectId,
    });

    expect(read.storageArrayResourceBreakdowns![0]!.metricFriendlyName).toBe(
      "Read Latency",
    );
    expect(write.storageArrayResourceBreakdowns![0]!.metricFriendlyName).toBe(
      "Write Latency",
    );
    // An array-wide series names no object.
    expect(read.storageArrayResourceBreakdowns![0]!.affectedResources).toEqual([
      {
        objectName: undefined,
        hostName: undefined,
        componentName: undefined,
        componentType: undefined,
        podName: undefined,
        alertSummary: undefined,
        metricValue: 6200,
        lowestMetricValue: 6200,
      },
    ]);
    // µs from the catalog, whatever the exporter declared.
    expect(read.nativeUnitsByMetricName).toEqual({
      purefa_array_performance_latency_usec: "µs",
    });
  });

  test("the unit follows the query's filters: a FlashBlade available ratio is a ratio, not bytes", async () => {
    mockDeclaredUnits({ purefb_file_systems_space_bytes: "" });
    mockRawRows({
      purefb_file_systems_space_bytes: [
        row(0.05, {
          "resource.storage.array.name": "pure-prod-01",
          name: "fs-home",
          space: "available_ratio",
        }),
      ],
    });

    const response: MetricMonitorResponse = await monitorStorageArray({
      monitorStep: templateStep("purefb-file-system-near-full"),
      monitorId,
      projectId,
    });

    // The catalog's "ratio" becomes UCUM "1"; the name alone would say bytes.
    expect(response.nativeUnitsByMetricName).toEqual({
      purefb_file_systems_space_bytes: "1",
    });
    expect(response.storageArrayResourceBreakdowns![0]!.metricUnit).toBe("1");
    expect(
      response.storageArrayResourceBreakdowns![0]!.metricFriendlyName,
    ).toBe("File System Space Available (Ratio)");
    expect(
      response.storageArrayResourceBreakdowns![0]!.affectedResources[0]!
        .objectName,
    ).toBe("fs-home");
  });

  test("an alert template groups by the alert summary", async () => {
    mockRawRows({
      purefa_alerts_open: [
        row(1, {
          "resource.storage.array.name": "pure-prod-01",
          severity: "critical",
          code: "42",
          component_name: "CT0",
          summary: "Controller failed",
        }),
      ],
    });

    const response: MetricMonitorResponse = await monitorStorageArray({
      monitorStep: templateStep("purefa-critical-alerts"),
      monitorId,
      projectId,
    });

    expect(
      response.storageArrayResourceBreakdowns![0]!.affectedResources[0],
    ).toMatchObject({
      alertSummary: "Controller failed",
      componentName: "CT0",
      metricValue: 1,
    });
    expect(
      response.storageArrayResourceBreakdowns![0]!.metricFriendlyName,
    ).toBe("Open Alerts");
  });

  test("no breakdown field at all when no scan returned rows", async () => {
    const response: MetricMonitorResponse = await monitorStorageArray({
      monitorStep: templateStep("purefa-capacity-high"),
      monitorId,
      projectId,
    });

    expect(response.storageArrayResourceBreakdowns).toBeUndefined();
    expect(response.cephResourceBreakdowns).toBeUndefined();
  });

  test("a failing raw scan decorates nothing and the evaluation still returns", async () => {
    metricFindBy.mockRejectedValue(new Error("ClickHouse timeout"));

    const response: MetricMonitorResponse = await monitorStorageArray({
      monitorStep: templateStep("purefa-capacity-high"),
      monitorId,
      projectId,
    });

    expect(response.storageArrayResourceBreakdowns).toBeUndefined();
    expect(response.metricResult).toHaveLength(1);
  });
});
