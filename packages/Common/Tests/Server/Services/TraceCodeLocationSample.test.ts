import TraceAggregationService, {
  CODE_LOCATION_SAMPLE_TIME_LIMIT_IN_SECONDS,
  CodeLocationSampleRow,
} from "../../../Server/Services/TraceAggregationService";
import SpanService from "../../../Server/Services/SpanService";
import { Results } from "../../../Server/Services/AnalyticsDatabaseService";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * getCodeLocationSample: which operations of some services run which code,
 * from the spans that carry OpenTelemetry's code attributes. A production
 * review asks it for a repository at most every half hour, unattended, so
 * its SQL is held to what keeps it cheap: has() on attributeKeys (the skip
 * index answers it, so a project whose spans carry no code attribute reads
 * almost nothing), a LIMIT on the spans read, the services and the project
 * pinned, retention honoured, and a time limit that stops it with an error.
 */

const projectId: ObjectID = ObjectID.generate();
const serviceId: ObjectID = new ObjectID("6e7f8091-1111-4222-8333-444455556666");
const startTime: Date = new Date("2026-10-22T09:00:00.000Z");
const endTime: Date = new Date("2026-10-22T10:00:00.000Z");

function stubRows(rows: Array<JSONObject>): jest.SpyInstance {
  const fakeResult: Results = {
    json: (): Promise<unknown> => {
      return Promise.resolve({ data: rows });
    },
  } as unknown as Results;

  return jest
    .spyOn(SpanService, "executeQuery")
    .mockResolvedValue(fakeResult as never);
}

describe("TraceAggregationService.getCodeLocationSample", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("reads only spans that carry a code attribute, of the services, in the project and window", () => {
    const statement: Statement =
      TraceAggregationService.buildCodeLocationSampleStatement({
        projectId,
        startTime,
        endTime,
        serviceIds: [serviceId],
        sampleSize: 20000,
        limit: 500,
      });

    const sql: string = statement.query.replace(/\s+/g, " ");
    const params: string = JSON.stringify(statement.query_params);

    expect(sql).toContain("has(attributeKeys,");
    expect(sql).not.toContain("mapContains");
    expect(params).toContain("code.filepath");
    expect(params).toContain("code.file.path");
    expect(params).toContain("code.function");
    expect(params).toContain("code.function.name");
    expect(sql).toContain("projectId =");
    expect(sql).toContain("startTime >=");
    expect(sql).toContain("startTime <=");
    expect(sql).toContain("AND primaryEntityId IN (");
    expect(params).toContain(serviceId.toString());
    expect(sql).toContain("retentionDate >= now()");
    expect(sql).toContain(
      "GROUP BY serviceId, name, f1, f2, fn1, fn2 ORDER BY cnt DESC LIMIT",
    );
    expect(params).toContain("20000");
  });

  test("stops with an error at its time limit, never with part of the groups", () => {
    const sql: string = TraceAggregationService.buildCodeLocationSampleStatement(
      {
        projectId,
        startTime,
        endTime,
        serviceIds: [serviceId],
        sampleSize: 20000,
        limit: 500,
      },
    ).query;

    expect(sql).toContain(
      `max_execution_time = ${CODE_LOCATION_SAMPLE_TIME_LIMIT_IN_SECONDS}`,
    );
    expect(sql).toContain("timeout_overflow_mode = 'throw'");
    expect(sql).not.toContain("'break'");
  });

  test("answers each group with the older or newer attribute, and drops rows that name no code", async () => {
    stubRows([
      {
        serviceId: serviceId.toString().toUpperCase(),
        name: "POST /charge",
        f1: "/app/src/billing/charge.ts",
        f2: "",
        fn1: "",
        fn2: "chargeCard",
        cnt: "40",
      },
      {
        serviceId: serviceId.toString(),
        name: "GET /health",
        f1: "",
        f2: "",
        fn1: "",
        fn2: "",
        cnt: 3,
      },
      { serviceId: "", name: "x", f1: "/a.ts", cnt: 1 },
    ]);

    const rows: Array<CodeLocationSampleRow> =
      await TraceAggregationService.getCodeLocationSample({
        projectId,
        startTime,
        endTime,
        serviceIds: [serviceId],
        sampleSize: 20000,
        limit: 500,
      });

    expect(rows).toEqual([
      {
        serviceId: serviceId.toString(),
        name: "POST /charge",
        filePath: "/app/src/billing/charge.ts",
        functionName: "chargeCard",
        count: 40,
      },
    ]);
  });

  test("no services, no read", async () => {
    const spy: jest.SpyInstance = stubRows([]);

    expect(
      await TraceAggregationService.getCodeLocationSample({
        projectId,
        startTime,
        endTime,
        serviceIds: [],
        sampleSize: 20000,
        limit: 500,
      }),
    ).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });
});
