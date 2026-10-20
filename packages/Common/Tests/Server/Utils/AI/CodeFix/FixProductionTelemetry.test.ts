import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import LogService from "../../../../../Server/Services/LogService";
import SpanService from "../../../../../Server/Services/SpanService";
import TraceAggregationService from "../../../../../Server/Services/TraceAggregationService";
import FixProductionTelemetry, {
  ARRIVAL_KINDS_BY_SIGNAL,
  FIX_TELEMETRY_READ_SECONDS,
  FixTelemetryWindow,
  SERVICE_VERSION_ATTRIBUTE,
} from "../../../../../Server/Utils/AI/CodeFix/FixProductionTelemetry";
import { TelemetryArrivalKind } from "../../../../../Server/Utils/AI/CodeFix/TelemetryFixVerdict";
import { Statement } from "../../../../../Server/Utils/AnalyticsDatabase/Statement";
import { TelemetryFixSignal } from "../../../../../Types/AI/FixProductionBaseline";
import AnalyticsTableName from "../../../../../Types/AnalyticsDatabase/AnalyticsTableName";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";

/*
 * What the production checks read of spans and logs. Every read is pinned
 * to its project and window, to the service when there is one and to the
 * version only when asked, and stops at its time limit with an error -
 * never with half an answer that looks whole.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "7a1d0f50-0000-4000-8000-000000000001",
);
const SERVICE_ID: ObjectID = new ObjectID(
  "7a1d0f50-0000-4000-8000-000000000002",
);
const FROM: Date = new Date("2026-10-03T10:00:00.000Z");
const TO: Date = new Date("2026-10-10T10:00:00.000Z");

const WINDOW: FixTelemetryWindow = {
  projectId: PROJECT_ID,
  serviceId: SERVICE_ID,
  from: FROM,
  to: TO,
};

const SPANS: { name: string; timeColumn: string } = {
  name: AnalyticsTableName.Span,
  timeColumn: "startTime",
};

const LOGS: { name: string; timeColumn: string } = {
  name: AnalyticsTableName.Log,
  timeColumn: "time",
};

// The statement's values, as ClickHouse is sent them.
function valuesOf(statement: Statement): Array<unknown> {
  return Object.values(statement.query_params);
}

function answer(rows: Array<JSONObject>): never {
  return {
    json: () => {
      return Promise.resolve({ data: rows });
    },
  } as never;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the statements", () => {
  test("a count reads one service's window of one table, within retention, and stops with an error", () => {
    const statement: Statement = FixProductionTelemetry.buildCountStatement(
      SPANS,
      WINDOW,
    );

    expect(statement.query).toContain("SELECT count() AS cnt FROM");
    expect(statement.query).toContain("WHERE projectId =");
    expect(statement.query).toContain("AND startTime >=");
    expect(statement.query).toContain("AND startTime <=");
    expect(statement.query).toContain("AND retentionDate >= now()");
    expect(statement.query).toContain("AND primaryEntityId IN (");
    expect(statement.query).toContain(
      `max_execution_time = ${FIX_TELEMETRY_READ_SECONDS}`,
    );
    expect(statement.query).toContain("timeout_overflow_mode = 'throw'");
    expect(valuesOf(statement)).toContain(AnalyticsTableName.Span);
    expect(JSON.stringify(valuesOf(statement))).toContain(
      PROJECT_ID.toString(),
    );
    expect(JSON.stringify(valuesOf(statement))).toContain(
      SERVICE_ID.toString(),
    );
  });

  test("logs are read by their own time column", () => {
    const statement: Statement = FixProductionTelemetry.buildCountStatement(
      LOGS,
      WINDOW,
    );

    expect(statement.query).toContain("AND time >=");
    expect(statement.query).not.toContain("startTime");
    expect(valuesOf(statement)).toContain(AnalyticsTableName.Log);
  });

  test("without a service, the whole project is read", () => {
    const statement: Statement = FixProductionTelemetry.buildCountStatement(
      SPANS,
      { projectId: PROJECT_ID, from: FROM, to: TO },
    );

    expect(statement.query).not.toContain("primaryEntityId");
  });

  test("a version is read through the service's version attribute, and only when asked", () => {
    const statement: Statement = FixProductionTelemetry.buildCountStatement(
      SPANS,
      { ...WINDOW, version: "2.3.2" },
    );

    expect(valuesOf(statement)).toContain(SERVICE_VERSION_ATTRIBUTE);
    expect(valuesOf(statement)).toContain("2.3.2");
    expect(SERVICE_VERSION_ATTRIBUTE).toBe("resource.service.version");
    expect(
      valuesOf(FixProductionTelemetry.buildCountStatement(SPANS, WINDOW)),
    ).not.toContain(SERVICE_VERSION_ATTRIBUTE);
  });

  test("whether a version is reported reads one row at most", () => {
    const statement: Statement = FixProductionTelemetry.buildExistsStatement(
      LOGS,
      { ...WINDOW, version: "2.3.2" },
    );

    expect(statement.query).toContain(
      "SELECT count() AS cnt FROM (SELECT 1 FROM",
    );
    expect(statement.query).toContain("LIMIT 1)");
  });

  test("attribute keys are looked for where the key index can skip what has none", () => {
    const statement: Statement = FixProductionTelemetry.buildTextsStatement(
      TelemetryArrivalKind.SpanAttribute,
      WINDOW,
      ["order.id", "checkout.pay"],
    );

    expect(statement.query).toContain(
      "arrayJoin(arrayIntersect(attributeKeys,",
    );
    expect(statement.query).toContain("AND hasAny(attributeKeys,");
    expect(statement.query).toContain("GROUP BY text LIMIT");
    expect(JSON.stringify(valuesOf(statement))).toContain("order.id");
    expect(valuesOf(statement)).toContain(AnalyticsTableName.Span);
  });

  test("a log's attribute keys are read from the logs", () => {
    expect(
      valuesOf(
        FixProductionTelemetry.buildTextsStatement(
          TelemetryArrivalKind.LogAttribute,
          WINDOW,
          ["orderId"],
        ),
      ),
    ).toContain(AnalyticsTableName.Log);
  });

  test("span names and log bodies are matched whole", () => {
    const names: Statement = FixProductionTelemetry.buildTextsStatement(
      TelemetryArrivalKind.SpanName,
      WINDOW,
      ["checkout.pay"],
    );
    const bodies: Statement = FixProductionTelemetry.buildTextsStatement(
      TelemetryArrivalKind.LogBody,
      WINDOW,
      ["Payment captured"],
    );

    expect(names.query).toContain(" IN (");
    expect(valuesOf(names)).toContain("name");
    expect(valuesOf(names)).toContain(AnalyticsTableName.Span);
    expect(valuesOf(bodies)).toContain("body");
    expect(valuesOf(bodies)).toContain(AnalyticsTableName.Log);
    expect(bodies.query).not.toContain("ILIKE");
  });

  test("each signal is looked for where it is sent", () => {
    expect(ARRIVAL_KINDS_BY_SIGNAL).toEqual({
      [TelemetryFixSignal.Spans]: [
        TelemetryArrivalKind.SpanName,
        TelemetryArrivalKind.SpanAttribute,
      ],
      [TelemetryFixSignal.Logs]: [
        TelemetryArrivalKind.LogAttribute,
        TelemetryArrivalKind.LogBody,
      ],
    });
  });
});

describe("the reads", () => {
  let spanRows: (statement: Statement) => Array<JSONObject>;
  let logRows: (statement: Statement) => Array<JSONObject>;

  beforeEach(() => {
    spanRows = (): Array<JSONObject> => {
      return [];
    };
    logRows = (): Array<JSONObject> => {
      return [];
    };
    jest.spyOn(SpanService, "executeQuery").mockImplementation((async (
      statement: Statement,
    ) => {
      return answer(spanRows(statement));
    }) as never);
    jest.spyOn(LogService, "executeQuery").mockImplementation((async (
      statement: Statement,
    ) => {
      return answer(logRows(statement));
    }) as never);
  });

  test("texts found as more than one thing are listed once, in the fix's order", async () => {
    spanRows = (statement: Statement): Array<JSONObject> => {
      return valuesOf(statement).includes("name")
        ? [{ text: "order.id" }]
        : [{ text: "checkout.pay" }, { text: "order.id" }];
    };

    expect(
      await FixProductionTelemetry.findTexts(
        WINDOW,
        [TelemetryArrivalKind.SpanName, TelemetryArrivalKind.SpanAttribute],
        ["checkout.pay", "order.id", "never.sent"],
      ),
    ).toEqual([
      { text: "checkout.pay", kind: TelemetryArrivalKind.SpanAttribute },
      { text: "order.id", kind: TelemetryArrivalKind.SpanName },
    ]);
  });

  test("nothing to look for reads nothing", async () => {
    expect(
      await FixProductionTelemetry.findTexts(
        WINDOW,
        [TelemetryArrivalKind.SpanName],
        [],
      ),
    ).toEqual([]);
    expect(SpanService.executeQuery).not.toHaveBeenCalled();
  });

  test("only the signals asked for are counted", async () => {
    spanRows = (): Array<JSONObject> => {
      return [{ cnt: "52000" }];
    };
    logRows = (): Array<JSONObject> => {
      return [{ cnt: 900 }];
    };

    expect(
      await FixProductionTelemetry.countSignals(WINDOW, [
        TelemetryFixSignal.Spans,
      ]),
    ).toEqual({ spans: 52000, logs: 0 });
    expect(LogService.executeQuery).not.toHaveBeenCalled();
    expect(
      await FixProductionTelemetry.countSignals(WINDOW, [
        TelemetryFixSignal.Spans,
        TelemetryFixSignal.Logs,
      ]),
    ).toEqual({ spans: 52000, logs: 900 });
  });

  test("a version is reported when the spans, or else the logs, name it", async () => {
    const version: FixTelemetryWindow & {
      serviceId: ObjectID;
      version: string;
    } = { ...WINDOW, serviceId: SERVICE_ID, version: "2.3.2" };

    expect(await FixProductionTelemetry.reportsVersion(version)).toBe(false);

    logRows = (): Array<JSONObject> => {
      return [{ cnt: 1 }];
    };
    expect(await FixProductionTelemetry.reportsVersion(version)).toBe(true);

    (LogService.executeQuery as jest.Mock).mockClear();
    spanRows = (): Array<JSONObject> => {
      return [{ cnt: 1 }];
    };
    expect(await FixProductionTelemetry.reportsVersion(version)).toBe(true);
    expect(LogService.executeQuery).not.toHaveBeenCalled();
  });

  test("a read that runs out of time fails the check, rather than answer with part", async () => {
    (SpanService.executeQuery as jest.Mock).mockRejectedValue(
      new Error("Timeout exceeded: elapsed 30 seconds") as never,
    );

    await expect(
      FixProductionTelemetry.countSignals(WINDOW, [TelemetryFixSignal.Spans]),
    ).rejects.toThrow("Timeout exceeded");
  });

  test("an operation's p99 is read through the trace analytics table, by name, service and version", async () => {
    const table: SpyInstance<typeof TraceAggregationService.getAnalyticsTable> =
      jest
        .spyOn(TraceAggregationService, "getAnalyticsTable")
        .mockResolvedValue([
          {
            groupValues: {},
            count: 1204,
            errorCount: 0,
            avgDurationMs: 90,
            p50DurationMs: 80,
            p90DurationMs: 200,
            p95DurationMs: 250,
            p99DurationMs: 310,
            minDurationMs: 1,
            maxDurationMs: 900,
          },
        ]);

    expect(
      await FixProductionTelemetry.measureLatency({
        ...WINDOW,
        serviceId: SERVICE_ID,
        spanName: "GET /orders",
        version: "2.3.2",
      }),
    ).toEqual({ spanCount: 1204, p99Ms: 310 });
    expect(table).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      startTime: FROM,
      endTime: TO,
      bucketSizeInMinutes: 7 * 24 * 60,
      chartType: "table",
      metric: "p99Duration",
      groupBy: ["primaryEntityId"],
      serviceIds: [SERVICE_ID],
      spanNames: ["GET /orders"],
      attributes: { [SERVICE_VERSION_ATTRIBUTE]: "2.3.2" },
      limit: 1,
    });

    table.mockResolvedValue([]);

    expect(
      await FixProductionTelemetry.measureLatency({
        ...WINDOW,
        serviceId: SERVICE_ID,
      }),
    ).toEqual({ spanCount: 0, p99Ms: 0 });
    expect(table.mock.calls[1]![0]).not.toHaveProperty("spanNames");
    expect(table.mock.calls[1]![0]).not.toHaveProperty("attributes");
  });
});
