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
 * Security Events' user vault against a real ClickHouse server (#10632),
 * as the address vault's suite runs it (SecurityAddressVaultClickhouse):
 * the table, its one read, and both scans end to end from ingest.
 *
 *   - the table, made of the model's own engine, keys, partition, TTL and
 *     settings: a token's rows fold as they merge, a user seen more than 30
 *     days ago is never named and their rows are dropped, one project's
 *     token never names another's user, a token with two users names
 *     neither;
 *   - a failed sign-in request's span whose enduser.id an Email rule
 *     hashed, through trace ingest, with the Traces source on: the stored
 *     span holds only the token, the vault holds the token and the user,
 *     and the trace scan's event names the user;
 *   - an SSH failed password whose account a rule hashed, and a Google
 *     Cloud audit log whose principal an Email rule hashed, through log
 *     ingest and "Your logs": the same, and the email the rule hashed in a
 *     line's message is never kept;
 *   - the Traces source off, or a Redact rule: no vault row, and the event
 *     keeps what the rule left;
 *   - a vault that cannot be written: the batch is stored, with the token.
 *
 * Only Postgres and the parts of the scans that read other tables are
 * replaced; every row named here is written to and read from ClickHouse.
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server:
 *
 *   docker run -d --rm -p 18632:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18632 \
 *     npx jest Tests/Telemetry/SecurityUserVaultClickhouse.test.ts
 *
 * The suite creates and drops only its own uniquely named database. The
 * App Test workflow provides the server; the guard at the bottom fails
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

jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: { addJob: jest.fn() },
    QueueName: {
      Workflow: "Workflow",
      Worker: "Worker",
      Telemetry: "Telemetry",
      Runbook: "Runbook",
    },
  };
});

import LlmModelPriceService from "../../FeatureSet/Telemetry/Services/LlmModelPriceService";
import LogDropFilterService from "../../FeatureSet/Telemetry/Services/LogDropFilterService";
import LogPipelineService from "../../FeatureSet/Telemetry/Services/LogPipelineService";
import LogScrubRuleService from "../../FeatureSet/Telemetry/Services/LogScrubRuleService";
import OtelLogsIngestService from "../../FeatureSet/Telemetry/Services/OtelLogsIngestService";
import OtelTracesIngestService from "../../FeatureSet/Telemetry/Services/OtelTracesIngestService";
import TraceDropFilterService from "../../FeatureSet/Telemetry/Services/TraceDropFilterService";
import TracePipelineService from "../../FeatureSet/Telemetry/Services/TracePipelineService";
import TraceScrubRuleService from "../../FeatureSet/Telemetry/Services/TraceScrubRuleService";
import ExceptionUtil, {
  TelemetryExceptionPayload,
} from "../../FeatureSet/Telemetry/Utils/Exception";
import Log from "Common/Models/AnalyticsModels/Log";
import SecurityUserVault from "Common/Models/AnalyticsModels/SecurityUserVault";
import Span from "Common/Models/AnalyticsModels/Span";
import LogScrubRule from "Common/Models/DatabaseModels/LogScrubRule";
import SecurityLogSource from "Common/Models/DatabaseModels/SecurityLogSource";
import SecurityTelemetrySource from "Common/Models/DatabaseModels/SecurityTelemetrySource";
import TraceScrubRule from "Common/Models/DatabaseModels/TraceScrubRule";
import TelemetryIngestionDisabled from "Common/Server/Middleware/TelemetryIngestionDisabled";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import AnalyticsDatabaseService from "Common/Server/Services/AnalyticsDatabaseService";
import ExceptionInstanceService from "Common/Server/Services/ExceptionInstanceService";
import LogService from "Common/Server/Services/LogService";
import CommonLogScrubRuleService from "Common/Server/Services/LogScrubRuleService";
import { TelemetryServiceMetadata } from "Common/Server/Services/OpenTelemetryIngestService";
import SecurityUserVaultService, {
  SecurityUserVaultService as SecurityUserVaultServiceClass,
} from "Common/Server/Services/SecurityUserVaultService";
import SecurityEventService from "Common/Server/Services/SecurityEventService";
import SecurityLogSourceService from "Common/Server/Services/SecurityLogSourceService";
import SecurityTelemetrySourceService from "Common/Server/Services/SecurityTelemetrySourceService";
import SpanService from "Common/Server/Services/SpanService";
import CommonTraceScrubRuleService from "Common/Server/Services/TraceScrubRuleService";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import SecurityUserVaultWriter from "Common/Server/Utils/SecurityEvent/UserVault/SecurityUserVaultWriter";
import OpenStackAuditJoin from "Common/Server/Utils/SecurityEvent/LogScan/OpenStackAuditJoin";
import SecurityLogScanner from "Common/Server/Utils/SecurityEvent/LogScan/SecurityLogScanner";
import RealTimeDetections from "Common/Server/Utils/SecurityEvent/RealTime/RealTimeDetections";
import Semaphore from "Common/Server/Infrastructure/Semaphore";
import SecurityEventDedupe from "Common/Server/Utils/SecurityEvent/SecurityEventDedupe";
import ScrubbedClientAddresses from "Common/Server/Utils/SecurityEvent/ScrubbedClientAddresses";
import SecurityEventsReadTelemetry from "Common/Server/Utils/SecurityEvent/SecurityEventsReadTelemetry";
import { TelemetryWindowRead } from "Common/Server/Utils/SecurityEvent/TelemetryScan/TelemetryScanTypes";
import TraceSecurityScan from "Common/Server/Utils/SecurityEvent/TelemetryScan/TraceSecurityScan";
import ThreatIntelEnricher from "Common/Server/Utils/SecurityEvent/ThreatIntel/ThreatIntelEnricher";
import AppMetrics from "Common/Server/Utils/Telemetry/AppMetrics";
import ScrubHashToken from "Common/Server/Utils/Telemetry/ScrubHashToken";
import TelemetryFanInWriter, {
  FanInInsertTarget,
  FanInSubmitResult,
} from "Common/Server/Utils/Telemetry/TelemetryFanInWriter";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import LogScrubAction from "Common/Types/Log/LogScrubAction";
import LogScrubField from "Common/Types/Log/LogScrubField";
import LogScrubPatternType from "Common/Types/Log/LogScrubPatternType";
import ObjectID from "Common/Types/ObjectID";
import NormalizedSecurityEvent from "Common/Types/SecurityEvent/NormalizedSecurityEvent";
import { SECURITY_REQUEST_ATTRIBUTES } from "Common/Types/SecurityEvent/SecurityEventRequestOutcome";
import { ScrubRegExp } from "Common/Types/Telemetry/ScrubRule";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import TraceScrubField from "Common/Types/Trace/TraceScrubField";
import { readClickhouseDate } from "Common/Utils/SecurityEvent/Destinations/SecurityEventRecord";
import SecurityLogParser from "Common/Utils/SecurityEvent/LogParsers/SecurityLogParser";
import {
  HASHED_USER_ATTRIBUTES,
  ScrubbedUserRole,
  readHiddenEventUser,
} from "Common/Utils/SecurityEvent/ScrubbedUser";

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(180000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `user_vault_test_${process.pid}_${Date.now()}`;

const PROJECT_ID: ObjectID = new ObjectID(
  "10632000-0000-4000-8000-0000000000e1",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "10632000-0000-4000-8000-0000000000e2",
);
const SERVICE_ID: ObjectID = new ObjectID(
  "10632000-0000-4000-8000-0000000000e3",
);
const SERVICE_NAME: string = "checkout-api";

const MALLORY: string = "mallory@acme.com";
const ALICE: string = "alice@example.com";

const AUTO_DISCOVERY_METHODS: Array<string> = [
  "autoDiscoverKubernetesCluster",
  "autoDiscoverDockerHost",
  "autoDiscoverPodmanHost",
  "autoDiscoverProxmoxCluster",
  "autoDiscoverVMwareVCenter",
  "autoDiscoverCephCluster",
  "autoDiscoverStorageArray",
  "autoDiscoverDockerSwarmCluster",
  "autoDiscoverHost",
  "autoDiscoverServerless",
  "autoDiscoverCloudResource",
  "autoDiscoverRum",
  "autoDiscoverDatabaseServer",
];

const METADATA: TelemetryServiceMetadata = {
  serviceName: SERVICE_NAME,
  primaryEntityId: SERVICE_ID,
  primaryEntityType: ServiceType.OpenTelemetry,
  dataRententionInDays: 15,
  serviceRetentionConfig: null,
  serviceRetentionInDays: null,
  projectRetentionConfig: null,
  projectRetentionInDays: 15,
} as unknown as TelemetryServiceMetadata;

type OtlpAttribute = { key: string; value: { stringValue: string } };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type IngestTestMethods = Record<string, any>;

type ServiceConnection = Pick<
  AnalyticsDatabaseService<never>,
  "database" | "databaseClient" | "ingestDatabase" | "ingestDatabaseClient"
>;

function attribute(key: string, value: string): OtlpAttribute {
  return { key: key, value: { stringValue: value } };
}

function tokenOf(value: string, projectId: ObjectID = PROJECT_ID): string {
  return ScrubHashToken.ofValue({ projectId, value });
}

function regexOf(service: unknown, patternType: string): ScrubRegExp {
  const regex: ScrubRegExp | null = (
    service as {
      getRegexForPattern: (patternType: string) => ScrubRegExp | null;
    }
  ).getRegexForPattern(patternType);

  expect(regex).not.toBeNull();

  return regex as ScrubRegExp;
}

function logRule(data: {
  patternType: string;
  action: string;
  customRegex?: string | undefined;
}): never {
  const rule: LogScrubRule = new LogScrubRule();
  rule.id = ObjectID.generate();
  rule.name = `${data.patternType} ${data.action}`;
  rule.projectId = PROJECT_ID;
  rule.patternType = data.patternType;
  rule.scrubAction = data.action;
  rule.fieldsToScrub = LogScrubField.Both;

  if (data.customRegex) {
    rule.customRegex = data.customRegex;
  }

  return [
    {
      rule: rule,
      regex: (
        LogScrubRuleService as unknown as {
          getRegexForPattern: (
            patternType: string,
            customRegex?: string,
          ) => ScrubRegExp | null;
        }
      ).getRegexForPattern(data.patternType, data.customRegex)!,
    },
  ] as never;
}

function traceEmailRule(action: string): never {
  const rule: TraceScrubRule = new TraceScrubRule();
  rule.id = ObjectID.generate();
  rule.name = "Scrub email addresses";
  rule.projectId = PROJECT_ID;
  rule.patternType = LogScrubPatternType.Email;
  rule.scrubAction = action;
  rule.fieldsToScrub = TraceScrubField.All;

  return [
    {
      rule: rule,
      regex: regexOf(TraceScrubRuleService, LogScrubPatternType.Email),
    },
  ] as never;
}

function otlpRequest(body: JSONObject): TelemetryRequest {
  return {
    projectId: new ObjectID(PROJECT_ID.toString()),
    body: body,
    headers: {},
  } as unknown as TelemetryRequest;
}

integration("Security Events' user vault against ClickHouse", () => {
  let clickhouse: ClickhouseDatabase;
  let client: ClickhouseClient;
  const originals: Map<ServiceConnection, ServiceConnection> = new Map();
  const originalDatabaseName: string | undefined =
    process.env["CLICKHOUSE_DATABASE"];

  let logRules: never = [] as never;
  let traceRules: never = [] as never;
  let counted: Array<string> = [];

  const vaultTable: string = `${database}.${new SecurityUserVault().tableName}`;

  async function rowsOf(query: string): Promise<Array<JSONObject>> {
    const result: { json: () => Promise<unknown> } = await client.query({
      query,
      format: "JSONEachRow",
    });

    return (await result.json()) as Array<JSONObject>;
  }

  async function vaultRowsOf(projectId: ObjectID): Promise<Array<JSONObject>> {
    return rowsOf(
      `SELECT token, userValue FROM ${vaultTable} WHERE projectId = '${projectId.toString()}' ORDER BY userValue`,
    );
  }

  // A table of a model's columns, keys and partition, on one node.
  async function createTable(data: {
    modelType: { new (): Log | Span | SecurityUserVault };
    engine: string;
    withTtl: boolean;
  }): Promise<void> {
    const model: Log | Span | SecurityUserVault = new data.modelType();
    const columns: Statement = new StatementGenerator<
      Log | Span | SecurityUserVault
    >({
      modelType: data.modelType,
      database: clickhouse,
    }).toColumnsCreateStatement(model.tableColumns);
    const ttl: string =
      data.withTtl && model.ttlExpression ? ` TTL ${model.ttlExpression}` : "";
    const settings: string =
      data.withTtl && model.tableSettings
        ? ` SETTINGS ${model.tableSettings}`
        : "";

    await client.command({
      query: `CREATE TABLE ${database}.${model.tableName} (${columns.query}) ENGINE = ${data.engine} PARTITION BY (${model.partitionKey}) PRIMARY KEY (${model.primaryKeys.join(", ")}) ORDER BY (${model.sortKeys.join(", ")})${ttl}${settings}`,
      query_params: columns.query_params,
    });
  }

  function useTestDatabase(service: ServiceConnection): void {
    originals.set(service, {
      database: service.database,
      databaseClient: service.databaseClient,
      ingestDatabase: service.ingestDatabase,
      ingestDatabaseClient: service.ingestDatabaseClient,
    });
    service.database = clickhouse;
    service.databaseClient = client;
    service.ingestDatabase = clickhouse;
    service.ingestDatabaseClient = client;
  }

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
      request_timeout: 60000,
    };

    clickhouse = new ClickhouseDatabase(options);
    client = await clickhouse.connect(options);

    await client.command({
      query: `CREATE DATABASE IF NOT EXISTS ${database}`,
    });

    await createTable({ modelType: Log, engine: "MergeTree", withTtl: false });
    await createTable({ modelType: Span, engine: "MergeTree", withTtl: false });
    // The vault exactly as its model says: engine, keys, partition, TTL and settings.
    await createTable({
      modelType: SecurityUserVault,
      engine: "AggregatingMergeTree",
      withTtl: true,
    });

    for (const service of [
      LogService,
      SpanService,
      SecurityUserVaultService,
    ]) {
      useTestDatabase(service as unknown as ServiceConnection);
    }

    // The scans name their tables by the configured database.
    process.env["CLICKHOUSE_DATABASE"] = database;
  });

  afterAll(async (): Promise<void> => {
    for (const [service, original] of originals.entries()) {
      Object.assign(service, original);
    }

    if (originalDatabaseName === undefined) {
      delete process.env["CLICKHOUSE_DATABASE"];
    } else {
      process.env["CLICKHOUSE_DATABASE"] = originalDatabaseName;
    }

    if (client) {
      await client.command({ query: `DROP DATABASE IF EXISTS ${database}` });
    }

    if (clickhouse) {
      await clickhouse.disconnect();
    }
  });

  beforeEach(async (): Promise<void> => {
    logRules = [] as never;
    traceRules = [] as never;
    counted = [];
    SecurityEventsReadTelemetry.clearCache();
    SecurityUserVaultWriter.forgetWrites();
    ScrubbedClientAddresses.clearCache();

    for (const table of [
      vaultTable,
      `${database}.${new Log().tableName}`,
      `${database}.${new Span().tableName}`,
    ]) {
      await client.command({ query: `TRUNCATE TABLE ${table}` });
    }

    for (const ingestService of [
      OtelLogsIngestService,
      OtelTracesIngestService,
    ]) {
      const service: IngestTestMethods =
        ingestService as unknown as IngestTestMethods;

      for (const method of AUTO_DISCOVERY_METHODS) {
        jest.spyOn(service, method).mockResolvedValue(null);
      }

      jest
        .spyOn(service, "resolveTelemetryResource")
        .mockResolvedValue(METADATA);
    }

    jest.spyOn(LogPipelineService, "loadPipelines").mockResolvedValue([]);
    jest.spyOn(LogDropFilterService, "loadDropFilters").mockResolvedValue([]);
    jest
      .spyOn(LogScrubRuleService, "loadScrubRules")
      .mockImplementation((async (): Promise<never> => {
        return logRules;
      }) as never);
    jest.spyOn(TracePipelineService, "loadPipelines").mockResolvedValue([]);
    jest.spyOn(TraceDropFilterService, "loadDropFilters").mockResolvedValue([]);
    jest
      .spyOn(TraceScrubRuleService, "loadScrubRules")
      .mockImplementation((async (): Promise<never> => {
        return traceRules;
      }) as never);
    jest.spyOn(LlmModelPriceService, "loadModelPrices").mockResolvedValue([]);
    jest
      .spyOn(ExceptionUtil, "saveOrUpdateTelemetryExceptionsBatch")
      .mockImplementation(
        async (_payloads: Array<TelemetryExceptionPayload>): Promise<void> => {
          // The exception's group: not what these tests read.
        },
      );
    jest.spyOn(TelemetryIngestionDisabled, "isDisabled").mockReturnValue(false);

    // Every row the batch hands the fan-in writer goes into ClickHouse.
    jest
      .spyOn(TelemetryFanInWriter, "submit")
      .mockImplementation(
        async (
          target: FanInInsertTarget,
          rows: Array<JSONObject>,
        ): Promise<FanInSubmitResult> => {
          if (target === ExceptionInstanceService) {
            return { flushed: Promise.resolve() };
          }

          return {
            flushed: target.insertJsonRows(rows, {
              clickhouseSettings: { wait_for_async_insert: 1 },
            }),
          };
        },
      );

    jest.spyOn(AppMetrics, "getUserVaultWriteCounter").mockReturnValue({
      add: (count: number, attributes?: JSONObject): void => {
        counted.push(
          `${String(attributes?.[AppMetrics.ADDRESS_VAULT_SIGNAL_ATTRIBUTE])}:${String(
            attributes?.[AppMetrics.USER_VAULT_OUTCOME_ATTRIBUTE],
          )}:${count}`,
        );
      },
    } as never);
  });

  afterEach(async (): Promise<void> => {
    await SecurityUserVaultWriter.whenIdle();
    jest.restoreAllMocks();
  });

  function sourcesOn(data: { logs: boolean; traces: boolean }): void {
    jest
      .spyOn(SecurityLogSourceService, "findOneBy")
      .mockResolvedValue((data.logs ? new SecurityLogSource() : null) as never);
    jest
      .spyOn(SecurityTelemetrySourceService, "findOneBy")
      .mockResolvedValue(
        (data.traces ? new SecurityTelemetrySource() : null) as never,
      );
  }

  async function writeVault(
    projectId: ObjectID,
    entries: Array<{ token: string; user: string }>,
    seenAt: Date,
  ): Promise<void> {
    await SecurityUserVaultService.insertJsonRows(
      SecurityUserVaultServiceClass.toRows({ projectId, entries, seenAt }),
      { clickhouseSettings: { wait_for_async_insert: 1 } },
    );
  }

  describe("the table", () => {
    test("a token written names its user, in one query", async () => {
      await writeVault(
        PROJECT_ID,
        [
          { token: tokenOf(MALLORY), user: MALLORY },
          { token: tokenOf("auth0|5f7c8ec7"), user: "auth0|5f7c8ec7" },
        ],
        new Date(),
      );

      const found: Map<string, string> =
        await SecurityUserVaultService.findUsersOfTokens({
          projectId: PROJECT_ID,
          tokens: [
            tokenOf(MALLORY),
            tokenOf("auth0|5f7c8ec7"),
            tokenOf("nobody@acme.com"),
          ],
        });

      expect(Array.from(found.entries()).sort()).toEqual(
        [
          [tokenOf(MALLORY), MALLORY],
          [tokenOf("auth0|5f7c8ec7"), "auth0|5f7c8ec7"],
        ].sort(),
      );
    });

    test("a token's rows fold as they merge: the earliest first sighting, the latest last", async () => {
      const first: Date = OneUptimeDate.addRemoveHours(new Date(), -5);
      const last: Date = OneUptimeDate.addRemoveMinutes(new Date(), -1);

      await writeVault(
        PROJECT_ID,
        [{ token: tokenOf(MALLORY), user: MALLORY }],
        first,
      );
      await writeVault(
        PROJECT_ID,
        [{ token: tokenOf(MALLORY), user: MALLORY }],
        last,
      );
      await client.command({ query: `OPTIMIZE TABLE ${vaultTable} FINAL` });

      const rows: Array<JSONObject> = await rowsOf(
        `SELECT token, userValue, firstSeenAt, lastSeenAt FROM ${vaultTable} WHERE projectId = '${PROJECT_ID.toString()}'`,
      );
      const sameDay: boolean =
        OneUptimeDate.toClickhouseDateTime(first).slice(0, 10) ===
        OneUptimeDate.toClickhouseDateTime(last).slice(0, 10);

      if (sameDay) {
        expect(rows).toHaveLength(1);
      }

      expect(
        rows.reduce((earliest: string, row: JSONObject): string => {
          return String(row["firstSeenAt"]) < earliest
            ? String(row["firstSeenAt"])
            : earliest;
        }, "9999"),
      ).toBe(OneUptimeDate.toClickhouseDateTime(first));
      expect(
        rows.reduce((latest: string, row: JSONObject): string => {
          return String(row["lastSeenAt"]) > latest
            ? String(row["lastSeenAt"])
            : latest;
        }, ""),
      ).toBe(OneUptimeDate.toClickhouseDateTime(last));
    });

    test("30-day expiry: a user last seen 29 days ago is named, one 31 days ago never is", async () => {
      const now: Date = new Date();

      await writeVault(
        PROJECT_ID,
        [{ token: tokenOf(MALLORY), user: MALLORY }],
        OneUptimeDate.addRemoveDays(now, -29),
      );

      expect(
        (
          await SecurityUserVaultService.findUsersOfTokens({
            projectId: PROJECT_ID,
            tokens: [tokenOf(MALLORY)],
            now,
          })
        ).get(tokenOf(MALLORY)),
      ).toBe(MALLORY);

      // Two days later the row may still be on disk: it is never named.
      expect(
        (
          await SecurityUserVaultService.findUsersOfTokens({
            projectId: PROJECT_ID,
            tokens: [tokenOf(MALLORY)],
            now: OneUptimeDate.addRemoveDays(now, 2),
          })
        ).size,
      ).toBe(0);
    });

    test("30-day expiry: the rows of a user last seen more than 30 days ago are dropped", async () => {
      await writeVault(
        PROJECT_ID,
        [{ token: tokenOf("eve@acme.com"), user: "eve@acme.com" }],
        OneUptimeDate.addRemoveDays(new Date(), -31),
      );
      await writeVault(
        PROJECT_ID,
        [{ token: tokenOf(MALLORY), user: MALLORY }],
        new Date(),
      );
      await client.command({ query: `OPTIMIZE TABLE ${vaultTable} FINAL` });

      expect(
        (await vaultRowsOf(PROJECT_ID)).map((row: JSONObject): unknown => {
          return row["userValue"];
        }),
      ).toEqual([MALLORY]);
    });

    test("per-project keys: one project's token never names another project's user", async () => {
      await writeVault(
        OTHER_PROJECT_ID,
        [{ token: tokenOf(MALLORY, OTHER_PROJECT_ID), user: MALLORY }],
        new Date(),
      );

      expect(tokenOf(MALLORY)).not.toBe(tokenOf(MALLORY, OTHER_PROJECT_ID));
      expect(
        (
          await SecurityUserVaultService.findUsersOfTokens({
            projectId: PROJECT_ID,
            tokens: [tokenOf(MALLORY, OTHER_PROJECT_ID), tokenOf(MALLORY)],
          })
        ).size,
      ).toBe(0);
    });

    test("a token with two users - a collision - names neither", async () => {
      const token: string = tokenOf(MALLORY);

      await writeVault(PROJECT_ID, [{ token, user: MALLORY }], new Date());
      await writeVault(PROJECT_ID, [{ token, user: "eve@acme.com" }], new Date());
      await client.command({ query: `OPTIMIZE TABLE ${vaultTable} FINAL` });

      expect(await vaultRowsOf(PROJECT_ID)).toHaveLength(2);
      expect(
        (
          await SecurityUserVaultService.findUsersOfTokens({
            projectId: PROJECT_ID,
            tokens: [token],
          })
        ).size,
      ).toBe(0);
    });

    test("a page of 2,000 tokens is one query, and every user it holds is named", async () => {
      const users: Array<string> = [];

      for (let index: number = 0; index < 2000; index++) {
        users.push(`user-${index}@acme.com`);
      }

      await writeVault(
        PROJECT_ID,
        users.map((user: string): { token: string; user: string } => {
          return { token: tokenOf(user), user };
        }),
        new Date(),
      );

      const query: ReturnType<typeof jest.spyOn> = jest.spyOn(
        SecurityUserVaultService,
        "executeQuery",
      );
      const found: Map<string, string> =
        await SecurityUserVaultService.findUsersOfTokens({
          projectId: PROJECT_ID,
          tokens: users.map((user: string): string => {
            return tokenOf(user);
          }),
        });

      expect(query).toHaveBeenCalledTimes(1);
      expect(found.size).toBe(2000);
      expect(found.get(tokenOf("user-1999@acme.com"))).toBe(
        "user-1999@acme.com",
      );
    });
  });

  // A failed sign-in request's span: a path traversal in its query, its user an email.
  async function ingestSignInSpan(): Promise<void> {
    const nowNano: string = `${Date.now()}000000`;

    await OtelTracesIngestService.processTracesFromQueue(
      otlpRequest({
        resourceSpans: [
          {
            resource: { attributes: [attribute("service.name", SERVICE_NAME)] },
            scopeSpans: [
              {
                scope: {},
                spans: [
                  {
                    traceId: "0af7651916cd43dd8448eb211c80319c",
                    spanId: "b7ad6b7169203331",
                    parentSpanId: "",
                    name: "GET /download",
                    kind: 2,
                    startTimeUnixNano: nowNano,
                    endTimeUnixNano: nowNano,
                    status: { code: 1 },
                    attributes: [
                      attribute("http.request.method", "GET"),
                      attribute("url.path", "/download"),
                      attribute("url.query", "file=../../../../etc/passwd"),
                      attribute("http.response.status_code", "200"),
                      attribute("network.peer.address", "203.0.113.7"),
                      attribute("enduser.id", MALLORY),
                    ],
                    events: [],
                    links: [],
                  },
                ],
              },
            ],
          },
        ],
      }),
    );
    await SecurityUserVaultWriter.whenIdle();
  }

  async function traceScanEvents(): Promise<Array<NormalizedSecurityEvent>> {
    jest.spyOn(SecurityEventService, "findBy").mockResolvedValue([]);
    jest
      .spyOn(ExceptionInstanceService, "findExceptionsOfTraces")
      .mockResolvedValue([]);
    jest.spyOn(CommonTraceScrubRuleService, "findBy").mockResolvedValue([]);

    const now: Date = new Date();
    const read: TelemetryWindowRead = await TraceSecurityScan.readWindow({
      window: {
        projectId: PROJECT_ID,
        arrivedAfter: OneUptimeDate.addRemoveMinutes(now, -10),
        arrivedUntil: OneUptimeDate.addRemoveMinutes(now, 10),
        happenedAfter: OneUptimeDate.addRemoveDays(now, -1),
      },
      offset: 0,
      pageSize: 100,
    });

    return TraceSecurityScan.prepareEvents({
      projectId: PROJECT_ID,
      events: read.events,
    });
  }

  describe("the trace scan, from trace ingest", () => {
    test("a request whose user an Email rule hashed: the span holds only the token, the vault the user, and the event names them", async () => {
      traceRules = traceEmailRule(LogScrubAction.Hash);
      sourcesOn({ logs: false, traces: true });

      await ingestSignInSpan();

      const spans: Array<JSONObject> = await rowsOf(
        `SELECT attributes FROM ${database}.${new Span().tableName} WHERE projectId = '${PROJECT_ID.toString()}'`,
      );

      expect(spans).toHaveLength(1);
      expect((spans[0]!["attributes"] as JSONObject)["enduser.id"]).toBe(
        tokenOf(MALLORY),
      );
      expect(JSON.stringify(spans)).not.toContain(MALLORY);

      expect(await vaultRowsOf(PROJECT_ID)).toEqual([
        { token: tokenOf(MALLORY), userValue: MALLORY },
      ]);

      const events: Array<NormalizedSecurityEvent> = await traceScanEvents();

      expect(events).toHaveLength(1);
      expect(events[0]!.principalUser).toBe(MALLORY);
      expect(events[0]!.observables).toContain(MALLORY);
      expect(
        events[0]!.attributes[
          HASHED_USER_ATTRIBUTES[ScrubbedUserRole.Principal]
        ],
      ).toBe(tokenOf(MALLORY));
      expect(
        readHiddenEventUser(events[0]!, ScrubbedUserRole.Principal),
      ).toBeNull();
    });

    test("with the Traces source off and Your logs off, no vault row is written, and the event's user stays the token", async () => {
      traceRules = traceEmailRule(LogScrubAction.Hash);
      sourcesOn({ logs: false, traces: false });

      await ingestSignInSpan();

      expect(await vaultRowsOf(PROJECT_ID)).toEqual([]);

      const events: Array<NormalizedSecurityEvent> = await traceScanEvents();

      expect(events[0]!.principalUser).toBe(tokenOf(MALLORY));
      expect(
        readHiddenEventUser(events[0]!, ScrubbedUserRole.Principal),
      ).not.toBeNull();
    });

    test("with a Redact rule, no vault row is written and the event names no user", async () => {
      traceRules = traceEmailRule(LogScrubAction.Redact);
      sourcesOn({ logs: true, traces: true });

      await ingestSignInSpan();

      expect(await vaultRowsOf(PROJECT_ID)).toEqual([]);

      const events: Array<NormalizedSecurityEvent> = await traceScanEvents();

      expect(events[0]!.principalUser).toBe("");
    });

    test("a vault that cannot be written: the span is stored, with the token", async () => {
      traceRules = traceEmailRule(LogScrubAction.Hash);
      sourcesOn({ logs: false, traces: true });

      const aside: string = `${vaultTable}_aside`;
      await client.command({ query: `RENAME TABLE ${vaultTable} TO ${aside}` });

      try {
        await expect(ingestSignInSpan()).resolves.toBeUndefined();
      } finally {
        await client.command({
          query: `RENAME TABLE ${aside} TO ${vaultTable}`,
        });
      }

      const spans: Array<JSONObject> = await rowsOf(
        `SELECT attributes FROM ${database}.${new Span().tableName} WHERE projectId = '${PROJECT_ID.toString()}'`,
      );

      expect(spans).toHaveLength(1);
      expect((spans[0]!["attributes"] as JSONObject)["enduser.id"]).toBe(
        tokenOf(MALLORY),
      );
      expect(counted).toEqual(["trace:failed:1"]);
    });
  });

  describe("the log scan, from log ingest, through Your logs", () => {
    const SSH_LINE: string =
      "Nov 24 10:00:00 bastion sshd[4242]: Failed password for deploy from 203.0.113.7 port 52314 ssh2";
    const AUDIT_LINE: string = JSON.stringify({
      insertId: "1a2b3c4d5e",
      logName: "projects/acme-prod/logs/cloudaudit.googleapis.com%2Factivity",
      resource: { type: "service_account", labels: { project_id: "acme-prod" } },
      timestamp: "2026-11-24T09:58:12.345Z",
      severity: "NOTICE",
      protoPayload: {
        "@type": "type.googleapis.com/google.cloud.audit.AuditLog",
        status: {},
        authenticationInfo: { principalEmail: ALICE },
        requestMetadata: { callerIp: "203.0.113.7" },
        serviceName: "iam.googleapis.com",
        methodName: "google.iam.admin.v1.CreateServiceAccountKey",
        resourceName:
          "projects/-/serviceAccounts/app@acme-prod.iam.gserviceaccount.com",
      },
    });

    async function ingestLines(lines: Array<string>): Promise<void> {
      await OtelLogsIngestService.processLogsFromQueue(
        otlpRequest({
          resourceLogs: [
            {
              resource: {
                attributes: [attribute("service.name", SERVICE_NAME)],
              },
              scopeLogs: [
                {
                  scope: {},
                  logRecords: lines.map((line: string): JSONObject => {
                    return {
                      timeUnixNano: `${Date.now()}000000`,
                      severityNumber: 9,
                      body: { stringValue: line },
                      attributes: [],
                    };
                  }),
                },
              ],
            },
          ],
        }),
      );
      await SecurityUserVaultWriter.whenIdle();
    }

    // The stored lines as the log scan reads them, then their parse and their store.
    async function logScanRows(): Promise<Array<JSONObject>> {
      const now: Date = new Date();
      const rows: Array<JSONObject> = await rowsOf(
        `SELECT _id, time, createdAt, primaryEntityId, primaryEntityType, traceId, spanId, sessionId, attributes, body FROM ${database}.${new Log().tableName} WHERE projectId = '${PROJECT_ID.toString()}' ORDER BY createdAt ASC, _id ASC`,
      );
      const events: Array<NormalizedSecurityEvent> = [];

      for (const row of rows) {
        events.push(
          ...SecurityLogParser.parse({
            body: typeof row["body"] === "string" ? row["body"] : "",
            attributes: (row["attributes"] as JSONObject) || {},
            time: readClickhouseDate(row["time"]) || now,
            logId: typeof row["_id"] === "string" ? row["_id"] : undefined,
          }),
        );
      }

      const inserted: Array<JSONObject> = [];

      jest
        .spyOn(OpenStackAuditJoin, "enrichEvents")
        .mockResolvedValue(undefined as never);
      jest
        .spyOn(ThreatIntelEnricher, "enrichNormalizedEvents")
        .mockResolvedValue({ eventsMatched: 0, valuesLookedUp: 0 } as never);
      jest
        .spyOn(RealTimeDetections, "screen")
        .mockResolvedValue(undefined as never);
      jest
        .spyOn(SecurityEventService, "insertJsonRows")
        .mockImplementation(async (eventRows: Array<JSONObject>) => {
          inserted.push(...eventRows);
        });
      jest.spyOn(CommonLogScrubRuleService, "findBy").mockResolvedValue([]);
      /*
       * A cloud audit record another way may bring in too is stored once,
       * under its product's lock (SecurityEventStoreOnce): none was stored
       * before.
       */
      jest.spyOn(Semaphore, "lock").mockResolvedValue({} as never);
      jest.spyOn(Semaphore, "release").mockResolvedValue(undefined as never);
      jest
        .spyOn(SecurityEventDedupe, "findExistingEventUids")
        .mockResolvedValue(new Set<string>());

      await SecurityLogScanner.storeEvents({
        projectId: PROJECT_ID,
        events,
        serviceMetadata: METADATA,
      });

      return inserted;
    }

    test("an SSH failed password whose account a rule hashed: the log holds only the token, the vault the account, and the event names it", async () => {
      logRules = logRule({
        patternType: LogScrubPatternType.Custom,
        action: LogScrubAction.Hash,
        customRegex: "deploy",
      });
      sourcesOn({ logs: true, traces: false });

      await ingestLines([SSH_LINE]);

      const logs: Array<JSONObject> = await rowsOf(
        `SELECT body FROM ${database}.${new Log().tableName} WHERE projectId = '${PROJECT_ID.toString()}'`,
      );

      expect(String(logs[0]!["body"])).toContain(tokenOf("deploy"));
      expect(String(logs[0]!["body"])).not.toContain(" deploy ");
      expect(await vaultRowsOf(PROJECT_ID)).toEqual([
        { token: tokenOf("deploy"), userValue: "deploy" },
      ]);

      const stored: Array<JSONObject> = await logScanRows();

      expect(stored).toHaveLength(1);
      expect(stored[0]!["principalUser"]).toBe("deploy");
      expect(stored[0]!["principalIp"]).toBe("203.0.113.7");
    });

    test("a Google Cloud audit log's principal an Email rule hashed is named; an email in an app's line never reaches the vault", async () => {
      logRules = logRule({
        patternType: LogScrubPatternType.Email,
        action: LogScrubAction.Hash,
      });
      sourcesOn({ logs: true, traces: false });

      await ingestLines([AUDIT_LINE, `Sent the weekly digest to ${MALLORY}`]);

      expect(
        (await vaultRowsOf(PROJECT_ID)).map((row: JSONObject): unknown => {
          return row["userValue"];
        }),
      ).toEqual([ALICE]);

      const stored: Array<JSONObject> = await logScanRows();

      expect(stored.length).toBeGreaterThan(0);
      expect(stored[0]!["principalUser"]).toBe(ALICE);
    });

    test("with Your logs off, no vault row is written", async () => {
      logRules = logRule({
        patternType: LogScrubPatternType.Custom,
        action: LogScrubAction.Hash,
        customRegex: "deploy",
      });
      sourcesOn({ logs: false, traces: true });

      await ingestLines([SSH_LINE]);

      expect(await vaultRowsOf(PROJECT_ID)).toEqual([]);
    });
  });
});

describe("Security user vault ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
