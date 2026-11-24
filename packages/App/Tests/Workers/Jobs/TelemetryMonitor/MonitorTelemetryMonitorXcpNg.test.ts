import MonitorStep from "Common/Types/Monitor/MonitorStep";
import ObjectID from "Common/Types/ObjectID";
import Dictionary from "Common/Types/Dictionary";
import { JSONObject } from "Common/Types/JSON";
import { describe, expect, test, beforeEach, afterEach } from "@jest/globals";
import RollingTime from "Common/Types/RollingTime/RollingTime";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import BadDataException from "Common/Types/Exception/BadDataException";
import MonitorType from "Common/Types/Monitor/MonitorType";
import MetricMonitorResponse, {
  XcpNgAffectedResource,
  XcpNgResourceBreakdown,
} from "Common/Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MonitorStepXcpNgMonitor, {
  MonitorStepXcpNgMonitorUtil,
  XcpNgResourceFilters,
} from "Common/Types/Monitor/MonitorStepXcpNgMonitor";
import {
  XcpNgAlertTemplateArgs,
  getXcpNgAlertTemplateById,
} from "Common/Types/Monitor/XcpNgAlertTemplates";
import { XcpNgScope } from "Common/Types/XcpNg/XcpNgTelemetry";
import MonitorStepMetricQueries, {
  MetricMonitorStepSettings,
} from "Common/Utils/Monitor/MonitorStepMetricQueries";

/*
 * The XCP-ng monitor's evaluation (monitorXcpNg), driven with MetricService
 * and MetricTypeService stubbed: what every query is scoped to, how the
 * step's resource filters become datapoint filters, and the per-query
 * "Affected Resources" breakdown and unit map the criteria evaluator reads.
 *
 * The contract: every query is scoped to its pool by the pool's XAPI UUID
 * on the resource attribute the XCP-ng Agent stamps
 * (`resource.xcp_ng.pool.id`, never the pool's name), and the filters are
 * equalities on the DATAPOINT attributes ingest stamps - `xcp_ng.scope`,
 * `xcp_ng.id` - and Xen Orchestra's own `host_name` label.
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
  XCP_NG_POOL_RESOURCE_ATTRIBUTE,
  XcpNgResourceFilterAttributeKeys,
  applyXcpNgResourceFilters,
  monitorXcpNg,
} from "../../../../FeatureSet/Workers/Jobs/TelemetryMonitor/MonitorTelemetryMonitor";
import { FoldedReadArgs, foldRowsAsSqlRead } from "./SqlGroupedFold";

const metricAggregateBy: jest.Mock =
  MetricService.aggregateBy as unknown as jest.Mock;
const metricFindBy: jest.Mock = MetricService.findBy as unknown as jest.Mock;
const metricTypeFindBy: jest.Mock =
  MetricTypeService.findBy as unknown as jest.Mock;

const monitorId: ObjectID = ObjectID.generate();
const projectId: ObjectID = ObjectID.generate();

const POOL_UUID: string = "1e8b7c4a-3f2d-4b6e-9a1c-0d5e7f9b2a3c";
const HOST_UUID: string = "a1b2c3d4-0000-4000-8000-000000000001";
const HOST_2_UUID: string = "a1b2c3d4-0000-4000-8000-000000000002";
const VM_UUID: string = "b1b2c3d4-0000-4000-8000-000000000003";
const SR_UUID: string = "c1b2c3d4-0000-4000-8000-000000000004";

const sampleTime: Date = new Date("2026-11-24T10:00:30.000Z");

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

interface AggregateArgs extends FoldedReadArgs {
  query: { name: string };
}

/*
 * What the store holds: the breakdown's scan reads the raw rows (findBy),
 * and the monitor's reads the same rows folded by ClickHouse (aggregateBy).
 */
function mockRawRows(rowsByMetricName: Dictionary<Array<RawRow>>): void {
  metricFindBy.mockImplementation(async (args: unknown) => {
    return rowsByMetricName[(args as QueryArgs).query.name] || [];
  });
  metricAggregateBy.mockImplementation(async (args: unknown) => {
    return foldRowsAsSqlRead(
      rowsByMetricName[(args as AggregateArgs).query.name] || [],
      args as AggregateArgs,
    );
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

function xcpNgStep(config: Partial<MonitorStepXcpNgMonitor>): MonitorStep {
  const step: MonitorStep = new MonitorStep();
  step.setXcpNgMonitor({
    ...MonitorStepXcpNgMonitorUtil.getDefault(),
    poolIdentifier: POOL_UUID,
    rollingTime: RollingTime.Past5Minutes,
    ...config,
  });
  return step;
}

const templateArgs: XcpNgAlertTemplateArgs = {
  poolIdentifier: POOL_UUID,
  onlineMonitorStatusId: ObjectID.generate(),
  offlineMonitorStatusId: ObjectID.generate(),
  defaultIncidentSeverityId: ObjectID.generate(),
  defaultAlertSeverityId: ObjectID.generate(),
  monitorName: "Production",
};

function templateStep(templateId: string): MonitorStep {
  return getXcpNgAlertTemplateById(templateId)!.getMonitorStep(templateArgs);
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

describe("monitorXcpNg: scoping to the pool", () => {
  test("every query is read for the step's pool by its UUID, keeping the query's own filters", async () => {
    const step: MonitorStep = xcpNgStep({
      metricViewConfig: {
        queryConfigs: [
          queryConfig({
            alias: "host_cpu",
            metricName: "xcp_host_cpu_average",
            attributes: { "xcp_ng.scope": "host" },
          }),
          queryConfig({
            alias: "connected",
            metricName: "xcp_pool_connected",
          }),
        ],
        formulaConfigs: [],
      },
    });

    await monitorXcpNg({ monitorStep: step, monitorId, projectId });

    const cpu: Array<Dictionary<string>> = queriedAttributes(
      "xcp_host_cpu_average",
    );
    expect(cpu.length).toBeGreaterThan(0);
    for (const attributes of cpu) {
      expect(attributes).toEqual({
        "xcp_ng.scope": "host",
        "resource.xcp_ng.pool.id": POOL_UUID,
      });
    }

    const connected: Array<Dictionary<string>> =
      queriedAttributes("xcp_pool_connected");
    expect(connected.length).toBeGreaterThan(0);
    for (const attributes of connected) {
      expect(attributes).toEqual({ "resource.xcp_ng.pool.id": POOL_UUID });
    }
  });

  test("the pool is matched on its UUID, never its name: no pool-name filter is ever added", async () => {
    const step: MonitorStep = xcpNgStep({
      metricViewConfig: {
        queryConfigs: [
          queryConfig({ alias: "vm_cpu", metricName: "xcp_vm_cpu_usage" }),
        ],
        formulaConfigs: [],
      },
    });

    await monitorXcpNg({ monitorStep: step, monitorId, projectId });

    for (const attributes of queriedAttributes("xcp_vm_cpu_usage")) {
      expect(Object.keys(attributes)).not.toContain(
        "resource.xcp_ng.pool.name",
      );
      expect(attributes[XCP_NG_POOL_RESOURCE_ATTRIBUTE]).toBe(POOL_UUID);
    }
    expect(XCP_NG_POOL_RESOURCE_ATTRIBUTE).toBe("resource.xcp_ng.pool.id");
  });

  test("a UUID written in capitals or with spaces reads the pool as ingest stores it", async () => {
    const step: MonitorStep = xcpNgStep({
      poolIdentifier: `  ${POOL_UUID.toUpperCase()}  `,
      metricViewConfig: {
        queryConfigs: [
          queryConfig({ alias: "connected", metricName: "xcp_pool_connected" }),
        ],
        formulaConfigs: [],
      },
    });

    await monitorXcpNg({ monitorStep: step, monitorId, projectId });

    for (const attributes of queriedAttributes("xcp_pool_connected")) {
      expect(attributes).toEqual({ "resource.xcp_ng.pool.id": POOL_UUID });
    }
  });

  test("a step that names no pool is read with no pool filter", async () => {
    const step: MonitorStep = xcpNgStep({
      poolIdentifier: "",
      metricViewConfig: {
        queryConfigs: [
          queryConfig({ alias: "connected", metricName: "xcp_pool_connected" }),
        ],
        formulaConfigs: [],
      },
    });

    await monitorXcpNg({ monitorStep: step, monitorId, projectId });

    for (const attributes of queriedAttributes("xcp_pool_connected")) {
      expect(attributes).toEqual({});
    }
  });

  test("a step without an XCP-ng config is refused", async () => {
    const step: MonitorStep = new MonitorStep();

    await expect(
      monitorXcpNg({ monitorStep: step, monitorId, projectId }),
    ).rejects.toThrow(BadDataException);
    await expect(
      monitorXcpNg({ monitorStep: step, monitorId, projectId }),
    ).rejects.toThrow("XCP-ng monitor config is missing");
  });

  test("the worker reads each query exactly as the monitor's charts say it does", async () => {
    const step: MonitorStep = xcpNgStep({
      resourceFilters: { scope: XcpNgScope.VM, hostName: "xcp-host-01" },
      metricViewConfig: {
        queryConfigs: [
          queryConfig({
            alias: "vm_cpu",
            metricName: "xcp_vm_cpu_usage",
            attributes: { is_control_domain: "false" },
          }),
        ],
        formulaConfigs: [],
      },
    });

    const response: MetricMonitorResponse = await monitorXcpNg({
      monitorStep: step,
      monitorId,
      projectId,
    });

    const settings: MetricMonitorStepSettings =
      MonitorStepMetricQueries.getSettings({
        monitorType: MonitorType.XcpNg,
        monitorStep: step,
      })!;

    expect(response.queryAttributes).toEqual([
      MonitorStepMetricQueries.getReadAttributes({
        monitorType: MonitorType.XcpNg,
        settings: settings,
        queryConfig: step.data!.xcpNgMonitor!.metricViewConfig.queryConfigs[0]!,
      }),
    ]);
  });
});

describe("applyXcpNgResourceFilters", () => {
  function filtered(
    resourceFilters: XcpNgResourceFilters | undefined,
  ): Dictionary<string> {
    const attributes: Dictionary<string> = {};
    applyXcpNgResourceFilters({
      attributes: attributes,
      resourceFilters: resourceFilters,
    });
    return attributes;
  }

  test("has an attribute for every resource filter the step can carry", () => {
    expect(XcpNgResourceFilterAttributeKeys).toEqual({
      scope: "xcp_ng.scope",
      xcpNgId: "xcp_ng.id",
      hostName: "host_name",
    });
  });

  test.each([
    [{ scope: XcpNgScope.Host }, { "xcp_ng.scope": "host" }],
    [{ scope: XcpNgScope.VM }, { "xcp_ng.scope": "vm" }],
    [{ scope: XcpNgScope.StorageRepository }, { "xcp_ng.scope": "sr" }],
    [{ scope: XcpNgScope.VDI }, { "xcp_ng.scope": "vdi" }],
    [{ xcpNgId: VM_UUID }, { "xcp_ng.id": VM_UUID }],
    [{ hostName: "xcp-host-01" }, { host_name: "xcp-host-01" }],
    [
      { scope: XcpNgScope.VM, xcpNgId: VM_UUID, hostName: "xcp-host-01" },
      {
        "xcp_ng.scope": "vm",
        "xcp_ng.id": VM_UUID,
        host_name: "xcp-host-01",
      },
    ],
  ])(
    "%j filters %j",
    (resourceFilters: XcpNgResourceFilters, expected: Dictionary<string>) => {
      expect(filtered(resourceFilters)).toEqual(expected);
    },
  );

  test("a UUID and a scope match whatever their case; a host's name is kept as Xen Orchestra wrote it", () => {
    expect(
      filtered({
        scope: "VM" as XcpNgScope,
        xcpNgId: VM_UUID.toUpperCase(),
        hostName: "XCP-Host-01",
      }),
    ).toEqual({
      "xcp_ng.scope": "vm",
      "xcp_ng.id": VM_UUID,
      host_name: "XCP-Host-01",
    });
  });

  test("values are trimmed; blank, numeric and object filters are ignored", () => {
    expect(
      filtered({
        scope: "  host  " as XcpNgScope,
        xcpNgId: "   ",
        hostName: 42 as unknown as string,
      }),
    ).toEqual({ "xcp_ng.scope": "host" });
    expect(
      filtered({
        hostName: { name: "x" } as unknown as string,
      }),
    ).toEqual({});
  });

  test("no filters, or a malformed filter object, add nothing", () => {
    expect(filtered(undefined)).toEqual({});
    expect(filtered({})).toEqual({});
    expect(filtered("host" as unknown as XcpNgResourceFilters)).toEqual({});
  });

  test("a filter overrides a query's own filter on the same attribute", () => {
    const attributes: Dictionary<string> = { "xcp_ng.scope": "host" };

    applyXcpNgResourceFilters({
      attributes: attributes,
      resourceFilters: { scope: XcpNgScope.VM },
    });

    expect(attributes).toEqual({ "xcp_ng.scope": "vm" });
  });

  test("the step's resource filters reach the query next to the pool scope", async () => {
    const step: MonitorStep = xcpNgStep({
      resourceFilters: { scope: XcpNgScope.Host, xcpNgId: HOST_UUID },
      metricViewConfig: {
        queryConfigs: [
          queryConfig({
            alias: "host_running",
            metricName: "xcp_ng.host.running",
          }),
        ],
        formulaConfigs: [],
      },
    });

    await monitorXcpNg({ monitorStep: step, monitorId, projectId });

    const attributes: Array<Dictionary<string>> = queriedAttributes(
      "xcp_ng.host.running",
    );
    expect(attributes.length).toBeGreaterThan(0);
    for (const queried of attributes) {
      expect(queried).toEqual({
        "resource.xcp_ng.pool.id": POOL_UUID,
        "xcp_ng.scope": "host",
        "xcp_ng.id": HOST_UUID,
      });
    }
  });
});

describe("monitorXcpNg: one breakdown per query", () => {
  test("Host Offline groups by xcp_ng.id and names each host it scanned", async () => {
    mockRawRows({
      "xcp_ng.host.running": [
        row(0, {
          "resource.xcp_ng.pool.id": POOL_UUID,
          "xcp_ng.scope": "host",
          "xcp_ng.id": HOST_UUID,
          host_name: "xcp-host-01",
          power_state: "Halted",
        }),
        row(1, {
          "resource.xcp_ng.pool.id": POOL_UUID,
          "xcp_ng.scope": "host",
          "xcp_ng.id": HOST_2_UUID,
          host_name: "xcp-host-02",
          power_state: "Running",
        }),
      ],
    });

    const response: MetricMonitorResponse = await monitorXcpNg({
      monitorStep: templateStep("xcp-ng-host-offline"),
      monitorId,
      projectId,
    });

    const breakdowns: Array<XcpNgResourceBreakdown> =
      response.xcpNgResourceBreakdowns!;
    expect(breakdowns).toHaveLength(1);
    expect(breakdowns[0]!.metricAlias).toBe("host_running");
    expect(breakdowns[0]!.poolIdentifier).toBe(POOL_UUID);
    expect(breakdowns[0]!.metricName).toBe("xcp_ng.host.running");
    expect(breakdowns[0]!.metricFriendlyName).toBe("Host Running");
    expect(breakdowns[0]!.attributes).toEqual({
      "xcp_ng.scope": "host",
      "resource.xcp_ng.pool.id": POOL_UUID,
    });
    expect(breakdowns[0]!.affectedResources).toEqual(
      expect.arrayContaining([
        {
          scope: "host",
          objectId: HOST_UUID,
          hostName: "xcp-host-01",
          vmName: undefined,
          storageRepositoryName: undefined,
          vdiName: undefined,
          metricValue: 0,
          lowestMetricValue: 0,
        },
        {
          scope: "host",
          objectId: HOST_2_UUID,
          hostName: "xcp-host-02",
          vmName: undefined,
          storageRepositoryName: undefined,
          vdiName: undefined,
          metricValue: 1,
          lowestMetricValue: 1,
        },
      ] satisfies Array<XcpNgAffectedResource>),
    );

    // Grouped by the object: one series per host.
    expect(
      response.seriesBreakdown!.map((series: { labels: JSONObject }) => {
        return series.labels["xcp_ng.id"];
      }),
    ).toEqual(expect.arrayContaining([HOST_UUID, HOST_2_UUID]));
  });

  test("a storage repository's two queries each get their breakdown, units from the catalog", async () => {
    mockDeclaredUnits({
      xcp_sr_physical_usage_bytes: "",
      xcp_sr_physical_size_bytes: "",
    });
    mockRawRows({
      xcp_sr_physical_usage_bytes: [
        row(950, {
          "resource.xcp_ng.pool.id": POOL_UUID,
          "xcp_ng.scope": "sr",
          "xcp_ng.id": SR_UUID,
          sr_name: "Local storage",
        }),
      ],
      xcp_sr_physical_size_bytes: [
        row(1000, {
          "resource.xcp_ng.pool.id": POOL_UUID,
          "xcp_ng.scope": "sr",
          "xcp_ng.id": SR_UUID,
          sr_name: "Local storage",
        }),
      ],
    });

    const response: MetricMonitorResponse = await monitorXcpNg({
      monitorStep: templateStep("xcp-ng-sr-near-full"),
      monitorId,
      projectId,
    });

    const breakdowns: Array<XcpNgResourceBreakdown> =
      response.xcpNgResourceBreakdowns!;
    expect(
      breakdowns.map((breakdown: XcpNgResourceBreakdown) => {
        return [breakdown.metricAlias, breakdown.metricName];
      }),
    ).toEqual([
      ["sr_used", "xcp_sr_physical_usage_bytes"],
      ["sr_size", "xcp_sr_physical_size_bytes"],
    ]);
    for (const breakdown of breakdowns) {
      expect(breakdown.metricUnit).toBe("bytes");
      expect(breakdown.affectedResources[0]).toMatchObject({
        scope: "sr",
        objectId: SR_UUID,
        storageRepositoryName: "Local storage",
      });
    }
    // The catalog's unit wins over what the exporter declared.
    expect(response.nativeUnitsByMetricName).toEqual({
      xcp_sr_physical_usage_bytes: "bytes",
      xcp_sr_physical_size_bytes: "bytes",
    });
  });

  test("a VM's series names the VM and the host it runs on", async () => {
    mockRawRows({
      xcp_vm_cpu_usage: [
        row(0.92, {
          "resource.xcp_ng.pool.id": POOL_UUID,
          "xcp_ng.scope": "vm",
          "xcp_ng.id": VM_UUID,
          vm_name: "web-01",
          host_name: "xcp-host-01",
          is_control_domain: "false",
        }),
      ],
    });

    const response: MetricMonitorResponse = await monitorXcpNg({
      monitorStep: xcpNgStep({
        metricViewConfig: {
          queryConfigs: [
            queryConfig({ alias: "vm_cpu", metricName: "xcp_vm_cpu_usage" }),
          ],
          formulaConfigs: [],
        },
      }),
      monitorId,
      projectId,
    });

    expect(response.xcpNgResourceBreakdowns![0]!.affectedResources).toEqual([
      {
        scope: "vm",
        objectId: VM_UUID,
        hostName: "xcp-host-01",
        vmName: "web-01",
        storageRepositoryName: undefined,
        vdiName: undefined,
        metricValue: 0.92,
        lowestMetricValue: 0.92,
      },
    ]);
    // Xen Orchestra's CPU share is a 0-1 ratio: UCUM "1".
    expect(response.nativeUnitsByMetricName).toEqual({
      xcp_vm_cpu_usage: "1",
    });
  });

  test("no breakdown field at all when no scan returned rows", async () => {
    const response: MetricMonitorResponse = await monitorXcpNg({
      monitorStep: templateStep("xcp-ng-pool-disconnected"),
      monitorId,
      projectId,
    });

    expect(response.xcpNgResourceBreakdowns).toBeUndefined();
    expect(response.proxmoxResourceBreakdowns).toBeUndefined();
    expect(response.storageArrayResourceBreakdowns).toBeUndefined();
  });

  test("the response keeps the step's view config and window", async () => {
    const step: MonitorStep = templateStep("xcp-ng-host-offline");

    const response: MetricMonitorResponse = await monitorXcpNg({
      monitorStep: step,
      monitorId,
      projectId,
    });

    expect(response.projectId).toBe(projectId);
    expect(response.monitorId).toBe(monitorId);
    expect(response.metricViewConfig).toBe(
      step.data!.xcpNgMonitor!.metricViewConfig,
    );
    const window: number =
      response.startAndEndDate!.endValue.getTime() -
      response.startAndEndDate!.startValue.getTime();
    expect(window).toBe(5 * 60 * 1000);
  });
});
