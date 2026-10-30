/*
 * A real-time run of a detection rule (DetectionRuleEvaluator, realTime):
 * the rule's own query, restricted to the events ingest screened for it,
 * over the times they happened - however old - doing what a scheduled run
 * does with what matches (an alert, a finding, a case, risk), saying how it
 * went on the rule, and leaving its schedule as it was. A correlation never
 * runs so; a failure is the rule's Last Error, never its schedule.
 */

// The alert path pulls the isolated-vm addon through its template renderer: stub it out.
jest.mock("isolated-vm", () => {
  return {};
});

import DetectionRuleEvaluator, {
  DETECTION_RULE_REAL_TIME_SELECT,
  DetectionRuleEvaluationResult,
} from "../../../../Server/Utils/SecurityEvent/DetectionRuleEvaluator";
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

  test("a correlation never runs in real time", async () => {
    await expect(
      DetectionRuleEvaluator.evaluateRule(rule(CORRELATION), {
        realTime: { restrictTo: restriction(), startTime: START, endTime: END },
      }),
    ).rejects.toThrow(
      "A correlation runs on its interval, never in real time.",
    );
    expect(findDetectionMatches).not.toHaveBeenCalled();
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
    });
  });
});
