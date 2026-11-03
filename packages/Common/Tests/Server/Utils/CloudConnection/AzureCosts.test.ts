import AzureArm from "../../../../Server/Utils/CloudConnection/Azure/AzureArm";
import {
  describeAzureCostFailure,
  getAzureSavingKind,
  readAzureAdvisor,
  readAzureAdvisorRecommendation,
  readAzureCosts,
  readAzureUsageDate,
} from "../../../../Server/Utils/CloudConnection/Azure/AzureCosts";
import {
  CloudCostRecord,
  CloudSavingRecord,
} from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import { DataSourceHttpRequest } from "../../../../Server/Utils/DataSource/HttpFetch";
import LlmProviderError from "../../../../Server/Utils/LlmObservability/LlmProviderError";
import {
  CLOUD_SAVINGS_SOURCE_AZURE,
  CloudCostState,
  CloudSavingKind,
} from "../../../../Types/Cloud/CloudCost";
import { CloudConnectionFailureKind } from "../../../../Types/CloudConnection/CloudConnectionTest";
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
 * What an Azure subscription costs, from Cost Management's query API, and
 * the ways to spend less in it, from Azure Advisor - with Azure stood in:
 * Entra's token endpoint, the query answering in columns and rows (the
 * day a number, 20261119) and a nextLink to its next page, and Advisor
 * listing its recommendations.
 */

const TENANT: string = "00000000-0000-4000-8000-0000000000aa";
const SUBSCRIPTION: string = "11111111-2222-4333-8444-555555555555";
const VM: string = `/subscriptions/${SUBSCRIPTION}/resourceGroups/RG-Web/providers/Microsoft.Compute/virtualMachines/Web-1`;

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

const COLUMNS: Array<JSONObject> = [
  { name: "Cost", type: "Number" },
  { name: "UsageDate", type: "Number" },
  { name: "ResourceId", type: "String" },
  { name: "ServiceName", type: "String" },
  { name: "Currency", type: "String" },
];

function bodyOf(request: DataSourceHttpRequest): JSONObject {
  return JSON.parse(String(request.body)) as JSONObject;
}

describe("a subscription's daily costs from Cost Management", () => {
  test("by resource and service, every page, each resource in the Region OneUptime holds for it", async () => {
    const api: FakeProviderApi = createFakeProviderApi([
      tokenRoute(),
      {
        host: "management.azure.com",
        path: `/subscriptions/${SUBSCRIPTION}/providers/Microsoft.CostManagement/query`,
        method: "POST",
        respond: (_request: DataSourceHttpRequest, url: URL): FakeResponse => {
          if (url.searchParams.get("$skiptoken") === "page-2") {
            return json({
              properties: {
                columns: COLUMNS,
                rows: [[1.5, 20261119, "", "Bandwidth", "EUR"]],
              },
            });
          }

          return json({
            properties: {
              columns: COLUMNS,
              rows: [
                [41.25, 20261118, VM, "Virtual Machines", "EUR"],
                // A day that cost nothing is no record.
                [0, 20261118, VM, "Storage", "EUR"],
                // A row without a day is skipped.
                [3, null, VM, "Storage", "EUR"],
                [40, "20261119", VM.toUpperCase(), "Virtual Machines", "EUR"],
              ],
              nextLink: `https://management.azure.com/subscriptions/${SUBSCRIPTION}/providers/Microsoft.CostManagement/query?api-version=2023-11-01&$skiptoken=page-2`,
            },
          });
        },
      },
    ]);

    const read: { records: Array<CloudCostRecord>; complete: boolean } =
      await readAzureCosts({
        arm: armOf(api),
        subscriptionId: SUBSCRIPTION,
        start: new Date("2026-11-13T00:00:00.000Z"),
        end: new Date("2026-11-21T00:00:00.000Z"),
        regionsByResource: new Map([[VM.toLowerCase(), "westeurope"]]),
      });

    expect(read.complete).toBe(true);
    expect(read.records).toEqual([
      {
        accountId: SUBSCRIPTION,
        day: "2026-11-18",
        service: "Virtual Machines",
        region: "westeurope",
        // ARM ids are not case sensitive: kept in lower case, as Cost Management writes them.
        resourceId: VM.toLowerCase(),
        currency: "EUR",
        amount: 41.25,
      },
      {
        accountId: SUBSCRIPTION,
        day: "2026-11-19",
        service: "Virtual Machines",
        region: "westeurope",
        resourceId: VM.toLowerCase(),
        currency: "EUR",
        amount: 40,
      },
      {
        accountId: SUBSCRIPTION,
        day: "2026-11-19",
        service: "Bandwidth",
        region: "",
        resourceId: "",
        currency: "EUR",
        amount: 1.5,
      },
    ]);

    const queries: Array<DataSourceHttpRequest> = api.requests.filter(
      (request: DataSourceHttpRequest): boolean => {
        return request.url.includes("Microsoft.CostManagement/query");
      },
    );
    expect(queries).toHaveLength(2);
    expect(bodyOf(queries[0]!)).toEqual({
      type: "ActualCost",
      timeframe: "Custom",
      timePeriod: {
        from: "2026-11-13T00:00:00Z",
        to: "2026-11-20T23:59:59Z",
      },
      dataset: {
        granularity: "Daily",
        aggregation: { totalCost: { name: "Cost", function: "Sum" } },
        grouping: [
          { type: "Dimension", name: "ResourceId" },
          { type: "Dimension", name: "ServiceName" },
        ],
      },
    });
    expect(queries[0]!.url).toContain("api-version=2023-11-01");
    expect((queries[0]!.headers || {})["Authorization"]).toBe(
      "Bearer azure-access-token",
    );
  });

  test("a usage day as Cost Management writes it, a number or text", () => {
    expect(readAzureUsageDate(20261102)).toBe("2026-11-02");
    expect(readAzureUsageDate("20261102")).toBe("2026-11-02");
    expect(readAzureUsageDate("2026-11-02")).toBe("");
    expect(readAzureUsageDate(2026.5)).toBe("");
    expect(readAzureUsageDate(null)).toBe("");
  });
});

describe("the ways to spend less, from Azure Advisor", () => {
  function recommendation(
    id: string,
    overrides: JSONObject = {},
    extended: JSONObject = {},
  ): JSONObject {
    return {
      id: `${VM}/providers/Microsoft.Advisor/recommendations/${id}`,
      properties: {
        category: "Cost",
        impact: "High",
        impactedField: "Microsoft.Compute/virtualMachines",
        impactedValue: "Web-1",
        shortDescription: {
          problem: "Right-size or shutdown underutilized virtual machines",
          solution: "Right-size or shutdown underutilized virtual machines",
        },
        resourceMetadata: { resourceId: VM },
        extendedProperties: {
          recommendationType: "SkuChange",
          currentSku: "Standard_D4s_v5",
          targetSku: "Standard_D2s_v5",
          savingsAmount: "73.5",
          savingsCurrency: "EUR",
          regionId: "westeurope",
          ...extended,
        },
        ...overrides,
      },
    };
  }

  test("each cost recommendation with what it saves a month", async () => {
    const api: FakeProviderApi = createFakeProviderApi([
      tokenRoute(),
      {
        host: "management.azure.com",
        path: `/subscriptions/${SUBSCRIPTION}/providers/Microsoft.Advisor/recommendations`,
        respond: (): FakeResponse => {
          return json({
            value: [
              recommendation("rec-1"),
              // Only the annual figure: a twelfth of it a month.
              recommendation(
                "rec-2",
                {
                  shortDescription: {
                    solution:
                      "Buy reserved instances to save money over pay-as-you-go costs",
                  },
                },
                {
                  recommendationType: "",
                  savingsAmount: "",
                  annualSavingsAmount: 1200,
                },
              ),
              // Saves nothing: no recommendation.
              recommendation("rec-3", {}, { savingsAmount: "0" }),
              // Not a cost recommendation.
              recommendation("rec-4", { category: "Security" }),
            ],
          });
        },
      },
    ]);

    const read: {
      recommendations: Array<CloudSavingRecord>;
      complete: boolean;
    } = await readAzureAdvisor({
      arm: armOf(api),
      subscriptionId: SUBSCRIPTION,
    });

    expect(read.complete).toBe(true);
    expect(read.recommendations).toEqual([
      {
        recommendationId: `${VM}/providers/Microsoft.Advisor/recommendations/rec-1`,
        accountId: SUBSCRIPTION,
        region: "westeurope",
        resourceId: VM,
        resourceType: "Microsoft.Compute/virtualMachines",
        resourceName: "Web-1",
        kind: CloudSavingKind.Rightsize,
        action: "Right-size or shutdown underutilized virtual machines",
        currentConfiguration: "Standard_D4s_v5",
        recommendedConfiguration: "Standard_D2s_v5",
        monthlySavings: 73.5,
        monthlyCost: null,
        currency: "EUR",
        effort: "High",
        source: CLOUD_SAVINGS_SOURCE_AZURE,
      },
      expect.objectContaining({
        kind: CloudSavingKind.Commitment,
        monthlySavings: 100,
      }),
    ]);

    const listed: DataSourceHttpRequest = api.requests.find(
      (request: DataSourceHttpRequest): boolean => {
        return request.url.includes("Microsoft.Advisor");
      },
    )!;
    expect(new URL(listed.url).searchParams.get("$filter")).toBe(
      "Category eq 'Cost'",
    );
  });

  test("what each recommendation asks, by its type or its words", () => {
    expect(
      getAzureSavingKind({ recommendationType: "Shutdown", solution: "" }),
    ).toBe(CloudSavingKind.Idle);
    expect(
      getAzureSavingKind({
        recommendationType: "",
        solution: "Delete unattached disks",
      }),
    ).toBe(CloudSavingKind.Idle);
    expect(
      getAzureSavingKind({
        recommendationType: "",
        solution: "Consider Azure savings plan for compute",
      }),
    ).toBe(CloudSavingKind.Commitment);
    expect(
      getAzureSavingKind({
        recommendationType: "",
        solution: "Upgrade to a newer generation",
      }),
    ).toBe(CloudSavingKind.Upgrade);
    expect(
      getAzureSavingKind({ recommendationType: "", solution: "Something" }),
    ).toBe(CloudSavingKind.Other);
    expect(
      readAzureAdvisorRecommendation({
        item: { id: "", properties: {} },
        subscriptionId: SUBSCRIPTION,
      }),
    ).toBeNull();
  });
});

describe("why an Azure subscription's costs or savings could not be read", () => {
  test("an app without the role is told the role, and to run the command again", () => {
    const refused: LlmProviderError = new LlmProviderError({
      message: "Azure cost query failed: AuthorizationFailed",
      kind: CloudConnectionFailureKind.Permission,
      statusCode: 403,
      responseBody: '{"error":{"code":"AuthorizationFailed"}}',
    });

    expect(describeAzureCostFailure({ error: refused, what: "costs" })).toEqual(
      {
        state: CloudCostState.NotAllowed,
        message: expect.stringContaining("Cost Management Reader"),
      },
    );
    expect(
      describeAzureCostFailure({ error: refused, what: "savings" }).state,
    ).toBe(CloudCostState.NotAllowed);
  });

  test("an offer Cost Management does not answer for is said so", () => {
    expect(
      describeAzureCostFailure({
        error: new LlmProviderError({
          message: "Azure cost query failed",
          kind: CloudConnectionFailureKind.Other,
          statusCode: 400,
          responseBody:
            '{"error":{"code":"BadRequest","message":"Offer MS-AZR-0044P is not supported."}}',
        }),
        what: "costs",
      }).state,
    ).toBe(CloudCostState.NotSetUp);
    expect(
      describeAzureCostFailure({
        error: new Error("socket hang up"),
        what: "costs",
      }),
    ).toEqual({ state: CloudCostState.Failed, message: "socket hang up" });
  });
});
