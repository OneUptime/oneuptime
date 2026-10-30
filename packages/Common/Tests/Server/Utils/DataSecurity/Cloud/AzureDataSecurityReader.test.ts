import { describe, expect, test } from "@jest/globals";
import { gzipSync } from "zlib";
import AzureArm from "../../../../../Server/Utils/CloudConnection/Azure/AzureArm";
import {
  CloudConnectionSettings,
  CloudConnectorTransport,
  CloudReadBudget,
} from "../../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import {
  AZURE_DATA_SECURITY_QUERY,
  createAzureBlobObjectStoreReader,
  listAzureBlobContainers,
  normalizeAzureTlsVersion,
  readAzureDataSecurity,
} from "../../../../../Server/Utils/DataSecurity/Cloud/Azure/AzureDataSecurityReader";
import {
  CloudDataSecurityReadResult,
  CloudDataStoreRead,
  ObjectStoreListPage,
  ObjectStoreReader,
} from "../../../../../Server/Utils/DataSecurity/Cloud/DataSecurityCloudTypes";
import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../../../Server/Utils/DataSource/HttpFetch";
import LlmProviderError from "../../../../../Server/Utils/LlmObservability/LlmProviderError";
import { CloudProvider } from "../../../../../Types/Cloud/CloudPlatform";
import { CloudConnectionAuthMethod } from "../../../../../Types/CloudConnection/CloudConnectionCatalog";
import { CloudConnectionFailureKind } from "../../../../../Types/CloudConnection/CloudConnectionTest";
import {
  DataStoreAccessEntry,
  DataStoreAccessLevel,
  DataStorePrincipalType,
} from "../../../../../Types/DataSecurity/DataStoreAccess";
import { DataStoreKind } from "../../../../../Types/DataSecurity/DataStoreKind";
import { getDataStoreExposure } from "../../../../../Types/DataSecurity/DataStorePosture";
import Dictionary from "../../../../../Types/Dictionary";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../Types/JSON";
import {
  FakeProviderApi,
  FakeResponse,
  FakeRoute,
  bodyOf,
  createFakeProviderApi,
  json,
} from "../../LlmObservability/FakeProviderApi";

/*
 * Azure's data stores against a fake Resource Graph, Resource Manager and
 * Blob service: each kind's settings as posture facts (anonymous
 * containers, network rules, TLS, keys, encryption, redundancy, soft
 * delete, versioning, firewalls, transparent data encryption, backups),
 * data role assignments at, above and below a store as access entries, a
 * refused call as null facts and one warning per API, a refused sign-in
 * as a thrown error - and the content scanner's container reader: List
 * Blobs and ranged Get Blob, on a host built from the account's name only.
 */

const TENANT: string = "b3c1b5fc-828c-45fa-a1e1-10d74f6d6e9c";
const OTHER_TENANT: string = "72f988bf-86f1-41af-91ab-2d7cd011db47";
const CLIENT: string = "00001111-aaaa-2222-bbbb-3333cccc4444";
const SECRET: string = "client-secret~value";
const SUB_A: string = "d0cfe6b2-9ac0-4464-9919-dccaee2e48c0";
// A subscription the project has not connected.
const SUB_OTHER: string = "7c4a1f2e-9d3b-4e5f-8a6b-1c2d3e4f5a6b";
const NOW: Date = new Date("2026-10-27T12:00:00Z");
const ARM_TOKEN: string = "arm-access-token";
const STORAGE_TOKEN: string = "storage-access-token";

// The host a token request's scope names ("https://storage.azure.com/.default"), or "" for none.
function hostOfScope(scope: string): string {
  try {
    return new URL(scope).host;
  } catch {
    return "";
  }
}

const RG: string = `/subscriptions/${SUB_A}/resourceGroups/rg-data`;
const PUBLIC_ACCOUNT: string = `${RG}/providers/Microsoft.Storage/storageAccounts/acmepublic`;
const LOCKED_ACCOUNT: string = `${RG}/providers/Microsoft.Storage/storageAccounts/acmelocked`;
const SELECTED_ACCOUNT: string = `${RG}/providers/Microsoft.Storage/storageAccounts/acmeselected`;
const SQL_OPEN: string = `${RG}/providers/Microsoft.Sql/servers/sql-open`;
const SQL_AZURE: string = `${RG}/providers/Microsoft.Sql/servers/sql-azure`;
const ORDERS_DB: string = `${SQL_OPEN}/databases/orders`;
const BILLING_DB: string = `${SQL_AZURE}/databases/billing`;
const COSMOS: string = `${RG}/providers/Microsoft.DocumentDB/databaseAccounts/acme-cosmos`;
const POSTGRES: string = `${RG}/providers/Microsoft.DBforPostgreSQL/flexibleServers/pg-orders`;
const MYSQL: string = `${RG}/providers/Microsoft.DBforMySQL/flexibleServers/mysql-shop`;

// Built-in role ids.
const BLOB_READER: string = "2a2b9908-6ea1-4ae2-8e65-a410df84e7d1";
const BLOB_CONTRIBUTOR: string = "ba92f5b4-2d11-453d-a403-e96b0029c9fe";
const BLOB_OWNER: string = "b7e6dc6d-f1e8-4753-8033-0f276bb0955b";
const ACCOUNT_CONTRIBUTOR: string = "17d1049b-9a84-46fb-8f53-869881c3d3ab";
const DOCUMENTDB_CONTRIBUTOR: string = "5bd9cd88-fe45-4216-938b-f97437e15450";
const OWNER: string = "8e3af657-a8ff-443c-a75c-2fe8c4bcb635";

const USER_ALICE: string = "11111111-1111-4111-8111-111111111111";
const PIPELINE: string = "22222222-2222-4222-8222-222222222222";
const PARTNER_GROUP: string = "33333333-3333-4333-8333-333333333333";
const OPERATOR: string = "44444444-4444-4444-8444-444444444444";
const COSMOS_APP: string = "55555555-5555-4555-8555-555555555555";
const COSMOS_READER: string = "66666666-6666-4666-8666-666666666666";
const DBA_GROUP: string = "77777777-7777-4777-8777-777777777777";

function settings(config: JSONObject = {}): CloudConnectionSettings {
  return {
    provider: CloudProvider.Azure,
    projectId: "11111111-1111-4111-8111-111111111111",
    config: {
      authMethod: CloudConnectionAuthMethod.AzureClientSecret,
      tenantId: TENANT,
      clientId: CLIENT,
      cloud: "public",
      subscriptionIds: SUB_A,
      ...config,
    },
    secrets: { clientSecret: SECRET },
  };
}

function lastSegment(id: string): string {
  return id.split("/").pop() || "";
}

function row(id: string, type: string, overrides: JSONObject = {}): JSONObject {
  return {
    id,
    name: lastSegment(id),
    type,
    location: "westeurope",
    resourceGroup: "rg-data",
    subscriptionId: SUB_A,
    tenantId: TENANT,
    tags: {},
    kind: "",
    ...overrides,
  };
}

function storageRow(id: string, overrides: JSONObject = {}): JSONObject {
  return row(id, "microsoft.storage/storageaccounts", {
    kind: "StorageV2",
    skuName: "Standard_LRS",
    publicNetworkAccess: "Enabled",
    networkAcls: { defaultAction: "Allow", ipRules: [] },
    encryptionKeySource: "Microsoft.Storage",
    blobEncryptionEnabled: true,
    supportsHttpsTrafficOnly: true,
    minimumTlsVersion: "TLS1_2",
    ...overrides,
  });
}

const PUBLIC_ACCOUNT_ROW: JSONObject = storageRow(PUBLIC_ACCOUNT, {
  tags: { env: "prod", owner: "data-team" },
  skuName: "Standard_RAGRS",
  secondaryLocation: "northeurope",
  allowBlobPublicAccess: true,
  // Never set: Azure reads it as allowed.
  allowSharedKeyAccess: null,
  supportsHttpsTrafficOnly: false,
  minimumTlsVersion: "TLS1_0",
  encryptionKeySource: "Microsoft.Keyvault",
  networkAcls: {
    defaultAction: "Allow",
    ipRules: [],
    resourceAccessRules: [
      {
        tenantId: OTHER_TENANT,
        resourceId: `/subscriptions/${SUB_OTHER}/resourceGroups/rg-x/providers/Microsoft.Synapse/workspaces/partner-ws`,
      },
    ],
  },
  privateEndpointConnections: [
    {
      properties: {
        privateEndpoint: {
          id: `/subscriptions/${SUB_OTHER}/resourceGroups/rg-x/providers/Microsoft.Network/privateEndpoints/pe-partner`,
        },
        privateLinkServiceConnectionState: { status: "Approved" },
      },
    },
    {
      properties: {
        privateEndpoint: {
          id: `/subscriptions/${SUB_A}/resourceGroups/rg-data/providers/Microsoft.Network/privateEndpoints/pe-own`,
        },
        privateLinkServiceConnectionState: { status: "Approved" },
      },
    },
  ],
});

const LOCKED_ACCOUNT_ROW: JSONObject = storageRow(LOCKED_ACCOUNT, {
  allowBlobPublicAccess: false,
  allowSharedKeyAccess: false,
  publicNetworkAccess: "Disabled",
  networkAcls: { defaultAction: "Deny", ipRules: [] },
});

const SELECTED_ACCOUNT_ROW: JSONObject = storageRow(SELECTED_ACCOUNT, {
  networkAcls: {
    defaultAction: "Deny",
    ipRules: [{ value: "203.0.113.0/24", action: "Allow" }],
  },
  // Never set: TLS 1.0, as Azure reads it.
  minimumTlsVersion: "",
  supportsHttpsTrafficOnly: null,
});

function sqlServerRow(id: string, overrides: JSONObject): JSONObject {
  return row(id, "microsoft.sql/servers", overrides);
}

const SQL_ROWS: Array<JSONObject> = [
  sqlServerRow(SQL_OPEN, {
    publicNetworkAccess: "Enabled",
    minimalTlsVersion: "1.2",
    administratorLogin: "sqladmin",
    administrators: {
      administratorType: "ActiveDirectory",
      principalType: "Group",
      login: "partner-dbas",
      sid: DBA_GROUP,
      tenantId: OTHER_TENANT,
      azureADOnlyAuthentication: false,
    },
  }),
  sqlServerRow(SQL_AZURE, {
    publicNetworkAccess: "Enabled",
    minimalTlsVersion: "None",
    administratorLogin: "sa",
    administrators: {
      administratorType: "ActiveDirectory",
      principalType: "User",
      login: "alice@acme.com",
      sid: USER_ALICE,
      tenantId: TENANT,
      azureADOnlyAuthentication: true,
    },
  }),
  row(ORDERS_DB, "microsoft.sql/servers/databases", {
    tags: { app: "orders" },
  }),
  row(BILLING_DB, "microsoft.sql/servers/databases"),
  // The system database: never a store.
  row(`${SQL_OPEN}/databases/master`, "microsoft.sql/servers/databases"),
];

const COSMOS_ROW: JSONObject = row(
  COSMOS,
  "microsoft.documentdb/databaseaccounts",
  {
    kind: "GlobalDocumentDB",
    publicNetworkAccess: "Enabled",
    ipRules: [],
    isVirtualNetworkFilterEnabled: false,
    disableLocalAuth: false,
    backupPolicy: {
      type: "Continuous",
      continuousModeProperties: { tier: "Continuous7Days" },
    },
    locations: [
      { locationName: "West Europe", failoverPriority: 0 },
      { locationName: "North Europe", failoverPriority: 1 },
    ],
    keyVaultKeyUri: "https://acme-kv.vault.azure.net/keys/cosmos",
    minimalTlsVersion: "Tls12",
  },
);

const POSTGRES_ROW: JSONObject = row(
  POSTGRES,
  "microsoft.dbforpostgresql/flexibleservers",
  {
    serverPublicNetworkAccess: "Enabled",
    backupRetentionDays: 14,
    dataEncryptionType: "AzureKeyVault",
    administratorLogin: "pgadmin",
    passwordAuth: "Enabled",
  },
);

const MYSQL_ROW: JSONObject = row(
  MYSQL,
  "microsoft.dbformysql/flexibleservers",
  {
    serverPublicNetworkAccess: "Disabled",
    backupRetentionDays: 7,
    dataEncryptionType: "SystemManaged",
    administratorLogin: "shopadmin",
  },
);

const ALL_ROWS: Array<JSONObject> = [
  PUBLIC_ACCOUNT_ROW,
  LOCKED_ACCOUNT_ROW,
  SELECTED_ACCOUNT_ROW,
  ...SQL_ROWS,
  COSMOS_ROW,
  POSTGRES_ROW,
  MYSQL_ROW,
];

function container(name: string, publicAccess: string): JSONObject {
  return { name, properties: { publicAccess } };
}

function blobService(data: {
  blobs: boolean;
  containers: boolean;
  versioning: boolean;
}): JSONObject {
  return {
    properties: {
      deleteRetentionPolicy: { enabled: data.blobs, days: 7 },
      containerDeleteRetentionPolicy: { enabled: data.containers, days: 7 },
      isVersioningEnabled: data.versioning,
    },
  };
}

function firewallRule(name: string, start: string, end: string): JSONObject {
  return { name, properties: { startIpAddress: start, endIpAddress: end } };
}

function assignment(
  roleId: string,
  principalId: string,
  principalType: string,
  scope: string,
): JSONObject {
  return {
    id: `${scope}/providers/Microsoft.Authorization/roleAssignments/${principalId}`,
    properties: {
      roleDefinitionId: `/subscriptions/${SUB_A}/providers/Microsoft.Authorization/roleDefinitions/${roleId}`,
      principalId,
      principalType,
      scope,
    },
  };
}

const ROLE_ASSIGNMENTS: Array<JSONObject> = [
  // At the subscription: every storage account inherits it.
  assignment(BLOB_READER, USER_ALICE, "User", `/subscriptions/${SUB_A}`),
  assignment(BLOB_CONTRIBUTOR, PIPELINE, "ServicePrincipal", RG),
  // Manages the account, reads none of its data.
  assignment(OWNER, USER_ALICE, "User", PUBLIC_ACCOUNT),
  // On one container, for a group of another tenant.
  assignment(
    BLOB_OWNER,
    PARTNER_GROUP,
    "ForeignGroup",
    `${PUBLIC_ACCOUNT}/blobServices/default/containers/private`,
  ),
  // Reaches data through the keys: only where the account takes them.
  assignment(ACCOUNT_CONTRIBUTOR, OPERATOR, "User", RG),
  assignment(DOCUMENTDB_CONTRIBUTOR, COSMOS_APP, "ServicePrincipal", COSMOS),
  // Another resource group: no store here is in it.
  assignment(
    BLOB_READER,
    PIPELINE,
    "ServicePrincipal",
    `/subscriptions/${SUB_A}/resourceGroups/rg-other`,
  ),
  // A management group above the subscription.
  assignment(
    BLOB_READER,
    COSMOS_READER,
    "ServicePrincipal",
    "/providers/Microsoft.Management/managementGroups/acme-root",
  ),
];

interface FakeAzureOptions {
  cloud?: "public" | "usgov";
  rows?: Array<JSONObject>;
  subscriptions?: Array<JSONObject>;
  containers?: Record<string, Array<JSONObject>>;
  blobServices?: Record<string, JSONObject>;
  firewallRules?: Record<string, Array<JSONObject>>;
  encryption?: Record<string, string>;
  cosmosRoles?: Record<string, Array<JSONObject>>;
  roleAssignments?: Record<string, Array<JSONObject>>;
  // A failure for every call of one kind, keyed as the routes below name them.
  errors?: Record<string, FakeResponse>;
  tokenError?: FakeResponse;
  // The Blob service's data plane.
  blobRoutes?: Array<FakeRoute>;
}

const FULL_OPTIONS: FakeAzureOptions = {
  rows: ALL_ROWS,
  containers: {
    [PUBLIC_ACCOUNT.toLowerCase()]: [
      container("public-assets", "Container"),
      container("images", "Blob"),
      container("private", "None"),
    ],
    [SELECTED_ACCOUNT.toLowerCase()]: [container("exports", "None")],
  },
  blobServices: {
    [PUBLIC_ACCOUNT.toLowerCase()]: blobService({
      blobs: true,
      containers: true,
      versioning: true,
    }),
    [LOCKED_ACCOUNT.toLowerCase()]: blobService({
      blobs: true,
      containers: false,
      versioning: false,
    }),
    [SELECTED_ACCOUNT.toLowerCase()]: blobService({
      blobs: false,
      containers: false,
      versioning: false,
    }),
  },
  firewallRules: {
    [SQL_OPEN.toLowerCase()]: [
      firewallRule("everyone", "0.0.0.0", "255.255.255.255"),
    ],
    [SQL_AZURE.toLowerCase()]: [
      // "Allow Azure services": not every address.
      firewallRule("AllowAllWindowsAzureIps", "0.0.0.0", "0.0.0.0"),
      firewallRule("office", "203.0.113.10", "203.0.113.20"),
    ],
    [POSTGRES.toLowerCase()]: [
      firewallRule("everyone", "0.0.0.0", "255.255.255.255"),
    ],
  },
  encryption: {
    [ORDERS_DB.toLowerCase()]: "Enabled",
    [BILLING_DB.toLowerCase()]: "Disabled",
  },
  cosmosRoles: {
    [COSMOS.toLowerCase()]: [
      {
        properties: {
          roleDefinitionId: `${COSMOS}/sqlRoleDefinitions/00000000-0000-0000-0000-000000000001`,
          principalId: COSMOS_READER,
          scope: COSMOS,
        },
      },
      {
        properties: {
          roleDefinitionId: `${COSMOS}/sqlRoleDefinitions/00000000-0000-0000-0000-000000000002`,
          principalId: COSMOS_APP,
          scope: `${COSMOS}/dbs/orders`,
        },
      },
    ],
  },
  roleAssignments: { [SUB_A]: ROLE_ASSIGNMENTS },
};

function createFakeAzure(options: FakeAzureOptions = {}): FakeProviderApi {
  const login: string =
    options.cloud === "usgov"
      ? "login.microsoftonline.us"
      : "login.microsoftonline.com";
  const management: string =
    options.cloud === "usgov"
      ? "management.usgovcloudapi.net"
      : "management.azure.com";
  const failure: (kind: string) => FakeResponse | undefined = (
    kind: string,
  ): FakeResponse | undefined => {
    return options.errors?.[kind];
  };
  const resourceOf: (url: URL, suffix: string) => string = (
    url: URL,
    suffix: string,
  ): string => {
    return url.pathname
      .slice(0, url.pathname.length - suffix.length)
      .toLowerCase();
  };

  return createFakeProviderApi([
    {
      host: login,
      path: `/${TENANT}/oauth2/v2.0/token`,
      method: "POST",
      respond: (request: DataSourceHttpRequest): FakeResponse => {
        if (options.tokenError) {
          return options.tokenError;
        }

        const scope: string = String(
          (request.body as Dictionary<string>)["scope"] || "",
        );

        return json({
          access_token:
            hostOfScope(scope) === "storage.azure.com"
              ? STORAGE_TOKEN
              : ARM_TOKEN,
          expires_in: 3599,
        });
      },
    },
    {
      host: management,
      path: "/providers/Microsoft.ResourceGraph/resources",
      method: "POST",
      respond: (): FakeResponse => {
        return (
          failure("resource-graph") ||
          json({
            data: options.rows || [],
            count: (options.rows || []).length,
          })
        );
      },
    },
    {
      host: management,
      path: "/subscriptions",
      respond: (): FakeResponse => {
        return (
          failure("subscriptions") ||
          json({ value: options.subscriptions || [] })
        );
      },
    },
    {
      host: management,
      path: /\/blobServices\/default\/containers$/,
      respond: (_request: DataSourceHttpRequest, url: URL): FakeResponse => {
        return (
          failure("containers") ||
          json({
            value:
              options.containers?.[
                resourceOf(url, "/blobServices/default/containers")
              ] || [],
          })
        );
      },
    },
    {
      host: management,
      path: /\/blobServices\/default$/,
      respond: (_request: DataSourceHttpRequest, url: URL): FakeResponse => {
        return (
          failure("blob-service") ||
          json(
            options.blobServices?.[resourceOf(url, "/blobServices/default")] ||
              blobService({
                blobs: false,
                containers: false,
                versioning: false,
              }),
          )
        );
      },
    },
    {
      host: management,
      path: /\/firewallRules$/,
      respond: (_request: DataSourceHttpRequest, url: URL): FakeResponse => {
        return (
          failure("firewall") ||
          json({
            value:
              options.firewallRules?.[resourceOf(url, "/firewallRules")] || [],
          })
        );
      },
    },
    {
      host: management,
      path: /\/transparentDataEncryption\/current$/,
      respond: (_request: DataSourceHttpRequest, url: URL): FakeResponse => {
        return (
          failure("encryption") ||
          json({
            properties: {
              state:
                options.encryption?.[
                  resourceOf(url, "/transparentDataEncryption/current")
                ] || "Enabled",
            },
          })
        );
      },
    },
    {
      host: management,
      path: /\/sqlRoleAssignments$/,
      respond: (_request: DataSourceHttpRequest, url: URL): FakeResponse => {
        return (
          failure("cosmos-roles") ||
          json({
            value:
              options.cosmosRoles?.[resourceOf(url, "/sqlRoleAssignments")] ||
              [],
          })
        );
      },
    },
    {
      host: management,
      path: /^\/subscriptions\/[^/]+\/providers\/Microsoft\.Authorization\/roleAssignments$/,
      respond: (_request: DataSourceHttpRequest, url: URL): FakeResponse => {
        return (
          failure("role-assignments") ||
          json({
            value: options.roleAssignments?.[url.pathname.split("/")[2]!] || [],
          })
        );
      },
    },
    ...(options.blobRoutes || []),
  ]);
}

async function readAll(
  api: FakeProviderApi,
  data: {
    settings?: CloudConnectionSettings;
    connected?: Array<string>;
    budget?: CloudReadBudget;
  } = {},
): Promise<CloudDataSecurityReadResult> {
  return await readAzureDataSecurity(data.settings || settings(), {
    projectId: "11111111-1111-4111-8111-111111111111",
    connectionId: "22222222-2222-4222-8222-222222222222",
    connectedSubscriptionIds: data.connected || [SUB_A],
    transport: api.transport,
    now: (): Date => {
      return NOW;
    },
    budget: data.budget,
  });
}

function storeNamed(
  result: CloudDataSecurityReadResult,
  name: string,
): CloudDataStoreRead {
  const found: CloudDataStoreRead | undefined = result.stores.find(
    (store: CloudDataStoreRead): boolean => {
      return store.identity.name === name;
    },
  );

  if (!found) {
    throw new Error(`No store ${name}`);
  }

  return found;
}

function entriesOf(
  store: CloudDataStoreRead,
  principal: string,
): Array<DataStoreAccessEntry> {
  return store.access.filter((entry: DataStoreAccessEntry): boolean => {
    return entry.principal === principal;
  });
}

function requestsEndingWith(
  api: FakeProviderApi,
  suffix: string,
): Array<DataSourceHttpRequest> {
  return api.requests.filter((request: DataSourceHttpRequest): boolean => {
    return new URL(request.url).pathname.endsWith(suffix);
  });
}

describe("the listing", () => {
  test("one Resource Graph query of its own, over the connection's subscriptions, projecting only the settings it reads", async () => {
    const api: FakeProviderApi = createFakeAzure(FULL_OPTIONS);
    await readAll(api);

    const graph: Array<DataSourceHttpRequest> = api.requestsTo(
      "/providers/Microsoft.ResourceGraph/resources",
    );

    expect(graph).toHaveLength(1);
    expect(bodyOf(graph[0]!)["subscriptions"]).toEqual([SUB_A]);
    expect(bodyOf(graph[0]!)["query"]).toBe(AZURE_DATA_SECURITY_QUERY);
    expect(graph[0]!.headers?.["Authorization"]).toBe(`Bearer ${ARM_TOKEN}`);

    for (const type of [
      "microsoft.storage/storageaccounts",
      "microsoft.sql/servers/databases",
      "microsoft.documentdb/databaseaccounts",
      "microsoft.dbforpostgresql/flexibleservers",
      "microsoft.dbformysql/flexibleservers",
    ]) {
      expect(AZURE_DATA_SECURITY_QUERY).toContain(`'${type}'`);
    }

    expect(AZURE_DATA_SECURITY_QUERY).toContain("name =~ 'master'");
    // Field by field: never a resource's whole properties.
    expect(AZURE_DATA_SECURITY_QUERY).not.toContain("= properties,");
    expect(AZURE_DATA_SECURITY_QUERY).not.toContain("project properties");
  });

  test("every store, of every kind, carries when it was read; the SQL server is its databases' settings and master is no store", async () => {
    const result: CloudDataSecurityReadResult = await readAll(
      createFakeAzure(FULL_OPTIONS),
    );

    expect(
      result.stores
        .map((store: CloudDataStoreRead): string => {
          return `${store.identity.kind}: ${store.identity.name}`;
        })
        .sort(),
    ).toEqual(
      [
        `${DataStoreKind.AzureStorageAccount}: acmepublic`,
        `${DataStoreKind.AzureStorageAccount}: acmelocked`,
        `${DataStoreKind.AzureStorageAccount}: acmeselected`,
        `${DataStoreKind.AzureSqlDatabase}: sql-open/orders`,
        `${DataStoreKind.AzureSqlDatabase}: sql-azure/billing`,
        `${DataStoreKind.AzureCosmosDbAccount}: acme-cosmos`,
        `${DataStoreKind.AzurePostgreSqlServer}: pg-orders`,
        `${DataStoreKind.AzureMySqlServer}: mysql-shop`,
      ].sort(),
    );

    for (const store of result.stores) {
      expect(store.posture.readAt).toBe(NOW.toISOString());
      expect(store.identity.accountNumber).toBe(SUB_A);
      expect(store.identity.region).toBe("westeurope");
    }

    const account: CloudDataStoreRead = storeNamed(result, "acmepublic");
    expect(account.identity.providerResourceId).toBe(PUBLIC_ACCOUNT);
    expect(account.tags).toEqual({ env: "prod", owner: "data-team" });
    expect(storeNamed(result, "sql-open/orders").tags).toEqual({
      app: "orders",
    });
    expect(result.complete).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  test("a connection that names no subscription reads every enabled one the app may read", async () => {
    const api: FakeProviderApi = createFakeAzure({
      ...FULL_OPTIONS,
      subscriptions: [
        { subscriptionId: SUB_A, displayName: "Production", state: "Enabled" },
        {
          subscriptionId: SUB_OTHER,
          displayName: "Old",
          state: "Disabled",
        },
      ],
    });

    await readAll(api, { settings: settings({ subscriptionIds: "" }) });

    expect(
      bodyOf(
        api.requestsTo("/providers/Microsoft.ResourceGraph/resources")[0]!,
      )["subscriptions"],
    ).toEqual([SUB_A]);
  });
});

describe("storage accounts", () => {
  test("an account that allows anonymous access, with anonymous containers, is public - and its containers are named", async () => {
    const result: CloudDataSecurityReadResult = await readAll(
      createFakeAzure(FULL_OPTIONS),
    );
    const posture: CloudDataStoreRead["posture"] = storeNamed(
      result,
      "acmepublic",
    ).posture;

    expect(posture.publicRead).toBe(true);
    expect(posture.publicReason).toContain("public-assets (Container)");
    expect(posture.publicReason).toContain("images (Blob)");
    expect(posture.publicReason).not.toContain("private");
    expect(posture.blockPublicAccess).toBe(false);
    // Allow by default: every address may connect.
    expect(posture.publicNetworkAccess).toBe(true);
    expect(posture.openToAllAddresses).toBe(true);
    expect(posture.encryptedAtRest).toBe(true);
    expect(posture.customerManagedKey).toBe(true);
    expect(posture.encryptionInTransitEnforced).toBe(false);
    expect(posture.minimumTlsVersion).toBe("1.0");
    expect(posture.sharedKeyAccess).toBe(true);
    expect(posture.replicationRegions).toEqual(["northeurope"]);
    expect(posture.softDelete).toBe(true);
    expect(posture.versioning).toBe(true);
    expect(getDataStoreExposure(posture)).toBe("Public");
  });

  test("anonymous containers are Public entries", async () => {
    const result: CloudDataSecurityReadResult = await readAll(
      createFakeAzure(FULL_OPTIONS),
    );
    const anonymous: Array<DataStoreAccessEntry> = entriesOf(
      storeNamed(result, "acmepublic"),
      "Anonymous",
    );

    expect(
      anonymous.map((entry: DataStoreAccessEntry): string => {
        return entry.grantedVia;
      }),
    ).toEqual([
      "Anonymous access: container public-assets (Container)",
      "Anonymous access: container images (Blob)",
    ]);

    for (const entry of anonymous) {
      expect(entry.principalType).toBe(DataStorePrincipalType.Public);
      expect(entry.accessLevel).toBe(DataStoreAccessLevel.Read);
      expect(entry.isPublic).toBe(true);
    }
  });

  test("an account that turns anonymous access off is not public whatever its containers say, and they are not listed for it", async () => {
    const api: FakeProviderApi = createFakeAzure({
      ...FULL_OPTIONS,
      containers: {
        [LOCKED_ACCOUNT.toLowerCase()]: [container("leaky", "Container")],
      },
    });
    const result: CloudDataSecurityReadResult = await readAll(api);
    const posture: CloudDataStoreRead["posture"] = storeNamed(
      result,
      "acmelocked",
    ).posture;

    expect(posture.publicRead).toBe(false);
    expect(posture.blockPublicAccess).toBe(true);
    expect(posture.publicNetworkAccess).toBe(false);
    expect(posture.openToAllAddresses).toBe(false);
    expect(posture.customerManagedKey).toBe(false);
    expect(posture.encryptionInTransitEnforced).toBe(true);
    expect(posture.minimumTlsVersion).toBe("1.2");
    expect(posture.sharedKeyAccess).toBe(false);
    // Locally redundant: copied to no other region.
    expect(posture.replicationRegions).toEqual([]);
    // Blobs are kept after deletion, containers are not: not soft delete.
    expect(posture.softDelete).toBe(false);
    expect(posture.versioning).toBe(false);
    expect(
      requestsEndingWith(api, "acmelocked/blobServices/default/containers"),
    ).toHaveLength(0);
  });

  test("an account that denies by default but lets some addresses in is reachable from the internet, not open to every address", async () => {
    const result: CloudDataSecurityReadResult = await readAll(
      createFakeAzure(FULL_OPTIONS),
    );
    const posture: CloudDataStoreRead["posture"] = storeNamed(
      result,
      "acmeselected",
    ).posture;

    expect(posture.publicNetworkAccess).toBe(true);
    expect(posture.openToAllAddresses).toBe(false);
    expect(posture.publicRead).toBe(false);
    // Unset: TLS 1.0, as Azure reads it; the HTTPS setting said nothing.
    expect(posture.minimumTlsVersion).toBe("1.0");
    expect(posture.encryptionInTransitEnforced).toBeNull();
  });

  test("a private endpoint and a resource instance rule from outside the connected subscriptions share the account", async () => {
    const result: CloudDataSecurityReadResult = await readAll(
      createFakeAzure(FULL_OPTIONS),
    );
    const posture: CloudDataStoreRead["posture"] = storeNamed(
      result,
      "acmepublic",
    ).posture;

    expect(posture.sharedWithExternal).toEqual(
      expect.arrayContaining([
        `subscription ${SUB_OTHER}`,
        `tenant ${OTHER_TENANT}`,
      ]),
    );
    // Its own subscription's endpoint is not external.
    expect(posture.sharedWithExternal).not.toContain(`subscription ${SUB_A}`);
    expect(storeNamed(result, "acmelocked").posture.sharedWithExternal).toEqual(
      [],
    );
  });
});

describe("role assignments", () => {
  test("the data roles at, above and below an account are its access entries; roles that only manage it are not", async () => {
    const result: CloudDataSecurityReadResult = await readAll(
      createFakeAzure(FULL_OPTIONS),
    );
    const account: CloudDataStoreRead = storeNamed(result, "acmepublic");

    expect(entriesOf(account, USER_ALICE)).toEqual([
      {
        principal: USER_ALICE,
        principalType: DataStorePrincipalType.User,
        accessLevel: DataStoreAccessLevel.Read,
        grantedVia: `Role assignment: Storage Blob Data Reader (inherited from subscription ${SUB_A})`,
        isExternal: false,
        isPublic: false,
      },
    ]);
    expect(entriesOf(account, PIPELINE)).toEqual([
      {
        principal: PIPELINE,
        principalType: DataStorePrincipalType.ServicePrincipal,
        accessLevel: DataStoreAccessLevel.Write,
        grantedVia:
          "Role assignment: Storage Blob Data Contributor (inherited from resource group rg-data)",
        isExternal: false,
        isPublic: false,
      },
    ]);
    expect(entriesOf(account, COSMOS_READER)[0]!.grantedVia).toBe(
      "Role assignment: Storage Blob Data Reader (inherited from management group acme-root)",
    );
  });

  test("a group of another tenant on one container is an external Admin entry, and shares the account", async () => {
    const result: CloudDataSecurityReadResult = await readAll(
      createFakeAzure(FULL_OPTIONS),
    );
    const account: CloudDataStoreRead = storeNamed(result, "acmepublic");

    expect(entriesOf(account, PARTNER_GROUP)).toEqual([
      {
        principal: PARTNER_GROUP,
        principalType: DataStorePrincipalType.Group,
        accessLevel: DataStoreAccessLevel.Admin,
        grantedVia:
          "Role assignment: Storage Blob Data Owner (on containers private)",
        isExternal: true,
        isPublic: false,
      },
    ]);
    expect(account.posture.sharedWithExternal).toContain(
      `group ${PARTNER_GROUP} of another tenant`,
    );
  });

  test("a role that reaches data through the account keys counts only where the account takes its keys", async () => {
    const result: CloudDataSecurityReadResult = await readAll(
      createFakeAzure(FULL_OPTIONS),
    );

    expect(entriesOf(storeNamed(result, "acmepublic"), OPERATOR)).toEqual([
      expect.objectContaining({
        accessLevel: DataStoreAccessLevel.Write,
        grantedVia:
          "Role assignment: Storage Account Contributor (inherited from resource group rg-data), through the account keys",
      }),
    ]);
    // acmelocked turns shared keys off.
    expect(entriesOf(storeNamed(result, "acmelocked"), OPERATOR)).toEqual([]);
  });

  test("role assignments are read once per subscription, not once per store", async () => {
    const api: FakeProviderApi = createFakeAzure(FULL_OPTIONS);
    await readAll(api);

    expect(
      api.requestsTo(
        `/subscriptions/${SUB_A}/providers/Microsoft.Authorization/roleAssignments`,
      ),
    ).toHaveLength(1);
  });
});

describe("SQL databases", () => {
  test("a server whose firewall lets every address in, with encryption on, and an Entra admin of another tenant", async () => {
    const result: CloudDataSecurityReadResult = await readAll(
      createFakeAzure(FULL_OPTIONS),
    );
    const orders: CloudDataStoreRead = storeNamed(result, "sql-open/orders");

    expect(orders.posture.publicNetworkAccess).toBe(true);
    expect(orders.posture.openToAllAddresses).toBe(true);
    expect(orders.posture.encryptedAtRest).toBe(true);
    expect(orders.posture.minimumTlsVersion).toBe("1.2");
    expect(orders.access).toEqual([
      {
        principal: DBA_GROUP,
        principalName: "partner-dbas",
        principalType: DataStorePrincipalType.Group,
        accessLevel: DataStoreAccessLevel.Admin,
        grantedVia: "Microsoft Entra admin of server sql-open",
        isExternal: true,
        isPublic: false,
      },
      {
        principal: "sqladmin",
        principalName: "sqladmin",
        principalType: DataStorePrincipalType.User,
        accessLevel: DataStoreAccessLevel.Admin,
        grantedVia: "SQL administrator login of server sql-open",
        isExternal: false,
        isPublic: false,
      },
    ]);
    expect(orders.posture.sharedWithExternal).toEqual([
      `tenant ${OTHER_TENANT}`,
    ]);
  });

  test("the 'allow Azure services' rule is not every address; encryption off is said; an Entra-only server has no SQL login", async () => {
    const api: FakeProviderApi = createFakeAzure(FULL_OPTIONS);
    const result: CloudDataSecurityReadResult = await readAll(api);
    const billing: CloudDataStoreRead = storeNamed(result, "sql-azure/billing");

    expect(billing.posture.openToAllAddresses).toBe(false);
    expect(billing.posture.encryptedAtRest).toBe(false);
    expect(billing.posture.minimumTlsVersion).toBe("None");
    expect(
      billing.access.map((entry: DataStoreAccessEntry): string => {
        return entry.principal;
      }),
    ).toEqual([USER_ALICE]);
    expect(billing.access[0]!.isExternal).toBe(false);
    // One firewall read per server, one encryption read per database - and none for master.
    expect(requestsEndingWith(api, "/firewallRules")).toHaveLength(3);
    expect(
      requestsEndingWith(api, "/transparentDataEncryption/current"),
    ).toHaveLength(2);
  });

  test("a server that takes no public traffic needs no firewall read", async () => {
    const api: FakeProviderApi = createFakeAzure({
      ...FULL_OPTIONS,
      rows: [
        sqlServerRow(SQL_OPEN, { publicNetworkAccess: "Disabled" }),
        row(ORDERS_DB, "microsoft.sql/servers/databases"),
      ],
    });
    const result: CloudDataSecurityReadResult = await readAll(api);

    expect(storeNamed(result, "sql-open/orders").posture).toEqual(
      expect.objectContaining({
        publicNetworkAccess: false,
        openToAllAddresses: false,
      }),
    );
    expect(requestsEndingWith(api, "/firewallRules")).toHaveLength(0);
  });
});

describe("Cosmos DB accounts", () => {
  test("no IP rule and no network filter is every address; local keys, continuous backup, its regions and its key", async () => {
    const result: CloudDataSecurityReadResult = await readAll(
      createFakeAzure(FULL_OPTIONS),
    );
    const posture: CloudDataStoreRead["posture"] = storeNamed(
      result,
      "acme-cosmos",
    ).posture;

    expect(posture.publicNetworkAccess).toBe(true);
    expect(posture.openToAllAddresses).toBe(true);
    expect(posture.sharedKeyAccess).toBe(true);
    expect(posture.pointInTimeRecovery).toBe(true);
    expect(posture.backupRetentionDays).toBe(7);
    expect(posture.replicationRegions).toEqual(["northeurope"]);
    expect(posture.customerManagedKey).toBe(true);
    expect(posture.minimumTlsVersion).toBe("1.2");
  });

  test("its own data roles and the roles that reach it through its keys are its access entries", async () => {
    const result: CloudDataSecurityReadResult = await readAll(
      createFakeAzure(FULL_OPTIONS),
    );
    const cosmos: CloudDataStoreRead = storeNamed(result, "acme-cosmos");

    expect(entriesOf(cosmos, COSMOS_APP)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          accessLevel: DataStoreAccessLevel.Write,
          grantedVia:
            "Role assignment: DocumentDB Account Contributor, through the account keys",
          principalType: DataStorePrincipalType.ServicePrincipal,
        }),
        expect.objectContaining({
          accessLevel: DataStoreAccessLevel.Write,
          grantedVia:
            "Cosmos DB data role: Cosmos DB Built-in Data Contributor (on dbs/orders)",
        }),
      ]),
    );
    expect(entriesOf(cosmos, COSMOS_READER)).toEqual([
      expect.objectContaining({
        accessLevel: DataStoreAccessLevel.Read,
        grantedVia: "Cosmos DB data role: Cosmos DB Built-in Data Reader",
        // Known from its Azure role assignment.
        principalType: DataStorePrincipalType.ServicePrincipal,
      }),
    ]);
    // A storage role reaches no Cosmos DB account.
    expect(entriesOf(cosmos, USER_ALICE)).toEqual([]);
  });

  test("only virtual networks, or public access off, keep it off the internet; local auth off is no key access", async () => {
    const result: CloudDataSecurityReadResult = await readAll(
      createFakeAzure({
        ...FULL_OPTIONS,
        rows: [
          row(`${COSMOS}-vnet`, "microsoft.documentdb/databaseaccounts", {
            kind: "GlobalDocumentDB",
            publicNetworkAccess: "Enabled",
            ipRules: [],
            isVirtualNetworkFilterEnabled: true,
            disableLocalAuth: true,
            backupPolicy: {
              type: "Periodic",
              periodicModeProperties: { backupRetentionIntervalInHours: 48 },
            },
            locations: [{ locationName: "West Europe" }],
          }),
          row(`${COSMOS}-ips`, "microsoft.documentdb/databaseaccounts", {
            kind: "MongoDB",
            publicNetworkAccess: "Enabled",
            ipRules: [{ ipAddressOrRange: "203.0.113.7" }],
            isVirtualNetworkFilterEnabled: false,
          }),
        ],
      }),
    );
    const vnet: CloudDataStoreRead["posture"] = storeNamed(
      result,
      "acme-cosmos-vnet",
    ).posture;
    const ips: CloudDataStoreRead["posture"] = storeNamed(
      result,
      "acme-cosmos-ips",
    ).posture;

    expect(vnet.publicNetworkAccess).toBe(false);
    expect(vnet.openToAllAddresses).toBe(false);
    expect(vnet.sharedKeyAccess).toBe(false);
    expect(vnet.pointInTimeRecovery).toBe(false);
    expect(vnet.backupRetentionDays).toBe(2);
    expect(vnet.replicationRegions).toEqual([]);
    expect(ips.publicNetworkAccess).toBe(true);
    expect(ips.openToAllAddresses).toBe(false);
  });
});

describe("PostgreSQL and MySQL flexible servers", () => {
  test("public access, a firewall open to every address, backup retention and a customer key", async () => {
    const result: CloudDataSecurityReadResult = await readAll(
      createFakeAzure(FULL_OPTIONS),
    );
    const postgres: CloudDataStoreRead = storeNamed(result, "pg-orders");

    expect(postgres.posture).toEqual(
      expect.objectContaining({
        publicNetworkAccess: true,
        openToAllAddresses: true,
        backupRetentionDays: 14,
        customerManagedKey: true,
      }),
    );
    expect(postgres.access).toEqual([
      expect.objectContaining({
        principal: "pgadmin",
        accessLevel: DataStoreAccessLevel.Admin,
        grantedVia: "Administrator login",
      }),
    ]);
  });

  test("public access off needs no firewall read; Microsoft's own key is no customer key", async () => {
    const api: FakeProviderApi = createFakeAzure(FULL_OPTIONS);
    const result: CloudDataSecurityReadResult = await readAll(api);

    expect(storeNamed(result, "mysql-shop").posture).toEqual(
      expect.objectContaining({
        publicNetworkAccess: false,
        openToAllAddresses: false,
        backupRetentionDays: 7,
        customerManagedKey: false,
      }),
    );
    expect(requestsEndingWith(api, "mysql-shop/firewallRules")).toHaveLength(0);
  });
});

describe("what Azure refuses", () => {
  const REFUSED: FakeResponse = {
    status: 403,
    body: {
      error: {
        code: "AuthorizationFailed",
        message:
          "The client does not have authorization to perform action over scope.",
      },
    },
  };

  test("refused containers leave anonymous access unknown for every account, said once", async () => {
    const result: CloudDataSecurityReadResult = await readAll(
      createFakeAzure({ ...FULL_OPTIONS, errors: { containers: REFUSED } }),
    );

    expect(storeNamed(result, "acmepublic").posture.publicRead).toBeNull();
    expect(storeNamed(result, "acmeselected").posture.publicRead).toBeNull();
    // Turned off on the account itself: known without its containers.
    expect(storeNamed(result, "acmelocked").posture.publicRead).toBe(false);
    expect(storeNamed(result, "acmepublic").posture.readWarnings).toEqual([
      "Could not read its blob containers.",
    ]);

    const warnings: Array<string> = result.warnings.filter(
      (warning: string): boolean => {
        return warning.includes("blob containers");
      },
    );

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("acmepublic");
    expect(warnings[0]).toContain("acmeselected");
    expect(warnings[0]).toContain(
      "Microsoft.Storage/storageAccounts/blobServices/containers/read",
    );
  });

  test("every refused API is null facts and one warning each; the rest of the read goes on", async () => {
    const result: CloudDataSecurityReadResult = await readAll(
      createFakeAzure({
        ...FULL_OPTIONS,
        errors: {
          "blob-service": REFUSED,
          encryption: REFUSED,
          firewall: REFUSED,
          "cosmos-roles": REFUSED,
          "role-assignments": REFUSED,
        },
      }),
    );

    expect(storeNamed(result, "acmepublic").posture.softDelete).toBeNull();
    expect(storeNamed(result, "acmepublic").posture.versioning).toBeNull();
    expect(
      storeNamed(result, "sql-open/orders").posture.encryptedAtRest,
    ).toBeNull();
    expect(
      storeNamed(result, "sql-open/orders").posture.openToAllAddresses,
    ).toBeNull();
    expect(
      storeNamed(result, "pg-orders").posture.openToAllAddresses,
    ).toBeNull();
    // What the listing says is still said.
    expect(storeNamed(result, "acmepublic").posture.publicRead).toBe(true);
    expect(storeNamed(result, "acmepublic").posture.customerManagedKey).toBe(
      true,
    );
    // Without role assignments, only what the store itself says reaches it.
    expect(entriesOf(storeNamed(result, "acmepublic"), USER_ALICE)).toEqual([]);
    expect(storeNamed(result, "acmepublic").posture.readWarnings).toEqual(
      expect.arrayContaining(["Could not read its role assignments."]),
    );

    for (const what of [
      "blob soft delete and versioning",
      "transparent data encryption",
      "SQL server firewall rules",
      "PostgreSQL firewall rules",
      "Cosmos DB data role assignments",
      "role assignments of subscription",
    ]) {
      expect(
        result.warnings.filter((warning: string): boolean => {
          return warning.includes(`The app may not read the ${what}`);
        }),
      ).toHaveLength(1);
    }

    expect(result.stores).toHaveLength(8);
  });

  test("a refused Resource Graph query lists nothing, says so and is not complete", async () => {
    const result: CloudDataSecurityReadResult = await readAll(
      createFakeAzure({
        ...FULL_OPTIONS,
        errors: { "resource-graph": REFUSED },
      }),
    );

    expect(result.stores).toEqual([]);
    expect(result.complete).toBe(false);
    expect(result.warnings).toEqual([
      `The app may not read the data stores of subscription ${SUB_A}: give it a role with Microsoft.ResourceGraph/resources/read.`,
    ]);
  });

  test("a refused sign-in is thrown, not a warning", async () => {
    const failure: unknown = await readAll(
      createFakeAzure({
        ...FULL_OPTIONS,
        tokenError: {
          status: 401,
          body: {
            error: "invalid_client",
            error_description: "AADSTS7000215: Invalid client secret provided.",
          },
        },
      }),
    ).catch((error: unknown) => {
      return error;
    });

    expect(failure).toBeInstanceOf(LlmProviderError);
    expect((failure as LlmProviderError).kind).toBe(
      CloudConnectionFailureKind.Authentication,
    );
  });

  test("an expired client secret is said as what it is", async () => {
    const failure: unknown = await readAll(
      createFakeAzure({
        ...FULL_OPTIONS,
        tokenError: {
          status: 401,
          body: {
            error: "invalid_client",
            error_description:
              "AADSTS7000222: The provided client secret keys are expired.",
          },
        },
      }),
    ).catch((error: unknown) => {
      return error;
    });

    expect((failure as LlmProviderError).message).toContain(
      "client secret has expired",
    );
  });

  test("a read that reaches its limit stops where it is and is not complete", async () => {
    const result: CloudDataSecurityReadResult = await readAll(
      createFakeAzure(FULL_OPTIONS),
      { budget: new CloudReadBudget({ maxRequests: 3, maxDurationMs: 60000 }) },
    );

    expect(result.complete).toBe(false);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        "This read reached its limit: the settings it did not get to are read next time.",
      ]),
    );
    expect(result.stores.length).toBeGreaterThan(0);
  });
});

describe("TLS versions", () => {
  test("every Azure spelling is one shape", () => {
    expect(normalizeAzureTlsVersion("TLS1_2")).toBe("1.2");
    expect(normalizeAzureTlsVersion("Tls12")).toBe("1.2");
    expect(normalizeAzureTlsVersion("Tls11")).toBe("1.1");
    expect(normalizeAzureTlsVersion("Tls")).toBe("1.0");
    expect(normalizeAzureTlsVersion("1.3")).toBe("1.3");
    expect(normalizeAzureTlsVersion("None")).toBe("None");
  });
});

describe("the Blob service's data plane", () => {
  const BLOB_HOST: string = "acmepublic.blob.core.windows.net";
  const LIST_PAGE: string = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<EnumerationResults ServiceEndpoint="https://acmepublic.blob.core.windows.net/" ContainerName="exports">',
    "<Prefix>2026/</Prefix><MaxResults>2</MaxResults>",
    "<Blobs>",
    "<Blob><Name>2026/users &amp; orders.csv</Name><Properties><Last-Modified>Wed, 21 Oct 2026 10:00:00 GMT</Last-Modified><Etag>0x8DBD1</Etag><Content-Length>2048</Content-Length><BlobType>BlockBlob</BlobType></Properties><Metadata /></Blob>",
    '<Blob><Name Encoded="true">2026/%3Cweird%3E.json</Name><Properties><Content-Length>0</Content-Length></Properties></Blob>',
    "<BlobPrefix><Name>2026/archive/</Name></BlobPrefix>",
    "<Blob><Name>2026/folder</Name><Properties><Content-Length>0</Content-Length><ResourceType>directory</ResourceType></Properties></Blob>",
    "</Blobs>",
    "<NextMarker>2!72!MDAwMDE2</NextMarker>",
    "</EnumerationResults>",
  ].join("");

  function blobApi(
    respond: (request: DataSourceHttpRequest, url: URL) => FakeResponse,
    host: string = BLOB_HOST,
  ): FakeProviderApi {
    return createFakeAzure({
      cloud: host.endsWith(".usgovcloudapi.net") ? "usgov" : "public",
      blobRoutes: [{ host, path: /^\//, respond }],
    });
  }

  function reader(
    api: FakeProviderApi,
    data: { accountName?: string; containerName?: string; cloud?: string } = {},
  ): ObjectStoreReader {
    return createAzureBlobObjectStoreReader(
      settings(data.cloud ? { cloud: data.cloud } : {}),
      {
        connectionId: "22222222-2222-4222-8222-222222222222",
        accountName: data.accountName || "acmepublic",
        containerName: data.containerName || "exports",
        transport: api.transport,
      },
    );
  }

  test("List Blobs: a page of names, sizes and dates, signed in for Azure Storage, on the account's own host", async () => {
    const api: FakeProviderApi = blobApi((): FakeResponse => {
      return { body: LIST_PAGE };
    });
    const store: ObjectStoreReader = reader(api);
    const page: ObjectStoreListPage = await store.listObjects({
      prefix: "2026/",
      maxKeys: 2,
    });

    expect(store.description).toBe(
      "https://acmepublic.blob.core.windows.net/exports",
    );
    expect(page.objects).toEqual([
      {
        key: "2026/users & orders.csv",
        sizeInBytes: 2048,
        lastModified: new Date("2026-10-21T10:00:00Z"),
        etag: "0x8DBD1",
      },
      {
        key: "2026/<weird>.json",
        sizeInBytes: 0,
        lastModified: undefined,
        etag: undefined,
      },
    ]);
    expect(page.nextToken).toBe("2!72!MDAwMDE2");

    const listing: DataSourceHttpRequest = api.requests.find(
      (request: DataSourceHttpRequest): boolean => {
        return new URL(request.url).host === BLOB_HOST;
      },
    )!;
    const url: URL = new URL(listing.url);

    expect(url.pathname).toBe("/exports");
    expect(url.searchParams.get("restype")).toBe("container");
    expect(url.searchParams.get("comp")).toBe("list");
    expect(url.searchParams.get("prefix")).toBe("2026/");
    expect(url.searchParams.get("maxresults")).toBe("2");
    expect(url.searchParams.has("marker")).toBe(false);
    expect(listing.headers?.["Authorization"]).toBe(`Bearer ${STORAGE_TOKEN}`);
    expect(listing.headers?.["x-ms-version"]).toBeTruthy();

    // The token was asked for Azure Storage's scope.
    const token: DataSourceHttpRequest = api.requestsTo(
      `/${TENANT}/oauth2/v2.0/token`,
    )[0]!;
    expect((token.body as Dictionary<string>)["scope"]).toBe(
      "https://storage.azure.com/.default",
    );
  });

  test("the next page carries the marker", async () => {
    const api: FakeProviderApi = blobApi((): FakeResponse => {
      return { body: LIST_PAGE };
    });
    await reader(api).listObjects({
      nextToken: "2!72!MDAwMDE2",
      maxKeys: 50000,
    });

    const url: URL = new URL(
      api.requests.find((request: DataSourceHttpRequest): boolean => {
        return new URL(request.url).host === BLOB_HOST;
      })!.url,
    );

    expect(url.searchParams.get("marker")).toBe("2!72!MDAwMDE2");
    // The service's own page limit.
    expect(url.searchParams.get("maxresults")).toBe("5000");
  });

  test("Get Blob asks for a range, never the whole blob, with each name segment encoded", async () => {
    const api: FakeProviderApi = blobApi((): FakeResponse => {
      // A server that sends more than asked is held to the range.
      return { body: "id,email\n1,ada@example.com\n2,grace@example.com\n" };
    });
    const bytes: Uint8Array = await reader(api).readObjectStart(
      "2026/users & orders.csv",
      10,
    );
    const read: DataSourceHttpRequest = api.requests.find(
      (request: DataSourceHttpRequest): boolean => {
        return new URL(request.url).host === BLOB_HOST;
      },
    )!;

    expect(new URL(read.url).pathname).toBe(
      "/exports/2026/users%20%26%20orders.csv",
    );
    expect(read.headers?.["x-ms-range"]).toBe("bytes=0-9");
    // This fake keeps no bytes: the read falls back to its text's UTF-8.
    expect(read.keepBodyBytes).toBe(true);
    expect(Buffer.from(bytes).toString("utf8")).toBe("id,email\n1");
  });

  test("a gzip comes back byte for byte when the transport keeps its bytes, held to the range; listings stay text", async () => {
    const gzip: Buffer = gzipSync(
      Buffer.from("id,email\n1,ada@example.com\n".repeat(20), "utf8"),
    );
    // Not text: decoded and encoded again, these would be other bytes.
    expect(Buffer.from(gzip.toString("utf8"), "utf8").equals(gzip)).toBe(false);

    const api: FakeProviderApi = blobApi((): FakeResponse => {
      return { body: LIST_PAGE };
    });
    const reads: Array<DataSourceHttpRequest> = [];
    const transport: CloudConnectorTransport = async (
      request: DataSourceHttpRequest,
    ): Promise<DataSourceHttpResponse> => {
      if (new URL(request.url).pathname.startsWith("/exports/")) {
        reads.push(request);

        return {
          statusCode: 206,
          bodyText: gzip.toString("utf8"),
          bodyBytes: gzip,
          bodyJson: undefined,
          headers: {},
        };
      }

      return await api.transport(request);
    };
    const store: ObjectStoreReader = createAzureBlobObjectStoreReader(
      settings(),
      {
        connectionId: "22222222-2222-4222-8222-222222222222",
        accountName: "acmepublic",
        containerName: "exports",
        transport,
      },
    );

    const whole: Uint8Array = await store.readObjectStart(
      "2026/users.csv.gz",
      gzip.length,
    );
    const start: Uint8Array = await store.readObjectStart(
      "2026/users.csv.gz",
      10,
    );

    expect(Buffer.from(whole).equals(gzip)).toBe(true);
    expect(Buffer.from(start).equals(gzip.subarray(0, 10))).toBe(true);
    expect(
      reads.map((request: DataSourceHttpRequest): unknown => {
        return request.keepBodyBytes;
      }),
    ).toEqual([true, true]);

    await store.listObjects({ maxKeys: 10 });

    const listing: DataSourceHttpRequest = api.requests.find(
      (request: DataSourceHttpRequest): boolean => {
        return new URL(request.url).pathname === "/exports";
      },
    )!;
    expect(listing.keepBodyBytes).toBeUndefined();
  });

  test("an empty blob is no bytes; asking for none reads nothing", async () => {
    const api: FakeProviderApi = blobApi((): FakeResponse => {
      return {
        status: 416,
        body: "<Error><Code>InvalidRange</Code></Error>",
      };
    });

    expect((await reader(api).readObjectStart("empty.txt", 100)).length).toBe(
      0,
    );

    const before: number = api.requests.length;
    expect((await reader(api).readObjectStart("any.txt", 0)).length).toBe(0);
    expect(api.requests.length).toBe(before);
  });

  test("a refused read is thrown for the sampler to record", async () => {
    const api: FakeProviderApi = blobApi((): FakeResponse => {
      return {
        status: 403,
        body: "<Error><Code>AuthorizationPermissionMismatch</Code></Error>",
      };
    });
    const failure: unknown = await reader(api)
      .readObjectStart("a.csv", 10)
      .catch((error: unknown) => {
        return error;
      });

    expect(failure).toBeInstanceOf(LlmProviderError);
    expect((failure as LlmProviderError).kind).toBe(
      CloudConnectionFailureKind.Permission,
    );
  });

  test("hosts are built from a storage account's name alone: anything else is refused before a request", async () => {
    const api: FakeProviderApi = blobApi((): FakeResponse => {
      return { body: LIST_PAGE };
    });

    for (const accountName of [
      "evil.example.com",
      "acme.blob.core.windows.net",
      "acme/../x",
      "Acme",
      "ab",
      "acme?x=1",
    ]) {
      expect(() => {
        return reader(api, { accountName });
      }).toThrow(BadDataException);
    }

    for (const containerName of ["../other", "Exports", "a", "a--b", "x/y"]) {
      expect(() => {
        return reader(api, { containerName });
      }).toThrow(BadDataException);
    }

    // A dot segment would resolve to another container.
    await expect(
      reader(api).readObjectStart("../secrets/key.pem", 10),
    ).rejects.toThrow(BadDataException);
    await expect(
      listAzureBlobContainers(settings(), {
        connectionId: "x",
        accountName: "evil.example.com",
        transport: api.transport,
      }),
    ).rejects.toThrow(BadDataException);

    expect(api.requests).toHaveLength(0);
  });

  test("the service's own containers are names it reads", async () => {
    const api: FakeProviderApi = blobApi((): FakeResponse => {
      return { body: LIST_PAGE };
    });

    expect(reader(api, { containerName: "$web" }).description).toBe(
      "https://acmepublic.blob.core.windows.net/$web",
    );
  });

  test("the storage token goes to the cloud's blob hosts only", async () => {
    const api: FakeProviderApi = createFakeAzure();
    const arm: AzureArm = new AzureArm({
      tenantId: TENANT,
      clientId: CLIENT,
      clientSecret: SECRET,
      cloud: "public",
      transport: api.transport,
    });

    await expect(
      arm.getStorageText({
        url: "https://acmepublic.blob.core.windows.net.evil.example/x",
        step: "test",
      }),
    ).rejects.toThrow(BadDataException);
    await expect(
      arm.getStorageText({
        url: "https://management.azure.com/x",
        step: "test",
      }),
    ).rejects.toThrow(BadDataException);
    expect(api.requests).toHaveLength(0);
  });

  test("Azure Government: its own sign-in, management and storage hosts", async () => {
    const api: FakeProviderApi = blobApi((): FakeResponse => {
      return { body: LIST_PAGE };
    }, "acmepublic.blob.core.usgovcloudapi.net");
    const store: ObjectStoreReader = reader(api, { cloud: "usgov" });

    await store.listObjects({ maxKeys: 10 });

    expect(store.description).toBe(
      "https://acmepublic.blob.core.usgovcloudapi.net/exports",
    );
    expect(
      api.requests.map((request: DataSourceHttpRequest): string => {
        return new URL(request.url).host;
      }),
    ).toEqual([
      "login.microsoftonline.us",
      "acmepublic.blob.core.usgovcloudapi.net",
    ]);

    const government: FakeProviderApi = createFakeAzure({
      ...FULL_OPTIONS,
      cloud: "usgov",
    });
    const result: CloudDataSecurityReadResult = await readAll(government, {
      settings: settings({ cloud: "usgov" }),
    });

    expect(result.stores.length).toBe(8);
    expect(
      new Set(
        government.requests.map((request: DataSourceHttpRequest): string => {
          return new URL(request.url).host;
        }),
      ),
    ).toEqual(
      new Set(["login.microsoftonline.us", "management.usgovcloudapi.net"]),
    );
  });

  test("List Containers: every container's name, page by page", async () => {
    const pages: Array<string> = [
      "<EnumerationResults><Containers><Container><Name>exports</Name><Properties /></Container><Container><Name>$logs</Name></Container></Containers><NextMarker>page-2</NextMarker></EnumerationResults>",
      "<EnumerationResults><Containers><Container><Name>images</Name></Container></Containers><NextMarker /></EnumerationResults>",
    ];
    const api: FakeProviderApi = blobApi(
      (_request: DataSourceHttpRequest, url: URL): FakeResponse => {
        return {
          body:
            url.searchParams.get("marker") === "page-2" ? pages[1] : pages[0],
        };
      },
    );

    const names: Array<string> = await listAzureBlobContainers(settings(), {
      connectionId: "22222222-2222-4222-8222-222222222222",
      accountName: "acmepublic",
      transport: api.transport,
    });
    const listings: Array<URL> = api.requests
      .map((request: DataSourceHttpRequest): URL => {
        return new URL(request.url);
      })
      .filter((url: URL): boolean => {
        return url.host === BLOB_HOST;
      });

    expect(names).toEqual(["exports", "$logs", "images"]);
    expect(listings).toHaveLength(2);
    expect(listings[0]!.pathname).toBe("/");
    expect(listings[0]!.searchParams.get("comp")).toBe("list");
    expect(listings[1]!.searchParams.get("marker")).toBe("page-2");
  });
});
