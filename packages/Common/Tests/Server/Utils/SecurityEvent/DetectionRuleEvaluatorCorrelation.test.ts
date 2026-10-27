/*
 * The detection engine running a correlation rule: its groups come from
 * CorrelationRuleMatcher (stubbed here; its own suites and the real-server
 * App suite cover it), and everything after - the alert, the incident, the
 * Detection Finding, the case and the rule's own bookkeeping - reads them
 * as it reads a single rule's, with the correlation's title, level and
 * ATT&CK tags, its sentence of what happened, and each grouped value typed
 * by its own field. A correlation that reads the project's other rules has
 * them resolved, and one that names a rule no longer there fails the run
 * into the rule's Last Error.
 */

jest.mock("isolated-vm", () => {
  return {};
});

import DetectionRuleEvaluator, {
  DetectionRuleEvaluationResult,
} from "../../../../Server/Utils/SecurityEvent/DetectionRuleEvaluator";
import CorrelationRuleMatcher, {
  CorrelationRuleMatchInput,
} from "../../../../Server/Utils/SecurityEvent/Correlation/CorrelationRuleMatcher";
import ProjectSigmaRules from "../../../../Server/Utils/SecurityEvent/Correlation/ProjectSigmaRules";
import { CORRELATION_TEMPORAL_CANDIDATE_LIMIT } from "../../../../Server/Utils/SecurityEvent/Correlation/CorrelationQueries";
import DetectionRule from "../../../../Models/DatabaseModels/DetectionRule";
import Alert from "../../../../Models/DatabaseModels/Alert";
import AlertSeverity from "../../../../Models/DatabaseModels/AlertSeverity";
import AlertService from "../../../../Server/Services/AlertService";
import AlertSeverityService from "../../../../Server/Services/AlertSeverityService";
import DetectionRuleService from "../../../../Server/Services/DetectionRuleService";
import DetectionRuleExceptionService from "../../../../Server/Services/DetectionRuleExceptionService";
import DetectionRuleException from "../../../../Models/DatabaseModels/DetectionRuleException";
import { DetectionRuleExceptionKind } from "../../../../Types/SecurityEvent/DetectionRuleException";
import SecurityEventService, {
  DetectionMatchGroup,
} from "../../../../Server/Services/SecurityEventService";
import OTelIngestService, {
  TelemetryServiceMetadata,
} from "../../../../Server/Services/OpenTelemetryIngestService";
import logger from "../../../../Server/Utils/Logger";
import SecurityCaseIngest, {
  SecurityDetectionSignal,
} from "../../../../Server/Utils/SecurityCase/SecurityCaseIngest";
import {
  DETECTION_CORRELATION_TYPE_ATTRIBUTE,
  DETECTION_DISTINCT_COUNT_ATTRIBUTE,
  DETECTION_SUMMARY_ATTRIBUTE,
} from "../../../../Types/SecurityEvent/DetectionFindingConstants";
import { SecurityEntityType } from "../../../../Types/SecurityCase/SecurityEntity";
import { SigmaCorrelationType } from "../../../../Types/SecurityEvent/SigmaCorrelation";
import { indexSigmaRules } from "../../../../Utils/SecurityEvent/Sigma/SigmaRuleIndex";
import ObjectID from "../../../../Types/ObjectID";
import ServiceType from "../../../../Types/Telemetry/ServiceType";
import { JSONObject } from "../../../../Types/JSON";
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

const RULE_ID: ObjectID = new ObjectID("12121212-1212-4212-8212-121212121212");
const PROJECT_ID: ObjectID = new ObjectID(
  "23232323-2323-4323-8323-232323232323",
);

const SERVICE_METADATA: TelemetryServiceMetadata = {
  serviceName: "OneUptime Detections",
  primaryEntityId: new ObjectID("34343434-3434-4434-8434-343434343434"),
  primaryEntityType: ServiceType.OpenTelemetry,
  dataRententionInDays: 15,
  serviceRetentionConfig: null,
  serviceRetentionInDays: null,
  projectRetentionConfig: null,
  projectRetentionInDays: 15,
};

const SEQUENCE_YAML: string = `title: Brute force then success
id: 45454545-4545-4545-8545-454545454545
level: critical
description: Many failed sign-ins, then one that worked.
tags:
  - attack.credential_access
  - attack.t1110
correlation:
  type: temporal_ordered
  rules: [failed_sign_in, successful_sign_in]
  group-by: [principalUser, principalIp]
  timespan: 10m
---
title: Failed sign-in
name: failed_sign_in
detection:
  selection:
    className: Authentication
    statusName: Failure
  condition: selection
---
title: Successful sign-in
name: successful_sign_in
detection:
  selection:
    className: Authentication
    statusName: Success
  condition: selection`;

function buildRule(sigmaRuleYaml: string): DetectionRule {
  const rule: DetectionRule = new DetectionRule();
  rule._id = RULE_ID.toString();
  rule.projectId = PROJECT_ID;
  rule.name = "Brute force then success";
  rule.sigmaRuleYaml = sigmaRuleYaml;
  rule.evaluationIntervalInMinutes = 5;
  // A single rule's settings, which a correlation does not read.
  rule.groupByField = "principalHost";
  rule.distinctCountField = "targetPort";
  rule.matchCountThreshold = 50;
  rule.shouldCreateAlert = true;
  rule.shouldWriteDetectionFinding = true;
  rule.shouldCreateCase = true;
  return rule;
}

const MATCH: DetectionMatchGroup = {
  groupValue: "alice / 203.0.113.7",
  matchCount: 7,
  distinctCount: 0,
  sampleMessage: "Accepted password for alice",
  sampleObservables: ["alice", "203.0.113.7", "vpn-gw"],
  groupFields: [
    { field: "principalUser", value: "alice" },
    { field: "principalIp", value: "203.0.113.7" },
  ],
  summary: "Failed sign-in, then Successful sign-in, 2 minutes apart",
};

interface Spies {
  findMatches: Spy;
  findDetectionMatches: Spy;
  insertJsonRows: Spy;
  alertCreate: Spy;
  updateOneById: Spy;
  recordDetections: Spy;
}

function installSpies(groups: Array<DetectionMatchGroup>): Spies {
  const severity: AlertSeverity = new AlertSeverity();
  severity._id = "56565656-5656-4656-8656-565656565656";
  severity.name = "Critical";

  return {
    findMatches: getJestSpyOn(
      CorrelationRuleMatcher,
      "findMatches",
    ).mockResolvedValue({
      groups,
      readFrom: new Date(),
      candidatesCapped: false,
    } as never),
    findDetectionMatches: getJestSpyOn(
      SecurityEventService,
      "findDetectionMatches",
    ).mockResolvedValue([] as never),
    insertJsonRows: getJestSpyOn(
      SecurityEventService,
      "insertJsonRows",
    ).mockResolvedValue(undefined as never),
    alertCreate: getJestSpyOn(AlertService, "create").mockResolvedValue(
      new Alert() as never,
    ),
    updateOneById: getJestSpyOn(
      DetectionRuleService,
      "updateOneById",
    ).mockResolvedValue(undefined as never),
    recordDetections: getJestSpyOn(
      SecurityCaseIngest,
      "recordDetections",
    ).mockResolvedValue({
      casesOpened: 1,
      detectionsAdded: 1,
      detectionsRepeated: 0,
    } as never),
  };
}

beforeEach(() => {
  getJestSpyOn(logger, "error").mockImplementation((() => {
    return undefined;
  }) as never);
  getJestSpyOn(logger, "warn").mockImplementation((() => {
    return undefined;
  }) as never);
  mockProjectStates();
  getJestSpyOn(AlertService, "findBy").mockResolvedValue([] as never);
  getJestSpyOn(AlertSeverityService, "findBy").mockResolvedValue([
    Object.assign(new AlertSeverity(), {
      _id: "56565656-5656-4656-8656-565656565656",
      name: "Critical",
    }),
  ] as never);
  getJestSpyOn(OTelIngestService, "telemetryServiceFromName").mockResolvedValue(
    SERVICE_METADATA as never,
  );
  // No rule skips anything unless a test says so.
  getJestSpyOn(DetectionRuleExceptionService, "findAllBy").mockResolvedValue(
    [] as never,
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("DetectionRuleEvaluator: a correlation rule", () => {
  test("its groups come from the correlation, never the single-rule read", async () => {
    const spies: Spies = installSpies([MATCH]);

    const result: DetectionRuleEvaluationResult =
      await DetectionRuleEvaluator.evaluateRule(buildRule(SEQUENCE_YAML));

    expect(spies.findDetectionMatches).not.toHaveBeenCalled();
    expect(spies.findMatches).toHaveBeenCalledTimes(1);

    const input: CorrelationRuleMatchInput = spies.findMatches.mock
      .calls[0]![0] as CorrelationRuleMatchInput;

    expect(input.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(input.correlation.type).toBe(SigmaCorrelationType.TemporalOrdered);
    expect(input.steps).toHaveLength(2);
    expect(input.restrictTo).toBeUndefined();
    expect(input.endTime.getTime()).toBeGreaterThan(input.startTime.getTime());

    expect(result.matchedGroups).toBe(1);
    expect(result.casesOpened).toBe(1);
    expect(result.alertsCreated).toBe(1);
  });

  test("the finding carries the correlation's type, sentence, level and tags, and no distinct count", async () => {
    const spies: Spies = installSpies([MATCH]);

    await DetectionRuleEvaluator.evaluateRule(buildRule(SEQUENCE_YAML));

    const rows: Array<JSONObject> = spies.insertJsonRows.mock
      .calls[0]![0] as Array<JSONObject>;
    const finding: JSONObject = rows[0]!;
    const attributes: JSONObject = finding["attributes"] as JSONObject;

    expect(attributes[DETECTION_CORRELATION_TYPE_ATTRIBUTE]).toBe(
      "temporal_ordered",
    );
    expect(attributes[DETECTION_SUMMARY_ATTRIBUTE]).toBe(MATCH.summary);
    expect(attributes[DETECTION_DISTINCT_COUNT_ATTRIBUTE]).toBeUndefined();
    expect(finding["severityName"]).toBe("Critical");
    expect(finding["mitreTechniques"]).toEqual(["T1110"]);
    expect(finding["message"]).toBe(
      "Detection: Brute force then success — alice / 203.0.113.7 (7 events; Failed sign-in, then Successful sign-in, 2 minutes apart)",
    );
    // Each grouped value is an observable of its own, first.
    expect((finding["observables"] as Array<string>).slice(0, 3)).toEqual([
      "alice",
      "203.0.113.7",
      "vpn-gw",
    ]);
  });

  test("the case is about each grouped value, typed by its own field", async () => {
    const spies: Spies = installSpies([MATCH]);

    await DetectionRuleEvaluator.evaluateRule(buildRule(SEQUENCE_YAML));

    const signals: Array<SecurityDetectionSignal> = spies.recordDetections.mock
      .calls[0]![0] as Array<SecurityDetectionSignal>;
    const signal: SecurityDetectionSignal = signals[0]!;

    expect(signal.entities.slice(0, 2)).toEqual([
      { type: SecurityEntityType.User, value: "alice" },
      { type: SecurityEntityType.IpAddress, value: "203.0.113.7" },
    ]);
    expect(signal.description).toContain(
      "What happened: Failed sign-in, then Successful sign-in, 2 minutes apart.",
    );
    expect(signal.description).not.toContain("distinct");
    expect(signal.severity).toBe("Critical");
    expect(signal.groupValue).toBe("alice / 203.0.113.7");
  });

  test("the alert says what happened", async () => {
    const spies: Spies = installSpies([MATCH]);

    await DetectionRuleEvaluator.evaluateRule(buildRule(SEQUENCE_YAML));

    const alert: Alert = (
      spies.alertCreate.mock.calls[0]![0] as { data: Alert }
    ).data;

    expect(alert.title).toBe(
      "[Detection] Brute force then success — alice / 203.0.113.7",
    );
    expect(alert.description).toContain(
      "What happened: Failed sign-in, then Successful sign-in, 2 minutes apart.",
    );
    expect(alert.description).not.toContain("distinct targetPort");
  });

  test("a run that had more groups to check than it reads says so on the rule", async () => {
    const spies: Spies = installSpies([]);
    spies.findMatches.mockResolvedValue({
      groups: [],
      readFrom: new Date(),
      candidatesCapped: true,
    } as never);

    await DetectionRuleEvaluator.evaluateRule(buildRule(SEQUENCE_YAML));

    const data: JSONObject = (
      spies.updateOneById.mock.calls[0]![0] as { data: JSONObject }
    ).data;

    expect(data["lastError"]).toBe(
      `This run checked the ${CORRELATION_TEMPORAL_CANDIDATE_LIMIT} most recently active groups; the next runs check the rest.`,
    );
    expect(data["lastMatchAt"]).toBeUndefined();
  });

  test("a correlation reading the project's rules has them resolved, leaving itself out", async () => {
    const spies: Spies = installSpies([]);
    const load: Spy = getJestSpyOn(ProjectSigmaRules, "load").mockResolvedValue(
      indexSigmaRules([
        {
          sigmaRuleYaml: `title: Failed sign-in
name: failed_sign_in
detection:
  selection:
    statusName: Failure
  condition: selection`,
        },
        {
          sigmaRuleYaml: `title: Successful sign-in
name: successful_sign_in
detection:
  selection:
    statusName: Success
  condition: selection`,
        },
      ]) as never,
    );

    await DetectionRuleEvaluator.evaluateRule(
      buildRule(`title: Failure then success
correlation:
  type: temporal_ordered
  rules: [failed_sign_in, successful_sign_in]
  group-by: [principalUser]
  timespan: 10m`),
    );

    expect(load).toHaveBeenCalledTimes(1);
    expect((load.mock.calls[0]![0] as ObjectID).toString()).toBe(
      PROJECT_ID.toString(),
    );
    expect(
      (
        load.mock.calls[0]![1] as { excludeRuleId: ObjectID }
      ).excludeRuleId.toString(),
    ).toBe(RULE_ID.toString());

    const input: CorrelationRuleMatchInput = spies.findMatches.mock
      .calls[0]![0] as CorrelationRuleMatchInput;

    expect(
      input.steps.map((step: { rule?: { title: string } | undefined }) => {
        return step.rule?.title;
      }),
    ).toEqual(["Failed sign-in", "Successful sign-in"]);
  });

  test("a self-contained correlation never reads the project's rules", async () => {
    installSpies([]);
    const load: Spy = getJestSpyOn(ProjectSigmaRules, "load");

    await DetectionRuleEvaluator.evaluateRule(buildRule(SEQUENCE_YAML));

    expect(load).not.toHaveBeenCalled();
  });

  test("a rule the correlation names that is gone fails the run into Last Error", async () => {
    const spies: Spies = installSpies([]);
    getJestSpyOn(ProjectSigmaRules, "load").mockResolvedValue(
      indexSigmaRules([]) as never,
    );

    const rule: DetectionRule = buildRule(`title: Failure then success
correlation:
  type: temporal_ordered
  rules: [failed_sign_in, successful_sign_in]
  group-by: [principalUser]
  timespan: 10m`);

    await expect(DetectionRuleEvaluator.evaluateRule(rule)).rejects.toThrow(
      '"failed_sign_in", "successful_sign_in" is not in this YAML, nor the name or id of one of your detection rules.',
    );
    expect(spies.findMatches).not.toHaveBeenCalled();
  });

  test("a single rule is evaluated as before, without the correlation reads", async () => {
    const spies: Spies = installSpies([]);

    await DetectionRuleEvaluator.evaluateRule(
      buildRule(`title: Failed sign-in
detection:
  selection:
    statusName: Failure
  condition: selection`),
    );

    expect(spies.findMatches).not.toHaveBeenCalled();
    expect(spies.findDetectionMatches).toHaveBeenCalledTimes(1);
  });

  test("loadRuleDefinition parses the rule as the engine runs it", async () => {
    const definition: Awaited<
      ReturnType<typeof DetectionRuleEvaluator.loadRuleDefinition>
    > = await DetectionRuleEvaluator.loadRuleDefinition(
      buildRule(SEQUENCE_YAML),
    );

    expect(definition.kind).toBe("correlation");
  });

  /*
   * A correlation's exceptions are in every read it makes: an event an
   * exception skips is not a step of anybody's sequence, nor counted in a
   * burst.
   */
  test("its exceptions are ANDed into every read the correlation makes", async () => {
    const spies: Spies = installSpies([MATCH]);

    const scanner: DetectionRuleException = new DetectionRuleException();
    scanner._id = "67676767-6767-4767-8767-676767676767";
    scanner.projectId = PROJECT_ID;
    scanner.detectionRuleId = RULE_ID;
    scanner.kind = DetectionRuleExceptionKind.Entity;
    scanner.entityType = SecurityEntityType.IpAddress;
    scanner.value = "203.0.113.0/24";

    const result: DetectionRuleEvaluationResult =
      await DetectionRuleEvaluator.evaluateRule(buildRule(SEQUENCE_YAML), {
        exceptions: [scanner],
      });

    const input: CorrelationRuleMatchInput = spies.findMatches.mock
      .calls[0]![0] as CorrelationRuleMatchInput;

    expect(input.restrictTo).toBeDefined();
    expect(input.restrictTo!.query).toContain("NOT ((");
    // An address range: matched as one, on text that is an address.
    expect(input.restrictTo!.query).toContain("isIPAddressInRange(");
    expect(Object.values(input.restrictTo!.query_params)).toContain(
      "203.0.113.0/24",
    );
    expect(result.exceptionsApplied).toBe(1);
  });
});
