import TraceAggregationService, {
  SERVED_SPAN_SAMPLE_TIME_LIMIT_IN_SECONDS,
} from "../../../Server/Services/TraceAggregationService";
import SpanService from "../../../Server/Services/SpanService";
import { Results } from "../../../Server/Services/AnalyticsDatabaseService";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { MetricServedSpansReading } from "../../../Utils/Metrics/MetricInsight";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * getServedSpanSample: what a service's requests are, from a sample of its
 * entry spans - Metrics AI's Missing Request Metrics, which names the
 * request metric for what a service serves. Metrics AI asks it unattended,
 * for a few services an hour, so its SQL is held to what keeps it small:
 * only the service's SERVER and CONSUMER spans of the window, in the
 * project, past their retention left out, at most the sample's size of
 * them (the LIMIT inside, with no ORDER BY, so ClickHouse stops once it has
 * them), has() on the attribute keys of the spans kept, and a time limit
 * that stops it with an error rather than with part of a sample.
 */

const projectId: ObjectID = new ObjectID(
  "5231bbbb-0000-4000-8000-000000000001",
);
const serviceId: ObjectID = new ObjectID(
  "5231bbbb-0000-4000-8000-000000000002",
);
const startTime: Date = new Date("2026-11-03T08:00:00.000Z");
const endTime: Date = new Date("2026-11-03T09:00:00.000Z");

function build(): Statement {
  return TraceAggregationService.buildServedSpanSampleStatement({
    projectId,
    startTime,
    endTime,
    serviceId,
    sampleSize: 1000,
  });
}

function stubRows(
  rows: Array<JSONObject>,
): SpyInstance<typeof SpanService.executeQuery> {
  const fakeResult: Results = {
    json: (): Promise<unknown> => {
      return Promise.resolve({ data: rows });
    },
  } as unknown as Results;

  return jest
    .spyOn(SpanService, "executeQuery")
    .mockResolvedValue(fakeResult as never);
}

describe("TraceAggregationService.getServedSpanSample", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("counts each kind of request by its span kind and an attribute key, new name or old", () => {
    const sql: string = build().query.replace(/\s+/g, " ");
    const params: string = JSON.stringify(build().query_params);

    expect(sql).toContain("SELECT count() AS sampled");
    expect(sql).toContain(
      "countIf(kind = 'SPAN_KIND_SERVER' AND (has(attributeKeys, {p0:String}) OR has(attributeKeys, {p1:String}))) AS http_server",
    );
    expect(sql).toContain(
      "countIf(kind = 'SPAN_KIND_SERVER' AND (has(attributeKeys, {p2:String}) OR has(attributeKeys, {p3:String}))) AS rpc_server",
    );
    expect(sql).toContain(
      "countIf(kind = 'SPAN_KIND_CONSUMER' AND (has(attributeKeys, {p4:String}))) AS messaging_consumer",
    );

    for (const key of [
      "http.request.method",
      "http.method",
      "rpc.system.name",
      "rpc.system",
      "messaging.system",
    ]) {
      expect(params).toContain(`"${key}"`);
    }

    // The keys, never the map: attributes is the heaviest column.
    expect(sql).not.toContain("mapContains");
    expect(sql).not.toContain("attributes[");
  });

  test("reads only the service's entry spans of the window, in the project, within retention", () => {
    const statement: Statement = build();
    const sql: string = statement.query.replace(/\s+/g, " ");
    const params: string = JSON.stringify(statement.query_params);

    // The span table, named as a parameter the code fills in.
    expect(sql).toContain(
      "FROM (SELECT kind, attributeKeys FROM {p5:Identifier} WHERE projectId =",
    );
    expect(params).toContain('"SpanItemV3"');
    expect(sql).toContain("AND startTime >=");
    expect(sql).toContain("AND startTime <");
    expect(sql).toContain(
      "AND kind IN ('SPAN_KIND_SERVER', 'SPAN_KIND_CONSUMER')",
    );
    expect(sql).toContain("AND primaryEntityId IN (");
    expect(params).toContain(projectId.toString());
    expect(params).toContain(serviceId.toString());
    expect(sql).toContain("retentionDate >= now()");
  });

  test("reads at most the sample's size, with no ORDER BY, so ClickHouse stops once it has it", () => {
    const statement: Statement = build();
    const sql: string = statement.query.replace(/\s+/g, " ");

    expect(sql).toContain("LIMIT {p");
    expect(JSON.stringify(statement.query_params)).toContain("1000");
    expect(sql).not.toContain("ORDER BY");
    expect(sql).not.toContain("GROUP BY");
    // The LIMIT closes the inner read: the counts are over the sample.
    expect(sql.indexOf("LIMIT")).toBeLessThan(sql.lastIndexOf(")"));
  });

  test("stops with an error at its time limit, in small blocks on few threads", () => {
    const sql: string = build().query;

    expect(sql).toContain(
      `max_execution_time = ${SERVED_SPAN_SAMPLE_TIME_LIMIT_IN_SECONDS}`,
    );
    expect(SERVED_SPAN_SAMPLE_TIME_LIMIT_IN_SECONDS).toBe(20);
    expect(sql).toContain("timeout_overflow_mode = 'throw'");
    expect(sql).not.toContain("'break'");
    expect(sql).toContain("max_threads =");
    expect(sql).toContain("max_block_size =");
  });

  test("answers the counts as Metrics AI's gate reads them", async () => {
    stubRows([
      {
        sampled: "1000",
        http_server: 940,
        rpc_server: "0",
        messaging_consumer: 60,
      },
    ]);

    const reading: MetricServedSpansReading =
      await TraceAggregationService.getServedSpanSample({
        projectId,
        startTime,
        endTime,
        serviceId,
        sampleSize: 1000,
      });

    expect(reading).toEqual({
      sampledSpanCount: 1000,
      httpServerSpanCount: 940,
      rpcServerSpanCount: 0,
      messagingConsumerSpanCount: 60,
    });
  });

  test("no row, or counts that are not counts, read as none", async () => {
    stubRows([]);

    expect(
      await TraceAggregationService.getServedSpanSample({
        projectId,
        startTime,
        endTime,
        serviceId,
        sampleSize: 1000,
      }),
    ).toEqual({
      sampledSpanCount: 0,
      httpServerSpanCount: 0,
      rpcServerSpanCount: 0,
      messagingConsumerSpanCount: 0,
    });

    expect(
      TraceAggregationService.toServedSpanSample({
        sampled: "x",
        http_server: -4,
        rpc_server: null,
      } as unknown as JSONObject),
    ).toEqual({
      sampledSpanCount: 0,
      httpServerSpanCount: 0,
      rpcServerSpanCount: 0,
      messagingConsumerSpanCount: 0,
    });
  });

  test("a read that fails says so: it never answers with none", async () => {
    jest
      .spyOn(SpanService, "executeQuery")
      .mockRejectedValue(new Error("Timeout exceeded") as never);

    await expect(
      TraceAggregationService.getServedSpanSample({
        projectId,
        startTime,
        endTime,
        serviceId,
        sampleSize: 1000,
      }),
    ).rejects.toThrow("Timeout exceeded");
  });
});
