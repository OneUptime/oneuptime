import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import SecurityEvent from "Common/Models/AnalyticsModels/SecurityEvent";
import DetectionRule from "Common/Models/DatabaseModels/DetectionRule";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import DetectionRuleService from "Common/Server/Services/DetectionRuleService";
import SecurityEventService from "Common/Server/Services/SecurityEventService";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import DetectionRuleExceptions, {
  LoadedDetectionRuleException,
  buildDetectionRuleExceptionsMatch,
} from "Common/Server/Utils/SecurityEvent/DetectionRuleExceptions";
import DetectionRuleUncountedReader, {
  UncountedRuleRead,
  buildUncountedRulesStatement,
  readUncountedRulesRow,
} from "Common/Server/Utils/SecurityEvent/DetectionRuleUncounted";
import SigmaClickhouseCompiler from "Common/Server/Utils/SecurityEvent/Sigma/SigmaClickhouseCompiler";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { SecurityEntityType } from "Common/Types/SecurityCase/SecurityEntity";
import { DetectionRuleExceptionKind } from "Common/Types/SecurityEvent/DetectionRuleException";
import {
  DetectionRuleUncounted,
  DetectionRulesUncounted,
} from "Common/Types/SecurityEvent/DetectionRuleUncounted";
import { DetectionRuleDefinition } from "Common/Types/SecurityEvent/SigmaCorrelation";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import SigmaRuleSetParser from "Common/Utils/SecurityEvent/Sigma/SigmaRuleSetParser";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * ------------------------------------------------------------------
 * #10547 ON A REAL CLICKHOUSE: WHAT A DETECTION RULE COULD NOT COUNT.
 *
 * Detection Rules says, for each rule it lists that counts per value, how
 * many of the last day's matching events had no value for its field, and
 * how many of those a scrub rule hid. All the page's rules are read in one
 * statement (DetectionRuleUncounted.buildUncountedRulesStatement), each
 * rule's condition written once in a WITH clause and read again in its
 * counts and in the WHERE that keeps only events some rule matched. These
 * run that statement on ClickHouse 26.7, over real rows:
 *
 *   - a brute-force rule over failed sign-ins whose addresses a scrub rule
 *     hid says how many it could not count, and that a scrub rule hid them,
 *     in logs or in traces;
 *   - one whose every match had no address counted nothing;
 *   - a user rule reads the user's own marker, and Redact's "[REDACTED]"
 *     left in the user column;
 *   - a rule's exceptions skip in its own counts only;
 *   - events past the period, past their retention or from another
 *     project are never counted.
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server,
 * credentials in the URL:
 *
 *   docker run -d --rm --name detection-uncounted-ch -p 18127:8123 \
 *     -e CLICKHOUSE_PASSWORD=test clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18127 \
 *     npx jest Tests/Telemetry/DetectionRuleUncountedClickhouse.test.ts
 *
 * The suite creates and drops only its own uniquely named database.
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

jest.setTimeout(300000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `detection_uncounted_test_${process.pid}_${Date.now()}`;

const HOUR: number = 60 * 60 * 1000;

const PROJECT_ID: ObjectID = new ObjectID(
  "10547000-0000-4000-8000-0000000000c1",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "10547000-0000-4000-8000-0000000000c2",
);
const SOURCE_ID: ObjectID = new ObjectID(
  "10547000-0000-4000-8000-0000000000c3",
);

const NOW: Date = new Date();

const BRUTE_FORCE_ID: string = "10547000-0000-4000-8000-0000000000d1";
const SPRAYING_ID: string = "10547000-0000-4000-8000-0000000000d2";
const ACCOUNT_ID: string = "10547000-0000-4000-8000-0000000000d3";
const SUDO_ID: string = "10547000-0000-4000-8000-0000000000d4";

const FAILED_SIGN_INS: string = `title: Brute force from one IP address
detection:
  selection:
    className: Authentication
    statusName: Failure
  condition: selection
`;

const SUDO_COMMANDS: string = `title: Sudo commands
detection:
  selection:
    className: Process Activity
  condition: selection
`;

type ConnectableService = {
  database: ClickhouseDatabase;
  databaseClient: ClickhouseClient | null;
};

const service: ConnectableService =
  SecurityEventService as unknown as ConnectableService;

let client: ClickhouseClient;

interface EventSpec {
  className?: string;
  statusName?: string;
  principalIp?: string;
  principalUser?: string;
  attributes?: Record<string, string>;
  hoursAgo?: number;
  projectId?: ObjectID;
  retentionDate?: Date;
}

function eventRow(spec: EventSpec): JSONObject {
  const attributes: Record<string, string> = spec.attributes || {};

  return {
    _id: ObjectID.generateTimeOrdered().toString(),
    projectId: (spec.projectId || PROJECT_ID).toString(),
    primaryEntityId: SOURCE_ID.toString(),
    primaryEntityType: ServiceType.OpenTelemetry,
    time: OneUptimeDate.toClickhouseDateTime64(
      new Date(NOW.getTime() - (spec.hoursAgo ?? 1) * HOUR),
    ),
    createdAt: OneUptimeDate.toClickhouseDateTime(NOW),
    eventUid: ObjectID.generate().toString(),
    classUid: 3002,
    className: spec.className ?? "Authentication",
    statusName: spec.statusName ?? "Failure",
    severityId: 3,
    severityName: "Medium",
    message: "Failed sign-in",
    principalIp: spec.principalIp ?? "",
    principalUser: spec.principalUser ?? "",
    observables: [spec.principalIp ?? ""].filter((value: string): boolean => {
      return value.length > 0;
    }),
    attributes,
    attributeKeys: Object.keys(attributes),
    retentionDate: OneUptimeDate.toClickhouseDateTime(
      spec.retentionDate || new Date(NOW.getTime() + 30 * 24 * HOUR),
    ),
  };
}

async function write(...specs: Array<EventSpec>): Promise<void> {
  await client.insert({
    table: `${database}.${new SecurityEvent().tableName}`,
    values: specs.map(eventRow),
    format: "JSONEachRow",
  });
}

function times(count: number, spec: EventSpec): Array<EventSpec> {
  return Array.from({ length: count }, (): EventSpec => {
    return spec;
  });
}

// The model's own table under a plain MergeTree (no Keeper on a disposable server).
async function createTable(clickhouse: ClickhouseDatabase): Promise<void> {
  const model: AnalyticsBaseModel = new SecurityEvent();
  const generator: StatementGenerator<AnalyticsBaseModel> =
    new StatementGenerator<AnalyticsBaseModel>({
      modelType: SecurityEvent,
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

function compiled(yaml: string): Statement {
  const definition: DetectionRuleDefinition = SigmaRuleSetParser.parse(yaml);

  if (definition.kind !== "single") {
    throw new Error("A single rule was expected.");
  }

  return SigmaClickhouseCompiler.compile(definition.rule);
}

async function readStatement(
  rules: Array<UncountedRuleRead>,
): Promise<Array<DetectionRuleUncounted>> {
  const statement: Statement = buildUncountedRulesStatement({
    projectId: PROJECT_ID,
    tableName: `${database}.${new SecurityEvent().tableName}`,
    rules,
    serviceFilter: {},
    startTime: new Date(NOW.getTime() - 24 * HOUR),
    endTime: NOW,
    keptAt: NOW,
  });

  const result: Awaited<ReturnType<typeof SecurityEventService.executeQuery>> =
    await SecurityEventService.executeQuery(statement);
  const response: { data?: Array<JSONObject> } = await result.json<{
    data?: Array<JSONObject>;
  }>();

  return readUncountedRulesRow({ row: (response.data || [])[0], rules });
}

function savedRule(data: {
  id: string;
  yaml: string;
  groupByField: string;
  distinctCountField?: string;
  matchCountThreshold: number;
}): DetectionRule {
  const rule: DetectionRule = new DetectionRule();

  Object.assign(rule, {
    _id: data.id,
    isEnabled: true,
    sigmaRuleYaml: data.yaml,
    groupByField: data.groupByField,
    distinctCountField: data.distinctCountField || "",
    matchCountThreshold: data.matchCountThreshold,
  });

  return rule;
}

integration("what a detection rule could not count, on ClickHouse (#10547)", () => {
  let clickhouse: ClickhouseDatabase;
  let original: ConnectableService | null = null;

  beforeAll(async (): Promise<void> => {
    const url: URL = new URL(endpoint!);

    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
      throw new Error(
        "TEST_CLICKHOUSE_URL must point at a local, disposable ClickHouse server.",
      );
    }

    const bootstrap: ClickHouseClientConfigOptions = {
      url: `${url.protocol}//${url.host}`,
      username: decodeURIComponent(url.username) || "default",
      password: decodeURIComponent(url.password),
      request_timeout: 300000,
    };

    const setup: ClickhouseDatabase = new ClickhouseDatabase(bootstrap);
    const setupClient: ClickhouseClient = await setup.connect(bootstrap);
    await setupClient.command({ query: `CREATE DATABASE ${database}` });
    await setup.disconnect();

    const options: ClickHouseClientConfigOptions = {
      ...bootstrap,
      database,
    };

    clickhouse = new ClickhouseDatabase(options);
    client = await clickhouse.connect(options);

    await createTable(clickhouse);

    original = {
      database: service.database,
      databaseClient: service.databaseClient,
    };

    service.database = clickhouse;
    service.databaseClient = client;

    await write(
      // Brute force: 5 failed sign-ins with an address, 12 with none, 9 of those hidden.
      ...times(5, { principalIp: "203.0.113.7" }),
      ...times(3, {}),
      ...times(7, {
        attributes: {
          "oneuptime.request.client_address_hidden": "scrub-rule",
          "oneuptime.request.client_address_scrubbed_in": "log-body",
        },
      }),
      ...times(2, {
        attributes: {
          "oneuptime.request.client_address_hidden": "scrub-rule",
          "oneuptime.request.client_address_scrubbed_in": "span-attributes",
        },
      }),
      // A user that Redact left as "[REDACTED]" in the user column, with no marker.
      ...times(4, { principalIp: "203.0.113.9", principalUser: "[REDACTED]" }),
      // Successful sign-ins and sudo commands: not the rules' matches.
      ...times(6, { statusName: "Success" }),
      ...times(3, { className: "Process Activity", principalUser: "root" }),
      // Never counted: past the period, past retention, another project's.
      ...times(5, { hoursAgo: 30 }),
      ...times(5, { retentionDate: new Date(NOW.getTime() - HOUR) }),
      ...times(5, { projectId: OTHER_PROJECT_ID }),
    );
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
    DetectionRuleUncountedReader.clearCache();
  });

  afterEach((): void => {
    jest.restoreAllMocks();
  });

  test("an address rule says how many of the day's matches had no address, and how many a scrub rule hid, in logs and in traces", async () => {
    expect(
      await readStatement([
        {
          detectionRuleId: BRUTE_FORCE_ID,
          groupByField: "principalIp",
          ruleWhere: compiled(FAILED_SIGN_INS),
          skipped: null,
        },
      ]),
    ).toEqual([
      {
        detectionRuleId: BRUTE_FORCE_ID,
        field: "principalIp",
        matchedCount: 21,
        uncountedCount: 12,
        hiddenInLogsCount: 7,
        hiddenInTracesCount: 2,
      },
    ]);
  });

  test("several rules in the one statement, each with its own field's counts", async () => {
    const counts: Array<DetectionRuleUncounted> = await readStatement([
      {
        detectionRuleId: BRUTE_FORCE_ID,
        groupByField: "principalIp",
        ruleWhere: compiled(FAILED_SIGN_INS),
        skipped: null,
      },
      {
        detectionRuleId: ACCOUNT_ID,
        groupByField: "principalUser",
        ruleWhere: compiled(FAILED_SIGN_INS),
        skipped: null,
      },
      {
        detectionRuleId: SUDO_ID,
        groupByField: "principalIp",
        ruleWhere: compiled(SUDO_COMMANDS),
        skipped: null,
      },
    ]);

    expect(counts).toEqual([
      {
        detectionRuleId: BRUTE_FORCE_ID,
        field: "principalIp",
        matchedCount: 21,
        uncountedCount: 12,
        hiddenInLogsCount: 7,
        hiddenInTracesCount: 2,
      },
      // Every failed sign-in had no user: 17 empty, 4 Redact's "[REDACTED]".
      {
        detectionRuleId: ACCOUNT_ID,
        field: "principalUser",
        matchedCount: 21,
        uncountedCount: 21,
        hiddenInLogsCount: 4,
        hiddenInTracesCount: 0,
      },
      // The sudo commands all had no address, and none was hidden.
      {
        detectionRuleId: SUDO_ID,
        field: "principalIp",
        matchedCount: 3,
        uncountedCount: 3,
        hiddenInLogsCount: 0,
        hiddenInTracesCount: 0,
      },
    ]);
  });

  test("a rule's exceptions skip in its own counts only", async () => {
    const counts: Array<DetectionRuleUncounted> = await readStatement([
      {
        detectionRuleId: BRUTE_FORCE_ID,
        groupByField: "principalIp",
        ruleWhere: compiled(FAILED_SIGN_INS),
        skipped: buildDetectionRuleExceptionsMatch([
          {
            kind: DetectionRuleExceptionKind.Entity,
            entityType: SecurityEntityType.IpAddress,
            value: "203.0.113.9",
          } as never,
        ]),
      },
      {
        detectionRuleId: ACCOUNT_ID,
        groupByField: "principalUser",
        ruleWhere: compiled(FAILED_SIGN_INS),
        skipped: null,
      },
    ]);

    // The four sign-ins from the excepted address are no match of the first rule.
    expect(counts[0]!.matchedCount).toBe(17);
    expect(counts[0]!.uncountedCount).toBe(12);
    expect(counts[1]!.matchedCount).toBe(21);
  });

  test("the reader, as Detection Rules asks it: the page's counting rules in one read", async () => {
    jest
      .spyOn(DetectionRuleService, "findBy")
      .mockResolvedValue([
        savedRule({
          id: BRUTE_FORCE_ID,
          yaml: FAILED_SIGN_INS,
          groupByField: "principalIp",
          matchCountThreshold: 10,
        }),
        savedRule({
          id: SPRAYING_ID,
          yaml: FAILED_SIGN_INS,
          groupByField: "principalIp",
          distinctCountField: "principalUser",
          matchCountThreshold: 5,
        }),
        // Fires on each event: nothing is left out, so nothing is read for it.
        savedRule({
          id: SUDO_ID,
          yaml: SUDO_COMMANDS,
          groupByField: "principalIp",
          matchCountThreshold: 1,
        }),
      ] as never);
    jest
      .spyOn(DetectionRuleExceptions, "loadForProject")
      .mockResolvedValue(
        new Map<string, Array<LoadedDetectionRuleException>>() as never,
      );
    const query: ReturnType<typeof jest.spyOn> = jest.spyOn(
      SecurityEventService,
      "executeQuery",
    );

    const answer: DetectionRulesUncounted =
      await DetectionRuleUncountedReader.read({
        projectId: PROJECT_ID,
        detectionRuleIds: [BRUTE_FORCE_ID, SPRAYING_ID, SUDO_ID].map(
          (id: string): ObjectID => {
            return new ObjectID(id);
          },
        ),
        props: { isRoot: true },
        serviceFilter: {},
        now: NOW,
      });

    expect(query).toHaveBeenCalledTimes(1);
    expect(answer.rules).toEqual([
      {
        detectionRuleId: BRUTE_FORCE_ID,
        field: "principalIp",
        matchedCount: 21,
        uncountedCount: 12,
        hiddenInLogsCount: 7,
        hiddenInTracesCount: 2,
      },
      {
        detectionRuleId: SPRAYING_ID,
        field: "principalIp",
        matchedCount: 21,
        uncountedCount: 12,
        hiddenInLogsCount: 7,
        hiddenInTracesCount: 2,
      },
    ]);
  });

  test("a rule whose every match had no address counted nothing", async () => {
    const counts: Array<DetectionRuleUncounted> = await readStatement([
      {
        detectionRuleId: SUDO_ID,
        groupByField: "principalIp",
        ruleWhere: compiled(SUDO_COMMANDS),
        skipped: null,
      },
    ]);

    expect(counts[0]!.uncountedCount).toBe(counts[0]!.matchedCount);
  });

  test("a rule that left nothing out says nothing", async () => {
    expect(
      await readStatement([
        {
          detectionRuleId: BRUTE_FORCE_ID,
          groupByField: "statusName",
          ruleWhere: compiled(FAILED_SIGN_INS),
          skipped: null,
        },
      ]),
    ).toEqual([]);
  });
});
