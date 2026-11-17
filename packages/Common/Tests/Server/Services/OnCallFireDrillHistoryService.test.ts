import OnCallDutyPolicyExecutionLog from "../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import MonitorService from "../../../Server/Services/MonitorService";
import OnCallDutyPolicyExecutionLogService from "../../../Server/Services/OnCallDutyPolicyExecutionLogService";
import OnCallFireDrillHistoryService, {
  readFailureRecord,
} from "../../../Server/Services/OnCallFireDrillHistoryService";
import OnCallTestPageService from "../../../Server/Services/OnCallTestPageService";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import { OnCallFireDrillRecord } from "../../../Types/OnCallDutyPolicy/OnCallFireDrill";
import {
  OnCallTestPageRecordKind,
  OnCallTestPageResultSummary,
  OnCallTestPageStatus,
} from "../../../Types/OnCallDutyPolicy/OnCallTestPage";
import UserNotificationEventType from "../../../Types/UserNotification/UserNotificationEventType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A MONITOR'S LAST FIRE DRILL (#9386, OnCallFireDrillHistoryService): read
 * back from its tests, which keep the drill, the monitor and the failure.
 *
 *   - Only by somebody who may read the monitor - else it is not found, as
 *     its card is not - and every one of the drill's tests, as they would
 *     read them in the policies' execution logs: one they may not read, or
 *     none at all, and there is no drill to tell of.
 *   - "Last" is the newest drill of the monitor: its tests only.
 *
 * Each read is stood in for here; OnCallFireDrillPostgres reads it on a
 * migrated Postgres, the permission rules and all.
 */

const PROJECT: ObjectID = new ObjectID("7e5b3000-0000-4000-8000-000000000001");
const MONITOR: ObjectID = new ObjectID("7e5b3000-0000-4000-8000-000000000002");
const DRILL: ObjectID = new ObjectID("7e5b3000-0000-4000-8000-000000000003");
const ANA: ObjectID = new ObjectID("7e5b3000-0000-4000-8000-0000000000a1");
const PRIMARY: ObjectID = new ObjectID("7e5b3000-0000-4000-8000-0000000000c1");
const PLATFORM: ObjectID = new ObjectID("7e5b3000-0000-4000-8000-0000000000c2");
const CRITICAL: ObjectID = new ObjectID("7e5b3000-0000-4000-8000-0000000000d1");
const RUN_1: ObjectID = new ObjectID("7e5b3000-0000-4000-8000-0000000000e1");
const RUN_2: ObjectID = new ObjectID("7e5b3000-0000-4000-8000-0000000000e2");

const READER: DatabaseCommonInteractionProps = {
  userId: ANA,
  tenantId: PROJECT,
};

function run(
  id: ObjectID,
  policyId: ObjectID,
  data: Partial<OnCallDutyPolicyExecutionLog> = {},
): OnCallDutyPolicyExecutionLog {
  const each: OnCallDutyPolicyExecutionLog = new OnCallDutyPolicyExecutionLog();

  each.id = id;
  each.createdAt = new Date("2026-11-17T09:00:00.000Z");
  each.userNotificationEventType = UserNotificationEventType.TestPage;
  each.onCallDutyPolicyId = policyId;
  each.testPageRecordKind = OnCallTestPageRecordKind.Incident;
  each.testPageSeverityId = CRITICAL;
  each.testPageWalksEscalation = false;
  each.testPageFireDrillId = DRILL;
  each.testPageFireDrillMonitorId = MONITOR;
  each.testPageFireDrillFailure = { criteriaName: "Offline" };
  each.createdByUserId = ANA;
  each.createdByUser = { name: "Ana Lopez", email: "ana@example.com" } as never;

  return Object.assign(each, data);
}

const SUMMARIES: Array<OnCallTestPageResultSummary> = [
  {
    executionLogId: RUN_1.toString(),
    policyId: PRIMARY.toString(),
    policyName: "Primary",
    status: OnCallTestPageStatus.Acknowledged,
    startedAt: "2026-11-17T09:00:00.000Z",
    endsAt: "2026-11-17T09:15:00.000Z",
    acknowledgedByName: "Ana Lopez",
  },
  {
    executionLogId: RUN_2.toString(),
    policyId: PLATFORM.toString(),
    policyName: "Platform",
    status: OnCallTestPageStatus.Ended,
    startedAt: "2026-11-17T09:00:00.000Z",
    endsAt: "2026-11-17T09:15:00.000Z",
  },
];

let readMonitor: jest.SpyInstance;
let readLatest: jest.SpyInstance;
let readRuns: jest.SpyInstance;
let summaries: jest.SpyInstance;
let severityName: jest.SpyInstance;
// The tests as the reader reads them (the reader's own read of the logs).
let readableIds: Array<ObjectID> | Error;
let tests: Array<OnCallDutyPolicyExecutionLog>;

beforeEach(() => {
  tests = [run(RUN_1, PRIMARY), run(RUN_2, PLATFORM)];
  readableIds = [RUN_1, RUN_2];

  readMonitor = jest
    .spyOn(MonitorService, "findOneBy")
    .mockResolvedValue({ id: MONITOR } as never);
  readLatest = jest
    .spyOn(OnCallDutyPolicyExecutionLogService, "findOneBy")
    .mockImplementation((async () => {
      return tests[tests.length - 1] || null;
    }) as never);
  readRuns = jest
    .spyOn(OnCallDutyPolicyExecutionLogService, "findBy")
    .mockImplementation((async (data: {
      props: DatabaseCommonInteractionProps;
    }) => {
      if (data.props.isRoot) {
        return tests;
      }

      if (readableIds instanceof Error) {
        throw readableIds;
      }

      return readableIds.map((id: ObjectID) => {
        const readable: OnCallDutyPolicyExecutionLog =
          new OnCallDutyPolicyExecutionLog();
        readable.id = id;
        return readable;
      });
    }) as never);
  summaries = jest
    .spyOn(OnCallTestPageService, "getResultSummaries")
    .mockResolvedValue(SUMMARIES as never);
  severityName = jest
    .spyOn(OnCallTestPageService, "readSeverityNameOf")
    .mockResolvedValue("Critical" as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function lastDrill(
  props: DatabaseCommonInteractionProps = READER,
): Promise<OnCallFireDrillRecord | null> {
  return await OnCallFireDrillHistoryService.getLast({
    projectId: PROJECT,
    monitorId: MONITOR,
    props: props,
  });
}

// The reads made with the reader's own permissions.
function readsAsTheReader(): Array<{ query: unknown; props: unknown }> {
  return readRuns.mock.calls
    .map((call: Array<unknown>) => {
      return call[0] as { query: unknown; props: { isRoot?: boolean } };
    })
    .filter((call: { props: { isRoot?: boolean } }): boolean => {
      return !call.props.isRoot;
    });
}

describe("what the monitor's last drill says", () => {
  test("when it ran, who ran it, the failure it rehearsed, and each policy's test", async () => {
    expect(await lastDrill()).toEqual({
      fireDrillId: DRILL.toString(),
      monitorId: MONITOR.toString(),
      startedAt: "2026-11-17T09:00:00.000Z",
      startedByName: "Ana Lopez",
      failure: {
        criteriaName: "Offline",
        recordKind: OnCallTestPageRecordKind.Incident,
        severityName: "Critical",
      },
      walksEscalation: false,
      runs: SUMMARIES,
    });
    // Each test's result is worked out as the full result works it out.
    expect(summaries).toHaveBeenCalledWith({ projectId: PROJECT, runs: tests });
    expect(severityName).toHaveBeenCalledWith(tests[0]);
  });

  test("a walked drill says so, and a declared incident's wait comes with its failure", async () => {
    tests = [
      run(RUN_1, PRIMARY, {
        testPageWalksEscalation: true,
        testPageFireDrillFailure: {
          criteriaName: "Slow",
          declaredAfterMinutes: 30,
        },
      }),
    ];

    const record: OnCallFireDrillRecord | null = await lastDrill();

    expect(record?.walksEscalation).toBe(true);
    expect(record?.failure).toEqual({
      criteriaName: "Slow",
      recordKind: OnCallTestPageRecordKind.Incident,
      severityName: "Critical",
      declaredAfterMinutes: 30,
    });
  });

  test("who ran it by their email when they have no name, and by nothing once they are gone", async () => {
    tests = [
      run(RUN_1, PRIMARY, {
        createdByUser: { email: "ana@example.com" } as never,
      }),
    ];
    expect((await lastDrill())?.startedByName).toBe("ana@example.com");

    tests = [Object.assign(run(RUN_1, PRIMARY), { createdByUser: undefined })];
    expect((await lastDrill())?.startedByName).toBe("");
  });

  test("'last' is the newest drill of the monitor: its tests only, oldest first", async () => {
    await lastDrill();

    expect(readLatest).toHaveBeenCalledWith({
      query: { projectId: PROJECT, testPageFireDrillMonitorId: MONITOR },
      select: { _id: true, testPageFireDrillId: true },
      sort: { createdAt: SortOrder.Descending },
      props: { isRoot: true },
    });
    expect(readRuns.mock.calls[0]![0]).toEqual(
      expect.objectContaining({
        query: {
          projectId: PROJECT,
          testPageFireDrillMonitorId: MONITOR,
          testPageFireDrillId: DRILL,
        },
        sort: { createdAt: SortOrder.Ascending },
        props: { isRoot: true },
      }),
    );
  });

  test("a monitor never drilled has no last drill", async () => {
    tests = [];

    expect(await lastDrill()).toBeNull();
    expect(summaries).not.toHaveBeenCalled();
  });

  test("a run that is not a test page is no test of a drill", async () => {
    tests = [
      run(RUN_1, PRIMARY, {
        userNotificationEventType: UserNotificationEventType.IncidentCreated,
      }),
    ];

    expect(await lastDrill()).toBeNull();
  });
});

describe("who may read a drill's results", () => {
  test("the monitor is read as the reader may read it: one they may not read is not found", async () => {
    readMonitor.mockResolvedValue(null as never);

    await expect(lastDrill()).rejects.toThrow(
      new BadDataException("Monitor not found."),
    );
    expect(readMonitor).toHaveBeenCalledWith({
      query: { _id: MONITOR.toString(), projectId: PROJECT },
      select: { _id: true },
      props: READER,
    });
    expect(readLatest).not.toHaveBeenCalled();
  });

  test("every test is read as the reader may read the policies' execution logs, with their own permissions", async () => {
    await lastDrill();

    expect(readsAsTheReader()).toEqual([
      expect.objectContaining({
        query: { projectId: PROJECT, _id: expect.anything() },
        props: READER,
      }),
    ]);
  });

  test("one test they may not read, and there is no drill to tell of: never the others alone", async () => {
    readableIds = [RUN_1];

    expect(await lastDrill()).toBeNull();
    expect(summaries).not.toHaveBeenCalled();
  });

  test("a reader who may read no execution log at all is told of no drill", async () => {
    readableIds = new NotAuthorizedException("You can't read these.");

    expect(await lastDrill()).toBeNull();
  });

  test("a read that fails for another reason fails the request: nothing is hidden by it", async () => {
    readableIds = new Error("Postgres is down.");

    await expect(lastDrill()).rejects.toThrow("Postgres is down.");
  });

  test("the reader who may read every test, reads it", async () => {
    expect((await lastDrill())?.runs).toEqual(SUMMARIES);
  });
});

describe("the failure a test keeps, as written", () => {
  test("the criteria's name, and a declared incident's wait", () => {
    expect(readFailureRecord({ criteriaName: "Offline" })).toEqual({
      criteriaName: "Offline",
    });
    expect(
      readFailureRecord({ criteriaName: "Slow", declaredAfterMinutes: 0 }),
    ).toEqual({ criteriaName: "Slow", declaredAfterMinutes: 0 });
  });

  test("anything else, or nothing, reads as no name and no wait", () => {
    expect(readFailureRecord(null)).toEqual({ criteriaName: "" });
    expect(readFailureRecord("Offline")).toEqual({ criteriaName: "" });
    expect(
      readFailureRecord({
        criteriaName: 7,
        declaredAfterMinutes: -1,
        title: "API is down",
      }),
    ).toEqual({ criteriaName: "" });
    expect(
      readFailureRecord({ criteriaName: "X", declaredAfterMinutes: "30" }),
    ).toEqual({ criteriaName: "X" });
  });
});

/*
 * The read rule is the monitor's and the execution logs' own, never one of
 * its own: the history reads both with the reader's props, and reads the
 * drill's tests themselves as OneUptime only to work out what to show.
 */
describe("the history reads with the reader's own permissions", () => {
  const source: string = fs
    .readFileSync(
      path.join(
        __dirname,
        "../../../Server/Services/OnCallFireDrillHistoryService.ts",
      ),
      "utf8",
    )
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  test("the monitor and the reader's read of the tests are asked with the caller's props", () => {
    expect(source).toMatch(
      /MonitorService\.findOneBy\(\{[\s\S]*?props: data\.props,/,
    );
    expect(source).toMatch(
      /OnCallDutyPolicyExecutionLogService\.findBy\(\{[\s\S]*?_id: QueryHelper\.any\(ids\),[\s\S]*?props: data\.props,/,
    );
  });
});
