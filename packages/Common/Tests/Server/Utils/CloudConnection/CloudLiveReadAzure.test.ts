import { describe, expect, test } from "@jest/globals";
import { CloudConnectionSettings } from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import AzureLiveRead, {
  buildAzureLogQuery,
  toODataString,
} from "../../../../Server/Utils/CloudConnection/LiveRead/AzureLiveRead";
import {
  CloudLiveReadError,
  CloudLiveReadInventoryRow,
} from "../../../../Server/Utils/CloudConnection/LiveRead/CloudLiveReadTypes";
import { DataSourceHttpRequest } from "../../../../Server/Utils/DataSource/HttpFetch";
import LlmProviderError from "../../../../Server/Utils/LlmObservability/LlmProviderError";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import { CloudConnectionAuthMethod } from "../../../../Types/CloudConnection/CloudConnectionCatalog";
import { CloudConnectionFailureKind } from "../../../../Types/CloudConnection/CloudConnectionTest";
import { JSONObject } from "../../../../Types/JSON";
import {
  AZURE_CLIENT,
  AZURE_CLIENT_SECRET,
  AZURE_SUBSCRIPTION,
  AZURE_TENANT,
  FakeAzureLive,
  createFakeAzureLive,
  headerOf,
  inventoryRow,
  liveContext,
  liveTarget,
} from "./CloudLiveReadFakes";
import {
  logAnalyticsProblems,
  operatorsOf,
  resourceGraphProblems,
  shapeOf,
  stringLiteralValuesOf,
} from "./AzureKqlGrammar";
import { FakeResponse, json } from "../LlmObservability/FakeProviderApi";

/*
 * The live reads of an Azure subscription against a fake Azure: each
 * kind's Resource Manager GET at its fixed api-version (and a VM's
 * instance view), Resource Graph for any other resource, Resource Health
 * and the Activity Log filtered to the resource, the Compute usages of its
 * location, and a resource-centric Log Analytics query signed in for Log
 * Analytics' own audience - and never an app's settings, a VM's custom
 * data or a container's environment.
 */

const PROVIDERS: string = `/subscriptions/${AZURE_SUBSCRIPTION}/resourceGroups/rg-prod/providers`;
const SITE: string = `${PROVIDERS}/Microsoft.Web/sites/web-app`;
const PLAN: string = `${PROVIDERS}/Microsoft.Web/serverfarms/plan-1`;
const CONTAINER_APP: string = `${PROVIDERS}/Microsoft.App/containerApps/api`;
const VM: string = `${PROVIDERS}/Microsoft.Compute/virtualMachines/vm-web-1`;
const VMSS: string = `${PROVIDERS}/Microsoft.Compute/virtualMachineScaleSets/vmss-1`;
const POSTGRES: string = `${PROVIDERS}/Microsoft.DBforPostgreSQL/flexibleServers/pg-1`;
const MYSQL: string = `${PROVIDERS}/Microsoft.DBforMySQL/flexibleServers/mysql-1`;
const FAILOVER_GROUP: string = `${PROVIDERS}/Microsoft.Sql/servers/sql-1/failoverGroups/fog-1`;
const STORAGE: string = `${PROVIDERS}/Microsoft.Storage/storageAccounts/acct1`;

function settings(): CloudConnectionSettings {
  return {
    provider: CloudProvider.Azure,
    projectId: "11111111-1111-4111-8111-111111111111",
    config: {
      authMethod: CloudConnectionAuthMethod.AzureClientSecret,
      tenantId: AZURE_TENANT,
      clientId: AZURE_CLIENT,
      cloud: "public",
    },
    secrets: { clientSecret: AZURE_CLIENT_SECRET },
  };
}

type ArmHandler = (url: URL, request: DataSourceHttpRequest) => FakeResponse;

async function read(
  command: string,
  options: {
    arm?: ArmHandler;
    logs?: (url: URL, body: JSONObject) => FakeResponse;
    tokenError?: FakeResponse;
    inventory?: CloudLiveReadInventoryRow | null;
  } = {},
): Promise<{ text: string; fake: FakeAzureLive }> {
  const fake: FakeAzureLive = createFakeAzureLive({
    arm: options.arm,
    logs: options.logs,
    tokenError: options.tokenError,
  });
  const text: string = await AzureLiveRead.read({
    target: liveTarget("azure", command, {
      accountId: AZURE_SUBSCRIPTION,
      inventory: options.inventory,
    }),
    context: liveContext(fake),
    settings: settings(),
  });

  return { text, fake };
}

async function readError(
  command: string,
  options: Parameters<typeof read>[1] = {},
): Promise<unknown> {
  try {
    await read(command, options);
  } catch (error) {
    return error;
  }

  throw new Error("The read did not fail.");
}

function lines(text: string): Array<string> {
  return text.split("\n");
}

// An ARM fake answering one path with one body, and 404 for anything else.
function armAnswering(answers: Record<string, JSONObject>): ArmHandler {
  return (url: URL): FakeResponse => {
    const body: JSONObject | undefined = answers[url.pathname];

    return body
      ? json(body)
      : json(
          { error: { code: "ResourceNotFound", message: "not found" } },
          404,
        );
  };
}

describe("Azure describe: the kinds the catalog knows, each at its own api-version", () => {
  test("an App Service: an ARM GET at 2023-12-01, its state and host names, never its app settings", async () => {
    const { text, fake } = await read(`cloud describe ${SITE}`, {
      arm: (url: URL, request: DataSourceHttpRequest): FakeResponse => {
        expect(headerOf(request, "Authorization")).toBe(
          "Bearer arm-access-token",
        );

        return armAnswering({
          [SITE]: {
            id: SITE,
            name: "web-app",
            type: "Microsoft.Web/sites",
            location: "East US",
            kind: "app,linux",
            tags: { env: "prod" },
            properties: {
              state: "Stopped",
              enabled: true,
              availabilityState: "Limited",
              usageState: "Normal",
              defaultHostName: "web-app.azurewebsites.net",
              hostNames: ["web-app.azurewebsites.net", "www.example.com"],
              serverFarmId: PLAN,
              httpsOnly: true,
              lastModifiedTimeUtc: "2026-10-27T09:30:00.1234567Z",
              slotSwapStatus: {
                timestampUtc: "2026-10-27T09:00:00Z",
                sourceSlotName: "staging",
                destinationSlotName: "production",
              },
              siteConfig: {
                appSettings: [
                  { name: "DB_PASSWORD", value: "site-secret-value" },
                ],
                connectionStrings: [
                  { connectionString: "Server=x;Password=cs-secret" },
                ],
              },
            },
          },
        })(url, request);
      },
    });

    expect(fake.armCalls).toHaveLength(1);
    expect(fake.armCalls[0]!.pathname).toBe(SITE);
    expect(fake.armCalls[0]!.searchParams.get("api-version")).toBe(
      "2023-12-01",
    );
    expect(fake.tokenScopes).toEqual(["https://management.azure.com/.default"]);
    expect(lines(text)).toEqual([
      `Live from Azure at 2026-10-27T10:00:00Z (Azure Resource Manager GET (api-version 2023-12-01)): App Service or Function App ${SITE}`,
      "name: web-app",
      "type: Microsoft.Web/sites",
      "location: East US",
      "kind: app,linux",
      "resource group: rg-prod",
      "state: Stopped",
      "enabled: yes",
      "availability: Limited",
      "usage: Normal",
      "default host name: web-app.azurewebsites.net",
      `plan: ${PLAN}`,
      "HTTPS only: yes",
      "last modified: 2026-10-27T09:30:00.1234567Z",
      "last slot swap: staging to production at 2026-10-27T09:00:00Z",
      "host names (2):",
      "- web-app.azurewebsites.net",
      "- www.example.com",
      "tags (1):",
      "- env: prod",
    ]);
    expect(text).not.toContain("site-secret-value");
    expect(text).not.toContain("cs-secret");
  });

  test("a Container App at 2024-03-01: its revisions, traffic and containers, never their environment", async () => {
    const { text, fake } = await read(`cloud describe ${CONTAINER_APP}`, {
      arm: armAnswering({
        [CONTAINER_APP]: {
          name: "api",
          type: "Microsoft.App/containerApps",
          location: "westeurope",
          properties: {
            provisioningState: "Succeeded",
            runningStatus: "Running",
            latestRevisionName: "api--v3",
            latestReadyRevisionName: "api--v2",
            configuration: {
              activeRevisionsMode: "Multiple",
              ingress: {
                fqdn: "api.example.azurecontainerapps.io",
                traffic: [
                  { revisionName: "api--v2", weight: 90 },
                  { latestRevision: true, weight: 10, label: "canary" },
                ],
              },
              secrets: [
                { name: "db", value: "container-secret" },
                {
                  name: "ingestion-key",
                  value: "agent-ingestion-key-0123456789",
                },
              ],
            },
            template: {
              scale: { minReplicas: 1, maxReplicas: 10 },
              containers: [
                {
                  name: "api",
                  image: "acr.io/api:3",
                  resources: { cpu: 0.5, memory: "1Gi" },
                  env: [
                    { name: "TOKEN", value: "container-env-secret" },
                    {
                      name: "ONEUPTIME_TELEMETRY_INGESTION_KEY",
                      secretRef: "ingestion-key",
                    },
                  ],
                },
              ],
            },
          },
        },
      }),
    });

    expect(fake.armCalls[0]!.searchParams.get("api-version")).toBe(
      "2024-03-01",
    );
    expect(text).toContain("latest revision: api--v3");
    expect(text).toContain("latest ready revision: api--v2");
    expect(text).toContain("revision mode: Multiple");
    expect(text).toContain("replicas: 1 to 10");
    expect(text).toContain(
      "traffic (2):\n- 90% to api--v2\n- 10% to the latest revision (label canary)",
    );
    expect(text).toContain(
      "containers (1):\n- api: acr.io/api:3, 0.5 CPU, 1Gi",
    );
    expect(text).not.toContain("container-env-secret");
    expect(text).not.toContain("container-secret");
    expect(text).not.toContain("agent-ingestion-key");
    expect(text).not.toContain("ONEUPTIME_TELEMETRY_INGESTION_KEY");
    expect(text).not.toContain("ingestion-key");
  });

  test("a virtual machine at 2024-07-01, with its instance view, never its OS profile", async () => {
    const { text, fake } = await read(`cloud describe ${VM}`, {
      arm: armAnswering({
        [VM]: {
          name: "vm-web-1",
          type: "Microsoft.Compute/virtualMachines",
          location: "westeurope",
          zones: ["2"],
          properties: {
            hardwareProfile: { vmSize: "Standard_D4s_v5" },
            provisioningState: "Succeeded",
            storageProfile: {
              osDisk: { osType: "Linux" },
              imageReference: {
                publisher: "Canonical",
                offer: "ubuntu-24_04-lts",
                sku: "server",
                version: "latest",
              },
            },
            osProfile: {
              adminUsername: "azureuser",
              customData: "vm-custom-data-secret",
            },
            timeCreated: "2025-05-01T00:00:00Z",
          },
        },
        [`${VM}/instanceView`]: {
          osName: "ubuntu",
          osVersion: "24.04",
          vmAgent: {
            vmAgentVersion: "2.11.1.4",
            statuses: [{ displayStatus: "Not Ready" }],
          },
          statuses: [
            {
              code: "ProvisioningState/succeeded",
              displayStatus: "Provisioning succeeded",
              level: "Info",
              time: "2026-10-27T09:00:00Z",
            },
            { code: "PowerState/stopped", displayStatus: "VM stopped" },
          ],
        },
      }),
    });

    expect(
      fake.armCalls.map((url: URL): string => {
        return `${url.pathname}?${url.searchParams.toString()}`;
      }),
    ).toEqual([
      `${VM}?api-version=2024-07-01`,
      `${VM}/instanceView?api-version=2024-07-01`,
    ]);
    expect(lines(text)).toEqual([
      `Live from Azure at 2026-10-27T10:00:00Z (Azure Resource Manager GET (api-version 2024-07-01), instanceView): virtual machine ${VM}`,
      "name: vm-web-1",
      "type: Microsoft.Compute/virtualMachines",
      "location: westeurope",
      "resource group: rg-prod",
      "zones: 2",
      "size: Standard_D4s_v5",
      "provisioning: Succeeded",
      "OS: Linux",
      "created: 2025-05-01T00:00:00Z",
      "image: Canonical ubuntu-24_04-lts server latest",
      "statuses (2):",
      "- Provisioning succeeded at 2026-10-27T09:00:00Z",
      "- VM stopped",
      "VM agent: 2.11.1.4, Not Ready",
      "OS: ubuntu 24.04",
      "tags: none",
    ]);
    expect(text).not.toContain("vm-custom-data-secret");
    expect(text).not.toContain("azureuser");
  });

  test.each([
    [PLAN, "2023-12-01", "App Service plan", "workers: 3"],
    [VMSS, "2024-07-01", "VM scale set", "upgrade policy: Rolling"],
    [
      POSTGRES,
      "2022-12-01",
      "PostgreSQL flexible server",
      "high availability state: FailingOver",
    ],
    [
      MYSQL,
      "2023-12-30",
      "MySQL flexible server",
      "high availability state: FailingOver",
    ],
  ])(
    "%s is read at api-version %s",
    async (id: string, apiVersion: string, noun: string, fact: string) => {
      const { text, fake } = await read(`cloud describe ${id}`, {
        arm: armAnswering({
          [id]: {
            name: "x",
            sku: { name: "P1v3", tier: "PremiumV3", capacity: 3 },
            properties: {
              numberOfWorkers: 3,
              upgradePolicy: { mode: "Rolling" },
              highAvailability: { mode: "ZoneRedundant", state: "FailingOver" },
            },
          },
        }),
      });

      expect(fake.armCalls[0]!.searchParams.get("api-version")).toBe(
        apiVersion,
      );
      expect(lines(text)[0]).toBe(
        `Live from Azure at 2026-10-27T10:00:00Z (Azure Resource Manager GET (api-version ${apiVersion})): ${noun} ${id}`,
      );
      expect(text).toContain("SKU: P1v3 (PremiumV3), capacity 3");
      expect(text).toContain(fact);
    },
  );

  test("a SQL failover group at 2021-11-01: its role, its partners and its databases", async () => {
    const { text, fake } = await read(`cloud describe ${FAILOVER_GROUP}`, {
      arm: armAnswering({
        [FAILOVER_GROUP]: {
          name: "fog-1",
          properties: {
            replicationRole: "Primary",
            replicationState: "CATCH_UP",
            readWriteEndpoint: {
              failoverPolicy: "Automatic",
              failoverWithDataLossGracePeriodMinutes: 60,
            },
            readOnlyEndpoint: { failoverPolicy: "Disabled" },
            partnerServers: [
              {
                id: `${PROVIDERS}/Microsoft.Sql/servers/sql-2`,
                location: "West US",
                replicationRole: "Secondary",
              },
            ],
            databases: [
              `${PROVIDERS}/Microsoft.Sql/servers/sql-1/databases/orders`,
            ],
          },
        },
      }),
    });

    expect(fake.armCalls[0]!.searchParams.get("api-version")).toBe(
      "2021-11-01",
    );
    expect(text).toContain("replication role: Primary");
    expect(text).toContain("replication state: CATCH_UP");
    expect(text).toContain("read-write failover policy: Automatic");
    expect(text).toContain("read-write grace period (minutes): 60");
    expect(text).toContain(
      `partner servers (1):\n- ${PROVIDERS}/Microsoft.Sql/servers/sql-2 (West US): Secondary`,
    );
    expect(text).toContain("databases (1):\n- orders");
  });

  test("an instance view the app may not read is a note; the VM itself is still described", async () => {
    const { text } = await read(`cloud describe ${VM}`, {
      arm: (url: URL): FakeResponse => {
        return url.pathname.endsWith("/instanceView")
          ? json(
              {
                error: {
                  code: "AuthorizationFailed",
                  message:
                    "does not have authorization to perform action 'Microsoft.Compute/virtualMachines/instanceView/read'",
                },
              },
              403,
            )
          : json({ name: "vm-web-1", properties: {} });
      },
    });

    expect(text).toContain("name: vm-web-1");
    expect(text).toContain(
      "note: The VM's instance view not read: the connection may not call Microsoft.Compute/virtualMachines/instanceView/read.",
    );
  });
});

describe("Azure describe: any other resource, through Resource Graph", () => {
  test("one Resource Graph query of the resource's id, over its subscription, with only safe fields", async () => {
    let posted: JSONObject = {};
    const { text, fake } = await read(`cloud describe ${STORAGE}`, {
      arm: (url: URL, request: DataSourceHttpRequest): FakeResponse => {
        expect(url.pathname).toBe(
          "/providers/Microsoft.ResourceGraph/resources",
        );
        expect(url.searchParams.get("api-version")).toBe("2022-10-01");
        expect(request.method).toBe("POST");
        posted = JSON.parse(String(request.body)) as JSONObject;

        return json({
          data: [
            {
              id: STORAGE.toLowerCase(),
              name: "acct1",
              type: "microsoft.storage/storageaccounts",
              location: "eastus",
              kind: "StorageV2",
              sku: { name: "Standard_LRS", tier: "Standard" },
              tags: { team: "data" },
              provisioningState: "Succeeded",
            },
          ],
        });
      },
    });

    expect(fake.armCalls).toHaveLength(1);
    expect(posted["subscriptions"]).toEqual([AZURE_SUBSCRIPTION]);
    expect(posted["query"]).toBe(
      `Resources | where id =~ '${STORAGE}' | project id, name, type, location, kind, sku, tags, provisioningState=properties.provisioningState`,
    );
    expect(resourceGraphProblems(String(posted["query"]))).toEqual([]);
    expect(lines(text)).toEqual([
      `Live from Azure at 2026-10-27T10:00:00Z (Azure Resource Graph): resource ${STORAGE}`,
      "name: acct1",
      "type: microsoft.storage/storageaccounts",
      "location: eastus",
      "kind: StorageV2",
      "resource group: rg-prod",
      "SKU: Standard_LRS (Standard)",
      "provisioning: Succeeded",
      "tags (1):",
      "- team: data",
    ]);
  });

  test("a resource Resource Graph does not have is said to be missing", async () => {
    const error: unknown = await readError(`cloud describe ${STORAGE}`, {
      arm: (): FakeResponse => {
        return json({ data: [] });
      },
    });

    expect((error as CloudLiveReadError).reason).toBe("not-found");
  });
});

describe("Azure describe failures", () => {
  test("a resource Resource Manager does not have (404) is said to be missing", async () => {
    const error: unknown = await readError(`cloud describe ${SITE}`, {
      arm: armAnswering({}),
    });

    expect((error as CloudLiveReadError).reason).toBe("not-found");
    expect((error as CloudLiveReadError).message).toBe(
      `Azure has no App Service or Function App ${SITE}: it may have been deleted or moved since OneUptime listed it.`,
    );
  });

  test("AuthorizationFailed names the read permission of the kind", async () => {
    const error: unknown = await readError(`cloud describe ${SITE}`, {
      arm: (): FakeResponse => {
        return json(
          {
            error: {
              code: "AuthorizationFailed",
              message:
                "The client does not have authorization to perform action 'Microsoft.Web/sites/read'.",
            },
          },
          403,
        );
      },
    });

    expect(error).toBeInstanceOf(CloudLiveReadError);
    expect((error as CloudLiveReadError).permission).toBe(
      "Microsoft.Web/sites/read",
    );
  });

  test("an expired client secret is said to be one", async () => {
    const error: unknown = await readError(`cloud describe ${SITE}`, {
      tokenError: json(
        {
          error: "invalid_client",
          error_description:
            "AADSTS7000222: The provided client secret keys are expired.",
        },
        401,
      ),
    });

    expect(error).toBeInstanceOf(LlmProviderError);
    expect((error as LlmProviderError).kind).toBe(
      CloudConnectionFailureKind.Authentication,
    );
    expect((error as LlmProviderError).message).toBe(
      "The app's client secret has expired. Run the setup command again and paste what it prints.",
    );
  });
});

// ---- recent-events ---------------------------------------------------------------

function activityEntry(data: {
  at: string;
  operation: string;
  shown: string;
  status: string;
  caller?: string;
  level?: string;
  category?: string;
}): JSONObject {
  return {
    eventTimestamp: data.at,
    operationName: { value: data.operation, localizedValue: data.shown },
    status: { value: data.status, localizedValue: data.status },
    caller: data.caller || "",
    level: data.level || "Informational",
    category: { value: data.category || "Administrative" },
    properties: { requestbody: '{"password":"activity-secret"}' },
  };
}

describe("Azure recent-events", () => {
  test("Resource Health's current availability, then the Activity Log entries that name the resource, every page, newest first", async () => {
    const { text, fake } = await read(
      `cloud recent-events ${SITE} --hours 3 --limit 3`,
      {
        arm: (url: URL): FakeResponse => {
          if (url.pathname.endsWith("/availabilityStatuses/current")) {
            return json({
              properties: {
                availabilityState: "Degraded",
                summary: "The app is responding slowly.",
                reasonType: "Unplanned",
                occuredTime: "2026-10-27T09:40:00Z",
                detailedStatus: "High latency",
                recommendedActions: [{ action: "Restart the app" }],
              },
            });
          }

          if (url.searchParams.get("page") === "2") {
            return json({
              value: [
                activityEntry({
                  at: "2026-10-27T08:00:00.0000000Z",
                  operation: "Microsoft.Web/sites/write",
                  shown: "Update website",
                  status: "Succeeded",
                  caller: "alice@example.com",
                }),
              ],
            });
          }

          return json({
            value: [
              activityEntry({
                at: "2026-10-27T09:45:00.1234567Z",
                operation: "Microsoft.Web/sites/restart/action",
                shown: "Restart Web App",
                status: "Failed",
                caller: "bob@example.com",
                level: "Error",
              }),
              activityEntry({
                at: "2026-10-27T09:50:00Z",
                operation:
                  "Microsoft.Resourcehealth/healthevent/Activated/action",
                shown: "Health Event Activated",
                status: "Active",
                category: "ResourceHealth",
              }),
            ],
            nextLink: `https://management.azure.com/subscriptions/${AZURE_SUBSCRIPTION}/providers/Microsoft.Insights/eventtypes/management/values?page=2`,
          });
        },
      },
    );

    expect(
      fake.armCalls.map((url: URL): string => {
        return url.pathname;
      }),
    ).toEqual([
      `${SITE}/providers/Microsoft.ResourceHealth/availabilityStatuses/current`,
      `/subscriptions/${AZURE_SUBSCRIPTION}/providers/Microsoft.Insights/eventtypes/management/values`,
      `/subscriptions/${AZURE_SUBSCRIPTION}/providers/Microsoft.Insights/eventtypes/management/values`,
    ]);
    expect(fake.armCalls[0]!.searchParams.get("api-version")).toBe(
      "2022-10-01",
    );

    const activity: URL = fake.armCalls[1]!;
    expect(activity.searchParams.get("api-version")).toBe("2015-04-01");
    expect(activity.searchParams.get("$filter")).toBe(
      `eventTimestamp ge '2026-10-27T07:00:00.000Z' and eventTimestamp le '2026-10-27T10:00:00.000Z' and resourceUri eq '${SITE}'`,
    );
    expect(activity.searchParams.get("$select")).toBe(
      "eventTimestamp,operationName,status,subStatus,caller,level,category,eventDataId,resourceId",
    );
    expect(lines(text)).toEqual([
      `Live from Azure at 2026-10-27T10:00:00Z (Resource Health availabilityStatuses/current, Activity Log): what happened to App Service or Function App ${SITE} in the last 3 hours, newest first`,
      "resource health: Degraded - The app is responding slowly. (Unplanned), since 2026-10-27T09:40:00Z",
      "health detail: High latency",
      "recommended actions (1):",
      "- Restart the app",
      "activity log (3):",
      "- 2026-10-27T09:50:00Z Health Event Activated (Microsoft.Resourcehealth/healthevent/Activated/action): Active [ResourceHealth]",
      "- 2026-10-27T09:45:00Z Restart Web App (Microsoft.Web/sites/restart/action): Failed by bob@example.com [Error]",
      "- 2026-10-27T08:00:00Z Update website (Microsoft.Web/sites/write): Succeeded by alice@example.com",
    ]);
    expect(text).not.toContain("activity-secret");
  });

  test("a next page on another host is never followed with the token", async () => {
    const { fake } = await read(`cloud recent-events ${SITE}`, {
      arm: (url: URL): FakeResponse => {
        if (url.pathname.endsWith("/availabilityStatuses/current")) {
          return json({ properties: { availabilityState: "Available" } });
        }

        return json({
          value: [],
          nextLink: "https://attacker.example.com/steal",
        });
      },
    });

    expect(fake.armCalls).toHaveLength(2);
    expect(
      fake.requests.some((request: DataSourceHttpRequest): boolean => {
        return new URL(request.url).hostname === "attacker.example.com";
      }),
    ).toBe(false);
  });

  test("a kind Resource Health does not report on is a note; the Activity Log is still read", async () => {
    const { text } = await read(`cloud recent-events ${STORAGE}`, {
      arm: (url: URL): FakeResponse => {
        if (url.pathname.endsWith("/availabilityStatuses/current")) {
          return json({ error: { code: "NotSupported" } }, 400);
        }

        return json({ value: [] });
      },
    });

    expect(text).toContain("(Activity Log): what happened to resource");
    expect(text).toContain("activity log: none in the last 6 hours");
    expect(text).toContain(
      "note: Resource Health reports nothing for this kind of resource.",
    );
  });

  test("an Activity Log the app may not read names Microsoft.Insights/eventtypes/values/read", async () => {
    const error: unknown = await readError(`cloud recent-events ${SITE}`, {
      arm: (url: URL): FakeResponse => {
        if (url.pathname.endsWith("/availabilityStatuses/current")) {
          return json({ properties: { availabilityState: "Available" } });
        }

        return json({ error: { code: "AuthorizationFailed" } }, 403);
      },
    });

    expect((error as CloudLiveReadError).permission).toBe(
      "Microsoft.Insights/eventtypes/values/read",
    );
  });
});

// ---- quota-usage --------------------------------------------------------------------

function usages(): JSONObject {
  return {
    value: [
      {
        name: { value: "cores", localizedValue: "Total Regional vCPUs" },
        currentValue: 90,
        limit: 100,
        unit: "Count",
      },
      {
        name: { value: "virtualMachines", localizedValue: "Virtual Machines" },
        currentValue: 10,
        limit: 25000,
        unit: "Count",
      },
      {
        name: {
          value: "standardDSv5Family",
          localizedValue: "Standard DSv5 Family vCPUs",
        },
        currentValue: 16,
        limit: 20,
        unit: "Count",
      },
      {
        name: { value: "dedicatedHosts", localizedValue: "Dedicated Hosts" },
        currentValue: 0,
        limit: 0,
        unit: "Count",
      },
    ],
  };
}

describe("Azure quota-usage", () => {
  test("the Compute usages of the location the inventory lists, highest usage first, at most --limit", async () => {
    const { text, fake } = await read(`cloud quota-usage ${SITE} --limit 2`, {
      inventory: inventoryRow({ region: "East US" }),
      arm: (url: URL): FakeResponse => {
        return json(url.pathname.endsWith("/usages") ? usages() : {});
      },
    });

    expect(fake.armCalls).toHaveLength(1);
    expect(fake.armCalls[0]!.pathname).toBe(
      `/subscriptions/${AZURE_SUBSCRIPTION}/providers/Microsoft.Compute/locations/eastus/usages`,
    );
    expect(fake.armCalls[0]!.searchParams.get("api-version")).toBe(
      "2024-07-01",
    );
    expect(lines(text)).toEqual([
      `Live from Azure at 2026-10-27T10:00:00Z (Compute usages): the Compute usages of eastus in subscription ${AZURE_SUBSCRIPTION}, for App Service or Function App ${SITE}, highest usage first`,
      "usages (2 of 4):",
      "- Total Regional vCPUs (cores): 90 of 100 (90%)",
      "- Standard DSv5 Family vCPUs (standardDSv5Family): 16 of 20 (80%)",
    ]);
  });

  test("without an inventory row, the location is the resource's own (an ARM GET)", async () => {
    const { fake } = await read(`cloud quota-usage ${VM}`, {
      arm: (url: URL): FakeResponse => {
        return url.pathname.endsWith("/usages")
          ? json(usages())
          : json({ name: "vm-web-1", location: "westeurope" });
      },
    });

    expect(
      fake.armCalls.map((url: URL): string => {
        return url.pathname;
      }),
    ).toEqual([
      VM,
      `/subscriptions/${AZURE_SUBSCRIPTION}/providers/Microsoft.Compute/locations/westeurope/usages`,
    ]);
  });

  test("a resource of another kind is located through Resource Graph", async () => {
    const { fake } = await read(`cloud quota-usage ${STORAGE}`, {
      arm: (url: URL): FakeResponse => {
        return url.pathname.endsWith("/usages")
          ? json(usages())
          : json({ data: [{ id: STORAGE, location: "northeurope" }] });
      },
    });

    expect(fake.armCalls[1]!.pathname).toContain(
      "/locations/northeurope/usages",
    );
  });
});

// ---- read-logs ----------------------------------------------------------------------

describe("Azure read-logs", () => {
  test("a resource-centric Log Analytics query, signed in for Log Analytics, built from the --filter and whole numbers only", async () => {
    const { text, fake } = await read(
      `cloud read-logs ${SITE} --filter "connection refused" --minutes 30 --limit 5`,
      {
        logs: (): FakeResponse => {
          return json({
            tables: [
              {
                name: "PrimaryResult",
                columns: [
                  { name: "$table", type: "string" },
                  { name: "TimeGenerated", type: "datetime" },
                  { name: "ResultDescription", type: "string" },
                  { name: "Level", type: "string" },
                  { name: "TenantId", type: "string" },
                ],
                rows: [
                  [
                    "AppServiceConsoleLogs",
                    "2026-10-27T09:50:00Z",
                    "dial tcp: connection refused",
                    "Error",
                    "t-1",
                  ],
                  [
                    "AppServiceHTTPLogs",
                    "2026-10-27T09:59:30.5Z",
                    "",
                    "",
                    "t-1",
                  ],
                  [
                    "AppServiceConsoleLogs",
                    "2026-10-27T09:55:00Z",
                    "retry: connection refused\nat db.connect",
                    "Warning",
                    "t-1",
                  ],
                ],
              },
            ],
          });
        },
      },
    );

    expect(fake.tokenScopes).toEqual(["https://api.loganalytics.io/.default"]);
    expect(fake.logCalls).toHaveLength(1);
    expect(fake.logCalls[0]!.url.href).toBe(
      `https://api.loganalytics.io/v1${SITE}/query`,
    );
    expect(fake.logCalls[0]!.authorization).toBe("Bearer logs-access-token");
    expect(fake.logCalls[0]!.body).toEqual({
      query:
        "search 'connection refused' | where TimeGenerated > ago(30m) | top 5 by TimeGenerated desc",
      timespan: "PT30M",
    });
    expect(
      logAnalyticsProblems(String(fake.logCalls[0]!.body["query"])),
    ).toEqual([]);
    expect(lines(text)).toEqual([
      `Live from Azure at 2026-10-27T10:00:00Z (Log Analytics query): log lines of App Service or Function App ${SITE}, the last 30 minutes, containing "connection refused", newest first`,
      "lines (3):",
      "- 2026-10-27T09:59:30.500Z [AppServiceHTTPLogs]",
      "- 2026-10-27T09:55:00.000Z [AppServiceConsoleLogs] retry: connection refused ⏎ at db.connect | Level=Warning",
      "- 2026-10-27T09:50:00.000Z [AppServiceConsoleLogs] dial tcp: connection refused | Level=Error",
      "query: search 'connection refused' | where TimeGenerated > ago(30m) | top 5 by TimeGenerated desc",
    ]);
  });

  /*
   * The command takes a filter of letters, digits, spaces and . _ : / @ =
   * , + # ( ) - only; whatever else reaches buildAzureLogQuery is held to
   * one literal below ("what goes into an Azure query").
   */
  test("a --filter of every character the command takes is one literal of the query, searched for as it was typed", async () => {
    const filter: string = "GET /api/v1 (500) user@host #12 a=b,c+d:e_f.g-h";
    const { fake } = await read(
      `cloud read-logs ${SITE} --filter "${filter}" --minutes 5 --limit 2`,
      {
        logs: (): FakeResponse => {
          return json({ tables: [] });
        },
      },
    );
    const query: string = String(fake.logCalls[0]!.body["query"]);

    expect(query).toBe(
      `search '${filter}' | where TimeGenerated > ago(5m) | top 2 by TimeGenerated desc`,
    );
    expect(logAnalyticsProblems(query)).toEqual([]);
    expect(stringLiteralValuesOf(query)).toEqual([filter]);
    expect(operatorsOf(query)).toEqual(["SearchOperator", "where", "top"]);
  });

  test("a --filter holding a quote is refused by the command, before any query is made", async () => {
    const error: unknown = await readError(
      `cloud read-logs ${SITE} --filter "it's down"`,
    );

    expect(String(error)).toContain(
      "--filter must be 1-128 letters, digits, spaces and . _ : / @ = , + # ( ) -",
    );
  });

  test("without --filter, every table of the resource is read", async () => {
    const { text, fake } = await read(`cloud read-logs ${CONTAINER_APP}`, {
      logs: (): FakeResponse => {
        return json({
          tables: [{ name: "PrimaryResult", columns: [], rows: [] }],
        });
      },
    });

    expect(fake.logCalls[0]!.body["query"]).toBe(
      "union * | where TimeGenerated > ago(60m) | top 50 by TimeGenerated desc",
    );
    expect(text).toContain(
      "lines: none in the last 60 minutes. A resource's logs reach Log Analytics only when a diagnostic setting sends them to a workspace",
    );
  });

  test("a query the app may not run names the Log Analytics read permission", async () => {
    const error: unknown = await readError(`cloud read-logs ${SITE}`, {
      logs: (): FakeResponse => {
        return json(
          {
            error: {
              code: "InsufficientAccessError",
              message: "The provided credentials have insufficient access",
            },
          },
          403,
        );
      },
    });

    expect((error as CloudLiveReadError).reason).toBe("permission");
    expect((error as CloudLiveReadError).permission).toBe(
      "Microsoft.Insights/logs/*/read",
    );
  });
});

// Filters a person or the AI may hand read-logs: each must stay one literal (#11142).
const AWKWARD_FILTERS: ReadonlyArray<string> = [
  "connection refused",
  'x" | take 1000 //',
  "it's down",
  "C:\\logs\\app.log",
  "two\nlines",
  "a\r\nwindows line",
  "tab\there",
  "\\'",
  "'; Resources | project secrets //",
  "ends with a backslash\\",
  "nul\u0000and bell\u0007",
  "line\u2028separator",
  "ünïcødé ✓ 🚀",
  "''''",
  "```",
];

describe("what goes into an Azure query", () => {
  test("an OData literal writes a quote twice", () => {
    expect(toODataString("a'b")).toBe("'a''b'");
  });

  test("the log query is made of the filter as one string literal and of whole numbers", () => {
    expect(
      buildAzureLogQuery({ filter: "", minutes: 15.7, limit: 3 }).toString(),
    ).toBe(
      "union * | where TimeGenerated > ago(15m) | top 3 by TimeGenerated desc",
    );
    expect(
      buildAzureLogQuery({
        filter: 'x" | take 1000 //',
        minutes: 5,
        limit: 1,
      }).toString(),
    ).toBe(
      "search 'x\" | take 1000 //' | where TimeGenerated > ago(5m) | top 1 by TimeGenerated desc",
    );
  });

  test("a filter's line break, which once ended its literal, is written \\n", () => {
    expect(
      buildAzureLogQuery({
        filter: "two\nlines",
        minutes: 5,
        limit: 1,
      }).toString(),
    ).toBe(
      "search 'two\\nlines' | where TimeGenerated > ago(5m) | top 1 by TimeGenerated desc",
    );
  });

  test.each(AWKWARD_FILTERS)(
    "a query searching for %j keeps to KQL, and searches for exactly that",
    (filter: string) => {
      const query: string = buildAzureLogQuery({
        filter,
        minutes: 5,
        limit: 1,
      }).toString();

      expect(logAnalyticsProblems(query)).toEqual([]);
      expect(stringLiteralValuesOf(query)).toEqual([filter]);
      expect(operatorsOf(query)).toEqual(["SearchOperator", "where", "top"]);
      expect(query.split("\n")).toHaveLength(1);
    },
  );

  test("with no filter, every table: union * keeps to KQL", () => {
    const query: string = buildAzureLogQuery({
      filter: "",
      minutes: 60,
      limit: 50,
    }).toString();

    expect(logAnalyticsProblems(query)).toEqual([]);
    expect(operatorsOf(query)).toEqual(["union", "where", "top"]);
  });

  test("minutes and a row limit that are no whole number are refused, never written into the query", () => {
    expect(() => {
      return buildAzureLogQuery({ filter: "", minutes: NaN, limit: 3 });
    }).toThrow("A KQL query takes a whole number of zero or more here");
    expect(() => {
      return buildAzureLogQuery({ filter: "", minutes: 5, limit: Infinity });
    }).toThrow("A KQL query takes a whole number of zero or more here");
  });
});

describe("the Resource Graph row of a live read", () => {
  // The resource IDs that may reach the query: Azure's own, and any other text.
  const IDS: ReadonlyArray<string> = [
    STORAGE,
    `${PROVIDERS}/Microsoft.Storage/storageAccounts/it's`,
    `/subscriptions/${AZURE_SUBSCRIPTION}/resourceGroups/rg.(prod)_ünï-1/providers/Microsoft.Network/virtualNetworks/vnet-1`,
    `${STORAGE}' | project secrets = properties //`,
    `${STORAGE}\n| take 1`,
    `${STORAGE}\\`,
    `${STORAGE}\\' or 1 == 1 or id =~ '`,
  ];

  async function postedQuery(id: string): Promise<string> {
    let query: string = "";
    const fake: FakeAzureLive = createFakeAzureLive({
      arm: (_url: URL, request: DataSourceHttpRequest): FakeResponse => {
        query = String(
          (JSON.parse(String(request.body)) as JSONObject)["query"],
        );
        return json({ data: [] });
      },
    });
    const target: ReturnType<typeof liveTarget> = liveTarget(
      "azure",
      `cloud describe ${STORAGE}`,
      { accountId: AZURE_SUBSCRIPTION },
    );

    try {
      await AzureLiveRead.read({
        target: { ...target, resource: { ...target.resource, id } },
        context: liveContext(fake),
        settings: settings(),
      });
    } catch {
      // Resource Graph has no such row: the read says so, the query is what is read here.
    }

    return query;
  }

  test.each(IDS)(
    "for the resource %j, one Resource Graph runs, with the ID one literal read back as it is",
    async (id: string) => {
      const query: string = await postedQuery(id);

      expect(resourceGraphProblems(query)).toEqual([]);
      expect(stringLiteralValuesOf(query)).toEqual([id]);
      // The query keeps its shape whatever the ID holds: where, then project.
      expect(shapeOf(query)).toBe(shapeOf(await postedQuery(STORAGE)));
      expect(operatorsOf(query)).toEqual(["where", "project"]);
    },
  );
});
