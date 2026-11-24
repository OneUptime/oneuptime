import AzureCloudConnector from "../../../../Server/Utils/CloudConnection/Azure/AzureCloudConnector";
import {
  forgetAzureCostPacers,
  getAzureCostPacer,
} from "../../../../Server/Utils/CloudConnection/Azure/AzureCostManagement";
import {
  AZURE_ACTUAL_COSTS_INTERVAL_MS,
  getAzureCostPeriod,
  getAzureCostWindowQpu,
  isAzureActualCostDue,
  mergeAzureCostRecords,
} from "../../../../Server/Utils/CloudConnection/Azure/AzureCosts";
import {
  CloudConnectionPullState,
  CloudConnectionSettings,
  CloudCostRecord,
  CloudCostsOptions,
  CloudCostsResult,
  CloudReadBudget,
} from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import { DataSourceHttpRequest } from "../../../../Server/Utils/DataSource/HttpFetch";
import { CloudCostState } from "../../../../Types/Cloud/CloudCost";
import { CloudCostBasis } from "../../../../Types/Cloud/CloudCostBasis";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import { CloudConnectionAuthMethod } from "../../../../Types/CloudConnection/CloudConnectionCatalog";
import { JSONObject } from "../../../../Types/JSON";
import {
  FakeProviderApi,
  FakeResponse,
  createFakeProviderApi,
  json,
} from "../LlmObservability/FakeProviderApi";
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * An Azure subscription's costs on each basis (#11007): amortized cost -
 * a reservation's or savings plan's fee spread over the days it covered -
 * at every read, the basis the pages show by default; actual cost, as the
 * invoice bills it, once a day; net the amortized figure, as Azure takes
 * credits off at the billing account. With Cost Management stood in,
 * answering each query type with its own figures.
 */

const NOW: Date = new Date("2026-11-20T12:00:00.000Z");
const TENANT: string = "b3c1b5fc-828c-45fa-a1e1-10d74f6d6e9c";
const SUB: string = "d0cfe6b2-9ac0-4464-9919-dccaee2e48c0";
const VM: string = `/subscriptions/${SUB}/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/vm-1`;
const RESERVATION_ORDER: string =
  "/providers/Microsoft.Capacity/reservationOrders/00000000-0000-0000-0000-000000000001";
const LANE_WINDOW: { start: Date; end: Date } = {
  start: new Date("2026-11-13T00:00:00.000Z"),
  end: new Date("2026-11-21T00:00:00.000Z"),
};
const FIRST_WINDOW: { start: Date; end: Date } = {
  start: new Date("2026-09-01T00:00:00.000Z"),
  end: new Date("2026-11-21T00:00:00.000Z"),
};

const connector: AzureCloudConnector = new AzureCloudConnector();

function settings(): CloudConnectionSettings {
  return {
    provider: CloudProvider.Azure,
    projectId: "11111111-1111-4111-8111-111111111111",
    config: {
      authMethod: CloudConnectionAuthMethod.AzureClientSecret,
      tenantId: TENANT,
      clientId: "00001111-aaaa-2222-bbbb-3333cccc4444",
      cloud: "public",
    },
    secrets: { clientSecret: "client-secret~value" },
  };
}

const COLUMNS: Array<JSONObject> = [
  { name: "Cost" },
  { name: "UsageDate" },
  { name: "ResourceId" },
  { name: "ServiceName" },
  { name: "Currency" },
];

/*
 * Cost Management: the VM's day at $12 billed, $7.50 amortized (its
 * reservation's share), and the reservation bought that day, $2,920 billed
 * and nothing amortized - the purchase lands on the VM's days instead.
 */
function costManagement(): FakeProviderApi & {
  asked: () => Array<{ type: string; from: string }>;
} {
  const api: FakeProviderApi = createFakeProviderApi([
    {
      host: "login.microsoftonline.com",
      path: `/${TENANT}/oauth2/v2.0/token`,
      method: "POST",
      respond: (): FakeResponse => {
        return json({ access_token: "azure-token", expires_in: 3599 });
      },
    },
    {
      host: "management.azure.com",
      path: /^\/subscriptions\/[^/]+\/providers\/Microsoft\.CostManagement\/query$/,
      respond: (request: DataSourceHttpRequest): FakeResponse => {
        const body: JSONObject = JSON.parse(
          String(request.body),
        ) as JSONObject;

        if (body["type"] === "AmortizedCost") {
          return json({
            properties: {
              columns: COLUMNS,
              rows: [[7.5, 20261119, VM, "Virtual Machines", "USD"]],
            },
          });
        }

        return json({
          properties: {
            columns: COLUMNS,
            rows: [
              [12, 20261119, VM, "Virtual Machines", "USD"],
              [2920, 20261119, RESERVATION_ORDER, "Reservations", "USD"],
            ],
          },
        });
      },
    },
  ]);

  return Object.assign(api, {
    asked: (): Array<{ type: string; from: string }> => {
      return api.requests
        .filter((request: DataSourceHttpRequest): boolean => {
          return request.url.includes("Microsoft.CostManagement/query");
        })
        .map((request: DataSourceHttpRequest) => {
          const body: JSONObject = JSON.parse(
            String(request.body),
          ) as JSONObject;

          return {
            type: String(body["type"]),
            from: String((body["timePeriod"] as JSONObject)["from"]),
          };
        });
    },
  });
}

function options(
  api: FakeProviderApi,
  state: CloudConnectionPullState,
  now: Date = NOW,
): CloudCostsOptions {
  // The subscriptions the connection's metrics read reached: the one.
  state.accounts = state.accounts || [SUB];

  return {
    transport: api.transport,
    now: (): Date => {
      return now;
    },
    sleep: async (): Promise<void> => {},
    state,
    connectionId: "conn-1",
    budget: new CloudReadBudget({ maxRequests: 100, maxDurationMs: 60_000 }),
    start: LANE_WINDOW.start,
    end: LANE_WINDOW.end,
    firstReadWindow: FIRST_WINDOW,
    accounts: [SUB],
  };
}

function byResource(
  records: Array<CloudCostRecord>,
  resourceId: string,
): CloudCostRecord {
  return records.find((record: CloudCostRecord): boolean => {
    return record.resourceId === resourceId.toLowerCase();
  })!;
}

beforeEach(() => {
  forgetAzureCostPacers();
});

describe("when a subscription's actual cost is read", () => {
  test("never read, or a day ago: due; within the day: not", () => {
    expect(isAzureActualCostDue({ now: NOW })).toBe(true);
    expect(isAzureActualCostDue({ lastReadAt: "not a time", now: NOW })).toBe(
      true,
    );
    expect(
      isAzureActualCostDue({
        lastReadAt: new Date(
          NOW.getTime() - AZURE_ACTUAL_COSTS_INTERVAL_MS,
        ).toISOString(),
        now: NOW,
      }),
    ).toBe(true);
    expect(
      isAzureActualCostDue({
        lastReadAt: new Date(NOW.getTime() - 12 * 60 * 60 * 1000).toISOString(),
        now: NOW,
      }),
    ).toBe(false);
    // Between twelve-hour reads, so read every other one: once a day.
    expect(AZURE_ACTUAL_COSTS_INTERVAL_MS).toBeGreaterThan(12 * 60 * 60 * 1000);
    expect(AZURE_ACTUAL_COSTS_INTERVAL_MS).toBeLessThan(24 * 60 * 60 * 1000);
  });

  test("a window's period and query units: a unit for each month it touches", () => {
    expect(getAzureCostPeriod(LANE_WINDOW)).toEqual({
      from: "2026-11-13T00:00:00Z",
      to: "2026-11-20T23:59:59Z",
    });
    expect(getAzureCostWindowQpu(LANE_WINDOW)).toBe(1);
    expect(getAzureCostWindowQpu(FIRST_WINDOW)).toBe(3);
  });
});

describe("a subscription's records on each basis", () => {
  test("its actual rows are billed, its amortized rows amortized and net, each day, resource and service once", () => {
    const record: (
      resourceId: string,
      amount: number,
      day: string = "2026-11-19",
    ) => CloudCostRecord = (
      resourceId: string,
      amount: number,
      day: string = "2026-11-19",
    ): CloudCostRecord => {
      return {
        accountId: SUB,
        day,
        service: "Virtual Machines",
        region: "eastus",
        resourceId,
        currency: "USD",
        amount,
      };
    };

    expect(
      mergeAzureCostRecords({
        amortized: [record("vm-1", 7.5), record("vm-1", 0.5), record("vm-2", 3)],
        actual: [record("vm-1", 12), record("reservation", 2920)],
      }),
    ).toEqual([
      { ...record("vm-1", 12), amortizedAmount: 8, netAmount: 8 },
      { ...record("reservation", 2920), amortizedAmount: 0, netAmount: 0 },
      { ...record("vm-2", 0), amortizedAmount: 3, netAmount: 3 },
    ]);
  });

  test("without actual rows, the billed figure is nothing", () => {
    expect(
      mergeAzureCostRecords({
        amortized: [
          {
            accountId: SUB,
            day: "2026-11-19",
            service: "Virtual Machines",
            region: "",
            resourceId: "vm-1",
            currency: "USD",
            amount: 7.5,
          },
        ],
      }),
    ).toEqual([
      expect.objectContaining({
        amount: 0,
        amortizedAmount: 7.5,
        netAmount: 7.5,
      }),
    ]);
  });
});

describe("a subscription's reads, day by day", () => {
  test("its first: amortized and actual cost over a first read's days, every basis brought", async () => {
    const api: ReturnType<typeof costManagement> = costManagement();
    const state: CloudConnectionPullState = {};

    const read: CloudCostsResult = await connector.readCosts(
      settings(),
      options(api, state),
    );

    expect(api.asked()).toEqual([
      { type: "AmortizedCost", from: "2026-09-01T00:00:00Z" },
      { type: "ActualCost", from: "2026-09-01T00:00:00Z" },
    ]);
    expect(read.accounts).toEqual([
      { accountId: SUB, state: CloudCostState.Reading, window: FIRST_WINDOW },
    ]);
    expect(byResource(read.records, VM)).toMatchObject({
      amount: 12,
      amortizedAmount: 7.5,
      netAmount: 7.5,
    });
    // The reservation's purchase is billed the day it was bought, amortized never.
    expect(byResource(read.records, RESERVATION_ORDER)).toMatchObject({
      amount: 2920,
      amortizedAmount: 0,
      netAmount: 0,
    });
    expect(state.azureActualCostsReadAt).toEqual({
      [SUB]: NOW.toISOString(),
    });
  });

  test("twelve hours on: amortized cost alone over the last week, and the billed figures kept as they are", async () => {
    const api: ReturnType<typeof costManagement> = costManagement();
    const later: Date = new Date(NOW.getTime() + 12 * 60 * 60 * 1000);
    const state: CloudConnectionPullState = {
      costAccountsReadAt: { [SUB]: NOW.toISOString() },
      azureActualCostsReadAt: { [SUB]: NOW.toISOString() },
    };

    const read: CloudCostsResult = await connector.readCosts(
      settings(),
      options(api, state, later),
    );

    expect(api.asked()).toEqual([
      { type: "AmortizedCost", from: "2026-11-13T00:00:00Z" },
    ]);
    expect(read.accounts).toEqual([
      {
        accountId: SUB,
        state: CloudCostState.Reading,
        bases: [CloudCostBasis.Amortized, CloudCostBasis.Net],
      },
    ]);
    expect(byResource(read.records, VM)).toMatchObject({
      amount: 0,
      amortizedAmount: 7.5,
    });
    // Its actual cost still read when it was.
    expect(state.azureActualCostsReadAt).toEqual({
      [SUB]: NOW.toISOString(),
    });
  });

  test("a day on: actual cost again, over the last week like the amortized", async () => {
    const api: ReturnType<typeof costManagement> = costManagement();
    const later: Date = new Date(NOW.getTime() + 24 * 60 * 60 * 1000);
    const state: CloudConnectionPullState = {
      costAccountsReadAt: { [SUB]: NOW.toISOString() },
      azureActualCostsReadAt: { [SUB]: NOW.toISOString() },
    };

    const read: CloudCostsResult = await connector.readCosts(
      settings(),
      options(api, state, later),
    );

    expect(api.asked()).toEqual([
      { type: "AmortizedCost", from: "2026-11-13T00:00:00Z" },
      { type: "ActualCost", from: "2026-11-13T00:00:00Z" },
    ]);
    expect(read.accounts).toEqual([
      { accountId: SUB, state: CloudCostState.Reading },
    ]);
    expect(state.azureActualCostsReadAt).toEqual({
      [SUB]: later.toISOString(),
    });
  });

  test("read before costs were kept three ways: back as far as a first read, actual cost and all", async () => {
    const api: ReturnType<typeof costManagement> = costManagement();
    const state: CloudConnectionPullState = {
      costAccountsReadAt: {
        [SUB]: new Date(NOW.getTime() - 60 * 60 * 1000).toISOString(),
      },
    };

    const read: CloudCostsResult = await connector.readCosts(
      settings(),
      options(api, state),
    );

    expect(api.asked()).toEqual([
      { type: "AmortizedCost", from: "2026-09-01T00:00:00Z" },
      { type: "ActualCost", from: "2026-09-01T00:00:00Z" },
    ]);
    expect(read.accounts[0]).toEqual({
      accountId: SUB,
      state: CloudCostState.Reading,
      window: FIRST_WINDOW,
    });
  });

  test("one the read has no time to read twice over is put off whole: nothing asked, queued for its next read", async () => {
    const api: ReturnType<typeof costManagement> = costManagement();
    const state: CloudConnectionPullState = {};

    /*
     * The tenant's minute is spent (OneUptime's share, 40 QPU, a second
     * ago): its two first queries (6 QPU) fit in a minute, the read has
     * thirty seconds.
     */
    getAzureCostPacer(`public|${TENANT}`).charge(NOW.getTime() - 1000, 40);

    const read: CloudCostsResult = await connector.readCosts(settings(), {
      ...options(api, state),
      budget: new CloudReadBudget({ maxRequests: 100, maxDurationMs: 30_000 }),
    });

    // Not its amortized cost either: never half read.
    expect(api.asked()).toEqual([]);
    expect(read.accounts).toEqual([
      expect.objectContaining({
        accountId: SUB,
        state: CloudCostState.Queued,
      }),
    ]);
    expect(read.complete).toBe(false);
    expect(state.azureActualCostsReadAt).toEqual({});
  });
});
