import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  MONITOR_THROUGH_RELATION_SELECT,
  MonitorStepsOfMonitor,
  mayReadMonitorSteps,
  readMetricNamesOfMonitor,
  readMonitorId,
  readMonitorSteps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/ReadMonitorSteps";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Includes from "../../../Types/BaseDatabase/Includes";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import { MonitorStepMetricMonitorUtil } from "../../../Types/Monitor/MonitorStepMetricMonitor";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionUtil from "../../../UI/Utils/Permission";
import PermissionGate from "../../../UI/Utils/PermissionGate";

/*
 * A MONITOR'S STEPS ARE READ ON THE MONITOR, BY THE MONITOR'S OWN READ
 * (#10309): what the Root Cause card and an Affected Resource's commands
 * read now that no relation reads them (Monitor.monitorSteps).
 *
 *   - which monitor an incident or an alert is on is read through it by its
 *     id and kind (MONITOR_THROUGH_RELATION_SELECT);
 *   - its steps, on the monitor, in one read of the monitors named, for a
 *     reader who may read them - or, without the reader's permissions in
 *     hand yet, for the server to decide;
 *   - a reader who may read no monitor's steps is not sent the read, and a
 *     read that fails is no steps, never an error.
 */

const MONITOR_A: string = "10309000-0000-4000-8000-0000000000e1";
const MONITOR_B: string = "10309000-0000-4000-8000-0000000000e2";

function metricsSteps(metricNames: Array<string>): MonitorSteps {
  const steps: MonitorSteps = new MonitorSteps();

  steps.setMonitorStepsInstanceArray(
    metricNames.map((metricName: string): MonitorStep => {
      const step: MonitorStep = new MonitorStep();
      step.setMetricMonitor({
        ...MonitorStepMetricMonitorUtil.getDefault(),
        metricViewConfig: {
          queryConfigs: [
            {
              metricAliasData: {
                metricVariable: "a",
                title: "",
                description: "",
                legend: "",
                legendUnit: "",
              },
              metricQueryData: {
                filterData: {
                  metricName: metricName,
                  aggegationType: MetricsAggregationType.Avg,
                } as never,
              },
            },
          ],
          formulaConfigs: [],
        },
      });
      return step;
    }),
  );

  return steps;
}

function monitorRow(
  id: string,
  monitorType: MonitorType,
  steps: MonitorSteps,
): Monitor {
  const monitor: Monitor = new Monitor();
  monitor._id = id;
  monitor.monitorType = monitorType;
  monitor.monitorSteps = steps;
  return monitor;
}

let getListSpy: ReturnType<typeof jest.spyOn>;

// The reader's permissions, as their permission snapshot holds them.
function readerHolds(permissions: Array<Permission>): void {
  PermissionGate.clearPermissionPropsCache();
  jest.spyOn(PermissionUtil, "getAllPermissions").mockReturnValue(permissions);
}

beforeEach(() => {
  PermissionGate.clearPermissionPropsCache();
  getListSpy = jest.spyOn(ModelAPI, "getList").mockResolvedValue({
    data: [
      monitorRow(MONITOR_A, MonitorType.Metrics, metricsSteps(["cpu"])),
      monitorRow(MONITOR_B, MonitorType.Host, metricsSteps(["memory"])),
    ],
    count: 2,
    skip: 0,
    limit: 2,
  } as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("what a page reads of a monitor through the incident or alert that names it", () => {
  test("which monitor it is and what kind: never its steps", () => {
    expect(MONITOR_THROUGH_RELATION_SELECT).toEqual({
      _id: true,
      monitorType: true,
    });
  });

  test("an id is read as a page holds it: an ObjectID or its string, trimmed; anything else is none", () => {
    expect(readMonitorId(new ObjectID(MONITOR_A))).toBe(MONITOR_A);
    expect(readMonitorId(` ${MONITOR_A} `)).toBe(MONITOR_A);
    expect(readMonitorId("  ")).toBeUndefined();
    expect(readMonitorId(undefined)).toBeUndefined();
    expect(readMonitorId(42)).toBeUndefined();
  });
});

describe("who is sent the monitor's own read", () => {
  test.each([
    ["Project Owner", [Permission.ProjectOwner], true],
    ["Project Admin", [Permission.ProjectAdmin], true],
    ["Project Member", [Permission.ProjectMember], true],
    ["Viewer", [Permission.Viewer], true],
    ["Monitor Viewer", [Permission.MonitorViewer], true],
    [
      "a custom role that reads monitors",
      [Permission.ReadProjectMonitor],
      true,
    ],
    ["Incident Viewer", [Permission.IncidentViewer], false],
    ["Alert Member", [Permission.AlertMember], false],
    [
      "a custom role that reads incidents",
      [Permission.ReadProjectIncident],
      false,
    ],
    ["a custom role that reads alerts", [Permission.ReadAlert], false],
  ] as Array<[string, Array<Permission>, boolean]>)(
    "%s: %s",
    async (_who: string, permissions: Array<Permission>, mayRead: boolean) => {
      readerHolds(permissions);

      expect(mayReadMonitorSteps()).toBe(mayRead);

      const read: Array<MonitorStepsOfMonitor> = await readMonitorSteps([
        MONITOR_A,
      ]);

      expect(getListSpy).toHaveBeenCalledTimes(mayRead ? 1 : 0);
      expect(read.length > 0).toBe(mayRead);
    },
  );

  test("without the reader's permissions in hand yet, the server decides: the read is sent", async () => {
    jest.spyOn(PermissionUtil, "getAllPermissions").mockReturnValue([]);

    expect(PermissionGate.hasPermissionSnapshot()).toBe(false);
    expect(mayReadMonitorSteps()).toBe(true);

    await readMonitorSteps([MONITOR_A]);

    expect(getListSpy).toHaveBeenCalledTimes(1);
  });
});

describe("the monitor's own read", () => {
  beforeEach(() => {
    readerHolds([Permission.ProjectMember]);
  });

  test("reads the monitors named, each once, in one read of their ids, their steps and kind alone", async () => {
    const read: Array<MonitorStepsOfMonitor> = await readMonitorSteps([
      MONITOR_A,
      ` ${MONITOR_B}`,
      MONITOR_A,
      "",
    ]);

    expect(getListSpy).toHaveBeenCalledTimes(1);

    const request: {
      modelType: unknown;
      query: { _id: Includes };
      select: unknown;
      limit: number;
      skip: number;
    } = getListSpy.mock.calls[0]![0] as never;

    expect(request.modelType).toBe(Monitor);
    expect(request.query._id).toBeInstanceOf(Includes);
    expect(request.query._id.values).toEqual([MONITOR_A, MONITOR_B]);
    expect(request.select).toEqual({
      _id: true,
      monitorType: true,
      monitorSteps: true,
    });
    expect(request.limit).toBe(2);
    expect(request.skip).toBe(0);

    expect(
      read.map((monitor: MonitorStepsOfMonitor): unknown => {
        return [
          monitor._id,
          monitor.monitorType,
          Boolean(monitor.monitorSteps),
        ];
      }),
    ).toEqual([
      [MONITOR_A, MonitorType.Metrics, true],
      [MONITOR_B, MonitorType.Host, true],
    ]);
  });

  test("names none: no read", async () => {
    expect(await readMonitorSteps([])).toEqual([]);
    expect(await readMonitorSteps(["  "])).toEqual([]);
    expect(getListSpy).not.toHaveBeenCalled();
  });

  test("a read the server refuses, or that fails, is no steps: never an error", async () => {
    getListSpy.mockRejectedValue(
      new Error("You do not have permissions to read Monitor."),
    );

    await expect(readMonitorSteps([MONITOR_A])).resolves.toEqual([]);
  });

  test("a monitor the reader may not read is not answered, and has no steps: the monitors answered alone", async () => {
    getListSpy.mockResolvedValue({
      data: [monitorRow(MONITOR_B, MonitorType.Host, metricsSteps(["memory"]))],
      count: 1,
      skip: 0,
      limit: 2,
    } as never);

    const read: Array<MonitorStepsOfMonitor> = await readMonitorSteps([
      MONITOR_A,
      MONITOR_B,
    ]);

    expect(
      read.map((monitor: MonitorStepsOfMonitor): string => {
        return monitor._id;
      }),
    ).toEqual([MONITOR_B]);
  });
});

describe("the metrics an Affected Resource's commands name, read on a Metrics monitor", () => {
  beforeEach(() => {
    readerHolds([Permission.Viewer]);
  });

  test("a Metrics monitor's steps name its readings", async () => {
    getListSpy.mockResolvedValue({
      data: [
        monitorRow(
          MONITOR_A,
          MonitorType.Metrics,
          metricsSteps(["esper.device.check_in", "esper.device.battery"]),
        ),
      ],
      count: 1,
      skip: 0,
      limit: 1,
    } as never);

    expect(
      await readMetricNamesOfMonitor({
        _id: MONITOR_A,
        monitorType: MonitorType.Metrics,
      }),
    ).toEqual(["esper.device.check_in", "esper.device.battery"]);
  });

  test("any other kind of monitor is never read: its commands name no metric", async () => {
    for (const monitorType of [
      MonitorType.API,
      MonitorType.Website,
      MonitorType.Host,
      MonitorType.Logs,
    ]) {
      expect(
        await readMetricNamesOfMonitor({
          _id: MONITOR_A,
          monitorType: monitorType,
        }),
      ).toBeUndefined();
    }

    expect(await readMetricNamesOfMonitor(undefined)).toBeUndefined();
    expect(
      await readMetricNamesOfMonitor({ monitorType: MonitorType.Metrics }),
    ).toBeUndefined();
    expect(getListSpy).not.toHaveBeenCalled();
  });

  test("a reader who may not read the monitor names none: every command of the device is offered", async () => {
    readerHolds([Permission.IncidentMember]);

    expect(
      await readMetricNamesOfMonitor({
        _id: MONITOR_A,
        monitorType: MonitorType.Metrics,
      }),
    ).toBeUndefined();
    expect(getListSpy).not.toHaveBeenCalled();
  });

  test("a monitor the read did not answer names none", async () => {
    getListSpy.mockResolvedValue({
      data: [],
      count: 0,
      skip: 0,
      limit: 1,
    } as never);

    expect(
      await readMetricNamesOfMonitor({
        _id: MONITOR_A,
        monitorType: MonitorType.Metrics,
      }),
    ).toBeUndefined();
  });
});
