import LogDropFilterService from "../../FeatureSet/Telemetry/Services/LogDropFilterService";
import LogPipelineService from "../../FeatureSet/Telemetry/Services/LogPipelineService";
import LogScrubRuleService from "../../FeatureSet/Telemetry/Services/LogScrubRuleService";
import OtelLogsIngestService from "../../FeatureSet/Telemetry/Services/OtelLogsIngestService";
import ExceptionUtil from "../../FeatureSet/Telemetry/Utils/Exception";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import Log from "Common/Models/AnalyticsModels/Log";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import LogService from "Common/Server/Services/LogService";
import Query from "Common/Server/Types/AnalyticsDatabase/Query";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import { ExpressRequest } from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import TelemetryFanInWriter, {
  FanInInsertTarget,
} from "Common/Server/Utils/Telemetry/TelemetryFanInWriter";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import { readOwnValue, writeOwnValue } from "Common/Utils/LookupTable";
import { INHERITED_PROPERTY_NAMES } from "Common/Tests/Helpers/InheritedNames";
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
 * Issue #8025 against a real ClickHouse: a log record whose attributes are
 * named like what every object inherits - __proto__, constructor,
 * toString and the rest - is ingested, inserted into the Log table, and
 * read back by the Logs list's own read (LogService.findBy), with each
 * name's value, in attributeKeys, and in the JSON the API answers with
 * (the model's toJSON). Before the fix the ingest dropped __proto__ before
 * the insert, and the API's JSON dropped it again after the read.
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server:
 *
 *   docker run -d --rm -p 18125:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18125 \
 *     npx jest Tests/Telemetry/InheritedAttributeNamesClickhouse.test.ts
 *
 * The App Test workflow provides the server; the guard at the bottom fails
 * the run there if it ever goes missing.
 * ------------------------------------------------------------------
 */

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(120000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `inherited_names_test_${process.pid}_${Date.now()}`;

const PROJECT_ID: ObjectID = ObjectID.generate();
const SERVICE_ID: ObjectID = ObjectID.generate();

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

function stringAttribute(key: string, value: string): JSONObject {
  return { key, value: { stringValue: value } };
}

// One record with every inherited name as an attribute, its own text each.
const ATTRIBUTES: JSONArray = INHERITED_PROPERTY_NAMES.map(
  (name: string): JSONObject => {
    return stringAttribute(name, `own ${name}`);
  },
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type IngestTestMethods = Record<string, any>;

// The rows the logs ingest hands the log writer for the record.
async function ingestRows(): Promise<Array<JSONObject>> {
  const rows: Array<JSONObject> = [];
  const ingest: IngestTestMethods =
    OtelLogsIngestService as unknown as IngestTestMethods;

  for (const method of AUTO_DISCOVERY_METHODS) {
    if (typeof ingest[method] === "function") {
      jest.spyOn(ingest, method).mockResolvedValue(null);
    }
  }
  jest.spyOn(ingest, "resolveTelemetryResource").mockResolvedValue({
    serviceName: "checkout",
    primaryEntityId: new ObjectID(SERVICE_ID.toString()),
    primaryEntityType: ServiceType.OpenTelemetry,
    dataRententionInDays: 15,
    serviceRetentionConfig: null,
    serviceRetentionInDays: null,
    projectRetentionConfig: null,
    projectRetentionInDays: 15,
  });
  jest.spyOn(LogPipelineService, "loadPipelines").mockResolvedValue([]);
  jest.spyOn(LogDropFilterService, "loadDropFilters").mockResolvedValue([]);
  jest.spyOn(LogScrubRuleService, "loadScrubRules").mockResolvedValue([]);
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
      projectId: new ObjectID(PROJECT_ID.toString()),
      headers: {},
      body: JSON.parse(
        JSON.stringify({
          resourceLogs: [
            {
              resource: {
                attributes: [stringAttribute("service.name", "checkout")],
              },
              scopeLogs: [
                {
                  scope: { name: "inherited-names" },
                  logRecords: [
                    {
                      timeUnixNano: `${Date.now()}000000`,
                      body: { stringValue: "request failed" },
                      attributes: ATTRIBUTES,
                    },
                    // A record without them, for the filters to tell apart.
                    {
                      timeUnixNano: `${Date.now()}000000`,
                      body: { stringValue: "request served" },
                      attributes: [stringAttribute("route", "/")],
                    },
                  ],
                },
              ],
            },
          ],
        }),
      ),
    } as unknown as ExpressRequest);
  } finally {
    jest.restoreAllMocks();
  }

  return rows;
}

async function createTable(
  client: ClickhouseClient,
  clickhouse: ClickhouseDatabase,
): Promise<void> {
  const model: AnalyticsBaseModel = new Log();
  const generator: StatementGenerator<AnalyticsBaseModel> =
    new StatementGenerator<AnalyticsBaseModel>({
      modelType: Log as unknown as { new (): AnalyticsBaseModel },
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

type WiredService = {
  database: ClickhouseDatabase;
  databaseClient: ClickhouseClient | null;
  ingestDatabase: ClickhouseDatabase;
  ingestDatabaseClient: ClickhouseClient | null;
};

// Wait for the flush, so a refused row fails the insert here, not later.
const WAIT_FOR_FLUSH: { clickhouseSettings: { wait_for_async_insert: 1 } } = {
  clickhouseSettings: { wait_for_async_insert: 1 },
};

integration(
  "attributes named like what every object inherits, against ClickHouse (#8025)",
  () => {
    let clickhouse: ClickhouseDatabase;
    let client: ClickhouseClient;
    let saved: WiredService | undefined;
    let rows: Array<JSONObject> = [];

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
      await createTable(client, clickhouse);

      const wired: WiredService = LogService as unknown as WiredService;
      saved = {
        database: wired.database,
        databaseClient: wired.databaseClient,
        ingestDatabase: wired.ingestDatabase,
        ingestDatabaseClient: wired.ingestDatabaseClient,
      };
      wired.database = clickhouse;
      wired.databaseClient = client;
      wired.ingestDatabase = clickhouse;
      wired.ingestDatabaseClient = client;

      rows = await ingestRows();
      await LogService.insertJsonRows(rows, WAIT_FOR_FLUSH);
    });

    afterAll(async (): Promise<void> => {
      if (saved) {
        Object.assign(LogService as unknown as WiredService, saved);
      }

      if (client) {
        await client.command({ query: `DROP DATABASE IF EXISTS ${database}` });
      }

      if (clickhouse) {
        await clickhouse.disconnect();
      }
    });

    test("the row goes in with every name, and ClickHouse's own map and key list hold each", async () => {
      expect(rows).toHaveLength(2);

      const result: { json: () => Promise<{ data: Array<JSONObject> }> } =
        (await client.query({
          query: `SELECT mapKeys(attributes) AS stored, attributeKeys FROM ${database}.${new Log().tableName} WHERE projectId = {projectId:String} AND body = 'request failed'`,
          query_params: { projectId: PROJECT_ID.toString() },
          format: "JSON",
        })) as unknown as {
          json: () => Promise<{ data: Array<JSONObject> }>;
        };
      const data: Array<JSONObject> = (await result.json()).data;

      expect(data).toHaveLength(1);

      for (const name of INHERITED_PROPERTY_NAMES) {
        expect({
          name,
          stored: (data[0]!["stored"] as Array<string>).includes(name),
          listed: (data[0]!["attributeKeys"] as Array<string>).includes(name),
        }).toEqual({ name, stored: true, listed: true });
      }
    });

    test("the Logs list's read gives each name its value, and the API's JSON keeps it", async () => {
      const listed: Array<Log> = await LogService.findBy({
        query: { projectId: PROJECT_ID, body: "request failed" },
        select: { body: true, attributes: true, attributeKeys: true },
        skip: 0,
        limit: 10,
        props: { isRoot: true },
      });

      expect(listed).toHaveLength(1);

      const attributes: JSONObject = listed[0]!.getColumnValue(
        "attributes",
      ) as JSONObject;
      const answered: JSONObject = JSON.parse(
        JSON.stringify(listed[0]!.toJSON()),
      ) as JSONObject;

      for (const name of INHERITED_PROPERTY_NAMES) {
        expect({
          name,
          read: readOwnValue(attributes, name),
          answered: readOwnValue(answered["attributes"] as JSONObject, name),
        }).toEqual({ name, read: `own ${name}`, answered: `own ${name}` });
      }

      expect(Object.getPrototypeOf(attributes)).toBe(Object.prototype);
    });

    test.each(INHERITED_PROPERTY_NAMES)(
      "a Logs filter on the attribute %s finds the record that has it, and only that one",
      async (name: string) => {
        const attributes: JSONObject = {};
        writeOwnValue(attributes, name, `own ${name}`);

        expect(
          (
            await LogService.countBy({
              query: { projectId: PROJECT_ID, attributes } as Query<Log>,
              skip: 0,
              limit: 100,
              props: { isRoot: true },
            })
          ).toNumber(),
        ).toBe(1);
      },
    );
  },
);

describe("inherited attribute names ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
