import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The ingest-side decision of a telemetry ingestion budget (issue #5917):
 * which limits a request is held to, what is counted, what a refused sender
 * is told, and that nothing - a failing settings read, unavailable counters -
 * can turn the budget into a reason to lose telemetry it was not refusing.
 *
 * The settings and the counters are mocked at their module boundary: the
 * counters' own script is tested against a real Valkey in
 * TelemetryIngestionBudgetCounterValkey.test.ts.
 */

jest.mock("../../../../Server/Utils/Telemetry/TelemetryIngestionBudgetSettings", () => {
  return {
    __esModule: true,
    default: {
      getInstanceSettings: jest.fn(),
      getProjectOverrides: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Utils/Telemetry/TelemetryIngestionBudgetCounter", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../../Server/Utils/Telemetry/TelemetryIngestionBudgetCounter",
  ) as Record<string, unknown>;

  return {
    __esModule: true,
    ...actual,
    default: {
      consume: jest.fn(),
      reconcile: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Utils/Logger", () => {
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

import TelemetryIngestionBudget, {
  TelemetryIngestionBudgetAdmission,
  TelemetryIngestionBudgetAdmissionMode,
  TelemetryIngestionBudgetCharge,
  TelemetryIngestionBudgetJobCharge,
  TelemetryIngestionBudgetRefusalKind,
} from "../../../../Server/Utils/Telemetry/TelemetryIngestionBudget";
import TelemetryIngestionBudgetCounter, {
  TelemetryIngestionBudgetCounterMode,
  TelemetryIngestionBudgetCounterOutcome,
  TelemetryIngestionBudgetCounterRequest,
} from "../../../../Server/Utils/Telemetry/TelemetryIngestionBudgetCounter";
import TelemetryIngestionBudgetSettings, {
  getDefaultTelemetryIngestionBudgetInstanceSettings,
  TelemetryIngestionBudgetInstanceSettings,
} from "../../../../Server/Utils/Telemetry/TelemetryIngestionBudgetSettings";
import { TelemetryIngestBodySize } from "../../../../Server/Utils/Telemetry/TelemetryIngestBodySize";
import logger from "../../../../Server/Utils/Logger";
import ProductType from "../../../../Types/MeteredPlan/ProductType";
import ObjectID from "../../../../Types/ObjectID";
import {
  getEmptyTelemetryIngestionBudgetStoredSettings,
  TELEMETRY_INGESTION_BUDGET_BYTES_PER_GB,
  TELEMETRY_INGESTION_BUDGET_BYTES_PER_MB,
  TelemetryIngestionBudgetScope,
  TelemetryIngestionBudgetStoredSettings,
} from "../../../../Types/Telemetry/TelemetryIngestionBudget";
import TelemetryIngestionKeyPolicy from "../../../../Types/Telemetry/TelemetryIngestionKeyPolicy";
import TelemetryIngestionKeyType from "../../../../Types/Telemetry/TelemetryIngestionKeyType";

type MockFn = jest.Mock;

const GB: number = TELEMETRY_INGESTION_BUDGET_BYTES_PER_GB;
const MB: number = TELEMETRY_INGESTION_BUDGET_BYTES_PER_MB;
const PROJECT_ID: ObjectID = new ObjectID("5d3b0f1a-0000-4000-8000-000000000051");
const KEY_ID: ObjectID = new ObjectID("5d3b0f1a-0000-4000-8000-000000000052");
const NOW: Date = new Date("2026-11-09T12:00:00Z");

const getInstanceSettings: MockFn =
  TelemetryIngestionBudgetSettings.getInstanceSettings as unknown as MockFn;
const getProjectOverrides: MockFn =
  TelemetryIngestionBudgetSettings.getProjectOverrides as unknown as MockFn;
const consume: MockFn =
  TelemetryIngestionBudgetCounter.consume as unknown as MockFn;
const reconcile: MockFn =
  TelemetryIngestionBudgetCounter.reconcile as unknown as MockFn;

const logs: (
  daily: number | null,
  rate?: number | null,
) => TelemetryIngestionBudgetStoredSettings = (
  daily: number | null,
  rate: number | null = null,
): TelemetryIngestionBudgetStoredSettings => {
  const stored: TelemetryIngestionBudgetStoredSettings =
    getEmptyTelemetryIngestionBudgetStoredSettings();
  stored[ProductType.Logs] = {
    dailyBudgetInGB: daily,
    rateLimitInMBPerSecond: rate,
  };
  return stored;
};

const instance: (
  budgets: TelemetryIngestionBudgetStoredSettings,
  overrides?: Partial<TelemetryIngestionBudgetInstanceSettings>,
) => TelemetryIngestionBudgetInstanceSettings = (
  budgets: TelemetryIngestionBudgetStoredSettings,
  overrides: Partial<TelemetryIngestionBudgetInstanceSettings> = {},
): TelemetryIngestionBudgetInstanceSettings => {
  return {
    ...getDefaultTelemetryIngestionBudgetInstanceSettings(),
    budgets: budgets,
    ...overrides,
  };
};

const policy: (
  budgets: TelemetryIngestionBudgetStoredSettings | null,
) => TelemetryIngestionKeyPolicy = (
  budgets: TelemetryIngestionBudgetStoredSettings | null,
): TelemetryIngestionKeyPolicy => {
  return {
    ingestionKeyId: KEY_ID,
    projectId: PROJECT_ID,
    keyType: TelemetryIngestionKeyType.Server,
    allowedOrigins: [],
    pinnedServiceName: null,
    isEnabled: true,
    expiresAt: null,
    requestsPerMinuteLimit: null,
    ingestionBudgets: budgets,
  };
};

const measure: MockFn = jest.fn();

const admit: (data?: {
  mode?: TelemetryIngestionBudgetAdmissionMode;
  ingestionKeyPolicy?: TelemetryIngestionKeyPolicy | null;
  signal?: ProductType.Logs | ProductType.Traces;
}) => Promise<TelemetryIngestionBudgetAdmission> = (data?: {
  mode?: TelemetryIngestionBudgetAdmissionMode;
  ingestionKeyPolicy?: TelemetryIngestionKeyPolicy | null;
  signal?: ProductType.Logs | ProductType.Traces;
}): Promise<TelemetryIngestionBudgetAdmission> => {
  return TelemetryIngestionBudget.admit({
    projectId: PROJECT_ID,
    signal: data?.signal || ProductType.Logs,
    ingestionKeyPolicy: data?.ingestionKeyPolicy,
    mode: data?.mode || TelemetryIngestionBudgetAdmissionMode.Refuse,
    measure: measure as unknown as () => TelemetryIngestBodySize,
    now: NOW,
  });
};

const lastCounterRequest: () => TelemetryIngestionBudgetCounterRequest =
  (): TelemetryIngestionBudgetCounterRequest => {
    return consume.mock.calls[consume.mock.calls.length - 1]![0] as TelemetryIngestionBudgetCounterRequest;
  };

beforeEach(() => {
  jest.clearAllMocks();
  getInstanceSettings.mockResolvedValue(
    instance(getEmptyTelemetryIngestionBudgetStoredSettings()) as never,
  );
  getProjectOverrides.mockResolvedValue(null as never);
  consume.mockResolvedValue({
    outcome: TelemetryIngestionBudgetCounterOutcome.Admitted,
    warningCrossedScopeIndexes: [],
  } as never);
  reconcile.mockResolvedValue(true as never);
  measure.mockReturnValue({ bytes: 4096, isExact: true });
});

afterEach(() => {
  jest.clearAllMocks();
});

describe("TelemetryIngestionBudget.admit with no budget in force", () => {
  test("admits without measuring the body or touching the counters", async () => {
    const admission: TelemetryIngestionBudgetAdmission = await admit({
      ingestionKeyPolicy: policy(null),
    });

    expect(admission).toEqual({ refusal: null, charge: null });
    expect(measure).not.toHaveBeenCalled();
    expect(consume).not.toHaveBeenCalled();
  });

  test("admits uncounted when a project override of 0 lifts the instance default", async () => {
    getInstanceSettings.mockResolvedValue(instance(logs(10)) as never);
    getProjectOverrides.mockResolvedValue(logs(0) as never);

    expect(await admit()).toEqual({ refusal: null, charge: null });
    expect(consume).not.toHaveBeenCalled();
  });

  test("admits uncounted a signal other than the one with a budget", async () => {
    getInstanceSettings.mockResolvedValue(instance(logs(10)) as never);

    expect(await admit({ signal: ProductType.Traces })).toEqual({
      refusal: null,
      charge: null,
    });
    expect(consume).not.toHaveBeenCalled();
  });
});

describe("TelemetryIngestionBudget.admit with a budget", () => {
  test("counts the measured size against the project's budget, warning and rate", async () => {
    getInstanceSettings.mockResolvedValue(
      instance(logs(10, 5), { warningPercent: 90 }) as never,
    );

    const admission: TelemetryIngestionBudgetAdmission = await admit();

    expect(measure).toHaveBeenCalledTimes(1);
    expect(admission.refusal).toBe(null);

    const counted: TelemetryIngestionBudgetCounterRequest =
      lastCounterRequest();

    expect(counted.mode).toBe(TelemetryIngestionBudgetCounterMode.Refuse);
    expect(counted.bytes).toBe(4096);
    expect(counted.signalSlug).toBe("logs");
    expect(counted.projectId).toBe(PROJECT_ID.toString());
    expect(counted.dayId).toBe("20261109T0000Z");
    // Twelve hours left in the day, and a day more.
    expect(counted.dayTtlSeconds).toBe(12 * 3600 + 24 * 3600);
    expect(counted.scopes).toEqual([
      {
        scope: TelemetryIngestionBudgetScope.Project,
        scopeId: PROJECT_ID.toString(),
        dailyBudgetBytes: 10 * GB,
        warningBytes: Math.ceil(10 * GB * 0.9),
        rateLimitBytesPerSecond: 5 * MB,
      },
    ]);

    expect(admission.charge).toEqual({
      projectId: PROJECT_ID.toString(),
      signal: ProductType.Logs,
      dayId: "20261109T0000Z",
      dayTtlSeconds: 12 * 3600 + 24 * 3600,
      countedBytes: 4096,
      isExact: true,
      isPending: false,
      scopes: counted.scopes,
    });
  });

  test("uses the configured reset to pick the budget day", async () => {
    getInstanceSettings.mockResolvedValue(
      instance(logs(10), {
        resetTime: "18:00",
        timezone: "Europe/Berlin",
      }) as never,
    );

    await admit();

    // 18:00 in Berlin is 17:00 UTC in November: noon UTC is still in the 8th's day.
    expect(lastCounterRequest().dayId).toBe("20261108T1700Z");
  });

  test("adds the key's own budget as a second scope, held to the project's", async () => {
    getInstanceSettings.mockResolvedValue(instance(logs(10)) as never);

    await admit({ ingestionKeyPolicy: policy(logs(20, 2)) });

    const scopes: TelemetryIngestionBudgetCounterRequest["scopes"] =
      lastCounterRequest().scopes;

    expect(scopes).toHaveLength(2);
    expect(scopes[1]).toEqual({
      scope: TelemetryIngestionBudgetScope.IngestionKey,
      scopeId: KEY_ID.toString(),
      dailyBudgetBytes: 10 * GB,
      warningBytes: Math.ceil(10 * GB * 0.8),
      rateLimitBytesPerSecond: 2 * MB,
    });
  });

  test("counts the project's day too when only the key has a budget", async () => {
    await admit({ ingestionKeyPolicy: policy(logs(1)) });

    const scopes: TelemetryIngestionBudgetCounterRequest["scopes"] =
      lastCounterRequest().scopes;

    expect(scopes[0]).toEqual({
      scope: TelemetryIngestionBudgetScope.Project,
      scopeId: PROJECT_ID.toString(),
      dailyBudgetBytes: null,
      warningBytes: null,
      rateLimitBytesPerSecond: null,
    });
    expect(scopes[1]!.dailyBudgetBytes).toBe(1 * GB);
  });

  test("marks a size that is not exact, for the worker to settle", async () => {
    getInstanceSettings.mockResolvedValue(instance(logs(10)) as never);
    measure.mockReturnValue({ bytes: 90_000, isExact: false });

    const charge: TelemetryIngestionBudgetCharge | null = (await admit()).charge;

    expect(charge?.isExact).toBe(false);
    expect(charge?.countedBytes).toBe(90_000);

    const job: TelemetryIngestionBudgetJobCharge =
      TelemetryIngestionBudget.toJobCharge(charge!);

    expect(job).toEqual({
      dayId: "20261109T0000Z",
      signalSlug: "logs",
      countedBytes: 90_000,
      scopes: [
        {
          scope: TelemetryIngestionBudgetScope.Project,
          scopeId: PROJECT_ID.toString(),
          warningBytes: Math.ceil(10 * GB * 0.8),
        },
      ],
    });
  });

  test("logs the warning crossing, once, from the request that crossed it", async () => {
    getInstanceSettings.mockResolvedValue(instance(logs(10)) as never);
    consume.mockResolvedValue({
      outcome: TelemetryIngestionBudgetCounterOutcome.Admitted,
      warningCrossedScopeIndexes: [0],
    } as never);

    await admit();

    expect(logger.info as unknown as MockFn).toHaveBeenCalledWith(
      expect.stringContaining("crossed the warning threshold"),
    );
  });
});

describe("TelemetryIngestionBudget.admit refusals", () => {
  test("refuses a used-up project budget with a sentence that says until when", async () => {
    getInstanceSettings.mockResolvedValue(instance(logs(10)) as never);
    consume.mockResolvedValue({
      outcome: TelemetryIngestionBudgetCounterOutcome.DailyBudgetExhausted,
      scopeIndex: 0,
      isFirstExhaustion: true,
    } as never);

    const admission: TelemetryIngestionBudgetAdmission = await admit();

    expect(admission.charge).toBe(null);
    expect(admission.refusal).toEqual({
      kind: TelemetryIngestionBudgetRefusalKind.DailyBudgetExhausted,
      scope: TelemetryIngestionBudgetScope.Project,
      signal: ProductType.Logs,
      message:
        "This project's daily logs ingestion budget of 10 GB is used up, so OneUptime is not storing logs from this project until the budget resets at 2026-11-10 00:00 UTC.",
      retryAfterSeconds: null,
      resetsAt: new Date("2026-11-10T00:00:00.000Z"),
    });
    expect(logger.warn as unknown as MockFn).toHaveBeenCalledTimes(1);
  });

  test("logs only the day's first refusal", async () => {
    getInstanceSettings.mockResolvedValue(instance(logs(10)) as never);
    consume.mockResolvedValue({
      outcome: TelemetryIngestionBudgetCounterOutcome.DailyBudgetExhausted,
      scopeIndex: 0,
      isFirstExhaustion: false,
    } as never);

    await admit();
    await admit();

    expect(logger.warn as unknown as MockFn).not.toHaveBeenCalled();
  });

  test("names the key when the key's budget refused", async () => {
    getInstanceSettings.mockResolvedValue(instance(logs(10)) as never);
    consume.mockResolvedValue({
      outcome: TelemetryIngestionBudgetCounterOutcome.DailyBudgetExhausted,
      scopeIndex: 1,
      isFirstExhaustion: false,
    } as never);

    const admission: TelemetryIngestionBudgetAdmission = await admit({
      ingestionKeyPolicy: policy(logs(0.5)),
    });

    expect(admission.refusal?.scope).toBe(
      TelemetryIngestionBudgetScope.IngestionKey,
    );
    expect(admission.refusal?.message).toBe(
      "This ingestion key's daily logs ingestion budget of 0.5 GB is used up, so OneUptime is not storing logs sent with this key until the budget resets at 2026-11-10 00:00 UTC.",
    );
  });

  test("refuses over the rate with when to come back", async () => {
    getInstanceSettings.mockResolvedValue(instance(logs(null, 5)) as never);
    consume.mockResolvedValue({
      outcome: TelemetryIngestionBudgetCounterOutcome.RateLimited,
      scopeIndex: 0,
      retryAfterSeconds: 3,
    } as never);

    const admission: TelemetryIngestionBudgetAdmission = await admit();

    expect(admission.refusal?.kind).toBe(
      TelemetryIngestionBudgetRefusalKind.RateLimited,
    );
    expect(admission.refusal?.retryAfterSeconds).toBe(3);
    expect(admission.refusal?.message).toBe(
      "This project is sending logs faster than its ingestion rate limit of 5 MB per second. Retry in 3 seconds.",
    );
  });

  test("says one second, not one seconds", () => {
    expect(
      TelemetryIngestionBudget.getRefusalMessage({
        kind: TelemetryIngestionBudgetRefusalKind.RateLimited,
        scope: TelemetryIngestionBudgetScope.IngestionKey,
        signal: ProductType.SecurityEvents,
        limitBytes: MB / 2,
        resetsAt: NOW,
        retryAfterSeconds: 1,
      }),
    ).toBe(
      "This ingestion key is sending security events faster than its ingestion rate limit of 0.5 MB per second. Retry in 1 second.",
    );
  });
});

describe("TelemetryIngestionBudget.admit fails open", () => {
  test("admits uncounted when the counters are unavailable", async () => {
    getInstanceSettings.mockResolvedValue(instance(logs(10)) as never);
    consume.mockResolvedValue({
      outcome: TelemetryIngestionBudgetCounterOutcome.CounterUnavailable,
    } as never);

    expect(await admit()).toEqual({ refusal: null, charge: null });
  });

  test("admits uncounted when the settings cannot be read", async () => {
    getInstanceSettings.mockRejectedValue(new Error("Postgres is down") as never);

    expect(await admit()).toEqual({ refusal: null, charge: null });
    expect(consume).not.toHaveBeenCalled();
  });

  test("admits uncounted when measuring the body throws", async () => {
    getInstanceSettings.mockResolvedValue(instance(logs(10)) as never);
    measure.mockImplementation(() => {
      throw new Error("bad body");
    });

    expect(await admit()).toEqual({ refusal: null, charge: null });
  });
});

describe("a body sized after the check (Pyroscope)", () => {
  test("Check checks without measuring or counting, and leaves a pending charge", async () => {
    getInstanceSettings.mockResolvedValue(instance(logs(10)) as never);

    const admission: TelemetryIngestionBudgetAdmission = await admit({
      mode: TelemetryIngestionBudgetAdmissionMode.Check,
    });

    expect(measure).not.toHaveBeenCalled();
    expect(lastCounterRequest().mode).toBe(
      TelemetryIngestionBudgetCounterMode.Check,
    );
    expect(lastCounterRequest().bytes).toBe(0);
    expect(admission.charge?.isPending).toBe(true);
  });

  test("chargePending counts the size once it is known, without checking again", async () => {
    getInstanceSettings.mockResolvedValue(instance(logs(10)) as never);

    const pending: TelemetryIngestionBudgetCharge = (
      await admit({ mode: TelemetryIngestionBudgetAdmissionMode.Check })
    ).charge!;

    const charged: TelemetryIngestionBudgetCharge | null =
      await TelemetryIngestionBudget.chargePending({
        charge: pending,
        size: { bytes: 777, isExact: true },
        now: NOW,
      });

    expect(lastCounterRequest().mode).toBe(
      TelemetryIngestionBudgetCounterMode.Charge,
    );
    expect(lastCounterRequest().bytes).toBe(777);
    expect(lastCounterRequest().scopes).toEqual(pending.scopes);
    expect(charged).toEqual({
      ...pending,
      countedBytes: 777,
      isExact: true,
      isPending: false,
    });
  });

  test("chargePending answers null when the counters are unavailable", async () => {
    getInstanceSettings.mockResolvedValue(instance(logs(10)) as never);

    const pending: TelemetryIngestionBudgetCharge = (
      await admit({ mode: TelemetryIngestionBudgetAdmissionMode.Check })
    ).charge!;

    consume.mockResolvedValue({
      outcome: TelemetryIngestionBudgetCounterOutcome.CounterUnavailable,
    } as never);

    expect(
      await TelemetryIngestionBudget.chargePending({
        charge: pending,
        size: { bytes: 1, isExact: true },
      }),
    ).toBe(null);
  });
});

describe("TelemetryIngestionBudget.reconcile", () => {
  const jobCharge: TelemetryIngestionBudgetJobCharge = {
    dayId: "20261109T0000Z",
    signalSlug: "logs",
    countedBytes: 1000,
    scopes: [
      {
        scope: TelemetryIngestionBudgetScope.Project,
        scopeId: PROJECT_ID.toString(),
        warningBytes: 800,
      },
    ],
  };

  test("adds the difference between the decoded size and the size counted", async () => {
    await TelemetryIngestionBudget.reconcile({
      charge: jobCharge,
      decodedBytes: 15_000,
      now: NOW,
    });

    expect(reconcile).toHaveBeenCalledWith({
      dayId: "20261109T0000Z",
      signalSlug: "logs",
      scopes: jobCharge.scopes,
      deltaBytes: 14_000,
      nowMs: NOW.getTime(),
    });
  });

  test("settles nothing when the count was right, or the size is not a size", async () => {
    await TelemetryIngestionBudget.reconcile({
      charge: jobCharge,
      decodedBytes: 1000,
    });
    await TelemetryIngestionBudget.reconcile({
      charge: jobCharge,
      decodedBytes: Number.NaN,
    });
    await TelemetryIngestionBudget.reconcile({
      charge: jobCharge,
      decodedBytes: -1,
    });

    expect(reconcile).not.toHaveBeenCalled();
  });

  test("never throws when settling fails", async () => {
    reconcile.mockRejectedValue(new Error("Redis is down") as never);

    await expect(
      TelemetryIngestionBudget.reconcile({
        charge: jobCharge,
        decodedBytes: 5000,
      }),
    ).resolves.toBeUndefined();
  });
});
