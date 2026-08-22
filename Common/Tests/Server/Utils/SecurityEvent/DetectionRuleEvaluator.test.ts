/*
 * DetectionRuleEvaluator is the detections-as-code engine: it schedules
 * due Sigma rules, runs their compiled match query, opens deduped alerts
 * (one per rule + group-value fingerprint), writes Detection Finding rows
 * back into the events table, and records evaluator state (lastEvaluatedAt
 * / lastMatchAt / lastError) on the rule. These tests pin all of that with
 * every service boundary stubbed: scheduling honors the evaluation
 * interval, fingerprint dedupe suppresses re-alerting on still-open
 * alerts, severity resolution follows its documented precedence, findings
 * carry the Detection Finding class and rule provenance, and errors land
 * in lastError instead of killing the cron loop.
 */

/*
 * The alert creation path pulls the native isolated-vm addon through its
 * template renderer. Nothing under test here touches the sandbox, and the
 * prebuilt binary cannot always dlopen in the test environment — so stub
 * the module out before anything imports it.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import DetectionRuleEvaluator, {
  DetectionRuleEvaluationResult,
} from "../../../../Server/Utils/SecurityEvent/DetectionRuleEvaluator";
import DetectionRule from "../../../../Models/DatabaseModels/DetectionRule";
import Alert from "../../../../Models/DatabaseModels/Alert";
import AlertSeverity from "../../../../Models/DatabaseModels/AlertSeverity";
import AlertService from "../../../../Server/Services/AlertService";
import AlertSeverityService from "../../../../Server/Services/AlertSeverityService";
import DetectionRuleService from "../../../../Server/Services/DetectionRuleService";
import SecurityEventService, {
  DetectionMatchGroup,
} from "../../../../Server/Services/SecurityEventService";
import OTelIngestService, {
  TelemetryServiceMetadata,
} from "../../../../Server/Services/OpenTelemetryIngestService";
import logger from "../../../../Server/Utils/Logger";
import MetricSeriesFingerprint from "../../../../Utils/Metrics/MetricSeriesFingerprint";
import ObjectID from "../../../../Types/ObjectID";
import OneUptimeDate from "../../../../Types/Date";
import ServiceType from "../../../../Types/Telemetry/ServiceType";
import { JSONObject } from "../../../../Types/JSON";
import { getJestSpyOn } from "../../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

type Spy = ReturnType<typeof getJestSpyOn>;

const RULE_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const DETECTIONS_SERVICE_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);

const SERVICE_METADATA: TelemetryServiceMetadata = {
  serviceName: "OneUptime Detections",
  primaryEntityId: DETECTIONS_SERVICE_ID,
  primaryEntityType: ServiceType.OpenTelemetry,
  dataRententionInDays: 15,
  serviceRetentionConfig: null,
  serviceRetentionInDays: null,
  projectRetentionConfig: null,
  projectRetentionInDays: 15,
};

function sigmaYaml(level: string): string {
  return `
title: Failed Logins
id: 99999999-9999-4999-8999-999999999999
description: Multiple failed logins detected
level: ${level}
tags:
  - attack.ta0006
  - attack.t1110
detection:
  selection:
    className: Authentication
    statusName: Failure
  condition: selection
`;
}

function buildRule(
  options: {
    level?: string;
    sigmaRuleYaml?: string;
    shouldCreateAlert?: boolean;
    shouldWriteDetectionFinding?: boolean;
    alertSeverityId?: ObjectID;
    lastEvaluatedAt?: Date;
    evaluationIntervalInMinutes?: number;
    id?: ObjectID;
  } = {},
): DetectionRule {
  const rule: DetectionRule = new DetectionRule();
  rule._id = (options.id || RULE_ID).toString();
  rule.projectId = PROJECT_ID;
  rule.name = "Brute Force Watch";
  rule.description = "Watches for brute-force logins";
  rule.sigmaRuleYaml =
    options.sigmaRuleYaml ?? sigmaYaml(options.level || "high");
  rule.evaluationIntervalInMinutes = options.evaluationIntervalInMinutes ?? 5;
  rule.groupByField = "principalUser";

  if (options.shouldCreateAlert !== undefined) {
    rule.shouldCreateAlert = options.shouldCreateAlert;
  }

  if (options.shouldWriteDetectionFinding !== undefined) {
    rule.shouldWriteDetectionFinding = options.shouldWriteDetectionFinding;
  }

  if (options.alertSeverityId !== undefined) {
    rule.alertSeverityId = options.alertSeverityId;
  }

  if (options.lastEvaluatedAt !== undefined) {
    rule.lastEvaluatedAt = options.lastEvaluatedAt;
  }

  return rule;
}

function buildSeverity(idSuffix: string, name: string): AlertSeverity {
  const severity: AlertSeverity = new AlertSeverity();
  severity._id = `33333333-3333-4333-8333-33333333${idSuffix}`;
  severity.name = name;
  return severity;
}

function buildGroup(
  groupValue: string,
  matchCount: number,
): DetectionMatchGroup {
  return {
    groupValue,
    matchCount,
    sampleMessage: `sample event for ${groupValue || "all"}`,
    sampleObservables: [groupValue, "10.0.0.9"].filter(
      (observable: string): boolean => {
        return Boolean(observable);
      },
    ),
  };
}

function buildOpenAlert(fingerprint: string): Alert {
  const alert: Alert = new Alert();
  alert._id = "55555555-5555-4555-8555-555555555555";
  alert.seriesFingerprint = fingerprint;
  return alert;
}

function expectedFingerprint(groupValue: string): string {
  return `detection-rule:${RULE_ID.toString()}:${MetricSeriesFingerprint.computeFingerprint(
    {
      groupValue,
    },
  )}`;
}

interface EvaluationSpies {
  findDetectionMatches: Spy;
  insertJsonRows: Spy;
  alertFindBy: Spy;
  alertCreate: Spy;
  severityFindBy: Spy;
  updateOneById: Spy;
  telemetryServiceFromName: Spy;
}

function installSpies(
  options: {
    groups?: Array<DetectionMatchGroup>;
    severities?: Array<AlertSeverity>;
    openAlerts?: Array<Alert>;
  } = {},
): EvaluationSpies {
  const findDetectionMatches: Spy = getJestSpyOn(
    SecurityEventService,
    "findDetectionMatches",
  ).mockResolvedValue((options.groups || []) as never);

  const insertJsonRows: Spy = getJestSpyOn(
    SecurityEventService,
    "insertJsonRows",
  ).mockResolvedValue(undefined as never);

  const alertFindBy: Spy = getJestSpyOn(
    AlertService,
    "findBy",
  ).mockResolvedValue((options.openAlerts || []) as never);

  const alertCreate: Spy = getJestSpyOn(
    AlertService,
    "create",
  ).mockResolvedValue(new Alert() as never);

  const severityFindBy: Spy = getJestSpyOn(
    AlertSeverityService,
    "findBy",
  ).mockResolvedValue((options.severities || []) as never);

  const updateOneById: Spy = getJestSpyOn(
    DetectionRuleService,
    "updateOneById",
  ).mockResolvedValue(undefined as never);

  const telemetryServiceFromName: Spy = getJestSpyOn(
    OTelIngestService,
    "telemetryServiceFromName",
  ).mockResolvedValue(SERVICE_METADATA as never);

  return {
    findDetectionMatches,
    insertJsonRows,
    alertFindBy,
    alertCreate,
    severityFindBy,
    updateOneById,
    telemetryServiceFromName,
  };
}

function createdAlert(spies: EvaluationSpies, index: number): Alert {
  const call: unknown = spies.alertCreate.mock.calls[index]?.[0];
  return (call as { data: Alert }).data;
}

describe("DetectionRuleEvaluator", () => {
  beforeEach(() => {
    // The evaluator logs expected failures; keep test output clean.
    getJestSpyOn(logger, "error").mockImplementation((() => {
      return undefined;
    }) as never);
    getJestSpyOn(logger, "warn").mockImplementation((() => {
      return undefined;
    }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("evaluateAllDueRules scheduling", () => {
    test("skips rules whose lastEvaluatedAt + interval is in the future and evaluates due ones", async () => {
      const now: Date = OneUptimeDate.getCurrentDate();

      const dueRule: DetectionRule = buildRule({
        id: new ObjectID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1"),
        lastEvaluatedAt: OneUptimeDate.addRemoveMinutes(now, -10),
        evaluationIntervalInMinutes: 5,
      });

      const notDueRule: DetectionRule = buildRule({
        id: new ObjectID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2"),
        lastEvaluatedAt: now,
        evaluationIntervalInMinutes: 60,
      });

      const neverEvaluatedRule: DetectionRule = buildRule({
        id: new ObjectID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3"),
        evaluationIntervalInMinutes: 5,
      });

      getJestSpyOn(DetectionRuleService, "findBy").mockResolvedValue([
        dueRule,
        notDueRule,
        neverEvaluatedRule,
      ] as never);

      const stubResult: DetectionRuleEvaluationResult = {
        ruleId: "stub",
        matchedGroups: 0,
        totalMatches: 0,
        alertsCreated: 0,
        findingsWritten: 0,
        error: null,
      };

      const evaluateRuleSpy: Spy = getJestSpyOn(
        DetectionRuleEvaluator,
        "evaluateRule",
      ).mockResolvedValue(stubResult as never);

      await DetectionRuleEvaluator.evaluateAllDueRules();

      const evaluatedRuleIds: Array<string> = evaluateRuleSpy.mock.calls.map(
        (call: Array<unknown>): string => {
          return (call[0] as DetectionRule).id!.toString();
        },
      );

      expect(evaluatedRuleIds).toEqual([
        dueRule.id!.toString(),
        neverEvaluatedRule.id!.toString(),
      ]);
    });

    test("records lastError on the rule when evaluateRule throws", async () => {
      const rule: DetectionRule = buildRule();

      getJestSpyOn(DetectionRuleService, "findBy").mockResolvedValue([
        rule,
      ] as never);

      const spies: EvaluationSpies = installSpies();
      spies.findDetectionMatches.mockRejectedValue(
        new Error("clickhouse exploded") as never,
      );

      await expect(
        DetectionRuleEvaluator.evaluateAllDueRules(),
      ).resolves.toBeUndefined();

      expect(spies.updateOneById).toHaveBeenCalledTimes(1);

      const updateArg: { id: ObjectID; data: JSONObject } = spies.updateOneById
        .mock.calls[0]?.[0] as { id: ObjectID; data: JSONObject };

      expect(updateArg.id.toString()).toBe(RULE_ID.toString());
      expect(updateArg.data["lastError"]).toBe("clickhouse exploded");
      expect(updateArg.data["lastEvaluatedAt"]).toBeInstanceOf(Date);
    });
  });

  describe("evaluateRule alert creation and dedupe", () => {
    test("creates one alert per matched group and skips groups with a still-open fingerprint", async () => {
      const rule: DetectionRule = buildRule({
        shouldWriteDetectionFinding: false,
      });

      const severity: AlertSeverity = buildSeverity("0001", "Default");

      const spies: EvaluationSpies = installSpies({
        groups: [
          buildGroup("alice", 3),
          buildGroup("bob", 1),
          buildGroup("carol", 0), // zero-count groups are not matches
        ],
        severities: [severity],
        // bob already has an open alert with the same fingerprint.
        openAlerts: [buildOpenAlert(expectedFingerprint("bob"))],
      });

      const result: DetectionRuleEvaluationResult =
        await DetectionRuleEvaluator.evaluateRule(rule);

      expect(result.matchedGroups).toBe(2);
      expect(result.totalMatches).toBe(4);
      expect(result.alertsCreated).toBe(1);
      expect(result.findingsWritten).toBe(0);
      expect(result.error).toBeNull();
      expect(result.ruleId).toBe(RULE_ID.toString());

      expect(spies.alertCreate).toHaveBeenCalledTimes(1);

      const alert: Alert = createdAlert(spies, 0);

      expect(alert.projectId?.toString()).toBe(PROJECT_ID.toString());
      expect(alert.title).toContain("Brute Force Watch");
      expect(alert.title).toContain("alice");
      expect(alert.seriesFingerprint).toBe(expectedFingerprint("alice"));
      expect(alert.seriesFingerprint).toContain(
        `detection-rule:${RULE_ID.toString()}:`,
      );
      expect(alert.isCreatedAutomatically).toBe(true);
      expect(alert.alertSeverityId?.toString()).toBe(severity.id!.toString());

      // shouldWriteDetectionFinding=false skips the finding write entirely.
      expect(spies.insertJsonRows).not.toHaveBeenCalled();
      expect(spies.telemetryServiceFromName).not.toHaveBeenCalled();
    });

    test("shouldCreateAlert=false skips alert creation but still returns match counts", async () => {
      const rule: DetectionRule = buildRule({
        shouldCreateAlert: false,
        shouldWriteDetectionFinding: false,
      });

      const spies: EvaluationSpies = installSpies({
        groups: [buildGroup("alice", 2)],
        severities: [buildSeverity("0001", "Default")],
      });

      const result: DetectionRuleEvaluationResult =
        await DetectionRuleEvaluator.evaluateRule(rule);

      expect(result.matchedGroups).toBe(1);
      expect(result.alertsCreated).toBe(0);
      expect(spies.alertCreate).not.toHaveBeenCalled();
      expect(spies.alertFindBy).not.toHaveBeenCalled();
      expect(spies.severityFindBy).not.toHaveBeenCalled();
    });

    test("rejects when the rule is missing its YAML", async () => {
      const rule: DetectionRule = new DetectionRule();
      rule._id = RULE_ID.toString();
      rule.projectId = PROJECT_ID;

      installSpies();

      await expect(DetectionRuleEvaluator.evaluateRule(rule)).rejects.toThrow(
        "Detection rule is missing id, projectId, or YAML.",
      );
    });
  });

  describe("severity resolution precedence", () => {
    async function resolveSeverityFor(options: {
      level: string;
      severities: Array<AlertSeverity>;
      explicitSeverityId?: ObjectID;
    }): Promise<EvaluationSpies> {
      const rule: DetectionRule = buildRule({
        level: options.level,
        shouldWriteDetectionFinding: false,
        ...(options.explicitSeverityId
          ? { alertSeverityId: options.explicitSeverityId }
          : {}),
      });

      const spies: EvaluationSpies = installSpies({
        groups: [buildGroup("alice", 2)],
        severities: options.severities,
      });

      await DetectionRuleEvaluator.evaluateRule(rule);

      return spies;
    }

    test("an explicit rule severity that belongs to the project wins over a name match", async () => {
      const high: AlertSeverity = buildSeverity("0001", "High");
      const low: AlertSeverity = buildSeverity("0002", "Low");

      // Level high would name-match "High" — the explicit choice must win.
      const spies: EvaluationSpies = await resolveSeverityFor({
        level: "high",
        severities: [high, low],
        explicitSeverityId: low.id!,
      });

      expect(createdAlert(spies, 0).alertSeverityId?.toString()).toBe(
        low.id!.toString(),
      );
    });

    test("an explicit severity from another project is ignored and falls through", async () => {
      const first: AlertSeverity = buildSeverity("0001", "P1");
      const second: AlertSeverity = buildSeverity("0002", "P2");

      const spies: EvaluationSpies = await resolveSeverityFor({
        level: "high",
        severities: [first, second],
        explicitSeverityId: new ObjectID(
          "66666666-6666-4666-8666-666666666666",
        ),
      });

      // No name match for "high" → severe level falls back to first-by-order.
      expect(createdAlert(spies, 0).alertSeverityId?.toString()).toBe(
        first.id!.toString(),
      );
    });

    test("a project severity whose name matches the Sigma level is chosen", async () => {
      const first: AlertSeverity = buildSeverity("0001", "P1");
      const high: AlertSeverity = buildSeverity("0002", "High");
      const last: AlertSeverity = buildSeverity("0003", "P3");

      const spies: EvaluationSpies = await resolveSeverityFor({
        level: "high",
        severities: [first, high, last],
      });

      expect(createdAlert(spies, 0).alertSeverityId?.toString()).toBe(
        high.id!.toString(),
      );
    });

    test("critical with no name match falls back to the most severe (first by order)", async () => {
      const first: AlertSeverity = buildSeverity("0001", "P1");
      const last: AlertSeverity = buildSeverity("0002", "P2");

      const spies: EvaluationSpies = await resolveSeverityFor({
        level: "critical",
        severities: [first, last],
      });

      expect(createdAlert(spies, 0).alertSeverityId?.toString()).toBe(
        first.id!.toString(),
      );
    });

    test("low with no name match falls back to the least severe (last by order)", async () => {
      const first: AlertSeverity = buildSeverity("0001", "P1");
      const last: AlertSeverity = buildSeverity("0002", "P2");

      const spies: EvaluationSpies = await resolveSeverityFor({
        level: "low",
        severities: [first, last],
      });

      expect(createdAlert(spies, 0).alertSeverityId?.toString()).toBe(
        last.id!.toString(),
      );
    });

    test("informational with no name match falls back to the least severe", async () => {
      const first: AlertSeverity = buildSeverity("0001", "P1");
      const last: AlertSeverity = buildSeverity("0002", "P2");

      const spies: EvaluationSpies = await resolveSeverityFor({
        level: "informational",
        severities: [first, last],
      });

      expect(createdAlert(spies, 0).alertSeverityId?.toString()).toBe(
        last.id!.toString(),
      );
    });

    test("a project with no severities creates no alerts and warns", async () => {
      const rule: DetectionRule = buildRule({
        level: "high",
        shouldWriteDetectionFinding: false,
      });

      const spies: EvaluationSpies = installSpies({
        groups: [buildGroup("alice", 2)],
        severities: [],
      });

      const result: DetectionRuleEvaluationResult =
        await DetectionRuleEvaluator.evaluateRule(rule);

      expect(result.alertsCreated).toBe(0);
      expect(spies.alertCreate).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe("detection finding rows", () => {
    test("writes one Detection Finding row per matched group with rule provenance", async () => {
      const rule: DetectionRule = buildRule({
        level: "high",
        shouldCreateAlert: false,
      });

      const spies: EvaluationSpies = installSpies({
        groups: [buildGroup("alice", 3)],
      });

      const result: DetectionRuleEvaluationResult =
        await DetectionRuleEvaluator.evaluateRule(rule);

      expect(result.findingsWritten).toBe(1);
      expect(result.alertsCreated).toBe(0);

      expect(spies.telemetryServiceFromName).toHaveBeenCalledWith({
        serviceName: "OneUptime Detections",
        projectId: PROJECT_ID,
      });

      expect(spies.insertJsonRows).toHaveBeenCalledTimes(1);

      const rows: Array<JSONObject> = spies.insertJsonRows.mock
        .calls[0]?.[0] as Array<JSONObject>;

      expect(rows).toHaveLength(1);

      const row: JSONObject = rows[0]!;

      expect(row["classUid"]).toBe(2004);
      expect(row["className"]).toBe("Detection Finding");
      expect(row["ruleId"]).toBe(RULE_ID.toString());
      expect(row["ruleName"]).toBe("Brute Force Watch");
      expect(row["observables"]).toContain("alice");
      expect(row["message"]).toContain("Brute Force Watch");
      expect(row["message"]).toContain("alice");
      expect(row["projectId"]).toBe(PROJECT_ID.toString());
      expect(row["primaryEntityId"]).toBe(DETECTIONS_SERVICE_ID.toString());
      expect(row["severityName"]).toBe("High");
      expect(row["mitreTactics"]).toEqual(["TA0006"]);
      expect(row["mitreTechniques"]).toEqual(["T1110"]);
      expect(row["eventUid"]).toContain(`detection:${RULE_ID.toString()}:`);

      const attributes: JSONObject = row["attributes"] as JSONObject;

      expect(attributes["oneuptime.detection.rule_id"]).toBe(
        RULE_ID.toString(),
      );
      expect(attributes["oneuptime.detection.match_count"]).toBe("3");
      expect(attributes["oneuptime.detection.group_value"]).toBe("alice");
    });
  });

  describe("rule bookkeeping", () => {
    test("updates lastEvaluatedAt, lastMatchAt and clears lastError on matches", async () => {
      const rule: DetectionRule = buildRule({
        shouldWriteDetectionFinding: false,
      });

      const spies: EvaluationSpies = installSpies({
        groups: [buildGroup("alice", 2)],
        severities: [buildSeverity("0001", "Default")],
      });

      await DetectionRuleEvaluator.evaluateRule(rule);

      expect(spies.updateOneById).toHaveBeenCalledTimes(1);

      const updateArg: { id: ObjectID; data: JSONObject } = spies.updateOneById
        .mock.calls[0]?.[0] as { id: ObjectID; data: JSONObject };

      expect(updateArg.id.toString()).toBe(RULE_ID.toString());
      expect(updateArg.data["lastEvaluatedAt"]).toBeInstanceOf(Date);
      expect(updateArg.data["lastMatchAt"]).toBeInstanceOf(Date);
      expect(updateArg.data["lastError"]).toBeNull();
    });

    test("does not stamp lastMatchAt when nothing matched", async () => {
      const rule: DetectionRule = buildRule({
        shouldWriteDetectionFinding: false,
      });

      const spies: EvaluationSpies = installSpies({
        groups: [buildGroup("alice", 0)],
      });

      const result: DetectionRuleEvaluationResult =
        await DetectionRuleEvaluator.evaluateRule(rule);

      expect(result.matchedGroups).toBe(0);
      expect(result.alertsCreated).toBe(0);
      expect(spies.alertCreate).not.toHaveBeenCalled();
      expect(spies.insertJsonRows).not.toHaveBeenCalled();

      const updateArg: { id: ObjectID; data: JSONObject } = spies.updateOneById
        .mock.calls[0]?.[0] as { id: ObjectID; data: JSONObject };

      expect(updateArg.data["lastEvaluatedAt"]).toBeInstanceOf(Date);
      expect(updateArg.data["lastError"]).toBeNull();
      expect(
        Object.prototype.hasOwnProperty.call(updateArg.data, "lastMatchAt"),
      ).toBe(false);
    });
  });
});
