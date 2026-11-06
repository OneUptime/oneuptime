import AzureArm from "../../../../Server/Utils/CloudConnection/Azure/AzureArm";
import {
  buildAzureCommitmentQuery,
  queryAzureCostRows,
  readAzureCommitments,
  summarizeAzureCommitmentRows,
} from "../../../../Server/Utils/CloudConnection/Azure/AzureCommitments";
import { DataSourceHttpRequest } from "../../../../Server/Utils/DataSource/HttpFetch";
import LlmProviderError from "../../../../Server/Utils/LlmObservability/LlmProviderError";
import { CloudCostState } from "../../../../Types/Cloud/CloudCost";
import {
  CloudCommitmentKind,
  CloudCommitmentKindFigures,
  CloudCommitmentSummary,
} from "../../../../Types/Cloud/CloudCommitments";
import { JSONObject } from "../../../../Types/JSON";
import {
  FakeProviderApi,
  FakeResponse,
  FakeRoute,
  createFakeProviderApi,
  json,
} from "../LlmObservability/FakeProviderApi";
import { describe, expect, test } from "@jest/globals";

/*
 * How much of an Azure subscription's spend its reservations and savings
 * plans cover, and how much of them is used, from Cost Management in
 * amortized cost - two queries a subscription, stood in: what each asks,
 * its pages, and how the rows are read (a kind against the pay-as-you-go
 * usage of the services it covers, or is bought for; what its unused
 * hours cost), and a subscription the app may not read.
 */

const TENANT: string = "00000000-0000-4000-8000-0000000000aa";
const SUBSCRIPTION: string = "11111111-2222-4333-8444-555555555555";
const NOW: Date = new Date("2026-11-20T12:00:00.000Z");
const QUERY_PATH: string = `/subscriptions/${SUBSCRIPTION}/providers/Microsoft.CostManagement/query`;

function tokenRoute(): FakeRoute {
  return {
    host: "login.microsoftonline.com",
    path: `/${TENANT}/oauth2/v2.0/token`,
    method: "POST",
    respond: (): FakeResponse => {
      return json({ access_token: "azure-access-token", expires_in: 3599 });
    },
  };
}

function armOf(api: FakeProviderApi): AzureArm {
  return new AzureArm({
    tenantId: TENANT,
    clientId: "22222222-3333-4444-8555-666666666666",
    clientSecret: "client-secret-value-0000",
    cloud: "public",
    transport: api.transport,
    sleep: async (): Promise<void> => {},
  });
}

function bodyOf(request: DataSourceHttpRequest): JSONObject {
  return JSON.parse(String(request.body)) as JSONObject;
}

// The groupings a query asked for, by their names.
function groupingOf(request: DataSourceHttpRequest): Array<string> {
  const dataset: JSONObject = bodyOf(request)["dataset"] as JSONObject;

  return (dataset["grouping"] as Array<JSONObject>).map(
    (entry: JSONObject): string => {
      return String(entry["name"]);
    },
  );
}

const USAGE_COLUMNS: Array<JSONObject> = [
  { name: "Cost", type: "Number" },
  { name: "PricingModel", type: "String" },
  { name: "ServiceName", type: "String" },
  { name: "Currency", type: "String" },
];
const CHARGE_COLUMNS: Array<JSONObject> = [
  { name: "Cost", type: "Number" },
  { name: "PricingModel", type: "String" },
  { name: "ChargeType", type: "String" },
  { name: "Currency", type: "String" },
];

// Cost Management, the usage query and the charges query each with their rows.
function costManagement(data: {
  usage: Array<Array<unknown>>;
  charges: Array<Array<unknown>>;
  error?: FakeResponse | undefined;
}): FakeProviderApi {
  return createFakeProviderApi([
    tokenRoute(),
    {
      host: "management.azure.com",
      path: QUERY_PATH,
      method: "POST",
      respond: (request: DataSourceHttpRequest): FakeResponse => {
        if (data.error) {
          return data.error;
        }

        const isUsage: boolean = groupingOf(request).includes("ServiceName");

        return json({
          properties: {
            columns: isUsage ? USAGE_COLUMNS : CHARGE_COLUMNS,
            rows: isUsage ? data.usage : data.charges,
          },
        });
      },
    },
  ]);
}

function usageRow(
  cost: number,
  pricingModel: string,
  service: string,
  currency: string = "EUR",
): Record<string, unknown> {
  return {
    cost,
    pricingmodel: pricingModel,
    servicename: service,
    currency,
  };
}

function chargeRow(
  cost: number,
  pricingModel: string,
  chargeType: string,
  currency: string = "EUR",
): Record<string, unknown> {
  return {
    cost,
    pricingmodel: pricingModel,
    chargetype: chargeType,
    currency,
  };
}

describe("the two queries", () => {
  test("amortized cost over the window: usage by pricing model and service, and the commitments' charges by pricing model and charge type", async () => {
    const api: FakeProviderApi = costManagement({ usage: [], charges: [] });

    await readAzureCommitments({
      arm: armOf(api),
      subscriptionId: SUBSCRIPTION,
      now: NOW,
    });

    const queries: Array<DataSourceHttpRequest> = api.requestsTo(QUERY_PATH);

    expect(queries).toHaveLength(2);
    expect(bodyOf(queries[0]!)).toEqual(
      buildAzureCommitmentQuery({
        window: {
          start: new Date("2026-10-21T00:00:00.000Z"),
          end: new Date("2026-11-20T00:00:00.000Z"),
        },
        grouping: ["PricingModel", "ServiceName"],
        filter: { dimension: "ChargeType", values: ["Usage"] },
      }),
    );
    expect(bodyOf(queries[0]!)).toEqual({
      type: "AmortizedCost",
      timeframe: "Custom",
      timePeriod: {
        from: "2026-10-21T00:00:00Z",
        to: "2026-11-19T23:59:59Z",
      },
      dataset: {
        granularity: "None",
        aggregation: { totalCost: { name: "Cost", function: "Sum" } },
        grouping: [
          { type: "Dimension", name: "PricingModel" },
          { type: "Dimension", name: "ServiceName" },
        ],
        filter: {
          dimensions: {
            name: "ChargeType",
            operator: "In",
            values: ["Usage"],
          },
        },
      },
    });
    expect(groupingOf(queries[1]!)).toEqual(["PricingModel", "ChargeType"]);
    expect(
      ((bodyOf(queries[1]!)["dataset"] as JSONObject)["filter"] as JSONObject)[
        "dimensions"
      ],
    ).toEqual({
      name: "PricingModel",
      operator: "In",
      values: ["SavingsPlan", "Reservation"],
    });
  });

  test("a query's every page, by its nextLink, each row by its columns' names", async () => {
    const api: FakeProviderApi = createFakeProviderApi([
      tokenRoute(),
      {
        host: "management.azure.com",
        path: QUERY_PATH,
        method: "POST",
        respond: (_request: DataSourceHttpRequest, url: URL): FakeResponse => {
          if (url.searchParams.get("$skiptoken") === "page-2") {
            return json({
              properties: {
                columns: USAGE_COLUMNS,
                rows: [[2, "OnDemand", "Storage", "EUR"]],
              },
            });
          }

          return json({
            properties: {
              columns: USAGE_COLUMNS,
              rows: [[10, "Reservation", "Virtual Machines", "EUR"]],
              nextLink: `https://management.azure.com${QUERY_PATH}?api-version=2023-11-01&$skiptoken=page-2`,
            },
          });
        },
      },
    ]);

    const rows: Array<Record<string, unknown>> = await queryAzureCostRows({
      arm: armOf(api),
      subscriptionId: SUBSCRIPTION,
      body: {},
      step: "test query",
    });

    expect(rows).toEqual([
      usageRow(10, "Reservation", "Virtual Machines"),
      usageRow(2, "OnDemand", "Storage"),
    ]);
  });
});

describe("what the rows say", () => {
  test("each kind against the pay-as-you-go usage of the services it covers, and what of it went unused", () => {
    const summary: {
      kinds: Array<CloudCommitmentKindFigures>;
      currency: string;
    } = summarizeAzureCommitmentRows({
      usageRows: [
        usageRow(600, "Reservation", "Virtual Machines"),
        usageRow(150, "Reservation", "SQL Database"),
        usageRow(300, "SavingsPlan", "Virtual Machines"),
        usageRow(400, "OnDemand", "Virtual Machines"),
        usageRow(100, "OnDemand", "SQL Database"),
        // Neither kind covers storage or bandwidth here: not theirs to cover.
        usageRow(900, "OnDemand", "Storage"),
        usageRow(80, "OnDemand", "Bandwidth"),
        usageRow(50, "Spot", "Virtual Machines"),
      ],
      chargeRows: [
        chargeRow(750, "Reservation", "Usage"),
        chargeRow(70, "Reservation", "UnusedReservation"),
        chargeRow(300, "SavingsPlan", "Usage"),
        chargeRow(0, "SavingsPlan", "UnusedSavingsPlan"),
      ],
    });

    expect(summary.currency).toBe("EUR");
    expect(summary.kinds).toEqual([
      {
        kind: CloudCommitmentKind.SavingsPlans,
        coveredSpend: 300,
        onDemandSpend: 400,
        commitmentSpend: 300,
        unusedSpend: 0,
      },
      {
        kind: CloudCommitmentKind.Reservations,
        coveredSpend: 750,
        onDemandSpend: 500,
        commitmentSpend: 820,
        unusedSpend: 70,
      },
    ]);
  });

  test("a subscription with no commitment: what ran on demand on the services each is bought for most", () => {
    const summary: {
      kinds: Array<CloudCommitmentKindFigures>;
      currency: string;
    } = summarizeAzureCommitmentRows({
      usageRows: [
        usageRow(400, "OnDemand", "Virtual Machines", "USD"),
        usageRow(120, "OnDemand", "Azure App Service", "USD"),
        usageRow(30, "OnDemand", "Azure Cosmos DB", "USD"),
        usageRow(15, "OnDemand", "Container Instances", "USD"),
        usageRow(900, "OnDemand", "Storage", "USD"),
      ],
      chargeRows: [],
    });

    expect(summary.currency).toBe("USD");
    expect(summary.kinds).toEqual([
      {
        kind: CloudCommitmentKind.SavingsPlans,
        coveredSpend: 0,
        onDemandSpend: 535,
        commitmentSpend: 0,
        unusedSpend: 0,
      },
      {
        kind: CloudCommitmentKind.Reservations,
        coveredSpend: 0,
        onDemandSpend: 550,
        commitmentSpend: 0,
        unusedSpend: 0,
      },
    ]);
  });

  test("in the currency most rows are in, case and all: a row in another is left out", () => {
    const summary: {
      kinds: Array<CloudCommitmentKindFigures>;
      currency: string;
    } = summarizeAzureCommitmentRows({
      usageRows: [
        usageRow(100, "reservation", "virtual machines", "eur"),
        usageRow(40, "OnDemand", "Virtual Machines", "EUR"),
        usageRow(999, "Reservation", "Virtual Machines", "USD"),
      ],
      chargeRows: [chargeRow(100, "Reservation", "Usage", "EUR")],
    });

    expect(summary.currency).toBe("EUR");
    expect(summary.kinds[1]).toEqual({
      kind: CloudCommitmentKind.Reservations,
      coveredSpend: 100,
      onDemandSpend: 40,
      commitmentSpend: 100,
      unusedSpend: 0,
    });
  });
});

describe("a subscription, read", () => {
  test("read: its kinds, in its currency, over 30 days", async () => {
    const summary: CloudCommitmentSummary = await readAzureCommitments({
      arm: armOf(
        costManagement({
          usage: [
            [600, "Reservation", "Virtual Machines", "EUR"],
            [400, "OnDemand", "Virtual Machines", "EUR"],
          ],
          charges: [
            [600, "Reservation", "Usage", "EUR"],
            [60, "Reservation", "UnusedReservation", "EUR"],
          ],
        }),
      ),
      subscriptionId: SUBSCRIPTION,
      now: NOW,
    });

    expect(summary.state).toBe(CloudCostState.Reading);
    expect(summary.currency).toBe("EUR");
    expect(summary.days).toBe(30);
    expect(summary.readAt).toBe(NOW.toISOString());
    expect(summary.kinds[1]).toEqual({
      kind: CloudCommitmentKind.Reservations,
      coveredSpend: 600,
      onDemandSpend: 400,
      commitmentSpend: 660,
      unusedSpend: 60,
    });
  });

  test("an app that may not read its costs: give it Cost Management Reader", async () => {
    const summary: CloudCommitmentSummary = await readAzureCommitments({
      arm: armOf(
        costManagement({
          usage: [],
          charges: [],
          error: {
            status: 403,
            body: '{"error":{"code":"AuthorizationFailed","message":"The client does not have authorization to perform action Microsoft.CostManagement/query/action."}}',
          },
        }),
      ),
      subscriptionId: SUBSCRIPTION,
      now: NOW,
    });

    expect(summary.state).toBe(CloudCostState.NotAllowed);
    expect(summary.message).toContain("Cost Management Reader");
    expect(summary.kinds).toEqual([]);
  });

  test("a refused secret fails the whole read", async () => {
    const api: FakeProviderApi = createFakeProviderApi([
      {
        host: "login.microsoftonline.com",
        path: `/${TENANT}/oauth2/v2.0/token`,
        method: "POST",
        respond: (): FakeResponse => {
          return {
            status: 401,
            body: '{"error":"invalid_client","error_description":"AADSTS7000215: Invalid client secret provided."}',
          };
        },
      },
    ]);

    await expect(
      readAzureCommitments({
        arm: armOf(api),
        subscriptionId: SUBSCRIPTION,
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(LlmProviderError);
  });
});
