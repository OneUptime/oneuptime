/*
 * A real-time run of a detection rule (DetectionRuleEvaluator, realTime):
 * the rule's own query, restricted to the events ingest screened for it,
 * over the times they happened - however old - doing what a scheduled run
 * does with what matches (an alert, a finding, a case, risk), saying how it
 * went on the rule, and leaving its schedule as it was. A rule that counts,
 * and a correlation, read the window of their interval each write's events
 * fall in instead, as the write found it, one run a window; a failure is
 * the rule's Last Error, never its schedule.
 */

// The alert path pulls the isolated-vm addon through its template renderer: stub it out.
jest.mock("isolated-vm", () => {
  return {};
});

import DetectionRuleEvaluator, {
  DETECTION_RULE_REAL_TIME_SELECT,
  DetectionRuleCountWindow,
  DetectionRuleEvaluationResult,
  getDetectionRuleCountWindows,
} from "../../../../Server/Utils/SecurityEvent/DetectionRuleEvaluator";
import CorrelationRuleMatcher, {
  CorrelationRuleMatchInput,
} from "../../../../Server/Utils/SecurityEvent/Correlation/CorrelationRuleMatcher";
import OneUptimeDate from "../../../../Types/Date";
import DetectionRule from "../../../../Models/DatabaseModels/DetectionRule";
import Alert from "../../../../Models/DatabaseModels/Alert";
import AlertSeverity from "../../../../Models/DatabaseModels/AlertSeverity";
import AlertService from "../../../../Server/Services/AlertService";
import AlertSeverityService from "../../../../Server/Services/AlertSeverityService";
import DetectionRuleService from "../../../../Server/Services/DetectionRuleService";
import DetectionRuleExceptionService from "../../../../Server/Services/DetectionRuleExceptionService";
import SecurityEventService, {
  DetectionMatchGroup,
  FindDetectionMatchesData,
} from "../../../../Server/Services/SecurityEventService";
import OTelIngestService, {
  TelemetryServiceMetadata,
} from "../../../../Server/Services/OpenTelemetryIngestService";
import logger from "../../../../Server/Utils/Logger";
import SecurityCaseIngest from "../../../../Server/Utils/SecurityCase/SecurityCaseIngest";
import SecurityEntityRiskRecorder from "../../../../Server/Utils/SecurityEvent/EntityRisk/SecurityEntityRiskRecorder";
import {
  SQL,
  Statement,
} from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import TableColumnType from "../../../../Types/AnalyticsDatabase/TableColumnType";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import ServiceType from "../../../../Types/Telemetry/ServiceType";
import { getJestSpyOn } from "../../../Spy";
import { mockProjectStates } from "../../TestingUtils/Services/ProjectStatesHelper";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

type Spy = ReturnType<typeof getJestSpyOn>;

const RULE_ID: ObjectID = new ObjectID("51515151-5151-4515-8515-515151515151");
const PROJECT_ID: ObjectID = new ObjectID(
  "52525252-5252-4525-8525-525252525252",
);

const SERVICE_METADATA: TelemetryServiceMetadata = {
  serviceName: "OneUptime Detections",
  primaryEntityId: new ObjectID("53535353-5353-4535-8535-535353535353"),
  primaryEntityType: ServiceType.OpenTelemetry,
  dataRententionInDays: 15,
  serviceRetentionConfig: null,
  serviceRetentionInDays: null,
  projectRetentionConfig: null,
  projectRetentionInDays: 15,
};

const SINGLE: string = `title: Root sign-in
level: critical
detection:
  selection:
    principalUser: root
    statusName: Success
  condition: selection`;

const CORRELATION: string = `title: Many failures
correlation:
  type: event_count
  rules: [failure]
  group-by: [principalIp]
  timespan: 5m
  condition:
    gte: 10
---
title: Failure
name: failure
detection:
  selection:
    statusName: Failure
  condition: selection`;

// Three hours ago and a little after: real time takes events whenever they happened.
const START: Date = new Date(Date.now() - 3 * 60 * 60 * 1000);
const END: Date = new Date(START.getTime() + 4000);

function rule(sigmaRuleYaml: string = SINGLE): DetectionRule {
  const model: DetectionRule = new DetectionRule();
  model._id = RULE_ID.toString();
  model.projectId = PROJECT_ID;
  model.name = "Root sign-in";
  model.sigmaRuleYaml = sigmaRuleYaml;
  model.evaluationIntervalInMinutes = 5;
  model.groupByField = "principalUser";
  model.matchCountThreshold = 1;
  model.isEnabled = true;
  model.isRealTime = true;
  model.lastEvaluatedAt = new Date("2026-10-01T00:00:00.000Z");
  return model;
}

function restriction(): Statement {
  return SQL`_id IN ${{ type: TableColumnType.ArrayText, value: ["row-1", "row-2"] }}`;
}

let findDetectionMatches: Spy;
let updateOneById: Spy;
let recordDetections: Spy;
let recordRisk: Spy;

beforeEach(() => {
  getJestSpyOn(logger, "error").mockImplementation((() => {
    return undefined;
  }) as never);
  getJestSpyOn(logger, "warn").mockImplementation((() => {
    return undefined;
  }) as never);
  mockProjectStates();

  findDetectionMatches = getJestSpyOn(
    SecurityEventService,
    "findDetectionMatches",
  ).mockResolvedValue([
    {
      groupValue: "root",
      matchCount: 1,
      distinctCount: 0,
      sampleMessage: "root signed in",
      sampleObservables: ["root"],
    },
  ] as Array<DetectionMatchGroup> as never);
  getJestSpyOn(SecurityEventService, "insertJsonRows").mockResolvedValue(
    undefined as never,
  );
  getJestSpyOn(AlertService, "findBy").mockResolvedValue([] as never);
  getJestSpyOn(AlertService, "create").mockResolvedValue(new Alert() as never);
  // The project's one alert severity, which the rule's critical level takes.
  const severity: AlertSeverity = new AlertSeverity();
  severity._id = "54545454-5454-4545-8545-545454545454";
  severity.name = "Critical";
  getJestSpyOn(AlertSeverityService, "findBy").mockResolvedValue([
    severity,
  ] as never);
  getJestSpyOn(OTelIngestService, "telemetryServiceFromName").mockResolvedValue(
    SERVICE_METADATA as never,
  );
  getJestSpyOn(DetectionRuleExceptionService, "findAllBy").mockResolvedValue(
    [] as never,
  );
  updateOneById = getJestSpyOn(
    DetectionRuleService,
    "updateOneById",
  ).mockResolvedValue(undefined as never);
  recordDetections = getJestSpyOn(
    SecurityCaseIngest,
    "recordDetections",
  ).mockResolvedValue({
    casesOpened: 1,
    detectionsAdded: 1,
    detectionsRepeated: 0,
  } as never);
  recordRisk = getJestSpyOn(
    SecurityEntityRiskRecorder,
    "record",
  ).mockResolvedValue({ entitiesUpdated: 1, riskCasesRaised: 0 } as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a real-time run", () => {
  test("reads only the events it was handed, over the times they happened, however old", async () => {
    await DetectionRuleEvaluator.evaluateRule(rule(), {
      realTime: { restrictTo: restriction(), startTime: START, endTime: END },
    });

    const read: FindDetectionMatchesData = findDetectionMatches.mock
      .calls[0]![0] as FindDetectionMatchesData;
    const where: { query: string; query_params: JSONObject } =
      read.whereFragment as unknown as {
        query: string;
        query_params: JSONObject;
      };

    expect(read.startTime.toISOString()).toBe(START.toISOString());
    expect(read.endTime.toISOString()).toBe(END.toISOString());
    expect(where.query).toContain("_id IN {");
    expect(Object.values(where.query_params)).toContainEqual([
      "row-1",
      "row-2",
    ]);
    // One match fires: a real-time rule waits for no count.
    expect(read.minMatchCount).toBe(1);
  });

  test("does what a scheduled run does with a match: an alert, a finding, a case, risk", async () => {
    const result: DetectionRuleEvaluationResult =
      await DetectionRuleEvaluator.evaluateRule(rule(), {
        realTime: { restrictTo: restriction(), startTime: START, endTime: END },
      });

    expect(result.alertsCreated).toBe(1);
    expect(result.findingsWritten).toBe(1);
    expect(result.casesOpened).toBe(1);
    expect(recordDetections).toHaveBeenCalledTimes(1);
    expect(recordRisk).toHaveBeenCalledTimes(1);
  });

  test("says it matched on the rule, and leaves the rule's schedule as it was", async () => {
    await DetectionRuleEvaluator.evaluateRule(rule(), {
      realTime: { restrictTo: restriction(), startTime: START, endTime: END },
    });

    expect(updateOneById).toHaveBeenCalledTimes(1);

    const data: JSONObject = (
      updateOneById.mock.calls[0]![0] as { data: JSONObject }
    ).data;

    expect(data["lastMatchAt"]).toEqual(END);
    expect(data["lastError"]).toBeNull();
    expect("lastEvaluatedAt" in data).toBe(false);
  });

  test("with nothing matched, it clears the rule's error and says nothing of a match", async () => {
    findDetectionMatches.mockResolvedValue([] as never);

    await DetectionRuleEvaluator.evaluateRule(rule(), {
      realTime: { restrictTo: restriction(), startTime: START, endTime: END },
    });

    const data: JSONObject = (
      updateOneById.mock.calls[0]![0] as { data: JSONObject }
    ).data;

    expect(data).toEqual({ lastError: null });
  });

  test("a correlation never reads a write's events alone: only the window around them", async () => {
    const findMatches: Spy = getJestSpyOn(
      CorrelationRuleMatcher,
      "findMatches",
    );

    await expect(
      DetectionRuleEvaluator.evaluateRule(rule(CORRELATION), {
        realTime: { restrictTo: restriction(), startTime: START, endTime: END },
      }),
    ).rejects.toThrow(
      "A correlation reads the window of its interval around the events it is handed, never the events alone.",
    );
    expect(findMatches).not.toHaveBeenCalled();
  });

  test("a correlation's handover reads its window as a scheduled run would", async () => {
    const findMatches: Spy = getJestSpyOn(
      CorrelationRuleMatcher,
      "findMatches",
    ).mockResolvedValue({
      groups: [],
      readFrom: START,
      candidatesCapped: false,
    } as never);

    await DetectionRuleEvaluator.evaluateRealTime(rule(CORRELATION), {
      startTime: START,
      endTime: END,
    });

    const input: CorrelationRuleMatchInput = findMatches.mock
      .calls[0]![0] as CorrelationRuleMatchInput;

    expect(input.startTime).toEqual(START);
    expect(input.endTime).toEqual(END);
    expect(input.arrival).toBeUndefined();
  });

  test("evaluateRealTime records a failure as the rule's Last Error, never its schedule", async () => {
    findDetectionMatches.mockRejectedValue(
      new Error("ClickHouse refused the read") as never,
    );

    await expect(
      DetectionRuleEvaluator.evaluateRealTime(rule(), {
        restrictTo: restriction(),
        startTime: START,
        endTime: END,
      }),
    ).resolves.toBeNull();

    const data: JSONObject = (
      updateOneById.mock.calls[0]![0] as { data: JSONObject }
    ).data;

    expect(String(data["lastError"])).toContain("ClickHouse refused the read");
    expect("lastEvaluatedAt" in data).toBe(false);
  });

  test("a job reads the rule with what tells it was turned off or put back on its schedule since", () => {
    expect(DETECTION_RULE_REAL_TIME_SELECT).toMatchObject({
      _id: true,
      projectId: true,
      sigmaRuleYaml: true,
      isEnabled: true,
      isRealTime: true,
      // ...and whether it counts in windows, and how long they are.
      matchCountThreshold: true,
      distinctCountField: true,
      evaluationIntervalInMinutes: true,
    });
  });
});

/*
 * A RULE THAT COUNTS, IN REAL TIME: the window of its interval a write's
 * events fall in (5 minutes here: 10:00 to 10:05), as it stood when the
 * write came in - its events, the lowest and highest of their ids - with
 * the threshold and the rest of the run as on its schedule.
 */
describe("a rule that counts, in real time", () => {
  const CANDIDATES: Array<{ id: string; time: string }> = [
    // Ids are time-ordered: the second came in first.
    {
      id: "019a4f00-0002-7000-8000-000000000002",
      time: "2026-11-04T10:03:10.000Z",
    },
    {
      id: "019a4f00-0001-7000-8000-000000000001",
      time: "2026-11-04T10:01:00.000Z",
    },
  ];
  const NOW: Date = new Date("2026-11-04T10:03:20.000Z");

  function counting(data: Partial<DetectionRule> = {}): DetectionRule {
    const model: DetectionRule = rule();
    model.matchCountThreshold = 5;
    Object.assign(model, data);
    return model;
  }

  beforeEach(() => {
    getJestSpyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW as never);
    // The group the write brought to five failures.
    findDetectionMatches.mockResolvedValue([
      {
        groupValue: "root",
        matchCount: 5,
        distinctCount: 0,
        sampleMessage: "root failed to sign in",
        sampleObservables: ["root"],
      },
    ] as Array<DetectionMatchGroup> as never);
  });

  test("reads the window of its interval around the write's events, as the write found it - not the events alone", async () => {
    await DetectionRuleEvaluator.evaluateRealTime(counting(), {
      restrictTo: restriction(),
      startTime: START,
      endTime: END,
      candidates: CANDIDATES,
    });

    expect(findDetectionMatches).toHaveBeenCalledTimes(1);

    const read: FindDetectionMatchesData = findDetectionMatches.mock
      .calls[0]![0] as FindDetectionMatchesData;

    expect(read.startTime.toISOString()).toBe("2026-11-04T10:00:00.000Z");
    expect(read.endTime.toISOString()).toBe("2026-11-04T10:05:00.000Z");
    expect(read.minMatchCount).toBe(5);
    expect(read.arrival).toEqual({
      candidateIds: [
        "019a4f00-0001-7000-8000-000000000001",
        "019a4f00-0002-7000-8000-000000000002",
      ],
      firstId: "019a4f00-0001-7000-8000-000000000001",
      lastId: "019a4f00-0002-7000-8000-000000000002",
      candidateStartTime: new Date("2026-11-04T10:00:59.000Z"),
      candidateEndTime: new Date("2026-11-04T10:03:11.000Z"),
    });
    // Every event of the window counts, not the write's alone.
    expect(
      (read.whereFragment as unknown as { query: string }).query,
    ).not.toContain("_id IN");
  });

  test("a distinct count counts in windows too", async () => {
    await DetectionRuleEvaluator.evaluateRealTime(
      counting({ matchCountThreshold: 1, distinctCountField: "principalHost" }),
      {
        restrictTo: restriction(),
        startTime: START,
        endTime: END,
        candidates: CANDIDATES,
      },
    );

    const read: FindDetectionMatchesData = findDetectionMatches.mock
      .calls[0]![0] as FindDetectionMatchesData;

    expect(read.arrival?.firstId).toBe("019a4f00-0001-7000-8000-000000000001");
    expect(read.distinctCountExpression).not.toBeNull();
  });

  test("a write whose events fall in two windows makes one run of each, and adds up what they did", async () => {
    const result: DetectionRuleEvaluationResult | null =
      await DetectionRuleEvaluator.evaluateRealTime(counting(), {
        restrictTo: restriction(),
        startTime: START,
        endTime: END,
        candidates: [
          ...CANDIDATES,
          {
            id: "019a4f00-0003-7000-8000-000000000003",
            time: "2026-11-04T09:59:58.000Z",
          },
        ],
      });

    expect(
      findDetectionMatches.mock.calls.map((call: Array<unknown>): string => {
        return (call[0] as FindDetectionMatchesData).startTime.toISOString();
      }),
    ).toEqual(["2026-11-04T09:55:00.000Z", "2026-11-04T10:00:00.000Z"]);
    expect(
      (findDetectionMatches.mock.calls[0]![0] as FindDetectionMatchesData)
        .arrival?.candidateIds,
    ).toEqual(["019a4f00-0003-7000-8000-000000000003"]);
    // Each window's match opened an alert and a case.
    expect(result?.alertsCreated).toBe(2);
    expect(result?.casesOpened).toBe(2);
  });

  test("what a window's matches cover: from its start to now, while it is still filling", async () => {
    await DetectionRuleEvaluator.evaluateRealTime(counting(), {
      restrictTo: restriction(),
      startTime: START,
      endTime: END,
      candidates: CANDIDATES,
    });

    const data: JSONObject = (
      updateOneById.mock.calls[0]![0] as { data: JSONObject }
    ).data;

    expect(data["lastMatchAt"]).toEqual(NOW);
    expect("lastEvaluatedAt" in data).toBe(false);

    const signal: { seenAt: Date; description: string } = (
      recordDetections.mock.calls[0]![0] as Array<{
        seenAt: Date;
        description: string;
      }>
    )[0]!;

    expect(signal.seenAt).toEqual(NOW);
  });

  test("a window long over covers it all: a late event's match says its own window", async () => {
    await DetectionRuleEvaluator.evaluateRealTime(counting(), {
      restrictTo: restriction(),
      startTime: START,
      endTime: END,
      candidates: [
        {
          id: "019a4f00-0004-7000-8000-000000000004",
          time: "2026-11-04T08:12:00.000Z",
        },
      ],
    });

    const data: JSONObject = (
      updateOneById.mock.calls[0]![0] as { data: JSONObject }
    ).data;

    expect(data["lastMatchAt"]).toEqual(new Date("2026-11-04T08:15:00.000Z"));
  });

  test("a rule that fires on each event reads only its events, as before", async () => {
    await DetectionRuleEvaluator.evaluateRealTime(
      counting({ matchCountThreshold: 1 }),
      {
        restrictTo: restriction(),
        startTime: START,
        endTime: END,
        candidates: CANDIDATES,
      },
    );

    const read: FindDetectionMatchesData = findDetectionMatches.mock
      .calls[0]![0] as FindDetectionMatchesData;

    expect(read.arrival).toBeUndefined();
    expect(read.startTime).toEqual(START);
    expect(
      (read.whereFragment as unknown as { query: string }).query,
    ).toContain("_id IN {");
  });

  test("a correlation reads the window of its interval around the write's events, as the write found it", async () => {
    const findMatches: Spy = getJestSpyOn(
      CorrelationRuleMatcher,
      "findMatches",
    ).mockResolvedValue({
      groups: [
        {
          groupValue: "203.0.113.7",
          matchCount: 10,
          distinctCount: 0,
          sampleMessage: "failed",
          sampleObservables: ["203.0.113.7"],
          summary: "10 events in 5 minutes",
          groupFields: [{ field: "principalIp", value: "203.0.113.7" }],
        },
      ],
      readFrom: START,
      candidatesCapped: false,
    } as never);

    const result: DetectionRuleEvaluationResult | null =
      await DetectionRuleEvaluator.evaluateRealTime(rule(CORRELATION), {
        restrictTo: restriction(),
        startTime: START,
        endTime: END,
        candidates: CANDIDATES,
      });

    const input: CorrelationRuleMatchInput = findMatches.mock
      .calls[0]![0] as CorrelationRuleMatchInput;

    expect(input.startTime.toISOString()).toBe("2026-11-04T10:00:00.000Z");
    expect(input.endTime.toISOString()).toBe("2026-11-04T10:05:00.000Z");
    expect(input.arrival?.lastId).toBe("019a4f00-0002-7000-8000-000000000002");
    expect(input.restrictTo).toBeUndefined();
    // What a scheduled run does with a match.
    expect(result?.alertsCreated).toBe(1);
    expect(result?.casesOpened).toBe(1);
    expect(findDetectionMatches).not.toHaveBeenCalled();
  });
});

describe("getDetectionRuleCountWindows", () => {
  test("one window of the interval for each the events fall in, in order, with where the write came in", () => {
    const windows: Array<DetectionRuleCountWindow> =
      getDetectionRuleCountWindows({
        candidates: [
          { id: "c", time: "2026-11-04T10:07:00.000Z" },
          { id: "a", time: "2026-11-04T10:01:00.000Z" },
          { id: "b", time: "2026-11-04T10:04:59.999Z" },
        ],
        evaluationIntervalInMinutes: 5,
      });

    expect(
      windows.map((window: DetectionRuleCountWindow): unknown => {
        return {
          start: window.window.startTime.toISOString(),
          end: window.window.endTime.toISOString(),
          ids: window.arrival.candidateIds,
          firstId: window.arrival.firstId,
          lastId: window.arrival.lastId,
          from: window.arrival.candidateStartTime.toISOString(),
          until: window.arrival.candidateEndTime.toISOString(),
        };
      }),
    ).toEqual([
      {
        start: "2026-11-04T10:00:00.000Z",
        end: "2026-11-04T10:05:00.000Z",
        ids: ["a", "b"],
        firstId: "a",
        lastId: "b",
        from: "2026-11-04T10:00:59.000Z",
        until: "2026-11-04T10:05:00.999Z",
      },
      {
        start: "2026-11-04T10:05:00.000Z",
        end: "2026-11-04T10:10:00.000Z",
        ids: ["c"],
        firstId: "c",
        lastId: "c",
        from: "2026-11-04T10:06:59.000Z",
        until: "2026-11-04T10:07:01.000Z",
      },
    ]);
  });

  test("an event with no id or no time is no event", () => {
    expect(
      getDetectionRuleCountWindows({
        candidates: [
          { id: "", time: "2026-11-04T10:07:00.000Z" },
          { id: "a", time: "never" },
        ],
        evaluationIntervalInMinutes: 5,
      }),
    ).toEqual([]);
  });
});
