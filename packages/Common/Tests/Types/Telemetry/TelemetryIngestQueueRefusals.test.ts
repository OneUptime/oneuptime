import { describe, expect, test } from "@jest/globals";
import ProductType from "../../../Types/MeteredPlan/ProductType";
import {
  getTelemetryIngestRefusalReasonForBudget,
  getSignalForQueueRefusalSurface,
  isTelemetryIngestRefusalReason,
  PROJECT_WIDE_TELEMETRY_INGEST_REFUSAL_REASONS,
  QUEUE_REFUSAL_SURFACE_FOR_SIGNAL,
  QUEUE_TELEMETRY_INGEST_REFUSAL_REASONS,
  summarizeTelemetryQueueRefusals,
  TELEMETRY_INGEST_REFUSAL_STRETCH_GAP_MS,
  TelemetryIngestQueueRefusalRow,
  TelemetryIngestRefusalReason,
} from "../../../Types/Telemetry/TelemetryIngestRefusal";
import {
  isRetryableTelemetryIngestionBudgetRefusal,
  isTelemetryIngestionQueueRefusalCurrent,
  isTelemetryIngestionQueueRefusalKind,
  readTelemetryIngestionBudgetStatus,
  TELEMETRY_INGESTION_BUDGET_SIGNALS,
  TELEMETRY_INGESTION_QUEUE_REFUSAL_CURRENT_MS,
  TelemetryIngestionBudgetRefusalKind,
  TelemetryIngestionBudgetScope,
  TelemetryIngestionBudgetSignal,
  TelemetryIngestionBudgetStatus,
  TelemetryIngestionQueueRefusalStatus,
} from "../../../Types/Telemetry/TelemetryIngestionBudget";
import TelemetryIngestSurface from "../../../Types/Telemetry/TelemetryIngestSurface";

/*
 * WHAT THE TELEMETRY QUEUE REFUSED, AS A PROJECT IS TOLD (issue #11440).
 *
 * TelemetryIngestShedding refuses a project's signal while too much of it
 * waits to be stored, or every project's while the queue is nearly full.
 * Each refusal is counted against the key that sent it, under the signal's
 * own surface, with a stored reason of its own, and the status API adds the
 * keys' counts up by signal: these are the pieces of that, without a
 * database or a page.
 */

const at: (time: string) => Date = (time: string): Date => {
  return new Date(`2026-11-28T${time}:00.000Z`);
};

const row: (
  data: Partial<TelemetryIngestQueueRefusalRow> & {
    first: string;
    last: string;
  },
) => TelemetryIngestQueueRefusalRow = (
  data: Partial<TelemetryIngestQueueRefusalRow> & {
    first: string;
    last: string;
  },
): TelemetryIngestQueueRefusalRow => {
  return {
    reason: data.reason ?? TelemetryIngestRefusalReason.QueueBacklogged,
    surface: data.surface ?? TelemetryIngestSurface.OtelMetrics,
    count: data.count ?? 10,
    firstRefusedAt: at(data.first),
    lastRefusedAt: at(data.last),
  };
};

describe("the stored reasons", () => {
  test("each queue refusal kind is counted under a reason of its own, whatever the scope", () => {
    for (const scope of Object.values(TelemetryIngestionBudgetScope)) {
      expect(
        getTelemetryIngestRefusalReasonForBudget({
          kind: TelemetryIngestionBudgetRefusalKind.QueueBacklogged,
          scope: scope,
        }),
      ).toBe(TelemetryIngestRefusalReason.QueueBacklogged);
      expect(
        getTelemetryIngestRefusalReasonForBudget({
          kind: TelemetryIngestionBudgetRefusalKind.QueueFull,
          scope: scope,
        }),
      ).toBe(TelemetryIngestRefusalReason.QueueFull);
    }
  });

  test("a budget's refusals are counted as they were", () => {
    expect(
      getTelemetryIngestRefusalReasonForBudget({
        kind: TelemetryIngestionBudgetRefusalKind.RateLimited,
        scope: TelemetryIngestionBudgetScope.Project,
      }),
    ).toBe(TelemetryIngestRefusalReason.ProjectIngestionRate);
    expect(
      getTelemetryIngestRefusalReasonForBudget({
        kind: TelemetryIngestionBudgetRefusalKind.DailyBudgetExhausted,
        scope: TelemetryIngestionBudgetScope.IngestionKey,
      }),
    ).toBe(TelemetryIngestRefusalReason.KeyDailyBudget);
  });

  test("the values are stored, so they are spelled for good", () => {
    expect(TelemetryIngestRefusalReason.QueueBacklogged).toBe(
      "queue-backlogged",
    );
    expect(TelemetryIngestRefusalReason.QueueFull).toBe("queue-full");
    expect(isTelemetryIngestRefusalReason("queue-backlogged")).toBe(true);
    expect(isTelemetryIngestRefusalReason("queue-full")).toBe(true);
  });

  test("they hold for every key of the project alike, and are told apart by stretch", () => {
    for (const reason of [
      TelemetryIngestRefusalReason.QueueBacklogged,
      TelemetryIngestRefusalReason.QueueFull,
    ]) {
      expect(PROJECT_WIDE_TELEMETRY_INGEST_REFUSAL_REASONS.has(reason)).toBe(
        true,
      );
      expect(QUEUE_TELEMETRY_INGEST_REFUSAL_REASONS.has(reason)).toBe(true);
    }

    // No other reason starts again after a gap.
    expect(QUEUE_TELEMETRY_INGEST_REFUSAL_REASONS.size).toBe(2);
  });

  test("the gap outlasts a refused sender's wait and a process's write interval", () => {
    // Retry-After is 30 seconds; each process writes every five minutes.
    expect(TELEMETRY_INGEST_REFUSAL_STRETCH_GAP_MS).toBeGreaterThan(
      2 * 5 * 60 * 1000,
    );
  });
});

describe("the kinds of queue refusal", () => {
  test("both are retryable, as a rate is, and neither is a budget's", () => {
    expect(
      isRetryableTelemetryIngestionBudgetRefusal(
        TelemetryIngestionBudgetRefusalKind.QueueBacklogged,
      ),
    ).toBe(true);
    expect(
      isRetryableTelemetryIngestionBudgetRefusal(
        TelemetryIngestionBudgetRefusalKind.QueueFull,
      ),
    ).toBe(true);
    expect(
      isRetryableTelemetryIngestionBudgetRefusal(
        TelemetryIngestionBudgetRefusalKind.DailyBudgetExhausted,
      ),
    ).toBe(false);
    expect(isTelemetryIngestionQueueRefusalKind("queue-full")).toBe(true);
    expect(isTelemetryIngestionQueueRefusalKind("rate-limited")).toBe(false);
    expect(isTelemetryIngestionQueueRefusalKind(undefined)).toBe(false);
  });
});

describe("the surface a queue refusal is counted under", () => {
  test("every signal has one of its own, which reads back as the signal", () => {
    const surfaces: Set<TelemetryIngestSurface> = new Set();

    for (const signal of TELEMETRY_INGESTION_BUDGET_SIGNALS) {
      const surface: TelemetryIngestSurface =
        QUEUE_REFUSAL_SURFACE_FOR_SIGNAL[signal];

      expect(surface).toBeTruthy();
      expect(getSignalForQueueRefusalSurface(surface)).toBe(signal);
      surfaces.add(surface);
    }

    expect(surfaces.size).toBe(TELEMETRY_INGESTION_BUDGET_SIGNALS.length);
  });

  test("the signal's own OTLP surface, never the one gRPC port every signal shares", () => {
    expect(QUEUE_REFUSAL_SURFACE_FOR_SIGNAL[ProductType.Metrics]).toBe(
      TelemetryIngestSurface.OtelMetrics,
    );
    expect(QUEUE_REFUSAL_SURFACE_FOR_SIGNAL[ProductType.Logs]).toBe(
      TelemetryIngestSurface.OtelLogs,
    );
    expect(getSignalForQueueRefusalSurface(TelemetryIngestSurface.Grpc)).toBe(
      null,
    );
    expect(getSignalForQueueRefusalSurface(TelemetryIngestSurface.Syslog)).toBe(
      null,
    );
    expect(getSignalForQueueRefusalSurface("")).toBe(null);
  });
});

describe("summarizeTelemetryQueueRefusals", () => {
  test("nothing refused is nothing to tell", () => {
    expect(summarizeTelemetryQueueRefusals([])).toEqual([]);
  });

  test("every key's rows of a signal that run on into one another are one stretch, their counts added up", () => {
    expect(
      summarizeTelemetryQueueRefusals([
        row({ count: 100, first: "09:00", last: "09:50" }),
        row({ count: 40, first: "09:20", last: "10:05" }),
        // Begins within the gap of the stretch's latest refusal.
        row({ count: 2, first: "10:15", last: "10:16" }),
      ]),
    ).toEqual([
      {
        signal: ProductType.Metrics,
        kind: TelemetryIngestionBudgetRefusalKind.QueueBacklogged,
        refusedRequests: 142,
        firstRefusedAt: "2026-11-28T09:00:00.000Z",
        lastRefusedAt: "2026-11-28T10:16:00.000Z",
      },
    ]);
  });

  test("a row that begins after the gap begins the latest stretch, which alone is told", () => {
    const gapMinutes: number = TELEMETRY_INGEST_REFUSAL_STRETCH_GAP_MS / 60_000;

    expect(gapMinutes).toBe(15);

    expect(
      summarizeTelemetryQueueRefusals([
        row({ count: 500, first: "02:00", last: "03:00" }),
        // 16 minutes after the stretch before had ended.
        row({ count: 7, first: "03:16", last: "03:20" }),
      ]),
    ).toEqual([
      {
        signal: ProductType.Metrics,
        kind: TelemetryIngestionBudgetRefusalKind.QueueBacklogged,
        refusedRequests: 7,
        firstRefusedAt: "2026-11-28T03:16:00.000Z",
        lastRefusedAt: "2026-11-28T03:20:00.000Z",
      },
    ]);
  });

  test("the rows' order does not matter", () => {
    const rows: Array<TelemetryIngestQueueRefusalRow> = [
      row({ count: 7, first: "03:16", last: "03:20" }),
      row({ count: 500, first: "02:00", last: "03:00" }),
      row({ count: 3, first: "03:18", last: "03:19" }),
    ];

    expect(summarizeTelemetryQueueRefusals(rows)).toEqual(
      summarizeTelemetryQueueRefusals([...rows].reverse()),
    );
    expect(summarizeTelemetryQueueRefusals(rows)[0]!.refusedRequests).toBe(10);
  });

  test("each signal and kind is told apart, the latest refusal first", () => {
    expect(
      summarizeTelemetryQueueRefusals([
        row({ count: 1, first: "08:00", last: "08:01" }),
        row({
          surface: TelemetryIngestSurface.OtelLogs,
          count: 2,
          first: "08:00",
          last: "09:00",
        }),
        row({
          reason: TelemetryIngestRefusalReason.QueueFull,
          surface: TelemetryIngestSurface.OtelLogs,
          count: 3,
          first: "08:30",
          last: "08:31",
        }),
      ]).map((refusal: TelemetryIngestionQueueRefusalStatus): string => {
        return `${refusal.signal} ${refusal.kind} ${refusal.refusedRequests}`;
      }),
    ).toEqual([
      `${ProductType.Logs} queue-backlogged 2`,
      `${ProductType.Logs} queue-full 3`,
      `${ProductType.Metrics} queue-backlogged 1`,
    ]);
  });

  test("a row of another reason, under a surface of no signal, or with no instant, is left out", () => {
    expect(
      summarizeTelemetryQueueRefusals([
        row({
          reason: TelemetryIngestRefusalReason.KeyDisabled,
          first: "08:00",
          last: "08:01",
        }),
        row({ reason: "not-a-reason", first: "08:00", last: "08:01" }),
        row({
          surface: TelemetryIngestSurface.Grpc,
          first: "08:00",
          last: "08:01",
        }),
        {
          reason: TelemetryIngestRefusalReason.QueueFull,
          surface: TelemetryIngestSurface.OtelTraces,
          count: 1,
          firstRefusedAt: new Date("not a date"),
          lastRefusedAt: at("08:00"),
        },
      ]),
    ).toEqual([]);
  });

  test("a count it cannot read counts one, and a first refusal after the latest is the latest", () => {
    expect(
      summarizeTelemetryQueueRefusals([
        row({ count: Number.NaN, first: "08:30", last: "08:00" }),
        row({ count: 0, first: "08:01", last: "08:02" }),
        row({ count: 2.9, first: "08:01", last: "08:02" }),
      ]),
    ).toEqual([
      {
        signal: ProductType.Metrics,
        kind: TelemetryIngestionBudgetRefusalKind.QueueBacklogged,
        refusedRequests: 4,
        firstRefusedAt: "2026-11-28T08:00:00.000Z",
        lastRefusedAt: "2026-11-28T08:02:00.000Z",
      },
    ]);
  });
});

describe("whether a queue refusal goes on still", () => {
  const refusal: (
    lastRefusedAt: string,
  ) => TelemetryIngestionQueueRefusalStatus = (
    lastRefusedAt: string,
  ): TelemetryIngestionQueueRefusalStatus => {
    return {
      signal: ProductType.Metrics,
      kind: TelemetryIngestionBudgetRefusalKind.QueueBacklogged,
      refusedRequests: 3,
      firstRefusedAt: lastRefusedAt,
      lastRefusedAt: lastRefusedAt,
    };
  };

  test("a refusal within two of a process's writes, and a little more, is current", () => {
    const now: Date = at("12:00");

    expect(TELEMETRY_INGESTION_QUEUE_REFUSAL_CURRENT_MS).toBe(11 * 60 * 1000);
    expect(
      isTelemetryIngestionQueueRefusalCurrent({
        refusal: refusal(at("11:49").toISOString()),
        now,
      }),
    ).toBe(true);
    expect(
      isTelemetryIngestionQueueRefusalCurrent({
        refusal: refusal(new Date(at("11:49").getTime() - 1).toISOString()),
        now,
      }),
    ).toBe(false);
    expect(
      isTelemetryIngestionQueueRefusalCurrent({
        refusal: refusal("not a date"),
        now,
      }),
    ).toBe(false);
  });
});

describe("the status as the Dashboard reads it back", () => {
  const status: (queueRefusals: unknown) => unknown = (
    queueRefusals: unknown,
  ): unknown => {
    return {
      resetsAt: "2026-11-29T00:00:00.000Z",
      project: { signals: [] },
      ...(queueRefusals === undefined ? {} : { queueRefusals }),
    };
  };

  const read: (
    value: unknown,
  ) => Array<TelemetryIngestionQueueRefusalStatus> = (
    value: unknown,
  ): Array<TelemetryIngestionQueueRefusalStatus> => {
    const readStatus: TelemetryIngestionBudgetStatus | null =
      readTelemetryIngestionBudgetStatus(value);

    expect(readStatus).not.toBeNull();
    // Always told, as empty when there is nothing to tell.
    expect(Array.isArray(readStatus!.queueRefusals)).toBe(true);

    return readStatus!.queueRefusals!;
  };

  test("an older server, which does not tell, tells of nothing", () => {
    expect(read(status(undefined))).toEqual([]);
    expect(read(status("not a list"))).toEqual([]);
  });

  test("an entry is read with its signal, its kind and its instants, the latest first", () => {
    expect(
      read(
        status([
          {
            signal: ProductType.Logs,
            kind: "queue-full",
            refusedRequests: 2,
            firstRefusedAt: "2026-11-28T08:00:00.000Z",
            lastRefusedAt: "2026-11-28T08:05:00.000Z",
          },
          {
            signal: ProductType.Metrics,
            kind: "queue-backlogged",
            refusedRequests: 4210,
            firstRefusedAt: "2026-11-28T09:02:00.000Z",
            lastRefusedAt: "2026-11-28T11:57:00.000Z",
          },
        ]),
      ),
    ).toEqual([
      {
        signal: ProductType.Metrics,
        kind: TelemetryIngestionBudgetRefusalKind.QueueBacklogged,
        refusedRequests: 4210,
        firstRefusedAt: "2026-11-28T09:02:00.000Z",
        lastRefusedAt: "2026-11-28T11:57:00.000Z",
      },
      {
        signal: ProductType.Logs,
        kind: TelemetryIngestionBudgetRefusalKind.QueueFull,
        refusedRequests: 2,
        firstRefusedAt: "2026-11-28T08:00:00.000Z",
        lastRefusedAt: "2026-11-28T08:05:00.000Z",
      },
    ]);
  });

  test("an entry it cannot read is left out, and a signal and kind told twice is read once", () => {
    const valid: Record<string, unknown> = {
      signal: ProductType.Traces,
      kind: "queue-backlogged",
      refusedRequests: 5,
      firstRefusedAt: "2026-11-28T08:00:00.000Z",
      lastRefusedAt: "2026-11-28T08:05:00.000Z",
    };

    expect(
      read(
        status([
          null,
          "metrics",
          { ...valid, signal: "session-replay" },
          { ...valid, kind: "rate-limited" },
          { ...valid, lastRefusedAt: "yesterday-ish" },
          valid,
          { ...valid, refusedRequests: 99 },
        ]),
      ),
    ).toEqual([valid]);
  });

  test("a count it cannot read is one, and a first refusal it cannot place is the latest", () => {
    expect(
      read(
        status([
          {
            signal: ProductType.Profiles,
            kind: "queue-backlogged",
            refusedRequests: "many",
            firstRefusedAt: "2026-11-28T09:00:00.000Z",
            lastRefusedAt: "2026-11-28T08:00:00.000Z",
          },
          {
            signal: ProductType.SecurityEvents,
            kind: "queue-full",
            refusedRequests: 0,
            lastRefusedAt: "2026-11-28T07:00:00.000Z",
          },
        ]),
      ),
    ).toEqual([
      {
        signal: ProductType.Profiles as TelemetryIngestionBudgetSignal,
        kind: TelemetryIngestionBudgetRefusalKind.QueueBacklogged,
        refusedRequests: 1,
        firstRefusedAt: "2026-11-28T08:00:00.000Z",
        lastRefusedAt: "2026-11-28T08:00:00.000Z",
      },
      {
        signal: ProductType.SecurityEvents as TelemetryIngestionBudgetSignal,
        kind: TelemetryIngestionBudgetRefusalKind.QueueFull,
        refusedRequests: 1,
        firstRefusedAt: "2026-11-28T07:00:00.000Z",
        lastRefusedAt: "2026-11-28T07:00:00.000Z",
      },
    ]);
  });
});
