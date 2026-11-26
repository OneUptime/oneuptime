import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import Log from "Common/Models/AnalyticsModels/Log";
import Span from "Common/Models/AnalyticsModels/Span";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import AnalyticsDatabaseService from "Common/Server/Services/AnalyticsDatabaseService";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import ScrubHashToken from "Common/Server/Utils/Telemetry/ScrubHashToken";
import Route from "Common/Types/API/Route";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Query from "Common/Types/BaseDatabase/Query";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type * as LinksModuleType from "../../FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventTelemetryLinks";
import type * as LogsPivotModuleType from "../../FeatureSet/Dashboard/src/Utils/LogsCrossSignalPivot";
import type * as TracesSearchModuleType from "../../FeatureSet/Dashboard/src/Components/Traces/TracesSearchCompile";

/*
 * ------------------------------------------------------------------
 * "Hashed in your logs/traces as [HASHED:...]" finds the records, whatever
 * field held the user (#11045), against a real ClickHouse server.
 *
 * The user vault reads a user from a span's enduser.id or user.id, an AI
 * call's user (the attribute its llmUserId is copied from), a log line's
 * body, or an attribute a log parser reads (an OpenStack line's
 * openstack.user_name). The event says which, and the panel's link
 * searches there. Here each link is built as the panel builds it
 * (getHashedUserSearch), its query string read as the explorer reads it
 * (the logs explorer's filter chips, applyLogsFacetFiltersToQuery; the
 * traces explorer's search bar, parseTraceSearch and
 * compileTraceAttributeFilters), and the query run through LogService and
 * SpanService on real Log and Span tables: each returns exactly the
 * records that hold the person's token in that field - a value that is the
 * token, or holds it ("auth0|[HASHED:...]") - and none of anybody else's.
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server:
 *
 *   docker run -d --rm -p 18124:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18124 \
 *     npx jest Tests/Telemetry/HashedUserSearchClickhouse.test.ts
 *
 * The suite creates and drops only its own uniquely named database. The
 * App Test workflow provides the server; the guard at the bottom fails the
 * run there if it ever goes missing.
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

import LogService from "Common/Server/Services/LogService";
import SpanService from "Common/Server/Services/SpanService";

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(180000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `hashed_user_search_test_${process.pid}_${Date.now()}`;

const PROJECT_ID: ObjectID = new ObjectID(
  "11045000-0000-4000-8000-0000000000a1",
);
const SERVICE_ID: ObjectID = new ObjectID(
  "11045000-0000-4000-8000-0000000000a2",
);

const TOKEN: string = ScrubHashToken.ofValue({
  projectId: PROJECT_ID,
  value: "alice@example.com",
});
// Somebody else's: never found by the person's search.
const OTHER_TOKEN: string = ScrubHashToken.ofValue({
  projectId: PROJECT_ID,
  value: "bob@example.com",
});

// When the event happened: its records are searched a day either side.
const EVENT_TIME: Date = OneUptimeDate.addRemoveHours(new Date(), -2);

const retentionDate: string = OneUptimeDate.toClickhouseDateTime(
  OneUptimeDate.addRemoveDays(new Date(), 30),
).substring(0, 10);

interface ServiceConnection {
  database: ClickhouseDatabase;
  databaseClient: ClickhouseClient | null;
  ingestDatabase: ClickhouseDatabase;
  ingestDatabaseClient: ClickhouseClient | null;
}

function logRow(data: {
  id: string;
  body: string;
  attributes?: Record<string, string> | undefined;
  minutesFromEvent?: number | undefined;
}): JSONObject {
  const time: Date = OneUptimeDate.addRemoveMinutes(
    EVENT_TIME,
    data.minutesFromEvent ?? 1,
  );
  const attributes: Record<string, string> = data.attributes || {};

  return {
    _id: data.id,
    createdAt: OneUptimeDate.toClickhouseDateTime(time),
    projectId: PROJECT_ID.toString(),
    primaryEntityId: SERVICE_ID.toString(),
    primaryEntityType: "Service",
    time: OneUptimeDate.toClickhouseDateTime64(time),
    timeUnixNano: String(time.getTime() * 1000000),
    severityText: "Information",
    severityNumber: 9,
    attributes,
    attributeKeys: Object.keys(attributes).sort(),
    entityKeys: [],
    traceId: "",
    spanId: "",
    body: data.body,
    retentionDate,
  };
}

function spanRow(data: {
  spanId: string;
  attributes: Record<string, string>;
  minutesFromEvent?: number | undefined;
}): JSONObject {
  const start: Date = OneUptimeDate.addRemoveMinutes(
    EVENT_TIME,
    data.minutesFromEvent ?? 1,
  );
  const startNs: string = String(BigInt(start.getTime()) * BigInt(1000000));

  return {
    _id: ObjectID.generateTimeOrdered().toString(),
    createdAt: OneUptimeDate.toClickhouseDateTime(start),
    projectId: PROJECT_ID.toString(),
    primaryEntityId: SERVICE_ID.toString(),
    primaryEntityType: "Service",
    startTime: OneUptimeDate.toClickhouseDateTime64(start),
    endTime: OneUptimeDate.toClickhouseDateTime64(start),
    startTimeUnixNano: startNs,
    endTimeUnixNano: String(BigInt(startNs) + BigInt(12000000)),
    durationUnixNano: "12000000",
    traceId: `trace-${data.spanId}`,
    spanId: data.spanId,
    parentSpanId: "",
    attributes: data.attributes,
    attributeKeys: Object.keys(data.attributes).sort(),
    entityKeys: [],
    statusCode: 0,
    name: "GET /orders",
    kind: "SPAN_KIND_SERVER",
    isRootSpan: true,
    retentionDate,
  };
}

integration(
  "the search for a hashed user, whatever field held them, against ClickHouse",
  () => {
    let clickhouse: ClickhouseDatabase;
    let client: ClickhouseClient;
    const originals: Map<
      AnalyticsDatabaseService<AnalyticsBaseModel>,
      ServiceConnection
    > = new Map();
    let Links: typeof LinksModuleType;
    let LogsPivot: typeof LogsPivotModuleType;
    let TracesSearch: typeof TracesSearchModuleType;

    const logService: AnalyticsDatabaseService<AnalyticsBaseModel> =
      LogService as unknown as AnalyticsDatabaseService<AnalyticsBaseModel>;
    const spanService: AnalyticsDatabaseService<AnalyticsBaseModel> =
      SpanService as unknown as AnalyticsDatabaseService<AnalyticsBaseModel>;

    async function createTable(modelType: {
      new (): AnalyticsBaseModel;
    }): Promise<void> {
      const model: AnalyticsBaseModel = new modelType();
      const columns: Statement = new StatementGenerator<AnalyticsBaseModel>({
        modelType,
        database: clickhouse,
      }).toColumnsCreateStatement(model.tableColumns);

      await client.command({
        query: `CREATE TABLE ${database}.${model.tableName} (${columns.query}) ENGINE = MergeTree PARTITION BY (${model.partitionKey}) ORDER BY (${model.sortKeys.join(", ")})`,
        query_params: columns.query_params,
      });
    }

    function paramsOf(route: Route): URLSearchParams {
      const text: string = route.toString();
      const index: number = text.indexOf("?");

      return new URLSearchParams(index === -1 ? "" : text.slice(index + 1));
    }

    // The window the link names, as the explorers read `start` and `end`.
    function windowOf(params: URLSearchParams): InBetween<Date> {
      return new InBetween<Date>(
        new Date(params.get("start")!),
        new Date(params.get("end")!),
      );
    }

    // The logs explorer's list, for the link's filter chips.
    async function logsFound(route: Route): Promise<Array<string>> {
      const params: URLSearchParams = paramsOf(route);
      const tuples: Array<[string, Array<string>]> = JSON.parse(
        params.get("filters") || "[]",
      );
      const query: Query<Log> = LogsPivot.applyLogsFacetFiltersToQuery(
        {
          projectId: PROJECT_ID,
          time: windowOf(params),
        } as Query<Log>,
        new Map<string, Set<string>>(
          tuples.map(
            ([key, values]: [string, Array<string>]): [string, Set<string>] => {
              return [key, new Set<string>(values)];
            },
          ),
        ),
      );

      return (
        await LogService.findBy({
          query,
          select: { _id: true },
          skip: 0,
          limit: 100,
          props: { isRoot: true },
        })
      )
        .map((log: Log): string => {
          return log._id!.toString();
        })
        .sort();
    }

    // The traces explorer's list, for the link's search bar and chips.
    async function spansFound(route: Route): Promise<Array<string>> {
      const params: URLSearchParams = paramsOf(route);
      const chips: Array<[string, string]> = JSON.parse(
        params.get("filters") || "[]",
      );
      const chipValues: Record<string, Array<string>> = {};

      for (const [key, value] of chips) {
        if (key.startsWith("attributes.")) {
          const attribute: string = key.slice("attributes.".length);

          chipValues[attribute] = [...(chipValues[attribute] || []), value];
        }
      }

      const compiled: { queryAttributes: Record<string, unknown> } =
        TracesSearch.compileTraceAttributeFilters({
          chipValues,
          parsed: TracesSearch.parseTraceSearch(params.get("search") || "")
            .attributeFilters,
          legacyContainsChips: {},
          scope: {},
        });

      return (
        await SpanService.findBy({
          query: {
            projectId: PROJECT_ID,
            startTime: windowOf(params),
            attributes: compiled.queryAttributes,
          } as never,
          select: { spanId: true },
          skip: 0,
          limit: 100,
          props: { isRoot: true },
        })
      )
        .map((span: Span): string => {
          return span.spanId!;
        })
        .sort();
    }

    const LOG_IDS: {
      attribute: string;
      attributeInside: string;
      body: string;
      otherAttribute: string;
      otherBody: string;
      tooLate: string;
    } = {
      attribute: ObjectID.generateTimeOrdered().toString(),
      attributeInside: ObjectID.generateTimeOrdered().toString(),
      body: ObjectID.generateTimeOrdered().toString(),
      otherAttribute: ObjectID.generateTimeOrdered().toString(),
      otherBody: ObjectID.generateTimeOrdered().toString(),
      tooLate: ObjectID.generateTimeOrdered().toString(),
    };

    beforeAll(async (): Promise<void> => {
      const url: URL = new URL(endpoint!);

      if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
        throw new Error(
          "TEST_CLICKHOUSE_URL must point at a local, disposable ClickHouse server.",
        );
      }

      // The Dashboard's route helpers read `window` when they load.
      (globalThis as Record<string, unknown>)["window"] = {
        location: { pathname: "/", search: "", hash: "" },
        history: {
          state: null,
          replaceState: (): void => {
            // no-op: nothing navigates.
          },
        },
      };

      for (const storageName of ["sessionStorage", "localStorage"]) {
        Object.defineProperty(globalThis, storageName, {
          value: {
            getItem: (): null => {
              return null;
            },
            setItem: (): void => {
              // no-op
            },
            removeItem: (): void => {
              // no-op
            },
          },
          configurable: true,
          writable: true,
        });
      }

      Links = await import(
        "../../FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventTelemetryLinks"
      );
      LogsPivot = await import(
        "../../FeatureSet/Dashboard/src/Utils/LogsCrossSignalPivot"
      );
      TracesSearch = await import(
        "../../FeatureSet/Dashboard/src/Components/Traces/TracesSearchCompile"
      );

      const options: ClickHouseClientConfigOptions = {
        url: `${url.protocol}//${url.host}`,
        username: decodeURIComponent(url.username) || "default",
        password: decodeURIComponent(url.password),
        database,
        request_timeout: 60000,
      };

      clickhouse = new ClickhouseDatabase(options);
      client = await clickhouse.connect(options);

      await client.command({
        query: `CREATE DATABASE IF NOT EXISTS ${database}`,
      });
      await createTable(Log);
      await createTable(Span as unknown as { new (): AnalyticsBaseModel });

      for (const service of [logService, spanService]) {
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

      await client.insert({
        table: `${database}.${new Log().tableName}`,
        values: [
          // An OpenStack line whose user the parser reads from its attribute.
          logRow({
            id: LOG_IDS.attribute,
            body: '{"event_type": "identity.role_assignment.created"}',
            attributes: { "openstack.user_name": TOKEN },
          }),
          // The same attribute holding the token inside a longer value.
          logRow({
            id: LOG_IDS.attributeInside,
            body: "role granted",
            attributes: { "openstack.user_name": `Default/${TOKEN}` },
          }),
          // An SSH line naming the account in its body.
          logRow({
            id: LOG_IDS.body,
            body: `sshd[2210]: Failed password for ${TOKEN} from 203.0.113.7 port 52314 ssh2`,
          }),
          // Somebody else's.
          logRow({
            id: LOG_IDS.otherAttribute,
            body: "role granted",
            attributes: { "openstack.user_name": OTHER_TOKEN },
          }),
          logRow({
            id: LOG_IDS.otherBody,
            body: `sshd[2210]: Failed password for ${OTHER_TOKEN} from 203.0.113.7`,
          }),
          // The person, but two days after the event: outside its search.
          logRow({
            id: LOG_IDS.tooLate,
            body: `sshd[2210]: Failed password for ${TOKEN} from 203.0.113.7`,
            attributes: { "openstack.user_name": TOKEN },
            minutesFromEvent: 2 * 24 * 60,
          }),
        ],
        format: "JSONEachRow",
        clickhouse_settings: { wait_for_async_insert: 1 },
      });

      await client.insert({
        table: `${database}.${new Span().tableName}`,
        values: [
          spanRow({ spanId: "enduser", attributes: { "enduser.id": TOKEN } }),
          spanRow({ spanId: "user", attributes: { "user.id": TOKEN } }),
          spanRow({
            spanId: "user-inside",
            attributes: { "user.id": `auth0|${TOKEN}` },
          }),
          // An AI call whose user was copied from Langfuse's attribute.
          spanRow({
            spanId: "ai-call",
            attributes: {
              "langfuse.user.id": TOKEN,
              "gen_ai.system": "openai",
            },
          }),
          // Somebody else's, in every one of those attributes.
          spanRow({
            spanId: "other",
            attributes: {
              "enduser.id": OTHER_TOKEN,
              "user.id": OTHER_TOKEN,
              "langfuse.user.id": OTHER_TOKEN,
            },
          }),
          // The person's token in an attribute no search names.
          spanRow({
            spanId: "elsewhere",
            attributes: { "http.request.header.x-user": TOKEN },
          }),
        ],
        format: "JSONEachRow",
        clickhouse_settings: { wait_for_async_insert: 1 },
      });
    });

    afterAll(async (): Promise<void> => {
      for (const [service, original] of originals.entries()) {
        Object.assign(service, original);
      }

      if (client) {
        await client.command({ query: `DROP DATABASE IF EXISTS ${database}` });
      }

      if (clickhouse) {
        await clickhouse.disconnect();
      }
    });

    test("a log line whose user was read from an attribute: the link finds it there, the token whole or inside a longer value", async () => {
      const search: ReturnType<typeof Links.getHashedUserSearch> =
        Links.getHashedUserSearch({
          hashed: TOKEN,
          signal: Links.HashedUserSignal.Log,
          field: "attributes.openstack.user_name",
          time: EVENT_TIME,
        });

      expect(await logsFound(search!.route)).toEqual(
        [LOG_IDS.attribute, LOG_IDS.attributeInside].sort(),
      );
    });

    test("before #11045 the link searched the body alone, and found no line whose attribute held the user", async () => {
      const bodyOnly: ReturnType<typeof Links.getHashedUserSearch> =
        Links.getHashedUserSearch({
          hashed: TOKEN,
          signal: Links.HashedUserSignal.Log,
          time: EVENT_TIME,
        });

      expect(await logsFound(bodyOnly!.route)).toEqual([LOG_IDS.body]);
    });

    test("a log line whose user was read from its body: the link finds the lines whose body holds the token", async () => {
      const search: ReturnType<typeof Links.getHashedUserSearch> =
        Links.getHashedUserSearch({
          hashed: TOKEN,
          signal: Links.HashedUserSignal.Log,
          field: "body",
          time: EVENT_TIME,
        });

      expect(await logsFound(search!.route)).toEqual([LOG_IDS.body]);
    });

    test.each([
      ["a request's user.id", "attributes.user.id", ["user", "user-inside"]],
      ["a request's enduser.id", "attributes.enduser.id", ["enduser"]],
      ["an AI call's user", "attributes.langfuse.user.id", ["ai-call"]],
    ])(
      "a span whose user was read from %s: the link finds it",
      async (_place: string, field: string, expected: Array<string>) => {
        const search: ReturnType<typeof Links.getHashedUserSearch> =
          Links.getHashedUserSearch({
            hashed: TOKEN,
            signal: Links.HashedUserSignal.Trace,
            field,
            time: EVENT_TIME,
          });

        expect(await spansFound(search!.route)).toEqual([...expected].sort());
      },
    );

    test("before #11045 the trace link searched enduser.id alone, and found no span whose user.id held the user", async () => {
      const enduserOnly: ReturnType<typeof Links.getHashedUserSearch> =
        Links.getHashedUserSearch({
          hashed: TOKEN,
          signal: Links.HashedUserSignal.Trace,
          time: EVENT_TIME,
        });

      expect(await spansFound(enduserOnly!.route)).toEqual(["enduser"]);
    });

    test("whichever attribute the event names is the one searched, and only it", async () => {
      const search: ReturnType<typeof Links.getHashedUserSearch> =
        Links.getHashedUserSearch({
          hashed: TOKEN,
          signal: Links.HashedUserSignal.Trace,
          field: "attributes.http.request.header.x-user",
          time: EVENT_TIME,
        });

      expect(await spansFound(search!.route)).toEqual(["elsewhere"]);
    });
  },
);

describe("Hashed user search ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
