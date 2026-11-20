import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import SecurityEvent from "Common/Models/AnalyticsModels/SecurityEvent";
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
import SecurityEventService from "Common/Server/Services/SecurityEventService";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import SecurityCaseIngest, {
  SecurityCaseIngestResult,
  SecurityDetectionSignal,
} from "Common/Server/Utils/SecurityCase/SecurityCaseIngest";
import SecurityConnections from "Common/Server/Utils/SecurityEvent/Connections/SecurityConnections";
import DetectionRuleEvaluator from "Common/Server/Utils/SecurityEvent/DetectionRuleEvaluator";
import SecurityEntityRiskRecorder from "Common/Server/Utils/SecurityEvent/EntityRisk/SecurityEntityRiskRecorder";
import Includes from "Common/Types/BaseDatabase/Includes";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { SecurityDetectionMatchedEvent } from "Common/Types/SecurityCase/SecurityDetectionMatchedEvents";
import ServiceType from "Common/Types/Telemetry/ServiceType";
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
 * services deduplicate them; the events, the rules' reads and their
 * Detection Findings are ClickHouse's.
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

// Every test's minute 0: on the hour, a day back, so a day of history fits before it.
const BASE: Date = new Date(Math.floor(Date.now() / HOUR) * HOUR - 26 * HOUR);

function at(minute: number, second: number = 0): Date {
  return new Date(BASE.getTime() + minute * MINUTE + second * SECOND);
}

const OPEN_ALERT_STATE_ID: ObjectID = ObjectID.generate();

const TABLE_NAME: string = new SecurityEvent().tableName;

const FAILED_SIGN_IN: string = `title: Failed sign-in
id: 7c0f2a51-0000-4000-8000-000000010337
level: high
detection:
  selection:
    className: Authentication
    statusName: Failure
  condition: selection
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
  public readonly signals: Array<SecurityDetectionSignal> = [];
  public readonly pending: Array<ArrivingEvent> = [];
  // The Detection Findings the rules wrote, as written.
  public readonly findings: Array<JSONObject> = [];
  public turns: number = 0;
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
async function createTable(
  clickhouse: ClickhouseDatabase,
  modelType: { new (): AnalyticsBaseModel },
): Promise<void> {
  const model: AnalyticsBaseModel = new modelType();
  const generator: StatementGenerator<AnalyticsBaseModel> =
    new StatementGenerator<AnalyticsBaseModel>({
      modelType: modelType,
      database: clickhouse,
    });
  const columns: Statement = generator.toColumnsCreateStatement(
    model.tableColumns,
  );

  await client.command({
    query: `CREATE TABLE ${database}.${model.tableName} (${columns.query}) ENGINE = MergeTree PARTITION BY (${model.partitionKey}) ORDER BY (${model.sortKeys.join(", ")})`,
    query_params: columns.query_params,
  });
}

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

function addRule(options: {
  name: string;
  intervalInMinutes: number;
  groupByField?: string | undefined;
  matchCountThreshold?: number | undefined;
  distinctCountField?: string | undefined;
  yaml?: string | undefined;
  lastEvaluatedAt?: Date | undefined;
  shouldCreateAlert?: boolean | undefined;
}): DetectionRule {
  const rule: DetectionRule = new DetectionRule();
  rule._id = ObjectID.generate().toString();
  rule.projectId = world.projectId;
  rule.name = options.name;
  rule.sigmaRuleYaml = options.yaml ?? FAILED_SIGN_IN;
  rule.isEnabled = true;
  rule.isRealTime = false;
  rule.evaluationIntervalInMinutes = options.intervalInMinutes;
  rule.groupByField = options.groupByField ?? "principalIp";
  rule.matchCountThreshold = options.matchCountThreshold ?? 1;
  rule.shouldCreateAlert = options.shouldCreateAlert ?? false;
  rule.shouldCreateIncident = false;
  rule.shouldWriteDetectionFinding = true;
  rule.shouldCreateCase = true;
  rule.riskScore = 0;

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
    "lastMatchAt",
    "lastError",
  ]) {
    (copy as unknown as JSONObject)[key] = (rule as unknown as JSONObject)[key];
  }

  return copy;
}

function storedRule(id: unknown): DetectionRule | undefined {
  return world.rules.get(String(id));
}

function applyRuleWrite(rule: DetectionRule, data: JSONObject): void {
  for (const [key, value] of Object.entries(data)) {
    (rule as unknown as JSONObject)[key] = value as never;
  }
}

async function turn(): Promise<void> {
  world.turns++;
  await DetectionRuleEvaluator.evaluateDueRulesForProject(world.projectId);
}

// Runs every minute from `from` through `to`: the events that arrived, then the turn.
async function runMinutes(from: number, to: number): Promise<void> {
  for (let minute: number = from; minute <= to; minute++) {
    world.clock = at(minute);
    await writeArrived();
    await turn();
  }
}

function signalsOf(rule: DetectionRule): Array<SecurityDetectionSignal> {
  return world.signals.filter((signal: SecurityDetectionSignal): boolean => {
    return signal.detectionRuleId.toString() === rule._id;
  });
}

// Every event a rule's detections counted, by uid, as their cases keep them.
function judgedUids(rule: DetectionRule): Array<string> {
  return signalsOf(rule)
    .flatMap((signal: SecurityDetectionSignal): Array<string> => {
      return (signal.matchedEvents?.events || []).map(
        (event: SecurityDetectionMatchedEvent): string => {
          return event.eventUid;
        },
      );
    })
    .sort();
}

function firingsFor(
  rule: DetectionRule,
  groupValue: string,
): Array<SecurityDetectionSignal> {
  return signalsOf(rule).filter((signal: SecurityDetectionSignal): boolean => {
    return signal.groupValue === groupValue;
  });
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
      return Array.from(world.rules.values())
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
    }) as never);

  jest
    .spyOn(DetectionRuleService, "findOneById")
    .mockImplementation((async (args: { id: ObjectID }) => {
      const rule: DetectionRule | undefined = storedRule(args.id);
      return rule ? copyOf(rule) : null;
    }) as never);

  jest
    .spyOn(DetectionRuleService, "findOneBy")
    .mockImplementation((async (args: { query: JSONObject }) => {
      const rule: DetectionRule | undefined = storedRule(args.query["_id"]);
      return rule ? copyOf(rule) : null;
    }) as never);

  jest
    .spyOn(DetectionRuleService, "updateOneById")
    .mockImplementation((async (args: { id: ObjectID; data: JSONObject }) => {
      const rule: DetectionRule | undefined = storedRule(args.id);

      if (!rule) {
        return 0;
      }

      applyRuleWrite(rule, args.data);
      return 1;
    }) as never);

  jest
    .spyOn(DetectionRuleService, "updateOneBy")
    .mockImplementation((async (args: {
      query: JSONObject;
      data: JSONObject;
    }) => {
      const rule: DetectionRule | undefined = storedRule(args.query["_id"]);

      if (!rule) {
        return 0;
      }

      // The compare-and-set a bookkeeping write is: the cursor it was read with.
      if (Object.prototype.hasOwnProperty.call(args.query, "lastEvaluatedAt")) {
        const expected: unknown = args.query["lastEvaluatedAt"];
        const held: number | null = rule.lastEvaluatedAt
          ? new Date(rule.lastEvaluatedAt).getTime()
          : null;
        const wanted: number | null =
          expected instanceof Date ? expected.getTime() : null;

        if (held !== wanted) {
          return 0;
        }
      }

      applyRuleWrite(rule, args.data);
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

  // A case per fingerprint while it is open: a detection already in one repeats.
  jest.spyOn(SecurityCaseIngest, "recordDetections").mockImplementation((async (
    signals: Array<SecurityDetectionSignal>,
  ) => {
    const result: SecurityCaseIngestResult = {
      casesOpened: 0,
      detectionsAdded: 0,
      detectionsRepeated: 0,
    };

    for (const signal of signals) {
      world.signals.push(signal);

      if (world.openCases.has(signal.fingerprint)) {
        result.detectionsRepeated++;
        continue;
      }

      world.openCases.add(signal.fingerprint);
      world.casesOpened++;
      result.casesOpened++;
    }

    return result;
  }) as never);

  jest.spyOn(SecurityEntityRiskRecorder, "record").mockResolvedValue({
    entitiesUpdated: 0,
    riskCasesRaised: 0,
  } as never);

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
    world.findings.push(...rows);
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

    await createTable(clickhouse, SecurityEvent);

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

      world.pending.push(
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
  });

  describe("a rule that counts", () => {
    test("a late event that brings its window to the threshold fires the group, once", async () => {
      const rule: DetectionRule = addRule({
        name: "Three failed sign-ins from one address",
        intervalInMinutes: 5,
        matchCountThreshold: 3,
        lastEvaluatedAt: at(0),
      });

      world.pending.push(
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
  });
});

describe("a scheduled rule judges every event once: ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
