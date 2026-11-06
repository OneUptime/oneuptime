import {
  AzureStreamContext,
  AzureStreamMetricDefinition,
  AzureStreamResource,
} from "Common/Server/Utils/CloudConnection/CloudStreamReader";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";

/*
 * WHAT AZURE MONITOR WRITES TO AN EVENT HUB, FOR THE STREAM'S TESTS.
 *
 * Diagnostic settings write each event as one JSON document of records
 * ("Stream Azure monitoring data to an event hub"; the metric record's
 * fields as AzureMetrics lists them, the resource logs' common schema and
 * each category's own properties as their services document them) - the
 * resource ids in capitals, as Azure Monitor writes them in these - and
 * the context a read decodes them against: the connection's resources as
 * its reads wrote them, in their own casing, and the key metrics its reads
 * keep. Not a test file itself.
 */

export const SUBSCRIPTION: string = "11111111-aaaa-4aaa-8aaa-111111111111";
export const PROJECT_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
export const CONNECTION_ID: ObjectID = new ObjectID("6f1c3a2e-9b8d-4c7e-a1f0-2d3c4b5a6e7f");
export const MINUTE: string = "2026-11-06T09:59:00.0000000Z";
export const MINUTE_MS: number = Date.UTC(2026, 10, 6, 9, 59, 0);

function armId(group: string, type: string, name: string): string {
  return `/subscriptions/${SUBSCRIPTION}/resourceGroups/${group}/providers/${type}/${name}`;
}

export const VM_ID: string = armId("rg-Prod", "Microsoft.Compute/virtualMachines", "web-01");
export const SITE_ID: string = armId("rg-Prod", "Microsoft.Web/sites", "checkout");
export const VAULT_ID: string = armId("rg-Sec", "Microsoft.KeyVault/vaults", "acme-secrets");
export const STORAGE_ID: string = armId("rg-Data", "Microsoft.Storage/storageAccounts", "acmedata");
export const AKS_ID: string = armId(
  "rg-Prod",
  "Microsoft.ContainerService/managedClusters",
  "prod-aks",
);

function resource(data: {
  id: string;
  name: string;
  type: string;
  group: string;
  region: string;
}): AzureStreamResource {
  return {
    resourceId: data.id,
    providerResourceId: data.id,
    name: data.name,
    type: data.type,
    resourceGroup: data.group,
    region: data.region,
    subscriptionId: SUBSCRIPTION,
  };
}

function definitions(
  entries: Array<[string, Array<AzureStreamMetricDefinition>]>,
): Map<string, Map<string, AzureStreamMetricDefinition>> {
  return new Map(
    entries.map(([type, metrics]: [string, Array<AzureStreamMetricDefinition>]) => {
      return [
        type.toLowerCase(),
        new Map(
          metrics.map((metric: AzureStreamMetricDefinition) => {
            return [metric.name.toLowerCase(), metric];
          }),
        ),
      ];
    }),
  );
}

export function streamContext(
  overrides: Partial<AzureStreamContext> = {},
): AzureStreamContext {
  return {
    projectId: PROJECT_ID,
    connectionId: CONNECTION_ID,
    serviceName: "Production Azure",
    resources: new Map(
      [
        resource({
          id: VM_ID,
          name: "web-01",
          type: "Microsoft.Compute/virtualMachines",
          group: "rg-Prod",
          region: "eastus",
        }),
        resource({
          id: SITE_ID,
          name: "checkout",
          type: "Microsoft.Web/sites",
          group: "rg-Prod",
          region: "eastus",
        }),
        resource({
          id: VAULT_ID,
          name: "acme-secrets",
          type: "Microsoft.KeyVault/vaults",
          group: "rg-Sec",
          region: "westeurope",
        }),
        resource({
          id: STORAGE_ID,
          name: "acmedata",
          type: "Microsoft.Storage/storageAccounts",
          group: "rg-Data",
          region: "eastus",
        }),
      ].map((item: AzureStreamResource): [string, AzureStreamResource] => {
        return [item.resourceId.toLowerCase(), item];
      }),
    ),
    definitions: definitions([
      [
        "Microsoft.Compute/virtualMachines",
        [
          { name: "Percentage CPU", aggregation: "Average", unit: "Percent", grain: "PT1M" },
          { name: "Network In Total", aggregation: "Total", unit: "Bytes", grain: "PT1M" },
        ],
      ],
      [
        "Microsoft.Web/sites",
        [
          { name: "Requests", aggregation: "Total", unit: "Count", grain: "PT1M" },
          { name: "Http5xx", aggregation: "Total", unit: "Count", grain: "PT1M" },
          { name: "HttpResponseTime", aggregation: "Average", unit: "Seconds", grain: "PT1M" },
        ],
      ],
      [
        "Microsoft.KeyVault/vaults",
        [{ name: "ServiceApiHit", aggregation: "Count", unit: "Count", grain: "PT1M" }],
      ],
      [
        "Microsoft.Storage/storageAccounts",
        [
          { name: "Transactions", aggregation: "Total", unit: "Count", grain: "PT1M" },
          // Azure publishes it hourly: the read's to write.
          { name: "UsedCapacity", aggregation: "Average", unit: "Bytes", grain: "PT1H" },
        ],
      ],
    ]),
    ...overrides,
  };
}

// A minute of a platform metric, as an AllMetrics diagnostic setting writes it.
export function metricRecord(data: {
  resourceId: string;
  metricName: string;
  total: number;
  count: number;
  minimum: number;
  maximum: number;
  average?: number;
  time?: string;
  timeGrain?: string;
}): JSONObject {
  return {
    count: data.count,
    total: data.total,
    minimum: data.minimum,
    maximum: data.maximum,
    average: data.average ?? (data.count > 0 ? data.total / data.count : 0),
    resourceId: data.resourceId.toUpperCase(),
    time: data.time || MINUTE,
    metricName: data.metricName,
    timeGrain: data.timeGrain || "PT1M",
  };
}

// A Key Vault AuditEvent, as Key Vault logging documents it.
export function vaultAuditRecord(overrides: JSONObject = {}): JSONObject {
  return {
    time: "2026-11-06T09:59:12.1234567Z",
    category: "AuditEvent",
    operationName: "SecretGet",
    resultType: "Success",
    correlationId: "6e8a5a4b-3d2c-4b1a-9f8e-7d6c5b4a3f2e",
    callerIpAddress: "203.0.113.24",
    identity: {
      claim: {
        "http://schemas.microsoft.com/identity/claims/objectidentifier": "0b9f6c1e",
        upn: "alice@acme.com",
      },
    },
    properties: {
      id: "https://acme-secrets.vault.azure.net/secrets/db-password",
      clientInfo: "AzureCLI/2.66.0",
      httpStatusCode: 200,
      requestUri: "https://acme-secrets.vault.azure.net/secrets/db-password?api-version=7.4",
      isAccessPolicyMatch: true,
      tlsVersion: "TLS1_2",
    },
    resultSignature: "OK",
    resourceId: VAULT_ID.toUpperCase(),
    operationVersion: "7.4",
    durationMs: "43",
    resultDescription: "",
    level: "Informational",
    location: "westeurope",
    ...overrides,
  };
}

// An App Service console line, as AppServiceConsoleLogs writes it.
export function appServiceConsoleRecord(overrides: JSONObject = {}): JSONObject {
  return {
    time: "2026-11-06T09:59:20.000Z",
    resourceId: SITE_ID.toUpperCase(),
    category: "AppServiceConsoleLogs",
    operationName: "Microsoft.Web/sites/log",
    level: "Error",
    resultDescription: "Error: connect ECONNREFUSED 10.0.0.5:5432\n    at TCPConnectWrap.afterConnect",
    properties: {
      ContainerId: "8c2f6b1e3a",
      Host: "lw1sdlwk000ABC",
    },
    ...overrides,
  };
}

// A function's log, as FunctionAppLogs writes it.
export function functionAppRecord(overrides: JSONObject = {}): JSONObject {
  return {
    time: "2026-11-06T09:59:30.5Z",
    resourceId: SITE_ID.toUpperCase(),
    category: "FunctionAppLogs",
    operationName: "Microsoft.Web/sites/functions/log",
    level: "Informational",
    location: "East US",
    properties: {
      appName: "checkout",
      roleInstance: "54108609-638134129287469128",
      message: "Executed 'Functions.ChargeCard' (Failed, Id=3f9a, Duration=1022ms)",
      category: "Function.ChargeCard",
      functionName: "Functions.ChargeCard",
      level: "Error",
      levelId: 4,
      processId: 6064,
    },
    ...overrides,
  };
}

// An AKS control plane line, as kube-apiserver logs are written.
export function aksRecord(overrides: JSONObject = {}): JSONObject {
  return {
    time: "2026-11-06T09:59:40.0000000Z",
    resourceId: AKS_ID.toUpperCase(),
    category: "kube-apiserver",
    operationName: "Microsoft.ContainerService/managedClusters/diagnosticLogs/Read",
    properties: {
      log: "E1106 09:59:40.123456 1 status.go:71] apiserver received an error that is not an metav1.Status",
      stream: "stderr",
      pod: "kube-apiserver-6d9f8c7b5-x2x9z",
    },
    ...overrides,
  };
}

// One event of the event hub: a document of records, as bytes.
export function eventOf(records: Array<JSONObject>): Buffer {
  return Buffer.from(JSON.stringify({ records }), "utf8");
}
