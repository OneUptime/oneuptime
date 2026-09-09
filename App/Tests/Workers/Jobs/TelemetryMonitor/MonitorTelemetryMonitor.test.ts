import MonitorStep from "Common/Types/Monitor/MonitorStep";
import { MonitorStepLogMonitorUtil } from "Common/Types/Monitor/MonitorStepLogMonitor";
import ObjectID from "Common/Types/ObjectID";
import PositiveNumber from "Common/Types/PositiveNumber";
import Search from "Common/Types/BaseDatabase/Search";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Includes from "Common/Types/BaseDatabase/Includes";
import LogMonitorResponse from "Common/Types/Monitor/LogMonitor/LogMonitorResponse";
import TraceMonitorResponse from "Common/Types/Monitor/TraceMonitor/TraceMonitorResponse";
import ExceptionMonitorResponse from "Common/Types/Monitor/ExceptionMonitor/ExceptionMonitorResponse";
import { describe, expect, test, beforeEach } from "@jest/globals";
import {
  RumAlertTemplate,
  getRumAlertTemplateById,
} from "Common/Types/Monitor/RumAlertTemplates";
import RollingTime from "Common/Types/RollingTime/RollingTime";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import MetricMonitorResponse, {
  VMwareAffectedResource,
  VMwareResourceBreakdown,
} from "Common/Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MetricSeriesResult from "Common/Types/Monitor/MetricMonitor/MetricSeriesResult";
import {
  MonitorStepVMwareMonitorUtil,
  VMwareResourceFilters,
} from "Common/Types/Monitor/MonitorStepVMwareMonitor";
import {
  getVMwareAlertTemplateById,
  VMwareAlertTemplate,
} from "Common/Types/Monitor/VMwareAlertTemplates";

/*
 * Covers the worker-side half of the "log monitors do not work" fix. A
 * telemetry monitor step saved with no sub-config used to make these workers
 * throw "<type> query/config is missing" on every cycle, so the monitor never
 * evaluated. monitorLogs/monitorTrace/monitorException now fall back to the
 * default config instead; monitorMetric deliberately keeps its guard.
 */

// Keep the heavy worker module from touching Redis at import time.
jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: { addJob: jest.fn() },
    QueueName: { Telemetry: "Telemetry" },
  };
});

/*
 * The worker transitively imports MonitorResource -> MonitorCriteriaEvaluator
 * -> VMAPI -> VMRunner, which loads the native `isolated-vm` addon. None of
 * the functions under test evaluate JavaScript expressions, so stub the VM
 * runner out to keep the module importable in a plain jest environment.
 */
jest.mock("Common/Server/Utils/VM/VMRunner", () => {
  return { __esModule: true, default: {} };
});

jest.mock("Common/Server/Services/LogService", () => {
  return { __esModule: true, default: { countBy: jest.fn() } };
});
jest.mock("Common/Server/Services/SpanService", () => {
  return { __esModule: true, default: { countBy: jest.fn() } };
});
jest.mock("Common/Server/Services/ExceptionInstanceService", () => {
  return { __esModule: true, default: { countBy: jest.fn() } };
});
jest.mock("Common/Server/Services/TelemetryExceptionService", () => {
  return {
    __esModule: true,
    default: { getResolvedOrArchivedFingerprints: jest.fn() },
  };
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

import LogService from "Common/Server/Services/LogService";
import SpanService from "Common/Server/Services/SpanService";
import ExceptionInstanceService from "Common/Server/Services/ExceptionInstanceService";
import TelemetryExceptionService from "Common/Server/Services/TelemetryExceptionService";
import MetricService from "Common/Server/Services/MetricService";
import MetricTypeService from "Common/Server/Services/MetricTypeService";
import {
  monitorLogs,
  monitorTrace,
  monitorException,
  monitorMetric,
  monitorVMware,
} from "../../../../FeatureSet/Workers/Jobs/TelemetryMonitor/MonitorTelemetryMonitor";

const logCountBy: jest.Mock = LogService.countBy as unknown as jest.Mock;
const spanCountBy: jest.Mock = SpanService.countBy as unknown as jest.Mock;
const exceptionCountBy: jest.Mock =
  ExceptionInstanceService.countBy as unknown as jest.Mock;
const resolvedFingerprints: jest.Mock =
  TelemetryExceptionService.getResolvedOrArchivedFingerprints as unknown as jest.Mock;
const metricAggregateBy: jest.Mock =
  MetricService.aggregateBy as unknown as jest.Mock;
const metricFindBy: jest.Mock = MetricService.findBy as unknown as jest.Mock;
const metricTypeFindBy: jest.Mock =
  MetricTypeService.findBy as unknown as jest.Mock;

const monitorId: ObjectID = ObjectID.generate();
const projectId: ObjectID = ObjectID.generate();

beforeEach(() => {
  logCountBy.mockReset().mockResolvedValue(new PositiveNumber(0));
  spanCountBy.mockReset().mockResolvedValue(new PositiveNumber(0));
  exceptionCountBy.mockReset().mockResolvedValue(new PositiveNumber(0));
  resolvedFingerprints.mockReset().mockResolvedValue([]);
  metricAggregateBy.mockReset().mockResolvedValue({ data: [] });
  metricFindBy.mockReset().mockResolvedValue([]);
  metricTypeFindBy.mockReset().mockResolvedValue([]);
});

describe("monitorLogs", () => {
  test("falls back to the default query when logMonitor config is missing", async () => {
    logCountBy.mockResolvedValue(new PositiveNumber(4));

    // new MonitorStep() has every telemetry sub-config undefined.
    const response: LogMonitorResponse = await monitorLogs({
      monitorStep: new MonitorStep(),
      monitorId,
      projectId,
    });

    expect(response.logCount).toBe(4);
    expect(logCountBy).toHaveBeenCalledTimes(1);

    /*
     * The default query is the minimal "recent logs" query: a time window,
     * scoped to the project, with no over-scoping filters.
     */
    const passedQuery: Record<string, unknown> = logCountBy.mock.calls[0]![0]
      .query as Record<string, unknown>;
    expect(passedQuery["time"]).toBeInstanceOf(InBetween);
    expect(passedQuery["projectId"]).toBeDefined();
    expect(passedQuery["primaryEntityId"]).toBeUndefined();
    expect(passedQuery["body"]).toBeUndefined();
  });

  test("uses the saved config when present", async () => {
    logCountBy.mockResolvedValue(new PositiveNumber(1));

    const step: MonitorStep = new MonitorStep();
    step.setLogMonitor({
      ...MonitorStepLogMonitorUtil.getDefault(),
      body: "connection refused",
    });

    await monitorLogs({ monitorStep: step, monitorId, projectId });

    const passedQuery: Record<string, unknown> = logCountBy.mock.calls[0]![0]
      .query as Record<string, unknown>;
    expect(passedQuery["body"]).toBeInstanceOf(Search);
    expect((passedQuery["body"] as Search<string>).value).toBe(
      "connection refused",
    );
  });
});

describe("monitorTrace", () => {
  test("falls back to the default query when traceMonitor config is missing", async () => {
    spanCountBy.mockResolvedValue(new PositiveNumber(2));

    const response: TraceMonitorResponse = await monitorTrace({
      monitorStep: new MonitorStep(),
      monitorId,
      projectId,
    });

    expect(response.spanCount).toBe(2);
    const passedQuery: Record<string, unknown> = spanCountBy.mock.calls[0]![0]
      .query as Record<string, unknown>;
    expect(passedQuery["startTime"]).toBeInstanceOf(InBetween);
  });
});

describe("monitorException", () => {
  test("falls back to the default query when exceptionMonitor config is missing", async () => {
    exceptionCountBy.mockResolvedValue(new PositiveNumber(3));

    const response: ExceptionMonitorResponse = await monitorException({
      monitorStep: new MonitorStep(),
      monitorId,
      projectId,
    });

    expect(response.exceptionCount).toBe(3);
    expect(exceptionCountBy).toHaveBeenCalledTimes(1);
  });
});

describe("monitorMetric", () => {
  test("still throws when metricMonitor config is missing (guard preserved)", async () => {
    await expect(
      monitorMetric({
        monitorStep: new MonitorStep(),
        monitorId,
        projectId,
      }),
    ).rejects.toThrow("Metric config is missing");
  });

  test("scopes a recommendation-created RUM metric query to its application id", async () => {
    const rumApplicationId: ObjectID = ObjectID.generate();
    const template: RumAlertTemplate | undefined =
      getRumAlertTemplateById("rum-poor-lcp");

    expect(template).toBeDefined();

    const step: MonitorStep = template!.getMonitorStep({
      rumApplicationId: rumApplicationId.toString(),
      onlineMonitorStatusId: ObjectID.generate(),
      offlineMonitorStatusId: ObjectID.generate(),
      defaultIncidentSeverityId: ObjectID.generate(),
      defaultAlertSeverityId: ObjectID.generate(),
      monitorName: "Storefront",
    });

    await monitorMetric({ monitorStep: step, monitorId, projectId });

    expect(metricAggregateBy).toHaveBeenCalledTimes(1);

    const query: Record<string, unknown> = metricAggregateBy.mock.calls[0]![0]
      .query as Record<string, unknown>;
    const primaryEntityId: Includes = query["primaryEntityId"] as Includes;

    expect(primaryEntityId).toBeInstanceOf(Includes);
    expect(
      (primaryEntityId.values as Array<string | ObjectID | number>).map(
        (id: string | ObjectID | number) => {
          return id.toString();
        },
      ),
    ).toEqual([rumApplicationId.toString()]);
    expect(query["projectId"]).toBe(projectId);
    expect(query["name"]).toBe("web_vital.lcp");
  });

  test("keeps legacy generic metric monitors project-wide when no scope is configured", async () => {
    const step: MonitorStep = new MonitorStep();
    step.setMetricMonitor({
      rollingTime: RollingTime.Past5Minutes,
      metricViewConfig: {
        queryConfigs: [
          {
            metricAliasData: {
              metricVariable: "latency",
              title: "Latency",
              description: "Latency",
              legend: "Latency",
              legendUnit: "ms",
            },
            metricQueryData: {
              filterData: {
                metricName: "custom.latency",
                attributes: {},
                aggegationType: MetricsAggregationType.Avg,
                aggregateBy: {},
              },
            },
          },
        ],
        formulaConfigs: [],
      },
    });

    await monitorMetric({ monitorStep: step, monitorId, projectId });

    const query: Record<string, unknown> = metricAggregateBy.mock.calls[0]![0]
      .query as Record<string, unknown>;

    expect(query["primaryEntityId"]).toBeUndefined();
  });
});

/*
 * monitorVMware: the worker half of the VMware monitor. The OpenTelemetry
 * Collector `vcenter` receiver stamps a vSphere object's identity as OTel
 * RESOURCE attributes, stored `resource.`-prefixed in ClickHouse, so every
 * scoping key the worker adds must carry that prefix — and the vCenter
 * scope (`resource.vmware.vcenter.name`) must be on EVERY query, or two
 * vCenters that both have a host called `esx-01` bleed into each other's
 * monitors.
 */
describe("monitorVMware", () => {
  function vmwareTemplateStep(templateId: string): MonitorStep {
    const template: VMwareAlertTemplate | undefined =
      getVMwareAlertTemplateById(templateId);

    expect(template).toBeDefined();

    return template!.getMonitorStep({
      vcenterIdentifier: "vcsa-prod",
      onlineMonitorStatusId: ObjectID.generate(),
      offlineMonitorStatusId: ObjectID.generate(),
      defaultIncidentSeverityId: ObjectID.generate(),
      defaultAlertSeverityId: ObjectID.generate(),
      monitorName: "vCenter Prod",
    });
  }

  function ungroupedVMwareStep(
    resourceFilters: VMwareResourceFilters,
  ): MonitorStep {
    const step: MonitorStep = new MonitorStep();
    step.setVMwareMonitor({
      ...MonitorStepVMwareMonitorUtil.getDefault(),
      vcenterIdentifier: "vcsa-prod",
      resourceFilters: resourceFilters,
      rollingTime: RollingTime.Past5Minutes,
      metricViewConfig: {
        queryConfigs: [
          {
            metricAliasData: {
              metricVariable: "host_cpu",
              title: "Host CPU",
              description: "Host CPU",
              legend: "Host CPU",
              legendUnit: "%",
            },
            metricQueryData: {
              filterData: {
                metricName: "vcenter.host.cpu.utilization",
                attributes: { power_state: "on" },
                aggegationType: MetricsAggregationType.Avg,
                aggregateBy: {},
              },
            },
          },
        ],
        formulaConfigs: [],
      },
    });
    return step;
  }

  test("throws when the vmwareMonitor config is missing (guard preserved)", async () => {
    await expect(
      monitorVMware({
        monitorStep: new MonitorStep(),
        monitorId,
        projectId,
      }),
    ).rejects.toThrow("VMware monitor config is missing");
  });

  test("always scopes the query to the vCenter and keeps the user's datapoint filters", async () => {
    await monitorVMware({
      monitorStep: ungroupedVMwareStep({}),
      monitorId,
      projectId,
    });

    // Ungrouped: aggregateBy runs once, and it must fail loud on timeout.
    expect(metricAggregateBy).toHaveBeenCalledTimes(1);
    const aggregateCall: Record<string, unknown> = metricAggregateBy.mock
      .calls[0]![0] as Record<string, unknown>;
    expect(aggregateCall["timeoutOverflowMode"]).toBe("throw");

    const query: Record<string, unknown> = aggregateCall["query"] as Record<
      string,
      unknown
    >;
    expect(query["projectId"]).toBe(projectId);
    expect(query["name"]).toBe("vcenter.host.cpu.utilization");
    expect(query["time"]).toBeInstanceOf(InBetween);
    expect(query["attributes"]).toEqual({
      power_state: "on",
      "resource.vmware.vcenter.name": "vcsa-prod",
    });

    // The raw breakdown fetch runs against the very same scoped query.
    expect(metricFindBy).toHaveBeenCalledTimes(1);
    const breakdownCall: Record<string, unknown> = metricFindBy.mock
      .calls[0]![0] as Record<string, unknown>;
    expect(breakdownCall["limit"]).toBe(100);
    expect(
      (breakdownCall["query"] as Record<string, unknown>)["attributes"],
    ).toEqual({
      power_state: "on",
      "resource.vmware.vcenter.name": "vcsa-prod",
    });
  });

  test("maps every resource filter to its resource.vcenter.* equality", async () => {
    await monitorVMware({
      monitorStep: ungroupedVMwareStep({
        datacenterName: "DC1",
        clusterName: "prod-cluster",
        hostName: "esx-01",
        vmName: "db-01",
        datastoreName: "vsan-ds-01",
        resourcePoolPath: "/DC1/host/prod-cluster/Resources/batch",
      }),
      monitorId,
      projectId,
    });

    const query: Record<string, unknown> = metricAggregateBy.mock.calls[0]![0]
      .query as Record<string, unknown>;

    expect(query["attributes"]).toEqual({
      power_state: "on",
      "resource.vmware.vcenter.name": "vcsa-prod",
      "resource.vcenter.datacenter.name": "DC1",
      "resource.vcenter.cluster.name": "prod-cluster",
      "resource.vcenter.host.name": "esx-01",
      "resource.vcenter.vm.name": "db-01",
      "resource.vcenter.datastore.name": "vsan-ds-01",
      "resource.vcenter.resource_pool.inventory_path":
        "/DC1/host/prod-cluster/Resources/batch",
    });

    // Nothing Proxmox-shaped (bare `pve.*` / `id` datapoint labels) leaks in.
    for (const key of Object.keys(
      query["attributes"] as Record<string, unknown>,
    )) {
      expect(key.startsWith("pve.")).toBe(false);
      expect(key).not.toBe("id");
    }
  });

  test("ignores blank and non-string resource filters instead of throwing", async () => {
    await monitorVMware({
      monitorStep: ungroupedVMwareStep({
        hostName: "   ",
        clusterName: "  prod-cluster ",
        // Step JSON is not schema-checked: a number must not become a filter.
        vmName: 42 as unknown as string,
      }),
      monitorId,
      projectId,
    });

    const query: Record<string, unknown> = metricAggregateBy.mock.calls[0]![0]
      .query as Record<string, unknown>;

    expect(query["attributes"]).toEqual({
      power_state: "on",
      "resource.vmware.vcenter.name": "vcsa-prod",
      "resource.vcenter.cluster.name": "prod-cluster",
    });
  });

  test("a shipped template groups by the object's resource attribute and takes the grouped path", async () => {
    metricFindBy.mockResolvedValue([
      {
        time: new Date(),
        value: 97.25,
        attributes: {
          "resource.vmware.vcenter.name": "vcsa-prod",
          "resource.vcenter.datacenter.name": "DC1",
          "resource.vcenter.cluster.name": "prod-cluster",
          "resource.vcenter.host.name": "esx-02",
        },
      },
      {
        time: new Date(),
        value: 42.5,
        attributes: {
          "resource.vmware.vcenter.name": "vcsa-prod",
          "resource.vcenter.datacenter.name": "DC1",
          "resource.vcenter.cluster.name": "prod-cluster",
          "resource.vcenter.host.name": "esx-01",
        },
      },
      // Same host seen twice: the breakdown keeps the highest value.
      {
        time: new Date(),
        value: 12.5,
        attributes: {
          "resource.vmware.vcenter.name": "vcsa-prod",
          "resource.vcenter.datacenter.name": "DC1",
          "resource.vcenter.cluster.name": "prod-cluster",
          "resource.vcenter.host.name": "esx-01",
        },
      },
    ]);

    const response: MetricMonitorResponse = await monitorVMware({
      monitorStep: vmwareTemplateStep("vmware-host-cpu-saturation"),
      monitorId,
      projectId,
    });

    // Grouped: raw rows are aggregated per series in the worker, never via aggregateBy.
    expect(metricAggregateBy).not.toHaveBeenCalled();
    // One raw fetch for the per-series aggregation, one (limit 100) for the breakdown.
    expect(metricFindBy).toHaveBeenCalledTimes(2);

    for (const call of metricFindBy.mock.calls) {
      const query: Record<string, unknown> = (
        call[0] as Record<string, unknown>
      )["query"] as Record<string, unknown>;
      expect(
        (query["attributes"] as Record<string, string>)[
          "resource.vmware.vcenter.name"
        ],
      ).toBe("vcsa-prod");
    }

    expect(response.seriesBreakdown).toBeDefined();
    expect(
      response
        .seriesBreakdown!.map((series: MetricSeriesResult) => {
          return series.labels["resource.vcenter.host.name"];
        })
        .sort(),
    ).toEqual(["esx-01", "esx-02"]);

    const breakdown: VMwareResourceBreakdown | undefined =
      response.vmwareResourceBreakdown;
    expect(breakdown).toBeDefined();
    expect(breakdown!.vcenterName).toBe("vcsa-prod");
    expect(breakdown!.metricName).toBe("vcenter.host.cpu.utilization");
    // Friendly name comes from the VMware catalog.
    expect(breakdown!.metricFriendlyName).toBe("Host CPU Utilization");
    expect(
      breakdown!.affectedResources
        .map((resource: VMwareAffectedResource) => {
          return `${resource.hostName}=${resource.metricValue}`;
        })
        .sort(),
    ).toEqual(["esx-01=42.5", "esx-02=97.25"]);
    expect(breakdown!.affectedResources[0]!.datacenterName).toBe("DC1");
    expect(breakdown!.affectedResources[0]!.clusterName).toBe("prod-cluster");
    expect(response.proxmoxResourceBreakdown).toBeUndefined();
  });

  test("folds a VM template's identity into the VM fields of the breakdown", async () => {
    metricFindBy.mockResolvedValue([
      {
        time: new Date(),
        value: 1073741824,
        attributes: {
          "resource.vcenter.datacenter.name": "DC1",
          "resource.vcenter.host.name": "esx-01",
          "resource.vcenter.vm_template.name": "ubuntu-golden",
          "resource.vcenter.vm_template.id": "5029abcd-tmpl",
        },
      },
    ]);

    const response: MetricMonitorResponse = await monitorVMware({
      monitorStep: ungroupedVMwareStep({}),
      monitorId,
      projectId,
    });

    expect(response.vmwareResourceBreakdown!.affectedResources).toEqual([
      {
        datacenterName: "DC1",
        clusterName: undefined,
        hostName: "esx-01",
        vmName: "ubuntu-golden",
        vmId: "5029abcd-tmpl",
        datastoreName: undefined,
        resourcePoolName: undefined,
        resourcePoolPath: undefined,
        metricValue: 1073741824,
      },
    ]);
  });

  test("a failed breakdown fetch is logged and never fails the evaluation", async () => {
    metricFindBy.mockRejectedValue(new Error("ClickHouse timeout"));

    const response: MetricMonitorResponse = await monitorVMware({
      monitorStep: ungroupedVMwareStep({}),
      monitorId,
      projectId,
    });

    expect(metricAggregateBy).toHaveBeenCalledTimes(1);
    expect(response.vmwareResourceBreakdown).toBeUndefined();
    expect(response.metricResult).toHaveLength(1);
    expect(response.monitorId).toBe(monitorId);
  });
});
