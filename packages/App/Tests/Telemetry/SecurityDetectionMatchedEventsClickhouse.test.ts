import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import SecurityEvent from "Common/Models/AnalyticsModels/SecurityEvent";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import { ClickHouseSettings } from "Common/Server/Services/AnalyticsDatabaseService";
import SecurityEventService, {
  DetectionMatchGroup,
} from "Common/Server/Services/SecurityEventService";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import {
  SQL,
  Statement,
} from "Common/Server/Utils/AnalyticsDatabase/Statement";
import SecurityDetectionMatchedEventsReader from "Common/Server/Utils/SecurityCase/SecurityDetectionMatchedEventsReader";
import SecurityCaseMatches from "Common/Server/Utils/SecurityCase/Context/SecurityCaseMatches";
import DetectionRuleEvaluator from "Common/Server/Utils/SecurityEvent/DetectionRuleEvaluator";
import DetectionRuleRetrohunt from "Common/Server/Utils/SecurityEvent/DetectionRuleRetrohunt";
import TelemetryReadAccess from "Common/Server/Utils/Telemetry/TelemetryReadAccess";
import DetectionRuleService from "Common/Server/Services/DetectionRuleService";
import SecurityCaseService from "Common/Server/Services/SecurityCaseService";
import SecurityDetectionService from "Common/Server/Services/SecurityDetectionService";
import SecurityDetection from "Common/Models/DatabaseModels/SecurityDetection";
import {
  SecurityCaseMatchBasis,
  SecurityCaseMatchedDetectionJson,
  SecurityCaseMatchesJson,
} from "Common/Types/SecurityCase/SecurityCaseMatches";
import SecurityDetectionSource from "Common/Types/SecurityCase/SecurityDetectionSource";
import SigmaClickhouseCompiler, {
  buildSigmaFieldExpression,
} from "Common/Server/Utils/SecurityEvent/Sigma/SigmaClickhouseCompiler";
import DetectionRule from "Common/Models/DatabaseModels/DetectionRule";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  SECURITY_DETECTION_MATCHED_EVENTS_FIRING_MAX,
  SECURITY_DETECTION_MATCHED_EVENTS_MAX,
  SecurityDetectionMatchedEvent,
  SecurityDetectionMatchedEvents,
  getSecurityDetectionMatchedEventsShare,
} from "Common/Types/SecurityCase/SecurityDetectionMatchedEvents";
import { DETECTION_MAX_GROUPS_PER_EVALUATION } from "Common/Types/SecurityEvent/DetectionFindingConstants";
import { DetectionRuleDefinition } from "Common/Types/SecurityEvent/SigmaCorrelation";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import SigmaRuleSetParser, {
  detectionRuleHeader,
} from "Common/Utils/SecurityEvent/Sigma/SigmaRuleSetParser";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * ------------------------------------------------------------------
 * The events a detection keeps when it fires (#9619), read against a real
 * ClickHouse server, under its current analyzer and the older one
 * (SecurityDetectionMatchedEventsReader):
 *
 *   a rule's groups      its condition, for each group it opens at once,
 *                        the earliest of each first, at most the bound,
 *                        with how far all of their requests got;
 *   one group            a rule that does not group;
 *   a feed's indicators  every event carrying one, in any case, but the
 *                        Detection Findings;
 *   a correlation's      every group it fires for at once - a run's 100 -
 *   groups               by its own group-by, each keeping its share of
 *                        the firing, in one read (#9795);
 *   a correlation's      what Why This Case Was Opened lists for one that
 *   case                 kept none: its own group's events, by its own
 *                        group-by, over its run's window - exactly what it
 *                        would have kept - and none of the near misses
 *                        naming its address, which the read by what the
 *                        events name listed; a group no observable holds
 *                        (a route) too (#9939);
 *
 * each only the project's own events, in the window the source read. Run
 * on a table built from the SecurityEvent model.
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server,
 * credentials in the URL:
 *
 *   docker run -d --rm --name detection-kept-ch -p 18125:8123 \
 *     -e CLICKHOUSE_PASSWORD=test clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18125 \
 *     npx jest Tests/Telemetry/SecurityDetectionMatchedEventsClickhouse.test.ts
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

jest.setTimeout(240000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `detection_kept_test_${process.pid}_${Date.now()}`;

const MINUTE: number = 60 * 1000;

// The run's window: ten minutes ending at a fixed moment.
const END: Date = new Date(
  Math.floor(Date.now() / (60 * MINUTE)) * 60 * MINUTE,
);
const START: Date = new Date(END.getTime() - 10 * MINUTE);

const FAILED_SIGN_INS: string = `title: Failed sign-ins
id: 7c0f2a51-0000-4000-8000-000000000001
level: high
detection:
  selection:
    className: Authentication
    statusName: Failure
  condition: selection
`;

interface Connection {
  name: string;
  database: ClickhouseDatabase;
  client: ClickhouseClient;
}

async function readJson<T>(
  client: ClickhouseClient,
  query: string,
): Promise<Array<T>> {
  const result: { json: () => Promise<unknown> } = await client.query({
    query: query,
    format: "JSONEachRow",
  });

  return (await result.json()) as Array<T>;
}

// The model's own table under a plain MergeTree (no Keeper on a disposable server).
async function createTable(
  client: ClickhouseClient,
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

function eventRow(data: {
  projectId: ObjectID;
  sourceId: ObjectID;
  time: Date;
  uid: string;
  principalIp?: string | undefined;
  principalUser?: string | undefined;
  statusName?: string | undefined;
  classUid?: number | undefined;
  className?: string | undefined;
  observables?: Array<string> | undefined;
  requestOutcome?: string | undefined;
  attributes?: Record<string, string> | undefined;
}): JSONObject {
  const attributes: Record<string, string> = {
    "oneuptime.log.id": `log-${data.uid}`,
    ...(data.attributes || {}),
  };

  return {
    _id: ObjectID.generate().toString(),
    projectId: data.projectId.toString(),
    primaryEntityId: data.sourceId.toString(),
    primaryEntityType: ServiceType.OpenTelemetry,
    time: OneUptimeDate.toClickhouseDateTime64(data.time),
    createdAt: OneUptimeDate.toClickhouseDateTime(data.time),
    eventUid: data.uid,
    classUid: data.classUid ?? 3002,
    className:
      data.className ??
      (data.classUid === 2004 ? "Detection Finding" : "Authentication"),
    statusName: data.statusName ?? "Failure",
    severityId: 3,
    severityName: "Medium",
    message: `Failed sign-in ${data.uid}`,
    principalIp: data.principalIp ?? "",
    principalUser: data.principalUser ?? "",
    observables: data.observables ?? [data.principalIp ?? ""],
    requestOutcome: data.requestOutcome ?? "",
    attributes: attributes,
    attributeKeys: Object.keys(attributes),
    retentionDate: OneUptimeDate.toClickhouseDateTime(
      new Date(END.getTime() + 30 * 24 * 60 * MINUTE),
    ),
  };
}

type ConnectableService = {
  database: ClickhouseDatabase;
  databaseClient: ClickhouseClient | null;
};

const service: ConnectableService =
  SecurityEventService as unknown as ConnectableService;

/*
 * A correlation over failed and successful sign-ins (#9795): failures, then
 * a success, from one address - or, by two fields, one user from one
 * address - within ten minutes.
 */
function signInSequence(groupBy: Array<string>): string {
  return `title: Failed sign-in
id: 7c0f2a51-0000-4000-8000-000000000002
name: failed_sign_in
level: low
detection:
  selection:
    className: Authentication
    statusName: Failure
  condition: selection
---
title: Successful sign-in
id: 7c0f2a51-0000-4000-8000-000000000003
name: successful_sign_in
level: low
detection:
  selection:
    className: Authentication
    statusName: Success
  condition: selection
---
title: Failed then successful sign-in
id: 7c0f2a51-0000-4000-8000-000000000004
level: high
correlation:
  type: temporal_ordered
  rules:
    - failed_sign_in
    - successful_sign_in
  group-by:
${groupBy
  .map((field: string): string => {
    return `    - ${field}`;
  })
  .join("\n")}
  timespan: 10m
`;
}

// What a correlation's run keeps for its groups, read as the evaluator reads it.
async function readCorrelationGroups(data: {
  projectId: ObjectID;
  groupBy: Array<string>;
  groupValues: Array<string>;
}): Promise<Map<string, SecurityDetectionMatchedEvents>> {
  const yaml: string = signInSequence(data.groupBy);
  const definition: DetectionRuleDefinition = SigmaRuleSetParser.parse(yaml);
  const rule: DetectionRule = new DetectionRule();

  rule._id = ObjectID.generate().toString();
  rule.projectId = data.projectId;
  rule.name = "Failed then successful sign-in";
  rule.sigmaRuleYaml = yaml;

  return DetectionRuleEvaluator.readMatchedEvents({
    rule,
    definition,
    parsedRule: detectionRuleHeader(definition),
    matchedGroups: data.groupValues.map(
      (groupValue: string): DetectionMatchGroup => {
        return {
          groupValue,
          matchCount: 1,
          distinctCount: 0,
          sampleMessage: "",
          sampleObservables: [],
        };
      },
    ),
    startTime: START,
    endTime: END,
    restrictTo: undefined,
    exceptionsFilter: null,
  });
}

function failedSignInsCondition(): Statement {
  const definition: DetectionRuleDefinition =
    SigmaRuleSetParser.parse(FAILED_SIGN_INS);

  if (definition.kind !== "single") {
    throw new Error("The test rule is a single rule.");
  }

  return SigmaClickhouseCompiler.compile(definition.rule);
}

function uids(kept: SecurityDetectionMatchedEvents | undefined): Array<string> {
  return (kept?.events || []).map(
    (event: SecurityDetectionMatchedEvent): string => {
      return event.eventUid;
    },
  );
}

// A burst of server errors on one route (#9939): grouped by a field no observable holds.
const ROUTE_BURST: string = `title: Server error
id: 7c0f2a51-0000-4000-8000-000000000005
name: server_error
level: low
detection:
  selection:
    className: HTTP Activity
    statusName: Failure
  condition: selection
---
title: A burst of server errors on one route
id: 7c0f2a51-0000-4000-8000-000000000006
level: high
correlation:
  type: event_count
  rules:
    - server_error
  group-by:
    - http.route
  timespan: 5m
  condition:
    gte: 3
`;

/*
 * What a case's Why This Case Was Opened lists for a correlation's
 * detection (SecurityCaseMatches, #9939): its Postgres reads answered here
 * - the case, the detection as it was recorded, its rule, run every ten
 * minutes and firing as the run ended - and its events read from this
 * ClickHouse, as a reader whose role reads every source.
 */
async function caseMatchesOf(data: {
  projectId: ObjectID;
  yaml: string;
  groupValue: string;
  firedAt: Date;
  // What the detection kept as it fired; none when left out.
  kept?: SecurityDetectionMatchedEvents | undefined;
}): Promise<SecurityCaseMatchedDetectionJson> {
  const caseId: ObjectID = ObjectID.generate();
  const rule: DetectionRule = new DetectionRule();
  rule._id = ObjectID.generate().toString();
  rule.projectId = data.projectId;
  rule.name = "A correlation";
  rule.sigmaRuleYaml = data.yaml;
  rule.isEnabled = true;
  rule.evaluationIntervalInMinutes = 10;
  rule.matchCountThreshold = 1;

  const detection: SecurityDetection = new SecurityDetection();
  detection._id = ObjectID.generate().toString();
  detection.title = `A correlation - ${data.groupValue}`;
  detection.source = SecurityDetectionSource.DetectionRule;
  detection.groupValue = data.groupValue;
  detection.firstSeenAt = data.firedAt;
  detection.lastSeenAt = data.firedAt;
  detection.eventCount = 1;
  detection.fireCount = 1;
  detection.detectionRuleId = new ObjectID(rule._id);

  if (data.kept) {
    detection.matchedEvents = JSON.parse(JSON.stringify(data.kept)) as never;
  }

  const spies: Array<{ mockRestore: () => void }> = [
    jest.spyOn(SecurityCaseService, "findOneBy").mockResolvedValue({
      _id: caseId.toString(),
      id: caseId,
      projectId: data.projectId,
      entities: [],
      createdAt: data.firedAt,
      firstDetectedAt: data.firedAt,
      lastDetectedAt: data.firedAt,
      detectionCount: 1,
    } as never),
    jest
      .spyOn(SecurityDetectionService, "findBy")
      .mockResolvedValue([detection] as never),
    jest
      .spyOn(DetectionRuleService, "findBy")
      .mockResolvedValue([rule] as never),
    jest
      .spyOn(TelemetryReadAccess, "getServiceFilter")
      .mockResolvedValue({} as never),
    jest
      .spyOn(DetectionRuleRetrohunt, "loadDefinition")
      .mockImplementation(async (): Promise<DetectionRuleDefinition> => {
        return SigmaRuleSetParser.parse(data.yaml);
      }),
  ];

  try {
    const answer: SecurityCaseMatchesJson | null =
      await SecurityCaseMatches.build({
        projectId: data.projectId,
        securityCaseId: caseId,
        props: { isRoot: true },
        now: new Date(data.firedAt.getTime() + 60 * MINUTE),
      });

    expect(answer!.failedSources).toEqual([]);

    return answer!.detections[0]!;
  } finally {
    for (const spy of spies) {
      spy.mockRestore();
    }
  }
}

function listedUids(
  detection: SecurityCaseMatchedDetectionJson,
): Array<string> {
  return detection.events.map((event: { eventUid: string }): string => {
    return event.eventUid;
  });
}

integration("the events a detection keeps, against ClickHouse", () => {
  let clickhouse: ClickhouseDatabase;
  let client: ClickhouseClient;
  let options: ClickHouseClientConfigOptions;
  const connections: Array<Connection> = [];
  let original: ConnectableService | null = null;

  beforeAll(async (): Promise<void> => {
    const url: URL = new URL(endpoint!);

    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
      throw new Error(
        "TEST_CLICKHOUSE_URL must point at a local, disposable ClickHouse server.",
      );
    }

    options = {
      url: `${url.protocol}//${url.host}`,
      username: decodeURIComponent(url.username) || "default",
      password: decodeURIComponent(url.password),
      database: database,
      request_timeout: 120000,
    };

    clickhouse = new ClickhouseDatabase(options);
    client = await clickhouse.connect(options);

    await createTable(client, clickhouse, SecurityEvent);

    connections.push({
      name: "the current analyzer",
      database: clickhouse,
      client: client,
    });

    const [setting] = await readJson<{ name: string }>(
      client,
      "SELECT name FROM system.settings WHERE name IN ('enable_analyzer', 'allow_experimental_analyzer') ORDER BY name = 'enable_analyzer' DESC LIMIT 1",
    );

    if (setting) {
      const olderOptions: ClickHouseClientConfigOptions = {
        ...options,
        clickhouse_settings: { [setting.name]: 0 } as ClickHouseSettings,
      };
      const olderDatabase: ClickhouseDatabase = new ClickhouseDatabase(
        olderOptions,
      );

      connections.push({
        name: "the older analyzer",
        database: olderDatabase,
        client: await olderDatabase.connect(olderOptions),
      });
    }

    original = {
      database: service.database,
      databaseClient: service.databaseClient,
    };
  });

  afterAll(async (): Promise<void> => {
    if (original) {
      Object.assign(service, original);
    }

    if (client) {
      await client.command({ query: `DROP DATABASE IF EXISTS ${database}` });
    }

    for (const connection of connections) {
      await connection.database.disconnect();
    }
  });

  test("the server knows the older analyzer, so both are run", () => {
    expect(connections).toHaveLength(2);
  });

  describe.each([
    ["the current analyzer", 0],
    ["the older analyzer", 1],
  ])("through %s", (_name: string, position: number) => {
    // A project of each run's own, so the two runs never read each other's rows.
    const projectId: ObjectID = ObjectID.generate();
    const otherProjectId: ObjectID = ObjectID.generate();
    const sourceId: ObjectID = ObjectID.generate();
    const busy: string = "203.0.113.7";
    const quiet: string = "198.51.100.9";
    const prefix: string = `run${position}`;
    // A project of its own for the correlation's events, kept out of the rule's reads.
    const correlationProjectId: ObjectID = ObjectID.generate();
    // A run's most groups at once: each address fails twelve times, then signs in.
    const sequenceAddresses: Array<string> = Array.from(
      { length: DETECTION_MAX_GROUPS_PER_EVALUATION },
      (_: unknown, index: number): string => {
        return `198.18.${Math.floor(index / 250)}.${index % 250}`;
      },
    );
    const sequenceUid: (address: string, step: string) => string = (
      address: string,
      step: string,
    ): string => {
      return `${prefix}-seq-${address}-${step}`;
    };
    /*
     * A project of its own for a case's correlation detections (#9939):
     * failures then a success from the address that fired, and near misses
     * around them - another address's failure and a sign-in to it, each
     * naming the address among its observables, its own failure hours
     * before, a request that names it - none of them its group's events.
     */
    const caseProjectId: ObjectID = ObjectID.generate();
    const firingAddress: string = "203.0.113.50";
    const caseUid: (name: string) => string = (name: string): string => {
      return `${prefix}-case-${name}`;
    };

    beforeAll(async (): Promise<void> => {
      const connection: Connection = connections[position]!;

      service.database = connection.database;
      service.databaseClient = connection.client;

      const at: (seconds: number) => Date = (seconds: number): Date => {
        return new Date(START.getTime() + seconds * 1000);
      };
      const rows: Array<JSONObject> = [];

      // Thirty failures from the busy address, written newest first.
      for (let index: number = 29; index >= 0; index--) {
        rows.push(
          eventRow({
            projectId,
            sourceId,
            time: at(10 + index),
            uid: `${prefix}-busy-${String(index).padStart(2, "0")}`,
            principalIp: busy,
            requestOutcome: index < 3 ? "Reached App" : "Rejected",
          }),
        );
      }

      rows.push(
        // Three from the quiet one.
        ...[0, 1, 2].map((index: number): JSONObject => {
          return eventRow({
            projectId,
            sourceId,
            time: at(100 + index),
            uid: `${prefix}-quiet-${index}`,
            principalIp: quiet,
          });
        }),
        // A success from the busy address: the condition does not match it.
        eventRow({
          projectId,
          sourceId,
          time: at(200),
          uid: `${prefix}-success`,
          principalIp: busy,
          statusName: "Success",
        }),
        // Before the window, after it, and another project's: never read.
        eventRow({
          projectId,
          sourceId,
          time: new Date(START.getTime() - MINUTE),
          uid: `${prefix}-before`,
          principalIp: busy,
        }),
        eventRow({
          projectId,
          sourceId,
          time: END,
          uid: `${prefix}-at-the-end`,
          principalIp: busy,
        }),
        eventRow({
          projectId: otherProjectId,
          sourceId,
          time: at(20),
          uid: `${prefix}-other-project`,
          principalIp: busy,
        }),
        // A feed's indicator, carried in another case, and a finding about it.
        eventRow({
          projectId,
          sourceId,
          time: at(300),
          uid: `${prefix}-indicator`,
          principalIp: "",
          observables: ["Evil.Example.com", "10.0.0.5"],
          statusName: "Success",
        }),
        eventRow({
          projectId,
          sourceId,
          time: at(301),
          uid: `${prefix}-finding`,
          classUid: 2004,
          principalIp: "",
          observables: ["evil.example.com"],
        }),
      );

      // A correlation's groups: twelve failures from each address, then a success.
      for (const address of sequenceAddresses) {
        for (let index: number = 11; index >= 0; index--) {
          rows.push(
            eventRow({
              projectId: correlationProjectId,
              sourceId,
              time: at(400 + index),
              uid: sequenceUid(address, String(index).padStart(2, "0")),
              principalIp: address,
              requestOutcome: "Rejected",
            }),
          );
        }

        rows.push(
          eventRow({
            projectId: correlationProjectId,
            sourceId,
            time: at(450),
            uid: sequenceUid(address, "ok"),
            principalIp: address,
            statusName: "Success",
            requestOutcome: "Reached App",
          }),
        );
      }

      // One user from one address, by two fields: alice and bob there, alice elsewhere.
      rows.push(
        ...[0, 1, 2].map((index: number): JSONObject => {
          return eventRow({
            projectId: correlationProjectId,
            sourceId,
            time: at(500 + index),
            uid: `${prefix}-alice-${index}`,
            principalUser: "alice",
            principalIp: "198.19.0.1",
          });
        }),
        eventRow({
          projectId: correlationProjectId,
          sourceId,
          time: at(510),
          uid: `${prefix}-alice-ok`,
          principalUser: "alice",
          principalIp: "198.19.0.1",
          statusName: "Success",
        }),
        eventRow({
          projectId: correlationProjectId,
          sourceId,
          time: at(501),
          uid: `${prefix}-bob-0`,
          principalUser: "bob",
          principalIp: "198.19.0.1",
        }),
        eventRow({
          projectId: correlationProjectId,
          sourceId,
          time: at(511),
          uid: `${prefix}-bob-ok`,
          principalUser: "bob",
          principalIp: "198.19.0.1",
          statusName: "Success",
        }),
        eventRow({
          projectId: correlationProjectId,
          sourceId,
          time: at(505),
          uid: `${prefix}-alice-elsewhere`,
          principalUser: "alice",
          principalIp: "198.19.0.2",
        }),
      );

      // A case's correlation (#9939): the group that fired, and its near misses.
      rows.push(
        ...[0, 1, 2].map((index: number): JSONObject => {
          return eventRow({
            projectId: caseProjectId,
            sourceId,
            time: at(60 + index),
            uid: caseUid(`fail-${index}`),
            principalIp: firingAddress,
            requestOutcome: "Rejected",
          });
        }),
        eventRow({
          projectId: caseProjectId,
          sourceId,
          time: at(120),
          uid: caseUid("ok"),
          principalIp: firingAddress,
          statusName: "Success",
          requestOutcome: "Reached App",
        }),
        // Another address's failure, naming the address among its observables.
        eventRow({
          projectId: caseProjectId,
          sourceId,
          time: at(63),
          uid: caseUid("other-group-naming"),
          principalIp: "203.0.113.51",
          observables: ["203.0.113.51", firingAddress],
        }),
        // A sign-in from elsewhere to the address: its target, not its source.
        eventRow({
          projectId: caseProjectId,
          sourceId,
          time: at(121),
          uid: caseUid("to-the-address"),
          principalIp: "198.51.100.77",
          statusName: "Success",
          observables: ["198.51.100.77", firingAddress],
        }),
        // The address's own failure, two hours before its run.
        eventRow({
          projectId: caseProjectId,
          sourceId,
          time: new Date(START.getTime() - 120 * MINUTE),
          uid: caseUid("hours-before"),
          principalIp: firingAddress,
        }),
        // A request from the address: no step of the correlation.
        eventRow({
          projectId: caseProjectId,
          sourceId,
          time: at(90),
          uid: caseUid("request"),
          principalIp: firingAddress,
          className: "HTTP Activity",
          statusName: "Success",
        }),
        // Server errors on the checkout route, and two on the cart's.
        ...[0, 1, 2, 3].map((index: number): JSONObject => {
          return eventRow({
            projectId: caseProjectId,
            sourceId,
            time: at(200 + index),
            uid: caseUid(`checkout-${index}`),
            principalIp: `198.51.100.${10 + index}`,
            className: "HTTP Activity",
            attributes: { "http.route": "/api/checkout" },
          });
        }),
        ...[0, 1].map((index: number): JSONObject => {
          return eventRow({
            projectId: caseProjectId,
            sourceId,
            time: at(201 + index),
            uid: caseUid(`cart-${index}`),
            principalIp: `198.51.100.${20 + index}`,
            className: "HTTP Activity",
            attributes: { "http.route": "/api/cart" },
          });
        }),
      );

      await client.insert({
        table: `${database}.${new SecurityEvent().tableName}`,
        format: "JSONEachRow",
        values: rows,
      });
    });

    test("a rule's groups: the earliest of each, at most the bound, and how far all of their requests got", async () => {
      const kept: Map<string, SecurityDetectionMatchedEvents> =
        await SecurityDetectionMatchedEventsReader.readForGroups({
          projectId,
          start: START,
          end: END,
          condition: failedSignInsCondition(),
          groupExpression: buildSigmaFieldExpression("principalIp"),
          groupValues: [busy, quiet],
        });

      expect(uids(kept.get(busy))).toHaveLength(
        SECURITY_DETECTION_MATCHED_EVENTS_MAX,
      );
      expect(uids(kept.get(busy))[0]).toBe(`${prefix}-busy-00`);
      expect(uids(kept.get(busy))).toEqual(
        Array.from(
          { length: SECURITY_DETECTION_MATCHED_EVENTS_MAX },
          (_: unknown, index: number): string => {
            return `${prefix}-busy-${String(index).padStart(2, "0")}`;
          },
        ),
      );
      // Every match counts, not only the kept ones.
      expect(kept.get(busy)!.outcomes).toEqual({
        Rejected: 27,
        "Reached App": 3,
      });
      expect(uids(kept.get(quiet))).toEqual([
        `${prefix}-quiet-0`,
        `${prefix}-quiet-1`,
        `${prefix}-quiet-2`,
      ]);
      expect(kept.get(quiet)!.outcomes).toEqual({ "": 3 });
    });

    test("keeps each event as the case shows it: its source, its log line and when it leaves the table", async () => {
      const kept: Map<string, SecurityDetectionMatchedEvents> =
        await SecurityDetectionMatchedEventsReader.readForGroups({
          projectId,
          start: START,
          end: END,
          condition: failedSignInsCondition(),
          groupExpression: buildSigmaFieldExpression("principalIp"),
          groupValues: [quiet],
        });
      const event: SecurityDetectionMatchedEvent = kept.get(quiet)!.events[0]!;

      expect(Array.from(kept.keys())).toEqual([quiet]);
      expect(event).toMatchObject({
        eventUid: `${prefix}-quiet-0`,
        sourceId: sourceId.toString(),
        principalIp: quiet,
        className: "Authentication",
        statusName: "Failure",
      });
      expect(event.attributes["oneuptime.log.id"]).toBe(
        `log-${prefix}-quiet-0`,
      );
      expect(new Date(event.time).getTime()).toBe(START.getTime() + 100 * 1000);
      expect(new Date(event.retentionDate).getTime()).toBe(
        END.getTime() + 30 * 24 * 60 * MINUTE,
      );
    });

    test("a rule that does not group keeps its matches under one group", async () => {
      const kept: Map<string, SecurityDetectionMatchedEvents> =
        await SecurityDetectionMatchedEventsReader.readForGroups({
          projectId,
          start: START,
          end: END,
          condition: failedSignInsCondition(),
          groupExpression: null,
          groupValues: [],
        });

      expect(Array.from(kept.keys())).toEqual([""]);
      expect(uids(kept.get(""))).toHaveLength(
        SECURITY_DETECTION_MATCHED_EVENTS_MAX,
      );
      expect(uids(kept.get(""))[0]).toBe(`${prefix}-busy-00`);
      // The 30 failures from the busy address and the 3 from the quiet one.
      expect(kept.get("")!.outcomes).toEqual({
        Rejected: 27,
        "Reached App": 3,
        "": 3,
      });
    });

    test("a feed's indicator: every event carrying it, in any case, but the Detection Findings", async () => {
      const kept: Map<string, SecurityDetectionMatchedEvents> =
        await SecurityDetectionMatchedEventsReader.readForGroups({
          projectId,
          start: START,
          end: END,
          condition: SQL`1`,
          groupExpression: null,
          groupByObservable: true,
          groupValues: ["evil.example.com"],
          excludeClassUids: [2004],
        });

      expect(Array.from(kept.keys())).toEqual(["evil.example.com"]);
      expect(uids(kept.get("evil.example.com"))).toEqual([
        `${prefix}-indicator`,
      ]);
      expect(kept.get("evil.example.com")!.outcomes).toEqual({ "": 1 });
    });

    test("a correlation's groups: every one of a run's 100 at once, each its share, the earliest first, in one read", async () => {
      const executeQuery: ReturnType<typeof jest.spyOn> = jest.spyOn(
        SecurityEventService,
        "executeQuery",
      );

      const kept: Map<string, SecurityDetectionMatchedEvents> =
        await readCorrelationGroups({
          projectId: correlationProjectId,
          groupBy: ["principalIp"],
          groupValues: sequenceAddresses,
        });

      // The events and their outcomes: two reads, however many groups.
      expect(executeQuery).toHaveBeenCalledTimes(2);
      executeQuery.mockRestore();

      // Every group keeps its events, the hundredth as the first.
      expect(kept.size).toBe(DETECTION_MAX_GROUPS_PER_EVALUATION);

      const share: number = getSecurityDetectionMatchedEventsShare(
        DETECTION_MAX_GROUPS_PER_EVALUATION,
      ).maxEvents;
      let total: number = 0;

      for (const address of sequenceAddresses) {
        expect(uids(kept.get(address))).toEqual(
          Array.from({ length: share }, (_: unknown, index: number) => {
            return sequenceUid(address, String(index).padStart(2, "0"));
          }),
        );
        // How far every one of its requests got: the failures and the success.
        expect(kept.get(address)!.outcomes).toEqual({
          Rejected: 12,
          "Reached App": 1,
        });
        total += uids(kept.get(address)).length;
      }

      expect(total).toBeLessThanOrEqual(
        SECURITY_DETECTION_MATCHED_EVENTS_FIRING_MAX,
      );
    });

    test("a correlation by two fields keeps each pair as its own group, and an event of another pair in none", async () => {
      const kept: Map<string, SecurityDetectionMatchedEvents> =
        await readCorrelationGroups({
          projectId: correlationProjectId,
          groupBy: ["principalUser", "principalIp"],
          groupValues: ["alice / 198.19.0.1", "bob / 198.19.0.1"],
        });

      expect(Array.from(kept.keys()).sort()).toEqual([
        "alice / 198.19.0.1",
        "bob / 198.19.0.1",
      ]);
      expect(uids(kept.get("alice / 198.19.0.1"))).toEqual([
        `${prefix}-alice-0`,
        `${prefix}-alice-1`,
        `${prefix}-alice-2`,
        `${prefix}-alice-ok`,
      ]);
      expect(uids(kept.get("bob / 198.19.0.1"))).toEqual([
        `${prefix}-bob-0`,
        `${prefix}-bob-ok`,
      ]);
    });

    test("a group nobody's event is in keeps nothing, and a value is never SQL", async () => {
      const kept: Map<string, SecurityDetectionMatchedEvents> =
        await SecurityDetectionMatchedEventsReader.readForGroups({
          projectId,
          start: START,
          end: END,
          condition: failedSignInsCondition(),
          groupExpression: buildSigmaFieldExpression("principalIp"),
          groupValues: ["x'); DROP TABLE SecurityEvent; --"],
        });

      expect(kept.size).toBe(0);

      const [count] = await readJson<{ rows: string | number }>(
        client,
        `SELECT count() AS rows FROM ${database}.${new SecurityEvent().tableName}`,
      );

      expect(Number(count!.rows)).toBeGreaterThan(0);
    });

    /*
     * A correlation's detection that kept no events (#9939): its case reads
     * them again as the correlation keeps them when it fires - its steps'
     * events of its own group, by its own group-by, over the window its
     * run read - where it read the events naming any of the group's values.
     */
    describe("a correlation's case that kept no events", () => {
      test("lists the events of the group that fired, and none of the near misses naming its address", async () => {
        const detection: SecurityCaseMatchedDetectionJson = await caseMatchesOf(
          {
            projectId: caseProjectId,
            yaml: signInSequence(["principalIp"]),
            groupValue: firingAddress,
            firedAt: END,
          },
        );

        expect(detection.isKept).toBe(false);
        expect(detection.basis).toBe(SecurityCaseMatchBasis.CorrelationSteps);
        expect(listedUids(detection)).toEqual([
          caseUid("fail-0"),
          caseUid("fail-1"),
          caseUid("fail-2"),
          caseUid("ok"),
        ]);
        expect(detection.matchedEventCount).toBe(4);
        expect(detection.outcomes).toEqual({ Rejected: 3, "Reached App": 1 });
      });

      test("its near misses are real: read by what the events name, as it was, they were listed too", async () => {
        const named: Array<{ eventUid: string }> = await readJson<{
          eventUid: string;
        }>(
          client,
          `SELECT eventUid FROM ${database}.${new SecurityEvent().tableName} WHERE projectId = '${caseProjectId.toString()}' AND has(observables, '${firingAddress}') AND className = 'Authentication' AND time >= '${OneUptimeDate.toClickhouseDateTime64(
            new Date(START.getTime() - 11 * MINUTE),
          )}' ORDER BY time`,
        );

        expect(
          named.map((row: { eventUid: string }): string => {
            return row.eventUid;
          }),
        ).toEqual([
          caseUid("fail-0"),
          caseUid("fail-1"),
          caseUid("fail-2"),
          caseUid("other-group-naming"),
          caseUid("ok"),
          caseUid("to-the-address"),
        ]);
      });

      test("a group no observable holds - a route - lists its route's events, where it listed none", async () => {
        const detection: SecurityCaseMatchedDetectionJson = await caseMatchesOf(
          {
            projectId: caseProjectId,
            yaml: ROUTE_BURST,
            groupValue: "/api/checkout",
            firedAt: END,
          },
        );

        expect(listedUids(detection)).toEqual([
          caseUid("checkout-0"),
          caseUid("checkout-1"),
          caseUid("checkout-2"),
          caseUid("checkout-3"),
        ]);
      });

      test("lists what it would have kept as it fired, event for event", async () => {
        const kept: Map<string, SecurityDetectionMatchedEvents> =
          await readCorrelationGroups({
            projectId: caseProjectId,
            groupBy: ["principalIp"],
            groupValues: [firingAddress],
          });
        const detection: SecurityCaseMatchedDetectionJson = await caseMatchesOf(
          {
            projectId: caseProjectId,
            yaml: signInSequence(["principalIp"]),
            groupValue: firingAddress,
            firedAt: END,
          },
        );

        expect(listedUids(detection)).toEqual(uids(kept.get(firingAddress)));
        expect(detection.outcomes).toEqual(kept.get(firingAddress)!.outcomes);
      });

      test("one that kept its events lists those, and reads no events table", async () => {
        const kept: Map<string, SecurityDetectionMatchedEvents> =
          await readCorrelationGroups({
            projectId: caseProjectId,
            groupBy: ["principalIp"],
            groupValues: [firingAddress],
          });
        const executeQuery: ReturnType<typeof jest.spyOn> = jest.spyOn(
          SecurityEventService,
          "executeQuery",
        );

        const detection: SecurityCaseMatchedDetectionJson = await caseMatchesOf(
          {
            projectId: caseProjectId,
            yaml: signInSequence(["principalIp"]),
            groupValue: firingAddress,
            firedAt: END,
            kept: kept.get(firingAddress),
          },
        );

        expect(executeQuery).not.toHaveBeenCalled();
        executeQuery.mockRestore();

        expect(detection.isKept).toBe(true);
        expect(listedUids(detection)).toEqual([
          caseUid("fail-0"),
          caseUid("fail-1"),
          caseUid("fail-2"),
          caseUid("ok"),
        ]);
      });
    });
  });
});

describe("the events a detection keeps: ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
