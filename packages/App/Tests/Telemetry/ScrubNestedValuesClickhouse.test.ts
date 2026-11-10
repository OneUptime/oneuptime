import LlmModelPriceService from "../../FeatureSet/Telemetry/Services/LlmModelPriceService";
import LogDropFilterService from "../../FeatureSet/Telemetry/Services/LogDropFilterService";
import LogPipelineService from "../../FeatureSet/Telemetry/Services/LogPipelineService";
import LogScrubRuleService from "../../FeatureSet/Telemetry/Services/LogScrubRuleService";
import OtelLogsIngestService from "../../FeatureSet/Telemetry/Services/OtelLogsIngestService";
import OtelTracesIngestService from "../../FeatureSet/Telemetry/Services/OtelTracesIngestService";
import TraceDropFilterService from "../../FeatureSet/Telemetry/Services/TraceDropFilterService";
import TracePipelineService from "../../FeatureSet/Telemetry/Services/TracePipelineService";
import TraceScrubRuleService from "../../FeatureSet/Telemetry/Services/TraceScrubRuleService";
import ExceptionUtil from "../../FeatureSet/Telemetry/Utils/Exception";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
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
import TelemetryFanInWriter, {
  FanInInsertTarget,
} from "Common/Server/Utils/Telemetry/TelemetryFanInWriter";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { ScrubRegExp } from "Common/Types/Telemetry/ScrubRule";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import { SCRUB_MAX_VALUE_DEPTH } from "Common/Utils/Telemetry/ScrubNestedValues";
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
 * #6397 against a real ClickHouse. Scrub rules now read the texts inside a
 * list or a nested value, and hold a value too deep or too large for them
 * to read value by value as its JSON text. That text is claimed to be what
 * the Log and Span tables store for the list anyway: an attribute's value
 * is a text there. Here the logs and traces ingest write the same request
 * three times - with no rule, with a rule that matches nothing (the values
 * held as text) and with a project's Email and Sensitive Attribute Keys
 * rules - into the real tables, and what is read back is compared.
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server:
 *
 *   docker run -d --rm -p 18125:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18125 \
 *     npx jest Tests/Telemetry/ScrubNestedValuesClickhouse.test.ts
 *
 * The App Test workflow provides the server; the guard at the bottom fails
 * the run there if it ever goes missing.
 * ------------------------------------------------------------------
 */

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(120000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `scrub_nested_values_test_${process.pid}_${Date.now()}`;

const SERVICE_ID: ObjectID = ObjectID.generate();
const SERVICE_NAME: string = "checkout";

// One project for each set of rules the same request is ingested with.
const NO_RULES: ObjectID = ObjectID.generate();
const NOTHING_MATCHES: ObjectID = ObjectID.generate();
const MASKING: ObjectID = ObjectID.generate();

const EMAIL: string = "ada.lovelace@example.com";
const EMAIL_MASKED: string = "a***@***.com";
const DEEP_LISTS: number = SCRUB_MAX_VALUE_DEPTH + 8;
const WIDE_VALUES: number = 12_000;

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

function list(...values: Array<JSONObject>): JSONObject {
  return { arrayValue: { values: values } };
}

function nestedList(inner: JSONObject, lists: number): JSONObject {
  let value: JSONObject = inner;

  for (let level: number = 0; level < lists; level++) {
    value = list(value);
  }

  return value;
}

function nest(inner: unknown, lists: number): unknown {
  let value: unknown = inner;

  for (let level: number = 0; level < lists; level++) {
    value = [value];
  }

  return value;
}

// The attributes every record and span below carries.
function attributes(): JSONArray {
  return [
    {
      key: "user.emails",
      value: list(
        text(EMAIL),
        { intValue: "7" },
        { boolValue: true },
        { doubleValue: 1.5 },
      ),
    },
    {
      key: "contacts",
      value: list({
        kvlistValue: {
          values: [
            { key: "email", value: text(EMAIL) },
            { key: "password", value: text("pw-1") },
          ],
        },
      }),
    },
    {
      key: "http.request.header.authorization",
      value: list(text("Bearer abc")),
    },
    { key: "deep", value: nestedList(text(EMAIL), DEEP_LISTS) },
    {
      key: "wide",
      value: list(...new Array<JSONObject>(WIDE_VALUES).fill(text(EMAIL))),
    },
  ];
}

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
  customRegex?: string | undefined;
}

const RULES_BY_PROJECT: Array<[ObjectID, Array<RuleSpec>]> = [
  [NO_RULES, []],
  [
    NOTHING_MATCHES,
    [
      {
        patternType: "custom",
        action: "redact",
        customRegex: "NEVER-[0-9]{12}",
      },
    ],
  ],
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

  if (spec.customRegex) {
    rule.customRegex = spec.customRegex;
  }

  const regex: ScrubRegExp | null = (
    service as { getRegexForPattern: GetRegexForPattern }
  ).getRegexForPattern(spec.patternType, spec.customRegex);

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
                scope: { name: "scrub-nested-values" },
                logRecords: [
                  {
                    timeUnixNano: "1794218400000000000",
                    body: text("lists"),
                    attributes: attributes(),
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

// The rows the traces ingest hands the span writer for one project.
async function ingestSpanRows(
  projectId: ObjectID,
  specs: Array<RuleSpec>,
): Promise<Array<JSONObject>> {
  const rows: Array<JSONObject> = [];

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
          rows.push(...batch);
        } else if (target !== ExceptionInstanceService) {
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
                scope: { name: "scrub-nested-values" },
                spans: [
                  {
                    traceId: "5b8efff798038103d269b633813fc60c",
                    spanId: "aaaaaaaaaaaaaa01",
                    name: "lists",
                    kind: 2,
                    startTimeUnixNano: "1794218400000000000",
                    endTimeUnixNano: "1794218400250000000",
                    attributes: attributes(),
                    links: [
                      {
                        traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
                        spanId: "00f067aa0ba902b7",
                        attributes: [
                          { key: "link.owners", value: list(text(EMAIL)) },
                          {
                            key: "deep",
                            value: nestedList(text(EMAIL), DEEP_LISTS),
                          },
                        ],
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
  "scrub rules over lists and nested values, against ClickHouse (#6397)",
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

    // What the table holds for each project's row, as ClickHouse reads it.
    async function readStored(
      tableName: string,
      columns: string,
    ): Promise<Map<string, JSONObject>> {
      const result: { json: () => Promise<{ data: Array<JSONObject> }> } =
        (await client.query({
          query: `SELECT projectId, ${columns} FROM ${database}.${tableName} WHERE projectId IN ({projectIds:Array(String)})`,
          query_params: {
            projectIds: [NO_RULES, NOTHING_MATCHES, MASKING].map(
              (id: ObjectID): string => {
                return id.toString();
              },
            ),
          },
          format: "JSON",
        })) as unknown as {
          json: () => Promise<{ data: Array<JSONObject> }>;
        };

      const byProject: Map<string, JSONObject> = new Map();

      for (const row of (await result.json()).data) {
        byProject.set(row["projectId"] as string, row);
      }

      expect(byProject.size).toBe(3);
      return byProject;
    }

    function storedFor(
      stored: Map<string, JSONObject>,
      projectId: ObjectID,
    ): JSONObject {
      return stored.get(projectId.toString())!;
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

      wire(LogService as unknown as WiredService);
      wire(SpanService as unknown as WiredService);

      const logRows: Array<JSONObject> = [];
      const spanRows: Array<JSONObject> = [];

      for (const [projectId, specs] of RULES_BY_PROJECT) {
        logRows.push(...(await ingestLogRows(projectId, specs)));
        spanRows.push(...(await ingestSpanRows(projectId, specs)));
      }

      expect(logRows).toHaveLength(3);
      expect(spanRows).toHaveLength(3);

      await LogService.insertJsonRows(logRows, WAIT_FOR_FLUSH);
      await SpanService.insertJsonRows(spanRows, WAIT_FOR_FLUSH);
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

    test.each([
      [
        "Log",
        (): string => {
          return new Log().tableName;
        },
      ],
      [
        "Span",
        (): string => {
          return new Span().tableName;
        },
      ],
    ])(
      "%s: a value held as its JSON text is stored as the very text the table stores for it as a list",
      async (_label: string, tableName: () => string) => {
        const stored: Map<string, JSONObject> = await readStored(
          tableName(),
          "attributes",
        );
        const asLists: JSONObject = storedFor(stored, NO_RULES)[
          "attributes"
        ] as JSONObject;
        const held: JSONObject = storedFor(stored, NOTHING_MATCHES)[
          "attributes"
        ] as JSONObject;

        expect(asLists["deep"]).toBe(JSON.stringify(nest(EMAIL, DEEP_LISTS)));
        expect(held["deep"]).toBe(asLists["deep"]);
        expect(held["wide"]).toBe(asLists["wide"]);
        // A value that fits is stored as the list it stays.
        expect(held["user.emails"]).toBe(asLists["user.emails"]);
        expect(held).toEqual(asLists);
      },
    );

    test.each([
      [
        "Log",
        (): string => {
          return new Log().tableName;
        },
      ],
      [
        "Span",
        (): string => {
          return new Span().tableName;
        },
      ],
    ])(
      "%s: a scrubbed list is stored as the JSON text of the list it became",
      async (_label: string, tableName: () => string) => {
        const stored: Map<string, JSONObject> = await readStored(
          tableName(),
          "attributes",
        );
        const masked: JSONObject = storedFor(stored, MASKING)[
          "attributes"
        ] as JSONObject;

        expect(masked["user.emails"]).toBe(
          JSON.stringify([EMAIL_MASKED, "7", true, 1.5]),
        );
        expect(masked["contacts"]).toBe(
          JSON.stringify([
            {
              "contacts.email": EMAIL_MASKED,
              "contacts.password": "[REDACTED]",
            },
          ]),
        );
        expect(masked["http.request.header.authorization"]).toBe(
          JSON.stringify(["[REDACTED]"]),
        );
        expect(masked["deep"]).toBe(
          JSON.stringify(nest(EMAIL_MASKED, DEEP_LISTS)),
        );
        expect(masked["wide"]).toBe(
          JSON.stringify(new Array<string>(WIDE_VALUES).fill(EMAIL_MASKED)),
        );
        expect(JSON.stringify(masked)).not.toContain(EMAIL);
      },
    );

    test("a span's links are stored scrubbed; a link value held as text is stored as a text inside the link", async () => {
      const stored: Map<string, JSONObject> = await readStored(
        new Span().tableName,
        "links",
      );
      const linkAttributes: (projectId: ObjectID) => JSONObject = (
        projectId: ObjectID,
      ): JSONObject => {
        const links: unknown = storedFor(stored, projectId)["links"];
        const parsed: JSONArray = (
          typeof links === "string" ? JSON.parse(links) : links
        ) as JSONArray;

        return (parsed[0] as JSONObject)["attributes"] as JSONObject;
      };

      expect(linkAttributes(NO_RULES)).toEqual({
        "link.owners": [EMAIL],
        deep: nest(EMAIL, DEEP_LISTS),
      });
      expect(linkAttributes(NOTHING_MATCHES)).toEqual({
        "link.owners": [EMAIL],
        deep: JSON.stringify(nest(EMAIL, DEEP_LISTS)),
      });
      expect(linkAttributes(MASKING)).toEqual({
        "link.owners": [EMAIL_MASKED],
        deep: JSON.stringify(nest(EMAIL_MASKED, DEEP_LISTS)),
      });
    });
  },
);

describe("scrub rules over lists ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
