import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import SecurityEvent, {
  SECURITY_EVENT_CREATED_AT_INDEX_NAME,
} from "Common/Models/AnalyticsModels/SecurityEvent";
import Alert from "Common/Models/DatabaseModels/Alert";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import DetectionRule from "Common/Models/DatabaseModels/DetectionRule";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import Semaphore from "Common/Server/Infrastructure/Semaphore";
import AlertService from "Common/Server/Services/AlertService";
import AlertSeverityService from "Common/Server/Services/AlertSeverityService";
import AlertStateService from "Common/Server/Services/AlertStateService";
import DetectionRuleExceptionService from "Common/Server/Services/DetectionRuleExceptionService";
import DetectionRuleService from "Common/Server/Services/DetectionRuleService";
import OTelIngestService, {
  TelemetryServiceMetadata,
} from "Common/Server/Services/OpenTelemetryIngestService";
import SecurityEventService, {
  DetectionArrivalWindow,
  isDetectionArrivalCandidate,
} from "Common/Server/Services/SecurityEventService";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import SecurityCaseIngest, {
  SecurityCaseIngestResult,
  SecurityDetectionSignal,
} from "Common/Server/Utils/SecurityCase/SecurityCaseIngest";
import SecurityConnections from "Common/Server/Utils/SecurityEvent/Connections/SecurityConnections";
import DetectionRuleEvaluator, {
  getArrivalEventTimeBounds,
} from "Common/Server/Utils/SecurityEvent/DetectionRuleEvaluator";
import SecurityEntityRiskRecorder from "Common/Server/Utils/SecurityEvent/EntityRisk/SecurityEntityRiskRecorder";
import { SecurityRiskFinding } from "Common/Server/Utils/SecurityEvent/EntityRisk/SecurityEntityRiskFindings";
import {
  hasTakenFiring,
  takeFiring,
} from "Common/Types/SecurityCase/SecurityFiringKeys";
import { SecurityEntityRiskContribution } from "Common/Types/SecurityCase/SecurityEntityRisk";
import { addRiskObservation } from "Common/Utils/SecurityCase/SecurityEntityRiskScore";
import SigmaClickhouseCompiler from "Common/Server/Utils/SecurityEvent/Sigma/SigmaClickhouseCompiler";
import Includes from "Common/Types/BaseDatabase/Includes";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { SecurityDetectionMatchedEvent } from "Common/Types/SecurityCase/SecurityDetectionMatchedEvents";
import {
  DETECTION_LATE_EVENT_WINDOW_IN_MINUTES,
  DETECTION_MAX_WINDOWS_PER_RUN,
} from "Common/Types/SecurityEvent/DetectionFindingConstants";
import { DetectionRuleDefinition } from "Common/Types/SecurityEvent/SigmaCorrelation";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import SigmaRuleSetParser from "Common/Utils/SecurityEvent/Sigma/SigmaRuleSetParser";
import SecurityHunt from "Common/Models/DatabaseModels/SecurityHunt";
import SecurityHuntRun from "Common/Models/DatabaseModels/SecurityHuntRun";
import DatabaseConfig from "Common/Server/DatabaseConfig";
import ModelPermission from "Common/Server/Types/AnalyticsDatabase/ModelPermission";
import AccessTokenService from "Common/Server/Services/AccessTokenService";
import SecurityHuntRunService from "Common/Server/Services/SecurityHuntRunService";
import SecurityHuntService from "Common/Server/Services/SecurityHuntService";
import CallerPlan from "Common/Server/Utils/Billing/CallerPlan";
import SecurityHuntNotifications, {
  getHuntLinkInDashboard,
} from "Common/Server/Utils/SecurityEvent/Hunts/SecurityHuntNotifications";
import SecurityHuntScheduler, {
  SecurityHuntRunOutcome,
} from "Common/Server/Utils/SecurityEvent/Hunts/SecurityHuntScheduler";
import OneUptimeURL from "Common/Types/API/URL";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Query from "Common/Types/BaseDatabase/Query";
import Permission from "Common/Types/Permission";
import {
  SECURITY_EVENT_ARRIVAL_QUERY_KEY,
  SecurityEventArrivalRange,
  readSecurityEventArrivalRangeFromSearch,
  toSecurityEventArrivalQueryValue,
} from "Common/Types/SecurityEvent/SecurityEventArrival";
import {
  SecurityHuntRunWindow,
  SecurityHuntSchedule,
  getSecurityHuntSearchStart,
  securityHuntFiltersToMap,
} from "Common/Types/SecurityEvent/SecurityHunt";
import { buildSecurityEventSearchQuery } from "Common/Utils/SecurityEvent/SecurityEventSearch";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * ------------------------------------------------------------------
 * A scheduled detection rule judges every security event once, however
 * late it lands (#10337), read against a real ClickHouse server.
 *
 * Each test is a project of its own, run minute by minute on a clock the
 * test moves: every minute the events that have arrived by then are
 * written - each with the time it happened and, as its createdAt, the
 * time it arrived - and the project's turn runs, as the cron runs it. The
 * rules, alerts and cases live in memory, deduplicated the way their
 * services deduplicate them (an alert per fingerprint while it is open, a
 * case per fingerprint while it is open); the events, the rules' reads and
 * their Detection Findings are ClickHouse's.
 *
 *   on time, late, very      every event judged once, by the run after it
 *   late, out of order       arrived, and none a day later than that
 *   a rule that counts       a window fires once, whether the events that
 *                            make its count arrive on time, late, across
 *                            runs or out of order, and not again for more
 *   alerts and cases         opened once, never again on a later pass
 *   restarts                 a run that fails, or stops before it records
 *                            where it got to, loses nothing
 *   overlapping turns        two turns at once, or one that read the rule
 *                            before another ran it, judge an event once
 *   correlations, the        judge late events the same way
 *   handover to real time
 *   a backlog                read a dozen windows at a time, in one turn
 *   the cost                 at a realistic volume, the extra reads are at
 *                            most a granule for each late event, and the
 *                            index on createdAt is what keeps them so
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server,
 * credentials in the URL:
 *
 *   docker run -d --rm --name detection-arrivals-ch -p 18126:8123 \
 *     -e CLICKHOUSE_PASSWORD=test clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18126 \
 *     npx jest Tests/Telemetry/DetectionRuleArrivalsClickhouse.test.ts
 *
 * The suite creates and drops only its own uniquely named database. The
 * App Test workflow provides the server, and the guard at the bottom fails
 * the run there if it ever goes missing.
 * ------------------------------------------------------------------
 */

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(600000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `detection_arrivals_test_${process.pid}_${Date.now()}`;

const SECOND: number = 1000;
const MINUTE: number = 60 * SECOND;
const HOUR: number = 60 * MINUTE;

// Every test's minute 0: on the hour, a day back, so a day of history fits after it.
const BASE: Date = new Date(Math.floor(Date.now() / HOUR) * HOUR - 26 * HOUR);

function at(minute: number, second: number = 0): Date {
  return new Date(BASE.getTime() + minute * MINUTE + second * SECOND);
}

const OPEN_ALERT_STATE_ID: ObjectID = ObjectID.generate();

const TABLE_NAME: string = new SecurityEvent().tableName;

// What a part of the table holds per granule, as the server is configured by default.
const INDEX_GRANULARITY: number = 8192;

const FAILED_SIGN_IN: string = `title: Failed sign-in
id: 7c0f2a51-0000-4000-8000-000000010337
level: high
detection:
  selection:
    className: Authentication
    statusName: Failure
  condition: selection
`;

// Failures, then a success, from one address, within ten minutes.
const FAILED_THEN_SUCCEEDED: string = `title: Failed sign-in
id: 7c0f2a51-0000-4000-8000-000000010338
name: failed_sign_in
level: low
detection:
  selection:
    className: Authentication
    statusName: Failure
  condition: selection
---
title: Successful sign-in
id: 7c0f2a51-0000-4000-8000-000000010339
name: successful_sign_in
level: low
detection:
  selection:
    className: Authentication
    statusName: Success
  condition: selection
---
title: Failed then successful sign-in
id: 7c0f2a51-0000-4000-8000-000000010340
level: high
correlation:
  type: temporal_ordered
  rules:
    - failed_sign_in
    - successful_sign_in
  group-by:
    - principalIp
  timespan: 10m
`;

// Three failures from one address within five minutes.
const THREE_FAILURES: string = `title: Failed sign-in
id: 7c0f2a51-0000-4000-8000-000000010341
name: failed_sign_in
level: low
detection:
  selection:
    className: Authentication
    statusName: Failure
  condition: selection
---
title: Three failed sign-ins from one address
id: 7c0f2a51-0000-4000-8000-000000010342
level: high
correlation:
  type: event_count
  rules:
    - failed_sign_in
  group-by:
    - principalIp
  timespan: 5m
  condition:
    gte: 3
`;

// One event as it reaches OneUptime: when it happened, and when it arrived.
interface ArrivingEvent {
  uid: string;
  time: Date;
  arrivesAt: Date;
  principalIp?: string | undefined;
  principalUser?: string | undefined;
  statusName?: string | undefined;
}

interface StoredAlert {
  fingerprint: string;
  open: boolean;
}

// A case's detection as the case side recorded it, and the minute of the clock it came in.
interface RecordedSignal {
  signal: SecurityDetectionSignal;
  at: Date;
  repeat: boolean;
}

/*
 * One project's world: its rules as the rule service keeps them, its alerts
 * and cases, the clock, and the events still on their way.
 */
class World {
  public readonly projectId: ObjectID = ObjectID.generate();
  public readonly sourceId: ObjectID = ObjectID.generate();
  public clock: Date = at(0);
  public readonly rules: Map<string, DetectionRule> = new Map();
  public readonly alerts: Array<StoredAlert> = [];
  public readonly openCases: Set<string> = new Set();
  public casesOpened: number = 0;
  public readonly recorded: Array<RecordedSignal> = [];
  public readonly pending: Array<ArrivingEvent> = [];
  // Where each run said the rule got to, in order.
  public readonly cursorWrites: Array<Date> = [];
  // Each stretch marked before it did what it found (#10489): where it starts, how far it judged.
  public readonly marks: Array<{ from: Date; until: Date }> = [];
  // The firings each open case's detection took, by fingerprint, as the case side keeps them.
  public readonly takenFirings: Map<string, Array<string>> = new Map();
  // What each run handed to entity risk.
  public readonly riskFindings: Array<SecurityRiskFinding> = [];
  public turns: number = 0;
  // A worker that stops: the next findings write, or the next record of where a run got to, fails.
  public failNextFindingWrite: boolean = false;
  public failNextCursorWrite: boolean = false;
  // Runs once, between a turn's read of the rules and its use of them.
  public beforeRulesReturned: (() => Promise<void>) | null = null;
}

let world: World = new World();

type ConnectableService = {
  database: ClickhouseDatabase;
  databaseClient: ClickhouseClient | null;
};

const service: ConnectableService =
  SecurityEventService as unknown as ConnectableService;

let client: ClickhouseClient;

// The model's own table under a plain MergeTree (no Keeper on a disposable server).
async function createTable(data: {
  clickhouse: ClickhouseDatabase;
  modelType: { new (): AnalyticsBaseModel };
  tableName?: string | undefined;
  withoutCreatedAtIndex?: boolean | undefined;
}): Promise<void> {
  const model: AnalyticsBaseModel = new data.modelType();
  const generator: StatementGenerator<AnalyticsBaseModel> =
    new StatementGenerator<AnalyticsBaseModel>({
      modelType: data.modelType,
      database: data.clickhouse,
    });
  const columns: Statement = generator.toColumnsCreateStatement(
    model.tableColumns.map((column: AnalyticsTableColumnLike) => {
      // An install from before the index: the column as it was.
      if (
        data.withoutCreatedAtIndex &&
        column.skipIndex?.name === SECURITY_EVENT_CREATED_AT_INDEX_NAME
      ) {
        const copy: AnalyticsTableColumnLike = Object.create(
          Object.getPrototypeOf(column),
        );
        Object.assign(copy, column);
        copy.skipIndex = undefined;
        return copy;
      }

      return column;
    }) as typeof model.tableColumns,
  );

  await client.command({
    query: `CREATE TABLE ${database}.${data.tableName || model.tableName} (${columns.query}) ENGINE = MergeTree PARTITION BY (${model.partitionKey}) ORDER BY (${model.sortKeys.join(", ")})`,
    query_params: columns.query_params,
  });
}

type AnalyticsTableColumnLike = AnalyticsBaseModel["tableColumns"][number];

function eventRow(event: ArrivingEvent): JSONObject {
  const attributes: Record<string, string> = {
    "oneuptime.log.id": `log-${event.uid}`,
  };

  return {
    _id: ObjectID.generateTimeOrdered().toString(),
    projectId: world.projectId.toString(),
    primaryEntityId: world.sourceId.toString(),
    primaryEntityType: ServiceType.OpenTelemetry,
    time: OneUptimeDate.toClickhouseDateTime64(event.time),
    createdAt: OneUptimeDate.toClickhouseDateTime(event.arrivesAt),
    eventUid: event.uid,
    classUid: 3002,
    className: "Authentication",
    statusName: event.statusName ?? "Failure",
    severityId: 3,
    severityName: "Medium",
    message: `Sign-in ${event.uid}`,
    principalIp: event.principalIp ?? "",
    principalUser: event.principalUser ?? "",
    observables: [event.principalIp ?? ""].filter((value: string): boolean => {
      return value.length > 0;
    }),
    attributes,
    attributeKeys: Object.keys(attributes),
    retentionDate: OneUptimeDate.toClickhouseDateTime(
      new Date(Date.now() + 30 * 24 * HOUR),
    ),
  };
}

// Writes the events that have arrived by the clock, as they would have been written.
async function writeArrived(): Promise<void> {
  const arrived: Array<ArrivingEvent> = world.pending.filter(
    (event: ArrivingEvent): boolean => {
      return event.arrivesAt.getTime() <= world.clock.getTime();
    },
  );

  if (arrived.length === 0) {
    return;
  }

  for (const event of arrived) {
    world.pending.splice(world.pending.indexOf(event), 1);
  }

  await client.insert({
    table: `${database}.${TABLE_NAME}`,
    values: arrived.map(eventRow),
    format: "JSONEachRow",
  });
}

function arrive(...events: Array<ArrivingEvent>): void {
  world.pending.push(...events);
}

function addRule(options: {
  name: string;
  intervalInMinutes: number;
  groupByField?: string | undefined;
  matchCountThreshold?: number | undefined;
  distinctCountField?: string | undefined;
  yaml?: string | undefined;
  lastEvaluatedAt?: Date | undefined;
  shouldCreateAlert?: boolean | undefined;
  isRealTime?: boolean | undefined;
  // The rule's Risk Points: none unless a test says (0 adds no risk).
  riskScore?: number | undefined;
}): DetectionRule {
  const rule: DetectionRule = new DetectionRule();
  rule._id = ObjectID.generate().toString();
  rule.projectId = world.projectId;
  rule.name = options.name;
  rule.sigmaRuleYaml = options.yaml ?? FAILED_SIGN_IN;
  rule.isEnabled = true;
  rule.isRealTime = options.isRealTime ?? false;
  rule.evaluationIntervalInMinutes = options.intervalInMinutes;
  rule.groupByField = options.groupByField ?? "principalIp";
  rule.matchCountThreshold = options.matchCountThreshold ?? 1;
  rule.shouldCreateAlert = options.shouldCreateAlert ?? false;
  rule.shouldCreateIncident = false;
  rule.shouldWriteDetectionFinding = true;
  rule.shouldCreateCase = true;
  rule.riskScore = options.riskScore ?? 0;

  if (options.distinctCountField) {
    rule.distinctCountField = options.distinctCountField;
  }

  if (options.lastEvaluatedAt) {
    rule.lastEvaluatedAt = options.lastEvaluatedAt;
  }

  world.rules.set(rule._id, rule);

  return rule;
}

// A copy, as each read of the rule service hands one.
function copyOf(rule: DetectionRule): DetectionRule {
  const copy: DetectionRule = new DetectionRule();

  for (const key of [
    "_id",
    "projectId",
    "name",
    "description",
    "sigmaRuleYaml",
    "isEnabled",
    "isRealTime",
    "evaluationIntervalInMinutes",
    "groupByField",
    "distinctCountField",
    "matchCountThreshold",
    "shouldCreateAlert",
    "shouldCreateIncident",
    "shouldWriteDetectionFinding",
    "shouldCreateCase",
    "riskScore",
    "lastEvaluatedAt",
    "evaluatingUntil",
    "lastMatchAt",
    "lastError",
  ]) {
    (copy as unknown as JSONObject)[key] = (rule as unknown as JSONObject)[key];
  }

  return copy;
}

function storedRule(id: unknown): DetectionRule {
  const rule: DetectionRule | undefined = world.rules.get(String(id));

  if (!rule) {
    throw new Error(`No rule ${String(id)} in this world.`);
  }

  return rule;
}

async function turn(): Promise<void> {
  world.turns++;
  await DetectionRuleEvaluator.evaluateDueRulesForProject(world.projectId);
}

// The clock at a minute: the events that have arrived by then are written.
async function clockAt(minute: number): Promise<void> {
  world.clock = at(minute);
  await writeArrived();
}

// Runs every minute from `from` through `to`: the events that arrived, then the turn.
async function runMinutes(from: number, to: number): Promise<void> {
  for (let minute: number = from; minute <= to; minute++) {
    await clockAt(minute);
    await turn();
  }
}

function recordedFor(rule: DetectionRule): Array<RecordedSignal> {
  return world.recorded.filter((recorded: RecordedSignal): boolean => {
    return recorded.signal.detectionRuleId?.toString() === rule._id;
  });
}

function uidsOf(signal: SecurityDetectionSignal): Array<string> {
  return (signal.matchedEvents?.events || []).map(
    (event: SecurityDetectionMatchedEvent): string => {
      return event.eventUid;
    },
  );
}

// Every event a rule's detections counted, by uid, as their cases keep them: one entry each time.
function judgedUids(rule: DetectionRule): Array<string> {
  return recordedFor(rule)
    .flatMap((recorded: RecordedSignal): Array<string> => {
      return uidsOf(recorded.signal);
    })
    .sort();
}

function firingsFor(
  rule: DetectionRule,
  groupValue: string,
): Array<SecurityDetectionSignal> {
  return recordedFor(rule)
    .map((recorded: RecordedSignal): SecurityDetectionSignal => {
      return recorded.signal;
    })
    .filter((signal: SecurityDetectionSignal): boolean => {
      return signal.groupValue === groupValue;
    });
}

// The minute of the clock the detection that counted this event came in.
function judgedAtMinute(rule: DetectionRule, uid: string): number {
  const recorded: RecordedSignal | undefined = recordedFor(rule).find(
    (entry: RecordedSignal): boolean => {
      return uidsOf(entry.signal).includes(uid);
    },
  );

  if (!recorded) {
    throw new Error(`${uid} was never judged.`);
  }

  return (recorded.at.getTime() - BASE.getTime()) / MINUTE;
}

// The minute of the test's clock a moment is.
function minuteOf(date: Date): number {
  return (new Date(date).getTime() - BASE.getTime()) / MINUTE;
}

// The Detection Findings a rule wrote, as the table holds them: their eventUids.
async function findingsOf(rule: DetectionRule): Promise<Array<string>> {
  const result: { json: () => Promise<unknown> } = await client.query({
    query: `SELECT eventUid FROM ${database}.${TABLE_NAME} WHERE projectId = {projectId:String} AND classUid = {classUid:Int32} AND ruleId = {ruleId:String} ORDER BY eventUid`,
    query_params: {
      projectId: world.projectId.toString(),
      classUid: 2004,
      ruleId: String(rule._id),
    },
    format: "JSONEachRow",
  });

  return ((await result.json()) as Array<{ eventUid: string }>).map(
    (row: { eventUid: string }): string => {
      return row.eventUid;
    },
  );
}

/*
 * How many times the rule's findings counted toward an entity's risk, as
 * the risk side counts them (addRiskObservation): a firing handed again
 * counts once.
 */
function riskHitsOf(value: string): number {
  let contributions: Array<SecurityEntityRiskContribution> = [];

  for (const finding of world.riskFindings) {
    if (
      !finding.entities.some((entity: { value: string }): boolean => {
        return entity.value === value;
      })
    ) {
      continue;
    }

    contributions = addRiskObservation(
      contributions,
      {
        sourceKey: finding.sourceKey,
        source: finding.source,
        sourceName: finding.sourceName,
        severity: finding.severity,
        points: finding.points,
        seenAt: finding.seenAt,
        mitreTactics: finding.mitreTactics,
        mitreTechniques: finding.mitreTechniques,
        ...(finding.firingKey ? { firingKey: finding.firingKey } : {}),
      },
      new Date(world.clock),
    );
  }

  return contributions[0]?.hits || 0;
}

const SERVICE_METADATA: TelemetryServiceMetadata = {
  serviceName: "OneUptime Detections",
  primaryEntityId: ObjectID.generate(),
  primaryEntityType: ServiceType.OpenTelemetry,
  dataRententionInDays: 15,
  serviceRetentionConfig: null,
  serviceRetentionInDays: null,
  projectRetentionConfig: null,
  projectRetentionInDays: 15,
};

function installWorld(): void {
  jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation((): Date => {
    return new Date(world.clock.getTime());
  });

  jest
    .spyOn(DetectionRuleService, "findAllBy")
    .mockImplementation((async (args: { query: JSONObject }) => {
      const rules: Array<DetectionRule> = Array.from(world.rules.values())
        .filter((rule: DetectionRule): boolean => {
          return (
            (args.query["projectId"] === undefined ||
              String(args.query["projectId"]) === rule.projectId!.toString()) &&
            (args.query["isEnabled"] === undefined ||
              args.query["isEnabled"] === rule.isEnabled) &&
            (args.query["isRealTime"] === undefined ||
              args.query["isRealTime"] === rule.isRealTime)
          );
        })
        .map(copyOf);

      // Another turn runs between this one's read of the rules and its use of them.
      const between: (() => Promise<void>) | null = world.beforeRulesReturned;

      if (between) {
        world.beforeRulesReturned = null;
        await between();
      }

      return rules;
    }) as never);

  jest
    .spyOn(DetectionRuleService, "findOneById")
    .mockImplementation((async (args: { id: ObjectID }) => {
      return copyOf(storedRule(args.id));
    }) as never);

  jest
    .spyOn(DetectionRuleService, "findOneBy")
    .mockImplementation((async (args: { query: JSONObject }) => {
      return copyOf(storedRule(args.query["_id"]));
    }) as never);

  jest
    .spyOn(DetectionRuleService, "updateOneById")
    .mockImplementation((async (args: { id: ObjectID; data: JSONObject }) => {
      if (args.data["evaluatingUntil"]) {
        // A stretch marked before it does what it found (#10489).
        world.marks.push({
          from: args.data["lastEvaluatedAt"] as Date,
          until: args.data["evaluatingUntil"] as Date,
        });
      } else if (args.data["lastEvaluatedAt"] !== undefined) {
        if (world.failNextCursorWrite) {
          world.failNextCursorWrite = false;
          throw new Error("The worker stopped before it recorded the run.");
        }

        world.cursorWrites.push(args.data["lastEvaluatedAt"] as Date);
      }

      const rule: DetectionRule = storedRule(args.id);

      for (const [key, value] of Object.entries(args.data)) {
        (rule as unknown as JSONObject)[key] = value as never;
      }

      return 1;
    }) as never);

  jest.spyOn(AlertSeverityService, "findBy").mockImplementation((async () => {
    const severity: AlertSeverity = new AlertSeverity();
    severity._id = ObjectID.generate().toString();
    severity.name = "High";
    return [severity];
  }) as never);

  jest
    .spyOn(AlertStateService, "getUnresolvedAlertStateIds")
    .mockResolvedValue([OPEN_ALERT_STATE_ID] as never);

  jest.spyOn(AlertService, "findBy").mockImplementation((async (args: {
    query: JSONObject;
  }) => {
    const wanted: Array<string> = (
      (args.query["seriesFingerprint"] as Includes).values as Array<string>
    ).map(String);

    return world.alerts
      .filter((stored: StoredAlert): boolean => {
        return stored.open && wanted.includes(stored.fingerprint);
      })
      .map((stored: StoredAlert): Alert => {
        const alert: Alert = new Alert();
        alert._id = ObjectID.generate().toString();
        alert.seriesFingerprint = stored.fingerprint;
        return alert;
      });
  }) as never);

  jest.spyOn(AlertService, "create").mockImplementation((async (args: {
    data: Alert;
  }) => {
    world.alerts.push({
      fingerprint: args.data.seriesFingerprint || "",
      open: true,
    });
    const alert: Alert = new Alert();
    alert._id = ObjectID.generate().toString();
    return alert;
  }) as never);

  jest
    .spyOn(SecurityConnections, "readEntityLinks")
    .mockResolvedValue([] as never);

  /*
   * A case per fingerprint while it is open: a detection already in one
   * repeats - unless its detection took that firing already (#10489), which
   * the case side reads by the same helpers SecurityCaseIngest does.
   */
  jest.spyOn(SecurityCaseIngest, "recordDetections").mockImplementation((async (
    signals: Array<SecurityDetectionSignal>,
  ) => {
    const result: SecurityCaseIngestResult = {
      casesOpened: 0,
      detectionsAdded: 0,
      detectionsRepeated: 0,
    };

    for (const signal of signals) {
      const repeat: boolean = world.openCases.has(signal.fingerprint);
      const taken: Array<string> =
        world.takenFirings.get(signal.fingerprint) || [];

      if (repeat && hasTakenFiring(taken, signal.firingKey)) {
        result.detectionsAlreadyTaken =
          (result.detectionsAlreadyTaken || 0) + 1;
        continue;
      }

      world.takenFirings.set(
        signal.fingerprint,
        takeFiring(taken, signal.firingKey),
      );
      world.recorded.push({ signal, at: new Date(world.clock), repeat });

      if (repeat) {
        result.detectionsRepeated++;
        continue;
      }

      world.openCases.add(signal.fingerprint);
      world.casesOpened++;
      result.casesOpened++;
    }

    return result;
  }) as never);

  jest.spyOn(SecurityEntityRiskRecorder, "record").mockImplementation((async (
    findings: Array<SecurityRiskFinding>,
  ) => {
    world.riskFindings.push(...findings);

    return {
      entitiesUpdated: 0,
      riskCasesRaised: 0,
    };
  }) as never);

  jest
    .spyOn(DetectionRuleExceptionService, "findAllBy")
    .mockResolvedValue([] as never);

  jest
    .spyOn(OTelIngestService, "telemetryServiceFromName")
    .mockResolvedValue(SERVICE_METADATA as never);

  // Findings are written to the suite's table, through its own client.
  jest.spyOn(SecurityEventService, "insertJsonRows").mockImplementation((async (
    rows: Array<JSONObject>,
  ) => {
    if (world.failNextFindingWrite) {
      world.failNextFindingWrite = false;
      throw new Error("ClickHouse is restarting.");
    }

    await client.insert({
      table: `${database}.${TABLE_NAME}`,
      values: rows,
      format: "JSONEachRow",
    });
  }) as never);

  // Each rule's run lock, as Valkey would hold it: one holder at a time.
  const held: Set<string> = new Set();

  jest.spyOn(Semaphore, "lock").mockImplementation((async (data: {
    key: string;
    namespace: string;
  }) => {
    const name: string = `${data.namespace}-${data.key}`;

    if (held.has(name)) {
      throw new Error(`${name} is held.`);
    }

    held.add(name);
    return { name } as never;
  }) as never);

  jest.spyOn(Semaphore, "release").mockImplementation((async (mutex: {
    name: string;
  }) => {
    held.delete(mutex.name);
  }) as never);
}

/*
 * Settings added to a measured read: none, or - on a server that has one -
 * the query condition cache off, which remembers the granules a filter
 * ruled out and would make a read repeated with the same filter look cheap.
 */
let measuringSettings: string = "";

function withSettings(query: string, settings: string): string {
  if (!settings) {
    return query;
  }

  return query.includes(" SETTINGS ")
    ? `${query}, ${settings}`
    : `${query} SETTINGS ${settings}`;
}

// What a read made ClickHouse read, from its FORMAT JSON statistics.
async function rowsRead(statement: Statement, query?: string): Promise<number> {
  const result: { json: () => Promise<unknown> } = await client.query({
    query: withSettings(query ?? statement.query, measuringSettings),
    query_params: statement.query_params,
    format: "JSON",
  });
  const json: { statistics?: { rows_read?: number } } =
    (await result.json()) as { statistics?: { rows_read?: number } };

  return Number(json.statistics?.rows_read || 0);
}

// The statement a service read builds, without running it.
async function statementOf(read: () => Promise<unknown>): Promise<Statement> {
  let captured: Statement | null = null;

  const executeQuery: ReturnType<typeof jest.spyOn> = jest
    .spyOn(SecurityEventService, "executeQuery")
    .mockImplementation((async (statement: Statement) => {
      captured = statement;
      return {
        json: async (): Promise<JSONObject> => {
          return { data: [] };
        },
      };
    }) as never);

  try {
    await read();
  } finally {
    executeQuery.mockRestore();
  }

  if (!captured) {
    throw new Error("The read built no statement.");
  }

  return captured;
}

function withoutSkipIndexes(statement: Statement): string {
  return withSettings(statement.query, "use_skip_indexes = 0");
}

integration("a scheduled rule judges every event once (#10337)", () => {
  let clickhouse: ClickhouseDatabase;
  let original: ConnectableService | null = null;

  beforeAll(async (): Promise<void> => {
    const url: URL = new URL(endpoint!);

    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
      throw new Error(
        "TEST_CLICKHOUSE_URL must point at a local, disposable ClickHouse server.",
      );
    }

    const options: ClickHouseClientConfigOptions = {
      url: `${url.protocol}//${url.host}`,
      username: decodeURIComponent(url.username) || "default",
      password: decodeURIComponent(url.password),
      database: database,
      request_timeout: 300000,
    };

    clickhouse = new ClickhouseDatabase(options);
    client = await clickhouse.connect(options);

    await createTable({ clickhouse, modelType: SecurityEvent });

    original = {
      database: service.database,
      databaseClient: service.databaseClient,
    };

    service.database = clickhouse;
    service.databaseClient = client;
  });

  afterAll(async (): Promise<void> => {
    if (original) {
      Object.assign(service, original);
    }

    if (client) {
      await client.command({ query: `DROP DATABASE IF EXISTS ${database}` });
    }

    if (clickhouse) {
      await clickhouse.disconnect();
    }
  });

  beforeEach((): void => {
    jest.restoreAllMocks();
    world = new World();
    installWorld();
  });

  describe("a rule that fires on each match", () => {
    test("an event that arrives after its rule's window has passed is still matched, once", async () => {
      const rule: DetectionRule = addRule({
        name: "Any failed sign-in",
        intervalInMinutes: 1,
        lastEvaluatedAt: at(0),
      });

      arrive(
        {
          uid: "on-time",
          time: at(3, 10),
          arrivesAt: at(3, 15),
          principalIp: "203.0.113.7",
        },
        {
          // Happened at 4:00, written seven minutes later: a batch shipper.
          uid: "late",
          time: at(4),
          arrivesAt: at(11),
          principalIp: "203.0.113.7",
        },
      );

      await runMinutes(1, 20);

      expect(judgedUids(rule)).toEqual(["late", "on-time"]);
    });

    test("on time, late, very late and out of order: every event judged once, two minutes after it arrived", async () => {
      const rule: DetectionRule = addRule({
        name: "Any failed sign-in",
        intervalInMinutes: 1,
        lastEvaluatedAt: at(0),
      });

      arrive(
        {
          uid: "on-time",
          time: at(3, 10),
          arrivesAt: at(3, 15),
          principalIp: "203.0.113.7",
        },
        {
          // A span that started at 4:00 and ended, and was read, at 5:30.
          uid: "late",
          time: at(4),
          arrivesAt: at(5, 30),
          principalIp: "203.0.113.7",
        },
        {
          // A cloud audit record forty-two minutes behind: dozens of windows past.
          uid: "very-late",
          time: at(5),
          arrivesAt: at(47),
          principalIp: "198.51.100.4",
        },
        {
          // Written before the one that happened before it.
          uid: "out-of-order-second",
          time: at(7, 30),
          arrivesAt: at(8, 10),
          principalIp: "203.0.113.7",
        },
        {
          uid: "out-of-order-first",
          time: at(7),
          arrivesAt: at(9, 30),
          principalIp: "203.0.113.7",
        },
      );

      await runMinutes(1, 55);

      // Each once: no event in two detections, none in none.
      expect(judgedUids(rule)).toEqual([
        "late",
        "on-time",
        "out-of-order-first",
        "out-of-order-second",
        "very-late",
      ]);

      // By the first run that reads up to when it arrived: two minutes on.
      expect(judgedAtMinute(rule, "on-time")).toBe(6);
      expect(judgedAtMinute(rule, "late")).toBe(8);
      expect(judgedAtMinute(rule, "very-late")).toBe(49);
      expect(judgedAtMinute(rule, "out-of-order-second")).toBe(11);
      expect(judgedAtMinute(rule, "out-of-order-first")).toBe(12);

      // Every run recorded where it got to, never going back.
      for (let index: number = 1; index < world.cursorWrites.length; index++) {
        expect(world.cursorWrites[index]!.getTime()).toBeGreaterThan(
          world.cursorWrites[index - 1]!.getTime(),
        );
      }
    });

    test("a network flow read in whole five-minute windows: the event at its window's start, written when the window is read, is matched once", async () => {
      const rule: DetectionRule = addRule({
        name: "Any failed sign-in",
        intervalInMinutes: 1,
        lastEvaluatedAt: at(0),
      });

      /*
       * The flow scan reads 10:00 to 10:05 once the window has settled a
       * minute: the flow at 10:00:00 is written at 10:06, six minutes on.
       */
      arrive(
        {
          uid: "flow-at-window-start",
          time: at(10),
          arrivesAt: at(16),
          principalIp: "192.0.2.10",
        },
        {
          uid: "flow-at-window-end",
          time: at(14, 59),
          arrivesAt: at(16),
          principalIp: "192.0.2.10",
        },
      );

      await runMinutes(1, 25);

      expect(judgedUids(rule)).toEqual([
        "flow-at-window-end",
        "flow-at-window-start",
      ]);
      expect(judgedAtMinute(rule, "flow-at-window-start")).toBe(18);
    });

    test("an event that arrives within a day of when it happened is judged; one a day and more late is not", async () => {
      const rule: DetectionRule = addRule({
        name: "Any failed sign-in",
        intervalInMinutes: 1,
        lastEvaluatedAt: at(0),
      });

      arrive(
        {
          uid: "23-hours-late",
          time: at(30),
          arrivesAt: at(30 + 23 * 60),
          principalIp: "203.0.113.9",
        },
        {
          uid: "a-day-and-a-minute-late",
          time: at(10),
          arrivesAt: at(10 + DETECTION_LATE_EVENT_WINDOW_IN_MINUTES + 1),
          principalIp: "203.0.113.9",
        },
      );

      await runMinutes(1, 3);
      // The workers come back a day later: one turn catches up.
      await runMinutes(
        DETECTION_LATE_EVENT_WINDOW_IN_MINUTES + 15,
        DETECTION_LATE_EVENT_WINDOW_IN_MINUTES + 15,
      );

      expect(judgedUids(rule)).toEqual(["23-hours-late"]);
    });
  });

  describe("a rule that counts", () => {
    test("a late event that brings its window to the threshold fires the group, once", async () => {
      const rule: DetectionRule = addRule({
        name: "Three failed sign-ins from one address",
        intervalInMinutes: 5,
        matchCountThreshold: 3,
        lastEvaluatedAt: at(0),
      });

      arrive(
        {
          uid: "first",
          time: at(6),
          arrivesAt: at(6, 5),
          principalIp: "198.51.100.4",
        },
        {
          uid: "second",
          time: at(7),
          arrivesAt: at(7, 5),
          principalIp: "198.51.100.4",
        },
        {
          // The third of the window's failures, from a span that ended late.
          uid: "third",
          time: at(8),
          arrivesAt: at(21),
          principalIp: "198.51.100.4",
        },
      );

      await runMinutes(1, 40);

      const firings: Array<SecurityDetectionSignal> = firingsFor(
        rule,
        "198.51.100.4",
      );

      expect(firings).toHaveLength(1);
      expect(firings[0]!.eventCount).toBe(3);
      expect(judgedUids(rule)).toEqual(["first", "second", "third"]);
    });

    test("a group past its threshold does not fire again for late events in the same window", async () => {
      const rule: DetectionRule = addRule({
        name: "Three failed sign-ins from one address",
        intervalInMinutes: 5,
        matchCountThreshold: 3,
        lastEvaluatedAt: at(0),
      });

      arrive(
        ...[6, 7, 8].map((minute: number): ArrivingEvent => {
          return {
            uid: `on-time-${minute}`,
            time: at(minute),
            arrivesAt: at(minute, 5),
            principalIp: "198.51.100.4",
          };
        }),
        {
          uid: "late-9",
          time: at(9),
          arrivesAt: at(25),
          principalIp: "198.51.100.4",
        },
        {
          uid: "late-5",
          time: at(5, 30),
          arrivesAt: at(33),
          principalIp: "198.51.100.4",
        },
      );

      await runMinutes(1, 45);

      const firings: Array<SecurityDetectionSignal> = firingsFor(
        rule,
        "198.51.100.4",
      );

      expect(firings).toHaveLength(1);
      expect(firings[0]!.eventCount).toBe(3);
    });

    test("the windows are back to back on the clock: a burst across two of them is counted apart", async () => {
      const rule: DetectionRule = addRule({
        name: "Three failed sign-ins from one address",
        intervalInMinutes: 5,
        matchCountThreshold: 3,
        lastEvaluatedAt: at(0),
      });

      arrive(
        ...[
          at(9, 40),
          at(9, 50),
          // 10:00 starts the next window.
          at(10, 5),
          at(10, 15),
        ].map((time: Date, index: number): ArrivingEvent => {
          return {
            uid: `burst-${index}`,
            time,
            arrivesAt: new Date(time.getTime() + 5 * SECOND),
            principalIp: "198.51.100.4",
          };
        }),
      );

      await runMinutes(1, 30);

      expect(firingsFor(rule, "198.51.100.4")).toHaveLength(0);
    });

    test("events that make one window's count arrive across several runs, out of order: the window fires once, when the last arrives", async () => {
      const rule: DetectionRule = addRule({
        name: "Three failed sign-ins from one address",
        intervalInMinutes: 5,
        matchCountThreshold: 3,
        lastEvaluatedAt: at(0),
      });

      arrive(
        {
          uid: "middle",
          time: at(12),
          arrivesAt: at(12, 5),
          principalIp: "198.51.100.4",
        },
        {
          uid: "last",
          time: at(13),
          arrivesAt: at(16),
          principalIp: "198.51.100.4",
        },
        {
          uid: "first",
          time: at(11),
          arrivesAt: at(23),
          principalIp: "198.51.100.4",
        },
      );

      await runMinutes(1, 40);

      const firings: Array<SecurityDetectionSignal> = firingsFor(
        rule,
        "198.51.100.4",
      );

      expect(firings).toHaveLength(1);
      expect(firings[0]!.eventCount).toBe(3);
      expect(judgedUids(rule)).toEqual(["first", "last", "middle"]);
      // The run after the last of them arrived, two minutes on and on its five-minute interval.
      expect(judgedAtMinute(rule, "first")).toBeGreaterThanOrEqual(25);
      expect(judgedAtMinute(rule, "first")).toBeLessThanOrEqual(30);
    });

    test("an event an hour late still completes its window, once", async () => {
      const rule: DetectionRule = addRule({
        name: "Three failed sign-ins from one address",
        intervalInMinutes: 5,
        matchCountThreshold: 3,
        lastEvaluatedAt: at(0),
      });

      arrive(
        {
          uid: "first",
          time: at(6),
          arrivesAt: at(6, 5),
          principalIp: "198.51.100.4",
        },
        {
          uid: "second",
          time: at(7),
          arrivesAt: at(7, 5),
          principalIp: "198.51.100.4",
        },
        {
          // The trace scan reads a span up to an hour after it arrived.
          uid: "an-hour-late",
          time: at(8),
          arrivesAt: at(68),
          principalIp: "198.51.100.4",
        },
      );

      await runMinutes(1, 80);

      expect(firingsFor(rule, "198.51.100.4")).toHaveLength(1);
      expect(judgedUids(rule)).toEqual(["an-hour-late", "first", "second"]);
    });

    test("a distinct count: the late value that makes the count fires once, and a repeat of a value fires nothing", async () => {
      const rule: DetectionRule = addRule({
        name: "One address failing against three accounts",
        intervalInMinutes: 5,
        matchCountThreshold: 3,
        distinctCountField: "principalUser",
        lastEvaluatedAt: at(0),
      });

      arrive(
        {
          uid: "alice",
          time: at(6),
          arrivesAt: at(6, 5),
          principalIp: "198.51.100.4",
          principalUser: "alice",
        },
        {
          uid: "bob",
          time: at(7),
          arrivesAt: at(7, 5),
          principalIp: "198.51.100.4",
          principalUser: "bob",
        },
        {
          uid: "carol-late",
          time: at(8),
          arrivesAt: at(19),
          principalIp: "198.51.100.4",
          principalUser: "carol",
        },
        {
          uid: "alice-again-late",
          time: at(9),
          arrivesAt: at(31),
          principalIp: "198.51.100.4",
          principalUser: "alice",
        },
      );

      await runMinutes(1, 40);

      const firings: Array<SecurityDetectionSignal> = firingsFor(
        rule,
        "198.51.100.4",
      );

      expect(firings).toHaveLength(1);
      expect(judgedUids(rule)).toEqual(["alice", "bob", "carol-late"]);
    });
  });

  describe("alerts and cases", () => {
    test("a group's alert and case open once, and a later pass with its late events opens neither again", async () => {
      const rule: DetectionRule = addRule({
        name: "Any failed sign-in",
        intervalInMinutes: 1,
        lastEvaluatedAt: at(0),
        shouldCreateAlert: true,
      });

      arrive(
        {
          uid: "on-time",
          time: at(3, 10),
          arrivesAt: at(3, 15),
          principalIp: "203.0.113.7",
        },
        {
          uid: "late",
          time: at(3, 20),
          arrivesAt: at(12),
          principalIp: "203.0.113.7",
        },
      );

      await runMinutes(1, 20);

      expect(world.alerts).toHaveLength(1);
      expect(world.casesOpened).toBe(1);
      expect(
        recordedFor(rule).map((recorded: RecordedSignal): boolean => {
          return recorded.repeat;
        }),
      ).toEqual([false, true]);
      expect(judgedUids(rule)).toEqual(["late", "on-time"]);
    });

    test("a window that fired opens nothing more when its late events arrive", async () => {
      const rule: DetectionRule = addRule({
        name: "Three failed sign-ins from one address",
        intervalInMinutes: 5,
        matchCountThreshold: 3,
        lastEvaluatedAt: at(0),
        shouldCreateAlert: true,
      });

      arrive(
        ...[6, 7, 8, 9].map((minute: number): ArrivingEvent => {
          return {
            uid: `failure-${minute}`,
            time: at(minute),
            // The last of them an hour late.
            arrivesAt: minute === 9 ? at(70) : at(minute, 5),
            principalIp: "198.51.100.4",
          };
        }),
      );

      await runMinutes(1, 80);

      expect(world.alerts).toHaveLength(1);
      expect(world.casesOpened).toBe(1);
      expect(recordedFor(rule)).toHaveLength(1);
    });
  });

  describe("restarts", () => {
    test("a run that fails part way loses nothing: the next run judges its events, and every event is judged once", async () => {
      const rule: DetectionRule = addRule({
        name: "Any failed sign-in",
        intervalInMinutes: 1,
        lastEvaluatedAt: at(0),
        shouldCreateAlert: true,
      });

      arrive(
        {
          uid: "in-the-failed-run",
          time: at(3, 10),
          arrivesAt: at(3, 15),
          principalIp: "203.0.113.7",
        },
        {
          // Arrives in the two minutes a failed run used to skip.
          uid: "just-after",
          time: at(4, 30),
          arrivesAt: at(4, 40),
          principalIp: "203.0.113.7",
        },
      );

      await runMinutes(1, 5);

      // The run that judges the first event cannot write its findings.
      world.failNextFindingWrite = true;
      await runMinutes(6, 6);

      expect(world.casesOpened).toBe(0);
      expect(storedRule(rule._id).lastError).toContain(
        "ClickHouse is restarting.",
      );

      await runMinutes(7, 12);

      expect(judgedUids(rule)).toEqual(["in-the-failed-run", "just-after"]);
      // Its alert opened in the failed run is still open: not opened again.
      expect(world.alerts).toHaveLength(1);
      expect(world.casesOpened).toBe(1);
      expect(storedRule(rule._id).lastError).toBeNull();
    });

    test("a worker that stops before it records where a run got to: the next run judges the same events, and each firing is done once (#10489)", async () => {
      const rule: DetectionRule = addRule({
        name: "Any failed sign-in",
        intervalInMinutes: 1,
        lastEvaluatedAt: at(0),
        shouldCreateAlert: true,
      });

      arrive({
        uid: "judged-twice",
        time: at(3, 10),
        arrivesAt: at(3, 15),
        principalIp: "203.0.113.7",
      });

      await runMinutes(1, 5);

      world.failNextCursorWrite = true;
      await runMinutes(6, 6);

      // It fired, and did not get to record that it had: the stretch stays marked.
      expect(world.alerts).toHaveLength(1);
      expect(world.casesOpened).toBe(1);
      expect(storedRule(rule._id).lastEvaluatedAt!.getTime()).toBe(
        at(3).getTime(),
      );
      expect(storedRule(rule._id).evaluatingUntil!.getTime()).toBe(
        at(4).getTime(),
      );

      await runMinutes(7, 10);

      // Exactly once: judged again, and nothing it did is done twice.
      expect(world.alerts).toHaveLength(1);
      expect(world.casesOpened).toBe(1);
      expect(
        recordedFor(rule).map((recorded: RecordedSignal): boolean => {
          return recorded.repeat;
        }),
      ).toEqual([false]);
      expect(await findingsOf(rule)).toHaveLength(1);
      expect(storedRule(rule._id).lastEvaluatedAt!.getTime()).toBe(
        at(8).getTime(),
      );
      expect(storedRule(rule._id).evaluatingUntil).toBeNull();
    });
  });

  /*
   * EXACTLY ONCE (#10489). A worker that stops between doing what a run
   * found and recording where it got to: the next run - with the clock
   * moved on and more events in - judges exactly the stretch the stopped
   * run judged, then goes on. Each firing leaves one Detection Finding (in
   * ClickHouse), one case detection with its own count, and its risk added
   * once, and an event that arrived in between is judged by the stretch
   * after, as it would have been.
   */
  describe("a worker that stops between a run's effects and its record", () => {
    test("a rule that fires on each match: one finding, one case detection with the right count, the risk once, and the event that arrived meanwhile judged next", async () => {
      const rule: DetectionRule = addRule({
        name: "Any failed sign-in",
        intervalInMinutes: 1,
        lastEvaluatedAt: at(0),
        shouldCreateAlert: true,
        riskScore: 40,
      });

      arrive(
        {
          uid: "first",
          time: at(3, 10),
          arrivesAt: at(3, 15),
          principalIp: "203.0.113.7",
        },
        {
          uid: "second",
          time: at(3, 20),
          arrivesAt: at(3, 25),
          principalIp: "203.0.113.7",
        },
        {
          // Arrives while the stopped worker's turn is down: after its stretch.
          uid: "meanwhile",
          time: at(5, 40),
          arrivesAt: at(6, 10),
          principalIp: "203.0.113.7",
        },
      );

      await runMinutes(1, 5);

      // The run at 6:00 judges (3:00, 4:00], fires, and stops before recording it.
      world.failNextCursorWrite = true;
      await runMinutes(6, 6);

      expect(world.marks).toEqual([{ from: at(3), until: at(4) }]);
      expect(await findingsOf(rule)).toHaveLength(1);

      // The workers come back three minutes later.
      await runMinutes(9, 12);

      // The stretch judged again exactly, then the rest: (3:00, 4:00], then (4:00, 7:00].
      expect(world.cursorWrites.map(minuteOf)).toEqual([
        1, 2, 3, 4, 7, 8, 9, 10,
      ]);
      // The stretch after it found the event that arrived meanwhile: marked once.
      expect(world.marks).toEqual([
        { from: at(3), until: at(4) },
        { from: at(4), until: at(7) },
      ]);

      // One firing per stretch: the first with both events, then the one that came meanwhile.
      const firings: Array<RecordedSignal> = recordedFor(rule);

      expect(
        firings.map((recorded: RecordedSignal): [boolean, number] => {
          return [recorded.repeat, recorded.signal.eventCount];
        }),
      ).toEqual([
        [false, 2],
        [true, 1],
      ]);
      expect(judgedUids(rule)).toEqual(["first", "meanwhile", "second"]);

      // One Detection Finding a firing, each under its firing's name.
      const findings: Array<string> = await findingsOf(rule);

      expect(findings).toHaveLength(2);
      expect(new Set(findings).size).toBe(2);
      expect(world.alerts).toHaveLength(1);
      expect(world.casesOpened).toBe(1);

      // Its risk: handed again on the judged-again pass, counted once.
      expect(riskHitsOf("203.0.113.7")).toBe(2);
    });

    test("a rule that counts: the window that fired fires once, and what came meanwhile counts in its own window", async () => {
      const rule: DetectionRule = addRule({
        name: "Three failed sign-ins in five minutes",
        intervalInMinutes: 5,
        lastEvaluatedAt: at(0),
        matchCountThreshold: 3,
        shouldCreateAlert: true,
        riskScore: 40,
      });

      arrive(
        ...[1, 2, 3].map((second: number): ArrivingEvent => {
          return {
            uid: `burst-${second}`,
            time: at(1, second),
            arrivesAt: at(1, second + 5),
            principalIp: "198.51.100.4",
          };
        }),
        {
          // Late, in the window that already fired: never fires it again.
          uid: "late-in-the-window",
          time: at(2),
          arrivesAt: at(8),
          principalIp: "198.51.100.4",
        },
      );

      // The run at 7:00 judges (0:00, 5:00], fires the window, and stops.
      world.failNextCursorWrite = true;
      await runMinutes(7, 7);

      expect(world.marks).toEqual([{ from: at(0), until: at(5) }]);

      await runMinutes(8, 14);

      expect(
        firingsFor(rule, "198.51.100.4").map(
          (signal: SecurityDetectionSignal): number => {
            return signal.eventCount;
          },
        ),
      ).toEqual([3]);
      expect(await findingsOf(rule)).toHaveLength(1);
      expect(world.alerts).toHaveLength(1);
      expect(riskHitsOf("198.51.100.4")).toBe(1);
      expect(storedRule(rule._id).evaluatingUntil).toBeNull();
    });

    test("a worker that stops twice in a row still leaves each firing done once", async () => {
      const rule: DetectionRule = addRule({
        name: "Any failed sign-in",
        intervalInMinutes: 1,
        lastEvaluatedAt: at(0),
        riskScore: 40,
      });

      arrive({
        uid: "once",
        time: at(3, 10),
        arrivesAt: at(3, 15),
        principalIp: "192.0.2.10",
      });

      await runMinutes(1, 5);

      world.failNextCursorWrite = true;
      await runMinutes(6, 6);
      world.failNextCursorWrite = true;
      await runMinutes(7, 7);

      await runMinutes(8, 10);

      expect(recordedFor(rule)).toHaveLength(1);
      expect(await findingsOf(rule)).toHaveLength(1);
      expect(riskHitsOf("192.0.2.10")).toBe(1);
      expect(world.marks).toEqual([{ from: at(3), until: at(4) }]);
    });
  });

  describe("overlapping turns", () => {
    test("two turns of the project at once judge each event once", async () => {
      const rule: DetectionRule = addRule({
        name: "Any failed sign-in",
        intervalInMinutes: 1,
        lastEvaluatedAt: at(0),
        shouldCreateAlert: true,
      });

      arrive(
        ...[3, 4, 5, 6].map((minute: number): ArrivingEvent => {
          return {
            uid: `failure-${minute}`,
            time: at(minute, 10),
            arrivesAt: minute === 4 ? at(9) : at(minute, 15),
            principalIp: `203.0.113.${minute}`,
          };
        }),
      );

      for (let minute: number = 1; minute <= 15; minute++) {
        await clockAt(minute);
        await Promise.all([turn(), turn()]);
      }

      expect(judgedUids(rule)).toEqual([
        "failure-3",
        "failure-4",
        "failure-5",
        "failure-6",
      ]);
      expect(world.alerts).toHaveLength(4);
      expect(world.casesOpened).toBe(4);
    });

    test("a turn that read the rule before another turn ran it reads it again, and does not judge those events twice", async () => {
      const rule: DetectionRule = addRule({
        name: "Any failed sign-in",
        intervalInMinutes: 1,
        lastEvaluatedAt: at(0),
      });

      arrive({
        uid: "once",
        time: at(3, 10),
        arrivesAt: at(3, 15),
        principalIp: "203.0.113.7",
      });

      await runMinutes(1, 5);

      // At 6:00 one turn reads the rules, then another turn runs whole before it goes on.
      await clockAt(6);
      world.beforeRulesReturned = turn;
      await turn();

      await runMinutes(7, 10);

      expect(judgedUids(rule)).toEqual(["once"]);
      expect(world.casesOpened).toBe(1);
    });
  });

  describe("correlations", () => {
    test("a sequence whose first step arrives after its last fires once, when the first arrives", async () => {
      const rule: DetectionRule = addRule({
        name: "Failed then successful sign-in",
        intervalInMinutes: 5,
        yaml: FAILED_THEN_SUCCEEDED,
        lastEvaluatedAt: at(0),
      });

      arrive(
        {
          uid: "success",
          time: at(7),
          arrivesAt: at(7, 5),
          principalIp: "198.51.100.20",
          statusName: "Success",
        },
        {
          // The failure before it, read when its span ended.
          uid: "failure",
          time: at(6),
          arrivesAt: at(15),
          principalIp: "198.51.100.20",
        },
      );

      await runMinutes(1, 30);

      const firings: Array<SecurityDetectionSignal> = firingsFor(
        rule,
        "198.51.100.20",
      );

      expect(firings).toHaveLength(1);
      expect(judgedUids(rule)).toEqual(["failure", "success"]);
    });

    test("a count a late event completes fires once, and a later late event in its window fires nothing", async () => {
      const rule: DetectionRule = addRule({
        name: "Three failed sign-ins from one address",
        intervalInMinutes: 5,
        yaml: THREE_FAILURES,
        lastEvaluatedAt: at(0),
      });

      arrive(
        {
          uid: "first",
          time: at(6),
          arrivesAt: at(6, 5),
          principalIp: "198.51.100.30",
        },
        {
          uid: "second",
          time: at(6, 30),
          arrivesAt: at(6, 35),
          principalIp: "198.51.100.30",
        },
        {
          uid: "third-late",
          time: at(7),
          arrivesAt: at(20),
          principalIp: "198.51.100.30",
        },
        {
          uid: "fourth-later",
          time: at(7, 30),
          arrivesAt: at(30),
          principalIp: "198.51.100.30",
        },
      );

      await runMinutes(1, 40);

      expect(firingsFor(rule, "198.51.100.30")).toHaveLength(1);
      expect(judgedUids(rule)).toEqual(["first", "second", "third-late"]);
    });
  });

  describe("handing a rule over to real time", () => {
    test("the handover judges what arrived since the schedule stopped, late events too, and nothing after it", async () => {
      const rule: DetectionRule = addRule({
        name: "Any failed sign-in",
        intervalInMinutes: 5,
        lastEvaluatedAt: at(10),
        isRealTime: true,
      });

      arrive(
        {
          // Judged by the schedule's last run.
          uid: "before",
          time: at(9, 50),
          arrivesAt: at(9, 55),
          principalIp: "203.0.113.7",
        },
        {
          // Happened before the schedule stopped, arrived after.
          uid: "late",
          time: at(5),
          arrivesAt: at(11),
          principalIp: "203.0.113.7",
        },
        {
          uid: "during",
          time: at(11, 30),
          arrivesAt: at(11, 31),
          principalIp: "203.0.113.7",
        },
        {
          // Every process screens for the rule by now: real time judges it.
          uid: "after",
          time: at(11, 50),
          arrivesAt: at(13),
          principalIp: "203.0.113.7",
        },
      );

      await clockAt(15);

      await DetectionRuleEvaluator.evaluateRealTime(
        copyOf(storedRule(rule._id)),
        { startTime: at(10), endTime: at(12) },
      );

      expect(judgedUids(rule)).toEqual(["during", "late"]);
      // A real-time rule's schedule is left as it was.
      expect(world.cursorWrites).toHaveLength(0);
      expect(storedRule(rule._id).lastMatchAt!.getTime()).toBe(
        at(12).getTime(),
      );
    });
  });

  describe("a backlog", () => {
    test("a rule that counts, catching up after an outage, reads its windows a dozen at a time and fires each once, in one turn", async () => {
      const rule: DetectionRule = addRule({
        name: "Two failed sign-ins from one address",
        intervalInMinutes: 1,
        matchCountThreshold: 2,
        lastEvaluatedAt: at(0),
      });

      const minutes: Array<number> = Array.from(
        { length: 30 },
        (_: unknown, index: number): number => {
          return index + 1;
        },
      );

      arrive(
        ...minutes.flatMap((minute: number): Array<ArrivingEvent> => {
          return [10, 20].map((second: number): ArrivingEvent => {
            return {
              uid: `m${String(minute).padStart(2, "0")}-${second}`,
              time: at(minute, second),
              arrivesAt: at(minute, second + 5),
              principalIp: "198.51.100.40",
            };
          });
        }),
      );

      // The workers were down: the first turn is at 40:00.
      await runMinutes(40, 40);

      expect(world.turns).toBe(1);
      expect(firingsFor(rule, "198.51.100.40")).toHaveLength(30);
      expect(judgedUids(rule)).toHaveLength(60);
      expect(new Set(judgedUids(rule)).size).toBe(60);
      // Three runs in the one turn, each recording where it got to.
      expect(world.cursorWrites.length).toBe(
        Math.ceil(30 / DETECTION_MAX_WINDOWS_PER_RUN),
      );
      expect(storedRule(rule._id).lastEvaluatedAt!.getTime()).toBe(
        at(38).getTime(),
      );
    });
  });

  /*
   * A SCHEDULED HUNT COUNTS EVERY EVENT ONCE, HOWEVER LATE IT LANDS (#10488).
   *
   * An hourly hunt for failed sign-ins, set at minute 0, run whenever it is
   * due on the clock the test moves, as the person it runs as: a member of
   * the project, whose read goes through the Events page's own permission
   * checks (only the label scope, which reads Postgres, is left out). Each
   * run counts what ARRIVED since the one before, whenever it happened in
   * the day before; and its notification's link, read as the Events page
   * reads it, lists exactly the events that run counted.
   */
  describe("a scheduled hunt", () => {
    const DASHBOARD_URL: string = "https://oneuptime.example/dashboard";
    const MAYA: ObjectID = ObjectID.generate();

    let storedHunt: SecurityHunt;
    let huntRuns: Array<SecurityHuntRun> = [];
    let found: Array<{ eventCount: number; window: SecurityHuntRunWindow }> =
      [];

    // Maya, as her own reads carry her: a member of the project.
    function mayaProps(): DatabaseCommonInteractionProps {
      return {
        userId: MAYA,
        tenantId: world.projectId,
        userTenantAccessPermission: {
          [world.projectId.toString()]: {
            _type: "UserTenantAccessPermission",
            projectId: world.projectId,
            permissions: [
              {
                _type: "UserPermission",
                permission: Permission.ProjectOwner,
                labelIds: [],
                isBlockPermission: false,
              },
            ],
          },
        },
      } as unknown as DatabaseCommonInteractionProps;
    }

    // Set at minute 0: it counts what arrives from then on, the first run an hour later.
    function addHourlyHunt(): void {
      storedHunt = new SecurityHunt();
      storedHunt._id = ObjectID.generate().toString();
      storedHunt.projectId = world.projectId;
      storedHunt.name = "Failed sign-ins";
      storedHunt.schedule = SecurityHuntSchedule.EveryHour;
      storedHunt.searchQuery = "";
      storedHunt.filters = {
        statusName: ["Failure"],
      } as unknown as JSONObject;
      storedHunt.scheduledByUserId = MAYA;
      storedHunt.searchedUpToAt = getSecurityHuntSearchStart(at(0));
      storedHunt.nextRunAt = at(60);
    }

    // A copy, as each read of the hunt service hands one.
    function readHunt(): SecurityHunt {
      const copy: SecurityHunt = new SecurityHunt();

      for (const key of [
        "_id",
        "projectId",
        "name",
        "schedule",
        "searchQuery",
        "filters",
        "scheduledByUserId",
        "searchedUpToAt",
        "nextRunAt",
      ]) {
        (copy as unknown as JSONObject)[key] = (
          storedHunt as unknown as JSONObject
        )[key];
      }

      return copy;
    }

    function sameMoment(a: unknown, b: unknown): boolean {
      const left: number | null = a ? new Date(a as Date).getTime() : null;
      const right: number | null = b ? new Date(b as Date).getTime() : null;

      return left === right;
    }

    // Every ten minutes the events that arrived are written, and the hunt runs when it is due.
    async function runHuntBetween(
      firstMinute: number,
      lastMinute: number,
    ): Promise<void> {
      for (
        let minute: number = firstMinute;
        minute <= lastMinute;
        minute += 10
      ) {
        await clockAt(minute);

        if (
          storedHunt.nextRunAt &&
          new Date(storedHunt.nextRunAt).getTime() <= world.clock.getTime()
        ) {
          await SecurityHuntScheduler.runHunt(readHunt(), {
            now: new Date(world.clock),
          });
        }
      }
    }

    /*
     * What the notification's link lists, read as the Events page reads it
     * for whoever opens it: the hunt's search and chips, over the link's
     * time range, with its arrivals as the chip.
     */
    async function listedByLink(
      window: SecurityHuntRunWindow,
    ): Promise<Array<string>> {
      const link: OneUptimeURL = await getHuntLinkInDashboard({
        projectId: world.projectId,
        huntId: storedHunt.id!,
        window,
      });
      const search: string = link.toString().split("?")[1] || "";
      const params: URLSearchParams = new URLSearchParams(search);
      const arrival: SecurityEventArrivalRange | null =
        readSecurityEventArrivalRangeFromSearch(search);

      expect(params.get("range")).toBe("Custom");
      expect(arrival).not.toBeNull();

      const query: Query<SecurityEvent> = {
        ...buildSecurityEventSearchQuery({
          base: {
            projectId: world.projectId,
            time: new InBetween<Date>(
              new Date(params.get("start")!),
              new Date(params.get("end")!),
            ),
          } as Query<SecurityEvent>,
          search: storedHunt.searchQuery || "",
          filters: securityHuntFiltersToMap(
            storedHunt.filters as unknown as { [key: string]: Array<string> },
          ),
        }),
        [SECURITY_EVENT_ARRIVAL_QUERY_KEY]: toSecurityEventArrivalQueryValue(
          arrival!,
        ),
      } as Query<SecurityEvent>;

      const events: Array<SecurityEvent> = await SecurityEventService.findBy({
        query,
        select: { eventUid: true },
        skip: 0,
        limit: 100,
        props: mayaProps(),
      });

      return events
        .map((event: SecurityEvent): string => {
          return String(event.eventUid);
        })
        .sort();
    }

    beforeEach((): void => {
      huntRuns = [];
      found = [];
      addHourlyHunt();

      // The hunt's record holds only on the schedule it was read with.
      jest
        .spyOn(SecurityHuntService, "compareAndSetColumnsByIdWithoutHooks")
        .mockImplementation((async (args: {
          data: JSONObject;
          expectedData: JSONObject;
        }) => {
          if (
            !sameMoment(storedHunt.nextRunAt, args.expectedData["nextRunAt"]) ||
            !sameMoment(
              storedHunt.searchedUpToAt,
              args.expectedData["searchedUpToAt"],
            )
          ) {
            return false;
          }

          for (const [key, value] of Object.entries(args.data)) {
            (storedHunt as unknown as JSONObject)[key] = value as never;
          }

          return true;
        }) as never);

      jest
        .spyOn(SecurityHuntRunService, "create")
        .mockImplementation((async (args: { data: SecurityHuntRun }) => {
          huntRuns.push(args.data);
          return args.data;
        }) as never);

      jest
        .spyOn(SecurityHuntNotifications, "huntFound")
        .mockImplementation((async (data: {
          eventCount: number;
          window: SecurityHuntRunWindow;
        }) => {
          found.push({ eventCount: data.eventCount, window: data.window });
          return true;
        }) as never);

      jest
        .spyOn(
          AccessTokenService,
          "getDatabaseCommonInteractionPropsByUserAndProject",
        )
        .mockImplementation((async () => {
          return mayaProps();
        }) as never);

      // No billing here; and the label scope reads Postgres: Maya holds no labels.
      jest
        .spyOn(CallerPlan, "withAnalyticsPlanFor")
        .mockImplementation((async (data: {
          props: DatabaseCommonInteractionProps;
        }) => {
          return data.props;
        }) as never);
      jest
        .spyOn(
          ModelPermission as unknown as {
            addReadScopeToQuery: (...args: Array<unknown>) => unknown;
          },
          "addReadScopeToQuery",
        )
        .mockImplementation((async (_model: unknown, query: unknown) => {
          return query;
        }) as never);

      jest
        .spyOn(DatabaseConfig, "getDashboardUrl")
        .mockResolvedValue(OneUptimeURL.fromString(DASHBOARD_URL) as never);
    });

    test("on time, late, an hour late, very late and out of order: every event counted once, by the run after it arrived", async () => {
      arrive(
        {
          uid: "on-time",
          time: at(10),
          arrivesAt: at(10, 5),
          principalIp: "203.0.113.7",
        },
        {
          // Happened before the 1:00 run passed it, written after: a batch shipper.
          uid: "late-across-a-run",
          time: at(55),
          arrivesAt: at(70),
          principalIp: "203.0.113.7",
        },
        {
          // A span read when it ended, an hour on.
          uid: "an-hour-late",
          time: at(30),
          arrivesAt: at(95),
          principalIp: "198.51.100.4",
        },
        {
          // Out of order: the later one arrives first...
          uid: "happened-second-arrived-first",
          time: at(175),
          arrivesAt: at(200),
          principalIp: "192.0.2.10",
        },
        {
          // ...and the earlier one after the next run has gone by.
          uid: "happened-first-arrived-second",
          time: at(170),
          arrivesAt: at(250),
          principalIp: "192.0.2.10",
        },
        {
          // A shipper down for most of a day: 23 hours late, still counted.
          uid: "23-hours-late",
          time: at(40),
          arrivesAt: at(40 + 23 * 60),
          principalIp: "198.51.100.9",
        },
        {
          // A day and a minute late: stored and searchable, but no run counts it.
          uid: "a-day-and-a-minute-late",
          time: at(100),
          arrivesAt: at(100 + DETECTION_LATE_EVENT_WINDOW_IN_MINUTES + 1),
          principalIp: "198.51.100.9",
        },
        {
          // Not what the hunt looks for.
          uid: "a-success",
          time: at(20),
          arrivesAt: at(21),
          statusName: "Success",
          principalIp: "203.0.113.7",
        },
      );

      await runHuntBetween(0, 1560);

      // Every hour from 1:00 to 26:00, and none of them failed.
      expect(huntRuns).toHaveLength(26);
      expect(
        huntRuns.every((run: SecurityHuntRun): boolean => {
          return !run.error;
        }),
      ).toBe(true);

      // Each run counts what arrived after the one before stopped: no gap, no overlap.
      expect(huntRuns[0]!.windowStartAt!.getTime()).toBe(at(-2).getTime());

      for (let index: number = 1; index < huntRuns.length; index++) {
        expect(huntRuns[index]!.windowStartAt!.getTime()).toBe(
          huntRuns[index - 1]!.windowEndAt!.getTime(),
        );
      }

      // Each counted by the first run whose window holds when it arrived.
      expect(
        found.map(
          (entry: {
            eventCount: number;
            window: SecurityHuntRunWindow;
          }): [number, number] => {
            return [
              (entry.window.endTime.getTime() - BASE.getTime()) / MINUTE + 2,
              entry.eventCount,
            ];
          },
        ),
      ).toEqual([
        [60, 1],
        [120, 2],
        [240, 1],
        [300, 1],
        [1440, 1],
      ]);

      // Every countable event once in all: none twice, none skipped.
      expect(
        huntRuns.reduce((sum: number, run: SecurityHuntRun): number => {
          return sum + (run.eventCount || 0);
        }, 0),
      ).toBe(6);
      expect(storedHunt.searchedUpToAt!.getTime()).toBe(at(1558).getTime());
    });

    test("the notification's link lists exactly the events its run counted, wherever in the day before they happened", async () => {
      arrive(
        {
          uid: "on-time",
          time: at(10),
          arrivesAt: at(10, 5),
          principalIp: "203.0.113.7",
        },
        {
          uid: "late-across-a-run",
          time: at(55),
          arrivesAt: at(70),
          principalIp: "203.0.113.7",
        },
        {
          uid: "an-hour-late",
          time: at(30),
          arrivesAt: at(95),
          principalIp: "198.51.100.4",
        },
        {
          // Arrives after the 2:00 run: the next run's, never this one's.
          uid: "arrives-after-the-run",
          time: at(100),
          arrivesAt: at(119),
          principalIp: "198.51.100.4",
        },
        {
          uid: "23-hours-late",
          time: at(130),
          arrivesAt: at(130 + 23 * 60),
          principalIp: "198.51.100.9",
        },
      );

      await runHuntBetween(0, 1560);

      expect(
        found.map((entry: { eventCount: number }): number => {
          return entry.eventCount;
        }),
      ).toEqual([1, 2, 1, 1]);

      const listed: Array<Array<string>> = [];

      for (const entry of found) {
        listed.push(await listedByLink(entry.window));
      }

      expect(listed).toEqual([
        ["on-time"],
        // Happened in the window of the run before: the link still lists them.
        ["an-hour-late", "late-across-a-run"],
        ["arrives-after-the-run"],
        // Happened 23 hours before the run that counted it.
        ["23-hours-late"],
      ]);

      // Each run's link lists as many as the run told people it found.
      expect(
        listed.map((uids: Array<string>): number => {
          return uids.length;
        }),
      ).toEqual(
        found.map((entry: { eventCount: number }): number => {
          return entry.eventCount;
        }),
      );
    });

    test("a run that cannot count keeps its window: the retry counts what it would have, once", async () => {
      arrive(
        {
          uid: "in-the-failed-run",
          time: at(10),
          arrivesAt: at(10, 5),
          principalIp: "203.0.113.7",
        },
        {
          uid: "in-the-next-hour",
          time: at(70),
          arrivesAt: at(75),
          principalIp: "203.0.113.7",
        },
      );

      const countBy: ReturnType<typeof jest.spyOn> = jest.spyOn(
        SecurityEventService,
        "countBy",
      );
      countBy.mockRejectedValueOnce(new Error("ClickHouse is restarting."));

      await runHuntBetween(0, 60);

      // It said why, and kept its window: tried again within the hour.
      expect(found).toEqual([]);
      expect(huntRuns).toHaveLength(1);
      expect(huntRuns[0]!.error).toBeTruthy();
      expect(storedHunt.searchedUpToAt!.getTime()).toBe(at(-2).getTime());
      expect(storedHunt.nextRunAt!.getTime()).toBe(at(120).getTime());

      await runHuntBetween(70, 120);

      // The retry counts both hours' arrivals, each once.
      expect(found).toHaveLength(1);
      expect(found[0]!.eventCount).toBe(2);
      expect(found[0]!.window.startTime.getTime()).toBe(at(-2).getTime());
      expect(await listedByLink(found[0]!.window)).toEqual([
        "in-the-failed-run",
        "in-the-next-hour",
      ]);
    });

    test("two workers that run the hunt at once count its window once, and tell its people once", async () => {
      arrive({
        uid: "once",
        time: at(10),
        arrivesAt: at(10, 5),
        principalIp: "203.0.113.7",
      });

      await clockAt(60);

      const both: Array<SecurityHuntRunOutcome> = await Promise.all([
        SecurityHuntScheduler.runHunt(readHunt(), {
          now: new Date(world.clock),
        }),
        SecurityHuntScheduler.runHunt(readHunt(), {
          now: new Date(world.clock),
        }),
      ]);

      expect(
        both.map((outcome: SecurityHuntRunOutcome): boolean => {
          return outcome.isRecorded;
        }),
      ).toEqual(expect.arrayContaining([true, false]));
      expect(found).toEqual([
        {
          eventCount: 1,
          window: { startTime: at(-2), endTime: at(58) },
        },
      ]);
      expect(huntRuns).toHaveLength(1);
    });
  });

  describe("what the extra reads cost", () => {
    /*
     * A busy project: about 1,500 security events a minute for 26 hours,
     * written as they arrived and merged into parts sorted by when they
     * happened - the layout that leaves late events mixed in with older
     * ones. Nine in ten arrive within five seconds, the rest within two
     * minutes, ten minutes, and a few up to six hours late.
     */
    const ROWS: number = 2_400_000;
    const SPAN_IN_MINUTES: number = 26 * 60;
    const volumeProjectId: ObjectID = ObjectID.generate();
    const volumeSourceId: ObjectID = ObjectID.generate();
    const NO_INDEX_TABLE: string = `${TABLE_NAME}_before_upgrade`;
    let start: Date;
    // The minute measured: two hours before the last events happened.
    let minute: Date;

    function generateInto(table: string): string {
      return `INSERT INTO ${database}.${table} (_id, projectId, primaryEntityId, primaryEntityType, time, createdAt, eventUid, classUid, className, statusName, severityId, severityName, message, principalIp, observables, attributes, attributeKeys, retentionDate)
        SELECT
          toString(generateUUIDv7(number)),
          {projectId:String},
          {sourceId:String},
          'OpenTelemetry',
          happened,
          toDateTime(happened + toIntervalSecond(lagSeconds)),
          concat('volume-', toString(number)),
          3002,
          'Authentication',
          if(number % 5 = 0, 'Failure', 'Success'),
          3,
          'Medium',
          'A sign-in',
          ip,
          [ip],
          map('oneuptime.log.id', toString(number)),
          ['oneuptime.log.id'],
          now() + toIntervalDay(30)
        FROM (
          SELECT
            number,
            toDateTime64({start:DateTime64(9)}, 9) + toIntervalMillisecond(intDiv(number * {spanInMs:UInt64}, {rows:UInt64})) AS happened,
            cityHash64(number) % 1000 AS share,
            multiIf(
              share < 900, 1 + share % 5,
              share < 970, 6 + cityHash64(number, 1) % 115,
              share < 995, 121 + cityHash64(number, 2) % 480,
              601 + cityHash64(number, 3) % 21000
            ) AS lagSeconds,
            concat('10.', toString(number % 200), '.', toString(intDiv(number, 200) % 250), '.1') AS ip
          FROM numbers({rows:UInt64})
        )`;
    }

    beforeAll(async (): Promise<void> => {
      start = new Date(
        Math.floor(Date.now() / MINUTE) * MINUTE - SPAN_IN_MINUTES * MINUTE,
      );
      minute = new Date(start.getTime() + (SPAN_IN_MINUTES - 120) * MINUTE);

      const knows: { json: () => Promise<unknown> } = await client.query({
        query:
          "SELECT count() AS known FROM system.settings WHERE name = 'use_query_condition_cache'",
        format: "JSONEachRow",
      });
      const known: Array<{ known: string }> = (await knows.json()) as Array<{
        known: string;
      }>;

      measuringSettings =
        Number(known[0]?.known || 0) > 0 ? "use_query_condition_cache = 0" : "";

      await createTable({
        clickhouse,
        modelType: SecurityEvent,
        tableName: NO_INDEX_TABLE,
        withoutCreatedAtIndex: true,
      });

      for (const table of [TABLE_NAME, NO_INDEX_TABLE]) {
        await client.command({
          query: generateInto(table),
          query_params: {
            projectId: volumeProjectId.toString(),
            sourceId: volumeSourceId.toString(),
            start: OneUptimeDate.toClickhouseDateTime64(start),
            spanInMs: SPAN_IN_MINUTES * MINUTE,
            rows: ROWS,
          },
        });

        await client.command({
          query: `OPTIMIZE TABLE ${database}.${table} FINAL`,
        });
      }
    });

    function condition(): Statement {
      const definition: DetectionRuleDefinition =
        SigmaRuleSetParser.parse(FAILED_SIGN_IN);

      if (definition.kind !== "single") {
        throw new Error("The rule is a single rule.");
      }

      return SigmaClickhouseCompiler.compile(definition.rule);
    }

    // The read a one-minute rule made before: the minute's events, by when they happened.
    async function eventTimeRead(): Promise<Statement> {
      return await statementOf(async (): Promise<unknown> => {
        return await SecurityEventService.findDetectionMatches({
          projectId: volumeProjectId,
          startTime: minute,
          endTime: new Date(minute.getTime() + MINUTE),
          whereFragment: condition(),
          groupByExpression: null,
          distinctCountExpression: null,
          minMatchCount: 1,
          maxGroups: 10001,
        });
      });
    }

    // The read a one-minute rule makes now: what arrived in the minute, whenever it happened.
    async function arrivalRead(): Promise<Statement> {
      const range: { arrivedAfter: Date; arrivedUntil: Date } = {
        arrivedAfter: minute,
        arrivedUntil: new Date(minute.getTime() + MINUTE),
      };
      const bounds: { happenedAfter: Date; happenedBefore: Date } =
        getArrivalEventTimeBounds(range);
      const restriction: Statement = isDetectionArrivalCandidate({
        kind: "run",
        ...range,
        candidateStartTime: bounds.happenedAfter,
        candidateEndTime: bounds.happenedBefore,
      });
      const where: Statement = condition();
      where.append(" AND ");
      where.append(restriction);

      return await statementOf(async (): Promise<unknown> => {
        return await SecurityEventService.findDetectionMatches({
          projectId: volumeProjectId,
          startTime: bounds.happenedAfter,
          endTime: bounds.happenedBefore,
          whereFragment: where,
          groupByExpression: null,
          distinctCountExpression: null,
          minMatchCount: 1,
          maxGroups: 10001,
          readFirstSeen: true,
        });
      });
    }

    // A rule that counts: which windows hold what arrived in the minute.
    async function windowsRead(): Promise<Statement> {
      const range: { arrivedAfter: Date; arrivedUntil: Date } = {
        arrivedAfter: minute,
        arrivedUntil: new Date(minute.getTime() + MINUTE),
      };

      return await statementOf(
        async (): Promise<Array<DetectionArrivalWindow>> => {
          return await SecurityEventService.findDetectionArrivalWindows({
            projectId: volumeProjectId,
            ...range,
            ...getArrivalEventTimeBounds(range),
            whereFragment: condition(),
            windowInMinutes: 5,
            limit: DETECTION_MAX_WINDOWS_PER_RUN + 1,
          });
        },
      );
    }

    // How many events arrived in the minute more than a few seconds after they happened.
    async function lateArrivals(): Promise<number> {
      const result: { json: () => Promise<unknown> } = await client.query({
        query: `SELECT count() AS late FROM ${database}.${TABLE_NAME} WHERE projectId = {projectId:String} AND createdAt > {after:DateTime} AND createdAt <= {until:DateTime} AND time < {after:DateTime}`,
        query_params: {
          projectId: volumeProjectId.toString(),
          after: OneUptimeDate.toClickhouseDateTime(minute),
          until: OneUptimeDate.toClickhouseDateTime(
            new Date(minute.getTime() + MINUTE),
          ),
        },
        format: "JSONEachRow",
      });
      const rows: Array<{ late: string }> = (await result.json()) as Array<{
        late: string;
      }>;

      return Number(rows[0]?.late || 0);
    }

    test("reading what arrived costs at most a granule more for each late event, not the day it may come from", async () => {
      const before: number = await rowsRead(await eventTimeRead());
      const now: number = await rowsRead(await arrivalRead());
      const windows: number = await rowsRead(await windowsRead());
      const late: number = await lateArrivals();
      const withoutIndex: number = await rowsRead(
        await arrivalRead(),
        withoutSkipIndexes(await arrivalRead()),
      );

      if (process.env["DETECTION_ARRIVALS_COST_REPORT"]) {
        process.stdout.write(
          `${JSON.stringify({
            rowsInProject: ROWS,
            eventTimeReadRowsRead: before,
            arrivalReadRowsRead: now,
            arrivalWindowsReadRowsRead: windows,
            arrivalReadWithoutIndexRowsRead: withoutIndex,
            lateArrivalsInTheMinute: late,
          })}\n`,
        );
      }

      expect(late).toBeGreaterThan(0);
      // Each late event costs at most the granule it sits in.
      expect(now).toBeLessThanOrEqual(before + (late + 2) * INDEX_GRANULARITY);
      expect(windows).toBeLessThanOrEqual(
        before + (late + 2) * INDEX_GRANULARITY,
      );
      // Without the index, the read covers the rows of the whole day the run's events may come from.
      expect(withoutIndex).toBeGreaterThan(8 * now);
    });

    test("an install from before the upgrade reads its whole day until the index is built for the parts it has, then reads as little", async () => {
      const statement: Statement = await arrivalRead();
      const onOldParts: string = statement.query.replace(
        `.${TABLE_NAME} `,
        `.${NO_INDEX_TABLE} `,
      );

      expect(onOldParts).not.toBe(statement.query);

      const unindexed: number = await rowsRead(statement, onOldParts);
      const indexed: number = await rowsRead(statement);

      // What the upgrade's migration does (MaterializeSecurityEventCreatedAtIndex), waiting for it here.
      const indexedColumn: AnalyticsTableColumnLike | undefined =
        new SecurityEvent().tableColumns.find(
          (column: AnalyticsTableColumnLike): boolean => {
            return (
              column.skipIndex?.name === SECURITY_EVENT_CREATED_AT_INDEX_NAME
            );
          },
        );

      await client.command({
        query: `ALTER TABLE ${database}.${NO_INDEX_TABLE} ADD INDEX IF NOT EXISTS ${StatementGenerator.toSkipIndexDefinition(indexedColumn!)}`,
      });
      await client.command({
        query: `ALTER TABLE ${database}.${NO_INDEX_TABLE} MATERIALIZE INDEX ${SECURITY_EVENT_CREATED_AT_INDEX_NAME} SETTINGS mutations_sync = 2`,
      });

      const materialized: number = await rowsRead(statement, onOldParts);

      expect(unindexed).toBeGreaterThan(8 * indexed);
      expect(materialized).toBe(indexed);
    });
  });
});

describe("a scheduled rule judges every event once: ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
