import DetectionRule from "../../../../../Models/DatabaseModels/DetectionRule";
import Queue from "../../../../../Server/Infrastructure/Queue";
import DetectionRuleService from "../../../../../Server/Services/DetectionRuleService";
import { TelemetryServiceMetadata } from "../../../../../Server/Services/OpenTelemetryIngestService";
import DetectionRuleEvaluator from "../../../../../Server/Utils/SecurityEvent/DetectionRuleEvaluator";
import RealTimeDetectionJob, {
  readRealTimeJobData,
} from "../../../../../Server/Utils/SecurityEvent/RealTime/RealTimeDetectionJob";
import RealTimeDetections, {
  REAL_TIME_DETECTION_JOB,
  REAL_TIME_EVENTS_PER_JOB,
  REAL_TIME_FIRST_DELAY_MS,
  REAL_TIME_MAX_ATTEMPTS,
  REAL_TIME_RULES_CACHE_TTL_MS,
  REAL_TIME_TIME_PADDING_MS,
  RealTimeJobData,
  readRowTime,
} from "../../../../../Server/Utils/SecurityEvent/RealTime/RealTimeDetections";
import { buildSecurityEventDbRow } from "../../../../../Server/Utils/SecurityEvent/SecurityEventRow";
import OneUptimeDate from "../../../../../Types/Date";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import NormalizedSecurityEvent from "../../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "../../../../../Types/SecurityEvent/OcsfSeverity";
import ServiceType from "../../../../../Types/Telemetry/ServiceType";
import { getJestSpyOn } from "../../../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import timers from "timers";

/*
 * The screen gives the event loop a turn every few hundred rows
 * (EventLoop.yieldToEventLoop, setImmediate), and Common's jest environment
 * is jsdom, which has no setImmediate: lend it Node's, as
 * MultipartFormData.test.ts does.
 */
if (
  typeof (globalThis as unknown as { setImmediate?: unknown }).setImmediate !==
  "function"
) {
  (globalThis as unknown as { setImmediate: unknown }).setImmediate =
    timers.setImmediate;
}

/*
 * Real-time detection rules, both halves: a write's rows screened against
 * the project's real-time rules (kept for half a minute, never failing the
 * write), a job queued for each rule with candidates, its events in chunks;
 * and the job, which confirms only for a rule still on and in real time,
 * waits - twice as long each time - for events not yet readable, and hands
 * the rule's own query just those events.
 */

type Spy = ReturnType<typeof getJestSpyOn>;

const PROJECT_ID: ObjectID = new ObjectID(
  "41414141-4141-4414-8414-414141414141",
);
const RULE_ID: string = "42424242-4242-4424-8424-424242424242";
const OTHER_RULE_ID: string = "43434343-4343-4434-8434-434343434343";

const SERVICE: TelemetryServiceMetadata = {
  serviceName: "Real-time fixtures",
  primaryEntityId: new ObjectID("44444444-4444-4444-8444-444444444444"),
  primaryEntityType: ServiceType.OpenTelemetry,
  dataRententionInDays: 15,
  serviceRetentionConfig: null,
  serviceRetentionInDays: null,
  projectRetentionConfig: null,
  projectRetentionInDays: 15,
};

const AUDIT_CLEARED: string = `title: Audit log cleared
level: high
detection:
  selection:
    activityName|contains: cleared
  condition: selection`;

const ROOT_SIGN_IN: string = `title: Root sign-in
level: critical
detection:
  selection:
    principalUser: root
    statusName: Success
  condition: selection`;

function event(overrides: Partial<NormalizedSecurityEvent>): JSONObject {
  return buildSecurityEventDbRow({
    normalized: {
      time: new Date("2026-10-30T09:00:00.000Z"),
      eventUid: "fixture",
      categoryUid: 3,
      categoryName: "Identity & Access Management",
      classUid: 3002,
      className: "Authentication",
      activityName: "Logon",
      severityId: 1,
      severityName: OcsfSeverity.Informational,
      statusName: "Success",
      message: "",
      vendorName: "Fixture",
      productName: "Fixture",
      ruleId: "",
      ruleName: "",
      mitreTactics: [],
      mitreTechniques: [],
      principalUser: "alice",
      principalHost: "",
      principalIp: "",
      principalProcess: "",
      processName: "",
      processPath: "",
      processCommandLine: "",
      parentProcessName: "",
      parentProcessPath: "",
      parentProcessCommandLine: "",
      targetUser: "",
      targetHost: "",
      targetIp: "",
      targetPort: 0,
      targetResource: "",
      observables: [],
      attributes: {},
      ...overrides,
    },
    projectId: PROJECT_ID,
    serviceMetadata: SERVICE,
    retentionDays: 15,
  });
}

function storedRule(id: string, sigmaRuleYaml: string): DetectionRule {
  const rule: DetectionRule = new DetectionRule();
  rule._id = id;
  rule.projectId = PROJECT_ID;
  rule.sigmaRuleYaml = sigmaRuleYaml;
  rule.isEnabled = true;
  rule.isRealTime = true;
  return rule;
}

let findBy: Spy;
let addJob: Spy;

beforeEach(() => {
  RealTimeDetections.clearCache();
  findBy = getJestSpyOn(DetectionRuleService, "findBy").mockResolvedValue([
    storedRule(RULE_ID, AUDIT_CLEARED),
    storedRule(OTHER_RULE_ID, ROOT_SIGN_IN),
  ] as never);
  addJob = getJestSpyOn(Queue, "addJob").mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
  RealTimeDetections.clearCache();
});

function jobs(): Array<RealTimeJobData> {
  return addJob.mock.calls.map((call: Array<unknown>): RealTimeJobData => {
    return call[3] as RealTimeJobData;
  });
}

describe("RealTimeDetections.screen: a write's half", () => {
  test("reads the project's enabled real-time rules, as OneUptime", async () => {
    await RealTimeDetections.screen({ projectId: PROJECT_ID, rows: [event({})] });

    expect(findBy).toHaveBeenCalledTimes(1);
    expect(
      (findBy.mock.calls[0]![0] as { query: JSONObject; props: JSONObject })
        .query,
    ).toEqual({ projectId: PROJECT_ID, isEnabled: true, isRealTime: true });
    expect(
      (findBy.mock.calls[0]![0] as { props: JSONObject }).props,
    ).toEqual({ isRoot: true });
  });

  test("queues a confirming job for each rule some events may match, naming those events and when they happened", async () => {
    const cleared: JSONObject = event({
      activityName: "Audit log cleared",
      time: new Date("2026-10-30T09:00:01.000Z"),
    });
    const root: JSONObject = event({
      principalUser: "ROOT",
      time: new Date("2026-10-30T09:00:02.000Z"),
    });
    const quiet: JSONObject = event({});

    const queued: number = await RealTimeDetections.screen({
      projectId: PROJECT_ID,
      rows: [cleared, root, quiet],
    });

    expect(queued).toBe(2);
    expect(jobs()).toEqual([
      {
        projectId: PROJECT_ID.toString(),
        ruleId: RULE_ID,
        events: [{ id: cleared["_id"], time: "2026-10-30T09:00:01.000Z" }],
        attempt: 1,
      },
      {
        projectId: PROJECT_ID.toString(),
        ruleId: OTHER_RULE_ID,
        events: [{ id: root["_id"], time: "2026-10-30T09:00:02.000Z" }],
        attempt: 1,
      },
    ]);

    const options: { delayInMs: number; attempts: number } = addJob.mock
      .calls[0]![4] as { delayInMs: number; attempts: number };

    expect(addJob.mock.calls[0]![2]).toBe(REAL_TIME_DETECTION_JOB);
    expect(options).toEqual({
      delayInMs: REAL_TIME_FIRST_DELAY_MS,
      attempts: 1,
    });
    // A job id of its own: the rule, the first event and the attempt.
    expect(addJob.mock.calls[0]![1]).toBe(
      `real-time-detection-${RULE_ID}-${String(cleared["_id"])}-1`,
    );
  });

  test("queues nothing when no event may match", async () => {
    await expect(
      RealTimeDetections.screen({
        projectId: PROJECT_ID,
        rows: [event({}), event({ principalUser: "bob" })],
      }),
    ).resolves.toBe(0);
    expect(addJob).not.toHaveBeenCalled();
  });

  test("hands a rule's candidates over in jobs of at most 500 events", async () => {
    const rows: Array<JSONObject> = [];

    for (let index: number = 0; index < REAL_TIME_EVENTS_PER_JOB + 3; index++) {
      rows.push(event({ activityName: "log cleared" }));
    }

    await RealTimeDetections.screen({ projectId: PROJECT_ID, rows });

    expect(
      jobs().map((job: RealTimeJobData): number => {
        return job.events.length;
      }),
    ).toEqual([REAL_TIME_EVENTS_PER_JOB, 3]);
  });

  test("keeps a project's rules for half a minute, then reads them again", async () => {
    const now: Spy = getJestSpyOn(OneUptimeDate, "getCurrentDate");
    const start: number = new Date("2026-10-30T09:00:00.000Z").getTime();

    now.mockReturnValue(new Date(start) as never);
    await RealTimeDetections.screen({ projectId: PROJECT_ID, rows: [event({})] });

    now.mockReturnValue(
      new Date(start + REAL_TIME_RULES_CACHE_TTL_MS - 1) as never,
    );
    await RealTimeDetections.screen({ projectId: PROJECT_ID, rows: [event({})] });
    expect(findBy).toHaveBeenCalledTimes(1);

    now.mockReturnValue(new Date(start + REAL_TIME_RULES_CACHE_TTL_MS) as never);
    await RealTimeDetections.screen({ projectId: PROJECT_ID, rows: [event({})] });
    expect(findBy).toHaveBeenCalledTimes(2);
    expect(REAL_TIME_RULES_CACHE_TTL_MS).toBe(30 * 1000);
  });

  test("a project with no real-time rule is remembered as such, and costs no read per write", async () => {
    findBy.mockResolvedValue([] as never);

    for (let write: number = 0; write < 5; write++) {
      await RealTimeDetections.screen({
        projectId: PROJECT_ID,
        rows: [event({ activityName: "log cleared" })],
      });
    }

    expect(findBy).toHaveBeenCalledTimes(1);
    expect(addJob).not.toHaveBeenCalled();
  });

  test("writes that arrive together read the project's rules once", async () => {
    await Promise.all([
      RealTimeDetections.screen({ projectId: PROJECT_ID, rows: [event({})] }),
      RealTimeDetections.screen({ projectId: PROJECT_ID, rows: [event({})] }),
      RealTimeDetections.screen({ projectId: PROJECT_ID, rows: [event({})] }),
    ]);

    expect(findBy).toHaveBeenCalledTimes(1);
  });

  test("a rule that no longer reads, or reads events together, is left to the schedule", async () => {
    findBy.mockResolvedValue([
      storedRule(RULE_ID, "detection: [not yaml"),
      storedRule(
        OTHER_RULE_ID,
        `title: Many
correlation:
  type: event_count
  rules: [a]
  timespan: 5m
  condition:
    gte: 3
---
title: A
name: a
detection:
  selection:
    activityName|contains: cleared
  condition: selection`,
      ),
    ] as never);

    await RealTimeDetections.screen({
      projectId: PROJECT_ID,
      rows: [event({ activityName: "log cleared" })],
    });

    expect(addJob).not.toHaveBeenCalled();
  });

  test("never fails the write: a read or a queue that fails is logged, nothing more", async () => {
    findBy.mockRejectedValue(new Error("Postgres is down") as never);

    await expect(
      RealTimeDetections.screen({ projectId: PROJECT_ID, rows: [event({})] }),
    ).resolves.toBe(0);

    RealTimeDetections.clearCache();
    findBy.mockResolvedValue([storedRule(RULE_ID, AUDIT_CLEARED)] as never);
    addJob.mockRejectedValue(new Error("Redis is down") as never);

    await expect(
      RealTimeDetections.screen({
        projectId: PROJECT_ID,
        rows: [event({ activityName: "log cleared" })],
      }),
    ).resolves.toBe(0);
  });

  test("an empty write reads nothing", async () => {
    await expect(
      RealTimeDetections.screen({ projectId: PROJECT_ID, rows: [] }),
    ).resolves.toBe(0);
    expect(findBy).not.toHaveBeenCalled();
  });

  test("reads a row's time as it is written for ClickHouse", () => {
    expect(readRowTime("2026-10-30 09:00:01.250")?.toISOString()).toBe(
      "2026-10-30T09:00:01.250Z",
    );
    expect(readRowTime("2026-10-30T09:00:01.000Z")?.toISOString()).toBe(
      "2026-10-30T09:00:01.000Z",
    );
    expect(readRowTime("")).toBeNull();
    expect(readRowTime("not a time")).toBeNull();
    expect(readRowTime(42)).toBeNull();
  });
});

describe("RealTimeDetectionJob: the worker's half", () => {
  const JOB: RealTimeJobData = {
    projectId: PROJECT_ID.toString(),
    ruleId: RULE_ID,
    events: [
      { id: "row-1", time: "2026-10-30T09:00:01.000Z" },
      { id: "row-2", time: "2026-10-30T09:00:05.000Z" },
    ],
    attempt: 1,
  };

  let findOneBy: Spy;
  let countReadable: Spy;
  let evaluateRealTime: Spy;

  beforeEach(() => {
    findOneBy = getJestSpyOn(DetectionRuleService, "findOneBy").mockResolvedValue(
      storedRule(RULE_ID, AUDIT_CLEARED) as never,
    );
    countReadable = getJestSpyOn(
      RealTimeDetectionJob,
      "countReadable",
    ).mockResolvedValue(2 as never);
    evaluateRealTime = getJestSpyOn(
      DetectionRuleEvaluator,
      "evaluateRealTime",
    ).mockResolvedValue(null as never);
  });

  test("confirms the events with the rule's own query, restricted to them, over the times they happened", async () => {
    await RealTimeDetectionJob.evaluate(JOB);

    expect(
      (findOneBy.mock.calls[0]![0] as { query: JSONObject }).query,
    ).toEqual({ _id: RULE_ID, projectId: PROJECT_ID });
    expect(evaluateRealTime).toHaveBeenCalledTimes(1);

    const run: {
      restrictTo: { query: string; query_params: JSONObject };
      startTime: Date;
      endTime: Date;
    } = evaluateRealTime.mock.calls[0]![1] as never;

    expect(run.startTime.toISOString()).toBe(
      new Date(
        new Date("2026-10-30T09:00:01.000Z").getTime() -
          REAL_TIME_TIME_PADDING_MS,
      ).toISOString(),
    );
    expect(run.endTime.toISOString()).toBe(
      new Date(
        new Date("2026-10-30T09:00:05.000Z").getTime() +
          REAL_TIME_TIME_PADDING_MS,
      ).toISOString(),
    );
    // Restricted by the rows' ids, bound as one parameter.
    expect(run.restrictTo.query).toContain("_id IN {");
    expect(Object.values(run.restrictTo.query_params)).toEqual([
      ["row-1", "row-2"],
    ]);
  });

  test("a rule turned off, back on its schedule, or gone confirms nothing", async () => {
    const off: DetectionRule = storedRule(RULE_ID, AUDIT_CLEARED);
    off.isEnabled = false;
    const scheduled: DetectionRule = storedRule(RULE_ID, AUDIT_CLEARED);
    scheduled.isRealTime = false;

    for (const rule of [off, scheduled, null]) {
      findOneBy.mockResolvedValueOnce(rule as never);
      await RealTimeDetectionJob.evaluate(JOB);
    }

    expect(evaluateRealTime).not.toHaveBeenCalled();
    expect(countReadable).not.toHaveBeenCalled();
  });

  test("events not readable yet are waited for again, twice as long each time", async () => {
    countReadable.mockResolvedValue(1 as never);

    await RealTimeDetectionJob.evaluate({ ...JOB, attempt: 2 });

    expect(evaluateRealTime).not.toHaveBeenCalled();
    expect(addJob).toHaveBeenCalledTimes(1);
    expect(addJob.mock.calls[0]![3]).toEqual({ ...JOB, attempt: 3 });
    expect(
      (addJob.mock.calls[0]![4] as { delayInMs: number }).delayInMs,
    ).toBe(REAL_TIME_FIRST_DELAY_MS * 4);
  });

  test("after the last attempt, what can be read is confirmed; nothing readable confirms nothing", async () => {
    countReadable.mockResolvedValueOnce(1 as never);
    await RealTimeDetectionJob.evaluate({
      ...JOB,
      attempt: REAL_TIME_MAX_ATTEMPTS,
    });

    expect(evaluateRealTime).toHaveBeenCalledTimes(1);
    expect(addJob).not.toHaveBeenCalled();

    countReadable.mockResolvedValueOnce(0 as never);
    await RealTimeDetectionJob.evaluate({
      ...JOB,
      attempt: REAL_TIME_MAX_ATTEMPTS,
    });

    expect(evaluateRealTime).toHaveBeenCalledTimes(1);
  });

  test("a job with no events does nothing", async () => {
    await RealTimeDetectionJob.evaluate({ ...JOB, events: [] });

    expect(findOneBy).not.toHaveBeenCalled();
  });

  test("reads a job defensively: one of an older shape, or a broken one, names nothing", () => {
    expect(readRealTimeJobData(JOB as unknown as JSONObject)).toEqual(JOB);
    expect(readRealTimeJobData(null)).toBeNull();
    expect(
      readRealTimeJobData({ ...JOB, projectId: "project-1" } as never),
    ).toBeNull();
    expect(readRealTimeJobData({ ...JOB, ruleId: 7 } as never)).toBeNull();
    expect(
      readRealTimeJobData({
        ...JOB,
        events: [
          { id: "row-1", time: "2026-10-30T09:00:01.000Z" },
          { id: "", time: "2026-10-30T09:00:01.000Z" },
          { id: "row-3", time: "never" },
          "row-4",
        ],
        attempt: "x",
      } as never),
    ).toEqual({
      ...JOB,
      events: [{ id: "row-1", time: "2026-10-30T09:00:01.000Z" }],
      attempt: 1,
    });
  });
});
