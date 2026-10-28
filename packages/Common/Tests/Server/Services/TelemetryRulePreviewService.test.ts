import LogService from "../../../Server/Services/LogService";
import SpanService from "../../../Server/Services/SpanService";
import ExceptionInstanceService from "../../../Server/Services/ExceptionInstanceService";
import TelemetryExceptionService from "../../../Server/Services/TelemetryExceptionService";
import TelemetryRulePreviewService from "../../../Server/Services/TelemetryRulePreviewService";
import { Results } from "../../../Server/Services/AnalyticsDatabaseService";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import { TelemetryReadScope } from "../../../Server/Utils/Telemetry/TelemetryReadScope";
import { SpanStatus } from "../../../Models/AnalyticsModels/Span";
import { JSONObject } from "../../../Types/JSON";
import LogSeverity from "../../../Types/Log/LogSeverity";
import { MonitorStepExceptionMonitorUtil } from "../../../Types/Monitor/MonitorStepExceptionMonitor";
import { MonitorStepLogMonitorUtil } from "../../../Types/Monitor/MonitorStepLogMonitor";
import { MonitorStepTraceMonitorUtil } from "../../../Types/Monitor/MonitorStepTraceMonitor";
import { TelemetryRulePreviewAnswer } from "../../../Types/Monitor/TelemetryRulePreview";
import ObjectID from "../../../Types/ObjectID";
import BadDataException from "../../../Types/Exception/BadDataException";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * The counts a telemetry rule's preview draws come from the monitor's own
 * query (the one its check runs), with the preview's range in place of the
 * check's window, narrowed to what the reader may read, and counted per
 * window in one ClickHouse read that stops at the interactive time limit.
 * The statements are captured here instead of run.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0b000000-0000-4000-8000-000000000001",
);
const SERVICE_A: string = "0b000000-0000-4000-8000-0000000000a1";
const SERVICE_B: string = "0b000000-0000-4000-8000-0000000000b1";
const NOW: Date = new Date("2026-10-27T12:07:31.000Z");

const PROJECT_WIDE: TelemetryReadScope = { readableIds: null, blockedIds: [] };
const ONLY_SERVICE_A: TelemetryReadScope = {
  readableIds: [SERVICE_A],
  blockedIds: [],
};

function captureStatements(
  service: { executeQuery: (statement: Statement) => Promise<Results> },
  rows: Array<JSONObject>,
): Array<Statement> {
  const captured: Array<Statement> = [];

  jest.spyOn(service as never, "executeQuery").mockImplementation(((
    statement: Statement,
  ): Promise<Results> => {
    captured.push(statement);

    return Promise.resolve({
      json: (): Promise<unknown> => {
        return Promise.resolve({ data: rows });
      },
    } as unknown as Results);
  }) as never);

  return captured;
}

// The statement with its parameters written in.
function inline(statement: Statement): string {
  let text: string = statement.query;
  const params: Record<string, unknown> = statement.query_params as Record<
    string,
    unknown
  >;

  for (const key of Object.keys(params).sort((a: string, b: string) => {
    return b.length - a.length;
  })) {
    const value: unknown = params[key];
    const written: string = Array.isArray(value)
      ? `[${value.map(String).join(",")}]`
      : String(value);

    text = text
      .split(`{${key}:Identifier}`)
      .join(`\`${written}\``)
      .split(`{${key}:`)
      .map((part: string, index: number): string => {
        if (index === 0) {
          return part;
        }

        return written + part.slice(part.indexOf("}") + 1);
      })
      .join("");
  }

  return text.replace(/\s+/g, " ");
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("A Logs rule's preview", () => {
  test("counts the monitor's logs per window of its length, over the preview's range", async () => {
    const captured: Array<Statement> = captureStatements(LogService as never, [
      { windowStart: "2026-10-27 11:55:00", windowCount: "17" },
      { windowStart: "2026-10-27 12:00:00", windowCount: 4 },
    ]);

    const answer: TelemetryRulePreviewAnswer =
      await TelemetryRulePreviewService.previewLogs({
        projectId: PROJECT_ID,
        logMonitor: {
          ...MonitorStepLogMonitorUtil.getDefault(),
          body: "payment declined",
          severityTexts: [LogSeverity.Error, LogSeverity.Fatal],
          telemetryServiceIds: [new ObjectID(SERVICE_A)],
          lastXSecondsOfLogs: 300,
        },
        scope: PROJECT_WIDE,
        now: NOW,
      });

    expect(answer.windowInSeconds).toBe(300);
    expect(answer.startTime).toBe("2026-10-27T00:05:00.000Z");
    expect(answer.endTime).toBe("2026-10-27T12:05:00.000Z");
    expect(answer.buckets).toEqual([
      { time: "2026-10-27T11:55:00.000Z", value: 17 },
      { time: "2026-10-27T12:00:00.000Z", value: 4 },
    ]);

    expect(captured).toHaveLength(1);
    const sql: string = inline(captured[0]!);

    expect(sql).toContain("toStartOfInterval(`time`, INTERVAL 300 SECOND)");
    expect(sql).toContain("count() AS windowCount");
    expect(sql).toContain("GROUP BY windowStart ORDER BY windowStart ASC");
    expect(sql).toContain(PROJECT_ID.toString());
    expect(sql).toContain(SERVICE_A);
    expect(sql).toContain("payment declined");
    expect(sql).toContain("Error");
    expect(sql).toContain("Fatal");
    // The read stops with an error at the time limit: never a partial count.
    expect(sql).toContain("max_execution_time = 45");
    expect(sql).toContain("timeout_overflow_mode = 'throw'");
    expect(sql).toContain("retentionDate >= now()");
  });

  test("reads only the services the reader may read", async () => {
    const captured: Array<Statement> = captureStatements(
      LogService as never,
      [],
    );

    await TelemetryRulePreviewService.previewLogs({
      projectId: PROJECT_ID,
      logMonitor: {
        ...MonitorStepLogMonitorUtil.getDefault(),
        telemetryServiceIds: [new ObjectID(SERVICE_A), new ObjectID(SERVICE_B)],
      },
      scope: ONLY_SERVICE_A,
      now: NOW,
    });

    const sql: string = inline(captured[0]!);
    expect(sql).toContain(SERVICE_A);
    expect(sql).not.toContain(SERVICE_B);
  });

  test("a monitor that names no service reads, for a scoped reader, their services alone", async () => {
    const captured: Array<Statement> = captureStatements(
      LogService as never,
      [],
    );

    await TelemetryRulePreviewService.previewLogs({
      projectId: PROJECT_ID,
      logMonitor: MonitorStepLogMonitorUtil.getDefault(),
      scope: ONLY_SERVICE_A,
      now: NOW,
    });

    expect(inline(captured[0]!)).toContain(SERVICE_A);
  });
});

describe("A Traces rule's preview", () => {
  test("counts spans by when they started, with the monitor's name and status filters", async () => {
    const captured: Array<Statement> = captureStatements(SpanService as never, [
      { windowStart: "2026-10-27 12:06:00", windowCount: 9 },
    ]);

    const answer: TelemetryRulePreviewAnswer =
      await TelemetryRulePreviewService.previewSpans({
        projectId: PROJECT_ID,
        traceMonitor: {
          ...MonitorStepTraceMonitorUtil.getDefault(),
          spanName: "POST /api/checkout",
          spanStatuses: [SpanStatus.Error],
          lastXSecondsOfSpans: 60,
        },
        scope: PROJECT_WIDE,
        now: NOW,
      });

    expect(answer.windowInSeconds).toBe(60);
    expect(answer.endTime).toBe("2026-10-27T12:07:00.000Z");

    const sql: string = inline(captured[0]!);
    expect(sql).toContain("toStartOfInterval(`startTime`, INTERVAL 60 SECOND)");
    expect(sql).toContain("POST /api/checkout");
    expect(sql).toContain("timeout_overflow_mode = 'throw'");
  });
});

describe("An Exceptions rule's preview", () => {
  test("leaves out resolved and archived exceptions, as the check does", async () => {
    const captured: Array<Statement> = captureStatements(
      ExceptionInstanceService as never,
      [],
    );
    const lookup: jest.SpiedFunction<
      typeof TelemetryExceptionService.getResolvedOrArchivedFingerprints
    > = jest
      .spyOn(TelemetryExceptionService, "getResolvedOrArchivedFingerprints")
      .mockResolvedValue(["fingerprint-resolved-1", "fingerprint-archived-2"]);

    await TelemetryRulePreviewService.previewExceptions({
      projectId: PROJECT_ID,
      exceptionMonitor: {
        ...MonitorStepExceptionMonitorUtil.getDefault(),
        exceptionTypes: ["TypeError"],
        environments: ["production"],
        lastXSecondsOfExceptions: 300,
      },
      scope: PROJECT_WIDE,
      now: NOW,
    });

    expect(lookup).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: PROJECT_ID,
        resolved: true,
        archived: true,
      }),
    );

    const sql: string = inline(captured[0]!);
    expect(sql).toContain("toStartOfInterval(`time`, INTERVAL 300 SECOND)");
    expect(sql).toContain("fingerprint-resolved-1");
    expect(sql).toContain("fingerprint-archived-2");
    expect(sql).toContain("TypeError");
    expect(sql).toContain("production");
  });

  test("a monitor that counts resolved and archived exceptions looks none up", async () => {
    captureStatements(ExceptionInstanceService as never, []);
    const lookup: jest.SpiedFunction<
      typeof TelemetryExceptionService.getResolvedOrArchivedFingerprints
    > = jest
      .spyOn(TelemetryExceptionService, "getResolvedOrArchivedFingerprints")
      .mockResolvedValue([]);

    await TelemetryRulePreviewService.previewExceptions({
      projectId: PROJECT_ID,
      exceptionMonitor: {
        ...MonitorStepExceptionMonitorUtil.getDefault(),
        includeResolved: true,
        includeArchived: true,
      },
      scope: PROJECT_WIDE,
      now: NOW,
    });

    expect(lookup).not.toHaveBeenCalled();
  });
});

describe("Counting per window", () => {
  test("refuses a column the model does not have, and a window that is not whole seconds", async () => {
    captureStatements(LogService as never, []);

    await expect(
      LogService.countPerWindow({
        query: { projectId: PROJECT_ID },
        timeColumnName: "notAColumn",
        windowInSeconds: 60,
        props: { isRoot: true },
      }),
    ).rejects.toBeInstanceOf(BadDataException);

    for (const windowInSeconds of [0, -60, 1.5, Number.NaN]) {
      await expect(
        LogService.countPerWindow({
          query: { projectId: PROJECT_ID },
          timeColumnName: "time",
          windowInSeconds,
          props: { isRoot: true },
        }),
      ).rejects.toBeInstanceOf(BadDataException);
    }
  });
});
