import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import Span from "Common/Models/AnalyticsModels/Span";
import ProfileSample from "Common/Models/AnalyticsModels/ProfileSample";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
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
 * A trace's Profile tab against a real ClickHouse server.
 *
 * A profile sample's trace link is whatever span context the eBPF
 * profiler found for its thread, and OBI v0.14.0 publishes context for
 * threads of processes it does not instrument. An uninstrumented caller
 * of an instrumented service keeps the context of its last call, under a
 * span of its own that is never exported, so its later CPU carries a real
 * trace id. The trace-wide reads (the tab's gate, its flame graph, the
 * function list) therefore keep a sample only when its span is one of the
 * trace's stored spans. ProfileAggregationService.test.ts pins the SQL as a
 * string; this suite shows what it counts:
 *
 *   1. a trace-wide count leaves out the caller's samples and those of a
 *      span that was never stored, and stays inside its project;
 *   2. a span-scoped read is unchanged;
 *   3. the flame graph and the function list draw the same samples the
 *      gate counts;
 *   4. a read without a trace is untouched.
 *
 * The tables are the models' own columns under a plain MergeTree named
 * like the Distributed tables the reads use. The span subquery is GLOBAL IN
 * because production's tables are Distributed and shard on different keys;
 * on one server GLOBAL IN and IN agree, so the unit suite pins GLOBAL IN.
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server:
 *
 *   docker run -d --rm -p 18124:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18124 \
 *     npx jest Tests/Telemetry/ProfileTraceSpansClickhouse.test.ts
 *
 * The App Test workflow provides the server; the guard at the bottom fails
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

import ProfileAggregationService, {
  FlamegraphResult,
  FunctionListResult,
  FunctionListItem,
  ProfileFlamegraphNode,
} from "Common/Server/Services/ProfileAggregationService";
import ProfileSampleService from "Common/Server/Services/ProfileSampleService";

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(120000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `profile_trace_spans_test_${process.pid}_${Date.now()}`;

const projectId: ObjectID = new ObjectID(
  "e1000000-0000-4000-8000-000000000001",
);
// Another project that stored the caller's span id under the same trace id.
const otherProjectId: ObjectID = new ObjectID(
  "e2000000-0000-4000-8000-000000000002",
);

const traceId: string = "0af7651916cd43dd8448eb211c80319c";
const otherTraceId: string = "4bf92f3577b34da6a3ce929d0e0e4736";

// The app's server span; its parent is the caller's span.
const appServerSpan: string = "b7ad6b7169203331";
const appHandlerSpan: string = "00f067aa0ba902b7";
// The uninstrumented caller's own span: in the trace, never exported.
const callerSpan: string = "53995c3f42cd8ad8";
// A database server span the collector drops before storage.
const droppedSpan: string = "e457b5a2e4d86bd1";
const otherTraceSpan: string = "1111111111111111";

const sampleTime: Date = OneUptimeDate.addRemoveHours(new Date(), -1);

const retentionDate: string = OneUptimeDate.toClickhouseDateTime(
  OneUptimeDate.addRemoveDays(new Date(), 30),
).substring(0, 10);

function spanRow(data: {
  project: ObjectID;
  trace: string;
  span: string;
  parent: string;
}): JSONObject {
  return {
    projectId: data.project.toString(),
    startTime: OneUptimeDate.toClickhouseDateTime64(sampleTime),
    endTime: OneUptimeDate.toClickhouseDateTime64(sampleTime),
    traceId: data.trace,
    spanId: data.span,
    parentSpanId: data.parent,
    retentionDate: retentionDate,
  };
}

const SPANS: Array<JSONObject> = [
  spanRow({
    project: projectId,
    trace: traceId,
    span: appServerSpan,
    parent: callerSpan,
  }),
  spanRow({
    project: projectId,
    trace: traceId,
    span: appHandlerSpan,
    parent: appServerSpan,
  }),
  spanRow({
    project: projectId,
    trace: otherTraceId,
    span: otherTraceSpan,
    parent: "",
  }),
  spanRow({
    project: otherProjectId,
    trace: traceId,
    span: callerSpan,
    parent: "",
  }),
];

interface SampleFixture {
  trace: string;
  span: string;
  // Leaf first, as stored.
  stack: Array<string>;
  count: number;
}

const SAMPLES: Array<SampleFixture> = [
  {
    trace: traceId,
    span: appHandlerSpan,
    stack: ["handleOrder@app.js:10", "main@app.js:1"],
    count: 3,
  },
  {
    trace: traceId,
    span: appServerSpan,
    stack: ["serve@app.js:5", "main@app.js:1"],
    count: 1,
  },
  {
    trace: traceId,
    span: callerSpan,
    stack: ["burnCallerCpu@client.js:7", "run@client.js:1"],
    count: 5,
  },
  {
    trace: traceId,
    span: droppedSpan,
    stack: ["exec_simple_query@postgres:0", "PostgresMain@postgres:0"],
    count: 2,
  },
  {
    trace: otherTraceId,
    span: otherTraceSpan,
    stack: ["otherWork@app.js:20", "main@app.js:1"],
    count: 4,
  },
];

function sampleRows(): Array<JSONObject> {
  const rows: Array<JSONObject> = [];

  for (const sample of SAMPLES) {
    for (let index: number = 0; index < sample.count; index++) {
      rows.push({
        projectId: projectId.toString(),
        profileId: "profile-1",
        traceId: sample.trace,
        spanId: sample.span,
        time: OneUptimeDate.toClickhouseDateTime64(sampleTime),
        stacktrace: sample.stack,
        stacktraceHash: sample.stack.join(";"),
        frameTypes: sample.stack.map((): string => {
          return "native";
        }),
        value: 1,
        profileType: "samples",
        retentionDate: retentionDate,
      });
    }
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

function functionNames(node: ProfileFlamegraphNode): Array<string> {
  const names: Array<string> = [];

  for (const child of node.children) {
    names.push(child.functionName, ...functionNames(child));
  }

  return names;
}

interface ServiceConnection {
  database: ClickhouseDatabase;
  databaseClient: ClickhouseClient | null;
}

integration("A trace's Profile tab against ClickHouse", () => {
  let clickhouse: ClickhouseDatabase;
  let client: ClickhouseClient;
  let original: ServiceConnection | undefined;

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

    await createTable(client, clickhouse, Span);
    await createTable(client, clickhouse, ProfileSample);

    original = {
      database: ProfileSampleService.database,
      databaseClient: ProfileSampleService.databaseClient,
    };

    ProfileSampleService.database = clickhouse;
    ProfileSampleService.databaseClient = client;

    await client.insert({
      table: `${database}.${new Span().tableName}`,
      values: SPANS,
      format: "JSONEachRow",
    });
    await client.insert({
      table: `${database}.${new ProfileSample().tableName}`,
      values: sampleRows(),
      format: "JSONEachRow",
    });
  });

  afterAll(async (): Promise<void> => {
    if (original) {
      Object.assign(ProfileSampleService, original);
    }

    if (client) {
      await client.command({ query: `DROP DATABASE IF EXISTS ${database}` });
    }

    if (clickhouse) {
      await clickhouse.disconnect();
    }
  });

  test("the fixture links 11 samples to the trace, 7 of them to spans it does not have", async () => {
    const result: {
      json: () => Promise<{ data?: Array<{ total?: string | number }> }>;
    } = (await client.query({
      query: `SELECT count() AS total FROM ${database}.${new ProfileSample().tableName} WHERE traceId = {traceId:String}`,
      query_params: { traceId: traceId },
      format: "JSON",
    })) as unknown as {
      json: () => Promise<{ data?: Array<{ total?: string | number }> }>;
    };
    const response: { data?: Array<{ total?: string | number }> } =
      await result.json();

    expect(Number(response.data?.[0]?.total)).toBe(11);
  });

  test("the tab's gate counts only the samples on the trace's own spans", async () => {
    const presence: { sampleCount: number } =
      await ProfileAggregationService.getTracePresence({
        projectId: projectId,
        traceId: traceId,
      });

    /*
     * The handler's 3 and the server span's 1. Not the caller's 5: its span
     * id is stored on this trace id only by another project. Not the
     * dropped span's 2.
     */
    expect(presence.sampleCount).toBe(4);
  });

  test("a span-scoped count is what it was", async () => {
    const serverOnly: { sampleCount: number } =
      await ProfileAggregationService.getTracePresence({
        projectId: projectId,
        traceId: traceId,
        spanIds: [appServerSpan],
      });
    const caller: { sampleCount: number } =
      await ProfileAggregationService.getTracePresence({
        projectId: projectId,
        traceId: traceId,
        spanIds: [callerSpan],
      });

    expect(serverOnly.sampleCount).toBe(1);
    expect(caller.sampleCount).toBe(5);
  });

  test("the flame graph draws the samples the gate counts", async () => {
    const result: FlamegraphResult =
      await ProfileAggregationService.getFlamegraph({
        projectId: projectId,
        traceId: traceId,
      });

    expect(result.flamegraph.totalValue).toBe(4);
    expect(functionNames(result.flamegraph).sort()).toEqual([
      "handleOrder",
      "main",
      "serve",
    ]);
  });

  test("the function list draws them too", async () => {
    const result: FunctionListResult =
      await ProfileAggregationService.getFunctionList({
        projectId: projectId,
        traceId: traceId,
      });

    expect(result.windowTotal).toBe(4);
    expect(
      result.functions
        .map((item: FunctionListItem): string => {
          return item.functionName;
        })
        .sort(),
    ).toEqual(["handleOrder", "main", "serve"]);
  });

  test("a read without a trace is untouched", async () => {
    const result: FlamegraphResult =
      await ProfileAggregationService.getFlamegraph({
        projectId: projectId,
      });

    expect(result.flamegraph.totalValue).toBe(15);
  });
});

describe("Profile trace spans ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
