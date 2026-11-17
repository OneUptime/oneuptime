import MonitorStatusTimelineService from "../../../Server/Services/MonitorStatusTimelineService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import RelationIdUtil from "../../../Server/Utils/Database/RelationIdUtil";
import MonitorStatusTimeline from "../../../Models/DatabaseModels/MonitorStatusTimeline";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import StateChangeLogScreenshots, {
  SCREENSHOTS_OMITTED_FIELD,
} from "../../../Utils/Monitor/StateChangeLogScreenshots";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * A MONITOR'S STATUS CHANGE KEEPS ITS CHECK WITHOUT A SYNTHETIC MONITOR'S
 * SCREENSHOTS (issue #6942), as an incident's and an alert's state changes
 * have since #6903.
 *
 * The check that changed a monitor's status is kept with the change
 * (MonitorStatusTimeline.statusChangeLog), and is shown only as JSON text
 * (Monitor -> Status Timeline -> View Logs), where a screenshot is pages of
 * base64. Every writer - a probe's result, an ingested resource, a status
 * set by hand or by a workflow - goes through the service's create, whose
 * onBeforeCreate leaves the screenshots out with StateChangeLogScreenshots
 * before it does anything else: the log keeps the rest, and each run that
 * had screenshots says so. The monitor's own logs keep them.
 *
 * The hook runs as the service runs it: a create without a monitor stops at
 * "monitorId is null" - after the log is cut, before anything is read.
 */

interface CreateHook {
  onBeforeCreate(createBy: CreateBy<MonitorStatusTimeline>): Promise<unknown>;
}

const hook: CreateHook = MonitorStatusTimelineService as unknown as CreateHook;

function screenshot(seed: string): string {
  return `iVBORw0KGgoAAAANSUhEUgAA${seed}`.padEnd(8192, "A");
}

// A Synthetic monitor's check, as MonitorRecordEvidence stores it.
function syntheticCheck(): JSONObject {
  return {
    monitorId: "6f000000-0000-4000-8000-000000000001",
    probeId: "6f000000-0000-4000-8000-000000000002",
    isOnline: false,
    monitoredAt: "2026-11-16T10:00:00.000Z",
    failureCause: "The checkout page did not load.",
    syntheticMonitorResponse: [
      {
        browserType: "Chromium",
        screenSizeType: "Desktop",
        executionTimeInMS: 4200,
        logMessages: ["Opened the login page", "Clicked Sign in"],
        scriptError: "Timeout 30000ms exceeded.",
        result: { step: "sign-in", ok: false },
        capturedMetrics: [{ name: "login.load", value: 4200 }],
        screenshots: {
          "login-page": screenshot("desktop-1"),
          "after-click": screenshot("desktop-2"),
        },
      },
      {
        browserType: "Firefox",
        screenSizeType: "Mobile",
        executionTimeInMS: 3900,
        logMessages: ["Opened the login page"],
        result: null,
        capturedMetrics: [],
      },
    ],
    evaluationSummary: { status: "Offline", criteria: "Is Offline" },
  };
}

function copyOf(value: JSONObject): JSONObject {
  return JSON.parse(JSON.stringify(value)) as JSONObject;
}

function runsOf(log: unknown): Array<JSONObject> {
  return (log as JSONObject)["syntheticMonitorResponse"] as Array<JSONObject>;
}

function statusChange(
  log?: JSONObject | undefined,
): CreateBy<MonitorStatusTimeline> {
  const timeline: MonitorStatusTimeline = new MonitorStatusTimeline();
  timeline.projectId = ObjectID.generate();

  if (log) {
    timeline.statusChangeLog = log;
  }

  return { data: timeline, props: { isRoot: true } };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a monitor's status change keeps its check without a Synthetic monitor's screenshots", () => {
  test("the log written with the change has the runs, not their screenshots, and the run that had some says so", async () => {
    const createBy: CreateBy<MonitorStatusTimeline> =
      statusChange(syntheticCheck());

    await expect(hook.onBeforeCreate(createBy)).rejects.toThrow(
      "monitorId is null",
    );

    const runs: Array<JSONObject> = runsOf(createBy.data.statusChangeLog);

    expect(runs[0]).not.toHaveProperty("screenshots");
    expect(runs[0]![SCREENSHOTS_OMITTED_FIELD]).toBe(true);
    // The run that had none says nothing.
    expect(runs[1]).not.toHaveProperty(SCREENSHOTS_OMITTED_FIELD);
    expect(JSON.stringify(createBy.data.statusChangeLog)).not.toContain(
      "iVBORw0KGgo",
    );
  });

  test("keeps everything else the check said: the runs' logs, errors, results and timings, and the check's own fields", async () => {
    const original: JSONObject = syntheticCheck();
    const createBy: CreateBy<MonitorStatusTimeline> = statusChange(original);

    await expect(hook.onBeforeCreate(createBy)).rejects.toThrow(
      "monitorId is null",
    );

    const expected: JSONObject = copyOf(syntheticCheck());
    delete runsOf(expected)[0]!["screenshots"];
    runsOf(expected)[0]![SCREENSHOTS_OMITTED_FIELD] = true;

    expect(createBy.data.statusChangeLog).toEqual(expected);
    // Exactly what StateChangeLogScreenshots keeps: the one rule.
    expect(createBy.data.statusChangeLog).toEqual(
      StateChangeLogScreenshots.leaveOut(syntheticCheck()),
    );
  });

  test("the check it was handed is not changed: the monitor's own logs keep the screenshots", async () => {
    const original: JSONObject = syntheticCheck();
    const before: JSONObject = copyOf(original);

    await expect(hook.onBeforeCreate(statusChange(original))).rejects.toThrow(
      "monitorId is null",
    );

    expect(original).toEqual(before);
  });

  test("a check without screenshots is kept as it came, and a change without one gains none", async () => {
    const httpCheck: JSONObject = {
      responseCode: 503,
      responseTimeInMs: 812,
      responseHeaders: { "content-type": "text/html" },
    };
    const withCheck: CreateBy<MonitorStatusTimeline> = statusChange(httpCheck);
    const withoutCheck: CreateBy<MonitorStatusTimeline> = statusChange();

    for (const createBy of [withCheck, withoutCheck]) {
      await expect(hook.onBeforeCreate(createBy)).rejects.toThrow(
        "monitorId is null",
      );
    }

    expect(withCheck.data.statusChangeLog).toBe(httpCheck);
    expect(withoutCheck.data.statusChangeLog).toBeUndefined();
  });

  test("what a Custom Code script returned is the script's, even under a key called screenshots", async () => {
    const check: JSONObject = {
      customCodeMonitorResponse: {
        result: { screenshots: { home: screenshot("custom") } },
        logMessages: [],
        executionTimeInMS: 12,
      },
    };
    const createBy: CreateBy<MonitorStatusTimeline> = statusChange(check);

    await expect(hook.onBeforeCreate(createBy)).rejects.toThrow(
      "monitorId is null",
    );

    expect(createBy.data.statusChangeLog).toBe(check);
  });

  test("the log is cut before the hook reads anything: before the monitor is even looked for", async () => {
    let logWhenMonitorRead: unknown = undefined;
    const readMonitor: SpyInstance<typeof RelationIdUtil.readIntoIdColumn> =
      jest.spyOn(RelationIdUtil, "readIntoIdColumn").mockImplementation(((
        data: Record<string, unknown>,
      ): null => {
        logWhenMonitorRead = data["statusChangeLog"];
        return null;
      }) as typeof RelationIdUtil.readIntoIdColumn);

    const createBy: CreateBy<MonitorStatusTimeline> =
      statusChange(syntheticCheck());

    await expect(hook.onBeforeCreate(createBy)).rejects.toThrow(
      "monitorId is null",
    );

    expect(readMonitor).toHaveBeenCalledTimes(1);
    expect(runsOf(logWhenMonitorRead)[0]).not.toHaveProperty("screenshots");
    expect(runsOf(logWhenMonitorRead)[0]![SCREENSHOTS_OMITTED_FIELD]).toBe(
      true,
    );
  });
});
