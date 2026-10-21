import { describe, expect, test } from "@jest/globals";
import AzureArm from "../../../../Server/Utils/CloudConnection/Azure/AzureArm";
import AzureCloudConnector, {
  pickAzureGrain,
  selectAzureMetrics,
} from "../../../../Server/Utils/CloudConnection/Azure/AzureCloudConnector";
import { storedAttributesOf } from "../../../../Server/Utils/CloudConnection/CloudMetricPayload";
import {
  CloudConnectionPullState,
  CloudConnectionSettings,
  CloudDiscoveredResource,
  CloudReadResult,
} from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import { DataSourceHttpRequest } from "../../../../Server/Utils/DataSource/HttpFetch";
import LlmProviderError from "../../../../Server/Utils/LlmObservability/LlmProviderError";
import { getAzureKeyMetrics } from "../../../../Types/Cloud/CloudKeyMetrics";
import {
  CloudMonitoredResource,
  resolveCloudMonitoredResource,
} from "../../../../Types/Cloud/CloudMonitoredResource";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import { CloudConnectionAuthMethod } from "../../../../Types/CloudConnection/CloudConnectionCatalog";
import {
  CloudConnectionFailureKind,
  CloudConnectionTestResult,
} from "../../../../Types/CloudConnection/CloudConnectionTest";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import {
  FakeProviderApi,
  FakeResponse,
  FakeRoute,
  createFakeProviderApi,
  everythingSent,
  json,
} from "../LlmObservability/FakeProviderApi";

/*
 * Microsoft Azure against a fake Resource Manager and Azure Monitor:
 * signing in as the app, the subscriptions it may read, every resource of
 * each listed to its last page and kept when OneUptime knows its type, a
 * subscription listed in full marking the resources it no longer has as
 * gone, each resource's key metrics read once a call with the aggregation
 * and grain its definitions name, and the export the azure_monitor
 * receiver sends.
 */

const TENANT: string = "b3c1b5fc-828c-45fa-a1e1-10d74f6d6e9c";
const CLIENT: string = "00001111-aaaa-2222-bbbb-3333cccc4444";
const SECRET: string = "client-secret~value";
const SUB_A: string = "d0cfe6b2-9ac0-4464-9919-dccaee2e48c0";
const SUB_B: string = "7c4a1f2e-9d3b-4e5f-8a6b-1c2d3e4f5a6b";
// 12:07: Azure Monitor's minute window ends four minutes back: 12:03.
const NOW: Date = new Date("2026-10-21T12:07:00Z");
const WINDOW_END: Date = new Date("2026-10-21T12:03:00Z");

const VM: string = `/subscriptions/${SUB_A}/resourceGroups/rg-prod/providers/Microsoft.Compute/virtualMachines/vm-web-1`;
const SQL: string = `/subscriptions/${SUB_A}/resourceGroups/rg-data/providers/Microsoft.Sql/servers/sql-prod/databases/orders`;
const VNET: string = `/subscriptions/${SUB_A}/resourceGroups/rg-prod/providers/Microsoft.Network/virtualNetworks/vnet-1`;
const NIC: string = `/subscriptions/${SUB_A}/resourceGroups/rg-prod/providers/Microsoft.Network/networkSecurityGroups/nsg-1`;

const connector: AzureCloudConnector = new AzureCloudConnector();

function settings(config: JSONObject = {}): CloudConnectionSettings {
  return {
    provider: CloudProvider.Azure,
    projectId: "11111111-1111-4111-8111-111111111111",
    config: {
      authMethod: CloudConnectionAuthMethod.AzureClientSecret,
      tenantId: TENANT,
      clientId: CLIENT,
      cloud: "public",
      ...config,
    },
    secrets: { clientSecret: SECRET },
  };
}

interface FakeAzureOptions {
  subscriptions?: Array<{ id: string; name: string; state?: string }>;
  resources?: Record<string, Array<JSONObject>>;
  // Resources split over pages for this subscription.
  pageSize?: number;
  definitions?: Record<string, Array<JSONObject>>;
  metricsError?: Record<string, FakeResponse>;
  resourcesError?: Record<string, FakeResponse>;
  tokenError?: FakeResponse;
}

function definition(
  name: string,
  aggregation: string,
  grains: Array<string>,
  unit: string = "Percent",
): JSONObject {
  return {
    name: { value: name, localizedValue: name },
    unit,
    primaryAggregationType: aggregation,
    metricAvailabilities: grains.map((timeGrain: string) => {
      return { timeGrain, retention: "P93D" };
    }),
  };
}

const VM_DEFINITIONS: Array<JSONObject> = [
  definition("Percentage CPU", "Average", ["PT1M", "PT5M", "PT1H"]),
  definition("Network In Total", "Total", ["PT1M", "PT1H"], "Bytes"),
  definition("Disk Read Bytes", "Total", ["PT1M"], "Bytes"),
  // Published, but not a key metric: never read.
  definition("CPU Credits Remaining", "Average", ["PT1M"], "Count"),
];

const SQL_DEFINITIONS: Array<JSONObject> = [
  definition("cpu_percent", "Average", ["PT1M"]),
  // A vCore database has no DTU: dtu_consumption_percent is not listed.
  definition("storage_percent", "Maximum", ["PT1M"]),
  definition("connection_failed", "Total", ["PT1M"], "Count"),
];

function resource(
  id: string,
  type: string,
  name: string,
  location: string = "westeurope",
): JSONObject {
  return { id, name, type, location, kind: "" };
}

interface FakeAzure extends FakeProviderApi {
  metricCalls: Array<URL>;
}

function createFakeAzure(options: FakeAzureOptions = {}): FakeAzure {
  const metricCalls: Array<URL> = [];

  const routes: Array<FakeRoute> = [
    {
      host: "login.microsoftonline.com",
      path: `/${TENANT}/oauth2/v2.0/token`,
      method: "POST",
      respond: (): FakeResponse => {
        return (
          options.tokenError ||
          json({ access_token: "azure-access-token", expires_in: 3599 })
        );
      },
    },
    {
      host: "management.azure.com",
      path: "/subscriptions",
      respond: (): FakeResponse => {
        return json({
          value: (
            options.subscriptions || [{ id: SUB_A, name: "Production" }]
          ).map(
            (subscription: { id: string; name: string; state?: string }) => {
              return {
                subscriptionId: subscription.id,
                displayName: subscription.name,
                state: subscription.state || "Enabled",
              };
            },
          ),
        });
      },
    },
    {
      host: "management.azure.com",
      path: /^\/subscriptions\/[^/]+\/resources$/,
      respond: (_request: DataSourceHttpRequest, url: URL): FakeResponse => {
        const subscription: string = url.pathname.split("/")[2]!;

        if (options.resourcesError?.[subscription]) {
          return options.resourcesError[subscription]!;
        }

        const all: Array<JSONObject> = options.resources?.[subscription] || [];
        const pageSize: number = options.pageSize || 1000;
        const page: number = Number(url.searchParams.get("page") || 0);
        const slice: Array<JSONObject> = all.slice(
          page * pageSize,
          (page + 1) * pageSize,
        );
        const hasMore: boolean = (page + 1) * pageSize < all.length;

        return json({
          value: slice,
          ...(hasMore
            ? {
                nextLink: `https://management.azure.com/subscriptions/${subscription}/resources?api-version=2021-04-01&page=${page + 1}`,
              }
            : {}),
        });
      },
    },
    {
      host: "management.azure.com",
      path: /\/providers\/Microsoft\.Insights\/metricDefinitions$/,
      respond: (_request: DataSourceHttpRequest, url: URL): FakeResponse => {
        const resourceId: string = url.pathname.replace(
          "/providers/Microsoft.Insights/metricDefinitions",
          "",
        );
        const type: string = resourceId.includes("virtualMachines")
          ? "vm"
          : "sql";

        return json({
          value:
            options.definitions?.[resourceId] ||
            (type === "vm" ? VM_DEFINITIONS : SQL_DEFINITIONS),
        });
      },
    },
    {
      host: "management.azure.com",
      path: /\/providers\/Microsoft\.Insights\/metrics$/,
      respond: (_request: DataSourceHttpRequest, url: URL): FakeResponse => {
        metricCalls.push(url);
        const resourceId: string = url.pathname.replace(
          "/providers/Microsoft.Insights/metrics",
          "",
        );

        if (options.metricsError?.[resourceId]) {
          return options.metricsError[resourceId]!;
        }

        const names: Array<string> = (url.searchParams.get("metricnames") || "")
          .split(",")
          .filter((name: string): boolean => {
            return Boolean(name);
          });
        const start: number = Date.parse(
          (url.searchParams.get("timespan") || "").split("/")[0]!,
        );

        return json({
          value: names.map((name: string, index: number) => {
            return {
              name: { value: name, localizedValue: name },
              unit: "Percent",
              timeseries: [
                {
                  metadatavalues: [],
                  data: [
                    {
                      timeStamp: new Date(start).toISOString(),
                      average: 10 + index,
                      total: 100 + index,
                      maximum: 50 + index,
                    },
                    {
                      timeStamp: new Date(start + 60000).toISOString(),
                      average: 11 + index,
                      total: 101 + index,
                      maximum: 51 + index,
                    },
                    // A minute with no data: no value at all.
                    { timeStamp: new Date(start + 120000).toISOString() },
                  ],
                },
              ],
            };
          }),
        });
      },
    },
  ];

  return { ...createFakeProviderApi(routes), metricCalls };
}

const STANDARD_RESOURCES: Record<string, Array<JSONObject>> = {
  [SUB_A]: [
    resource(VM, "Microsoft.Compute/virtualMachines", "vm-web-1"),
    resource(
      SQL,
      "Microsoft.Sql/servers/databases",
      "sql-prod/orders",
      "northeurope",
    ),
    resource(VNET, "Microsoft.Network/virtualNetworks", "vnet-1"),
    // Not a type OneUptime lists: left out.
    resource(NIC, "Microsoft.Network/networkSecurityGroups", "nsg-1"),
  ],
};

function readOptions(
  fake: FakeProviderApi,
  state: CloudConnectionPullState = {},
  extra: Partial<Parameters<AzureCloudConnector["read"]>[1]> = {},
): Parameters<AzureCloudConnector["read"]>[1] {
  return {
    transport: fake.transport,
    now: () => {
      return NOW;
    },
    state,
    serviceName: "Microsoft Azure",
    connectionId: "33333333-3333-4333-8333-333333333333",
    maxRequests: 3000,
    maxDurationMs: 60000,
    ...extra,
  };
}

function datapoints(result: CloudReadResult): Array<{
  metricName: string;
  stored: JSONObject;
  value: number;
}> {
  const found: Array<{
    metricName: string;
    stored: JSONObject;
    value: number;
  }> = [];

  for (const payload of result.payloads) {
    for (const rm of payload["resourceMetrics"] as JSONArray) {
      const resourceAttributes: JSONArray = (
        (rm as JSONObject)["resource"] as JSONObject
      )["attributes"] as JSONArray;

      for (const sm of (rm as JSONObject)["scopeMetrics"] as JSONArray) {
        for (const metric of (sm as JSONObject)["metrics"] as JSONArray) {
          for (const point of ((metric as JSONObject)["gauge"] as JSONObject)[
            "dataPoints"
          ] as JSONArray) {
            found.push({
              metricName: (metric as JSONObject)["name"] as string,
              stored: storedAttributesOf(
                resourceAttributes as never,
                (point as JSONObject)["attributes"] as never,
              ) as JSONObject,
              value: (point as JSONObject)["asDouble"] as number,
            });
          }
        }
      }
    }
  }

  return found;
}

describe("validateSettings", () => {
  test("a tenant, an app and its secret are enough", () => {
    expect(() => {
      connector.validateSettings(settings());
    }).not.toThrow();
    // A tenant may be named by its domain.
    expect(() => {
      connector.validateSettings(
        settings({ tenantId: "contoso.onmicrosoft.com" }),
      );
    }).not.toThrow();
  });

  test("ids that are not GUIDs, a missing secret, an unknown cloud are form errors", () => {
    expect(() => {
      connector.validateSettings(settings({ clientId: "app" }));
    }).toThrow("Application (client) ID must be a GUID");
    expect(() => {
      connector.validateSettings(settings({ tenantId: "not a tenant" }));
    }).toThrow(BadDataException);
    expect(() => {
      connector.validateSettings({ ...settings(), secrets: {} });
    }).toThrow("Client secret is required.");
    expect(() => {
      connector.validateSettings(settings({ cloud: "china" }));
    }).toThrow(BadDataException);
    expect(() => {
      connector.validateSettings(
        settings({ subscriptionIds: `${SUB_A}, nope` }),
      );
    }).toThrow("Each subscription must be a GUID");
  });
});

describe("testConnection", () => {
  test("signs in, lists the subscriptions and counts the resources OneUptime knows", async () => {
    const fake: FakeAzure = createFakeAzure({ resources: STANDARD_RESOURCES });

    const result: CloudConnectionTestResult = await connector.testConnection(
      settings(),
      { transport: fake.transport },
    );

    expect(result).toEqual(
      expect.objectContaining({
        status: "pass",
        accounts: ["Production"],
        resourceCount: 3,
        resourceTypes: [
          { type: "Microsoft.Compute/virtualMachines", count: 1 },
          { type: "Microsoft.Network/virtualNetworks", count: 1 },
          { type: "Microsoft.Sql/servers/databases", count: 1 },
        ],
        regions: [
          { region: "westeurope", count: 2 },
          { region: "northeurope", count: 1 },
        ],
        isSample: false,
      }),
    );

    const token: DataSourceHttpRequest = fake.requests[0]!;
    expect(token.formUrlEncoded).toBe(true);
    expect(token.body).toEqual(
      expect.objectContaining({
        grant_type: "client_credentials",
        client_id: CLIENT,
        scope: "https://management.azure.com/.default",
      }),
    );
    // Every later call carries the token, never the secret.
    for (const request of fake.requests.slice(1)) {
      expect((request.headers as Record<string, string>)["Authorization"]).toBe(
        "Bearer azure-access-token",
      );
      expect(everythingSent(request)).not.toContain(SECRET);
    }
  });

  test("an app with no role on any subscription is told what to grant", async () => {
    const fake: FakeAzure = createFakeAzure({ subscriptions: [] });

    const result: CloudConnectionTestResult = await connector.testConnection(
      settings(),
      { transport: fake.transport },
    );

    expect(result.status).toBe("warn");
    expect(result.failureKind).toBe(CloudConnectionFailureKind.Permission);
    expect(result.message).toContain("Monitoring Reader");
  });

  test("a wrong secret fails as authentication", async () => {
    const fake: FakeAzure = createFakeAzure({
      tokenError: {
        status: 401,
        body: '{"error":"invalid_client","error_description":"AADSTS7000215: Invalid client secret provided."}',
      },
    });

    const result: CloudConnectionTestResult = await connector.testConnection(
      settings(),
      { transport: fake.transport },
    );

    expect(result.status).toBe("fail");
    expect(result.failureKind).toBe(CloudConnectionFailureKind.Authentication);
  });

  test("named subscriptions are read without listing the rest", async () => {
    const fake: FakeAzure = createFakeAzure({ resources: STANDARD_RESOURCES });

    await connector.testConnection(settings({ subscriptionIds: SUB_A }), {
      transport: fake.transport,
    });

    expect(fake.requestsTo("/subscriptions")).toHaveLength(0);
    expect(fake.requestsTo(`/subscriptions/${SUB_A}/resources`)).toHaveLength(
      1,
    );
  });
});

describe("read", () => {
  test("lists every subscription to its last page and keeps the types OneUptime knows", async () => {
    const many: Array<JSONObject> = [];
    for (let index: number = 0; index < 5; index++) {
      many.push(
        resource(
          `/subscriptions/${SUB_B}/resourceGroups/rg/providers/Microsoft.Web/sites/app-${index}`,
          "Microsoft.Web/sites",
          `app-${index}`,
          "eastus",
        ),
      );
    }
    const fake: FakeAzure = createFakeAzure({
      subscriptions: [
        { id: SUB_A, name: "Production" },
        { id: SUB_B, name: "Staging" },
        {
          id: "99999999-9999-4999-8999-999999999999",
          name: "Old",
          state: "Disabled",
        },
      ],
      resources: { ...STANDARD_RESOURCES, [SUB_B]: many },
      pageSize: 2,
    });

    const result: CloudReadResult = await connector.read(
      settings(),
      readOptions(fake),
    );

    expect(result.accounts).toEqual([SUB_A, SUB_B]);
    expect(result.completelyListedAccounts.sort()).toEqual(
      [SUB_A, SUB_B].sort(),
    );
    expect(result.resources).toHaveLength(3 + 5);
    // Three pages of Staging's five apps.
    expect(fake.requestsTo(`/subscriptions/${SUB_B}/resources`)).toHaveLength(
      3,
    );
    expect(result.nextState.inventoryAt).toBe(NOW.toISOString());
    expect(result.nextState.accounts).toEqual([SUB_A, SUB_B]);
  });

  test("each resource is the one the ingest will file its metrics under", async () => {
    const fake: FakeAzure = createFakeAzure({ resources: STANDARD_RESOURCES });

    const result: CloudReadResult = await connector.read(
      settings(),
      readOptions(fake),
    );
    const vm: CloudMonitoredResource = result.resources.find(
      (entry: CloudDiscoveredResource): boolean => {
        return entry.resource.providerResourceId === VM;
      },
    )!.resource;

    expect(vm).toEqual(
      expect.objectContaining({
        provider: CloudProvider.Azure,
        resourceType: "Microsoft.Compute/virtualMachines",
        name: "vm-web-1",
        accountId: SUB_A,
        region: "westeurope",
        resourceGroup: "rg-prod",
        telemetryAttributes: { "azuremonitor.resource_id": VM },
      }),
    );

    // Every datapoint resolves to a resource the read found.
    const identities: Set<string> = new Set(
      result.resources.map((entry: CloudDiscoveredResource): string => {
        return entry.resource.identityKey;
      }),
    );

    for (const point of datapoints(result)) {
      const resolved: CloudMonitoredResource | null =
        resolveCloudMonitoredResource({
          metricName: point.metricName,
          attributes: point.stored,
        });

      expect(resolved && identities.has(resolved.identityKey)).toBe(true);
    }
  });

  test("reads each resource's key metrics it publishes, with their own aggregation, in one call", async () => {
    const fake: FakeAzure = createFakeAzure({ resources: STANDARD_RESOURCES });

    const result: CloudReadResult = await connector.read(
      settings(),
      readOptions(fake),
    );
    const vmCall: URL = fake.metricCalls.find((url: URL): boolean => {
      return url.pathname.includes("virtualMachines");
    })!;

    expect(vmCall.searchParams.get("metricnames")).toBe(
      "Percentage CPU,Network In Total,Disk Read Bytes",
    );
    expect(vmCall.searchParams.get("aggregation")).toBe("Average,Total");
    expect(vmCall.searchParams.get("interval")).toBe("PT1M");
    expect(vmCall.searchParams.get("timespan")).toBe(
      `${new Date(WINDOW_END.getTime() - 3600000).toISOString()}/${WINDOW_END.toISOString()}`,
    );

    // A virtual network has no key metrics: listed, not read.
    expect(
      fake.metricCalls.some((url: URL): boolean => {
        return url.pathname.includes("virtualNetworks");
      }),
    ).toBe(false);

    const names: Array<string> = Array.from(
      new Set(
        datapoints(result).map((point: { metricName: string }): string => {
          return point.metricName;
        }),
      ),
    ).sort();

    expect(names).toEqual([
      "azure_connection_failed_total",
      "azure_cpu_percent_average",
      "azure_disk_read_bytes_total",
      "azure_network_in_total_total",
      "azure_percentage_cpu_average",
      "azure_storage_percent_maximum",
    ]);

    // Two minutes with values per metric; the empty minute is left out.
    expect(result.pointsWritten).toBe(6 * 2);
    const cpu: Array<{ value: number }> = datapoints(result).filter(
      (point: { metricName: string }): boolean => {
        return point.metricName === "azure_percentage_cpu_average";
      },
    );
    expect(
      cpu.map((point: { value: number }) => {
        return point.value;
      }),
    ).toEqual([10, 11]);
  });

  test("the receiver's datapoint attributes are on every point", async () => {
    const fake: FakeAzure = createFakeAzure({ resources: STANDARD_RESOURCES });

    const result: CloudReadResult = await connector.read(
      settings(),
      readOptions(fake),
    );
    const sql: { stored: JSONObject } = datapoints(result).find(
      (point: { metricName: string }): boolean => {
        return point.metricName === "azure_cpu_percent_average";
      },
    )!;

    expect(sql.stored).toEqual(
      expect.objectContaining({
        "azuremonitor.resource_id": SQL,
        name: "sql-prod/orders",
        type: "Microsoft.Sql/servers/databases",
        resource_group: "rg-data",
        location: "northeurope",
        timegrain: "PT1M",
        "resource.azuremonitor.subscription_id": SUB_A,
        "resource.azuremonitor.tenant_id": TENANT,
        "resource.cloud.provider": "azure",
        "resource.service.name": "Microsoft Azure",
      }),
    );
  });

  test("metric definitions are read once per type and kept a day", async () => {
    const fake: FakeAzure = createFakeAzure({ resources: STANDARD_RESOURCES });

    const first: CloudReadResult = await connector.read(
      settings(),
      readOptions(fake),
    );
    const definitionCalls: number = fake.requests.filter(
      (request: DataSourceHttpRequest): boolean => {
        return request.url.includes("metricDefinitions");
      },
    ).length;

    expect(definitionCalls).toBe(2);
    expect(
      Object.keys(first.nextState.azureMetricDefinitions || {}).sort(),
    ).toEqual([
      "microsoft.compute/virtualmachines",
      "microsoft.sql/servers/databases",
    ]);

    await connector.read(
      settings(),
      readOptions(fake, first.nextState, {
        now: () => {
          return new Date(NOW.getTime() + 5 * 60000);
        },
      }),
    );

    expect(
      fake.requests.filter((request: DataSourceHttpRequest): boolean => {
        return request.url.includes("metricDefinitions");
      }).length,
    ).toBe(2);
  });

  test("between listings it reads the resources the connection holds, without listing", async () => {
    const fake: FakeAzure = createFakeAzure({ resources: STANDARD_RESOURCES });
    const state: CloudConnectionPullState = {
      inventoryAt: new Date(NOW.getTime() - 10 * 60000).toISOString(),
      accounts: [SUB_A],
      cursors: {
        "60": new Date(WINDOW_END.getTime() - 5 * 60000).toISOString(),
      },
    };

    const result: CloudReadResult = await connector.read(
      settings(),
      readOptions(fake, state, {
        knownResources: [
          {
            providerResourceId: VM,
            resourceType: "Microsoft.Compute/virtualMachines",
            name: "vm-web-1",
            region: "westeurope",
            accountId: SUB_A,
            resourceGroup: "rg-prod",
          },
        ],
      }),
    );

    expect(fake.requestsTo(`/subscriptions/${SUB_A}/resources`)).toHaveLength(
      0,
    );
    // Nothing was listed in full: nothing is gone.
    expect(result.completelyListedAccounts).toEqual([]);
    expect(result.resources).toHaveLength(1);
    expect(fake.metricCalls).toHaveLength(1);
    expect(fake.metricCalls[0]!.searchParams.get("timespan")).toBe(
      `${state.cursors!["60"]}/${WINDOW_END.toISOString()}`,
    );
  });

  test("a resource whose metrics fail is skipped and counted; the others are written", async () => {
    const fake: FakeAzure = createFakeAzure({
      resources: STANDARD_RESOURCES,
      metricsError: { [SQL]: { status: 400, body: '{"code":"BadRequest"}' } },
    });

    const result: CloudReadResult = await connector.read(
      settings(),
      readOptions(fake),
    );

    expect(result.warnings).toContain(
      "Could not read the metrics of 1 resources this time.",
    );
    expect(
      datapoints(result).every((point: { stored: JSONObject }): boolean => {
        return point.stored["azuremonitor.resource_id"] === VM;
      }),
    ).toBe(true);
    expect(result.nextState.cursors?.["60"]).toBe(WINDOW_END.toISOString());
  });

  test("a subscription that cannot be listed is not complete, and is said", async () => {
    const fake: FakeAzure = createFakeAzure({
      subscriptions: [
        { id: SUB_A, name: "Production" },
        { id: SUB_B, name: "Staging" },
      ],
      resources: STANDARD_RESOURCES,
      resourcesError: {
        [SUB_B]: { status: 403, body: '{"code":"AuthorizationFailed"}' },
      },
    });

    const result: CloudReadResult = await connector.read(
      settings(),
      readOptions(fake),
    );

    expect(result.completelyListedAccounts).toEqual([SUB_A]);
    expect(result.warnings.join(" ")).toContain(SUB_B);
  });

  test("no subscription to read fails the read as a permission", async () => {
    const fake: FakeAzure = createFakeAzure({ subscriptions: [] });

    await expect(
      connector.read(settings(), readOptions(fake)),
    ).rejects.toMatchObject({
      kind: CloudConnectionFailureKind.Permission,
    });
  });

  test("a refused sign-in fails the read", async () => {
    const fake: FakeAzure = createFakeAzure({
      tokenError: { status: 400, body: '{"error":"invalid_client"}' },
    });

    const error: unknown = await connector
      .read(settings(), readOptions(fake))
      .catch((caught: unknown) => {
        return caught;
      });

    expect(error).toBeInstanceOf(LlmProviderError);
    expect((error as LlmProviderError).kind).toBe(
      CloudConnectionFailureKind.Authentication,
    );
  });

  test("a read out of budget lists nothing as complete", async () => {
    const fake: FakeAzure = createFakeAzure({ resources: STANDARD_RESOURCES });

    const result: CloudReadResult = await connector.read(
      settings(),
      readOptions(fake, {}, { maxRequests: 3 }),
    );

    expect(result.complete).toBe(false);
    expect(result.completelyListedAccounts).toEqual([]);
  });
});

describe("choosing metrics", () => {
  test("the finest grain from a minute up", () => {
    expect(pickAzureGrain(["PT1H", "PT1M", "PT5M"])).toBe("PT1M");
    expect(pickAzureGrain(["PT1H", "P1D"])).toBe("PT1H");
    expect(pickAzureGrain(["PT30S"])).toBeUndefined();
    expect(pickAzureGrain([])).toBeUndefined();
  });

  test("key metrics the definitions list, in the catalog's order, with their primary aggregation", () => {
    expect(
      selectAzureMetrics(
        getAzureKeyMetrics("Microsoft.Sql/servers/databases")!,
        [
          {
            name: "storage_percent",
            unit: "Percent",
            primaryAggregationType: "Maximum",
            timeGrains: ["PT1M"],
          },
          // Matched without regard to case, kept as the definition spells it.
          {
            name: "CPU_PERCENT",
            unit: "Percent",
            primaryAggregationType: "Average",
            timeGrains: ["PT5M", "PT1M"],
          },
          // No grain from a minute up: not read.
          {
            name: "deadlock",
            unit: "Count",
            primaryAggregationType: "Total",
            timeGrains: ["PT30S"],
          },
        ],
      ),
    ).toEqual([
      {
        name: "CPU_PERCENT",
        aggregation: "Average",
        grain: "PT1M",
        unit: "Percent",
      },
      {
        name: "storage_percent",
        aggregation: "Maximum",
        grain: "PT1M",
        unit: "Percent",
      },
    ]);
  });

  test("an answer's points are each metric's own aggregation, without empty minutes", () => {
    expect(
      AzureArm.readMetricSeries(
        {
          value: [
            {
              name: { value: "Percentage CPU" },
              unit: "Percent",
              timeseries: [
                {
                  data: [
                    { timeStamp: "2026-10-21T12:00:00Z", average: 4, total: 9 },
                    { timeStamp: "2026-10-21T12:01:00Z" },
                    { timeStamp: "not a time", average: 5 },
                  ],
                },
              ],
            },
            { name: { value: "Unasked" }, timeseries: [] },
          ],
        },
        { "percentage cpu": "Average" },
      ),
    ).toEqual([
      {
        metricName: "Percentage CPU",
        unit: "Percent",
        points: [{ timeMs: Date.parse("2026-10-21T12:00:00Z"), value: 4 }],
      },
    ]);
  });
});
