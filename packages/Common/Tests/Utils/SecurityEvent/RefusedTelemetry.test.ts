import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "../../../Types/JSON";
import ProductType from "../../../Types/MeteredPlan/ProductType";
import {
  TelemetryIngestionBudgetScope,
  TelemetryIngestionBudgetScopeStatus,
  TelemetryIngestionBudgetSignal,
  TelemetryIngestionBudgetSignalStatus,
  TelemetryIngestionBudgetState,
  TelemetryIngestionBudgetStatus,
} from "../../../Types/Telemetry/TelemetryIngestionBudget";
import {
  EMPTY_REFUSED_TELEMETRY_RECORD,
  MAX_REFUSED_TELEMETRY_KEPT,
  REFUSED_TELEMETRY_JOIN_GAP_IN_MINUTES,
  REFUSED_TELEMETRY_KEPT_FOR_IN_DAYS,
  REFUSED_TELEMETRY_OBSERVATION_RESULT_KEY,
  REFUSED_TELEMETRY_RESULT_KEY,
  RefusedTelemetry,
  RefusedTelemetryKind,
  RefusedTelemetryRecord,
  RefusedTelemetrySignal,
  foldRefusedTelemetry,
  getRecentRefusedTelemetry,
  getRefusedTelemetryBetween,
  getRefusedTelemetryEnd,
  isRefusedTelemetryOngoing,
  pruneRefusedTelemetry,
  readRefusedTelemetryEntry,
  readRefusedTelemetryList,
  readRefusedTelemetryRecord,
  sortRefusedTelemetryForReading,
  writeRefusedTelemetryRecord,
} from "../../../Utils/SecurityEvent/RefusedTelemetry";

/*
 * WHAT A BUDGET OR A RATE REFUSED, FOLDED READ BY READ (#10431).
 *
 * Each test hands the fold the project's budget counters as the status
 * reader answers them, a read at a time, the way a scan does every minute,
 * and checks the stretches Security Events keeps: whose budget, from when
 * to when, how much - and that every bound is the wider one, so a quiet
 * stretch is never claimed for telemetry that may be missing.
 */

const PROJECT_ID: string = "0192f1a0-0000-7000-8000-0000000a1431";
const KEY_ID: string = "0192f1a0-0000-7000-8000-0000000b1431";
const TEAM_ID: string = "0192f1a0-0000-7000-8000-0000000c1431";
const LABEL_ID: string = "0192f1a0-0000-7000-8000-0000000d1431";

// The budget day of 2026-11-20 (resets at midnight UTC), and the next.
const DAY_ONE: { startsAt: string; resetsAt: string } = {
  startsAt: "2026-11-20T00:00:00.000Z",
  resetsAt: "2026-11-21T00:00:00.000Z",
};
const DAY_TWO: { startsAt: string; resetsAt: string } = {
  startsAt: "2026-11-21T00:00:00.000Z",
  resetsAt: "2026-11-22T00:00:00.000Z",
};

const at: (iso: string) => Date = (iso: string): Date => {
  return new Date(iso);
};

interface Counters {
  droppedBytes?: number | undefined;
  droppedRequests?: number | undefined;
  throttledRequests?: number | undefined;
  state?: TelemetryIngestionBudgetState | undefined;
  exhaustedAt?: string | null | undefined;
}

const signalStatus: (
  signal: TelemetryIngestionBudgetSignal,
  counters: Counters,
) => TelemetryIngestionBudgetSignalStatus = (
  signal: TelemetryIngestionBudgetSignal,
  counters: Counters,
): TelemetryIngestionBudgetSignalStatus => {
  return {
    signal,
    dailyBudgetBytes: 1000,
    dailyBudgetSource: null,
    rateLimitBytesPerSecond: 100,
    rateLimitSource: null,
    usedBytes:
      counters.state === TelemetryIngestionBudgetState.Exhausted ? 1000 : 10,
    droppedBytes: counters.droppedBytes ?? 0,
    droppedRequests: counters.droppedRequests ?? 0,
    throttledRequests: counters.throttledRequests ?? 0,
    percentUsed: null,
    state: counters.state ?? TelemetryIngestionBudgetState.Ok,
    warningCrossedAt: null,
    exhaustedAt: counters.exhaustedAt ?? null,
  };
};

interface StatusShape {
  day?: { startsAt: string; resetsAt: string } | undefined;
  countersAvailable?: boolean | undefined;
  logs?: Counters | undefined;
  traces?: Counters | undefined;
  key?: (Counters & { name?: string | undefined }) | undefined;
  team?: (Counters & { name?: string | undefined }) | undefined;
  label?: (Counters & { name?: string | undefined }) | undefined;
}

// A project's budgets today, as TelemetryIngestionBudgetStatusReader answers.
const status: (shape: StatusShape) => TelemetryIngestionBudgetStatus = (
  shape: StatusShape,
): TelemetryIngestionBudgetStatus => {
  const day: { startsAt: string; resetsAt: string } = shape.day || DAY_ONE;
  const project: TelemetryIngestionBudgetScopeStatus = {
    scope: TelemetryIngestionBudgetScope.Project,
    signals: [
      signalStatus(ProductType.Logs, shape.logs || {}),
      signalStatus(ProductType.Traces, shape.traces || {}),
      signalStatus(ProductType.Metrics, {}),
    ],
  };

  return {
    dayStartsAt: day.startsAt,
    resetsAt: day.resetsAt,
    resetTime: "00:00",
    timezone: "UTC",
    warningPercent: 80,
    countersAvailable: shape.countersAvailable ?? true,
    project,
    ingestionKeys: shape.key
      ? [
          {
            scope: TelemetryIngestionBudgetScope.IngestionKey,
            ingestionKeyId: KEY_ID,
            ingestionKeyName: shape.key.name ?? "Edge collector",
            signals: [signalStatus(ProductType.Logs, shape.key)],
          },
        ]
      : [],
    teamsAndLabels: [
      ...(shape.team
        ? [
            {
              scope: TelemetryIngestionBudgetScope.Team,
              teamId: TEAM_ID,
              teamName: shape.team.name ?? "Payments",
              signals: [signalStatus(ProductType.Logs, shape.team)],
            },
          ]
        : []),
      ...(shape.label
        ? [
            {
              scope: TelemetryIngestionBudgetScope.Label,
              labelId: LABEL_ID,
              labelName: shape.label.name ?? "edge",
              signals: [signalStatus(ProductType.Logs, shape.label)],
            },
          ]
        : []),
    ],
  };
};

// One read folded in, as a scan's turn does it.
const fold: (
  record: RefusedTelemetryRecord,
  now: string,
  shape: StatusShape | null,
  signal?: RefusedTelemetrySignal,
) => RefusedTelemetryRecord = (
  record: RefusedTelemetryRecord,
  now: string,
  shape: StatusShape | null,
  signal: RefusedTelemetrySignal = ProductType.Logs,
): RefusedTelemetryRecord => {
  return foldRefusedTelemetry({
    record,
    status: shape ? status(shape) : null,
    signal,
    projectId: PROJECT_ID,
    now: at(now),
  });
};

// The reads in order, each folded into what the one before left.
const reads: (
  steps: Array<[string, StatusShape | null]>,
  signal?: RefusedTelemetrySignal,
) => RefusedTelemetryRecord = (
  steps: Array<[string, StatusShape | null]>,
  signal: RefusedTelemetrySignal = ProductType.Logs,
): RefusedTelemetryRecord => {
  let record: RefusedTelemetryRecord = EMPTY_REFUSED_TELEMETRY_RECORD;

  for (const [now, shape] of steps) {
    record = fold(record, now, shape, signal);
  }

  return record;
};

const USED_UP: TelemetryIngestionBudgetState =
  TelemetryIngestionBudgetState.Exhausted;

describe("a used-up daily budget", () => {
  test("is refused from the moment it was used up, while it goes on, with what it refused", () => {
    const record: RefusedTelemetryRecord = reads([
      ["2026-11-20T14:00:00.000Z", { logs: {} }],
      [
        "2026-11-20T14:03:00.000Z",
        {
          logs: {
            state: USED_UP,
            exhaustedAt: "2026-11-20T14:02:07.000Z",
            droppedBytes: 4096,
            droppedRequests: 3,
          },
        },
      ],
      [
        "2026-11-20T14:04:00.000Z",
        {
          logs: {
            state: USED_UP,
            exhaustedAt: "2026-11-20T14:02:07.000Z",
            droppedBytes: 10240,
            droppedRequests: 9,
          },
        },
      ],
    ]);

    expect(record.refusals).toEqual([
      {
        signal: ProductType.Logs,
        kind: RefusedTelemetryKind.BudgetUsedUp,
        scope: TelemetryIngestionBudgetScope.Project,
        scopeId: PROJECT_ID,
        scopeName: "",
        from: "2026-11-20T14:02:07.000Z",
        to: null,
        refusedBytes: 10240,
        refusedRequests: 9,
      },
    ]);
    expect(isRefusedTelemetryOngoing(record.refusals[0]!)).toBe(true);
    expect(record.observation).toEqual({
      observedAt: "2026-11-20T14:04:00.000Z",
      dayStartsAt: DAY_ONE.startsAt,
      dayResetsAt: DAY_ONE.resetsAt,
      scopes: [
        {
          scope: TelemetryIngestionBudgetScope.Project,
          scopeId: PROJECT_ID,
          droppedBytes: 10240,
          droppedRequests: 9,
          throttledRequests: 0,
          isUsedUp: true,
        },
      ],
    });
  });

  test("used up before the first read starts when it was used up, with the whole day's refusals", () => {
    const record: RefusedTelemetryRecord = reads([
      [
        "2026-11-20T15:00:00.000Z",
        {
          logs: {
            state: USED_UP,
            exhaustedAt: "2026-11-20T14:02:07.000Z",
            droppedBytes: 9000,
            droppedRequests: 40,
          },
        },
      ],
    ]);

    expect(record.refusals).toHaveLength(1);
    expect(record.refusals[0]).toMatchObject({
      from: "2026-11-20T14:02:07.000Z",
      to: null,
      refusedBytes: 9000,
      refusedRequests: 40,
    });
  });

  test("ends at the reset of the day it was used up in, and the new day starts from nothing", () => {
    const record: RefusedTelemetryRecord = reads([
      [
        "2026-11-20T23:59:00.000Z",
        {
          logs: {
            state: USED_UP,
            exhaustedAt: "2026-11-20T14:02:07.000Z",
            droppedBytes: 500,
            droppedRequests: 5,
          },
        },
      ],
      // After the reset: today's counters, nothing refused yet.
      ["2026-11-21T00:01:00.000Z", { day: DAY_TWO, logs: {} }],
      ["2026-11-21T03:00:00.000Z", { day: DAY_TWO, logs: {} }],
    ]);

    expect(record.refusals).toEqual([
      expect.objectContaining({
        from: "2026-11-20T14:02:07.000Z",
        to: DAY_ONE.resetsAt,
        refusedBytes: 500,
        refusedRequests: 5,
      }),
    ]);
  });

  test("used up again right after the reset reads as one stretch that goes on", () => {
    const record: RefusedTelemetryRecord = reads([
      [
        "2026-11-20T23:59:00.000Z",
        {
          logs: {
            state: USED_UP,
            exhaustedAt: "2026-11-20T14:02:07.000Z",
            droppedRequests: 5,
          },
        },
      ],
      [
        "2026-11-21T00:06:00.000Z",
        {
          day: DAY_TWO,
          logs: {
            state: USED_UP,
            exhaustedAt: "2026-11-21T00:05:00.000Z",
            droppedRequests: 2,
          },
        },
      ],
    ]);

    expect(record.refusals).toEqual([
      expect.objectContaining({
        from: "2026-11-20T14:02:07.000Z",
        to: null,
        refusedRequests: 7,
      }),
    ]);
  });

  test("raised so it is no longer used up ends by the read that saw it, at the latest", () => {
    const record: RefusedTelemetryRecord = reads([
      [
        "2026-11-20T14:03:00.000Z",
        {
          logs: {
            state: USED_UP,
            exhaustedAt: "2026-11-20T14:02:07.000Z",
            droppedRequests: 1,
          },
        },
      ],
      [
        "2026-11-20T15:30:00.000Z",
        {
          logs: {
            state: TelemetryIngestionBudgetState.Warning,
            exhaustedAt: "2026-11-20T14:02:07.000Z",
            droppedRequests: 30,
          },
        },
      ],
    ]);

    expect(record.refusals).toEqual([
      expect.objectContaining({
        from: "2026-11-20T14:02:07.000Z",
        to: "2026-11-20T15:30:00.000Z",
        refusedRequests: 30,
      }),
    ]);
  });

  test("used up a second time in a day starts as early as it could have: the read before", () => {
    const record: RefusedTelemetryRecord = reads([
      [
        "2026-11-20T09:01:00.000Z",
        {
          logs: {
            state: USED_UP,
            exhaustedAt: "2026-11-20T09:00:30.000Z",
            droppedRequests: 1,
          },
        },
      ],
      // Raised.
      [
        "2026-11-20T09:05:00.000Z",
        {
          logs: { exhaustedAt: "2026-11-20T09:00:30.000Z", droppedRequests: 1 },
        },
      ],
      [
        "2026-11-20T18:00:00.000Z",
        {
          logs: { exhaustedAt: "2026-11-20T09:00:30.000Z", droppedRequests: 1 },
        },
      ],
      // Used up again: the counter keeps its first stamp.
      [
        "2026-11-20T18:01:00.000Z",
        {
          logs: {
            state: USED_UP,
            exhaustedAt: "2026-11-20T09:00:30.000Z",
            droppedRequests: 4,
          },
        },
      ],
    ]);

    expect(record.refusals).toEqual([
      expect.objectContaining({
        from: "2026-11-20T09:00:30.000Z",
        to: "2026-11-20T09:05:00.000Z",
        refusedRequests: 1,
      }),
      expect.objectContaining({
        from: "2026-11-20T18:00:00.000Z",
        to: null,
        refusedRequests: 3,
      }),
    ]);
  });

  test("used up with nothing refused yet starts at the read before", () => {
    const record: RefusedTelemetryRecord = reads([
      ["2026-11-20T14:00:00.000Z", { logs: {} }],
      ["2026-11-20T14:01:00.000Z", { logs: { state: USED_UP } }],
    ]);

    expect(record.refusals).toEqual([
      expect.objectContaining({
        from: "2026-11-20T14:00:00.000Z",
        to: null,
        refusedBytes: 0,
        refusedRequests: 0,
      }),
    ]);
  });

  test("used up and raised again between two reads is still a stretch, from the stamp to the read", () => {
    const record: RefusedTelemetryRecord = reads([
      ["2026-11-20T14:00:00.000Z", { logs: {} }],
      [
        "2026-11-20T14:01:00.000Z",
        {
          logs: {
            exhaustedAt: "2026-11-20T14:00:20.000Z",
            droppedBytes: 70,
            droppedRequests: 2,
          },
        },
      ],
    ]);

    expect(record.refusals).toEqual([
      expect.objectContaining({
        kind: RefusedTelemetryKind.BudgetUsedUp,
        from: "2026-11-20T14:00:20.000Z",
        to: "2026-11-20T14:01:00.000Z",
        refusedBytes: 70,
        refusedRequests: 2,
      }),
    ]);
  });
});

describe("a rate that throttled", () => {
  test("is placed between the reads it happened between, and ends by the read that saw no more", () => {
    const record: RefusedTelemetryRecord = reads([
      ["2026-11-20T10:00:00.000Z", { logs: {} }],
      ["2026-11-20T10:01:00.000Z", { logs: { throttledRequests: 7 } }],
      ["2026-11-20T10:02:00.000Z", { logs: { throttledRequests: 12 } }],
      ["2026-11-20T10:03:00.000Z", { logs: { throttledRequests: 12 } }],
    ]);

    expect(record.refusals).toEqual([
      {
        signal: ProductType.Logs,
        kind: RefusedTelemetryKind.RateLimited,
        scope: TelemetryIngestionBudgetScope.Project,
        scopeId: PROJECT_ID,
        scopeName: "",
        from: "2026-11-20T10:00:00.000Z",
        to: "2026-11-20T10:02:00.000Z",
        refusedBytes: 0,
        refusedRequests: 12,
      },
    ]);
  });

  test("throttles before the first read are not counted: Security Events read nothing then", () => {
    const record: RefusedTelemetryRecord = reads([
      ["2026-11-20T10:00:00.000Z", { logs: { throttledRequests: 500 } }],
      ["2026-11-20T10:01:00.000Z", { logs: { throttledRequests: 500 } }],
    ]);

    expect(record.refusals).toEqual([]);
  });

  test("a burst after a short pause carries the stretch on; one after a long pause is a new one", () => {
    const gap: number = REFUSED_TELEMETRY_JOIN_GAP_IN_MINUTES;

    expect(gap).toBe(15);

    const record: RefusedTelemetryRecord = reads([
      ["2026-11-20T10:00:00.000Z", { logs: {} }],
      ["2026-11-20T10:01:00.000Z", { logs: { throttledRequests: 3 } }],
      ["2026-11-20T10:02:00.000Z", { logs: { throttledRequests: 3 } }],
      // Ten minutes on: the same burst.
      ["2026-11-20T10:11:00.000Z", { logs: { throttledRequests: 3 } }],
      ["2026-11-20T10:12:00.000Z", { logs: { throttledRequests: 5 } }],
      ["2026-11-20T10:13:00.000Z", { logs: { throttledRequests: 5 } }],
      // An hour on: another.
      ["2026-11-20T11:30:00.000Z", { logs: { throttledRequests: 5 } }],
      ["2026-11-20T11:31:00.000Z", { logs: { throttledRequests: 9 } }],
    ]);

    expect(record.refusals).toEqual([
      expect.objectContaining({
        from: "2026-11-20T10:00:00.000Z",
        to: "2026-11-20T10:12:00.000Z",
        refusedRequests: 5,
      }),
      expect.objectContaining({
        from: "2026-11-20T11:30:00.000Z",
        to: null,
        refusedRequests: 4,
      }),
    ]);
  });

  test("across a reset, only the new day's throttles count, from its start at the earliest", () => {
    const record: RefusedTelemetryRecord = reads([
      ["2026-11-20T23:58:00.000Z", { logs: { throttledRequests: 40 } }],
      [
        "2026-11-21T00:02:00.000Z",
        { day: DAY_TWO, logs: { throttledRequests: 6 } },
      ],
    ]);

    // The read before was at 23:58, but today's counters started at the reset.
    expect(record.refusals).toEqual([
      expect.objectContaining({
        kind: RefusedTelemetryKind.RateLimited,
        from: DAY_TWO.startsAt,
        to: null,
        refusedRequests: 6,
      }),
    ]);
  });

  test("a counter that went back was started again: all of it is new", () => {
    const record: RefusedTelemetryRecord = reads([
      ["2026-11-20T10:00:00.000Z", { logs: { throttledRequests: 50 } }],
      ["2026-11-20T10:01:00.000Z", { logs: { throttledRequests: 4 } }],
    ]);

    expect(record.refusals).toEqual([
      expect.objectContaining({ refusedRequests: 4, to: null }),
    ]);
  });
});

describe("whose budget", () => {
  test("an ingestion key's, a team's and a label's are told apart, each by its name", () => {
    const record: RefusedTelemetryRecord = reads([
      [
        "2026-11-20T14:00:00.000Z",
        {
          logs: {},
          key: { name: "Edge collector" },
          team: { name: "Payments" },
          label: { name: "edge" },
        },
      ],
      [
        "2026-11-20T14:01:00.000Z",
        {
          logs: {},
          key: {
            name: "Edge collector",
            state: USED_UP,
            exhaustedAt: "2026-11-20T14:00:40.000Z",
            droppedBytes: 1,
            droppedRequests: 1,
          },
          team: {
            name: "Payments",
            state: USED_UP,
            exhaustedAt: "2026-11-20T14:00:41.000Z",
            droppedBytes: 2,
            droppedRequests: 1,
          },
          label: {
            name: "edge",
            state: USED_UP,
            exhaustedAt: "2026-11-20T14:00:42.000Z",
            droppedBytes: 3,
            droppedRequests: 1,
          },
        },
      ],
    ]);

    expect(
      record.refusals.map((refusal: RefusedTelemetry): Array<string> => {
        return [
          refusal.scope,
          refusal.scopeId,
          refusal.scopeName,
          refusal.from,
        ];
      }),
    ).toEqual([
      [
        TelemetryIngestionBudgetScope.IngestionKey,
        KEY_ID,
        "Edge collector",
        "2026-11-20T14:00:40.000Z",
      ],
      [
        TelemetryIngestionBudgetScope.Team,
        TEAM_ID,
        "Payments",
        "2026-11-20T14:00:41.000Z",
      ],
      [
        TelemetryIngestionBudgetScope.Label,
        LABEL_ID,
        "edge",
        "2026-11-20T14:00:42.000Z",
      ],
    ]);
  });

  test("a budget taken away refuses nothing more: what was open for it ends", () => {
    const record: RefusedTelemetryRecord = reads([
      [
        "2026-11-20T14:01:00.000Z",
        {
          logs: {},
          key: {
            state: USED_UP,
            exhaustedAt: "2026-11-20T14:00:40.000Z",
            droppedRequests: 1,
          },
        },
      ],
      // The key's own budget was taken away: it is no longer in the status.
      ["2026-11-20T14:30:00.000Z", { logs: {} }],
    ]);

    expect(record.refusals).toEqual([
      expect.objectContaining({
        scope: TelemetryIngestionBudgetScope.IngestionKey,
        to: "2026-11-20T14:30:00.000Z",
      }),
    ]);
  });

  test("the traces' source reads only the traces' counters", () => {
    const record: RefusedTelemetryRecord = reads(
      [
        [
          "2026-11-20T14:01:00.000Z",
          {
            logs: {
              state: USED_UP,
              exhaustedAt: "2026-11-20T14:00:00.000Z",
              droppedRequests: 9,
            },
            traces: {
              state: USED_UP,
              exhaustedAt: "2026-11-20T13:00:00.000Z",
              droppedRequests: 2,
            },
          },
        ],
      ],
      ProductType.Traces,
    );

    expect(record.refusals).toEqual([
      expect.objectContaining({
        signal: ProductType.Traces,
        from: "2026-11-20T13:00:00.000Z",
        refusedRequests: 2,
      }),
    ]);
  });
});

describe("a read that tells nothing", () => {
  const usedUp: RefusedTelemetryRecord = reads([
    [
      "2026-11-20T14:03:00.000Z",
      {
        logs: {
          state: USED_UP,
          exhaustedAt: "2026-11-20T14:02:07.000Z",
          droppedRequests: 3,
        },
      },
    ],
  ]);

  test("no status: what was going on still goes on, and the read before is kept for the next", () => {
    const after: RefusedTelemetryRecord = fold(
      usedUp,
      "2026-11-20T14:10:00.000Z",
      null,
    );

    expect(after.refusals).toEqual(usedUp.refusals);
    expect(after.observation).toEqual(usedUp.observation);
  });

  test("counters that could not be read are no read", () => {
    const after: RefusedTelemetryRecord = fold(
      usedUp,
      "2026-11-20T14:10:00.000Z",
      { countersAvailable: false, logs: {} },
    );

    expect(after.refusals).toEqual(usedUp.refusals);
    expect(after.observation?.observedAt).toBe("2026-11-20T14:03:00.000Z");
  });

  test("the next good read covers the whole gap", () => {
    const after: RefusedTelemetryRecord = reads([
      ["2026-11-20T10:00:00.000Z", { logs: {} }],
      ["2026-11-20T10:01:00.000Z", { countersAvailable: false }],
      ["2026-11-20T10:30:00.000Z", { logs: { throttledRequests: 2 } }],
    ]);

    expect(after.refusals).toEqual([
      expect.objectContaining({
        kind: RefusedTelemetryKind.RateLimited,
        from: "2026-11-20T10:00:00.000Z",
      }),
    ]);
  });
});

describe("pruneRefusedTelemetry", () => {
  const NOW: Date = at("2026-11-20T12:00:00.000Z");

  const refusal: (
    from: string,
    to: string | null,
    data?: Partial<RefusedTelemetry>,
  ) => RefusedTelemetry = (
    from: string,
    to: string | null,
    data?: Partial<RefusedTelemetry>,
  ): RefusedTelemetry => {
    return {
      signal: ProductType.Logs,
      kind: RefusedTelemetryKind.RateLimited,
      scope: TelemetryIngestionBudgetScope.Project,
      scopeId: PROJECT_ID,
      scopeName: "",
      from,
      to,
      refusedBytes: 0,
      refusedRequests: 1,
      ...data,
    };
  };

  test("lets go of what ended before a retrohunt can ask, keeps what goes on however old", () => {
    expect(REFUSED_TELEMETRY_KEPT_FOR_IN_DAYS).toBe(31);

    const kept: Array<RefusedTelemetry> = pruneRefusedTelemetry(
      [
        refusal("2026-10-01T00:00:00.000Z", "2026-10-01T01:00:00.000Z"),
        refusal("2026-10-02T00:00:00.000Z", null, {
          kind: RefusedTelemetryKind.BudgetUsedUp,
        }),
        refusal("2026-11-19T00:00:00.000Z", "2026-11-19T01:00:00.000Z"),
      ],
      NOW,
    );

    expect(
      kept.map((item: RefusedTelemetry): string => {
        return item.from;
      }),
    ).toEqual(["2026-10-02T00:00:00.000Z", "2026-11-19T00:00:00.000Z"]);
  });

  test("past the most it keeps, joins the closest two of a budget - wider, never lost", () => {
    const many: Array<RefusedTelemetry> = [];

    for (let hour: number = 0; hour <= MAX_REFUSED_TELEMETRY_KEPT; hour++) {
      const from: Date = new Date(at("2026-11-15T00:00:00.000Z").getTime());
      from.setUTCHours(hour);
      const to: Date = new Date(from.getTime() + 60 * 1000);
      many.push(refusal(from.toISOString(), to.toISOString()));
    }

    // Two that sit a minute apart: the closest pair.
    many.push(
      refusal("2026-11-19T10:02:00.000Z", "2026-11-19T10:03:00.000Z"),
      refusal("2026-11-19T10:04:00.000Z", "2026-11-19T10:05:00.000Z"),
    );

    const kept: Array<RefusedTelemetry> = pruneRefusedTelemetry(many, NOW);

    expect(kept).toHaveLength(MAX_REFUSED_TELEMETRY_KEPT);
    // Every request is still counted.
    expect(
      kept.reduce((total: number, item: RefusedTelemetry): number => {
        return total + item.refusedRequests;
      }, 0),
    ).toBe(many.length);
    // Sorted, oldest first.
    expect(kept[0]!.from).toBe("2026-11-15T00:00:00.000Z");
  });
});

describe("asking about a period", () => {
  const NOW: Date = at("2026-11-20T18:00:00.000Z");
  const refusals: Array<RefusedTelemetry> = [
    {
      signal: ProductType.Logs,
      kind: RefusedTelemetryKind.BudgetUsedUp,
      scope: TelemetryIngestionBudgetScope.Project,
      scopeId: PROJECT_ID,
      scopeName: "",
      from: "2026-11-20T14:02:00.000Z",
      to: null,
      refusedBytes: 100,
      refusedRequests: 3,
    },
    {
      signal: ProductType.Traces,
      kind: RefusedTelemetryKind.RateLimited,
      scope: TelemetryIngestionBudgetScope.Project,
      scopeId: PROJECT_ID,
      scopeName: "",
      from: "2026-11-18T09:00:00.000Z",
      to: "2026-11-18T09:20:00.000Z",
      refusedBytes: 0,
      refusedRequests: 12,
    },
  ];

  test("a stretch that goes on runs until now", () => {
    expect(getRefusedTelemetryEnd(refusals[0]!, NOW)).toEqual(NOW);
    expect(getRefusedTelemetryEnd(refusals[1]!, NOW)).toEqual(
      at("2026-11-18T09:20:00.000Z"),
    );
  });

  test("overlaps are found at both edges, and nothing outside", () => {
    const between: (from: string, to: string) => Array<string> = (
      from: string,
      to: string,
    ): Array<string> => {
      return getRefusedTelemetryBetween({
        refusals,
        from: at(from),
        to: at(to),
        now: NOW,
      }).map((refusal: RefusedTelemetry): string => {
        return refusal.signal;
      });
    };

    expect(
      between("2026-11-20T17:00:00.000Z", "2026-11-20T17:05:00.000Z"),
    ).toEqual([ProductType.Logs]);
    expect(
      between("2026-11-18T09:20:00.000Z", "2026-11-18T10:00:00.000Z"),
    ).toEqual([ProductType.Traces]);
    expect(
      between("2026-11-01T00:00:00.000Z", "2026-11-20T18:00:00.000Z"),
    ).toEqual([ProductType.Traces, ProductType.Logs]);
    expect(
      between("2026-11-19T00:00:00.000Z", "2026-11-20T14:01:59.000Z"),
    ).toEqual([]);
  });

  test("recent is what goes on, or ended within the day", () => {
    expect(getRecentRefusedTelemetry({ refusals, now: NOW })).toEqual([
      refusals[0],
    ]);
  });

  test("for reading, what goes on comes first, then the latest", () => {
    expect(sortRefusedTelemetryForReading([...refusals].reverse())).toEqual(
      refusals,
    );
  });
});

describe("as JSON", () => {
  const record: RefusedTelemetryRecord = reads([
    [
      "2026-11-20T14:03:00.000Z",
      {
        logs: {
          state: USED_UP,
          exhaustedAt: "2026-11-20T14:02:07.000Z",
          droppedBytes: 4096,
          droppedRequests: 3,
        },
        key: { throttledRequests: 2 },
      },
    ],
  ]);

  test("a scan result keeps it under its own keys, and reads it back as it was", () => {
    const result: JSONObject = {
      logsRead: 10,
      ...writeRefusedTelemetryRecord(record),
    };

    expect(Object.keys(result)).toEqual([
      "logsRead",
      REFUSED_TELEMETRY_RESULT_KEY,
      REFUSED_TELEMETRY_OBSERVATION_RESULT_KEY,
    ]);
    expect(
      readRefusedTelemetryRecord(JSON.parse(JSON.stringify(result))),
    ).toEqual(record);
  });

  test("a result from before it was kept reads as nothing refused, and no read yet", () => {
    expect(readRefusedTelemetryRecord({ logsRead: 3 })).toEqual({
      observation: null,
      refusals: [],
    });
    expect(readRefusedTelemetryRecord(undefined)).toEqual({
      observation: null,
      refusals: [],
    });
  });

  test("an entry that is not one is left out, the rest read", () => {
    const good: JSONObject = writeRefusedTelemetryRecord(record)[
      REFUSED_TELEMETRY_RESULT_KEY
    ] as unknown as JSONObject;

    expect(
      readRefusedTelemetryList([
        ...(good as unknown as Array<JSONObject>),
        null,
        "a string",
        { signal: "Metrics", kind: "budget-used-up", from: "x" },
        {
          signal: ProductType.Logs,
          kind: "something else",
          scope: "project",
          from: "2026-11-20T00:00:00.000Z",
          to: null,
        },
        {
          signal: ProductType.Logs,
          kind: RefusedTelemetryKind.RateLimited,
          scope: TelemetryIngestionBudgetScope.Project,
          from: "not a date",
          to: null,
        },
      ]),
    ).toEqual(record.refusals);
    expect(readRefusedTelemetryList({ not: "a list" })).toEqual([]);
  });

  test("a count that is not one reads as 0, never as a negative or a fraction", () => {
    expect(
      readRefusedTelemetryEntry({
        signal: ProductType.Traces,
        kind: RefusedTelemetryKind.RateLimited,
        scope: TelemetryIngestionBudgetScope.Label,
        scopeId: LABEL_ID,
        scopeName: "edge",
        from: "2026-11-20T00:00:00.000Z",
        to: "2026-11-20T00:10:00.000Z",
        refusedBytes: -4,
        refusedRequests: 2.7,
      }),
    ).toEqual({
      signal: ProductType.Traces,
      kind: RefusedTelemetryKind.RateLimited,
      scope: TelemetryIngestionBudgetScope.Label,
      scopeId: LABEL_ID,
      scopeName: "edge",
      from: "2026-11-20T00:00:00.000Z",
      to: "2026-11-20T00:10:00.000Z",
      refusedBytes: 0,
      refusedRequests: 2,
    });
  });
});
