import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorStepLogMonitor, {
  MonitorStepLogMonitorUtil,
} from "Common/Types/Monitor/MonitorStepLogMonitor";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import ObjectID from "Common/Types/ObjectID";
import PositiveNumber from "Common/Types/PositiveNumber";
import LogMonitorResponse from "Common/Types/Monitor/LogMonitor/LogMonitorResponse";
import MetricSeriesFingerprint from "Common/Utils/Metrics/MetricSeriesFingerprint";
import { describe, expect, test, beforeEach } from "@jest/globals";

/*
 * The worker half of Resolved By: a grouped Logs monitor that names the
 * log which resolves a group - "interface.down" per interface, resolved by
 * "interface.up" - asks LogService for the groups still open and the ones
 * a log has closed, and hands the criteria both: a breakdown of only the
 * open groups, and the resolved ones beside it under the fingerprints
 * their alerts were opened with.
 *
 * A monitor that names no resolving log takes exactly the path it always
 * did.
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
    default: {
      countBy: jest.fn(),
      countByAttributeGroups: jest.fn(),
      countUnresolvedAttributeGroups: jest.fn(),
    },
  };
});

import LogService from "Common/Server/Services/LogService";
import logger from "Common/Server/Utils/Logger";
import { MaxEntitiesPerCriteria } from "Common/Server/Utils/Monitor/PerEntityCriteriaFanOut";
import {
  MaxResolvedLogGroupsPerEvaluation,
  monitorLogs,
} from "../../../../FeatureSet/Workers/Jobs/TelemetryMonitor/MonitorTelemetryMonitor";

const countBy: jest.Mock = LogService.countBy as unknown as jest.Mock;
const countByAttributeGroups: jest.Mock =
  LogService.countByAttributeGroups as unknown as jest.Mock;
const countUnresolvedAttributeGroups: jest.Mock =
  LogService.countUnresolvedAttributeGroups as unknown as jest.Mock;

const monitorId: ObjectID = ObjectID.generate();
const projectId: ObjectID = ObjectID.generate();

const GROUP_BY: Array<string> = [
  "networkDevice.name",
  "network.interface.name",
];

function stepWith(overrides: Partial<MonitorStepLogMonitor>): MonitorStep {
  const step: MonitorStep = new MonitorStep();

  step.data = {
    id: ObjectID.generate().toString(),
  } as unknown as MonitorStep["data"];
  step.data!.logMonitor = {
    ...MonitorStepLogMonitorUtil.getDefault(),
    attributes: { "event.domain": "network", "event.name": "interface.down" },
    lastXSecondsOfLogs: 300,
    groupByAttributes: GROUP_BY,
    resolvedByAttributes: {
      "event.domain": "network",
      "event.name": "interface.up",
    },
    ...overrides,
  };

  return step;
}

function fingerprintOf(device: string, networkInterface: string): string {
  return MetricSeriesFingerprint.computeFingerprint({
    "networkDevice.name": device,
    "network.interface.name": networkInterface,
  });
}

beforeEach(() => {
  countBy.mockReset().mockResolvedValue(new PositiveNumber(0));
  countByAttributeGroups.mockReset().mockResolvedValue({
    groups: [],
    totalCount: 0,
    totalGroupCount: 0,
  });
  countUnresolvedAttributeGroups.mockReset().mockResolvedValue({
    groups: [],
    resolvedGroups: [],
    totalCount: 0,
    totalGroupCount: 0,
  });
});

describe("monitorLogs - groups resolved by a log", () => {
  test("judges the open groups, and names the resolved ones beside them", async () => {
    countUnresolvedAttributeGroups.mockResolvedValue({
      groups: [
        { values: ["sw1", "Gi0/2"], count: 2 },
        { values: ["sw2", "Gi0/1"], count: 1 },
      ],
      resolvedGroups: [
        ["sw1", "Gi0/1"],
        ["sw2", "Gi0/9"],
      ],
      totalCount: 3,
      totalGroupCount: 2,
    });

    const response: LogMonitorResponse = await monitorLogs({
      monitorStep: stepWith({}),
      monitorId: monitorId,
      projectId: projectId,
    });

    expect(response.logCount).toBe(3);
    expect(response.groupByAttributes).toEqual(GROUP_BY);
    expect(response.totalGroupCount).toBe(2);
    expect(response.groupBreakdown).toEqual([
      {
        fingerprint: fingerprintOf("sw1", "Gi0/2"),
        labels: {
          "networkDevice.name": "sw1",
          "network.interface.name": "Gi0/2",
        },
        logCount: 2,
      },
      {
        fingerprint: fingerprintOf("sw2", "Gi0/1"),
        labels: {
          "networkDevice.name": "sw2",
          "network.interface.name": "Gi0/1",
        },
        logCount: 1,
      },
    ]);
    expect(response.resolvedGroups).toEqual([
      {
        fingerprint: fingerprintOf("sw1", "Gi0/1"),
        labels: {
          "networkDevice.name": "sw1",
          "network.interface.name": "Gi0/1",
        },
        logCount: 0,
      },
      {
        fingerprint: fingerprintOf("sw2", "Gi0/9"),
        labels: {
          "networkDevice.name": "sw2",
          "network.interface.name": "Gi0/9",
        },
        logCount: 0,
      },
    ]);

    expect(countBy).not.toHaveBeenCalled();
    expect(countByAttributeGroups).not.toHaveBeenCalled();
  });

  test("a resolved group carries the fingerprint the same group's alert was opened under", async () => {
    /*
     * The alert was opened on an evaluation where the group was open; it
     * is resolved on a later one where the group is resolved. The two
     * fingerprints must be the same value, or nothing is ever closed.
     */
    countUnresolvedAttributeGroups.mockResolvedValueOnce({
      groups: [{ values: ["sw1", "Gi0/1"], count: 1 }],
      resolvedGroups: [],
      totalCount: 1,
      totalGroupCount: 1,
    });

    const opened: LogMonitorResponse = await monitorLogs({
      monitorStep: stepWith({}),
      monitorId: monitorId,
      projectId: projectId,
    });

    countUnresolvedAttributeGroups.mockResolvedValueOnce({
      groups: [],
      resolvedGroups: [["sw1", "Gi0/1"]],
      totalCount: 0,
      totalGroupCount: 0,
    });

    const resolved: LogMonitorResponse = await monitorLogs({
      monitorStep: stepWith({}),
      monitorId: monitorId,
      projectId: projectId,
    });

    expect(resolved.resolvedGroups?.[0]?.fingerprint).toBe(
      opened.groupBreakdown?.[0]?.fingerprint,
    );
    expect(resolved.groupBreakdown).toEqual([]);
    expect(resolved.logCount).toBe(0);
  });

  test("asks for both kinds of log in the same window and project, with the caps of each side", async () => {
    const until: Date = new Date("2026-10-13T10:05:00.000Z");

    await monitorLogs({
      monitorStep: stepWith({ body: "down", lastXSecondsOfLogs: 300 }),
      monitorId: monitorId,
      projectId: projectId,
      evaluateUntil: until,
    });

    expect(countUnresolvedAttributeGroups).toHaveBeenCalledTimes(1);

    const call: {
      query: Record<string, unknown>;
      resolvedByQuery: Record<string, unknown>;
      groupByAttributes: Array<string>;
      limit: number;
      resolvedLimit: number;
      props: Record<string, unknown>;
    } = countUnresolvedAttributeGroups.mock.calls[0]![0];

    expect(call.groupByAttributes).toEqual(GROUP_BY);
    expect(call.limit).toBe(MaxEntitiesPerCriteria);
    expect(call.resolvedLimit).toBe(MaxResolvedLogGroupsPerEvaluation);
    expect(call.props).toEqual({ isRoot: true });

    expect(call.query["attributes"]).toEqual({
      "event.domain": "network",
      "event.name": "interface.down",
    });
    expect(call.resolvedByQuery["attributes"]).toEqual({
      "event.domain": "network",
      "event.name": "interface.up",
    });

    // The same project and the same window on both sides.
    expect(call.query["projectId"]).toBe(projectId);
    expect(call.resolvedByQuery["projectId"]).toBe(projectId);

    const window: InBetween<Date> = call.query["time"] as InBetween<Date>;

    expect(window.endValue).toEqual(until);
    expect(window.startValue).toEqual(new Date("2026-10-13T10:00:00.000Z"));
    expect(call.resolvedByQuery["time"]).toEqual(call.query["time"]);

    // The text filter describes the problem, not the recovery.
    expect(call.query["body"]).toBeDefined();
    expect(call.resolvedByQuery["body"]).toBeUndefined();
  });

  test("far more resolved groups are acted on than breaching ones: a switch coming back brings every port up at once", () => {
    expect(MaxResolvedLogGroupsPerEvaluation).toBe(5000);
    expect(MaxResolvedLogGroupsPerEvaluation).toBeGreaterThan(
      MaxEntitiesPerCriteria * 10,
    );
  });

  test("an empty answer still says the monitor is resolved by a log: both lists are there, empty", async () => {
    const response: LogMonitorResponse = await monitorLogs({
      monitorStep: stepWith({}),
      monitorId: monitorId,
      projectId: projectId,
    });

    /*
     * Their presence is the signal: the evaluation must not resolve a
     * quiet group, and an absent `resolvedGroups` would read as a monitor
     * whose groups resolve when their logs stop.
     */
    expect(response.groupBreakdown).toEqual([]);
    expect(response.resolvedGroups).toEqual([]);
    expect(response.logCount).toBe(0);
  });

  test("warns when more groups are open than one evaluation judges", async () => {
    const warn: jest.SpyInstance = jest
      .spyOn(logger, "warn")
      .mockImplementation(() => {
        return undefined as never;
      });

    countUnresolvedAttributeGroups.mockResolvedValue({
      groups: [{ values: ["sw1", "Gi0/1"], count: 4 }],
      resolvedGroups: [],
      totalCount: 900,
      totalGroupCount: 450,
    });

    await monitorLogs({
      monitorStep: stepWith({}),
      monitorId: monitorId,
      projectId: projectId,
    });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain(
      `matched 450 groups, which is above the ${MaxEntitiesPerCriteria} per-evaluation cap`,
    );

    warn.mockRestore();
  });

  test("a failed query fails the evaluation: nothing is resolved or opened on a guess", async () => {
    countUnresolvedAttributeGroups.mockRejectedValue(
      new Error("Timeout exceeded"),
    );

    await expect(
      monitorLogs({
        monitorStep: stepWith({}),
        monitorId: monitorId,
        projectId: projectId,
      }),
    ).rejects.toThrow("Timeout exceeded");
  });
});

describe("monitorLogs - monitors that name no resolving log are untouched", () => {
  test("a grouped monitor with Resolved By left empty takes the plain grouped count", async () => {
    for (const resolvedByAttributes of [
      {},
      undefined,
      { "event.name": "   " },
    ]) {
      countByAttributeGroups.mockClear();

      const response: LogMonitorResponse = await monitorLogs({
        monitorStep: stepWith({
          resolvedByAttributes: resolvedByAttributes as
            | Record<string, string>
            | undefined,
        }),
        monitorId: monitorId,
        projectId: projectId,
      });

      expect(countByAttributeGroups).toHaveBeenCalledTimes(1);
      // Absent: its groups resolve when their logs stop, as they always have.
      expect(Object.keys(response)).not.toContain("resolvedGroups");
    }

    expect(countUnresolvedAttributeGroups).not.toHaveBeenCalled();
  });

  test("a monitor that is not grouped ignores Resolved By and counts every log together", async () => {
    countBy.mockResolvedValue(new PositiveNumber(7));

    const response: LogMonitorResponse = await monitorLogs({
      monitorStep: stepWith({ groupByAttributes: [] }),
      monitorId: monitorId,
      projectId: projectId,
    });

    expect(response.logCount).toBe(7);
    expect(Object.keys(response)).not.toContain("resolvedGroups");
    expect(Object.keys(response)).not.toContain("groupBreakdown");
    expect(countUnresolvedAttributeGroups).not.toHaveBeenCalled();
    expect(countByAttributeGroups).not.toHaveBeenCalled();
  });
});
