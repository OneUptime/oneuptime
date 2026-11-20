import { describe, expect, test } from "@jest/globals";
import AzureArm from "../../../../Server/Utils/CloudConnection/Azure/AzureArm";
import AzureCloudConnector, {
  applyAzureSplits,
  getAzureSplitOrder,
  chunkAzureMetricCalls,
  withAzureResourceAdditions,
  AZURE_DEFINITION_SAMPLES,
  AZURE_FIVE_MINUTE_CURSOR,
  AZURE_MAX_RESOURCE_DEFINITIONS,
  SelectedMetric,
  getAzureKeyMetricsFingerprint,
  getAzureReadGroupKey,
  getAzureReadGroups,
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
  PUBSUB_PUBLISH_OPERATIONS_METRIC,
  RetiredCloudMetric,
} from "../../../../Utils/Metrics/RetiredCloudMetricMoves";
import { getRetiredCloudMetricReads } from "../../../../Utils/Metrics/RetiredCloudMetricReads";
import {
  AzureTypeKeyMetrics,
  getAzureKeyMetrics,
} from "../../../../Types/Cloud/CloudKeyMetrics";
import { CloudKeyMetricGroup } from "../../../../Types/Cloud/CloudKeyMetricGroup";
import {
  CLOUD_ADDED_METRIC_MAX_SPLIT_VALUES,
  CloudAddedMetric,
  CloudAddedMetricScope,
  getCloudAddedMetricKey,
  getCloudAddedMetricSplitAttribute,
} from "../../../../Types/Cloud/CloudAddedMetrics";
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
  /*
   * As Azure Monitor answers a call split by a dimension ($filter=<it> eq
   * '*'): a series per value, the first `top` of them, each its value in
   * metadatavalues as Azure writes it, its name lowercased.
   */
  splitValues?: Record<string, Array<string>>;
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

// A split call's filter, "<dimension> eq '*'": the dimension it splits by.
const SPLIT_FILTER: RegExp = /^([A-Za-z0-9]+) eq '\*'$/;

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
        const splitBy: string =
          SPLIT_FILTER.exec(url.searchParams.get("$filter") || "")?.[1] || "";
        const values: Array<string> = (
          options.splitValues?.[splitBy] || []
        ).slice(0, Number(url.searchParams.get("top") || 10));

        if (values.length > 0) {
          return json({
            value: names.map((name: string, index: number) => {
              return {
                name: { value: name, localizedValue: name },
                unit: "BytesPerSecond",
                timeseries: values.map((value: string, valueIndex: number) => {
                  return {
                    metadatavalues: [
                      {
                        name: {
                          value: splitBy.toLowerCase(),
                          localizedValue: splitBy,
                        },
                        value,
                      },
                    ],
                    data: [
                      {
                        timeStamp: new Date(start).toISOString(),
                        average: 10 + index + valueIndex,
                        total: 100 + index + valueIndex,
                      },
                    ],
                  };
                }),
              };
            }),
          });
        }

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

/*
 * A metric Azure Monitor keeps at five minutes at its finest takes a call
 * of its own: one marked as earning it (an App Service app's health check,
 * #9566) is read every 15 minutes, three points a call, beside its type's
 * minute metrics, and a type whose metrics are all five-minute ones (a
 * Static Web App) keeps reading them every read in its one call.
 */
describe("metrics Azure Monitor keeps at five minutes", () => {
  const SITE: string = `/subscriptions/${SUB_A}/resourceGroups/rg-web/providers/Microsoft.Web/sites/shop`;
  const STATIC: string = `/subscriptions/${SUB_A}/resourceGroups/rg-web/providers/Microsoft.Web/staticSites/docs`;
  const SITE_DEFINITIONS: Array<JSONObject> = [
    definition("Requests", "Total", ["PT1M", "PT1H"], "Count"),
    definition("Http5xx", "Total", ["PT1M"], "Count"),
    definition(
      "HealthCheckStatus",
      "Average",
      ["PT5M", "PT1H", "P1D"],
      "Count",
    ),
  ];
  const STATIC_DEFINITIONS: Array<JSONObject> = [
    definition("SiteHits", "Total", ["PT5M", "PT1H", "P1D"], "Count"),
    definition("SiteErrors", "Total", ["PT5M", "PT1H", "P1D"], "Count"),
  ];

  function siteFake(): FakeAzure {
    return createFakeAzure({
      resources: {
        [SUB_A]: [
          resource(SITE, "Microsoft.Web/sites", "shop"),
          resource(STATIC, "Microsoft.Web/staticSites", "docs"),
        ],
      },
      definitions: { [SITE]: SITE_DEFINITIONS, [STATIC]: STATIC_DEFINITIONS },
    });
  }

  // Each metrics call a resource got: what it asked, at which grain, for when.
  function callsOf(
    fake: FakeAzure,
    id: string,
  ): Array<{ metrics: string; interval: string; timespan: string }> {
    return fake.metricCalls
      .filter((url: URL): boolean => {
        return url.pathname.startsWith(id);
      })
      .map((url: URL) => {
        return {
          metrics: url.searchParams.get("metricnames") || "",
          interval: url.searchParams.get("interval") || "",
          timespan: url.searchParams.get("timespan") || "",
        };
      });
  }

  function at(
    time: string,
  ): Partial<Parameters<AzureCloudConnector["read"]>[1]> {
    return {
      now: () => {
        return new Date(time);
      },
    };
  }

  // The next read's state: it lists again, so the fake's resources are read.
  function relisting(
    state: CloudConnectionPullState,
  ): CloudConnectionPullState {
    const next: CloudConnectionPullState = { ...state };
    delete next.inventoryAt;
    return next;
  }

  test("a health check is read in a five-minute call of its own, the app's minute metrics in theirs, a Static Web App's in its one", async () => {
    const fake: FakeAzure = siteFake();

    const result: CloudReadResult = await connector.read(
      settings(),
      readOptions(fake),
    );

    expect(callsOf(fake, SITE)).toEqual([
      {
        metrics: "Requests,Http5xx",
        interval: "PT1M",
        timespan: "2026-10-21T11:03:00.000Z/2026-10-21T12:03:00.000Z",
      },
      // Its window ends on a whole five minutes: 12:00, four minutes back.
      {
        metrics: "HealthCheckStatus",
        interval: "PT5M",
        timespan: "2026-10-21T11:00:00.000Z/2026-10-21T12:00:00.000Z",
      },
    ]);
    expect(callsOf(fake, STATIC)).toEqual([
      {
        metrics: "SiteHits,SiteErrors",
        interval: "PT5M",
        timespan: "2026-10-21T11:00:00.000Z/2026-10-21T12:00:00.000Z",
      },
    ]);
    // Each call's window has its own cursor.
    expect(result.nextState.cursors).toEqual({
      "60": "2026-10-21T12:03:00.000Z",
      "300": "2026-10-21T12:00:00.000Z",
      "300/900": "2026-10-21T12:00:00.000Z",
    });

    // Its points say their grain, as the azure_monitor receiver's do.
    const health: Array<{ stored: JSONObject }> = datapoints(result).filter(
      (point: { metricName: string }): boolean => {
        return point.metricName === "azure_healthcheckstatus_average";
      },
    );

    expect(health.length).toBeGreaterThan(0);
    expect(health[0]!.stored["timegrain"]).toBe("PT5M");
  });

  test("the five-minute call waits for 15 minutes of points, three a call; the minute call and the Static Web App's are read every read", async () => {
    const first: CloudReadResult = await connector.read(
      settings(),
      readOptions(siteFake()),
    );

    // Five minutes on: the minute call and the Static Web App's, no health check.
    const second: FakeAzure = siteFake();
    const secondResult: CloudReadResult = await connector.read(
      settings(),
      readOptions(
        second,
        relisting(first.nextState),
        at("2026-10-21T12:12:00Z"),
      ),
    );

    expect(callsOf(second, SITE)).toEqual([
      {
        metrics: "Requests,Http5xx",
        interval: "PT1M",
        timespan: "2026-10-21T12:03:00.000Z/2026-10-21T12:08:00.000Z",
      },
    ]);
    expect(callsOf(second, STATIC)).toEqual([
      {
        metrics: "SiteHits,SiteErrors",
        interval: "PT5M",
        timespan: "2026-10-21T12:00:00.000Z/2026-10-21T12:05:00.000Z",
      },
    ]);
    // Not read: its cursor stays where its last call ended.
    expect(secondResult.nextState.cursors?.["300/900"]).toBe(
      "2026-10-21T12:00:00.000Z",
    );

    // Fifteen minutes of it are there: one call, three points.
    const third: FakeAzure = siteFake();
    const thirdResult: CloudReadResult = await connector.read(
      settings(),
      readOptions(
        third,
        relisting(secondResult.nextState),
        at("2026-10-21T12:22:00Z"),
      ),
    );

    expect(
      callsOf(third, SITE).filter((call: { interval: string }): boolean => {
        return call.interval === "PT5M";
      }),
    ).toEqual([
      {
        metrics: "HealthCheckStatus",
        interval: "PT5M",
        timespan: "2026-10-21T12:00:00.000Z/2026-10-21T12:15:00.000Z",
      },
    ]);
    expect(thirdResult.nextState.cursors?.["300/900"]).toBe(
      "2026-10-21T12:15:00.000Z",
    );
  });

  test("a health check offered at a minute is read in the minute call, at no cost", async () => {
    const fake: FakeAzure = createFakeAzure({
      resources: { [SUB_A]: [resource(SITE, "Microsoft.Web/sites", "shop")] },
      definitions: {
        [SITE]: [
          definition("Requests", "Total", ["PT1M"], "Count"),
          definition("HealthCheckStatus", "Average", ["PT1M", "PT5M"], "Count"),
        ],
      },
    });

    await connector.read(settings(), readOptions(fake));

    expect(callsOf(fake, SITE)).toEqual([
      {
        metrics: "Requests,HealthCheckStatus",
        interval: "PT1M",
        timespan: "2026-10-21T11:03:00.000Z/2026-10-21T12:03:00.000Z",
      },
    ]);
  });

  test("which call a metric is read in, and when each call is due", () => {
    const metric: (name: string, grain: string) => SelectedMetric = (
      name: string,
      grain: string,
    ): SelectedMetric => {
      return { name, grain, aggregation: "Average", unit: "Count" };
    };

    expect(AZURE_FIVE_MINUTE_CURSOR).toBe("300/900");
    expect(
      getAzureReadGroupKey(
        "Microsoft.Web/sites",
        metric("HealthCheckStatus", "PT5M"),
      ),
    ).toBe(AZURE_FIVE_MINUTE_CURSOR);
    expect(
      getAzureReadGroupKey(
        "microsoft.web/SITES",
        metric("healthcheckstatus", "pt5m"),
      ),
    ).toBe(AZURE_FIVE_MINUTE_CURSOR);
    // Offered at a minute: the minute call's.
    expect(
      getAzureReadGroupKey(
        "Microsoft.Web/sites",
        metric("HealthCheckStatus", "PT1M"),
      ),
    ).toBe("PT1M");
    // Not marked: its grain's call, read every read.
    expect(
      getAzureReadGroupKey(
        "Microsoft.Web/staticSites",
        metric("SiteHits", "PT5M"),
      ),
    ).toBe("PT5M");
    expect(
      getAzureReadGroupKey("Microsoft.Web/sites", metric("Requests", "pt1m")),
    ).toBe("PT1M");

    const cursors: Record<string, string> = {
      "300/900": "2026-10-21T12:00:00.000Z",
    };
    const windowAt: (time: string) => unknown = (time: string): unknown => {
      return getAzureReadGroups({ cursors, now: new Date(time) }).get(
        AZURE_FIVE_MINUTE_CURSOR,
      )!.window;
    };

    // 12:12: five minutes of it are there, not fifteen.
    expect(windowAt("2026-10-21T12:12:00Z")).toBeNull();
    expect(windowAt("2026-10-21T12:18:00Z")).toBeNull();
    expect(windowAt("2026-10-21T12:19:00Z")).toEqual({
      periodSeconds: 300,
      start: new Date("2026-10-21T12:00:00.000Z"),
      end: new Date("2026-10-21T12:15:00.000Z"),
    });
    // The other grains keep their own cursors, every read.
    expect(
      getAzureReadGroups({
        cursors,
        now: new Date("2026-10-21T12:12:00Z"),
      }).get("PT5M")!.window,
    ).not.toBeNull();
  });
});

/*
 * A deprecated metric is no key metric (#9565): a Cosmos DB account's
 * latency is read from ServerSideLatencyDirect and ServerSideLatencyGateway.
 * ServerSideLatency rode in the same call for the monitors built on it
 * until they were moved to one of the two (#9739): it is read no more,
 * whatever the definitions list.
 */
describe("a deprecated metric no longer read", () => {
  const COSMOS: string = `/subscriptions/${SUB_A}/resourceGroups/rg-data/providers/Microsoft.DocumentDB/databaseAccounts/orders`;
  const cosmos: AzureTypeKeyMetrics = getAzureKeyMetrics(
    "Microsoft.DocumentDB/databaseAccounts",
  )!;

  test("is not asked, even where the definitions still list it", async () => {
    const fake: FakeAzure = createFakeAzure({
      resources: {
        [SUB_A]: [
          resource(COSMOS, "Microsoft.DocumentDB/databaseAccounts", "orders"),
        ],
      },
      definitions: {
        [COSMOS]: [
          definition("ServerSideLatency", "Average", ["PT1M"], "MilliSeconds"),
          definition("TotalRequests", "Count", ["PT1M"], "Count"),
          definition(
            "ServerSideLatencyDirect",
            "Average",
            ["PT1M"],
            "MilliSeconds",
          ),
          definition("DataUsageV2", "Total", ["PT5M", "PT1H"], "Bytes"),
        ],
      },
      refuseUnpublished: true,
    });

    const result: CloudReadResult = await connector.read(
      settings(),
      readOptions(fake),
    );

    expect(
      fake.metricCalls.map((url: URL) => {
        return [
          url.searchParams.get("metricnames"),
          url.searchParams.get("interval"),
        ];
      }),
    ).toEqual([
      ["TotalRequests,ServerSideLatencyDirect", "PT1M"],
      ["DataUsageV2", "PT5M"],
    ]);
    expect(
      Array.from(
        new Set(
          datapoints(result).map((point: { metricName: string }): string => {
            return point.metricName;
          }),
        ),
      ).sort(),
    ).toEqual([
      // The fake answers no count: TotalRequests writes nothing here.
      "azure_datausagev2_total",
      "azure_serversidelatencydirect_average",
    ]);
    expect(result.warnings).toEqual([]);
  });

  test("is not asked where the definitions no longer list it", async () => {
    const fake: FakeAzure = createFakeAzure({
      resources: {
        [SUB_A]: [
          resource(COSMOS, "Microsoft.DocumentDB/databaseAccounts", "orders"),
        ],
      },
      definitions: {
        [COSMOS]: [
          definition(
            "ServerSideLatencyGateway",
            "Average",
            ["PT1M"],
            "MilliSeconds",
          ),
        ],
      },
      refuseUnpublished: true,
    });

    const result: CloudReadResult = await connector.read(
      settings(),
      readOptions(fake),
    );

    expect(
      fake.metricCalls.map((url: URL): string | null => {
        return url.searchParams.get("metricnames");
      }),
    ).toEqual(["ServerSideLatencyGateway"]);
    expect(result.warnings).toEqual([]);
  });

  test("selections never pick it, and a cached one that holds it drops it", () => {
    const selected: (name: string) => SelectedMetric = (
      name: string,
    ): SelectedMetric => {
      return { name, aggregation: "Average", grain: "PT1M", unit: "Count" };
    };

    expect(
      selectAzureMetrics(cosmos, [
        {
          name: "ServerSideLatency",
          unit: "MilliSeconds",
          primaryAggregationType: "Average",
          timeGrains: ["PT1M"],
        },
        {
          name: "TotalRequests",
          unit: "Count",
          primaryAggregationType: "Count",
          timeGrains: ["PT1M"],
        },
      ]).map((metric: SelectedMetric): string => {
        return metric.name;
      }),
    ).toEqual(["TotalRequests"]);
    // A selection a read kept from before (#9739) asks it no more.
    expect(
      mergeAzureSelections(cosmos, [
        [selected("ServerSideLatency")],
        [selected("ServerSideLatencyGateway")],
      ]).map((metric: SelectedMetric): string => {
        return metric.name;
      }),
    ).toEqual(["ServerSideLatencyGateway"]);
    expect(cosmos.retired).toBeUndefined();
  });

  /*
   * The way to retire a metric stays: one kept for its monitors rides
   * after the key metrics, and a type's fingerprint follows it, so the
   * selections a read kept are made again once it goes.
   */
  test("a metric kept for its monitors rides after the key metrics, and the fingerprint follows it", () => {
    const withRetired: AzureTypeKeyMetrics = {
      ...cosmos,
      retired: [
        {
          name: "ServerSideLatency",
          replacedBy: ["ServerSideLatencyDirect", "ServerSideLatencyGateway"],
        },
      ],
    };

    expect(
      selectAzureMetrics(withRetired, [
        {
          name: "ServerSideLatency",
          unit: "MilliSeconds",
          primaryAggregationType: "Average",
          timeGrains: ["PT1M"],
        },
        {
          name: "TotalRequests",
          unit: "Count",
          primaryAggregationType: "Count",
          timeGrains: ["PT1M"],
        },
      ]).map((metric: SelectedMetric): string => {
        return metric.name;
      }),
    ).toEqual(["TotalRequests", "ServerSideLatency"]);
    expect(getAzureKeyMetricsFingerprint(cosmos)).not.toBe(
      getAzureKeyMetricsFingerprint(withRetired),
    );
  });
});

/*
 * #9739's gap: a monitor the move left on ServerSideLatency - an account
 * that reported neither latency when the migration ran - keeps it read, of
 * that account alone, until it is moved (RetiredCloudMetricReads): the
 * read hands it to the connector as an added metric of its own.
 */
describe("a deprecated metric a monitor still reads", () => {
  const COSMOS: string = `/subscriptions/${SUB_A}/resourceGroups/rg-data/providers/Microsoft.DocumentDB/databaseAccounts/orders`;
  const COSMOS_2: string = `/subscriptions/${SUB_A}/resourceGroups/rg-data/providers/Microsoft.DocumentDB/databaseAccounts/carts`;
  const COSMOS_TYPE: string = "Microsoft.DocumentDB/databaseAccounts";
  const STILL_PUBLISHED: Array<JSONObject> = [
    definition("ServerSideLatency", "Average", ["PT1M"], "MilliSeconds"),
    definition("ServerSideLatencyGateway", "Average", ["PT1M"], "MilliSeconds"),
  ];

  function twoAccounts(definitions: Array<JSONObject>): FakeAzure {
    return createFakeAzure({
      resources: {
        [SUB_A]: [
          resource(COSMOS, COSMOS_TYPE, "orders"),
          resource(COSMOS_2, COSMOS_TYPE, "carts"),
        ],
      },
      definitions: { [COSMOS]: definitions, [COSMOS_2]: definitions },
      refuseUnpublished: true,
    });
  }

  function readsOf(attributes: unknown): Array<CloudAddedMetric> {
    return getRetiredCloudMetricReads([
      {
        metric: RetiredCloudMetric.CosmosServerSideLatency,
        metricVariable: "a",
        metricName: "azure_serversidelatency_average",
        attributes,
      },
      // Another cloud's read is never Azure's to ask.
      {
        metric: RetiredCloudMetric.PubSubPublishOperations,
        metricVariable: "b",
        metricName: PUBSUB_PUBLISH_OPERATIONS_METRIC,
        attributes: {},
      },
    ]);
  }

  test("is asked of the account its monitor reads, in that account's own minute call, and stored as before", async () => {
    const fake: FakeAzure = twoAccounts(STILL_PUBLISHED);

    const result: CloudReadResult = await connector.read(
      settings(),
      readOptions(
        fake,
        {},
        {
          addedMetrics: readsOf({ "azuremonitor.resource_id": COSMOS }),
        },
      ),
    );

    expect(metricNamesAsked(fake, COSMOS)).toEqual([
      "ServerSideLatencyGateway,ServerSideLatency",
    ]);
    expect(metricNamesAsked(fake, COSMOS_2)).toEqual([
      "ServerSideLatencyGateway",
    ]);
    expect(writtenNamesOf(result, COSMOS)).toContain(
      "azure_serversidelatency_average",
    );
    expect(writtenNamesOf(result, COSMOS_2)).not.toContain(
      "azure_serversidelatency_average",
    );
    expect(result.warnings).toEqual([]);
  });

  test("is asked of every account for a monitor of every account", async () => {
    const fake: FakeAzure = twoAccounts(STILL_PUBLISHED);

    const result: CloudReadResult = await connector.read(
      settings(),
      readOptions(fake, {}, { addedMetrics: readsOf({}) }),
    );

    for (const account of [COSMOS, COSMOS_2]) {
      expect(metricNamesAsked(fake, account)).toEqual([
        "ServerSideLatencyGateway,ServerSideLatency",
      ]);
      expect(writtenNamesOf(result, account)).toContain(
        "azure_serversidelatency_average",
      );
    }
  });

  test("once Microsoft stops publishing it, the account's latency is still read: the refused call is made again without it", async () => {
    const fake: FakeAzure = twoAccounts([
      definition(
        "ServerSideLatencyGateway",
        "Average",
        ["PT1M"],
        "MilliSeconds",
      ),
    ]);

    const result: CloudReadResult = await connector.read(
      settings(),
      readOptions(
        fake,
        {},
        {
          addedMetrics: readsOf({ "azuremonitor.resource_id": COSMOS }),
        },
      ),
    );

    expect(metricNamesAsked(fake, COSMOS)).toEqual([
      "ServerSideLatencyGateway,ServerSideLatency",
      "ServerSideLatencyGateway",
    ]);
    expect(writtenNamesOf(result, COSMOS)).toEqual([
      "azure_serversidelatencygateway_average",
    ]);
    expect(result.warnings).toEqual([]);
  });

  test("a type's read its accounts no longer publish is never asked", async () => {
    const fake: FakeAzure = twoAccounts([
      definition(
        "ServerSideLatencyGateway",
        "Average",
        ["PT1M"],
        "MilliSeconds",
      ),
    ]);

    const result: CloudReadResult = await connector.read(
      settings(),
      readOptions(fake, {}, { addedMetrics: readsOf(undefined) }),
    );

    expect(metricNamesAsked(fake, COSMOS)).toEqual([
      "ServerSideLatencyGateway",
    ]);
    expect(result.warnings).toEqual([]);
  });
});

/*
 * ---- Metrics a person added to the reads (#9563) -------------------------
 *
 * An added metric is read with the key metrics, in the call that reads them
 * while it has room (20 metrics), and only of the resources that publish
 * it: a type's of every resource of the type its definitions list it for, a
 * resource's own of that resource alone.
 */
describe("metrics a person added to the reads", () => {
  const VM_TYPE: string = "Microsoft.Compute/virtualMachines";
  const VM_2: string = `/subscriptions/${SUB_A}/resourceGroups/rg-prod/providers/Microsoft.Compute/virtualMachines/vm-web-2`;
  const KEY_CALL: string = "Percentage CPU,Network In Total,Disk Read Bytes";

  function added(overrides: Partial<CloudAddedMetric> = {}): CloudAddedMetric {
    const metric: CloudAddedMetric = {
      key: "",
      provider: CloudProvider.Azure,
      scope: CloudAddedMetricScope.Type,
      resourceType: VM_TYPE,
      name: "Data Disk Read Bytes/sec",
      aggregation: "Average",
      grain: "PT1M",
      unit: "BytesPerSecond",
      addedAt: NOW.toISOString(),
      ...overrides,
    };

    return { ...metric, key: getCloudAddedMetricKey(metric) };
  }

  function ownAddition(
    overrides: Partial<CloudAddedMetric> = {},
  ): CloudAddedMetric {
    return added({
      scope: CloudAddedMetricScope.Resource,
      cloudResourceId: "c1d2e3f4-0000-4000-8000-000000000001",
      azureResourceId: VM,
      ...overrides,
    });
  }

  function twoVms(options: Partial<FakeAzureOptions> = {}): FakeAzure {
    return createFakeAzure({
      resources: {
        [SUB_A]: [
          resource(VM, VM_TYPE, "vm-web-1"),
          resource(VM_2, VM_TYPE, "vm-web-2"),
        ],
      },
      ...options,
    });
  }

  test("a type's addition rides in each resource's minute call, at no extra call, stored as the receiver names it", async () => {
    const fake: FakeAzure = twoVms();

    const result: CloudReadResult = await connector.read(
      settings(),
      readOptions(fake, {}, { addedMetrics: [added()] }),
    );

    expect(metricNamesAsked(fake, VM)).toEqual([
      `${KEY_CALL},Data Disk Read Bytes/sec`,
    ]);
    expect(metricNamesAsked(fake, VM_2)).toEqual([
      `${KEY_CALL},Data Disk Read Bytes/sec`,
    ]);
    expect(writtenNamesOf(result, VM)).toContain(
      "azure_data_disk_read_bytes/sec_average",
    );
    expect(writtenNamesOf(result, VM_2)).toContain(
      "azure_data_disk_read_bytes/sec_average",
    );

    // Its points say their grain, as a key metric's do.
    const point: { stored: JSONObject } | undefined = datapoints(result).find(
      (candidate: { metricName: string }): boolean => {
        return (
          candidate.metricName === "azure_data_disk_read_bytes/sec_average"
        );
      },
    );

    expect(point?.stored["timegrain"]).toBe("PT1M");
  });

  test("a resource's own addition is asked of that resource alone", async () => {
    const fake: FakeAzure = twoVms();

    const result: CloudReadResult = await connector.read(
      settings(),
      readOptions(fake, {}, { addedMetrics: [ownAddition()] }),
    );

    expect(metricNamesAsked(fake, VM)).toEqual([
      `${KEY_CALL},Data Disk Read Bytes/sec`,
    ]);
    expect(metricNamesAsked(fake, VM_2)).toEqual([KEY_CALL]);
    expect(writtenNamesOf(result, VM_2)).not.toContain(
      "azure_data_disk_read_bytes/sec_average",
    );
  });

  /*
   * #9808: an addition split by one of its dimensions is read in a call of
   * its own, whose filter splits it alone - never the key metrics' call,
   * which the filter would split too - the busiest 10 values, a series
   * each, stored with the value as the receiver files it.
   */
  test("a split addition is read in a call of its own, split by its dimension, its busiest values, a series each stored with its value", async () => {
    const fake: FakeAzure = twoVms({
      splitValues: { LUN: ["0", "1", "2"] },
    });

    const result: CloudReadResult = await connector.read(
      settings(),
      readOptions(fake, {}, { addedMetrics: [added({ splitBy: "LUN" })] }),
    );

    // The key metrics' call as it was, and one more for the split.
    expect(metricNamesAsked(fake, VM)).toEqual([
      KEY_CALL,
      "Data Disk Read Bytes/sec",
    ]);

    const calls: Array<URL> = fake.metricCalls.filter((url: URL): boolean => {
      return url.pathname.startsWith(`${VM}/`);
    });

    expect(calls[0]!.searchParams.get("$filter")).toBeNull();
    expect(calls[1]!.searchParams.get("$filter")).toBe("LUN eq '*'");
    expect(calls[1]!.searchParams.get("top")).toBe(
      String(CLOUD_ADDED_METRIC_MAX_SPLIT_VALUES),
    );
    expect(calls[1]!.searchParams.get("orderby")).toBe("average desc");
    expect(calls[1]!.searchParams.get("ValidateDimensions")).toBe("false");
    expect(calls[1]!.searchParams.get("aggregation")).toBe("Average");

    const split: Array<{ stored: JSONObject; value: number }> = datapoints(
      result,
    ).filter((point: { metricName: string; stored: JSONObject }): boolean => {
      return (
        point.metricName === "azure_data_disk_read_bytes/sec_average" &&
        point.stored["azuremonitor.resource_id"] === VM
      );
    });

    expect(
      split.map((point: { stored: JSONObject }) => {
        return point.stored[
          getCloudAddedMetricSplitAttribute({
            provider: CloudProvider.Azure,
            splitBy: "LUN",
          })
        ];
      }),
    ).toEqual(["0", "1", "2"]);
    // A split stopped at its cap leaves no namespace's queues unread to warn of.
    expect(result.warnings).toEqual([]);
  });

  test("a split addition of a total is ordered by its sum; one read whole rides in the key metrics' call as before", async () => {
    const fake: FakeAzure = twoVms({
      splitValues: { LUN: ["0"] },
    });

    await connector.read(
      settings(),
      readOptions(
        fake,
        {},
        {
          addedMetrics: [
            ownAddition({
              name: "Data Disk Read Bytes/sec",
              aggregation: "Total",
              splitBy: "LUN",
            }),
          ],
        },
      ),
    );

    const split: URL | undefined = fake.metricCalls.find((url: URL) => {
      return (
        url.pathname.startsWith(`${VM}/`) &&
        url.searchParams.get("$filter") === "LUN eq '*'"
      );
    });

    expect(split?.searchParams.get("orderby")).toBe("sum desc");
    // The other VM has no addition: its key metrics' call alone.
    expect(metricNamesAsked(fake, VM_2)).toEqual([KEY_CALL]);
    expect(getAzureSplitOrder("Maximum")).toBe("maximum desc");
    expect(getAzureSplitOrder("")).toBe("average desc");
  });

  test("an addition's split is the one it has now, whatever selection was kept", () => {
    expect(
      applyAzureSplits(
        [
          {
            name: "Percentage CPU",
            aggregation: "Average",
            grain: "PT1M",
            unit: "Percent",
          },
          {
            name: "Data Disk Read Bytes/sec",
            aggregation: "Average",
            grain: "PT1M",
            unit: "BytesPerSecond",
            isAdded: true,
            splitBy: "Old",
          },
        ],
        [{ name: "data disk read bytes/sec", splitBy: "LUN" }],
      ).map((metric: { name: string; splitBy?: string | undefined }) => {
        return `${metric.name}:${metric.splitBy || ""}`;
      }),
    ).toEqual(["Percentage CPU:", "Data Disk Read Bytes/sec:LUN"]);
    expect(
      applyAzureSplits(
        [
          {
            name: "Data Disk Read Bytes/sec",
            aggregation: "Average",
            grain: "PT1M",
            unit: "BytesPerSecond",
            isAdded: true,
            splitBy: "LUN",
          },
        ],
        [{ name: "Data Disk Read Bytes/sec" }],
      )[0]!.splitBy,
    ).toBeUndefined();
  });

  test("a type's addition its resources do not publish is never asked, so no call is refused", async () => {
    const fake: FakeAzure = twoVms({ refuseUnpublished: true });

    const result: CloudReadResult = await connector.read(
      settings(),
      readOptions(
        fake,
        {},
        { addedMetrics: [added({ name: "Not Published Anywhere" })] },
      ),
    );

    expect(metricNamesAsked(fake, VM)).toEqual([KEY_CALL]);
    expect(result.warnings).toEqual([]);
  });

  test("a resource's own addition it no longer publishes is dropped after Azure refuses it, and its key metrics are read", async () => {
    const fake: FakeAzure = twoVms({ refuseUnpublished: true });

    const result: CloudReadResult = await connector.read(
      settings(),
      readOptions(
        fake,
        {},
        { addedMetrics: [ownAddition({ name: "Gone Metric" })] },
      ),
    );

    expect(metricNamesAsked(fake, VM)).toEqual([
      `${KEY_CALL},Gone Metric`,
      KEY_CALL,
    ]);
    expect(writtenNamesOf(result, VM)).toEqual([
      "azure_disk_read_bytes_total",
      "azure_network_in_total_total",
      "azure_percentage_cpu_average",
    ]);
    expect(result.warnings).toEqual([]);
  });

  test("past 20 metrics a resource's additions take a second call, and the key metrics keep the first", async () => {
    const keyNames: Array<string> = getAzureKeyMetrics(VM_TYPE)!.metrics.map(
      (metric: { name: string }): string => {
        return metric.name;
      },
    );
    const extra: Array<string> = [
      "Extra A",
      "Extra B",
      "Extra C",
      "Extra D",
      "Extra E",
    ];
    const everything: Array<JSONObject> = [...keyNames, ...extra].map(
      (name: string): JSONObject => {
        return definition(name, "Average", ["PT1M"]);
      },
    );
    const fake: FakeAzure = twoVms({
      definitions: { [VM]: everything, [VM_2]: everything },
    });

    await connector.read(
      settings(),
      readOptions(
        fake,
        {},
        {
          addedMetrics: extra.map((name: string): CloudAddedMetric => {
            return added({ name });
          }),
        },
      ),
    );

    const calls: Array<Array<string>> = metricNamesAsked(fake, VM).map(
      (call: string): Array<string> => {
        return call.split(",");
      },
    );

    expect(keyNames.length).toBeLessThan(20);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toHaveLength(20);
    expect(calls[0]!.slice(0, keyNames.length)).toEqual(keyNames);
    expect([...calls[0]!.slice(keyNames.length), ...calls[1]!]).toEqual(extra);
  });

  test("an addition kept at five minutes is read in the five-minute call every 15 minutes, never a call of its own each read", async () => {
    const withFiveMinutes: Array<JSONObject> = [
      ...VM_DEFINITIONS,
      definition("Five Minute Only", "Average", ["PT5M", "PT1H"]),
    ];
    const fake: FakeAzure = twoVms({
      definitions: { [VM]: withFiveMinutes, [VM_2]: VM_DEFINITIONS },
    });

    const result: CloudReadResult = await connector.read(
      settings(),
      readOptions(
        fake,
        {},
        {
          addedMetrics: [
            ownAddition({ name: "Five Minute Only", grain: "PT5M" }),
          ],
        },
      ),
    );

    const calls: Array<string> = fake.metricCalls
      .filter((url: URL): boolean => {
        return url.pathname.startsWith(`${VM}/`);
      })
      .map((url: URL): string => {
        return `${url.searchParams.get("interval")}:${url.searchParams.get("metricnames")}`;
      });

    expect(calls).toEqual([`PT1M:${KEY_CALL}`, "PT5M:Five Minute Only"]);
    expect(result.nextState.cursors?.["300/900"]).toBe(
      "2026-10-21T12:00:00.000Z",
    );
  });

  test("a type's kept selection is read again when its additions change, and kept while they do not", async () => {
    const first: CloudReadResult = await connector.read(
      settings(),
      readOptions(twoVms()),
    );
    // The next reads list again, five minutes on, so the fake's resources are read.
    const relisted: CloudConnectionPullState = { ...first.nextState };
    delete relisted.inventoryAt;
    const later: () => Date = (): Date => {
      return new Date("2026-10-21T12:12:00Z");
    };

    // The same additions (none): the kept selection, no definitions call.
    const same: FakeAzure = twoVms();
    await connector.read(
      settings(),
      readOptions(same, relisted, { now: later }),
    );
    expect(metricNamesAsked(same, VM)).toEqual([KEY_CALL]);
    expect(definitionCallsOf(same)).toEqual([]);

    // An addition to the type: its definitions are read again at once.
    const changed: FakeAzure = twoVms();
    await connector.read(
      settings(),
      readOptions(changed, relisted, { now: later, addedMetrics: [added()] }),
    );
    expect(definitionCallsOf(changed).length).toBeGreaterThan(0);
    expect(metricNamesAsked(changed, VM)).toEqual([
      `${KEY_CALL},Data Disk Read Bytes/sec`,
    ]);
  });

  test("a resource's own additions follow the type's selection, each once, at a grain its call can ask", () => {
    const selection: Array<SelectedMetric> = [
      {
        name: "Percentage CPU",
        aggregation: "Average",
        grain: "PT1M",
        unit: "Percent",
      },
    ];

    expect(
      withAzureResourceAdditions(selection, [
        ownAddition({ name: "percentage cpu" }),
        ownAddition({ name: "Data Disk Read Bytes/sec" }),
        ownAddition({
          name: "Data Disk Read Bytes/sec",
          aggregation: "Maximum",
        }),
        ownAddition({ name: "No Grain", grain: "P7D" }),
      ]),
    ).toEqual([
      ...selection,
      {
        name: "Data Disk Read Bytes/sec",
        aggregation: "Average",
        grain: "PT1M",
        unit: "BytesPerSecond",
        isAdded: true,
      },
    ]);
  });

  test("an addition is read with the aggregation it was added with while its definition offers it", () => {
    const vm: AzureTypeKeyMetrics = getAzureKeyMetrics(VM_TYPE)!;

    expect(
      selectAzureMetrics(
        vm,
        [
          {
            name: "Data Disk Read Bytes/sec",
            unit: "BytesPerSecond",
            primaryAggregationType: "Average",
            supportedAggregationTypes: ["Average", "Maximum"],
            timeGrains: ["PT1M"],
          },
          {
            name: "Queue Depth",
            unit: "Count",
            primaryAggregationType: "Average",
            supportedAggregationTypes: ["Average"],
            timeGrains: ["PT1M"],
          },
        ],
        [
          added({ aggregation: "Maximum" }),
          added({ name: "Queue Depth", aggregation: "Total" }),
        ],
      ),
    ).toEqual([
      {
        name: "Data Disk Read Bytes/sec",
        aggregation: "Maximum",
        grain: "PT1M",
        unit: "BytesPerSecond",
        isAdded: true,
      },
      // Total is not offered: its primary aggregation.
      {
        name: "Queue Depth",
        aggregation: "Average",
        grain: "PT1M",
        unit: "Count",
        isAdded: true,
      },
    ]);
  });

  test("calls of 20 metrics at most, in order", () => {
    expect(chunkAzureMetricCalls([])).toEqual([]);
    expect(chunkAzureMetricCalls([1, 2, 3])).toEqual([[1, 2, 3]]);

    const many: Array<number> = Array.from(
      { length: 41 },
      (_: unknown, index: number): number => {
        return index;
      },
    );
    const calls: Array<Array<number>> = chunkAzureMetricCalls(many);

    expect(
      calls.map((call: Array<number>): number => {
        return call.length;
      }),
    ).toEqual([20, 20, 1]);
    expect(calls.flat()).toEqual(many);
  });

  test("an addition that is a key metric of the type is read once, as the key metric", () => {
    const vm: AzureTypeKeyMetrics = getAzureKeyMetrics(VM_TYPE)!;

    expect(
      selectAzureMetrics(
        vm,
        [
          {
            name: "Percentage CPU",
            unit: "Percent",
            primaryAggregationType: "Average",
            timeGrains: ["PT1M"],
          },
        ],
        [added({ name: "Percentage CPU" })],
      ),
    ).toEqual([
      {
        name: "Percentage CPU",
        aggregation: "Average",
        grain: "PT1M",
        unit: "Percent",
      },
    ]);
    expect(getAzureKeyMetricsFingerprint(vm, [added()])).not.toBe(
      getAzureKeyMetricsFingerprint(vm),
    );
    expect(getAzureKeyMetricsFingerprint(vm, [])).toBe(
      getAzureKeyMetricsFingerprint(vm),
    );
  });
});
