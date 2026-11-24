import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import CloudAccount from "../../../../Models/DatabaseModels/CloudAccount";
import CloudAccountService from "../../../../Server/Services/CloudAccountService";
import AzureCloudConnector from "../../../../Server/Utils/CloudConnection/Azure/AzureCloudConnector";
import { forgetAzureCostPacers } from "../../../../Server/Utils/CloudConnection/Azure/AzureCostManagement";
import CloudBudgetEvaluator from "../../../../Server/Utils/CloudConnection/CloudBudgetEvaluator";
import CloudConnectionLanes, {
  CloudCostsLaneOutcome,
} from "../../../../Server/Utils/CloudConnection/CloudConnectionLanes";
import CloudConnectionResourceSync from "../../../../Server/Utils/CloudConnection/CloudConnectionResourceSync";
import {
  CloudConnectionPullState,
  CloudConnectionSettings,
  CloudCostRecord,
} from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import CloudCostWriter from "../../../../Server/Utils/CloudConnection/CloudCostWriter";
import {
  CLOUD_COSTS_INTERVAL_MS,
  CloudAccountCostSummary,
  CloudCostState,
  readCloudAccountCostSummary,
} from "../../../../Types/Cloud/CloudCost";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import { CloudConnectionAuthMethod } from "../../../../Types/CloudConnection/CloudConnectionCatalog";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  DOCUMENTED_QPU_QUOTAS,
  FAKE_TENANT,
  FakeAzureCostManagement,
  FakeClock,
  FakeCostQuery,
  makeSubscriptionIds,
} from "./FakeAzureCostManagement";

/*
 * #10295, END TO END: A TENANT OF FIFTY SUBSCRIPTIONS LOADS ITS COSTS.
 *
 * The costs lane reads through the Azure connector against a Cost
 * Management that holds the tenant to Microsoft's documented QPU quotas -
 * 12 in ten seconds, 60 a minute, 600 an hour, a QPU for each month of data
 * - and refuses what passes one with a 429 and its retry-after, on a clock
 * of the test's own. Each sync is one read of the connection, five minutes
 * after the one before.
 *
 * Before: the subscriptions were asked two at a time as fast as Azure
 * answered, every 429 asked again after one, two and four seconds, and the
 * read stopped at its budget and waited twelve hours: the same third of the
 * subscriptions every time. Now every subscription's costs load over two
 * reads - each over a first read's days, never one starting over - and the
 * tenant's quotas are never passed, nor its third left to its other callers.
 *
 * Since #11007 a subscription's first read asks for its amortized cost and
 * its actual cost, twice the query units: the tenant loads over four or
 * five reads, a subscription put off whole, never half read. After that,
 * amortized cost is read at every read and actual cost once a day.
 */

const PROJECT: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const CONNECTION: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const START: Date = new Date("2026-11-20T12:00:00.000Z");
const READ_INTERVAL_MS: number = 5 * 60 * 1000;
const SUBSCRIPTIONS: Array<string> = makeSubscriptionIds(50);
const FIRST_READ_FROM: string = "2026-09-01T00:00:00Z";

const SETTINGS: CloudConnectionSettings = {
  provider: CloudProvider.Azure,
  projectId: PROJECT.toString(),
  config: {
    authMethod: CloudConnectionAuthMethod.AzureClientSecret,
    tenantId: FAKE_TENANT,
    clientId: "00001111-aaaa-2222-bbbb-3333cccc4444",
    cloud: "public",
    readScope: "organization",
  },
  secrets: { clientSecret: "client-secret~value" },
};

// Each subscription's CloudAccount row, and what the lane wrote on it.
const rowIds: Map<string, ObjectID> = new Map();
let summaries: Map<string, JSONObject> = new Map();
let writes: Array<{
  window: { start: Date; end: Date };
  accounts: Array<string>;
  records: number;
}> = [];

function summaryOf(subscriptionId: string): CloudAccountCostSummary | null {
  return readCloudAccountCostSummary(
    summaries.get(rowIds.get(subscriptionId)!.toString()),
  );
}

function stateCount(state: CloudCostState): number {
  return SUBSCRIPTIONS.filter((subscriptionId: string): boolean => {
    return summaryOf(subscriptionId)?.state === state;
  }).length;
}

async function sync(data: {
  tenant: FakeAzureCostManagement;
  state: CloudConnectionPullState;
}): Promise<{ outcome: CloudCostsLaneOutcome; asked: Array<FakeCostQuery> }> {
  const before: number = data.tenant.queries.length;
  const outcome: CloudCostsLaneOutcome = await CloudConnectionLanes.runCosts({
    projectId: PROJECT,
    provider: CloudProvider.Azure,
    connectionId: CONNECTION,
    connector: new AzureCloudConnector(),
    settings: SETTINGS,
    state: data.state,
    transport: data.tenant.api.transport,
    now: data.tenant.clock.now(),
    clock: (): Date => {
      return data.tenant.clock.now();
    },
    sleep: async (milliseconds: number): Promise<void> => {
      await data.tenant.clock.sleep(milliseconds);
    },
    deadlineMs: Date.now() + 8 * 60 * 1000,
    readIntervalMs: READ_INTERVAL_MS,
  });

  return { outcome, asked: data.tenant.queries.slice(before) };
}

beforeEach(() => {
  forgetAzureCostPacers();
  summaries = new Map();
  writes = [];
  rowIds.clear();

  for (const subscriptionId of SUBSCRIPTIONS) {
    rowIds.set(subscriptionId, ObjectID.generate());
  }

  // Jitter, fixed for the test: a tenth of its most.
  jest.spyOn(Math, "random").mockReturnValue(0.1);
  jest
    .spyOn(CloudConnectionResourceSync, "loadLinked")
    .mockImplementation(async (): Promise<never> => {
      return [] as never;
    });
  jest
    .spyOn(CloudAccountService, "findBy")
    .mockImplementation(async (): Promise<Array<CloudAccount>> => {
      return SUBSCRIPTIONS.map((subscriptionId: string): CloudAccount => {
        const row: CloudAccount = new CloudAccount();
        row.id = rowIds.get(subscriptionId)!;
        row.accountId = subscriptionId;
        row.costSummary = summaries.get(row.id.toString()) as never;
        return row;
      });
    });
  jest
    .spyOn(CloudAccountService, "updateOneById")
    .mockImplementation(
      async (input: { id: ObjectID; data: unknown }): Promise<number> => {
        summaries.set(
          input.id.toString(),
          (input.data as JSONObject)["costSummary"] as JSONObject,
        );
        return 1;
      },
    );
  jest
    .spyOn(CloudCostWriter, "write")
    .mockImplementation(
      async (input: {
        window: { start: Date; end: Date };
        records: Array<CloudCostRecord>;
        accountsRead: Set<string>;
      }) => {
        const records: number = input.records.filter(
          (record: CloudCostRecord): boolean => {
            return input.accountsRead.has(record.accountId.toLowerCase());
          },
        ).length;

        writes.push({
          window: input.window,
          accounts: Array.from(input.accountsRead),
          records,
        });

        return {
          seriesCount: records,
          rowsWritten: records,
          recordsWithoutAccount: 0,
        };
      },
    );
  jest
    .spyOn(CloudCostWriter, "summarize")
    .mockImplementation(
      async (input: {
        cloudAccountIds: Array<string>;
        now: Date;
      }): Promise<Map<string, CloudAccountCostSummary>> => {
        return new Map(
          input.cloudAccountIds.map(
            (id: string): [string, CloudAccountCostSummary] => {
              return [
                id,
                {
                  state: CloudCostState.Reading,
                  currency: "USD",
                  monthToDate: 50,
                  lastMonth: 75,
                  monthFullDays: 45,
                  lastMonthToDate: 50,
                  projectedMonth: 75,
                  last30Days: 75,
                  topServices: [],
                  readAt: input.now.toISOString(),
                },
              ];
            },
          ),
        );
      },
    );
  jest
    .spyOn(CloudBudgetEvaluator, "evaluateProject")
    .mockImplementation(async (): Promise<number> => {
      return 0;
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

/*
 * Reads five minutes apart until no subscription is left put off: the
 * reads it took.
 */
async function syncUntilRead(data: {
  tenant: FakeAzureCostManagement;
  state: CloudConnectionPullState;
  maxReads: number;
}): Promise<number> {
  let reads: number = 0;

  do {
    if (reads > 0) {
      data.tenant.clock.advance(READ_INTERVAL_MS);
    }

    await sync({ tenant: data.tenant, state: data.state });
    reads++;
  } while (data.state.costsPending && reads < data.maxReads);

  return reads;
}

describe("a tenant of 50 subscriptions", () => {
  test("loads every subscription's amortized and actual costs, a first read's days each, a read every five minutes within the tenant's quotas", async () => {
    const clock: FakeClock = new FakeClock(START);
    const tenant: FakeAzureCostManagement = new FakeAzureCostManagement({
      clock,
    });
    // The subscriptions the connection's metrics read reached.
    const state: CloudConnectionPullState = { accounts: [...SUBSCRIPTIONS] };

    // The first read: as many as the tenant's pace allows in the lane's two minutes.
    const first: {
      outcome: CloudCostsLaneOutcome;
      asked: Array<FakeCostQuery>;
    } = await sync({ tenant, state });

    /*
     * A subscription's first read is two queries over its first read's
     * days - amortized cost, then actual - 6 QPU, and OneUptime's share of
     * a minute is 40: 12 over the lane's two minutes, or 13 when the last
     * falls on its very end (the lane's time is the read's real time, a
     * few milliseconds short or not).
     */
    const readFirstCount: number = first.outcome.accountsRead;

    expect(first.outcome.ran).toBe(true);
    expect(readFirstCount).toBeGreaterThanOrEqual(12);
    expect(readFirstCount).toBeLessThanOrEqual(13);
    expect(stateCount(CloudCostState.Reading)).toBe(readFirstCount);
    expect(stateCount(CloudCostState.Queued)).toBe(50 - readFirstCount);
    // Each queued one says when it is read: the connection's next read.
    for (const subscriptionId of SUBSCRIPTIONS) {
      const summary: CloudAccountCostSummary = summaryOf(subscriptionId)!;

      if (summary.state === CloudCostState.Queued) {
        expect(summary.nextReadAt).toBe(
          new Date(START.getTime() + READ_INTERVAL_MS).toISOString(),
        );
      }
    }
    expect(state.costsReadAt).toBe(START.toISOString());
    expect(state.costsPending?.accounts).toHaveLength(50 - readFirstCount);
    expect(first.outcome.warnings).toEqual([
      expect.stringContaining(
        `Azure Cost Management limits how fast a tenant's costs are read: ${50 - readFirstCount} subscriptions' costs are read from`,
      ),
    ]);
    // Never the budget's word, never "read again shortly".
    expect(JSON.stringify(Array.from(summaries.values()))).not.toContain(
      "shortly",
    );

    /*
     * Each read five minutes on: only those put off, each read as far
     * back, none of them asked before - a subscription is put off whole,
     * never half read.
     */
    let reads: number = 1;
    let askedBefore: Set<string> = new Set(
      first.asked.map((query: FakeCostQuery): string => {
        return query.subscriptionId;
      }),
    );

    while (state.costsPending && reads < 6) {
      const putOff: Array<string> = [...state.costsPending.accounts];

      expect(
        putOff.filter((subscriptionId: string): boolean => {
          return askedBefore.has(subscriptionId);
        }),
      ).toEqual([]);

      clock.advance(READ_INTERVAL_MS);
      const next: {
        outcome: CloudCostsLaneOutcome;
        asked: Array<FakeCostQuery>;
      } = await sync({ tenant, state });
      reads++;

      const asked: Set<string> = new Set(
        next.asked.map((query: FakeCostQuery): string => {
          return query.subscriptionId;
        }),
      );

      for (const subscriptionId of asked) {
        expect(putOff).toContain(subscriptionId);
      }

      askedBefore = new Set([...askedBefore, ...asked]);
      // A read that carried on keeps the twelve-hour beat where it was.
      expect(state.costsReadAt).toBe(START.toISOString());
    }

    // 12 or 13 a read: four reads, or five.
    expect(reads).toBeLessThanOrEqual(5);
    expect(stateCount(CloudCostState.Reading)).toBe(50);
    expect(state.costsPending).toBeUndefined();

    /*
     * Every subscription asked twice, over a first read's days - amortized
     * cost, then actual - and never refused.
     */
    const answered: Map<
      string,
      Array<{ from: string; type: string }>
    > = tenant.answeredSubscriptions();

    expect(answered.size).toBe(50);
    for (const subscriptionId of SUBSCRIPTIONS) {
      expect(answered.get(subscriptionId)).toEqual([
        { from: FIRST_READ_FROM, type: "AmortizedCost" },
        { from: FIRST_READ_FROM, type: "ActualCost" },
      ]);
    }
    expect(tenant.refused()).toEqual([]);
    // When each one's actual cost was read: it is read again a day on.
    expect(Object.keys(state.azureActualCostsReadAt || {}).sort()).toEqual(
      SUBSCRIPTIONS.map((subscriptionId: string): string => {
        return subscriptionId.toLowerCase();
      }).sort(),
    );
    expect(
      tenant.queries.every((query: FakeCostQuery): boolean => {
        return query.clientType === "OneUptime";
      }),
    ).toBe(true);

    // Within two thirds of every documented quota, so never past one.
    expect(tenant.mostQpuInWindow.get(10_000)).toBeLessThanOrEqual(8);
    expect(tenant.mostQpuInWindow.get(60_000)).toBeLessThanOrEqual(40);
    expect(tenant.mostQpuInWindow.get(3_600_000)).toBeLessThanOrEqual(400);
    for (const quota of DOCUMENTED_QPU_QUOTAS) {
      expect(tenant.mostQpuInWindow.get(quota.spanMs)).toBeLessThanOrEqual(
        quota.limit,
      );
    }

    // Each read's costs written over the days they were read: the first read's.
    for (const write of writes) {
      expect(write.window.start).toEqual(new Date(FIRST_READ_FROM));
    }
    expect(
      writes.reduce((sum: number, write: { accounts: Array<string> }) => {
        return sum + write.accounts.length;
      }, 0),
    ).toBe(50);
  });

  test("twelve hours on, the whole read is a week of amortized cost a subscription: one read, the quotas kept", async () => {
    const clock: FakeClock = new FakeClock(START);
    const tenant: FakeAzureCostManagement = new FakeAzureCostManagement({
      clock,
    });
    const state: CloudConnectionPullState = { accounts: [...SUBSCRIPTIONS] };

    await syncUntilRead({ tenant, state, maxReads: 6 });

    // Not due again until twelve hours after the first read.
    clock.advance(READ_INTERVAL_MS);
    expect((await sync({ tenant, state })).outcome.ran).toBe(false);

    clock.nowMs = START.getTime() + CLOUD_COSTS_INTERVAL_MS + 60 * 1000;
    writes = [];

    const refresh: {
      outcome: CloudCostsLaneOutcome;
      asked: Array<FakeCostQuery>;
    } = await sync({ tenant, state });

    expect(refresh.outcome.accountsRead).toBe(50);
    expect(refresh.asked).toHaveLength(50);
    /*
     * A week each: a QPU each, never a first read again - and amortized
     * cost alone, the actual cost read twelve hours ago.
     */
    for (const query of refresh.asked) {
      expect(query.from).toBe("2026-11-14T00:00:00Z");
      expect(query.qpu).toBe(1);
      expect(query.type).toBe("AmortizedCost");
    }
    expect(writes).toHaveLength(1);
    expect(state.costsPending).toBeUndefined();
    expect(tenant.refused()).toEqual([]);
    expect(tenant.mostQpuInWindow.get(10_000)).toBeLessThanOrEqual(8);
    expect(tenant.mostQpuInWindow.get(60_000)).toBeLessThanOrEqual(40);
  });

  test("a day on, the actual cost too: a week of each a subscription, over the reads the quotas allow", async () => {
    const clock: FakeClock = new FakeClock(START);
    const tenant: FakeAzureCostManagement = new FakeAzureCostManagement({
      clock,
    });
    const state: CloudConnectionPullState = { accounts: [...SUBSCRIPTIONS] };

    await syncUntilRead({ tenant, state, maxReads: 6 });
    clock.nowMs = START.getTime() + CLOUD_COSTS_INTERVAL_MS + 60 * 1000;
    await syncUntilRead({ tenant, state, maxReads: 3 });

    // The whole read a day on: every subscription's actual cost is due again.
    clock.nowMs = START.getTime() + 2 * CLOUD_COSTS_INTERVAL_MS + 2 * 60 * 1000;
    const before: number = tenant.queries.length;
    const reads: number = await syncUntilRead({ tenant, state, maxReads: 4 });
    const asked: Array<FakeCostQuery> = tenant.queries.slice(before);

    // 2 QPU each and 40 a minute: two reads.
    expect(reads).toBeLessThanOrEqual(2);
    expect(stateCount(CloudCostState.Reading)).toBe(50);
    expect(state.costsPending).toBeUndefined();
    expect(asked).toHaveLength(100);
    for (const subscriptionId of SUBSCRIPTIONS) {
      expect(
        asked
          .filter((query: FakeCostQuery): boolean => {
            return query.subscriptionId === subscriptionId;
          })
          .map((query: FakeCostQuery): string => {
            return `${query.type} from ${query.from}`;
          }),
      ).toEqual([
        "AmortizedCost from 2026-11-14T00:00:00Z",
        "ActualCost from 2026-11-14T00:00:00Z",
      ]);
    }
    expect(tenant.refused()).toEqual([]);
    for (const quota of DOCUMENTED_QPU_QUOTAS) {
      expect(tenant.mostQpuInWindow.get(quota.spanMs)).toBeLessThanOrEqual(
        quota.limit,
      );
    }
  });

  test("other callers sharing the tenant's quota: their 429s are waited out as asked, and every subscription still loads", async () => {
    const clock: FakeClock = new FakeClock(START);
    const tenant: FakeAzureCostManagement = new FakeAzureCostManagement({
      clock,
    });
    const state: CloudConnectionPullState = { accounts: [...SUBSCRIPTIONS] };

    // Someone in the portal's cost analysis takes half of every ten seconds, for three minutes.
    tenant.othersUse(6, 3 * 60 * 1000);

    let reads: number = 0;

    while (stateCount(CloudCostState.Reading) < 50 && reads < 12) {
      await sync({ tenant, state });
      reads++;
      clock.advance(READ_INTERVAL_MS);
    }

    expect(stateCount(CloudCostState.Reading)).toBe(50);
    // Their three minutes take part of the first read's share: a read more at most.
    expect(reads).toBeLessThanOrEqual(6);
    // Azure turned some away while they were busy: OneUptime waited each out.
    expect(tenant.refused().length).toBeGreaterThan(0);

    // Each refused query is asked again no sooner than its retry-after said.
    const queries: Array<FakeCostQuery> = tenant.queries;

    for (let index: number = 0; index < queries.length - 1; index++) {
      const query: FakeCostQuery = queries[index]!;

      if (query.status !== 429) {
        continue;
      }

      const waitMs: number =
        Number(
          query.headers[
            "x-ms-ratelimit-microsoft.costmanagement-qpu-retry-after"
          ],
        ) * 1000;

      expect(queries[index + 1]!.atMs - query.atMs).toBeGreaterThanOrEqual(
        waitMs,
      );
    }

    /*
     * Every subscription's first read, over its first read's days: its
     * actual cost once; its amortized cost once, or again when another
     * caller's 429 put its actual cost past the read's time.
     */
    const answered: Map<
      string,
      Array<{ from: string; type: string }>
    > = tenant.answeredSubscriptions();
    let askedAgain: number = 0;

    for (const subscriptionId of SUBSCRIPTIONS) {
      const queries: Array<{ from: string; type: string }> =
        answered.get(subscriptionId)!;
      const amortized: number = queries.filter(
        (query: { type: string }): boolean => {
          return query.type === "AmortizedCost";
        },
      ).length;

      expect(
        queries.every((query: { from: string }): boolean => {
          return query.from === FIRST_READ_FROM;
        }),
      ).toBe(true);
      expect(
        queries.filter((query: { type: string }): boolean => {
          return query.type === "ActualCost";
        }),
      ).toHaveLength(1);
      expect(amortized).toBeGreaterThanOrEqual(1);
      askedAgain += amortized - 1;
    }

    // At most one a read.
    expect(askedAgain).toBeLessThanOrEqual(reads);
  });

  test("a subscription with figures keeps them, and counts, while its next read waits", async () => {
    const clock: FakeClock = new FakeClock(START);
    const tenant: FakeAzureCostManagement = new FakeAzureCostManagement({
      clock,
    });
    const state: CloudConnectionPullState = { accounts: [...SUBSCRIPTIONS] };

    await syncUntilRead({ tenant, state, maxReads: 6 });

    const before: Map<string, JSONObject> = new Map(summaries);

    // Twelve hours on, someone else takes every quota the tenant has, for an hour.
    clock.nowMs = START.getTime() + CLOUD_COSTS_INTERVAL_MS + 60 * 1000;
    tenant.othersUse(12, 60 * 60 * 1000);
    clock.advance(10_000);

    await sync({ tenant, state });

    expect(stateCount(CloudCostState.Reading)).toBe(50);
    expect(stateCount(CloudCostState.Queued)).toBe(0);
    // Their summaries untouched, figures and all.
    for (const [id, summary] of before) {
      expect(summaries.get(id)).toEqual(summary);
    }
    expect(state.costsPending?.accounts.length).toBeGreaterThan(0);
  });
});
