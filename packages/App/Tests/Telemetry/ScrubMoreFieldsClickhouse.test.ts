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
  ExceptionFingerprintInput,
} from "../../FeatureSet/Telemetry/Utils/Exception";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import ExceptionInstance from "Common/Models/AnalyticsModels/ExceptionInstance";
import Log from "Common/Models/AnalyticsModels/Log";
import Span from "Common/Models/AnalyticsModels/Span";
import LogScrubRule from "Common/Models/DatabaseModels/LogScrubRule";
import TraceScrubRule from "Common/Models/DatabaseModels/TraceScrubRule";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import ExceptionInstanceService from "Common/Server/Services/ExceptionInstanceService";
import LogService from "Common/Server/Services/LogService";
import SpanService from "Common/Server/Services/SpanService";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import { ExpressRequest } from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import {
  getExceptionGroupingKey,
  getExceptionGroupingText,
} from "Common/Server/Utils/Telemetry/ExceptionGrouping";
import KeyedExceptionFingerprint from "Common/Server/Utils/Telemetry/KeyedExceptionFingerprint";
import TelemetryFanInWriter, {
  FanInInsertTarget,
} from "Common/Server/Utils/Telemetry/TelemetryFanInWriter";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { ScrubRegExp } from "Common/Types/Telemetry/ScrubRule";
import ServiceType from "Common/Types/Telemetry/ServiceType";
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
 * #6513 against a real ClickHouse. Real OTLP requests go through the logs
 * and traces ingest into the real Log, Span and ExceptionInstance tables,
 * twice - with no rule, and with a project's Email (mask) and Sensitive
 * Attribute Keys (redact) rules - and what the tables hold is read back:
 *
 *   - a log body sent as a key-value list, as a list, and one written as
 *     JSON: the value under each secret key is hidden, and the body is
 *     stored as the very JSON text it is stored as without a rule, but for
 *     the hidden texts;
 *   - a span's status message and its events' names are masked;
 *   - an exception's type is masked, as its span event's exception.type
 *     is, and the exception is grouped by what it said as it came, never
 *     by what the rule left of it (#10434): since the rule hid part of
 *     the text grouping hashes, under the keyed fingerprint of that text,
 *     which no unkeyed hash of a guess can match.
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server:
 *
 *   docker run -d --rm -p 18125:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18125 \
 *     npx jest Tests/Telemetry/ScrubMoreFieldsClickhouse.test.ts
 *
 * The App Test workflow provides the server; the guard at the bottom fails
 * the run there if it ever goes missing.
 * ------------------------------------------------------------------
 */

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(120000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `scrub_more_fields_test_${process.pid}_${Date.now()}`;

const SERVICE_ID: ObjectID = ObjectID.generate();
const SERVICE_NAME: string = "checkout";

// One project for each set of rules the same requests are ingested with.
const NO_RULES: ObjectID = ObjectID.generate();
const MASKING: ObjectID = ObjectID.generate();

const EMAIL: string = "ada.lovelace@example.com";
const EMAIL_MASKED: string = "a***@***.com";

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
  "autoDiscoverIoTFleet",
  "autoDiscoverDatabaseServer",
  "autoDiscoverOpenStackCloud",
];

function text(value: string): JSONObject {
  return { stringValue: value };
}

function pairs(entries: Array<[string, JSONObject]>): JSONArray {
  return entries.map(([key, value]: [string, JSONObject]): JSONObject => {
    return { key: key, value: value };
  });
}

function keyValueList(entries: Array<[string, JSONObject]>): JSONObject {
  return { kvlistValue: { values: pairs(entries) } };
}

function list(...values: Array<JSONObject>): JSONObject {
  return { arrayValue: { values: values } };
}

// The three bodies, by the time each record says it happened.
const MAP_BODY: JSONObject = keyValueList([
  ["message", text(`login by ${EMAIL}`)],
  ["password", text("pw-map")],
  ["attempt", { intValue: "2" }],
]);
const LIST_BODY: JSONObject = list(
  keyValueList([["api_key", text("key-list")]]),
  text("a text in a list holds no key"),
);
const JSON_TEXT_BODY: string =
  '{"level":"info","user":"ada","session_token":"tok-json"}';

const RECORDS: Array<[string, JSONObject | string]> = [
  ["1794218400000000000", MAP_BODY],
  ["1794218401000000000", LIST_BODY],
  ["1794218402000000000", JSON_TEXT_BODY],
];

const RESOURCE: JSONObject = {
  attributes: [{ key: "service.name", value: text(SERVICE_NAME) }],
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type IngestTestMethods = Record<string, any>;

function stubResources(ingest: IngestTestMethods): void {
  for (const method of AUTO_DISCOVERY_METHODS) {
    if (typeof ingest[method] === "function") {
      jest.spyOn(ingest, method).mockResolvedValue(null);
    }
  }

  jest.spyOn(ingest, "resolveTelemetryResource").mockResolvedValue({
    serviceName: SERVICE_NAME,
    primaryEntityId: new ObjectID(SERVICE_ID.toString()),
    primaryEntityType: ServiceType.OpenTelemetry,
    dataRententionInDays: 15,
    serviceRetentionConfig: null,
    serviceRetentionInDays: null,
    projectRetentionConfig: null,
    projectRetentionInDays: 15,
  });
}

type GetRegexForPattern = (
  patternType: string,
  customRegex?: string,
) => ScrubRegExp | null;

interface RuleSpec {
  patternType: string;
  action: string;
}

const RULES_BY_PROJECT: Array<[ObjectID, Array<RuleSpec>]> = [
  [NO_RULES, []],
  [
    MASKING,
    [
      { patternType: "email", action: "mask" },
      { patternType: "sensitiveKeys", action: "redact" },
    ],
  ],
];

function compile(
  service: unknown,
  rule: LogScrubRule | TraceScrubRule,
  spec: RuleSpec,
  fields: string,
): JSONObject {
  rule.patternType = spec.patternType;
  rule.scrubAction = spec.action;
  rule.fieldsToScrub = fields;

  const regex: ScrubRegExp | null = (
    service as { getRegexForPattern: GetRegexForPattern }
  ).getRegexForPattern(spec.patternType);

  expect(regex).not.toBeNull();

  return { rule: rule, regex: regex } as unknown as JSONObject;
}

// The rows the logs ingest hands the log writer for one project.
async function ingestLogRows(
  projectId: ObjectID,
  specs: Array<RuleSpec>,
): Promise<Array<JSONObject>> {
  const rows: Array<JSONObject> = [];

  stubResources(OtelLogsIngestService as unknown as IngestTestMethods);
  jest.spyOn(LogPipelineService, "loadPipelines").mockResolvedValue([]);
  jest.spyOn(LogDropFilterService, "loadDropFilters").mockResolvedValue([]);
  jest.spyOn(LogScrubRuleService, "loadScrubRules").mockResolvedValue(
    specs.map((spec: RuleSpec): JSONObject => {
      return compile(LogScrubRuleService, new LogScrubRule(), spec, "both");
    }) as never,
  );
  jest
    .spyOn(TelemetryFanInWriter, "submit")
    .mockImplementation(
      async (target: FanInInsertTarget, batch: Array<JSONObject>) => {
        if (target !== LogService) {
          throw new Error(`unexpected fan-in target ${target.model.tableName}`);
        }
        rows.push(...batch);
        return { flushed: Promise.resolve() };
      },
    );
  jest
    .spyOn(ExceptionUtil, "saveOrUpdateTelemetryExceptionsBatch")
    .mockResolvedValue(undefined);
  jest.spyOn(logger, "warn").mockImplementation((): void => {});

  try {
    await OtelLogsIngestService.processLogsFromQueue({
      projectId: new ObjectID(projectId.toString()),
      headers: {},
      body: {
        resourceLogs: [
          {
            resource: RESOURCE,
            scopeLogs: [
              {
                scope: { name: "scrub-more-fields" },
                logRecords: RECORDS.map(
                  ([time, body]: [string, JSONObject | string]): JSONObject => {
                    return {
                      timeUnixNano: time,
                      severityNumber: 9,
                      body: typeof body === "string" ? text(body) : body,
                    };
                  },
                ),
              },
            ],
          },
        ],
      },
    } as unknown as ExpressRequest);
  } finally {
    jest.restoreAllMocks();
  }

  return rows;
}

interface TraceRows {
  spans: Array<JSONObject>;
  exceptions: Array<JSONObject>;
}

// The rows the traces ingest hands the span and exception writers.
async function ingestTraceRows(
  projectId: ObjectID,
  specs: Array<RuleSpec>,
): Promise<TraceRows> {
  const rows: TraceRows = { spans: [], exceptions: [] };

  stubResources(OtelTracesIngestService as unknown as IngestTestMethods);
  jest.spyOn(TraceDropFilterService, "loadDropFilters").mockResolvedValue([]);
  jest.spyOn(TracePipelineService, "loadPipelines").mockResolvedValue([]);
  jest.spyOn(LlmModelPriceService, "loadModelPrices").mockResolvedValue([]);
  jest.spyOn(TraceScrubRuleService, "loadScrubRules").mockResolvedValue(
    specs.map((spec: RuleSpec): JSONObject => {
      return compile(TraceScrubRuleService, new TraceScrubRule(), spec, "all");
    }) as never,
  );
  jest
    .spyOn(TelemetryFanInWriter, "submit")
    .mockImplementation(
      async (target: FanInInsertTarget, batch: Array<JSONObject>) => {
        if (target === SpanService) {
          rows.spans.push(...batch);
        } else if (target === ExceptionInstanceService) {
          rows.exceptions.push(...batch);
        } else {
          throw new Error(`unexpected fan-in target ${target.model.tableName}`);
        }
        return { flushed: Promise.resolve() };
      },
    );
  jest
    .spyOn(ExceptionUtil, "saveOrUpdateTelemetryExceptionsBatch")
    .mockResolvedValue(undefined);
  jest.spyOn(logger, "warn").mockImplementation((): void => {});

  try {
    await OtelTracesIngestService.processTracesFromQueue({
      projectId: new ObjectID(projectId.toString()),
      headers: {},
      body: {
        resourceSpans: [
          {
            resource: RESOURCE,
            scopeSpans: [
              {
                scope: { name: "scrub-more-fields" },
                spans: [
                  {
                    traceId: "5b8efff798038103d269b633813fc60c",
                    spanId: "aaaaaaaaaaaaaa01",
                    name: "POST /charge",
                    kind: 2,
                    startTimeUnixNano: "1794218400000000000",
                    endTimeUnixNano: "1794218400250000000",
                    status: { code: 2, message: `card declined for ${EMAIL}` },
                    events: [
                      {
                        timeUnixNano: "1794218400100000000",
                        name: `retrying for ${EMAIL}`,
                        attributes: [],
                      },
                      {
                        timeUnixNano: "1794218400200000000",
                        name: "exception",
                        attributes: pairs([
                          ["exception.type", text(`CardDeclined[${EMAIL}]`)],
                          ["exception.message", text("card declined")],
                          [
                            "exception.stacktrace",
                            text("at charge (pay.js:9)"),
                          ],
                        ]),
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    } as unknown as ExpressRequest);
  } finally {
    jest.restoreAllMocks();
  }

  return rows;
}

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

interface WiredService {
  database: ClickhouseDatabase;
  databaseClient: ClickhouseClient | null;
  ingestDatabase: ClickhouseDatabase;
  ingestDatabaseClient: ClickhouseClient | null;
}

// Wait for the flush, so a refused row fails the insert here, not later.
const WAIT_FOR_FLUSH: { clickhouseSettings: { wait_for_async_insert: 1 } } = {
  clickhouseSettings: { wait_for_async_insert: 1 },
};

integration(
  "scrub rules over structured bodies, status messages and event names, against ClickHouse (#6513)",
  () => {
    let clickhouse: ClickhouseDatabase;
    let client: ClickhouseClient;
    const saved: Map<WiredService, WiredService> = new Map();

    function wire(service: WiredService): void {
      saved.set(service, {
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

    // What a table holds for a project, as ClickHouse reads it.
    async function readStored(
      tableName: string,
      projectId: ObjectID,
      columns: string,
      orderBy: string,
    ): Promise<Array<JSONObject>> {
      const result: { json: () => Promise<{ data: Array<JSONObject> }> } =
        (await client.query({
          query: `SELECT ${columns} FROM ${database}.${tableName} WHERE projectId = {projectId:String} ORDER BY ${orderBy}`,
          query_params: { projectId: projectId.toString() },
          format: "JSON",
        })) as unknown as {
          json: () => Promise<{ data: Array<JSONObject> }>;
        };

      return (await result.json()).data;
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
      await createTable(client, clickhouse, Log);
      await createTable(client, clickhouse, Span);
      await createTable(client, clickhouse, ExceptionInstance);

      wire(LogService as unknown as WiredService);
      wire(SpanService as unknown as WiredService);
      wire(ExceptionInstanceService as unknown as WiredService);

      const logRows: Array<JSONObject> = [];
      const spanRows: Array<JSONObject> = [];
      const exceptionRows: Array<JSONObject> = [];

      for (const [projectId, specs] of RULES_BY_PROJECT) {
        logRows.push(...(await ingestLogRows(projectId, specs)));

        const traceRows: TraceRows = await ingestTraceRows(projectId, specs);

        spanRows.push(...traceRows.spans);
        exceptionRows.push(...traceRows.exceptions);
      }

      expect(logRows).toHaveLength(6);
      expect(spanRows).toHaveLength(2);
      expect(exceptionRows).toHaveLength(2);

      await LogService.insertJsonRows(logRows, WAIT_FOR_FLUSH);
      await SpanService.insertJsonRows(spanRows, WAIT_FOR_FLUSH);
      await ExceptionInstanceService.insertJsonRows(
        exceptionRows,
        WAIT_FOR_FLUSH,
      );
    });

    afterAll(async (): Promise<void> => {
      for (const [service, original] of saved) {
        Object.assign(service, original);
      }

      if (client) {
        await client.command({ query: `DROP DATABASE IF EXISTS ${database}` });
      }

      if (clickhouse) {
        await clickhouse.disconnect();
      }
    });

    async function bodies(projectId: ObjectID): Promise<Array<string>> {
      return (
        await readStored(new Log().tableName, projectId, "body", "time")
      ).map((row: JSONObject): string => {
        return row["body"] as string;
      });
    }

    test("without a rule, each body is stored as ingest writes it: a map or a list as its JSON text", async () => {
      expect(await bodies(NO_RULES)).toEqual([
        JSON.stringify(MAP_BODY),
        JSON.stringify(LIST_BODY),
        JSON_TEXT_BODY,
      ]);
    });

    test("with the rules, the value under each secret key is hidden, and the body is the same JSON text otherwise", async () => {
      const [map, listed, jsonText] = await bodies(MASKING);

      expect(map).toBe(
        JSON.stringify(
          keyValueList([
            ["message", text(`login by ${EMAIL_MASKED}`)],
            ["password", text("[REDACTED]")],
            ["attempt", { intValue: "2" }],
          ]),
        ),
      );
      expect(listed).toBe(
        JSON.stringify(
          list(
            keyValueList([["api_key", text("[REDACTED]")]]),
            text("a text in a list holds no key"),
          ),
        ),
      );
      expect(jsonText).toBe(
        '{"level":"info","user":"ada","session_token":"[REDACTED]"}',
      );

      const stored: string = JSON.stringify([map, listed, jsonText]);

      for (const secret of [EMAIL, "pw-map", "key-list", "tok-json"]) {
        expect(stored).not.toContain(secret);
      }
    });

    test("a span's status message and its events' names are stored masked", async () => {
      const [unscrubbed] = await readStored(
        new Span().tableName,
        NO_RULES,
        "statusMessage, events",
        "startTime",
      );
      const [masked] = await readStored(
        new Span().tableName,
        MASKING,
        "statusMessage, events",
        "startTime",
      );
      const eventNames: (row: JSONObject) => Array<unknown> = (
        row: JSONObject,
      ): Array<unknown> => {
        const events: unknown = row["events"];
        const parsed: JSONArray = (
          typeof events === "string" ? JSON.parse(events) : events
        ) as JSONArray;

        return parsed.map((event: JSONObject): unknown => {
          return event["name"];
        });
      };

      expect(unscrubbed!["statusMessage"]).toBe(`card declined for ${EMAIL}`);
      expect(eventNames(unscrubbed!)).toEqual([
        `retrying for ${EMAIL}`,
        "exception",
      ]);
      expect(masked!["statusMessage"]).toBe(
        `card declined for ${EMAIL_MASKED}`,
      );
      expect(eventNames(masked!)).toEqual([
        `retrying for ${EMAIL_MASKED}`,
        "exception",
      ]);
      expect(JSON.stringify(masked)).not.toContain(EMAIL);
    });

    test("an exception's type is stored masked, grouped by what it said as it came, under a keyed fingerprint where the rule hid part of it", async () => {
      const [unscrubbed] = await readStored(
        new ExceptionInstance().tableName,
        NO_RULES,
        "exceptionType, message, fingerprint",
        "time",
      );
      const [masked] = await readStored(
        new ExceptionInstance().tableName,
        MASKING,
        "exceptionType, message, fingerprint",
        "time",
      );

      expect(unscrubbed!["exceptionType"]).toBe(`CardDeclined[${EMAIL}]`);
      expect(masked!["exceptionType"]).toBe(`CardDeclined[${EMAIL_MASKED}]`);
      expect(masked!["message"]).toBe("card declined");

      const arrived: {
        message: string;
        stackTrace: string;
        exceptionType: string;
      } = {
        message: "card declined",
        stackTrace: "at charge (pay.js:9)",
        exceptionType: `CardDeclined[${EMAIL}]`,
      };

      /*
       * With no rule, the exception is grouped by an unkeyed hash of what it
       * says, as ever: grouping v1's when the project's exceptions cannot be
       * read, else v2's, which a new exception is made under.
       */
      const unscrubbedArrived: ExceptionFingerprintInput = {
        projectId: NO_RULES,
        primaryEntityId: SERVICE_ID,
        ...arrived,
      };

      expect([
        ExceptionUtil.getFingerprint(unscrubbedArrived),
        ExceptionUtil.getFingerprintV2(unscrubbedArrived),
      ]).toContain(unscrubbed!["fingerprint"]);

      /*
       * With the rules, it is grouped by what it said as it came too, never
       * by what the rule left of it, so a rule added later splits nothing
       * (#10434). But the address the Email rule hid is in the text that
       * grouping hashes, so a new exception is made under the keyed
       * fingerprint of that text (KeyedExceptionFingerprint): the same
       * content, the same group, and no unkeyed hash that anyone could hash
       * guesses of the address against.
       */
      expect(masked!["fingerprint"]).toBe(
        KeyedExceptionFingerprint.ofGroupingText({
          projectId: MASKING,
          text: getExceptionGroupingText({
            projectId: MASKING.toString(),
            primaryEntityId: SERVICE_ID.toString(),
            key: getExceptionGroupingKey(arrived),
          }),
        }),
      );

      const maskedArrived: ExceptionFingerprintInput = {
        projectId: MASKING,
        primaryEntityId: SERVICE_ID,
        ...arrived,
      };
      const maskedStored: ExceptionFingerprintInput = {
        ...maskedArrived,
        exceptionType: `CardDeclined[${EMAIL_MASKED}]`,
      };

      for (const unkeyed of [
        ExceptionUtil.getFingerprint(maskedArrived),
        ExceptionUtil.getFingerprintV2(maskedArrived),
        ExceptionUtil.getFingerprint(maskedStored),
        ExceptionUtil.getFingerprintV2(maskedStored),
      ]) {
        expect(masked!["fingerprint"]).not.toBe(unkeyed);
      }
    });
  },
);

describe("scrub rules over more fields ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
