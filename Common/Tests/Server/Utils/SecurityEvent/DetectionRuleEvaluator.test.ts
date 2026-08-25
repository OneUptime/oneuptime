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
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../../../Models/DatabaseModels/IncidentSeverity";
import IncidentService from "../../../../Server/Services/IncidentService";
import IncidentSeverityService from "../../../../Server/Services/IncidentSeverityService";
import DetectionRuleService from "../../../../Server/Services/DetectionRuleService";
import SecurityEventService, {
  DetectionMatchGroup,
} from "../../../../Server/Services/SecurityEventService";
import OTelIngestService, {
  TelemetryServiceMetadata,
} from "../../../../Server/Services/OpenTelemetryIngestService";
import logger from "../../../../Server/Utils/Logger";
import { Statement } from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import MetricSeriesFingerprint from "../../../../Utils/Metrics/MetricSeriesFingerprint";
import ObjectID from "../../../../Types/ObjectID";
import OneUptimeDate from "../../../../Types/Date";
import ServiceType from "../../../../Types/Telemetry/ServiceType";
import { JSONObject } from "../../../../Types/JSON";
import Includes from "../../../../Types/BaseDatabase/Includes";
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
    shouldCreateIncident?: boolean;
    alertSeverityId?: ObjectID;
    incidentSeverityId?: ObjectID;
    lastEvaluatedAt?: Date;
    evaluationIntervalInMinutes?: number;
    id?: ObjectID;
    groupByField?: string;
    distinctCountField?: string;
    matchCountThreshold?: number;
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
  rule.groupByField = options.groupByField ?? "principalUser";

  if (options.distinctCountField !== undefined) {
    rule.distinctCountField = options.distinctCountField;
  }

  if (options.matchCountThreshold !== undefined) {
    rule.matchCountThreshold = options.matchCountThreshold;
  }

  if (options.shouldCreateAlert !== undefined) {
    rule.shouldCreateAlert = options.shouldCreateAlert;
  }

  if (options.shouldWriteDetectionFinding !== undefined) {
    rule.shouldWriteDetectionFinding = options.shouldWriteDetectionFinding;
  }

  if (options.shouldCreateIncident !== undefined) {
    rule.shouldCreateIncident = options.shouldCreateIncident;
  }

  if (options.alertSeverityId !== undefined) {
    rule.alertSeverityId = options.alertSeverityId;
  }

  if (options.incidentSeverityId !== undefined) {
    rule.incidentSeverityId = options.incidentSeverityId;
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
  distinctCount: number = 0,
): DetectionMatchGroup {
  return {
    groupValue,
    matchCount,
    distinctCount,
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

function buildIncidentSeverity(
  idSuffix: string,
  name: string,
): IncidentSeverity {
  const severity: IncidentSeverity = new IncidentSeverity();
  severity._id = `66666666-6666-4666-8666-66666666${idSuffix}`;
  severity.name = name;
  return severity;
}

function buildOpenIncident(fingerprint: string): Incident {
  const incident: Incident = new Incident();
  incident._id = "77777777-7777-4777-8777-777777777777";
  incident.seriesFingerprint = fingerprint;
  return incident;
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
  incidentFindBy: Spy;
  incidentCreate: Spy;
  incidentSeverityFindBy: Spy;
  updateOneById: Spy;
  telemetryServiceFromName: Spy;
}

function installSpies(
  options: {
    groups?: Array<DetectionMatchGroup>;
    severities?: Array<AlertSeverity>;
    openAlerts?: Array<Alert>;
    incidentSeverities?: Array<IncidentSeverity>;
    openIncidents?: Array<Incident>;
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

  const incidentFindBy: Spy = getJestSpyOn(
    IncidentService,
    "findBy",
  ).mockResolvedValue((options.openIncidents || []) as never);

  const incidentCreate: Spy = getJestSpyOn(
    IncidentService,
    "create",
  ).mockResolvedValue(new Incident() as never);

  const incidentSeverityFindBy: Spy = getJestSpyOn(
    IncidentSeverityService,
    "findBy",
  ).mockResolvedValue((options.incidentSeverities || []) as never);

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
    incidentFindBy,
    incidentCreate,
    incidentSeverityFindBy,
    updateOneById,
    telemetryServiceFromName,
  };
}

function createdAlert(spies: EvaluationSpies, index: number): Alert {
  const call: unknown = spies.alertCreate.mock.calls[index]?.[0];
  return (call as { data: Alert }).data;
}

function createdIncident(spies: EvaluationSpies, index: number): Incident {
  const call: unknown = spies.incidentCreate.mock.calls[index]?.[0];
  return (call as { data: Incident }).data;
}

interface FindDetectionMatchesArgs {
  projectId: ObjectID;
  startTime: Date;
  endTime: Date;
  whereFragment: Statement;
  groupByExpression: Statement | null;
  distinctCountExpression: Statement | null;
  minMatchCount: number;
  maxGroups: number;
}

function findMatchesArg(spies: EvaluationSpies): FindDetectionMatchesArgs {
  return spies.findDetectionMatches.mock
    .calls[0]?.[0] as FindDetectionMatchesArgs;
}

// The evaluator logs expected failures; keep test output clean.
function silenceLogger(): void {
  getJestSpyOn(logger, "error").mockImplementation((() => {
    return undefined;
  }) as never);
  getJestSpyOn(logger, "warn").mockImplementation((() => {
    return undefined;
  }) as never);
}

describe("DetectionRuleEvaluator", () => {
  beforeEach(() => {
    silenceLogger();
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
        incidentsCreated: 0,
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

  describe("incident creation", () => {
    /*
     * The gate is === true, the OPPOSITE of the alert path's !== false.
     * Incidents are the heavy machinery (on-call, SLAs, status pages) and
     * the column defaults to false — so unset must read as off. These
     * three tests pin the whole truth table.
     */
    test("does not open incidents when shouldCreateIncident is unset", async () => {
      const rule: DetectionRule = buildRule({
        shouldWriteDetectionFinding: false,
      });

      const spies: EvaluationSpies = installSpies({
        groups: [buildGroup("alice", 3)],
        severities: [buildSeverity("0001", "Default")],
        incidentSeverities: [buildIncidentSeverity("0001", "Default")],
      });

      const result: DetectionRuleEvaluationResult =
        await DetectionRuleEvaluator.evaluateRule(rule);

      expect(spies.incidentCreate).not.toHaveBeenCalled();
      expect(spies.incidentSeverityFindBy).not.toHaveBeenCalled();
      expect(result.incidentsCreated).toBe(0);
      // The alert path is untouched by the incident gate.
      expect(spies.alertCreate).toHaveBeenCalledTimes(1);
    });

    test("does not open incidents when shouldCreateIncident is explicitly false", async () => {
      const rule: DetectionRule = buildRule({
        shouldCreateIncident: false,
        shouldWriteDetectionFinding: false,
      });

      const spies: EvaluationSpies = installSpies({
        groups: [buildGroup("alice", 3)],
        severities: [buildSeverity("0001", "Default")],
        incidentSeverities: [buildIncidentSeverity("0001", "Default")],
      });

      await DetectionRuleEvaluator.evaluateRule(rule);

      expect(spies.incidentCreate).not.toHaveBeenCalled();
    });

    test("opens one incident per matched group when opted in", async () => {
      const rule: DetectionRule = buildRule({
        shouldCreateIncident: true,
        shouldWriteDetectionFinding: false,
      });

      const spies: EvaluationSpies = installSpies({
        groups: [buildGroup("alice", 3), buildGroup("bob", 1)],
        severities: [buildSeverity("0001", "Default")],
        incidentSeverities: [buildIncidentSeverity("0001", "Default")],
      });

      const result: DetectionRuleEvaluationResult =
        await DetectionRuleEvaluator.evaluateRule(rule);

      expect(result.incidentsCreated).toBe(2);
      expect(spies.incidentCreate).toHaveBeenCalledTimes(2);

      const first: Incident = createdIncident(spies, 0);

      expect(first.projectId?.toString()).toBe(PROJECT_ID.toString());
      expect(first.title).toBe("[Detection] Brute Force Watch — alice");
      expect(first.description).toContain(
        "Detection rule matched 3 security events",
      );
      expect(first.description).toContain("Watches for brute-force logins");
      expect(first.seriesFingerprint).toBe(expectedFingerprint("alice"));
      expect(first.isCreatedAutomatically).toBe(true);
      expect(first.rootCause).toBe(
        'Sigma detection rule "Brute Force Watch" matched security events.',
      );
      /*
       * Detection incidents carry no monitors — monitor-driven
       * auto-resolve must never touch them; the fingerprint dedupe is
       * what keeps a still-firing rule from stacking incidents.
       */
      expect(first.monitors).toBeUndefined();

      const createProps: unknown = spies.incidentCreate.mock.calls[0]?.[0];
      expect((createProps as { props: JSONObject }).props).toEqual({
        isRoot: true,
      });
    });

    test("incidents open even when the rule does not create alerts", async () => {
      const rule: DetectionRule = buildRule({
        shouldCreateAlert: false,
        shouldCreateIncident: true,
        shouldWriteDetectionFinding: false,
      });

      const spies: EvaluationSpies = installSpies({
        groups: [buildGroup("alice", 3)],
        incidentSeverities: [buildIncidentSeverity("0001", "Default")],
      });

      const result: DetectionRuleEvaluationResult =
        await DetectionRuleEvaluator.evaluateRule(rule);

      expect(spies.alertCreate).not.toHaveBeenCalled();
      expect(result.alertsCreated).toBe(0);
      expect(result.incidentsCreated).toBe(1);
    });

    test("alert and incident for the same group share one fingerprint and one summary", async () => {
      const rule: DetectionRule = buildRule({
        shouldCreateIncident: true,
        shouldWriteDetectionFinding: false,
      });

      const spies: EvaluationSpies = installSpies({
        groups: [buildGroup("alice", 3)],
        severities: [buildSeverity("0001", "Default")],
        incidentSeverities: [buildIncidentSeverity("0001", "Default")],
      });

      await DetectionRuleEvaluator.evaluateRule(rule);

      const alert: Alert = createdAlert(spies, 0);
      const incident: Incident = createdIncident(spies, 0);

      expect(incident.seriesFingerprint).toBe(alert.seriesFingerprint);
      expect(incident.title).toBe(alert.title);
      expect(incident.description).toBe(alert.description);
    });

    test("dedupes against unresolved incidents by fingerprint", async () => {
      const rule: DetectionRule = buildRule({
        shouldCreateIncident: true,
        shouldWriteDetectionFinding: false,
      });

      const spies: EvaluationSpies = installSpies({
        groups: [buildGroup("alice", 3), buildGroup("bob", 1)],
        severities: [buildSeverity("0001", "Default")],
        incidentSeverities: [buildIncidentSeverity("0001", "Default")],
        openIncidents: [buildOpenIncident(expectedFingerprint("alice"))],
      });

      const result: DetectionRuleEvaluationResult =
        await DetectionRuleEvaluator.evaluateRule(rule);

      // alice is already open; only bob gets a new incident.
      expect(result.incidentsCreated).toBe(1);
      expect(createdIncident(spies, 0).seriesFingerprint).toBe(
        expectedFingerprint("bob"),
      );

      /*
       * And the dedupe query is scoped to UNRESOLVED incidents carrying
       * THIS rule's candidate fingerprints — resolved incidents must be
       * allowed to re-open, and a project-wide scan would age still-open
       * detections out of the LIMIT_PER_PROJECT window and re-fire them.
       */
      const findByArg: JSONObject = spies.incidentFindBy.mock
        .calls[0]?.[0] as JSONObject;
      expect(findByArg["query"]).toEqual({
        projectId: PROJECT_ID,
        seriesFingerprint: new Includes([
          expectedFingerprint("alice"),
          expectedFingerprint("bob"),
        ]),
        currentIncidentState: {
          isResolvedState: false,
        },
      });
    });

    test("an incident fingerprint already open does NOT suppress the alert", async () => {
      /*
       * The two dedupe sets are independent: an open incident for a group
       * says nothing about whether an alert is open for it.
       */
      const rule: DetectionRule = buildRule({
        shouldCreateIncident: true,
        shouldWriteDetectionFinding: false,
      });

      installSpies({
        groups: [buildGroup("alice", 3)],
        severities: [buildSeverity("0001", "Default")],
        incidentSeverities: [buildIncidentSeverity("0001", "Default")],
        openIncidents: [buildOpenIncident(expectedFingerprint("alice"))],
      });

      const result: DetectionRuleEvaluationResult =
        await DetectionRuleEvaluator.evaluateRule(rule);

      expect(result.incidentsCreated).toBe(0);
      expect(result.alertsCreated).toBe(1);
    });

    test("one failing incident create logs and continues; the rest still open", async () => {
      const rule: DetectionRule = buildRule({
        shouldCreateIncident: true,
        shouldWriteDetectionFinding: false,
      });

      const spies: EvaluationSpies = installSpies({
        groups: [buildGroup("alice", 3), buildGroup("bob", 1)],
        severities: [buildSeverity("0001", "Default")],
        incidentSeverities: [buildIncidentSeverity("0001", "Default")],
      });

      /*
       * First create throws the way IncidentService.onBeforeCreate does
       * when a project has no "created" incident state — the one failure
       * mode that cannot be pre-checked.
       */
      spies.incidentCreate
        .mockRejectedValueOnce(
          new Error("Created incident state not found for this project"),
        )
        .mockResolvedValue(new Incident() as never);

      const result: DetectionRuleEvaluationResult =
        await DetectionRuleEvaluator.evaluateRule(rule);

      expect(result.incidentsCreated).toBe(1);
      expect(result.error).toBeNull();
      expect(spies.incidentCreate).toHaveBeenCalledTimes(2);
    });
  });

  describe("incident severity resolution", () => {
    test("uses the rule's explicit incident severity when it belongs to the project", async () => {
      const explicit: IncidentSeverity = buildIncidentSeverity("0002", "SEV-2");

      const rule: DetectionRule = buildRule({
        shouldCreateIncident: true,
        shouldWriteDetectionFinding: false,
        incidentSeverityId: new ObjectID(explicit._id!),
      });

      const spies: EvaluationSpies = installSpies({
        groups: [buildGroup("alice", 1)],
        severities: [buildSeverity("0001", "Default")],
        incidentSeverities: [
          buildIncidentSeverity("0001", "SEV-1"),
          explicit,
          buildIncidentSeverity("0003", "SEV-3"),
        ],
      });

      await DetectionRuleEvaluator.evaluateRule(rule);

      expect(createdIncident(spies, 0).incidentSeverityId?.toString()).toBe(
        explicit._id,
      );
    });

    test("an explicit id not in the project falls through to the level name match", async () => {
      const rule: DetectionRule = buildRule({
        level: "high",
        shouldCreateIncident: true,
        shouldWriteDetectionFinding: false,
        incidentSeverityId: new ObjectID(
          "99999999-0000-4000-8000-000000000000",
        ),
      });

      const named: IncidentSeverity = buildIncidentSeverity("0002", "High");

      const spies: EvaluationSpies = installSpies({
        groups: [buildGroup("alice", 1)],
        severities: [buildSeverity("0001", "Default")],
        incidentSeverities: [buildIncidentSeverity("0001", "SEV-1"), named],
      });

      await DetectionRuleEvaluator.evaluateRule(rule);

      expect(createdIncident(spies, 0).incidentSeverityId?.toString()).toBe(
        named._id,
      );
    });

    test("critical maps to the most severe (first) incident severity by rank", async () => {
      const rule: DetectionRule = buildRule({
        level: "critical",
        shouldCreateIncident: true,
        shouldWriteDetectionFinding: false,
      });

      const first: IncidentSeverity = buildIncidentSeverity("0001", "SEV-1");

      const spies: EvaluationSpies = installSpies({
        groups: [buildGroup("alice", 1)],
        severities: [buildSeverity("0001", "Default")],
        incidentSeverities: [first, buildIncidentSeverity("0002", "SEV-2")],
      });

      await DetectionRuleEvaluator.evaluateRule(rule);

      expect(createdIncident(spies, 0).incidentSeverityId?.toString()).toBe(
        first._id,
      );
    });

    test("low maps to the least severe (last) incident severity by rank", async () => {
      const rule: DetectionRule = buildRule({
        level: "low",
        shouldCreateIncident: true,
        shouldWriteDetectionFinding: false,
      });

      const last: IncidentSeverity = buildIncidentSeverity("0003", "SEV-3");

      const spies: EvaluationSpies = installSpies({
        groups: [buildGroup("alice", 1)],
        severities: [buildSeverity("0001", "Default")],
        incidentSeverities: [
          buildIncidentSeverity("0001", "SEV-1"),
          buildIncidentSeverity("0002", "SEV-2"),
          last,
        ],
      });

      await DetectionRuleEvaluator.evaluateRule(rule);

      expect(createdIncident(spies, 0).incidentSeverityId?.toString()).toBe(
        last._id,
      );
    });

    test("a project with no incident severities skips incidents but keeps alerts", async () => {
      const rule: DetectionRule = buildRule({
        shouldCreateIncident: true,
        shouldWriteDetectionFinding: false,
      });

      const spies: EvaluationSpies = installSpies({
        groups: [buildGroup("alice", 1)],
        severities: [buildSeverity("0001", "Default")],
        incidentSeverities: [],
      });

      const result: DetectionRuleEvaluationResult =
        await DetectionRuleEvaluator.evaluateRule(rule);

      expect(result.incidentsCreated).toBe(0);
      expect(spies.incidentCreate).not.toHaveBeenCalled();
      expect(result.alertsCreated).toBe(1);
      expect(result.error).toBeNull();
    });
  });

  describe("evaluateAllDueRules field selection", () => {
    test("selects the incident columns so opted-in rules do not read as off", async () => {
      /*
       * The gate is === true, so a rule fetched WITHOUT
       * shouldCreateIncident in the select silently never opens
       * incidents — this is the drift that would break the feature
       * without failing anything else.
       */
      const rulesFindBy: Spy = getJestSpyOn(
        DetectionRuleService,
        "findBy",
      ).mockResolvedValue([] as never);

      await DetectionRuleEvaluator.evaluateAllDueRules();

      const select: JSONObject = (
        rulesFindBy.mock.calls[0]?.[0] as { select: JSONObject }
      ).select;

      expect(select["shouldCreateIncident"]).toBe(true);
      expect(select["incidentSeverityId"]).toBe(true);
      expect(select["shouldCreateAlert"]).toBe(true);
      expect(select["alertSeverityId"]).toBe(true);
    });

    test("selects the distinct-count columns so thresholds do not silently read as 1", async () => {
      /*
       * Same drift as the incident columns: a rule fetched WITHOUT
       * matchCountThreshold in the select falls back to the
       * fire-on-any-match default, and one fetched without
       * distinctCountField silently thresholds the raw count instead of
       * the distinct count — neither failure trips any other assertion.
       */
      const rulesFindBy: Spy = getJestSpyOn(
        DetectionRuleService,
        "findBy",
      ).mockResolvedValue([] as never);

      await DetectionRuleEvaluator.evaluateAllDueRules();

      const select: JSONObject = (
        rulesFindBy.mock.calls[0]?.[0] as { select: JSONObject }
      ).select;

      expect(select["distinctCountField"]).toBe(true);
      expect(select["matchCountThreshold"]).toBe(true);
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

  describe("distinct count and match count threshold", () => {
    /*
     * matchCountThreshold holds a rule back until a group reaches N
     * events, and distinctCountField switches what N counts: raw
     * matches, or uniqExact of one field. The ClickHouse HAVING clause
     * already enforces the threshold server-side, but the evaluator
     * re-filters so the firing contract does not depend on which side
     * built the rows — these tests pin that in-process filter plus the
     * exact query contract handed to SecurityEventService.
     */
    test("threshold on the raw count path: only groups at/above it fire and totalMatches sums firing groups only", async () => {
      const rule: DetectionRule = buildRule({
        matchCountThreshold: 3,
        shouldWriteDetectionFinding: false,
      });

      const spies: EvaluationSpies = installSpies({
        groups: [
          buildGroup("alice", 5),
          buildGroup("bob", 2), // below threshold — must not fire
          buildGroup("carol", 3), // exactly at threshold — fires
        ],
        severities: [buildSeverity("0001", "Default")],
      });

      const result: DetectionRuleEvaluationResult =
        await DetectionRuleEvaluator.evaluateRule(rule);

      expect(result.matchedGroups).toBe(2);
      // 5 + 3; bob's 2 sub-threshold events are not "matches" at all.
      expect(result.totalMatches).toBe(8);
      expect(result.alertsCreated).toBe(2);

      const alertFingerprints: Array<string | undefined> = [
        createdAlert(spies, 0).seriesFingerprint,
        createdAlert(spies, 1).seriesFingerprint,
      ];

      expect(alertFingerprints).toContain(expectedFingerprint("alice"));
      expect(alertFingerprints).toContain(expectedFingerprint("carol"));
      expect(alertFingerprints).not.toContain(expectedFingerprint("bob"));
    });

    test("an unset threshold behaves as 1 — pre-threshold rules keep firing on any match", async () => {
      const rule: DetectionRule = buildRule({
        shouldWriteDetectionFinding: false,
      });

      const spies: EvaluationSpies = installSpies({
        groups: [buildGroup("alice", 1)],
        severities: [buildSeverity("0001", "Default")],
      });

      const result: DetectionRuleEvaluationResult =
        await DetectionRuleEvaluator.evaluateRule(rule);

      expect(result.matchedGroups).toBe(1);
      expect(result.alertsCreated).toBe(1);
      expect(findMatchesArg(spies).minMatchCount).toBe(1);
    });

    test("a threshold of 0 behaves as 1, not as fire-on-nothing", async () => {
      const rule: DetectionRule = buildRule({
        matchCountThreshold: 0,
        shouldWriteDetectionFinding: false,
      });

      const spies: EvaluationSpies = installSpies({
        groups: [buildGroup("alice", 1)],
        severities: [buildSeverity("0001", "Default")],
      });

      const result: DetectionRuleEvaluationResult =
        await DetectionRuleEvaluator.evaluateRule(rule);

      expect(result.matchedGroups).toBe(1);
      expect(result.alertsCreated).toBe(1);
      // The clamp happens before the query, not just in the re-filter.
      expect(findMatchesArg(spies).minMatchCount).toBe(1);
    });

    test("a distinct-count rule fires on distinctCount, not matchCount", async () => {
      const rule: DetectionRule = buildRule({
        distinctCountField: "principalIp",
        matchCountThreshold: 5,
        shouldWriteDetectionFinding: false,
      });

      const spies: EvaluationSpies = installSpies({
        groups: [
          // 50 raw matches from only 2 IPs — noisy, not distributed.
          buildGroup("alice", 50, 2),
          // 6 raw matches from 5 IPs — under on raw count, fires on distinct.
          buildGroup("bob", 6, 5),
        ],
        severities: [buildSeverity("0001", "Default")],
      });

      const result: DetectionRuleEvaluationResult =
        await DetectionRuleEvaluator.evaluateRule(rule);

      expect(result.matchedGroups).toBe(1);
      expect(result.totalMatches).toBe(6);
      expect(result.alertsCreated).toBe(1);
      expect(createdAlert(spies, 0).seriesFingerprint).toBe(
        expectedFingerprint("bob"),
      );
    });

    test("a group with zero matches never fires even when distinctCount clears the threshold", async () => {
      const rule: DetectionRule = buildRule({
        distinctCountField: "principalIp",
        matchCountThreshold: 5,
        shouldWriteDetectionFinding: false,
      });

      const spies: EvaluationSpies = installSpies({
        // Nonsense a buggy query could emit: distinct 7 over 0 rows.
        groups: [buildGroup("alice", 0, 7)],
        severities: [buildSeverity("0001", "Default")],
      });

      const result: DetectionRuleEvaluationResult =
        await DetectionRuleEvaluator.evaluateRule(rule);

      expect(result.matchedGroups).toBe(0);
      expect(result.totalMatches).toBe(0);
      expect(spies.alertCreate).not.toHaveBeenCalled();
    });

    test("a plain rule queries with a null distinct expression, its threshold, and the existing group contract", async () => {
      const rule: DetectionRule = buildRule({
        matchCountThreshold: 4,
        shouldWriteDetectionFinding: false,
      });

      const spies: EvaluationSpies = installSpies();

      await DetectionRuleEvaluator.evaluateRule(rule);

      const args: FindDetectionMatchesArgs = findMatchesArg(spies);

      expect(args.projectId.toString()).toBe(PROJECT_ID.toString());
      expect(args.minMatchCount).toBe(4);
      expect(args.distinctCountExpression).toBeNull();
      // groupByField still compiles to an expression; maxGroups is intact.
      expect(args.groupByExpression).toBeInstanceOf(Statement);
      expect(args.maxGroups).toBe(100);
    });

    test("a distinct-count rule queries with a compiled Statement for the distinct field", async () => {
      const rule: DetectionRule = buildRule({
        distinctCountField: "principalIp",
        matchCountThreshold: 5,
        shouldWriteDetectionFinding: false,
      });

      const spies: EvaluationSpies = installSpies();

      await DetectionRuleEvaluator.evaluateRule(rule);

      const args: FindDetectionMatchesArgs = findMatchesArg(spies);

      expect(args.distinctCountExpression).toBeInstanceOf(Statement);
      expect(args.minMatchCount).toBe(5);
      expect(args.groupByExpression).toBeInstanceOf(Statement);
    });

    test("a distinct rule's alert description explains the distinct count and threshold; a plain rule's never says distinct", async () => {
      const distinctRule: DetectionRule = buildRule({
        distinctCountField: "principalIp",
        matchCountThreshold: 5,
        shouldWriteDetectionFinding: false,
      });

      const distinctSpies: EvaluationSpies = installSpies({
        groups: [buildGroup("alice", 6, 5)],
        severities: [buildSeverity("0001", "Default")],
      });

      await DetectionRuleEvaluator.evaluateRule(distinctRule);

      expect(createdAlert(distinctSpies, 0).description).toContain(
        "5 distinct principalIp values across these events (rule threshold: 5).",
      );

      // Fresh spies for the second rule so call indices restart at 0.
      jest.restoreAllMocks();
      silenceLogger();

      const plainRule: DetectionRule = buildRule({
        shouldWriteDetectionFinding: false,
      });

      const plainSpies: EvaluationSpies = installSpies({
        groups: [buildGroup("alice", 6)],
        severities: [buildSeverity("0001", "Default")],
      });

      await DetectionRuleEvaluator.evaluateRule(plainRule);

      expect(createdAlert(plainSpies, 0).description).not.toContain("distinct");
    });

    test("findings carry the distinct-count attribute and message suffix only for distinct rules", async () => {
      const distinctRule: DetectionRule = buildRule({
        distinctCountField: "principalIp",
        matchCountThreshold: 5,
        shouldCreateAlert: false,
      });

      const distinctSpies: EvaluationSpies = installSpies({
        groups: [buildGroup("alice", 6, 5)],
      });

      await DetectionRuleEvaluator.evaluateRule(distinctRule);

      const distinctRow: JSONObject = (
        distinctSpies.insertJsonRows.mock.calls[0]?.[0] as Array<JSONObject>
      )[0]!;

      expect(
        (distinctRow["attributes"] as JSONObject)[
          "oneuptime.detection.distinct_count"
        ],
      ).toBe("5");
      expect(distinctRow["message"]).toContain(
        "(6 events, 5 distinct principalIp)",
      );

      // Fresh spies for the second rule so call indices restart at 0.
      jest.restoreAllMocks();
      silenceLogger();

      const plainRule: DetectionRule = buildRule({
        shouldCreateAlert: false,
      });

      const plainSpies: EvaluationSpies = installSpies({
        groups: [buildGroup("alice", 6)],
      });

      await DetectionRuleEvaluator.evaluateRule(plainRule);

      const plainRow: JSONObject = (
        plainSpies.insertJsonRows.mock.calls[0]?.[0] as Array<JSONObject>
      )[0]!;

      /*
       * Absent, not "0": consumers filter on attribute presence, and a
       * plain rule has no distinct semantics to report.
       */
      expect(
        Object.prototype.hasOwnProperty.call(
          plainRow["attributes"] as JSONObject,
          "oneuptime.detection.distinct_count",
        ),
      ).toBe(false);
      expect(plainRow["message"]).not.toContain("distinct");
    });

    test("flagship: distinct usernames per source IP — one qualifying group, one alert, one finding", async () => {
      /*
       * The scenario the feature was built for: password spraying.
       * Group by attacker IP, count distinct usernames tried, fire at 5.
       * One IP hammered a single account 40 times (lockout noise, not a
       * spray); another tried 6 accounts across 9 events.
       */
      const rule: DetectionRule = buildRule({
        groupByField: "principalIp",
        distinctCountField: "principalUser",
        matchCountThreshold: 5,
      });

      const spies: EvaluationSpies = installSpies({
        groups: [
          buildGroup("203.0.113.7", 9, 6),
          buildGroup("198.51.100.4", 40, 1),
        ],
        severities: [buildSeverity("0001", "High")],
      });

      const result: DetectionRuleEvaluationResult =
        await DetectionRuleEvaluator.evaluateRule(rule);

      expect(result.matchedGroups).toBe(1);
      expect(result.totalMatches).toBe(9);
      expect(result.alertsCreated).toBe(1);
      expect(result.findingsWritten).toBe(1);
      expect(result.error).toBeNull();

      // The query was built from the rule's three knobs.
      const args: FindDetectionMatchesArgs = findMatchesArg(spies);
      expect(args.groupByExpression).toBeInstanceOf(Statement);
      expect(args.distinctCountExpression).toBeInstanceOf(Statement);
      expect(args.minMatchCount).toBe(5);

      const alert: Alert = createdAlert(spies, 0);

      expect(alert.title).toContain("203.0.113.7");
      expect(alert.seriesFingerprint).toBe(expectedFingerprint("203.0.113.7"));
      expect(alert.description).toContain(
        "6 distinct principalUser values across these events (rule threshold: 5).",
      );

      const rows: Array<JSONObject> = spies.insertJsonRows.mock
        .calls[0]?.[0] as Array<JSONObject>;

      expect(rows).toHaveLength(1);

      const row: JSONObject = rows[0]!;
      const attributes: JSONObject = row["attributes"] as JSONObject;

      expect(attributes["oneuptime.detection.group_value"]).toBe("203.0.113.7");
      expect(attributes["oneuptime.detection.match_count"]).toBe("9");
      expect(attributes["oneuptime.detection.distinct_count"]).toBe("6");
      expect(row["message"]).toContain(
        "Detection: Brute Force Watch — 203.0.113.7 (9 events, 6 distinct principalUser)",
      );
    });
  });
});
