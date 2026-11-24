import { beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * Whose a batch of telemetry was, once the worker has filed its resources
 * (issues #6355, #6386): the batch's counted bytes shared out over its
 * resources, its teams' and labels' budgets checked and charged - a used-up
 * one drops the resource, and what it would have counted comes back off
 * the project's and the key's day - and its usage added to the five-minute
 * counters. The counters themselves are TelemetryIngestAttributionCounter's
 * (and its Valkey test's); here they are stubbed, to see what is asked of
 * them.
 */

jest.mock(
  "../../../../Server/Utils/Telemetry/TelemetryIngestAttributionSettings",
  () => {
    return {
      __esModule: true,
      default: { getProjectConfig: jest.fn() },
    };
  },
);

jest.mock(
  "../../../../Server/Utils/Telemetry/TelemetryIngestionBudgetSettings",
  () => {
    return {
      __esModule: true,
      default: {
        getInstanceSettings: jest.fn(),
        getProjectOverrides: jest.fn(),
      },
    };
  },
);

jest.mock(
  "../../../../Server/Utils/Telemetry/TelemetryIngestionBudgetCounter",
  () => {
    return {
      __esModule: true,
      default: { readDayCounters: jest.fn() },
    };
  },
);

jest.mock(
  "../../../../Server/Utils/Telemetry/TelemetryIngestAttributionCounter",
  () => {
    const actual: { default: Record<string, unknown> } = jest.requireActual(
      "../../../../Server/Utils/Telemetry/TelemetryIngestAttributionCounter",
    ) as { default: Record<string, unknown> };

    return {
      __esModule: true,
      ...actual,
      default: {
        getUsageField: (
          actual.default["getUsageField"] as (...args: Array<unknown>) => string
        ).bind(actual.default),
        settle: jest.fn(),
      },
    };
  },
);

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

import TelemetryIngestAttribution, {
  shareTelemetryIngestBytes,
  TelemetryIngestAttributionResource,
} from "../../../../Server/Utils/Telemetry/TelemetryIngestAttribution";
import TelemetryIngestAttributionCounter, {
  TelemetryIngestAttributionSettle,
} from "../../../../Server/Utils/Telemetry/TelemetryIngestAttributionCounter";
import TelemetryIngestAttributionSettings, {
  TelemetryIngestAttributionConfig,
} from "../../../../Server/Utils/Telemetry/TelemetryIngestAttributionSettings";
import TelemetryIngestionBudgetCounter, {
  TelemetryIngestionBudgetDayCounters,
} from "../../../../Server/Utils/Telemetry/TelemetryIngestionBudgetCounter";
import TelemetryIngestionBudgetSettings from "../../../../Server/Utils/Telemetry/TelemetryIngestionBudgetSettings";
import ProductType from "../../../../Types/MeteredPlan/ProductType";
import {
  getEmptyTelemetryIngestionBudgetStoredSettings,
  TELEMETRY_INGESTION_BUDGET_BYTES_PER_GB,
  TelemetryIngestionBudgetScope,
  TelemetryIngestionBudgetStoredSettings,
} from "../../../../Types/Telemetry/TelemetryIngestionBudget";
import ServiceType from "../../../../Types/Telemetry/ServiceType";

type MockFn = jest.Mock;

const GB: number = TELEMETRY_INGESTION_BUDGET_BYTES_PER_GB;
const PROJECT_ID: string = "a1a1a1a1-0000-4000-8000-000000000001";
const KEY_ID: string = "a1a1a1a1-0000-4000-8000-000000000002";
const TEAM_ID: string = "a1a1a1a1-0000-4000-8000-000000000003";
const LABEL_ID: string = "a1a1a1a1-0000-4000-8000-000000000004";
const CHECKOUT: string = "a1a1a1a1-0000-4000-8000-000000000005";
const CART: string = "a1a1a1a1-0000-4000-8000-000000000006";
const NOW: Date = new Date("2026-11-09T12:00:00Z");

const getProjectConfig: MockFn =
  TelemetryIngestAttributionSettings.getProjectConfig as unknown as MockFn;
const readDayCounters: MockFn =
  TelemetryIngestionBudgetCounter.readDayCounters as unknown as MockFn;
const settle: MockFn =
  TelemetryIngestAttributionCounter.settle as unknown as MockFn;

const logsBudget: (
  gb: number | null,
) => TelemetryIngestionBudgetStoredSettings = (
  gb: number | null,
): TelemetryIngestionBudgetStoredSettings => {
  const stored: TelemetryIngestionBudgetStoredSettings =
    getEmptyTelemetryIngestionBudgetStoredSettings();
  stored[ProductType.Logs] = {
    dailyBudgetInGB: gb,
    rateLimitInMBPerSecond: null,
  };
  return stored;
};

const counters: (usedBytes: number) => TelemetryIngestionBudgetDayCounters = (
  usedBytes: number,
): TelemetryIngestionBudgetDayCounters => {
  return {
    usedBytes: usedBytes,
    droppedBytes: 0,
    droppedRequests: 0,
    throttledRequests: 0,
    warningCrossedAt: null,
    exhaustedAt: null,
    warningNoticeSentAt: null,
    exhaustedNoticeSentAt: null,
  };
};

// The project's budgets: a team budget for checkout, a label budget for both.
const withBudgets: (data?: {
  teamGB?: number | null;
  labelGB?: number | null;
  usage?: boolean;
}) => TelemetryIngestAttributionConfig = (data?: {
  teamGB?: number | null;
  labelGB?: number | null;
  usage?: boolean;
}): TelemetryIngestAttributionConfig => {
  return {
    publishesUsageMetrics: Boolean(data?.usage),
    budgets: [
      {
        scope: TelemetryIngestionBudgetScope.Team,
        scopeId: TEAM_ID,
        dailyBudgetsInGB: logsBudget(data?.teamGB ?? 1),
      },
      {
        scope: TelemetryIngestionBudgetScope.Label,
        scopeId: LABEL_ID,
        dailyBudgetsInGB: logsBudget(data?.labelGB ?? null),
      },
    ],
    budgetsByServiceId: new Map([
      [CHECKOUT, [0, 1]],
      [CART, [1]],
    ]),
  };
};

const resource: (
  id: string,
  records: number,
  name?: string,
) => TelemetryIngestAttributionResource = (
  id: string,
  records: number,
  name: string = "svc",
): TelemetryIngestAttributionResource => {
  return {
    primaryEntityId: id,
    primaryEntityType: ServiceType.OpenTelemetry,
    name: name,
    records: records,
  };
};

const batch: (data?: {
  bytes?: number | null;
  signal?: ProductType;
  isRetry?: boolean;
  gate?: boolean;
}) => Promise<TelemetryIngestAttribution | null> = (data?: {
  bytes?: number | null;
  signal?: ProductType;
  isRetry?: boolean;
  gate?: boolean;
}): Promise<TelemetryIngestAttribution | null> => {
  return TelemetryIngestAttribution.forBatch({
    projectId: PROJECT_ID,
    signal: (data?.signal || ProductType.Logs) as never,
    bytes: data?.bytes === undefined ? 1000 : data.bytes,
    receivedAt: NOW,
    now: NOW,
    isRetry: data?.isRetry,
    gateCharge:
      data?.gate === false
        ? null
        : {
            dayId: "20261109T0000Z",
            signalSlug: "logs",
            countedBytes: 1000,
            isExact: true,
            scopes: [
              {
                scope: TelemetryIngestionBudgetScope.Project,
                scopeId: PROJECT_ID,
                warningBytes: null,
              },
              {
                scope: TelemetryIngestionBudgetScope.IngestionKey,
                scopeId: KEY_ID,
                warningBytes: null,
              },
            ],
          },
  });
};

const settled: () => TelemetryIngestAttributionSettle =
  (): TelemetryIngestAttributionSettle => {
    expect(settle).toHaveBeenCalledTimes(1);
    return settle.mock.calls[0]![0] as TelemetryIngestAttributionSettle;
  };

beforeEach(() => {
  jest.clearAllMocks();
  TelemetryIngestAttribution.clearState();
  getProjectConfig.mockResolvedValue(withBudgets() as never);
  (
    TelemetryIngestionBudgetSettings.getInstanceSettings as unknown as MockFn
  ).mockResolvedValue({
    budgets: getEmptyTelemetryIngestionBudgetStoredSettings(),
    warningPercent: 80,
    resetTime: "00:00",
    timezone: "UTC",
  } as never);
  (
    TelemetryIngestionBudgetSettings.getProjectOverrides as unknown as MockFn
  ).mockResolvedValue(null as never);
  readDayCounters.mockImplementation((async (days: Array<unknown>) => {
    return days.map(() => {
      return counters(0);
    });
  }) as never);
  settle.mockImplementation((async (data: TelemetryIngestAttributionSettle) => {
    return data.scopes.map(() => {
      return 1;
    });
  }) as never);
});

describe("shareTelemetryIngestBytes", () => {
  test("shares a whole out by weight, and the shares add up to it exactly", () => {
    expect(shareTelemetryIngestBytes(1000, [1, 1, 2])).toEqual([250, 250, 500]);

    const shares: Array<number> = shareTelemetryIngestBytes(1000, [1, 1, 1]);

    expect(shares).toEqual([334, 333, 333]);
    expect(
      shares.reduce((sum: number, share: number) => {
        return sum + share;
      }, 0),
    ).toBe(1000);
  });

  test("gives the remainder to the largest fractions, and nothing to a weight of none", () => {
    expect(shareTelemetryIngestBytes(10, [0, 3, 1])).toEqual([0, 8, 2]);
    expect(shareTelemetryIngestBytes(7, [Number.NaN, -1, 2])).toEqual([
      0, 0, 7,
    ]);
  });

  test("shares nothing of nothing, or among no weights", () => {
    expect(shareTelemetryIngestBytes(0, [1, 2])).toEqual([0, 0]);
    expect(shareTelemetryIngestBytes(100, [0, 0])).toEqual([0, 0]);
    expect(shareTelemetryIngestBytes(100, [])).toEqual([]);
  });

  test("always adds up, whatever the weights", () => {
    for (let run: number = 0; run < 200; run++) {
      const total: number = Math.floor(Math.random() * 1_000_000) + 1;
      const weights: Array<number> = Array.from(
        { length: 1 + Math.floor(Math.random() * 20) },
        () => {
          return Math.floor(Math.random() * 50);
        },
      );
      const shares: Array<number> = shareTelemetryIngestBytes(total, weights);
      const expected: number = weights.some((weight: number) => {
        return weight > 0;
      })
        ? total
        : 0;

      expect(
        shares.reduce((sum: number, share: number) => {
          return sum + share;
        }, 0),
      ).toBe(expected);
    }
  });
});

describe("a batch that needs no attribution", () => {
  test("is none for a project that uses neither team or label budgets nor usage metrics", async () => {
    getProjectConfig.mockResolvedValue(null as never);

    expect(await batch()).toBe(null);
    expect(readDayCounters).not.toHaveBeenCalled();
  });

  test("is none for security events, or a batch with no size", async () => {
    expect(await batch({ signal: ProductType.SecurityEvents })).toBe(null);
    expect(await batch({ bytes: null })).toBe(null);
    expect(await batch({ bytes: 0 })).toBe(null);
    expect(getProjectConfig).not.toHaveBeenCalled();
  });

  test("is none when no budget of the batch's signal is set and usage is not published", async () => {
    expect(await batch({ signal: ProductType.Traces })).toBe(null);
  });

  test("is none, never a throw, when the settings cannot be read", async () => {
    getProjectConfig.mockRejectedValue(new Error("Postgres is down") as never);

    expect(await batch()).toBe(null);
  });
});

describe("a team's or a label's budget", () => {
  test("admits the services of a budget with room, and charges it their share", async () => {
    const attribution: TelemetryIngestAttribution = (await batch())!;

    expect(await attribution.admitResource(resource(CHECKOUT, 3))).toBe(true);
    expect(await attribution.admitResource(resource(CART, 1))).toBe(true);

    await attribution.settle();

    const data: TelemetryIngestAttributionSettle = settled();

    // One read of the day's counters for the batch, then one settle.
    expect(readDayCounters).toHaveBeenCalledTimes(1);
    expect(data.scopes).toEqual([
      {
        scope: TelemetryIngestionBudgetScope.Team,
        scopeId: TEAM_ID,
        admittedBytes: 750,
        droppedBytes: 0,
        droppedRequests: 0,
        dailyBudgetBytes: GB,
        warningBytes: Math.ceil(GB * 0.8),
      },
    ]);
    expect(data.refund).toBe(null);
    expect(data.usage).toEqual([]);
    expect(data.dayId).toBe("20261109T0000Z");
  });

  test("drops the services of a used-up budget, counts them as dropped, and takes them back off the project's and the key's day", async () => {
    readDayCounters.mockResolvedValue([counters(GB)] as never);

    const attribution: TelemetryIngestAttribution = (await batch())!;

    expect(await attribution.admitResource(resource(CHECKOUT, 3))).toBe(false);
    // A service no budget counts is always stored.
    expect(
      await attribution.admitResource(
        resource("a1a1a1a1-0000-4000-8000-000000000099", 1),
      ),
    ).toBe(true);
    expect(attribution.getDroppedResourceCount()).toBe(1);

    await attribution.settle();

    const data: TelemetryIngestAttributionSettle = settled();

    expect(data.scopes).toEqual([
      expect.objectContaining({
        scope: TelemetryIngestionBudgetScope.Team,
        admittedBytes: 0,
        droppedBytes: 750,
        droppedRequests: 1,
      }),
    ]);
    expect(data.refund).toEqual({
      bytes: 750,
      scopes: [
        { scope: TelemetryIngestionBudgetScope.Project, scopeId: PROJECT_ID },
        { scope: TelemetryIngestionBudgetScope.IngestionKey, scopeId: KEY_ID },
      ],
    });
  });

  test("is held to the project's own budget", async () => {
    getProjectConfig.mockResolvedValue(withBudgets({ teamGB: 50 }) as never);
    (
      TelemetryIngestionBudgetSettings.getProjectOverrides as unknown as MockFn
    ).mockResolvedValue(logsBudget(10) as never);

    const attribution: TelemetryIngestAttribution = (await batch())!;

    await attribution.admitResource(resource(CHECKOUT, 1));
    await attribution.settle();

    expect(settled().scopes[0]!.dailyBudgetBytes).toBe(10 * GB);
  });

  test("checks each budget a service counts in: a used-up label drops it though its team has room", async () => {
    getProjectConfig.mockResolvedValue(
      withBudgets({ teamGB: 5, labelGB: 1 }) as never,
    );
    readDayCounters.mockResolvedValue([counters(0), counters(GB)] as never);

    const attribution: TelemetryIngestAttribution = (await batch())!;

    expect(await attribution.admitResource(resource(CHECKOUT, 1))).toBe(false);
    expect(await attribution.admitResource(resource(CART, 1))).toBe(false);
  });

  test("reads the counters once in a few seconds, then trusts what it charged", async () => {
    const first: TelemetryIngestAttribution = (await batch())!;
    await first.admitResource(resource(CHECKOUT, 1));
    await first.settle();

    // The settle answered 1 byte used: the next batch reads that, not Valkey.
    const second: TelemetryIngestAttribution = (await batch())!;
    expect(await second.admitResource(resource(CHECKOUT, 1))).toBe(true);

    expect(readDayCounters).toHaveBeenCalledTimes(1);
  });

  test("a job's retry drops what a used-up budget drops, and counts nothing again", async () => {
    readDayCounters.mockResolvedValue([counters(GB)] as never);

    const attribution: TelemetryIngestAttribution = (await batch({
      isRetry: true,
    }))!;

    expect(await attribution.admitResource(resource(CHECKOUT, 1))).toBe(false);

    await attribution.settle();

    expect(settle).not.toHaveBeenCalled();
  });

  test("settles once, however often it is asked", async () => {
    const attribution: TelemetryIngestAttribution = (await batch())!;
    await attribution.admitResource(resource(CHECKOUT, 1));

    await attribution.settle();
    await attribution.settle();

    expect(settle).toHaveBeenCalledTimes(1);
  });

  test("stores the batch, uncounted, when the counters cannot be read or written", async () => {
    readDayCounters.mockRejectedValue(new Error("Valkey is down") as never);
    settle.mockRejectedValue(new Error("Valkey is down") as never);

    const attribution: TelemetryIngestAttribution = (await batch())!;

    expect(await attribution.admitResource(resource(CHECKOUT, 1))).toBe(true);
    await expect(attribution.settle()).resolves.toBeUndefined();
  });
});

describe("the usage counters", () => {
  test("add each admitted resource's share of the batch, by name and kind", async () => {
    getProjectConfig.mockResolvedValue({
      publishesUsageMetrics: true,
      budgets: [],
      budgetsByServiceId: new Map(),
    } as never);

    const attribution: TelemetryIngestAttribution = (await batch({
      bytes: 900,
    }))!;

    expect(
      await attribution.admitResource(resource(CHECKOUT, 2, "checkout")),
    ).toBe(true);
    expect(await attribution.admitResource(resource(CART, 1, "cart"))).toBe(
      true,
    );

    await attribution.settle();

    const data: TelemetryIngestAttributionSettle = settled();

    expect(data.scopes).toEqual([]);
    expect(
      data.usage.map((entry: { field: string; bytes: number }) => {
        return [JSON.parse(entry.field), entry.bytes];
      }),
    ).toEqual([
      [["logs", ServiceType.OpenTelemetry, CHECKOUT, "checkout"], 600],
      [["logs", ServiceType.OpenTelemetry, CART, "cart"], 300],
    ]);
  });

  test("leave out what a budget dropped: the usage is what was stored", async () => {
    getProjectConfig.mockResolvedValue(withBudgets({ usage: true }) as never);
    readDayCounters.mockResolvedValue([counters(GB)] as never);

    const attribution: TelemetryIngestAttribution = (await batch())!;

    await attribution.admitResource(resource(CHECKOUT, 1, "checkout"));
    await attribution.admitResource(
      resource("a1a1a1a1-0000-4000-8000-000000000099", 1, "other"),
    );
    await attribution.settle();

    expect(
      settled().usage.map((entry: { field: string; bytes: number }) => {
        return JSON.parse(entry.field)[3];
      }),
    ).toEqual(["other"]);
  });
});
