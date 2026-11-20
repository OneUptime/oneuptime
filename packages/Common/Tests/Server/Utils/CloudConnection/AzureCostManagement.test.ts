import AzureArm from "../../../../Server/Utils/CloudConnection/Azure/AzureArm";
import {
  AZURE_COST_FIRST_BACKOFF_MS,
  AZURE_COST_MAX_JITTER_MS,
  AZURE_COST_PAGE_TRIES,
  AZURE_COST_QPU_QUOTAS,
  AZURE_COST_SPENT_QPU_HOLD_MS,
  AZURE_COST_SPENT_REQUESTS_HOLD_MS,
  AzureCostClock,
  AzureCostPacer,
  AzureCostReader,
  AzureCostThrottled,
  forgetAzureCostPacers,
  getAzureCostPacer,
  getAzureCostQpuCaps,
  getAzureCostQueryQpu,
} from "../../../../Server/Utils/CloudConnection/Azure/AzureCostManagement";
import { CloudReadBudget } from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import { DataSourceHttpRequest } from "../../../../Server/Utils/DataSource/HttpFetch";
import Dictionary from "../../../../Types/Dictionary";
import { JSONObject } from "../../../../Types/JSON";
import { SeededRandom, seededRandom } from "../../../Helpers/SeededRandom";
import {
  FakeProviderApi,
  FakeResponse,
  createFakeProviderApi,
  json,
} from "../LlmObservability/FakeProviderApi";
import {
  DOCUMENTED_QPU_QUOTAS,
  FAKE_TENANT,
  FakeAzureCostManagement,
  FakeClock,
} from "./FakeAzureCostManagement";
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Cost Management asked at the pace a tenant allows (#10295): what a query
 * may cost, the tenant's quotas kept within two thirds of each, one query at
 * a time, a throttle's wait honoured for the tenant or its scope, jitter, a
 * wait past the read's time put off, and a refused query charged nothing.
 */

const SUBSCRIPTION: string = "11111111-2222-4333-8444-555555555555";
const OTHER_SUBSCRIPTION: string = "99999999-2222-4333-8444-555555555555";
const SCOPE: string = `/subscriptions/${SUBSCRIPTION}`;
const START: Date = new Date("2026-11-20T12:00:00.000Z");

function body(from: string, to: string): JSONObject {
  return {
    type: "ActualCost",
    timeframe: "Custom",
    timePeriod: { from, to },
    dataset: { granularity: "Daily" },
  };
}

// A first read's days: the start of the month before last to today.
const FIRST_READ: JSONObject = body(
  "2026-09-01T00:00:00Z",
  "2026-11-20T23:59:59Z",
);
// A later read's week.
const WEEK: JSONObject = body("2026-11-13T00:00:00Z", "2026-11-20T23:59:59Z");

function armOf(api: FakeProviderApi): AzureArm {
  return new AzureArm({
    tenantId: FAKE_TENANT,
    clientId: "22222222-3333-4444-8555-666666666666",
    clientSecret: "client-secret-value-0000",
    cloud: "public",
    transport: api.transport,
  });
}

function readerOf(data: {
  api: FakeProviderApi;
  clock: FakeClock;
  pacer?: AzureCostPacer | undefined;
  budgetMs?: number | undefined;
  random?: (() => number) | undefined;
}): AzureCostReader {
  return new AzureCostReader({
    arm: armOf(data.api),
    now: (): Date => {
      return data.clock.now();
    },
    sleep: async (milliseconds: number): Promise<void> => {
      await data.clock.sleep(milliseconds);
    },
    pacer: data.pacer || new AzureCostPacer(),
    random:
      data.random ||
      ((): number => {
        return 0;
      }),
    budget: new CloudReadBudget({
      maxRequests: 1000,
      maxDurationMs: data.budgetMs ?? 120_000,
    }),
  });
}

// A Cost Management that answers each query in turn, from the given answers.
function scriptedApi(data: {
  answers: Array<FakeResponse>;
  clock: FakeClock;
  seen?: Array<{ atMs: number; url: string }> | undefined;
}): FakeProviderApi {
  let index: number = 0;

  return createFakeProviderApi([
    {
      host: "login.microsoftonline.com",
      path: `/${FAKE_TENANT}/oauth2/v2.0/token`,
      method: "POST",
      respond: (): FakeResponse => {
        return json({ access_token: "azure-token", expires_in: 3599 });
      },
    },
    {
      host: "management.azure.com",
      path: /^\/subscriptions\/[^/]+\/providers\/Microsoft\.CostManagement\/query$/,
      method: "POST",
      respond: (request: DataSourceHttpRequest): FakeResponse => {
        data.seen?.push({ atMs: data.clock.nowMs, url: request.url });
        const answer: FakeResponse =
          data.answers[Math.min(index, data.answers.length - 1)]!;
        index++;
        return answer;
      },
    },
  ]);
}

const THROTTLED: string =
  '{"error":{"code":"429","message":"Too many requests. Please retry."}}';

function throttled(headers: Dictionary<string>): FakeResponse {
  return { status: 429, body: THROTTLED, headers };
}

const ANSWERED: FakeResponse = json({ properties: { rows: [] } });

async function ask(
  reader: AzureCostReader,
  query: JSONObject = WEEK,
  scope: string = SCOPE,
): Promise<void> {
  await reader.query({
    scope,
    apiVersion: "2023-11-01",
    body: query,
    step: "cost query",
    maxPages: 10,
    onPage: (): void => {},
  });
}

beforeEach(() => {
  forgetAzureCostPacers();
});

describe("what a query may cost", () => {
  test.each([
    ["a first read, September 1 to November 20", FIRST_READ, 3],
    ["a week in one month", WEEK, 1],
    [
      "a week across a month's end",
      body("2026-10-27T00:00:00Z", "2026-11-02T23:59:59Z"),
      2,
    ],
    [
      "a commitment's 30 days",
      body("2026-10-21T00:00:00Z", "2026-11-19T23:59:59Z"),
      2,
    ],
    [
      "across a year's end",
      body("2025-12-01T00:00:00Z", "2026-02-10T23:59:59Z"),
      3,
    ],
    ["no days named", { type: "ActualCost" }, 1],
    ["days the wrong way round", body("2026-11-20", "2026-11-01"), 1],
  ])("%s: %p QPU", (_name: string, query: JSONObject, qpu: number) => {
    expect(getAzureCostQueryQpu(query)).toBe(qpu);
  });

  test("OneUptime keeps within two thirds of each documented quota", () => {
    expect(AZURE_COST_QPU_QUOTAS).toEqual(DOCUMENTED_QPU_QUOTAS);
    expect(getAzureCostQpuCaps()).toEqual([
      { spanMs: 10_000, cap: 8 },
      { spanMs: 60_000, cap: 40 },
      { spanMs: 3_600_000, cap: 400 },
    ]);
  });
});

describe("the tenant's quotas, as the pacer keeps them", () => {
  test("a query waits for the ten seconds to have room", () => {
    const pacer: AzureCostPacer = new AzureCostPacer();
    const t: number = START.getTime();

    pacer.charge(t, 3);
    pacer.charge(t + 1000, 3);

    // 6 of 8 used: a third query of 3 waits until the first leaves the window.
    expect(pacer.whenFits({ nowMs: t + 2000, qpu: 3, scope: SCOPE })).toBe(
      t + 10_000,
    );
    // One of 2 fits now.
    expect(pacer.whenFits({ nowMs: t + 2000, qpu: 2, scope: SCOPE })).toBe(
      t + 2000,
    );
  });

  test("the minute's quota holds past the ten seconds'", () => {
    const pacer: AzureCostPacer = new AzureCostPacer();
    const t: number = START.getTime();

    // 40 QPU over 50 seconds, never more than 8 in any ten.
    for (let second: number = 0; second < 50; second += 10) {
      pacer.charge(t + second * 1000, 8);
    }

    expect(
      pacer.whenFits({ nowMs: t + 55_000, qpu: 1, scope: SCOPE }),
    ).toBe(t + 60_000);
  });

  test("the hour's quota too", () => {
    const pacer: AzureCostPacer = new AzureCostPacer();
    const t: number = START.getTime();

    // 400 QPU in the first ten minutes.
    for (let index: number = 0; index < 50; index++) {
      pacer.charge(t + index * 12_000, 8);
    }

    const at: number = pacer.whenFits({
      nowMs: t + 20 * 60 * 1000,
      qpu: 8,
      scope: SCOPE,
    });

    expect(at).toBe(t + 60 * 60 * 1000);
  });

  test("a query larger than a share goes alone", () => {
    const pacer: AzureCostPacer = new AzureCostPacer();
    const t: number = START.getTime();

    pacer.charge(t, 1);

    expect(pacer.whenFits({ nowMs: t, qpu: 9, scope: SCOPE })).toBe(
      t + 10_000,
    );
  });

  test("a tenant's hold holds every scope; a scope's, that scope alone", () => {
    const pacer: AzureCostPacer = new AzureCostPacer();
    const t: number = START.getTime();

    pacer.holdScope(SCOPE, t + 37_000);

    expect(pacer.whenFits({ nowMs: t, qpu: 1, scope: SCOPE })).toBe(
      t + 37_000,
    );
    expect(
      pacer.whenFits({
        nowMs: t,
        qpu: 1,
        scope: `/subscriptions/${OTHER_SUBSCRIPTION}`,
      }),
    ).toBe(t);

    pacer.holdTenant(t + 60_000);

    expect(
      pacer.whenFits({
        nowMs: t,
        qpu: 1,
        scope: `/subscriptions/${OTHER_SUBSCRIPTION}`,
      }),
    ).toBe(t + 60_000);
  });

  test("a query settled at what Azure says it cost", () => {
    const pacer: AzureCostPacer = new AzureCostPacer();
    const t: number = START.getTime();
    const charge: { atMs: number; qpu: number } = pacer.charge(t, 3);

    pacer.settle(charge, 1);

    expect(pacer.getUsedQpu({ atMs: t, spanMs: 10_000 })).toBe(1);
    // Nothing that is no count changes it.
    pacer.settle(charge, Number.NaN);
    pacer.settle(charge, -1);
    expect(pacer.getUsedQpu({ atMs: t, spanMs: 10_000 })).toBe(1);
  });

  test("each tenant has one pacer, shared by its connections", () => {
    expect(getAzureCostPacer("public|tenant-a")).toBe(
      getAzureCostPacer("public|tenant-a"),
    );
    expect(getAzureCostPacer("public|tenant-a")).not.toBe(
      getAzureCostPacer("public|tenant-b"),
    );
  });

  test("seeded sweep: queries of random size and time never take a window past its share", () => {
    const random: SeededRandom = seededRandom(10295);

    for (let run: number = 0; run < 40; run++) {
      const pacer: AzureCostPacer = new AzureCostPacer();
      let nowMs: number = START.getTime();

      for (let query: number = 0; query < 120; query++) {
        const qpu: number = 1 + random(4);
        nowMs += random(4000);
        nowMs = pacer.whenFits({ nowMs, qpu, scope: SCOPE });
        pacer.charge(nowMs, qpu);

        for (const quota of getAzureCostQpuCaps()) {
          expect(
            pacer.getUsedQpu({ atMs: nowMs, spanMs: quota.spanMs }),
          ).toBeLessThanOrEqual(quota.cap);
        }
      }
    }
  });
});

describe("the read's clock", () => {
  test("moves on by its waits when the read's clock stands still", async () => {
    const waits: Array<number> = [];
    const clock: AzureCostClock = new AzureCostClock({
      now: (): Date => {
        return START;
      },
      sleep: async (milliseconds: number): Promise<void> => {
        waits.push(milliseconds);
      },
    });

    await clock.sleep(10_000);
    await clock.sleep(0);
    await clock.sleep(-5);

    expect(clock.nowMs()).toBe(START.getTime() + 10_000);
    expect(waits).toEqual([10_000]);
  });

  test("never reads going back", () => {
    let nowMs: number = START.getTime();
    const clock: AzureCostClock = new AzureCostClock({
      now: (): Date => {
        return new Date(nowMs);
      },
    });

    nowMs -= 5000;

    expect(clock.nowMs()).toBe(START.getTime());
  });
});

describe("a read's queries", () => {
  test("a tenant's queries are asked one at a time, paced, and never refused", async () => {
    const clock: FakeClock = new FakeClock(START);
    const tenant: FakeAzureCostManagement = new FakeAzureCostManagement({
      clock,
    });
    const reader: AzureCostReader = readerOf({
      api: tenant.api,
      clock,
      budgetMs: 10 * 60 * 1000,
    });

    for (let index: number = 0; index < 12; index++) {
      await ask(reader, FIRST_READ);
    }

    expect(tenant.refused()).toEqual([]);
    // Two thirds of 12 in ten seconds: two first reads (6 QPU) at a time.
    expect(tenant.mostQpuInWindow.get(10_000)).toBeLessThanOrEqual(8);
    expect(tenant.mostQpuInWindow.get(60_000)).toBeLessThanOrEqual(40);
    // 12 queries of 3 QPU, two each ten seconds: a minute.
    expect(clock.nowMs - START.getTime()).toBe(50_000);
  });

  test("429 with the QPU's retry-after: the tenant waits it, with jitter, and asks again", async () => {
    const clock: FakeClock = new FakeClock(START);
    const seen: Array<{ atMs: number; url: string }> = [];
    const api: FakeProviderApi = scriptedApi({
      clock,
      seen,
      answers: [
        throttled({
          "x-ms-ratelimit-microsoft.costmanagement-qpu-retry-after": "10",
        }),
        ANSWERED,
      ],
    });

    await ask(
      readerOf({
        api,
        clock,
        random: (): number => {
          return 0.5;
        },
      }),
    );

    expect(seen.map((entry: { atMs: number }): number => {
      return entry.atMs - START.getTime();
    })).toEqual([0, 10_500]);
  });

  test("a scope's own limit holds that scope alone: another subscription is asked meanwhile", async () => {
    const clock: FakeClock = new FakeClock(START);
    const pacer: AzureCostPacer = new AzureCostPacer();
    const seen: Array<{ atMs: number; url: string }> = [];
    const api: FakeProviderApi = scriptedApi({
      clock,
      seen,
      answers: [
        throttled({
          "x-ms-ratelimit-microsoft.costmanagement-entity-retry-after": "37",
          "x-ms-ratelimit-microsoft.costmanagement-clienttype-retry-after":
            "0",
        }),
        ANSWERED,
      ],
    });

    // A minute of time: the scope's 37 seconds fit, so the page waits and passes.
    await ask(readerOf({ api, clock, pacer, budgetMs: 60_000 }));

    expect(
      seen.map((entry: { atMs: number }): number => {
        return entry.atMs - START.getTime();
      }),
    ).toEqual([0, 37_000]);
    expect(
      pacer.whenFits({
        nowMs: START.getTime(),
        qpu: 1,
        scope: `/subscriptions/${OTHER_SUBSCRIPTION}`,
      }),
    ).toBe(START.getTime());
  });

  test("a wait past the read's time is not waited: the query is put off to it", async () => {
    const clock: FakeClock = new FakeClock(START);
    const api: FakeProviderApi = scriptedApi({
      clock,
      answers: [
        throttled({
          "x-ms-ratelimit-microsoft.costmanagement-qpu-retry-after": "1800",
        }),
      ],
    });

    let putOff: unknown = null;

    try {
      await ask(readerOf({ api, clock, budgetMs: 120_000 }));
    } catch (error) {
      putOff = error;
    }

    expect(putOff).toBeInstanceOf(AzureCostThrottled);
    expect((putOff as AzureCostThrottled).retryAt.getTime()).toBe(
      START.getTime() + 1_800_000,
    );
    // Asked once, and the read waited nothing.
    expect(api.requests.filter((request: DataSourceHttpRequest): boolean => {
      return request.url.includes("CostManagement");
    })).toHaveLength(1);
    expect(clock.nowMs).toBe(START.getTime());
  });

  test("a throttle that names no wait backs off from five seconds; after its tries, put off", async () => {
    const clock: FakeClock = new FakeClock(START);
    const seen: Array<{ atMs: number; url: string }> = [];
    const api: FakeProviderApi = scriptedApi({
      clock,
      seen,
      answers: [
        { status: 503, body: '{"error":{"code":"ServiceUnavailable"}}' },
      ],
    });

    let putOff: unknown = null;

    try {
      await ask(readerOf({ api, clock }));
    } catch (error) {
      putOff = error;
    }

    expect(AZURE_COST_PAGE_TRIES).toBe(3);
    expect(
      seen.map((entry: { atMs: number }): number => {
        return entry.atMs - START.getTime();
      }),
    ).toEqual([
      0,
      AZURE_COST_FIRST_BACKOFF_MS,
      AZURE_COST_FIRST_BACKOFF_MS * 3,
    ]);
    expect(putOff).toBeInstanceOf(AzureCostThrottled);
    // From the third, four times the first backoff.
    expect((putOff as AzureCostThrottled).retryAt.getTime()).toBe(
      START.getTime() + AZURE_COST_FIRST_BACKOFF_MS * 7,
    );
  });

  test("jitter adds up to a tenth of the wait, a second at most, never less than asked", async () => {
    for (const fraction of [0, 0.25, 0.999]) {
      for (const seconds of [3, 10, 60]) {
        const clock: FakeClock = new FakeClock(START);
        const seen: Array<{ atMs: number; url: string }> = [];
        const api: FakeProviderApi = scriptedApi({
          clock,
          seen,
          answers: [
            throttled({ "retry-after": String(seconds) }),
            ANSWERED,
          ],
        });

        await ask(
          readerOf({
            api,
            clock,
            random: (): number => {
              return fraction;
            },
          }),
        );

        const waited: number = seen[1]!.atMs - START.getTime();

        expect(waited).toBeGreaterThanOrEqual(seconds * 1000);
        expect(waited - seconds * 1000).toBeLessThanOrEqual(
          Math.min(AZURE_COST_MAX_JITTER_MS, seconds * 100),
        );
      }
    }
  });

  test("a quota said spent on an answer holds the next request: requests a minute, QPU ten seconds", async () => {
    const clock: FakeClock = new FakeClock(START);
    const seen: Array<{ atMs: number; url: string }> = [];
    const api: FakeProviderApi = scriptedApi({
      clock,
      seen,
      answers: [
        {
          status: 200,
          body: { properties: { rows: [] } },
          headers: {
            "x-ms-ratelimit-remaining-microsoft.costmanagement-tenant-requests":
              "DefaultQuota:0",
          },
        },
        {
          status: 200,
          body: { properties: { rows: [] } },
          headers: {
            "x-ms-ratelimit-microsoft.costmanagement-qpu-remaining":
              "QueryQuota10s:0,QueryQuota1min:40",
          },
        },
        ANSWERED,
      ],
    });
    const reader: AzureCostReader = readerOf({ api, clock });

    await ask(reader);
    await ask(reader);
    await ask(reader);

    expect(
      seen.map((entry: { atMs: number }): number => {
        return entry.atMs - START.getTime();
      }),
    ).toEqual([
      0,
      AZURE_COST_SPENT_REQUESTS_HOLD_MS,
      AZURE_COST_SPENT_REQUESTS_HOLD_MS + AZURE_COST_SPENT_QPU_HOLD_MS,
    ]);
  });

  test("a query refused for what it asked costs nothing; one answered, what Azure says", async () => {
    const clock: FakeClock = new FakeClock(START);
    const pacer: AzureCostPacer = new AzureCostPacer();
    const api: FakeProviderApi = scriptedApi({
      clock,
      answers: [
        {
          status: 403,
          body: '{"error":{"code":"AuthorizationFailed","message":"The client does not have authorization."}}',
        },
        {
          status: 200,
          body: { properties: { rows: [] } },
          headers: {
            "x-ms-ratelimit-microsoft.costmanagement-qpu-consumed": "1",
          },
        },
      ],
    });
    const reader: AzureCostReader = readerOf({ api, clock, pacer });

    await expect(ask(reader, FIRST_READ)).rejects.toThrow("HTTP 403");
    expect(pacer.getUsedQpu({ atMs: clock.nowMs, spanMs: 10_000 })).toBe(0);

    await ask(reader, FIRST_READ);
    // Charged 3 before it was sent, settled at the 1 Azure said.
    expect(pacer.getUsedQpu({ atMs: clock.nowMs, spanMs: 10_000 })).toBe(1);
  });

  test("a query that cannot fit before the read's time is up is put off without being sent", async () => {
    const clock: FakeClock = new FakeClock(START);
    const pacer: AzureCostPacer = new AzureCostPacer();
    const api: FakeProviderApi = scriptedApi({ clock, answers: [ANSWERED] });

    // The tenant's hour already spent by this process.
    for (let index: number = 0; index < 50; index++) {
      pacer.charge(START.getTime() - 30 * 60 * 1000 + index * 12_000, 8);
    }

    let putOff: unknown = null;

    try {
      await ask(readerOf({ api, clock, pacer, budgetMs: 120_000 }));
    } catch (error) {
      putOff = error;
    }

    expect(putOff).toBeInstanceOf(AzureCostThrottled);
    expect((putOff as AzureCostThrottled).retryAt.getTime()).toBe(
      START.getTime() + 30 * 60 * 1000,
    );
    expect(
      api.requests.filter((request: DataSourceHttpRequest): boolean => {
        return request.url.includes("CostManagement");
      }),
    ).toHaveLength(0);
  });

  test("two connections of a tenant share its pacer: their queries never overlap, nor pass its share", async () => {
    const clock: FakeClock = new FakeClock(START);
    const tenant: FakeAzureCostManagement = new FakeAzureCostManagement({
      clock,
    });
    const pacer: AzureCostPacer = getAzureCostPacer(
      armOf(tenant.api).getRateLimitKey(),
    );
    const first: AzureCostReader = readerOf({
      api: tenant.api,
      clock,
      pacer,
      budgetMs: 10 * 60 * 1000,
    });
    const second: AzureCostReader = readerOf({
      api: tenant.api,
      clock,
      pacer,
      budgetMs: 10 * 60 * 1000,
    });

    await Promise.all([
      (async (): Promise<void> => {
        for (let index: number = 0; index < 6; index++) {
          await ask(first, FIRST_READ);
        }
      })(),
      (async (): Promise<void> => {
        for (let index: number = 0; index < 6; index++) {
          await ask(second, FIRST_READ, `/subscriptions/${OTHER_SUBSCRIPTION}`);
        }
      })(),
    ]);

    expect(tenant.refused()).toEqual([]);
    expect(tenant.mostQpuInWindow.get(10_000)).toBeLessThanOrEqual(8);
    expect(tenant.queries).toHaveLength(12);
  });
});
