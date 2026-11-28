import MonitorStep from "Common/Types/Monitor/MonitorStep";
import ObjectID from "Common/Types/ObjectID";
import Dictionary from "Common/Types/Dictionary";
import { JSONObject } from "Common/Types/JSON";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import { CriteriaFilter } from "Common/Types/Monitor/CriteriaFilter";
import MetricMonitorResponse from "Common/Types/Monitor/MetricMonitor/MetricMonitorResponse";
import DataToProcess from "Common/Server/Utils/Monitor/DataToProcess";
import {
  VMwareAlertTemplate,
  VMwareAlertTemplateArgs,
  getVMwareAlertTemplateById,
} from "Common/Types/Monitor/VMwareAlertTemplates";
import { VMwareSwapRateMetric } from "Common/Types/VMware/VMwareSwapRates";

/*
 * VM MEMORY SWAPPING FIRES ON SWAPPING NOW (#11468), run through the real
 * VMware monitor and the real criteria evaluator over stored rows.
 *
 * The VMs of one vCenter, over the template's five minutes:
 *
 *   - web-01: the host is swapping its memory out every minute;
 *   - db-01: 64 MiB in the swap file, left from pressure weeks ago, and
 *     nothing swapped out now - what the old template fired on, forever;
 *   - batch-01: swapped out once, in one minute, then stopped;
 *   - cache-01: 2 GiB left in the swap file, not swapping now.
 *
 * VM Memory Swapping fires for web-01 alone. The version before #11468 -
 * the monitors made from it, which are not changed - fires for db-01 and
 * cache-01 too. VM Swapped Memory High fires for cache-01 alone.
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
jest.mock("Common/Server/Services/HostService", () => {
  return {
    __esModule: true,
    default: { getExpectedHostIdentifiers: jest.fn() },
  };
});

import MetricService from "Common/Server/Services/MetricService";
import MetricTypeService from "Common/Server/Services/MetricTypeService";
import MetricMonitorCriteria, {
  MetricSeriesEvaluationResult,
} from "Common/Server/Utils/Monitor/Criteria/MetricMonitorCriteria";
import { monitorVMware } from "../../../../FeatureSet/Workers/Jobs/TelemetryMonitor/MonitorTelemetryMonitor";
import { FoldedReadArgs, foldRowsAsSqlRead } from "./SqlGroupedFold";

const metricAggregateBy: jest.Mock =
  MetricService.aggregateBy as unknown as jest.Mock;
const metricFindBy: jest.Mock = MetricService.findBy as unknown as jest.Mock;
const metricTypeFindBy: jest.Mock =
  MetricTypeService.findBy as unknown as jest.Mock;

const MINUTE_MS: number = 60_000;

const templateArgs: VMwareAlertTemplateArgs = {
  vcenterIdentifier: "vcsa-prod",
  onlineMonitorStatusId: ObjectID.generate(),
  offlineMonitorStatusId: ObjectID.generate(),
  defaultIncidentSeverityId: ObjectID.generate(),
  defaultAlertSeverityId: ObjectID.generate(),
  monitorName: "Prod",
};

interface StoredRow {
  time: Date;
  value: number;
  attributes: JSONObject;
}

function vm(name: string): JSONObject {
  return {
    "resource.vmware.vcenter.name": "vcsa-prod",
    "resource.vcenter.datacenter.name": "DC1",
    "resource.vcenter.cluster.name": "cluster-a",
    "resource.vcenter.host.name": "esx-07",
    "resource.vcenter.vm.name": name,
  };
}

// One row per minute of the window, the newest last.
function everyMinute(
  name: string,
  values: Array<number>,
  datapoint: JSONObject = {},
): Array<StoredRow> {
  const now: number = Date.now();
  return values.map((value: number, index: number): StoredRow => {
    return {
      time: new Date(now - (values.length - index) * MINUTE_MS + 1000),
      value,
      attributes: { ...vm(name), ...datapoint },
    };
  });
}

const VSPHERE: JSONObject = { source: "vsphere" };

const ROWS: Dictionary<Array<StoredRow>> = {
  // OneUptime's judged rate, in bytes per second.
  [VMwareSwapRateMetric.VirtualMachineSwapOut]: [
    ...everyMinute(
      "web-01",
      [524288, 1048576, 262144, 524288, 786432],
      VSPHERE,
    ),
    ...everyMinute("db-01", [0, 0, 0, 0, 0], VSPHERE),
    ...everyMinute("batch-01", [0, 0, 4096, 0, 0], VSPHERE),
    ...everyMinute("cache-01", [0, 0, 0, 0, 0], VSPHERE),
  ],
  // The receiver's amount, in MiB.
  "vcenter.vm.memory.swapped": [
    ...everyMinute("web-01", [100, 300, 400, 500, 700]),
    ...everyMinute("db-01", [64, 64, 64, 64, 64]),
    ...everyMinute("batch-01", [0, 0, 1, 1, 1]),
    ...everyMinute("cache-01", [2048, 2048, 2048, 2048, 2048]),
  ],
};

beforeEach(() => {
  metricAggregateBy.mockReset().mockImplementation(async (args: unknown) => {
    const read: FoldedReadArgs & { query: { name: string } } =
      args as FoldedReadArgs & { query: { name: string } };
    return foldRowsAsSqlRead(ROWS[read.query.name] || [], read);
  });
  metricFindBy.mockReset().mockImplementation(async (args: unknown) => {
    return ROWS[(args as { query: { name: string } }).query.name] || [];
  });
  metricTypeFindBy.mockReset().mockResolvedValue([
    { name: VMwareSwapRateMetric.VirtualMachineSwapOut, unit: "By/s" },
    { name: "vcenter.vm.memory.swapped", unit: "MiBy" },
  ]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// The VMs a step's firing criteria fires for, by the real evaluator.
async function firingVms(step: MonitorStep): Promise<Array<string>> {
  const response: MetricMonitorResponse = await monitorVMware({
    monitorStep: step,
    monitorId: ObjectID.generate(),
    projectId: ObjectID.generate(),
  });

  const fire: MonitorCriteriaInstance =
    step.data!.monitorCriteria!.data!.monitorCriteriaInstanceArray[0]!;
  const filter: CriteriaFilter = fire.data!.filters[0]!;

  const results: Array<MetricSeriesEvaluationResult> =
    await MetricMonitorCriteria.evaluateAllSeries({
      dataToProcess: response as DataToProcess,
      criteriaFilter: JSON.parse(JSON.stringify(filter)) as CriteriaFilter,
      monitorStep: step,
    });

  return results
    .filter((result: MetricSeriesEvaluationResult): boolean => {
      return result.rootCause !== null;
    })
    .map((result: MetricSeriesEvaluationResult): string => {
      return String(
        result.labels["resource.vcenter.vm.name"] ?? result.fingerprint,
      );
    })
    .sort();
}

function template(id: string): VMwareAlertTemplate {
  return getVMwareAlertTemplateById(id)!;
}

describe("VM Memory Swapping, as shipped since #11468", () => {
  test("fires for the VM the host is swapping out now, and for no VM with memory left from earlier", async () => {
    const step: MonitorStep = template(
      "vmware-vm-memory-swapping",
    ).getMonitorStep(templateArgs);

    expect(await firingVms(step)).toEqual(["web-01"]);
  });

  test("reads OneUptime's swap out rate, not the swapped amount", () => {
    const step: MonitorStep = template(
      "vmware-vm-memory-swapping",
    ).getMonitorStep(templateArgs);
    const queries: Array<string> = MonitorStep.getMetricsViewConfig(
      step,
    )!.queryConfigs.map(
      (config: {
        metricQueryData: { filterData: { metricName?: string } };
      }) => {
        return config.metricQueryData.filterData.metricName || "";
      },
    );
    expect(queries).toEqual([VMwareSwapRateMetric.VirtualMachineSwapOut]);
  });
});

describe("the version before #11468, which monitors made from it still run", () => {
  test("fired on any memory in the swap file: the VMs that are not swapping now too", async () => {
    const legacy: Array<MonitorStep> = template("vmware-vm-memory-swapping")
      .getEquivalentMonitorSteps!(templateArgs);
    expect(legacy).toHaveLength(1);

    expect(await firingVms(legacy[0]!)).toEqual([
      "cache-01",
      "db-01",
      "web-01",
    ]);
  });
});

describe("VM Swapped Memory High", () => {
  test("fires for more than 1 GiB left in the swap file, and not for a few MiB", async () => {
    const step: MonitorStep = template(
      "vmware-vm-swapped-memory-high",
    ).getMonitorStep(templateArgs);

    expect(await firingVms(step)).toEqual(["cache-01"]);
  });
});
