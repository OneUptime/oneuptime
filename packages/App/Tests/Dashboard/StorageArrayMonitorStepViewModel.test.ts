import { describe, expect, it } from "@jest/globals";
import MonitorStep, { MonitorStepType } from "Common/Types/Monitor/MonitorStep";
import MonitorStepStorageArrayMonitor, {
  MonitorStepStorageArrayMonitorUtil,
} from "Common/Types/Monitor/MonitorStepStorageArrayMonitor";
import MonitorType, {
  MonitorTypeHelper,
} from "Common/Types/Monitor/MonitorType";
import MetricsViewConfig from "Common/Types/Metrics/MetricsViewConfig";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import RollingTime from "Common/Types/RollingTime/RollingTime";
import ObjectID from "Common/Types/ObjectID";
import { getStorageArrayAlertTemplateById } from "Common/Types/Monitor/StorageArrayAlertTemplates";
import MonitorStepViewModel, {
  MonitorStepViewRow,
  MonitorStepViewValueType,
} from "../../FeatureSet/Dashboard/src/Utils/MonitorStepViewModel";

/*
 * The monitor's Criteria page renders a read-only view of the step next to
 * the criteria (MonitorStepViewModel). A monitor type with no branch there
 * renders a "Monitor Details" heading with nothing under it — the failure
 * MonitorStepViewModel.test.ts exists to catch for every type. These pin
 * what the page shows for a storage array monitor: the array, each
 * resource filter that is set (and none that is not), the metrics it
 * queries and the window it evaluates, plus the live chart preview.
 */

const METRIC_VIEW_CONFIG: MetricsViewConfig = {
  queryConfigs: [
    {
      metricAliasData: {
        metricVariable: "write_latency_usec",
        title: "Write Latency",
        description: "Write latency",
        legend: "Write",
        legendUnit: "µs",
      },
      metricQueryData: {
        filterData: {
          metricName: "purefa_volume_performance_latency_usec",
          attributes: { dimension: "usec_per_write_op" },
          aggegationType: MetricsAggregationType.Max,
          aggregateBy: {},
        },
        groupByAttributeKeys: ["name"],
      },
    },
  ],
  formulaConfigs: [],
};

function buildStep(
  storageArrayMonitor: MonitorStepStorageArrayMonitor | undefined,
): MonitorStep {
  const monitorStep: MonitorStep = new MonitorStep();
  monitorStep.data = {
    ...(monitorStep.data as MonitorStepType),
    storageArrayMonitor: storageArrayMonitor,
  };
  return monitorStep;
}

function rowsFor(
  storageArrayMonitor: MonitorStepStorageArrayMonitor | undefined,
): Array<MonitorStepViewRow> {
  return MonitorStepViewModel.getRows({
    monitorStep: buildStep(storageArrayMonitor),
    monitorType: MonitorType.StorageArray,
  });
}

function rowFor(
  rows: Array<MonitorStepViewRow>,
  key: string,
): MonitorStepViewRow | undefined {
  return rows.find((row: MonitorStepViewRow): boolean => {
    return row.key === key;
  });
}

const FULL_MONITOR: MonitorStepStorageArrayMonitor = {
  arrayIdentifier: "fa-prod-01",
  storageSystem: "purestorage.flasharray",
  resourceFilters: {
    volumeName: "vg1/vol-db-01",
    hostName: "esxi-01",
  },
  metricViewConfig: METRIC_VIEW_CONFIG,
  rollingTime: RollingTime.Past10Minutes,
};

describe("MonitorStepViewModel for storage array monitors", () => {
  it("is an active monitor type, so the coverage suite holds it to rows", () => {
    expect(MonitorTypeHelper.getActiveMonitorTypes()).toContain(
      MonitorType.StorageArray,
    );
  });

  it("shows the storage array it watches", () => {
    const row: MonitorStepViewRow | undefined = rowFor(
      rowsFor(FULL_MONITOR),
      "arrayIdentifier",
    );
    expect(row?.title).toBe("Storage Array");
    expect(row?.value).toBe("fa-prod-01");
    expect(row?.valueType).toBe(MonitorStepViewValueType.Text);
  });

  it("says no array is selected rather than rendering an empty page", () => {
    const rows: Array<MonitorStepViewRow> = rowsFor(
      MonitorStepStorageArrayMonitorUtil.getDefault(),
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rowFor(rows, "arrayIdentifier")?.placeholder).toBe(
      "No storage array selected",
    );
  });

  it("shows every resource filter that is set, and none that is not", () => {
    const rows: Array<MonitorStepViewRow> = rowsFor(FULL_MONITOR);

    expect(rowFor(rows, "storageArrayVolumeName")?.value).toBe("vg1/vol-db-01");
    expect(rowFor(rows, "storageArrayHostName")?.value).toBe("esxi-01");

    for (const key of [
      "storageArrayPodName",
      "storageArrayComponentName",
      "storageArrayFileSystemName",
      "storageArrayBucketName",
    ]) {
      expect(rowFor(rows, key)).toBeUndefined();
    }
  });

  it("shows all six filters when all six are set", () => {
    const rows: Array<MonitorStepViewRow> = rowsFor({
      ...FULL_MONITOR,
      resourceFilters: {
        volumeName: "vol-1",
        hostName: "host-1",
        podName: "pod-1",
        componentName: "CH0.BAY1",
        fileSystemName: "fs-home",
        bucketName: "backups",
      },
    });

    for (const [key, value] of [
      ["storageArrayVolumeName", "vol-1"],
      ["storageArrayHostName", "host-1"],
      ["storageArrayPodName", "pod-1"],
      ["storageArrayComponentName", "CH0.BAY1"],
      ["storageArrayFileSystemName", "fs-home"],
      ["storageArrayBucketName", "backups"],
    ]) {
      expect(rowFor(rows, key!)?.value).toBe(value);
    }
  });

  it("names the metrics it queries, how they are grouped, and the window", () => {
    const rows: Array<MonitorStepViewRow> = rowsFor(FULL_MONITOR);

    expect(rowFor(rows, "metricNames")?.value).toEqual([
      "Write Latency (purefa_volume_performance_latency_usec · Max)",
    ]);
    expect(rowFor(rows, "metricGroupBy")?.value).toEqual(["name"]);
    expect(rowFor(rows, "rollingTime")?.value).toBe(RollingTime.Past10Minutes);
  });

  it("gives every row a unique key, a title, a description and a placeholder", () => {
    const rows: Array<MonitorStepViewRow> = rowsFor({
      ...FULL_MONITOR,
      resourceFilters: {
        volumeName: "vol-1",
        hostName: "host-1",
        podName: "pod-1",
        componentName: "CH0.BAY1",
        fileSystemName: "fs-home",
        bucketName: "backups",
      },
    });
    const keys: Array<string> = rows.map((row: MonitorStepViewRow): string => {
      return row.key;
    });
    expect(new Set(keys).size).toBe(keys.length);
    for (const row of rows) {
      expect(row.title.length).toBeGreaterThan(0);
      expect(row.description.length).toBeGreaterThan(0);
      expect(row.placeholder.length).toBeGreaterThan(0);
    }
  });

  it("offers a live chart preview", () => {
    expect(
      MonitorStepViewModel.hasMetricPreview(MonitorType.StorageArray),
    ).toBe(true);
  });

  it("reads the preview's metric view and window out of the storage array step", () => {
    const step: MonitorStep = buildStep(FULL_MONITOR);
    expect(
      MonitorStepViewModel.getMetricsViewConfig(step).queryConfigs,
    ).toHaveLength(1);
    expect(MonitorStepViewModel.getRollingTime(step)).toBe(
      RollingTime.Past10Minutes,
    );
  });

  it("shows what a Quick Setup template configured", () => {
    const step: MonitorStep = getStorageArrayAlertTemplateById(
      "purefa-critical-alerts",
    )!.getMonitorStep({
      arrayIdentifier: "fa-prod-01",
      onlineMonitorStatusId: ObjectID.generate(),
      offlineMonitorStatusId: ObjectID.generate(),
      defaultIncidentSeverityId: ObjectID.generate(),
      defaultAlertSeverityId: ObjectID.generate(),
      monitorName: "Array alerts",
    });

    const rows: Array<MonitorStepViewRow> = MonitorStepViewModel.getRows({
      monitorStep: step,
      monitorType: MonitorType.StorageArray,
    });

    expect(rowFor(rows, "arrayIdentifier")?.value).toBe("fa-prod-01");
    expect((rowFor(rows, "metricNames")?.value as Array<string>)[0]).toContain(
      "purefa_alerts_open",
    );
    expect(rowFor(rows, "metricGroupBy")?.value).toEqual(["summary"]);
    expect(MonitorStepViewModel.getRollingTime(step)).toBe(
      RollingTime.Past5Minutes,
    );
  });
});
