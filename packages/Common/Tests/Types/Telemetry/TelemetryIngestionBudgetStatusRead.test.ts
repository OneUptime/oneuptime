import ProductType from "../../../Types/MeteredPlan/ProductType";
import {
  readTelemetryIngestionBudgetStatus,
  TELEMETRY_INGESTION_BUDGET_DEFAULT_RESET_TIME,
  TELEMETRY_INGESTION_BUDGET_DEFAULT_TIMEZONE,
  TELEMETRY_INGESTION_BUDGET_DEFAULT_WARNING_PERCENT,
  TELEMETRY_INGESTION_BUDGET_SIGNALS,
  TelemetryIngestionBudgetLimitSource,
  TelemetryIngestionBudgetScope,
  TelemetryIngestionBudgetScopeStatus,
  TelemetryIngestionBudgetSignalStatus,
  TelemetryIngestionBudgetState,
  TelemetryIngestionBudgetStatus,
} from "../../../Types/Telemetry/TelemetryIngestionBudget";
import {
  budgeted,
  GB,
  hostileAnswers,
  KEY_ID,
  LOGS,
  OTHER_KEY_ID,
  scope,
  status,
  TRACES,
} from "../../UI/Components/TelemetryIngestionBudget/TelemetryIngestionBudgetFixtures";

/*
 * readTelemetryIngestionBudgetStatus: today's ingestion budgets as the
 * Dashboard and the Admin Dashboard read them off the network (issue #6486).
 * The explorers' banner and the budget card read every answer through it, so
 * an answer that is not a status - the {} an offline test double answered
 * every read it did not model with - is no status, and never a page that
 * throws while it draws ("Cannot read properties of undefined (reading
 * 'signals')"). A status the API sent reads back as itself.
 */

// A copy that shares nothing with the original, as JSON carries it.
const overTheWire: (value: unknown) => unknown = (value: unknown): unknown => {
  return JSON.parse(JSON.stringify(value)) as unknown;
};

// A busy day: a used-up and a past-warning signal, and two keys of their own.
const BUSY_DAY: TelemetryIngestionBudgetStatus = {
  ...status({
    timezone: "Asia/Kolkata",
    project: [
      budgeted(LOGS, {
        usedBytes: 10 * GB,
        percentUsed: 100,
        droppedBytes: 2 * GB,
        droppedRequests: 40,
        state: TelemetryIngestionBudgetState.Exhausted,
        dailyBudgetSource: TelemetryIngestionBudgetLimitSource.Project,
        warningCrossedAt: "2026-11-09T09:30:00.000Z",
        exhaustedAt: "2026-11-09T11:45:00.000Z",
      }),
      budgeted(TRACES, {
        usedBytes: 8.5 * GB,
        percentUsed: 85,
        rateLimitBytesPerSecond: 5 * 1024 * 1024,
        rateLimitSource: TelemetryIngestionBudgetLimitSource.Instance,
        throttledRequests: 1,
        state: TelemetryIngestionBudgetState.Warning,
        warningCrossedAt: "2026-11-09T10:00:00.000Z",
      }),
    ],
    ingestionKeys: [
      scope(
        [
          budgeted(LOGS, {
            dailyBudgetBytes: GB,
            dailyBudgetSource: TelemetryIngestionBudgetLimitSource.IngestionKey,
            usedBytes: GB,
            percentUsed: 100,
            state: TelemetryIngestionBudgetState.Exhausted,
          }),
        ],
        { id: KEY_ID, name: "Edge collector" },
      ),
      scope(
        [
          budgeted(TRACES, {
            dailyBudgetBytes: 2 * GB,
            dailyBudgetSource: TelemetryIngestionBudgetLimitSource.IngestionKey,
          }),
        ],
        { id: OTHER_KEY_ID, name: "Batch jobs" },
      ),
    ],
  }),
  resetTime: "05:30",
  warningPercent: 75,
};

// What the server answers for a project with no budget (the default).
const NO_BUDGET: TelemetryIngestionBudgetStatus = status({});

// What it answers while the counters cannot be read: every figure null.
const COUNTERS_DOWN: TelemetryIngestionBudgetStatus = status({
  countersAvailable: false,
  project: [
    budgeted(LOGS, {
      usedBytes: null,
      droppedBytes: null,
      droppedRequests: null,
      throttledRequests: null,
      percentUsed: null,
      state: TelemetryIngestionBudgetState.Unknown,
    }),
  ],
});

// The well-formed status with one field of it replaced.
const withField: (field: string, value: unknown) => Record<string, unknown> = (
  field: string,
  value: unknown,
): Record<string, unknown> => {
  return {
    ...(overTheWire(BUSY_DAY) as Record<string, unknown>),
    [field]: value,
  };
};

// The well-formed status with the project's signals replaced.
const withProjectSignals: (
  signals: Array<unknown>,
) => Record<string, unknown> = (
  signals: Array<unknown>,
): Record<string, unknown> => {
  return withField("project", {
    scope: TelemetryIngestionBudgetScope.Project,
    signals: signals,
  });
};

const readOrFail: (value: unknown) => TelemetryIngestionBudgetStatus = (
  value: unknown,
): TelemetryIngestionBudgetStatus => {
  const read: TelemetryIngestionBudgetStatus | null =
    readTelemetryIngestionBudgetStatus(value);

  if (!read) {
    throw new Error("Expected a status to be read.");
  }

  return read;
};

/*
 * Whether a value is a status every reader can draw without a guard of its
 * own: each figure a number or null, each state, source and scope one the
 * Dashboard knows, each signal one a budget is set for.
 */
const STATES: Array<string> = Object.values(TelemetryIngestionBudgetState);
const SOURCES: Array<string> = Object.values(
  TelemetryIngestionBudgetLimitSource,
);
const SCOPES: Array<string> = Object.values(TelemetryIngestionBudgetScope);

const isFigure: (value: unknown) => boolean = (value: unknown): boolean => {
  return (
    value === null || (typeof value === "number" && Number.isFinite(value))
  );
};

const isInstantOrNull: (value: unknown) => boolean = (
  value: unknown,
): boolean => {
  return (
    value === null ||
    (typeof value === "string" && Number.isFinite(Date.parse(value)))
  );
};

const signalProblems: (
  signal: TelemetryIngestionBudgetSignalStatus,
) => Array<string> = (
  signal: TelemetryIngestionBudgetSignalStatus,
): Array<string> => {
  const problems: Array<string> = [];

  if (!TELEMETRY_INGESTION_BUDGET_SIGNALS.includes(signal.signal)) {
    problems.push(`signal ${String(signal.signal)}`);
  }

  for (const figure of [
    signal.dailyBudgetBytes,
    signal.rateLimitBytesPerSecond,
    signal.usedBytes,
    signal.droppedBytes,
    signal.droppedRequests,
    signal.throttledRequests,
    signal.percentUsed,
  ]) {
    if (!isFigure(figure)) {
      problems.push(`figure ${String(figure)}`);
    }
  }

  for (const source of [signal.dailyBudgetSource, signal.rateLimitSource]) {
    if (source !== null && !SOURCES.includes(source)) {
      problems.push(`source ${String(source)}`);
    }
  }

  if (!STATES.includes(signal.state)) {
    problems.push(`state ${String(signal.state)}`);
  }

  if (
    !isInstantOrNull(signal.warningCrossedAt) ||
    !isInstantOrNull(signal.exhaustedAt)
  ) {
    problems.push("a time that is not one");
  }

  return problems;
};

const scopeProblems: (
  scopeStatus: TelemetryIngestionBudgetScopeStatus,
) => Array<string> = (
  scopeStatus: TelemetryIngestionBudgetScopeStatus,
): Array<string> => {
  const problems: Array<string> = [];

  if (!SCOPES.includes(scopeStatus.scope)) {
    problems.push(`scope ${String(scopeStatus.scope)}`);
  }

  if (!Array.isArray(scopeStatus.signals)) {
    return [...problems, "signals is not a list"];
  }

  for (const signal of scopeStatus.signals) {
    problems.push(...signalProblems(signal));
  }

  for (const text of [
    scopeStatus.ingestionKeyId,
    scopeStatus.ingestionKeyName,
  ]) {
    if (text !== undefined && typeof text !== "string") {
      problems.push(`key text ${String(text)}`);
    }
  }

  const signals: Array<string> = scopeStatus.signals.map(
    (signal: TelemetryIngestionBudgetSignalStatus): string => {
      return String(signal.signal);
    },
  );

  if (new Set(signals).size !== signals.length) {
    problems.push(`a signal twice in ${signals.join(", ")}`);
  }

  return problems;
};

const statusProblems: (
  read: TelemetryIngestionBudgetStatus,
) => Array<string> = (read: TelemetryIngestionBudgetStatus): Array<string> => {
  const problems: Array<string> = [];

  if (
    typeof read.resetsAt !== "string" ||
    !Number.isFinite(Date.parse(read.resetsAt))
  ) {
    problems.push("resetsAt");
  }

  if (typeof read.dayStartsAt !== "string") {
    problems.push("dayStartsAt");
  }

  if (typeof read.timezone !== "string" || read.timezone === "") {
    problems.push("timezone");
  }

  if (typeof read.resetTime !== "string") {
    problems.push("resetTime");
  }

  if (typeof read.warningPercent !== "number") {
    problems.push("warningPercent");
  }

  if (typeof read.countersAvailable !== "boolean") {
    problems.push("countersAvailable");
  }

  problems.push(...scopeProblems(read.project));

  if (
    read.project.scope !== TelemetryIngestionBudgetScope.Project ||
    read.project.ingestionKeyId !== undefined
  ) {
    problems.push("the project read as a key");
  }

  if (!Array.isArray(read.ingestionKeys)) {
    return [...problems, "ingestionKeys is not a list"];
  }

  for (const key of read.ingestionKeys) {
    problems.push(...scopeProblems(key));

    if (
      key.scope !== TelemetryIngestionBudgetScope.IngestionKey ||
      typeof key.ingestionKeyId !== "string" ||
      key.ingestionKeyId.trim() === ""
    ) {
      problems.push(`a key with no id: ${String(key.ingestionKeyId)}`);
    }
  }

  const keyIds: Array<string> = read.ingestionKeys.map(
    (key: TelemetryIngestionBudgetScopeStatus): string => {
      return String(key.ingestionKeyId);
    },
  );

  if (new Set(keyIds).size !== keyIds.length) {
    problems.push(`a key twice in ${keyIds.join(", ")}`);
  }

  return problems;
};

describe("a status the API sent", () => {
  test.each([
    ["a busy day: used up, past warning, keys of their own", BUSY_DAY],
    ["a project with no budget, the default", NO_BUDGET],
    ["counters that could not be read: every figure null", COUNTERS_DOWN],
  ])("reads back as itself: %s", (_name: string, sent: unknown) => {
    expect(readTelemetryIngestionBudgetStatus(sent)).toEqual(sent);
    // As it arrives over HTTP, too.
    expect(readTelemetryIngestionBudgetStatus(overTheWire(sent))).toEqual(sent);
  });

  test("keeps each key's id and name, so a key's page finds its own", () => {
    const read: TelemetryIngestionBudgetStatus = readOrFail(
      overTheWire(BUSY_DAY),
    );

    expect(
      read.ingestionKeys.map(
        (key: TelemetryIngestionBudgetScopeStatus): Array<unknown> => {
          return [key.scope, key.ingestionKeyId, key.ingestionKeyName];
        },
      ),
    ).toEqual([
      [TelemetryIngestionBudgetScope.IngestionKey, KEY_ID, "Edge collector"],
      [TelemetryIngestionBudgetScope.IngestionKey, OTHER_KEY_ID, "Batch jobs"],
    ]);
    expect(read.project).not.toHaveProperty("ingestionKeyId");
    expect(read.project).not.toHaveProperty("ingestionKeyName");
  });

  test("changes nothing it was handed", () => {
    const sent: unknown = overTheWire(BUSY_DAY);
    const before: string = JSON.stringify(sent);

    const read: TelemetryIngestionBudgetStatus = readOrFail(sent);
    read.project.signals.pop();
    read.ingestionKeys.pop();

    expect(JSON.stringify(sent)).toBe(before);
  });
});

describe("an answer that is not a status is no status", () => {
  test("the {} an offline test double answered every read it did not model with", () => {
    expect(readTelemetryIngestionBudgetStatus({})).toBe(null);
  });

  test.each([
    ["nothing", undefined],
    ["null", null],
    ["a list", []],
    ["a list of statuses", [BUSY_DAY]],
    ["text", "ok"],
    ["JSON as text", JSON.stringify(BUSY_DAY)],
    ["a proxy's page", "<!doctype html><title>Bad gateway</title>"],
    ["a number", 0],
    ["true", true],
    ["an error the server wrote", { message: "Not found" }],
    ["a project that is null", withField("project", null)],
    ["a project with no signals", withField("project", {})],
    [
      "a project whose signals are null",
      withField("project", { scope: "project", signals: null }),
    ],
    [
      "a project whose signals are not a list",
      withField("project", { scope: "project", signals: { logs: {} } }),
    ],
    ["a project that is a list", withField("project", [])],
    ["no reset time", withField("resetsAt", undefined)],
    ["an empty reset time", withField("resetsAt", "")],
    ["a reset time that is not a time", withField("resetsAt", "tomorrow-ish")],
    ["a reset time as a number", withField("resetsAt", 1762732800000)],
  ])("%s", (_name: string, answer: unknown) => {
    expect(readTelemetryIngestionBudgetStatus(answer)).toBe(null);
  });
});

describe("read leniently past that, field by field", () => {
  test("no list of keys is no key with a budget of its own", () => {
    for (const ingestionKeys of [undefined, null, {}, "none", 3]) {
      const read: TelemetryIngestionBudgetStatus = readOrFail(
        withField("ingestionKeys", ingestionKeys),
      );

      expect(read.ingestionKeys).toEqual([]);
      // The project is read all the same.
      expect(read.project).toEqual(BUSY_DAY.project);
    }
  });

  test("an entry of the keys that is not a key is left out, the rest kept", () => {
    const sent: TelemetryIngestionBudgetStatus = overTheWire(
      BUSY_DAY,
    ) as TelemetryIngestionBudgetStatus;

    const read: TelemetryIngestionBudgetStatus = readOrFail({
      ...sent,
      ingestionKeys: [
        null,
        "Edge collector",
        {},
        { ingestionKeyId: KEY_ID, signals: "logs" },
        sent.ingestionKeys[0],
        [sent.ingestionKeys[1]],
      ],
    });

    expect(read.ingestionKeys).toEqual([BUSY_DAY.ingestionKeys[0]]);
  });

  test("an entry of the signals that is not a signal is left out, the rest kept", () => {
    const logs: TelemetryIngestionBudgetSignalStatus =
      BUSY_DAY.project.signals[0]!;

    const read: TelemetryIngestionBudgetStatus = readOrFail(
      withProjectSignals([
        null,
        7,
        ProductType.Logs,
        [logs],
        {},
        { ...logs, signal: "Spans" },
        { ...logs, signal: ProductType.SessionReplay },
        logs,
      ]),
    );

    expect(read.project.signals).toEqual([logs]);
  });

  test("a signal with no figures: each not known, its state Unknown, nothing in force", () => {
    const read: TelemetryIngestionBudgetStatus = readOrFail(
      withProjectSignals([{ signal: ProductType.Logs }]),
    );

    expect(read.project.signals).toEqual([
      {
        signal: ProductType.Logs,
        dailyBudgetBytes: null,
        dailyBudgetSource: null,
        rateLimitBytesPerSecond: null,
        rateLimitSource: null,
        usedBytes: null,
        droppedBytes: null,
        droppedRequests: null,
        throttledRequests: null,
        percentUsed: null,
        state: TelemetryIngestionBudgetState.Unknown,
        warningCrossedAt: null,
        exhaustedAt: null,
      },
    ]);
  });

  test("a figure that is not a finite number is not known", () => {
    for (const figure of [
      "10737418240",
      "",
      true,
      {},
      [],
      Number.POSITIVE_INFINITY,
      Number.NaN,
    ]) {
      const read: TelemetryIngestionBudgetStatus = readOrFail(
        withProjectSignals([
          {
            ...BUSY_DAY.project.signals[0],
            dailyBudgetBytes: figure,
            usedBytes: figure,
            percentUsed: figure,
            droppedRequests: figure,
          },
        ]),
      );
      const logs: TelemetryIngestionBudgetSignalStatus =
        read.project.signals[0]!;

      expect([
        logs.dailyBudgetBytes,
        logs.usedBytes,
        logs.percentUsed,
        logs.droppedRequests,
      ]).toEqual([null, null, null, null]);
      // The figures that were numbers are kept.
      expect(logs.droppedBytes).toBe(2 * GB);
    }
  });

  test("a state or source the Dashboard does not know: Unknown, none; a scope is where it sits", () => {
    const read: TelemetryIngestionBudgetStatus = readOrFail({
      ...withProjectSignals([
        {
          ...BUSY_DAY.project.signals[0],
          state: "over-budget",
          dailyBudgetSource: "organisation",
          rateLimitSource: 4,
        },
      ]),
      ingestionKeys: [
        { ...BUSY_DAY.ingestionKeys[0], scope: "team" },
        { ...BUSY_DAY.ingestionKeys[1], scope: undefined },
      ],
    });

    expect(read.project.signals[0]).toMatchObject({
      state: TelemetryIngestionBudgetState.Unknown,
      dailyBudgetSource: null,
      rateLimitSource: null,
    });
    expect(read.project.scope).toBe(TelemetryIngestionBudgetScope.Project);
    expect(
      read.ingestionKeys.map((key: TelemetryIngestionBudgetScopeStatus) => {
        return key.scope;
      }),
    ).toEqual([
      TelemetryIngestionBudgetScope.IngestionKey,
      TelemetryIngestionBudgetScope.IngestionKey,
    ]);
  });

  test("a time a signal crossed a line that is not a time is not known", () => {
    const read: TelemetryIngestionBudgetStatus = readOrFail(
      withProjectSignals([
        {
          ...BUSY_DAY.project.signals[0],
          warningCrossedAt: "this morning",
          exhaustedAt: 1762688700000,
        },
      ]),
    );

    expect(read.project.signals[0]).toMatchObject({
      warningCrossedAt: null,
      exhaustedAt: null,
    });
  });

  test("a time zone it does not know is UTC: the reset is an instant, written with its zone", () => {
    for (const timezone of [undefined, null, "", "Mars/Olympus_Mons", 5]) {
      expect(readOrFail(withField("timezone", timezone)).timezone).toBe(
        TELEMETRY_INGESTION_BUDGET_DEFAULT_TIMEZONE,
      );
    }

    expect(readOrFail(withField("timezone", " Europe/Berlin ")).timezone).toBe(
      "Europe/Berlin",
    );
  });

  test("counters are unavailable only when the answer says so", () => {
    expect(
      readOrFail(withField("countersAvailable", false)).countersAvailable,
    ).toBe(false);

    for (const countersAvailable of [true, undefined, null, "false", 0]) {
      expect(
        readOrFail(withField("countersAvailable", countersAvailable))
          .countersAvailable,
      ).toBe(true);
    }
  });

  test("the day's start, reset time and warning share: the defaults when unreadable", () => {
    const read: TelemetryIngestionBudgetStatus = readOrFail({
      ...withField("dayStartsAt", "yesterday"),
      resetTime: "25:99",
      warningPercent: "lots",
    });

    expect(read.dayStartsAt).toBe("");
    expect(read.resetTime).toBe(TELEMETRY_INGESTION_BUDGET_DEFAULT_RESET_TIME);
    expect(read.warningPercent).toBe(
      TELEMETRY_INGESTION_BUDGET_DEFAULT_WARNING_PERCENT,
    );
    // The figures still read.
    expect(read.project).toEqual(BUSY_DAY.project);
  });

  test("a key's name that is not text is left out, the key kept", () => {
    for (const ingestionKeyName of [undefined, null, 42, {}, ["Edge"]]) {
      const read: TelemetryIngestionBudgetStatus = readOrFail(
        withField("ingestionKeys", [
          { ...BUSY_DAY.ingestionKeys[0], ingestionKeyName: ingestionKeyName },
        ]),
      );

      expect(read.ingestionKeys).toHaveLength(1);
      expect(read.ingestionKeys[0]!.ingestionKeyId).toBe(KEY_ID);
      expect(read.ingestionKeys[0]).not.toHaveProperty("ingestionKeyName");
      expect(read.ingestionKeys[0]!.signals).toEqual(
        BUSY_DAY.ingestionKeys[0]!.signals,
      );
    }

    // An empty name is still the name the key was given.
    expect(
      readOrFail(
        withField("ingestionKeys", [
          { ...BUSY_DAY.ingestionKeys[0], ingestionKeyName: "" },
        ]),
      ).ingestionKeys[0]!.ingestionKeyName,
    ).toBe("");
  });

  /*
   * The server lists only keys it has an id for, and the budget card keys
   * each key's rows by that id: a key without one could not be told from
   * the project's own rows, nor found on its own page.
   */
  test("a key with no id to tell it by is left out, the rest kept", () => {
    for (const ingestionKeyId of [undefined, null, 42, {}, "", "  "]) {
      const read: TelemetryIngestionBudgetStatus = readOrFail(
        withField("ingestionKeys", [
          { ...BUSY_DAY.ingestionKeys[0], ingestionKeyId: ingestionKeyId },
          BUSY_DAY.ingestionKeys[1],
        ]),
      );

      expect(read.ingestionKeys).toEqual([BUSY_DAY.ingestionKeys[1]]);
    }
  });

  test("the project has no key id or name, whatever the answer says", () => {
    const read: TelemetryIngestionBudgetStatus = readOrFail(
      withField("project", {
        ...BUSY_DAY.project,
        ingestionKeyId: KEY_ID,
        ingestionKeyName: "Edge collector",
      }),
    );

    expect(read.project).toEqual(BUSY_DAY.project);
    expect(read.project).not.toHaveProperty("ingestionKeyId");
    expect(read.project).not.toHaveProperty("ingestionKeyName");
  });

  /*
   * The server sends each signal of a scope once, and each key once. The
   * card draws a row per key and signal, keyed by both: a second entry
   * would be drawn over the first, so the first is the one read.
   */
  test("a second entry for the same signal or the same key is left out, the first kept", () => {
    const logs: TelemetryIngestionBudgetSignalStatus =
      BUSY_DAY.project.signals[0]!;
    const traces: TelemetryIngestionBudgetSignalStatus =
      BUSY_DAY.project.signals[1]!;

    const read: TelemetryIngestionBudgetStatus = readOrFail({
      ...withProjectSignals([
        logs,
        { ...logs, state: TelemetryIngestionBudgetState.Ok, usedBytes: 0 },
        traces,
        logs,
      ]),
      ingestionKeys: [
        BUSY_DAY.ingestionKeys[0],
        BUSY_DAY.ingestionKeys[1],
        { ...BUSY_DAY.ingestionKeys[0], ingestionKeyName: "A second copy" },
      ],
    });

    expect(read.project.signals).toEqual([logs, traces]);
    expect(read.ingestionKeys).toEqual(BUSY_DAY.ingestionKeys);
  });
});

describe("whatever it is handed", () => {
  test("never throws, and reads every answer to no status or one drawn without a guard", () => {
    let readAsStatus: number = 0;
    let readAsNoStatus: number = 0;

    for (const answer of hostileAnswers({
      from: overTheWire(BUSY_DAY),
      seed: 6486,
      count: 3000,
    })) {
      const read: TelemetryIngestionBudgetStatus | null =
        readTelemetryIngestionBudgetStatus(answer);

      if (read === null) {
        readAsNoStatus++;
        continue;
      }

      readAsStatus++;
      expect(statusProblems(read)).toEqual([]);
    }

    // The draws reach both outcomes, so neither half of the check is idle.
    expect(readAsStatus).toBeGreaterThan(1000);
    expect(readAsNoStatus).toBeGreaterThan(50);
  });
});
