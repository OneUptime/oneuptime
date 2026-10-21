import MonitorStep from "Common/Types/Monitor/MonitorStep";
import { MonitorStepLogMonitorUtil } from "Common/Types/Monitor/MonitorStepLogMonitor";
import ObjectID from "Common/Types/ObjectID";
import PositiveNumber from "Common/Types/PositiveNumber";
import Search from "Common/Types/BaseDatabase/Search";
import LogMonitorResponse from "Common/Types/Monitor/LogMonitor/LogMonitorResponse";
import MetricSeriesFingerprint from "Common/Utils/Metrics/MetricSeriesFingerprint";
import { describe, expect, test, beforeEach } from "@jest/globals";

/*
 * The worker half of a Logs monitor's Group By: when the step names
 * group-by attributes, monitorLogs counts the window once per group
 * (LogService.countByAttributeGroups) instead of once in total, and hands
 * the criteria a breakdown whose fingerprints are the ones the alerts are
 * stored under. A step without them still takes the single countBy path.
 */

// Keep the heavy worker module from touching Redis at import time.
jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: { addJob: jest.fn() },
    QueueName: { Telemetry: "Telemetry" },
  };
});

// The worker transitively loads the native isolated-vm addon via VMRunner.
jest.mock("Common/Server/Utils/VM/VMRunner", () => {
  return { __esModule: true, default: {} };
});

jest.mock("Common/Server/Services/LogService", () => {
  return {
    __esModule: true,
    default: { countBy: jest.fn(), countByAttributeGroups: jest.fn() },
  };
});

import LogService from "Common/Server/Services/LogService";
import logger from "Common/Server/Utils/Logger";
import { MaxEntitiesPerCriteria } from "Common/Server/Utils/Monitor/PerEntityCriteriaFanOut";
import { monitorLogs } from "../../../../FeatureSet/Workers/Jobs/TelemetryMonitor/MonitorTelemetryMonitor";

const countBy: jest.Mock = LogService.countBy as unknown as jest.Mock;
const countByAttributeGroups: jest.Mock =
  LogService.countByAttributeGroups as unknown as jest.Mock;

const monitorId: ObjectID = ObjectID.generate();
const projectId: ObjectID = ObjectID.generate();

function stepGroupedBy(
  groupByAttributes: Array<string> | undefined,
): MonitorStep {
  const step: MonitorStep = new MonitorStep();
  step.data = {
    id: ObjectID.generate().toString(),
  } as unknown as MonitorStep["data"];
  step.data!.logMonitor = {
    ...MonitorStepLogMonitorUtil.getDefault(),
    body: "terminated",
    attributes: { log_component: "IPSec" },
    groupByAttributes: groupByAttributes,
  };
  return step;
}

beforeEach(() => {
  countBy.mockReset().mockResolvedValue(new PositiveNumber(0));
  countByAttributeGroups.mockReset().mockResolvedValue({
    groups: [],
    totalCount: 0,
    totalGroupCount: 0,
  });
});

describe("monitorLogs - grouped by attributes", () => {
  test("counts once per group and returns the breakdown", async () => {
    countByAttributeGroups.mockResolvedValue({
      groups: [
        { values: ["HQ-Branch1"], count: 3 },
        { values: ["Branch2"], count: 1 },
      ],
      totalCount: 4,
      totalGroupCount: 2,
    });

    const response: LogMonitorResponse = await monitorLogs({
      monitorStep: stepGroupedBy(["con_name"]),
      monitorId,
      projectId,
    });

    expect(countBy).not.toHaveBeenCalled();
    expect(countByAttributeGroups).toHaveBeenCalledTimes(1);

    expect(response.logCount).toBe(4);
    expect(response.groupByAttributes).toEqual(["con_name"]);
    expect(response.totalGroupCount).toBe(2);
    expect(response.groupBreakdown).toEqual([
      {
        fingerprint: MetricSeriesFingerprint.computeFingerprint({
          con_name: "HQ-Branch1",
        }),
        labels: { con_name: "HQ-Branch1" },
        logCount: 3,
      },
      {
        fingerprint: MetricSeriesFingerprint.computeFingerprint({
          con_name: "Branch2",
        }),
        labels: { con_name: "Branch2" },
        logCount: 1,
      },
    ]);
  });

  test("queries with the monitor's own filter, the group keys and the cap", async () => {
    await monitorLogs({
      monitorStep: stepGroupedBy([" con_name ", "con_name", "gw_name"]),
      monitorId,
      projectId,
    });

    const call: {
      query: Record<string, unknown>;
      groupByAttributes: Array<string>;
      limit: number;
      props: Record<string, unknown>;
    } = countByAttributeGroups.mock.calls[0]![0];

    // Cleaned-up keys, in order.
    expect(call.groupByAttributes).toEqual(["con_name", "gw_name"]);
    expect(call.limit).toBe(MaxEntitiesPerCriteria);
    expect(call.props).toEqual({ isRoot: true });

    // The same query the ungrouped count would run.
    expect(call.query["projectId"]).toBe(projectId);
    expect(call.query["body"]).toBeInstanceOf(Search);
    expect(call.query["attributes"]).toEqual({ log_component: "IPSec" });
    expect(call.query["time"]).toBeDefined();
  });

  test("labels a group whose logs lacked an attribute with an empty value", async () => {
    countByAttributeGroups.mockResolvedValue({
      groups: [{ values: ["HQ-Branch1", ""], count: 2 }],
      totalCount: 2,
      totalGroupCount: 1,
    });

    const response: LogMonitorResponse = await monitorLogs({
      monitorStep: stepGroupedBy(["con_name", "gw_name"]),
      monitorId,
      projectId,
    });

    expect(response.groupBreakdown![0]!.labels).toEqual({
      con_name: "HQ-Branch1",
      gw_name: "",
    });
    expect(response.groupBreakdown![0]!.fingerprint).toBe(
      MetricSeriesFingerprint.computeFingerprint({
        con_name: "HQ-Branch1",
        gw_name: "",
      }),
    );
  });

  test("returns an empty breakdown - still grouped - when no log matched", async () => {
    const response: LogMonitorResponse = await monitorLogs({
      monitorStep: stepGroupedBy(["con_name"]),
      monitorId,
      projectId,
    });

    expect(response.logCount).toBe(0);
    expect(response.groupBreakdown).toEqual([]);
  });

  test("logs a warning when the cap cut groups", async () => {
    const warnSpy: jest.SpyInstance = jest
      .spyOn(logger, "warn")
      .mockImplementation(() => {});

    try {
      countByAttributeGroups.mockResolvedValue({
        groups: Array.from(
          { length: MaxEntitiesPerCriteria },
          (_: unknown, index: number) => {
            return { values: [`tunnel-${index}`], count: 1 };
          },
        ),
        totalCount: 250,
        totalGroupCount: 250,
      });

      const response: LogMonitorResponse = await monitorLogs({
        monitorStep: stepGroupedBy(["con_name"]),
        monitorId,
        projectId,
      });

      expect(response.groupBreakdown).toHaveLength(MaxEntitiesPerCriteria);
      expect(response.totalGroupCount).toBe(250);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(String(warnSpy.mock.calls[0]![0])).toContain(
        `matched 250 groups, which is above the ${MaxEntitiesPerCriteria} per-evaluation cap`,
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  test("does not warn when every group fit", async () => {
    const warnSpy: jest.SpyInstance = jest
      .spyOn(logger, "warn")
      .mockImplementation(() => {});

    try {
      countByAttributeGroups.mockResolvedValue({
        groups: [{ values: ["HQ-Branch1"], count: 1 }],
        totalCount: 1,
        totalGroupCount: 1,
      });

      await monitorLogs({
        monitorStep: stepGroupedBy(["con_name"]),
        monitorId,
        projectId,
      });

      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe("monitorLogs - not grouped", () => {
  test.each([
    ["no group-by field (saved before it existed)", undefined],
    ["an empty group-by list", []],
    ["a group-by list of blanks", ["", "  "]],
  ])(
    "%s keeps the single count and no breakdown",
    async (_label: string, groupByAttributes: Array<string> | undefined) => {
      countBy.mockResolvedValue(new PositiveNumber(9));

      const response: LogMonitorResponse = await monitorLogs({
        monitorStep: stepGroupedBy(groupByAttributes),
        monitorId,
        projectId,
      });

      expect(countByAttributeGroups).not.toHaveBeenCalled();
      expect(countBy).toHaveBeenCalledTimes(1);
      expect(response.logCount).toBe(9);
      expect(response.groupBreakdown).toBeUndefined();
      expect(response.groupByAttributes).toBeUndefined();
    },
  );

  test("a step with no logMonitor at all still falls back to the default", async () => {
    countBy.mockResolvedValue(new PositiveNumber(2));

    const response: LogMonitorResponse = await monitorLogs({
      monitorStep: new MonitorStep(),
      monitorId,
      projectId,
    });

    expect(response.logCount).toBe(2);
    expect(countByAttributeGroups).not.toHaveBeenCalled();
  });
});
