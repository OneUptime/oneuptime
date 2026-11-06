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
import RealTimeJobs, {
  REAL_TIME_HANDOVER_MARGIN_MS,
  REAL_TIME_WINDOWED_FIRST_DELAY_MS,
  getRealTimeHandoverWindow,
  getRealTimeJobDelayInMs,
} from "../../../../../Server/Utils/SecurityEvent/RealTime/RealTimeJobs";
import ProjectSigmaRules from "../../../../../Server/Utils/SecurityEvent/Correlation/ProjectSigmaRules";
import logger from "../../../../../Server/Utils/Logger";
import { SigmaRuleReferenceResolver } from "../../../../../Types/SecurityEvent/SigmaCorrelation";
import { indexSigmaRules } from "../../../../../Utils/SecurityEvent/Sigma/SigmaRuleIndex";
import { buildSecurityEventDbRow } from "../../../../../Server/Utils/SecurityEvent/SecurityEventRow";
import {
  DETECTION_EVALUATION_DELAY_IN_SECONDS,
  DETECTION_MAX_LOOKBACK_IN_MINUTES,
} from "../../../../../Types/SecurityEvent/DetectionFindingConstants";
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
 * write) - a single rule against its detection, a correlation against
 * every rule it reads - a job queued for each rule with candidates, its
 * events in chunks, and a rule that counts in windows waiting a little
 * longer; and the job, which confirms only for a rule still on and in real
 * time, waits - twice as long each time - for events not yet readable, and
 * hands the rule's own query those events.
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
    await RealTimeDetections.screen({
      projectId: PROJECT_ID,
      rows: [event({})],
    });

    expect(findBy).toHaveBeenCalledTimes(1);
    expect(
      (findBy.mock.calls[0]![0] as { query: JSONObject; props: JSONObject })
        .query,
    ).toEqual({ projectId: PROJECT_ID, isEnabled: true, isRealTime: true });
    expect((findBy.mock.calls[0]![0] as { props: JSONObject }).props).toEqual({
      isRoot: true,
    });
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
    await RealTimeDetections.screen({
      projectId: PROJECT_ID,
      rows: [event({})],
    });

    now.mockReturnValue(
      new Date(start + REAL_TIME_RULES_CACHE_TTL_MS - 1) as never,
    );
    await RealTimeDetections.screen({
      projectId: PROJECT_ID,
      rows: [event({})],
    });
    expect(findBy).toHaveBeenCalledTimes(1);

    now.mockReturnValue(
      new Date(start + REAL_TIME_RULES_CACHE_TTL_MS) as never,
    );
    await RealTimeDetections.screen({
      projectId: PROJECT_ID,
      rows: [event({})],
    });
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

  test("a rule that no longer reads is left out, and costs the write nothing", async () => {
    const error: Spy = getJestSpyOn(logger, "error").mockImplementation((() => {
      return undefined;
    }) as never);
    findBy.mockResolvedValue([
      storedRule(RULE_ID, "detection: [not yaml"),
    ] as never);

    await expect(
      RealTimeDetections.screen({
        projectId: PROJECT_ID,
        rows: [event({ activityName: "log cleared" })],
      }),
    ).resolves.toBe(0);

    expect(addJob).not.toHaveBeenCalled();
    expect(String(error.mock.calls[0]![0])).toContain(
      `rule ${RULE_ID} could not be read`,
    );
  });

  test("reads what tells a rule that counts from one that fires on each event", async () => {
    await RealTimeDetections.screen({
      projectId: PROJECT_ID,
      rows: [event({})],
    });

    expect((findBy.mock.calls[0]![0] as { select: JSONObject }).select).toEqual(
      {
        _id: true,
        projectId: true,
        sigmaRuleYaml: true,
        matchCountThreshold: true,
        distinctCountField: true,
      },
    );
  });

  test("a correlation is screened against every rule it reads, and its job counts in windows", async () => {
    findBy.mockResolvedValue([
      storedRule(
        OTHER_RULE_ID,
        `title: Failures, then a success
correlation:
  type: temporal_ordered
  rules: [failed, succeeded]
  group-by: [principalUser]
  timespan: 10m
---
title: Failed
name: failed
detection:
  selection:
    statusName: Failure
  condition: selection
---
title: Succeeded
name: succeeded
detection:
  selection:
    statusName: Success
    principalUser: alice
  condition: selection`,
      ),
    ] as never);

    const failure: JSONObject = event({
      statusName: "Failure",
      principalUser: "bob",
    });
    const success: JSONObject = event({ statusName: "Success" });
    // A success of somebody else's matches neither rule.
    const neither: JSONObject = event({
      statusName: "Success",
      principalUser: "carol",
    });

    await expect(
      RealTimeDetections.screen({
        projectId: PROJECT_ID,
        rows: [failure, success, neither],
      }),
    ).resolves.toBe(1);

    expect(jobs()).toEqual([
      {
        projectId: PROJECT_ID.toString(),
        ruleId: OTHER_RULE_ID,
        events: [
          { id: failure["_id"], time: "2026-10-30T09:00:00.000Z" },
          { id: success["_id"], time: "2026-10-30T09:00:00.000Z" },
        ],
        attempt: 1,
        countsInWindows: true,
      },
    ]);
    // It reads what every write before its own brought: it waits longer.
    expect((addJob.mock.calls[0]![4] as { delayInMs: number }).delayInMs).toBe(
      REAL_TIME_WINDOWED_FIRST_DELAY_MS,
    );
  });

  test("a counting step's rules are screened as the step reads them", async () => {
    findBy.mockResolvedValue([
      storedRule(
        RULE_ID,
        `title: Burst
correlation:
  type: event_count
  rules: [cleared, deleted]
  group-by: [principalHost]
  timespan: 5m
  condition:
    gte: 3
---
title: Cleared
name: cleared
detection:
  selection:
    activityName|contains: cleared
  condition: selection
---
title: Deleted
name: deleted
detection:
  selection:
    activityName|contains: deleted
  condition: selection`,
      ),
    ] as never);

    await RealTimeDetections.screen({
      projectId: PROJECT_ID,
      rows: [
        event({ activityName: "log cleared" }),
        event({ activityName: "file deleted" }),
        event({ activityName: "Logon" }),
      ],
    });

    expect(jobs()).toHaveLength(1);
    expect(jobs()[0]!.events).toHaveLength(2);
    expect(jobs()[0]!.countsInWindows).toBe(true);
  });

  test("a single rule that counts - a threshold above 1, a distinct count - waits longer; one that fires on each event does not", async () => {
    const counting: DetectionRule = storedRule(RULE_ID, AUDIT_CLEARED);
    counting.matchCountThreshold = 5;
    const distinct: DetectionRule = storedRule(OTHER_RULE_ID, ROOT_SIGN_IN);
    distinct.distinctCountField = "principalHost";
    const single: DetectionRule = storedRule(
      "45454545-4545-4454-8454-454545454545",
      AUDIT_CLEARED,
    );
    single.matchCountThreshold = 1;
    single.distinctCountField = "  ";
    findBy.mockResolvedValue([counting, distinct, single] as never);

    await RealTimeDetections.screen({
      projectId: PROJECT_ID,
      rows: [
        event({ activityName: "Audit log cleared" }),
        event({ principalUser: "root" }),
      ],
    });

    expect(
      jobs().map((job: RealTimeJobData): [string, boolean] => {
        return [job.ruleId, job.countsInWindows === true];
      }),
    ).toEqual([
      [RULE_ID, true],
      [OTHER_RULE_ID, true],
      ["45454545-4545-4454-8454-454545454545", false],
    ]);
    expect(
      addJob.mock.calls.map((call: Array<unknown>): number => {
        return (call[4] as { delayInMs: number }).delayInMs;
      }),
    ).toEqual([
      REAL_TIME_WINDOWED_FIRST_DELAY_MS,
      REAL_TIME_WINDOWED_FIRST_DELAY_MS,
      REAL_TIME_FIRST_DELAY_MS,
    ]);
  });

  test("a correlation that names the project's other rules reads them, without itself, and is screened against them", async () => {
    const resolver: SigmaRuleReferenceResolver = indexSigmaRules([
      {
        id: "46464646-4646-4464-8464-464646464646",
        sigmaRuleYaml: `title: Failed sign-in
name: failed_sign_in
detection:
  selection:
    statusName: Failure
  condition: selection`,
      },
    ]);
    const load: Spy = getJestSpyOn(ProjectSigmaRules, "load").mockResolvedValue(
      resolver as never,
    );
    findBy.mockResolvedValue([
      storedRule(
        RULE_ID,
        `title: Brute force
correlation:
  type: event_count
  rules: [failed_sign_in]
  group-by: [principalIp]
  timespan: 5m
  condition:
    gte: 10`,
      ),
    ] as never);

    const failure: JSONObject = event({ statusName: "Failure" });

    await RealTimeDetections.screen({
      projectId: PROJECT_ID,
      rows: [failure, event({})],
    });

    expect(load).toHaveBeenCalledTimes(1);
    expect(load.mock.calls[0]![0]).toEqual(PROJECT_ID);
    expect(
      (load.mock.calls[0]![1] as { excludeRuleId?: ObjectID }).excludeRuleId,
    ).toEqual(new ObjectID(RULE_ID));
    expect(jobs()).toHaveLength(1);
    expect(jobs()[0]!.events).toEqual([
      { id: failure["_id"], time: "2026-10-30T09:00:00.000Z" },
    ]);
  });

  test("a rule whose YAML holds every rule it reads reads no other", async () => {
    const load: Spy = getJestSpyOn(ProjectSigmaRules, "load");

    await RealTimeDetections.screen({
      projectId: PROJECT_ID,
      rows: [event({})],
    });

    expect(load).not.toHaveBeenCalled();
  });

  test("a correlation naming a rule the project no longer has screens nothing, and says it could not be read", async () => {
    const error: Spy = getJestSpyOn(logger, "error").mockImplementation((() => {
      return undefined;
    }) as never);
    getJestSpyOn(ProjectSigmaRules, "load").mockResolvedValue(
      indexSigmaRules([]) as never,
    );
    findBy.mockResolvedValue([
      storedRule(
        RULE_ID,
        `title: Brute force
correlation:
  type: event_count
  rules: [gone]
  group-by: [principalIp]
  timespan: 5m
  condition:
    gte: 10`,
      ),
    ] as never);

    await expect(
      RealTimeDetections.screen({
        projectId: PROJECT_ID,
        rows: [event({ statusName: "Failure" })],
      }),
    ).resolves.toBe(0);

    expect(addJob).not.toHaveBeenCalled();
    expect(String(error.mock.calls[0]![0])).toContain(
      `rule ${RULE_ID} could not be read`,
    );
    // Why: the rule it names, which the project no longer has.
    expect(String(error.mock.calls[1]![0])).toContain("gone");
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
    findOneBy = getJestSpyOn(
      DetectionRuleService,
      "findOneBy",
    ).mockResolvedValue(storedRule(RULE_ID, AUDIT_CLEARED) as never);
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
    // The events themselves too: a rule that counts reads the windows they fall in.
    expect(
      (evaluateRealTime.mock.calls[0]![1] as { candidates: unknown })
        .candidates,
    ).toEqual(JOB.events);
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
    expect((addJob.mock.calls[0]![4] as { delayInMs: number }).delayInMs).toBe(
      REAL_TIME_FIRST_DELAY_MS * 4,
    );
  });

  test("a rule that counts is waited for as long again, from its own longer first wait", async () => {
    countReadable.mockResolvedValue(1 as never);

    await RealTimeDetectionJob.evaluate({
      ...JOB,
      attempt: 2,
      countsInWindows: true,
    });

    expect(addJob.mock.calls[0]![3]).toEqual({
      ...JOB,
      attempt: 3,
      countsInWindows: true,
    });
    expect((addJob.mock.calls[0]![4] as { delayInMs: number }).delayInMs).toBe(
      REAL_TIME_WINDOWED_FIRST_DELAY_MS * 4,
    );
    expect(
      [1, 2, 3, 4, 5].map((attempt: number): number => {
        return getRealTimeJobDelayInMs({ attempt });
      }),
    ).toEqual([5000, 10000, 20000, 40000, 80000]);
    expect(getRealTimeJobDelayInMs({ attempt: 1, countsInWindows: true })).toBe(
      REAL_TIME_WINDOWED_FIRST_DELAY_MS,
    );
    // A job of a rule that counts waits out the writer's batch, five seconds at most.
    expect(REAL_TIME_WINDOWED_FIRST_DELAY_MS).toBeGreaterThanOrEqual(
      REAL_TIME_FIRST_DELAY_MS + 5000,
    );
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
    // A job of a rule that counts says so; anything else is not taken for it.
    expect(
      readRealTimeJobData({ ...JOB, countsInWindows: true } as never),
    ).toEqual({ ...JOB, countsInWindows: true });
    expect(
      readRealTimeJobData({ ...JOB, countsInWindows: "true" } as never),
    ).toEqual(JOB);
  });
});

/*
 * THE HANDOVER: a rule that starts to run in real time - taken off its
 * schedule, turned back on, or created so - would miss what arrives before
 * every process has read it again, and, off its schedule, what arrived
 * since its last scheduled run. One read of that window, once its late
 * events are in, closes the gap.
 */
describe("the handover to real time", () => {
  const NOW: Date = new Date("2026-10-30T09:00:00.000Z");
  const HANDED_UNTIL: Date = new Date(
    NOW.getTime() + REAL_TIME_RULES_CACHE_TTL_MS + REAL_TIME_HANDOVER_MARGIN_MS,
  );

  test("reads from the rule's last scheduled run until every process screens for it", () => {
    const lastRun: Date = new Date("2026-10-30T08:52:00.000Z");

    expect(
      getRealTimeHandoverWindow({
        now: NOW,
        lastEvaluatedAt: lastRun,
        evaluationIntervalInMinutes: 5,
      }),
    ).toEqual({ startTime: lastRun, endTime: HANDED_UNTIL });
    // Every process has read the rule again by then.
    expect(HANDED_UNTIL.getTime() - NOW.getTime()).toBeGreaterThan(
      REAL_TIME_RULES_CACHE_TTL_MS,
    );
  });

  test("a rule that never ran reads the interval a scheduled rule's first run would", () => {
    expect(
      getRealTimeHandoverWindow({ now: NOW, evaluationIntervalInMinutes: 5 })
        .startTime,
    ).toEqual(
      new Date(
        NOW.getTime() -
          DETECTION_EVALUATION_DELAY_IN_SECONDS * 1000 -
          5 * 60000,
      ),
    );
    // No interval reads one minute.
    expect(
      getRealTimeHandoverWindow({ now: NOW, lastEvaluatedAt: null }).startTime,
    ).toEqual(
      new Date(
        NOW.getTime() - DETECTION_EVALUATION_DELAY_IN_SECONDS * 1000 - 60000,
      ),
    );
  });

  test("reads at most as far back as a run does", () => {
    expect(
      getRealTimeHandoverWindow({
        now: NOW,
        lastEvaluatedAt: new Date("2026-10-01T00:00:00.000Z"),
      }).startTime,
    ).toEqual(
      new Date(
        HANDED_UNTIL.getTime() - DETECTION_MAX_LOOKBACK_IN_MINUTES * 60000,
      ),
    );
  });

  test("is queued to run once the window's late events are in, once for each time the rule starts", async () => {
    getJestSpyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW as never);

    await RealTimeJobs.enqueueHandover({
      projectId: PROJECT_ID,
      ruleId: new ObjectID(RULE_ID),
      startTime: new Date("2026-10-30T08:52:00.000Z"),
      endTime: HANDED_UNTIL,
    });

    expect(addJob).toHaveBeenCalledTimes(1);

    const [, jobId, name, data, options] = addJob.mock.calls[0] as [
      unknown,
      string,
      string,
      RealTimeJobData,
      { delayInMs: number; attempts: number },
    ];

    expect(jobId).toBe(
      `real-time-handover-${RULE_ID}-${HANDED_UNTIL.getTime()}`,
    );
    expect(name).toBe(REAL_TIME_DETECTION_JOB);
    expect(data).toEqual({
      projectId: PROJECT_ID.toString(),
      ruleId: RULE_ID,
      events: [],
      attempt: 1,
      window: {
        startTime: "2026-10-30T08:52:00.000Z",
        endTime: HANDED_UNTIL.toISOString(),
      },
    });
    // As a scheduled run reads: its window's end, and the time late events take.
    expect(options).toEqual({
      delayInMs:
        HANDED_UNTIL.getTime() -
        NOW.getTime() +
        DETECTION_EVALUATION_DELAY_IN_SECONDS * 1000,
      attempts: 1,
    });
    expect(readRealTimeJobData(data)).toEqual(data);
  });

  test("the Worker reads every event of the window, for a rule still on and in real time", async () => {
    getJestSpyOn(DetectionRuleService, "findOneBy").mockResolvedValue(
      storedRule(RULE_ID, AUDIT_CLEARED) as never,
    );
    const countReadable: Spy = getJestSpyOn(
      RealTimeDetectionJob,
      "countReadable",
    );
    const evaluateRealTime: Spy = getJestSpyOn(
      DetectionRuleEvaluator,
      "evaluateRealTime",
    ).mockResolvedValue(null as never);

    await RealTimeDetectionJob.evaluate({
      projectId: PROJECT_ID.toString(),
      ruleId: RULE_ID,
      events: [],
      attempt: 1,
      window: {
        startTime: "2026-10-30T08:52:00.000Z",
        endTime: "2026-10-30T09:00:35.000Z",
      },
    });

    expect(countReadable).not.toHaveBeenCalled();
    expect(evaluateRealTime).toHaveBeenCalledTimes(1);
    // No ids: every event of the window.
    expect(evaluateRealTime.mock.calls[0]![1]).toEqual({
      startTime: new Date("2026-10-30T08:52:00.000Z"),
      endTime: new Date("2026-10-30T09:00:35.000Z"),
    });
  });

  test("a rule turned off, or back on its schedule, before its handover reads nothing", async () => {
    const off: DetectionRule = storedRule(RULE_ID, AUDIT_CLEARED);
    off.isEnabled = false;
    const scheduled: DetectionRule = storedRule(RULE_ID, AUDIT_CLEARED);
    scheduled.isRealTime = false;
    const findOneBy: Spy = getJestSpyOn(DetectionRuleService, "findOneBy");
    const evaluateRealTime: Spy = getJestSpyOn(
      DetectionRuleEvaluator,
      "evaluateRealTime",
    ).mockResolvedValue(null as never);

    for (const rule of [off, scheduled, null]) {
      findOneBy.mockResolvedValueOnce(rule as never);
      await RealTimeDetectionJob.evaluate({
        projectId: PROJECT_ID.toString(),
        ruleId: RULE_ID,
        events: [],
        attempt: 1,
        window: {
          startTime: "2026-10-30T08:52:00.000Z",
          endTime: "2026-10-30T09:00:35.000Z",
        },
      });
    }

    expect(evaluateRealTime).not.toHaveBeenCalled();
  });

  test("a window that is not one is read as none", () => {
    const job: JSONObject = {
      projectId: PROJECT_ID.toString(),
      ruleId: RULE_ID,
      events: [],
      attempt: 1,
    };

    for (const window of [
      {
        startTime: "2026-10-30T09:00:35.000Z",
        endTime: "2026-10-30T08:52:00.000Z",
      },
      { startTime: "never", endTime: "2026-10-30T09:00:35.000Z" },
      { startTime: 1 },
      "2026-10-30",
    ]) {
      expect(readRealTimeJobData({ ...job, window } as never)).toEqual(job);
    }
  });
});
