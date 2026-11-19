import { describe, expect, test } from "@jest/globals";
import AzureArm from "../../../../Server/Utils/CloudConnection/Azure/AzureArm";
import AzureCloudConnector, {
  AZURE_DEFINITION_SAMPLES,
  AZURE_MAX_RESOURCE_DEFINITIONS,
  SelectedMetric,
  getAzureKeyMetricsFingerprint,
  isAzureUnsupportedMetricsRefusal,
  mergeAzureSelections,
  pickAzureDefinitionSamples,
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
import {
  AzureTypeKeyMetrics,
  getAzureKeyMetrics,
} from "../../../../Types/Cloud/CloudKeyMetrics";
import { CloudKeyMetricGroup } from "../../../../Types/Cloud/CloudKeyMetricGroup";
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
  /*
   * As Azure Monitor does: a metrics call naming a metric the resource's
   * own definitions do not list is refused whole, with a 400 that says so.
   */
  refuseUnpublished?: boolean;
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
  definition("Data Disk Read Bytes/sec", "Average", ["PT1M"], "BytesPerSecond"),
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
  kind: string = "",
): JSONObject {
  return { id, name, type, location, kind };
}

interface FakeAzure extends FakeProviderApi {
  metricCalls: Array<URL>;
}

function createFakeAzure(options: FakeAzureOptions = {}): FakeAzure {
  const metricCalls: Array<URL> = [];
  // A resource's own definitions: the ones named for it, else its type's.
  const definitionsOf: (resourceId: string) => Array<JSONObject> = (
    resourceId: string,
  ): Array<JSONObject> => {
    return (
      options.definitions?.[resourceId] ||
      (resourceId.includes("virtualMachines")
        ? VM_DEFINITIONS
        : SQL_DEFINITIONS)
    );
  };

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

        return json({ value: definitionsOf(resourceId) });
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

        if (options.refuseUnpublished) {
          const published: Array<string> = definitionsOf(resourceId).map(
            (definition: JSONObject): string => {
              return String(
                (definition["name"] as JSONObject)["value"],
              ).toLowerCase();
            },
          );
          const unpublished: string | undefined = names.find(
            (name: string): boolean => {
              return !published.includes(name.toLowerCase());
            },
          );

          if (unpublished) {
            return {
              status: 400,
              body: JSON.stringify({
                code: "BadRequest",
                message: `Failed to find metric configuration for provider: Microsoft.Sql, resource Type: servers/databases, metric: ${unpublished}, Valid metrics: ${published.join(",")}`,
              }),
            };
          }
        }
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
    // No metrics to read: left out here, and listed by the inventory alone.
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
      "Could not read the metrics of 1 resource this time.",
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
        dimensions: [],
      },
    ]);
  });
});

/*
 * Resources of one type publish different metrics - a vCore database has
 * no DTUs, a master database a handful of metrics - and Azure Monitor
 * refuses a whole metrics call that names one a resource does not publish.
 * A type's definitions come from up to three of its resources, of
 * different kinds first, and a resource Azure refuses is read with its own.
 */
const DTU_DB: string = `/subscriptions/${SUB_A}/resourceGroups/rg-data/providers/Microsoft.Sql/servers/sql-prod/databases/orders`;
const VCORE_DB: string = `/subscriptions/${SUB_A}/resourceGroups/rg-data/providers/Microsoft.Sql/servers/sql-prod/databases/billing`;
const MASTER_DB: string = `/subscriptions/${SUB_A}/resourceGroups/rg-data/providers/Microsoft.Sql/servers/sql-prod/databases/master`;

const DTU_DEFINITIONS: Array<JSONObject> = [
  definition("cpu_percent", "Average", ["PT1M"]),
  definition("dtu_consumption_percent", "Average", ["PT1M"]),
  definition("storage_percent", "Maximum", ["PT1M"]),
];
const VCORE_DEFINITIONS: Array<JSONObject> = [
  definition("cpu_percent", "Average", ["PT1M"]),
  definition("storage_percent", "Maximum", ["PT1M"]),
  definition("workers_percent", "Average", ["PT1M"]),
];
const MASTER_DEFINITIONS: Array<JSONObject> = [
  definition("connection_successful", "Total", ["PT1M"], "Count"),
];

const MIXED_DATABASES: Record<string, Array<JSONObject>> = {
  [SUB_A]: [
    resource(
      DTU_DB,
      "Microsoft.Sql/servers/databases",
      "sql-prod/orders",
      "westeurope",
      "v12.0,user",
    ),
    resource(
      VCORE_DB,
      "Microsoft.Sql/servers/databases",
      "sql-prod/billing",
      "westeurope",
      "v12.0,user,vcore",
    ),
    resource(
      MASTER_DB,
      "Microsoft.Sql/servers/databases",
      "sql-prod/master",
      "westeurope",
      "v12.0,system",
    ),
  ],
};

const MIXED_DEFINITIONS: Record<string, Array<JSONObject>> = {
  [DTU_DB]: DTU_DEFINITIONS,
  [VCORE_DB]: VCORE_DEFINITIONS,
  [MASTER_DB]: MASTER_DEFINITIONS,
};

function metricNamesAsked(fake: FakeAzure, resourceId: string): Array<string> {
  return fake.metricCalls
    .filter((url: URL): boolean => {
      return url.pathname.startsWith(`${resourceId}/`);
    })
    .map((url: URL): string => {
      return url.searchParams.get("metricnames") || "";
    });
}

function definitionCallsOf(fake: FakeAzure): Array<string> {
  return fake.requests
    .filter((request: DataSourceHttpRequest): boolean => {
      return request.url.includes("metricDefinitions");
    })
    .map((request: DataSourceHttpRequest): string => {
      return new URL(request.url).pathname.replace(
        "/providers/Microsoft.Insights/metricDefinitions",
        "",
      );
    });
}

function writtenNamesOf(
  result: CloudReadResult,
  resourceId: string,
): Array<string> {
  return Array.from(
    new Set(
      datapoints(result)
        .filter((point: { stored: JSONObject }): boolean => {
          return point.stored["azuremonitor.resource_id"] === resourceId;
        })
        .map((point: { metricName: string }): string => {
          return point.metricName;
        }),
    ),
  ).sort();
}

describe("resources of one type that publish different metrics", () => {
  test("a type's definitions are read from a resource of each kind, and its selection is their key metrics together", async () => {
    const fake: FakeAzure = createFakeAzure({
      resources: MIXED_DATABASES,
      definitions: MIXED_DEFINITIONS,
    });

    const result: CloudReadResult = await connector.read(
      settings(),
      readOptions(fake),
    );

    expect(definitionCallsOf(fake).sort()).toEqual(
      [DTU_DB, VCORE_DB, MASTER_DB].sort(),
    );

    const cached: JSONObject = (
      result.nextState.azureMetricDefinitions as JSONObject
    )["microsoft.sql/servers/databases"] as JSONObject;

    // In the catalog's order, each metric once.
    expect(
      (cached["metrics"] as Array<JSONObject>).map(
        (metric: JSONObject): unknown => {
          return metric["name"];
        },
      ),
    ).toEqual([
      "cpu_percent",
      "dtu_consumption_percent",
      "storage_percent",
      "workers_percent",
      "connection_successful",
    ]);
    expect(cached["of"]).toBe(
      getAzureKeyMetricsFingerprint(
        getAzureKeyMetrics("Microsoft.Sql/servers/databases")!,
      ),
    );
  });

  test("a resource Azure refuses for a metric it does not publish is read with its own definitions, in the same read", async () => {
    const fake: FakeAzure = createFakeAzure({
      resources: MIXED_DATABASES,
      definitions: MIXED_DEFINITIONS,
      refuseUnpublished: true,
    });

    const result: CloudReadResult = await connector.read(
      settings(),
      readOptions(fake),
    );

    // Every database is written, each with what it publishes.
    expect(writtenNamesOf(result, DTU_DB)).toEqual([
      "azure_cpu_percent_average",
      "azure_dtu_consumption_percent_average",
      "azure_storage_percent_maximum",
    ]);
    expect(writtenNamesOf(result, VCORE_DB)).toEqual([
      "azure_cpu_percent_average",
      "azure_storage_percent_maximum",
      "azure_workers_percent_average",
    ]);
    expect(writtenNamesOf(result, MASTER_DB)).toEqual([
      "azure_connection_successful_total",
    ]);
    expect(result.warnings).not.toContain(
      "Could not read the metrics of 1 resource this time.",
    );

    // Refused once each with the type's selection, then read with its own.
    expect(metricNamesAsked(fake, MASTER_DB)).toEqual([
      "cpu_percent,dtu_consumption_percent,storage_percent,workers_percent,connection_successful",
      "connection_successful",
    ]);

    // Their own selections are kept, by ARM id, for the next reads.
    const own: JSONObject = result.nextState
      .azureResourceMetricDefinitions as JSONObject;

    expect(Object.keys(own).sort()).toEqual(
      [DTU_DB, VCORE_DB, MASTER_DB]
        .map((id: string): string => {
          return id.toLowerCase();
        })
        .sort(),
    );
  });

  test("the next read asks a resource with its own selection straight away", async () => {
    const fake: FakeAzure = createFakeAzure({
      resources: MIXED_DATABASES,
      definitions: MIXED_DEFINITIONS,
      refuseUnpublished: true,
    });

    const first: CloudReadResult = await connector.read(
      settings(),
      readOptions(fake),
    );
    const callsBefore: number = fake.metricCalls.length;
    const definitionsBefore: number = definitionCallsOf(fake).length;

    // Between listings: the resources the connection holds.
    const second: CloudReadResult = await connector.read(
      settings(),
      readOptions(fake, first.nextState, {
        now: () => {
          return new Date(NOW.getTime() + 5 * 60000);
        },
        knownResources: [
          [DTU_DB, "orders"],
          [VCORE_DB, "billing"],
          [MASTER_DB, "master"],
        ].map(([id, name]: Array<string>) => {
          return {
            providerResourceId: id!,
            resourceType: "Microsoft.Sql/servers/databases",
            name: `sql-prod/${name}`,
            region: "westeurope",
            accountId: SUB_A,
            resourceGroup: "rg-data",
          };
        }),
      }),
    );

    // One call each, no refusal, and no definitions read again.
    expect(fake.metricCalls.length - callsBefore).toBe(3);
    expect(definitionCallsOf(fake).length).toBe(definitionsBefore);
    expect(writtenNamesOf(second, MASTER_DB)).toEqual([
      "azure_connection_successful_total",
    ]);
  });

  test("a refusal for any other reason is not read again: the resource is counted as failed", async () => {
    const fake: FakeAzure = createFakeAzure({
      resources: STANDARD_RESOURCES,
      metricsError: {
        [SQL]: {
          status: 400,
          body: '{"code":"BadRequest","message":"Invalid timespan."}',
        },
      },
    });

    const result: CloudReadResult = await connector.read(
      settings(),
      readOptions(fake),
    );

    expect(metricNamesAsked(fake, SQL)).toHaveLength(1);
    expect(result.warnings).toContain(
      "Could not read the metrics of 1 resource this time.",
    );
    expect(result.nextState.azureResourceMetricDefinitions).toEqual({});
  });

  test("a definitions cache made for another list of key metrics is read again at once", async () => {
    const fake: FakeAzure = createFakeAzure({ resources: STANDARD_RESOURCES });
    const state: CloudConnectionPullState = {
      azureMetricDefinitions: {
        "microsoft.compute/virtualmachines": {
          at: NOW.toISOString(),
          of: "made-for-eight-metrics",
          metrics: [
            {
              name: "Percentage CPU",
              unit: "Percent",
              aggregation: "Average",
              grain: "PT1M",
            },
          ],
        },
      },
    };

    await connector.read(settings(), readOptions(fake, state));

    expect(definitionCallsOf(fake)).toContain(VM);
    expect(
      fake.metricCalls
        .find((url: URL): boolean => {
          return url.pathname.includes("virtualMachines");
        })!
        .searchParams.get("metricnames"),
    ).toBe("Percentage CPU,Network In Total,Disk Read Bytes");
  });

  test("between listings a day-old selection stays until the next listing, which knows each resource's kind", async () => {
    const fake: FakeAzure = createFakeAzure({ resources: STANDARD_RESOURCES });
    const keyMetrics: AzureTypeKeyMetrics = getAzureKeyMetrics(
      "Microsoft.Compute/virtualMachines",
    )!;
    const stale: CloudConnectionPullState = {
      inventoryAt: new Date(NOW.getTime() - 10 * 60000).toISOString(),
      accounts: [SUB_A],
      azureMetricDefinitions: {
        "microsoft.compute/virtualmachines": {
          at: new Date(NOW.getTime() - 2 * 24 * 3600000).toISOString(),
          of: getAzureKeyMetricsFingerprint(keyMetrics),
          metrics: [
            {
              name: "Percentage CPU",
              unit: "Percent",
              aggregation: "Average",
              grain: "PT1M",
            },
          ],
        },
      },
    };
    const known: Parameters<AzureCloudConnector["read"]>[1]["knownResources"] =
      [
        {
          providerResourceId: VM,
          resourceType: "Microsoft.Compute/virtualMachines",
          name: "vm-web-1",
          region: "westeurope",
          accountId: SUB_A,
          resourceGroup: "rg-prod",
        },
      ];

    await connector.read(
      settings(),
      readOptions(fake, stale, { knownResources: known }),
    );

    expect(definitionCallsOf(fake)).toEqual([]);
    expect(fake.metricCalls[0]!.searchParams.get("metricnames")).toBe(
      "Percentage CPU",
    );

    // A read that lists resources reads them again.
    await connector.read(
      settings(),
      readOptions(fake, { ...stale, inventoryAt: undefined }),
    );

    expect(definitionCallsOf(fake)).toContain(VM);
  });
});

describe("choosing which resources' definitions to read", () => {
  test("one of each kind first, then the others, three at most", () => {
    expect(
      pickAzureDefinitionSamples([
        { id: "a", kind: "app" },
        { id: "b", kind: "app" },
        { id: "c", kind: "functionapp" },
        { id: "d", kind: "functionapp,linux" },
        { id: "e", kind: "app,linux" },
      ]).map((sample: { id: string }): string => {
        return sample.id;
      }),
    ).toEqual(["a", "c", "d"]);
    expect(
      pickAzureDefinitionSamples([
        { id: "a", kind: "app" },
        { id: "b", kind: "APP" },
        { id: "c" },
      ]).map((sample: { id: string }): string => {
        return sample.id;
      }),
    ).toEqual(["a", "c", "b"]);
    expect(pickAzureDefinitionSamples([])).toEqual([]);
    expect(AZURE_DEFINITION_SAMPLES).toBe(3);
  });

  test("selections together keep each metric once, the first's way, in the catalog's order", () => {
    const keyMetrics: AzureTypeKeyMetrics = {
      type: "Microsoft.Test/things",
      metrics: [
        { name: "a", group: CloudKeyMetricGroup.Traffic },
        { name: "b", group: CloudKeyMetricGroup.Errors },
        { name: "c", group: CloudKeyMetricGroup.Latency },
      ],
    };
    const selected: (name: string, aggregation: string) => SelectedMetric = (
      name: string,
      aggregation: string,
    ): SelectedMetric => {
      return { name, aggregation, grain: "PT1M", unit: "Count" };
    };

    expect(
      mergeAzureSelections(keyMetrics, [
        [selected("c", "Average")],
        [selected("A", "Total"), selected("c", "Maximum")],
        [],
      ]),
    ).toEqual([selected("A", "Total"), selected("c", "Average")]);
    expect(mergeAzureSelections(keyMetrics, [])).toEqual([]);
  });

  test("a type's fingerprint follows its key metrics", () => {
    const keyMetrics: AzureTypeKeyMetrics = getAzureKeyMetrics(
      "Microsoft.Web/sites",
    )!;

    expect(getAzureKeyMetricsFingerprint(keyMetrics)).toBe(
      getAzureKeyMetricsFingerprint({ ...keyMetrics }),
    );
    expect(
      getAzureKeyMetricsFingerprint({
        ...keyMetrics,
        metrics: keyMetrics.metrics.slice(1),
      }),
    ).not.toBe(getAzureKeyMetricsFingerprint(keyMetrics));
    expect(getAzureKeyMetricsFingerprint(keyMetrics)).toMatch(/^[0-9a-f]+$/);
  });

  test("only Azure Monitor's refusal of a metric a resource does not publish is read again", () => {
    const refusal: (body: string, status?: number) => LlmProviderError = (
      body: string,
      status: number = 400,
    ): LlmProviderError => {
      return new LlmProviderError({
        message: `Azure metrics request failed (${status})`,
        kind: CloudConnectionFailureKind.Other,
        statusCode: status,
        responseBody: body,
      });
    };

    expect(
      isAzureUnsupportedMetricsRefusal(
        refusal(
          '{"code":"BadRequest","message":"Failed to find metric configuration for provider: Microsoft.Network, resource Type: loadBalancers, metric: VipAvailability, Valid metrics: "}',
        ),
      ),
    ).toBe(true);
    expect(
      isAzureUnsupportedMetricsRefusal(
        refusal('{"message":"Metric: Foo is unknown. Valid metrics: a,b"}'),
      ),
    ).toBe(true);
    expect(
      isAzureUnsupportedMetricsRefusal(
        refusal('{"code":"BadRequest","message":"Invalid timespan."}'),
      ),
    ).toBe(false);
    expect(
      isAzureUnsupportedMetricsRefusal(
        refusal("Failed to find metric configuration", 403),
      ),
    ).toBe(false);
    expect(
      isAzureUnsupportedMetricsRefusal(
        new Error("Failed to find metric configuration"),
      ),
    ).toBe(false);
    expect(isAzureUnsupportedMetricsRefusal(undefined)).toBe(false);
    expect(AZURE_MAX_RESOURCE_DEFINITIONS).toBe(500);
  });
});
