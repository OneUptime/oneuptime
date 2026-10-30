import { normalizeCloudTags } from "../../../../../Types/Cloud/CloudInventory";
import { CloudConnectionFailureKind } from "../../../../../Types/CloudConnection/CloudConnectionTest";
import {
  DataStoreAccessEntry,
  DataStoreAccessLevel,
  DataStorePrincipalType,
  getDataStoreAccessKey,
} from "../../../../../Types/DataSecurity/DataStoreAccess";
import { DataStoreKind } from "../../../../../Types/DataSecurity/DataStoreKind";
import { DataStorePostureFacts } from "../../../../../Types/DataSecurity/DataStorePosture";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../Types/JSON";
import AzureArm, {
  AzureSubscription,
} from "../../../CloudConnection/Azure/AzureArm";
import AzureCloudConnector, {
  AZURE_MAX_SUBSCRIPTIONS,
  explainExpiredAzureSecret,
} from "../../../CloudConnection/Azure/AzureCloudConnector";
import {
  Settled,
  mapWithConcurrency,
} from "../../../CloudConnection/CloudConcurrency";
import {
  CloudConnectionSettings,
  CloudConnectorTransport,
  CloudReadBudget,
  CloudReadBudgetSpent,
  readCloudSetting,
} from "../../../CloudConnection/CloudConnectorTypes";
import DataSourceHttpFetch from "../../../DataSource/HttpFetch";
import AzureMonitorClient from "../../../LlmObservability/Connectors/AzureOpenAI/AzureMonitorClient";
import EntraTokenClient from "../../../LlmObservability/Connectors/Microsoft/EntraTokenClient";
import LlmProviderError from "../../../LlmObservability/LlmProviderError";
import {
  buildQueryString,
  readArray,
  readObject,
  readText,
} from "../../../LlmObservability/LlmProviderHttp";
import {
  CloudDataSecurityReadResult,
  CloudDataStoreRead,
  ObjectStoreListPage,
  ObjectStoreObject,
  ObjectStoreReader,
} from "../DataSecurityCloudTypes";

/*
 * MICROSOFT AZURE'S DATA STORES, FOR DATA SECURITY.
 *
 * Every storage account, SQL database, Cosmos DB account and PostgreSQL or
 * MySQL flexible server of the connection's subscriptions, read as the app
 * registration the connection signs in as:
 *
 *   1. One Resource Graph query of its own (AZURE_DATA_SECURITY_QUERY)
 *      lists the stores with the settings that decide their safety -
 *      anonymous blob access, network rules, TLS, keys, encryption,
 *      redundancy, backups - projected field by field, so nothing else a
 *      resource holds (a connection string, a key) leaves Azure.
 *   2. Resource Manager is asked, per store, what the listing does not
 *      hold: a storage account's blob containers (which may be anonymous)
 *      and its blob service (soft delete, versioning); a SQL server's
 *      firewall rules and each database's transparent data encryption; a
 *      flexible server's firewall rules; a Cosmos DB account's data role
 *      assignments.
 *   3. Each subscription's role assignments, once: the data roles among
 *      them (Storage Blob Data Reader and the rest, the roles that reach
 *      data through an account's keys) become access entries of every store
 *      their scope covers - at the store, inherited from a resource group,
 *      the subscription or a management group, or on a part of it.
 *
 * Monitoring Reader may make every one of these calls: each is a read
 * action its wildcard read permission covers. What Azure refuses leaves
 * the facts it would have given null and is said once per API, never once
 * per store; a refused sign-in stops the read.
 *
 * A storage account is one store. Its containers are what the content
 * scanner reads, on the Blob service's data plane (listAzureBlobContainers,
 * createAzureBlobObjectStoreReader), which needs a data role - Storage
 * Blob Data Reader - besides.
 */

const CONCURRENCY: number = 8;

// The resource types read, lowercased as Resource Graph compares them.
const STORAGE_TYPE: string = "microsoft.storage/storageaccounts";
const SQL_SERVER_TYPE: string = "microsoft.sql/servers";
const SQL_DATABASE_TYPE: string = "microsoft.sql/servers/databases";
const COSMOS_TYPE: string = "microsoft.documentdb/databaseaccounts";
const POSTGRES_TYPE: string = "microsoft.dbforpostgresql/flexibleservers";
const MYSQL_TYPE: string = "microsoft.dbformysql/flexibleservers";

export const AZURE_DATA_SECURITY_TYPES: ReadonlyArray<string> = [
  STORAGE_TYPE,
  SQL_SERVER_TYPE,
  SQL_DATABASE_TYPE,
  COSMOS_TYPE,
  POSTGRES_TYPE,
  MYSQL_TYPE,
];

const STORAGE_API_VERSION: string = "2023-05-01";
const SQL_API_VERSION: string = "2021-11-01";
const POSTGRES_API_VERSION: string = "2022-12-01";
const MYSQL_API_VERSION: string = "2022-01-01";
const COSMOS_API_VERSION: string = "2024-05-15";
const ROLE_ASSIGNMENTS_API_VERSION: string = "2022-04-01";

// Stores whose details (containers, firewall rules, encryption) one read asks for at most.
export const AZURE_MAX_DETAILED_STORES: number = 1000;
// Access entries one store keeps at most.
const MAX_ACCESS_ENTRIES: number = 500;
// Anonymous containers a store's reason names, and keeps an entry for.
const MAX_NAMED_CONTAINERS: number = 10;
const MAX_PUBLIC_CONTAINER_ENTRIES: number = 20;
// Places a warning names before "and N more".
const MAX_WARNING_PLACES: number = 5;
// A List Blobs or List Containers page at most: the Blob service's own limit.
const BLOB_LIST_MAX_RESULTS: number = 5000;
const CONTAINER_LIST_MAX_PAGES: number = 10;
// Elements read out of one XML answer at most.
const MAX_XML_ELEMENTS: number = 10000;
// An XML entity's name is short: "&amp;", "&#x1F600;".
const MAX_XML_ENTITY_LENGTH: number = 10;
// Azure caps a blob's name at 1,024 characters.
const MAX_BLOB_NAME_LENGTH: number = 1024;

// A storage account's name: 3 to 24 lowercase letters and digits, all a host is built from.
const STORAGE_ACCOUNT_NAME_REGEX: RegExp = /^[a-z0-9]{3,24}$/;
/*
 * A container's name: 3 to 63 lowercase letters, digits and single inner
 * hyphens - or one of the service's own, $root, $web and $logs.
 */
const CONTAINER_NAME_REGEX: RegExp =
  /^(?:[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){2,62}|\$root|\$web|\$logs)$/;
const GUID_REGEX: RegExp =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
// "TLS1_2", "Tls12", "1.2": the major and minor digits.
const TLS_DIGITS_REGEX: RegExp = /([0-9])[._]?([0-9])/;

// The storage SKUs that copy an account's data to its paired region.
const GEO_REDUNDANT_SKUS: ReadonlySet<string> = new Set<string>([
  "standard_grs",
  "standard_ragrs",
  "standard_gzrs",
  "standard_ragzrs",
]);

/*
 * The query. Each field is projected by name, so the listing holds the
 * settings read and nothing else; the system database of every SQL server
 * (master) is no store of anyone's.
 */
export const AZURE_DATA_SECURITY_QUERY: string = [
  "Resources",
  `| where type in~ (${AZURE_DATA_SECURITY_TYPES.map((type: string): string => {
    return `'${type}'`;
  }).join(", ")})`,
  "| where not(type =~ 'microsoft.sql/servers/databases' and name =~ 'master')",
  "| project id, name, type, location, resourceGroup, subscriptionId, tenantId, tags, kind,",
  "  skuName = tostring(sku.name),",
  "  publicNetworkAccess = tostring(properties.publicNetworkAccess),",
  "  serverPublicNetworkAccess = tostring(properties.network.publicNetworkAccess),",
  "  allowBlobPublicAccess = properties.allowBlobPublicAccess,",
  "  allowSharedKeyAccess = properties.allowSharedKeyAccess,",
  "  supportsHttpsTrafficOnly = properties.supportsHttpsTrafficOnly,",
  "  minimumTlsVersion = tostring(properties.minimumTlsVersion),",
  "  minimalTlsVersion = tostring(properties.minimalTlsVersion),",
  "  networkAcls = properties.networkAcls,",
  "  encryptionKeySource = tostring(properties.encryption.keySource),",
  "  blobEncryptionEnabled = properties.encryption.services.blob.enabled,",
  "  secondaryLocation = tostring(properties.secondaryLocation),",
  "  privateEndpointConnections = properties.privateEndpointConnections,",
  "  administratorLogin = tostring(properties.administratorLogin),",
  "  administrators = properties.administrators,",
  "  passwordAuth = tostring(properties.authConfig.passwordAuth),",
  "  ipRules = properties.ipRules,",
  "  isVirtualNetworkFilterEnabled = properties.isVirtualNetworkFilterEnabled,",
  "  disableLocalAuth = properties.disableLocalAuth,",
  "  capabilities = properties.capabilities,",
  "  backupPolicy = properties.backupPolicy,",
  "  locations = properties.locations,",
  "  keyVaultKeyUri = tostring(properties.keyVaultKeyUri),",
  "  backupRetentionDays = properties.backup.backupRetentionDays,",
  "  dataEncryptionType = tostring(properties.dataEncryption.type)",
].join("\n");

/*
 * The built-in roles that reach a store's data, by their ids - the same in
 * every subscription and cloud. Roles that only manage a resource (Owner,
 * Contributor, SQL DB Contributor) are left out; the roles that may list
 * an account's keys reach its data through them, so they count only while
 * the account takes its keys.
 */
interface AzureDataRole {
  name: string;
  level: DataStoreAccessLevel;
  kind: DataStoreKind;
  throughKeys: boolean;
}

function dataRole(
  name: string,
  level: DataStoreAccessLevel,
  kind: DataStoreKind,
  throughKeys: boolean = false,
): AzureDataRole {
  return { name, level, kind, throughKeys };
}

const READ: DataStoreAccessLevel = DataStoreAccessLevel.Read;
const WRITE: DataStoreAccessLevel = DataStoreAccessLevel.Write;
const ADMIN: DataStoreAccessLevel = DataStoreAccessLevel.Admin;
const STORAGE: DataStoreKind = DataStoreKind.AzureStorageAccount;
const COSMOS: DataStoreKind = DataStoreKind.AzureCosmosDbAccount;

const AZURE_DATA_ROLES: ReadonlyMap<string, AzureDataRole> = new Map<
  string,
  AzureDataRole
>([
  [
    "2a2b9908-6ea1-4ae2-8e65-a410df84e7d1",
    dataRole("Storage Blob Data Reader", READ, STORAGE),
  ],
  [
    "ba92f5b4-2d11-453d-a403-e96b0029c9fe",
    dataRole("Storage Blob Data Contributor", WRITE, STORAGE),
  ],
  [
    "b7e6dc6d-f1e8-4753-8033-0f276bb0955b",
    dataRole("Storage Blob Data Owner", ADMIN, STORAGE),
  ],
  [
    "19e7f393-937e-4f77-808e-94535e297925",
    dataRole("Storage Queue Data Reader", READ, STORAGE),
  ],
  [
    "974c5e8b-45b9-4653-ba55-5f855dd0fb88",
    dataRole("Storage Queue Data Contributor", WRITE, STORAGE),
  ],
  [
    "76199698-9eea-4c19-bc75-cec21354c6b6",
    dataRole("Storage Table Data Reader", READ, STORAGE),
  ],
  [
    "0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3",
    dataRole("Storage Table Data Contributor", WRITE, STORAGE),
  ],
  [
    "aba4ae5f-2193-4029-9191-0cb91df5e314",
    dataRole("Storage File Data SMB Share Reader", READ, STORAGE),
  ],
  [
    "0c867c2a-1d8c-454a-a3db-ab2ea1bdc8bb",
    dataRole("Storage File Data SMB Share Contributor", WRITE, STORAGE),
  ],
  [
    "a7264617-510b-434b-a828-9731dc254ea7",
    dataRole(
      "Storage File Data SMB Share Elevated Contributor",
      ADMIN,
      STORAGE,
    ),
  ],
  [
    "c12c1c16-33a1-487b-954d-41c89c60f349",
    dataRole("Reader and Data Access", WRITE, STORAGE, true),
  ],
  [
    "81a9662b-bebf-436f-a333-f67b29880f12",
    dataRole("Storage Account Key Operator Service Role", WRITE, STORAGE, true),
  ],
  [
    "17d1049b-9a84-46fb-8f53-869881c3d3ab",
    dataRole("Storage Account Contributor", WRITE, STORAGE, true),
  ],
  [
    "5bd9cd88-fe45-4216-938b-f97437e15450",
    dataRole("DocumentDB Account Contributor", WRITE, COSMOS, true),
  ],
  [
    "fbdf93bf-df7d-467e-a4d2-9458aa1360c8",
    dataRole("Cosmos DB Account Reader Role", READ, COSMOS, true),
  ],
]);

// Cosmos DB's own built-in data roles (sqlRoleDefinitions), by id.
const COSMOS_DATA_ROLES: ReadonlyMap<
  string,
  { name: string; level: DataStoreAccessLevel }
> = new Map<string, { name: string; level: DataStoreAccessLevel }>([
  [
    "00000000-0000-0000-0000-000000000001",
    { name: "Cosmos DB Built-in Data Reader", level: READ },
  ],
  [
    "00000000-0000-0000-0000-000000000002",
    { name: "Cosmos DB Built-in Data Contributor", level: WRITE },
  ],
]);

// A Cosmos DB account with one of these speaks an API without Cosmos DB's own data roles.
const COSMOS_NON_SQL_CAPABILITIES: ReadonlySet<string> = new Set<string>([
  "enablecassandra",
  "enablegremlin",
  "enablemongo",
  "enabletable",
]);

// One kind of call, for its warning: what it reads and the permission it needs.
interface AzureReadApi {
  key: string;
  what: string;
  permission: string;
}

const SUBSCRIPTIONS_API: AzureReadApi = {
  key: "subscriptions",
  what: "subscriptions",
  permission: "Microsoft.Resources/subscriptions/read",
};
const RESOURCE_GRAPH_API: AzureReadApi = {
  key: "resource-graph",
  what: "data stores",
  permission: "Microsoft.ResourceGraph/resources/read",
};
const CONTAINERS_API: AzureReadApi = {
  key: "containers",
  what: "blob containers",
  permission: "Microsoft.Storage/storageAccounts/blobServices/containers/read",
};
const BLOB_SERVICE_API: AzureReadApi = {
  key: "blob-service",
  what: "blob soft delete and versioning",
  permission: "Microsoft.Storage/storageAccounts/blobServices/read",
};
const SQL_FIREWALL_API: AzureReadApi = {
  key: "sql-firewall",
  what: "SQL server firewall rules",
  permission: "Microsoft.Sql/servers/firewallRules/read",
};
const SQL_ENCRYPTION_API: AzureReadApi = {
  key: "sql-encryption",
  what: "transparent data encryption",
  permission: "Microsoft.Sql/servers/databases/transparentDataEncryption/read",
};
const POSTGRES_FIREWALL_API: AzureReadApi = {
  key: "postgres-firewall",
  what: "PostgreSQL firewall rules",
  permission: "Microsoft.DBforPostgreSQL/flexibleServers/firewallRules/read",
};
const MYSQL_FIREWALL_API: AzureReadApi = {
  key: "mysql-firewall",
  what: "MySQL firewall rules",
  permission: "Microsoft.DBforMySQL/flexibleServers/firewallRules/read",
};
const COSMOS_ROLES_API: AzureReadApi = {
  key: "cosmos-roles",
  what: "Cosmos DB data role assignments",
  permission: "Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments/read",
};
const ROLE_ASSIGNMENTS_API: AzureReadApi = {
  key: "role-assignments",
  what: "role assignments",
  permission: "Microsoft.Authorization/roleAssignments/read",
};

export interface AzureDataSecurityReadOptions {
  // The OneUptime project the connection belongs to.
  projectId: string;
  connectionId: string;
  /*
   * Every subscription the project has connected. A store reachable from a
   * subscription outside them (a private endpoint, a resource instance
   * rule) is shared with it.
   */
  connectedSubscriptionIds: Array<string>;
  transport?: CloudConnectorTransport | undefined;
  // The clock, or the time itself; the system clock when absent.
  now?: (() => Date) | Date | undefined;
  budget?: CloudReadBudget | undefined;
}

interface AzureContainer {
  name: string;
  publicAccess: string;
}

interface AzureRoleAssignment {
  roleId: string;
  principalId: string;
  principalType: string;
  // The scope as Azure writes it, and lowercased for comparing.
  scope: string;
  scopeKey: string;
}

interface AzureCosmosRoleAssignment {
  roleId: string;
  principalId: string;
  scope: string;
}

// One store while it is read: its row, and what the calls after the listing found.
interface AzureStoreDraft {
  type: string;
  row: JSONObject;
  armId: string;
  idKey: string;
  subscriptionId: string;
  read: CloudDataStoreRead;
  // A SQL database's server, whose settings are the database's.
  server?: JSONObject | undefined;
  serverKey?: string | undefined;
  // Undefined until read; null when Azure would not say.
  containers?: Array<AzureContainer> | null | undefined;
  cosmosRoles?: Array<AzureCosmosRoleAssignment> | null | undefined;
}

type Attempted<T> =
  | { ok: true; value: T }
  | { ok: false; budgetSpent: boolean };

function text(value: unknown): string {
  return readText(value);
}

function lower(value: string): string {
  return value.toLowerCase();
}

// A boolean as Resource Graph projects it (true, or "true"); null when it says nothing.
function flag(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }

  if (value === "true" || value === "True") {
    return true;
  }

  if (value === "false" || value === "False") {
    return false;
  }

  return null;
}

function numberOrNull(value: unknown): number | null {
  const parsed: number =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : NaN;

  return Number.isFinite(parsed) ? parsed : null;
}

function isGuid(value: string): boolean {
  return GUID_REGEX.test(value);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function unique(values: Array<string>): Array<string> {
  return Array.from(new Set(values));
}

function resolveNow(now: (() => Date) | Date | undefined): Date {
  if (typeof now === "function") {
    return now();
  }

  return now instanceof Date ? now : new Date();
}

function lastSegment(id: string): string {
  const parts: Array<string> = id.split("/").filter((part: string) => {
    return part.length > 0;
  });

  return parts[parts.length - 1] || "";
}

// The subscription an ARM id is in ("" when it names none).
function subscriptionOf(id: string): string {
  const parts: Array<string> = id.split("/").filter((part: string) => {
    return part.length > 0;
  });

  return parts.length >= 2 && lower(parts[0]!) === "subscriptions"
    ? parts[1]!
    : "";
}

/*
 * A TLS version in one shape: "TLS1_2", "Tls12" and "1.2" are "1.2", Cosmos
 * DB's "Tls" (TLS 1.0) is "1.0"; anything else - SQL's "None" - as written.
 */
export function normalizeAzureTlsVersion(value: string): string {
  const trimmed: string = value.trim();

  if (lower(trimmed) === "tls") {
    return "1.0";
  }

  const match: RegExpMatchArray | null = trimmed.match(TLS_DIGITS_REGEX);

  return match ? `${match[1]}.${match[2]}` : trimmed;
}

// "East US" (a Cosmos DB location's name) as the location Azure ids use: "eastus".
function normalizeLocation(value: string): string {
  return lower(value).split(" ").join("");
}

function isAllAddressesRange(start: string, end: string): boolean {
  return start.trim() === "0.0.0.0" && end.trim() === "255.255.255.255";
}

function isAllAddressesCidr(value: string): boolean {
  const trimmed: string = value.trim();
  return trimmed === "0.0.0.0/0" || trimmed === "::/0";
}

// "Enabled" and "Disabled" (or a network security perimeter's) as a fact.
function publicAccessSetting(value: string): boolean | null {
  const setting: string = lower(value);

  if (setting === "enabled") {
    return true;
  }

  if (setting === "disabled" || setting === "securedbyperimeter") {
    return false;
  }

  return null;
}

function addReadWarning(draft: AzureStoreDraft, warning: string): void {
  const warnings: Array<string> = draft.read.posture.readWarnings || [];

  if (!warnings.includes(warning)) {
    warnings.push(warning);
  }

  draft.read.posture.readWarnings = warnings;
}

function describePlaces(places: Array<string>): string {
  const named: string = places.slice(0, MAX_WARNING_PLACES).join(", ");
  const more: number = places.length - MAX_WARNING_PLACES;

  return more > 0 ? `${named} and ${more} more` : named;
}

function isAuthenticationFailure(error: unknown): boolean {
  return (
    error instanceof LlmProviderError &&
    error.kind === CloudConnectionFailureKind.Authentication
  );
}

/*
 * What could not be read, one entry per API: the places it failed for and
 * the first reason, so a refused permission is one warning however many
 * stores it cost.
 */
class AzureReadIssues {
  private byApi: Map<
    string,
    {
      api: AzureReadApi;
      places: Array<string>;
      refused: boolean;
      reason: string;
    }
  > = new Map();

  public budgetSpent: boolean = false;

  public record(api: AzureReadApi, place: string, error: unknown): void {
    const existing:
      | {
          api: AzureReadApi;
          places: Array<string>;
          refused: boolean;
          reason: string;
        }
      | undefined = this.byApi.get(api.key);

    if (existing) {
      if (!existing.places.includes(place)) {
        existing.places.push(place);
      }

      return;
    }

    this.byApi.set(api.key, {
      api,
      places: [place],
      refused:
        error instanceof LlmProviderError &&
        error.kind === CloudConnectionFailureKind.Permission,
      reason: errorText(error),
    });
  }

  public getWarnings(): Array<string> {
    return Array.from(this.byApi.values()).map(
      (entry: {
        api: AzureReadApi;
        places: Array<string>;
        refused: boolean;
        reason: string;
      }): string => {
        const places: string = describePlaces(entry.places);

        return entry.refused
          ? `The app may not read the ${entry.api.what} of ${places}: give it a role with ${entry.api.permission}.`
          : `Could not read the ${entry.api.what} of ${places}: ${entry.reason}`;
      },
    );
  }
}

/*
 * One call: its value, or - when Azure refused it, failed, or the budget
 * ran out - nothing, with the reason recorded. A refused sign-in is thrown:
 * no other call would get further.
 */
async function attempt<T>(data: {
  issues: AzureReadIssues;
  api: AzureReadApi;
  place: string;
  call: () => Promise<T>;
}): Promise<Attempted<T>> {
  try {
    const value: T = await data.call();
    return { ok: true, value };
  } catch (error) {
    if (error instanceof CloudReadBudgetSpent) {
      data.issues.budgetSpent = true;
      return { ok: false, budgetSpent: true };
    }

    if (isAuthenticationFailure(error)) {
      throw error;
    }

    data.issues.record(data.api, data.place, error);
    return { ok: false, budgetSpent: false };
  }
}

// A call about one store: what it could not read is said on the store too.
async function attemptFor<T>(data: {
  issues: AzureReadIssues;
  api: AzureReadApi;
  draft: AzureStoreDraft;
  call: () => Promise<T>;
}): Promise<Attempted<T>> {
  const result: Attempted<T> = await attempt({
    issues: data.issues,
    api: data.api,
    place: data.draft.read.identity.name,
    call: data.call,
  });

  if (!result.ok) {
    addReadWarning(
      data.draft,
      result.budgetSpent
        ? "Some of its settings were not read this time: the read reached its limit."
        : `Could not read its ${data.api.what}.`,
    );
  }

  return result;
}

function createAzureArm(
  settings: CloudConnectionSettings,
  options: {
    transport?: CloudConnectorTransport | undefined;
    budget?: CloudReadBudget | undefined;
  },
): AzureArm {
  return new AzureArm({
    tenantId: readCloudSetting(settings.config, "tenantId"),
    clientId: readCloudSetting(settings.config, "clientId"),
    clientSecret: readCloudSetting(settings.secrets, "clientSecret"),
    cloud: EntraTokenClient.resolveCloud(
      readCloudSetting(settings.config, "cloud") || "public",
    ),
    transport:
      options.transport || DataSourceHttpFetch.fetch.bind(DataSourceHttpFetch),
    budget: options.budget,
  });
}

function newStore(data: {
  kind: DataStoreKind;
  row: JSONObject;
  name: string;
  posture: DataStorePostureFacts;
}): CloudDataStoreRead {
  const tags: Record<string, string> = normalizeCloudTags(data.row["tags"]);

  return {
    identity: {
      kind: data.kind,
      name: data.name,
      providerResourceId: text(data.row["id"]),
      accountNumber:
        text(data.row["subscriptionId"]) ||
        subscriptionOf(text(data.row["id"])),
      region: text(data.row["location"]) || undefined,
    },
    posture: data.posture,
    access: [],
    tags: Object.keys(tags).length > 0 ? tags : undefined,
  };
}

function isFileStorage(row: JSONObject): boolean {
  return lower(text(row["kind"])) === "filestorage";
}

/*
 * A storage account's network exposure: off when public network access is
 * disabled; open to every address when its firewall allows by default (or
 * names 0.0.0.0/0); reachable from the internet when it denies by default
 * but lets some addresses in.
 */
function storageNetwork(row: JSONObject): {
  publicNetworkAccess: boolean;
  openToAllAddresses: boolean;
} {
  if (publicAccessSetting(text(row["publicNetworkAccess"])) === false) {
    return { publicNetworkAccess: false, openToAllAddresses: false };
  }

  const acls: JSONObject = readObject(row["networkAcls"]);

  if (lower(text(acls["defaultAction"])) !== "deny") {
    return { publicNetworkAccess: true, openToAllAddresses: true };
  }

  const ipRules: Array<string> = readArray(acls["ipRules"])
    .map((rule: unknown): string => {
      return text(readObject(rule)["value"]);
    })
    .filter((value: string): boolean => {
      return Boolean(value);
    });

  return {
    publicNetworkAccess: ipRules.length > 0,
    openToAllAddresses: ipRules.some(isAllAddressesCidr),
  };
}

/*
 * What a storage account's own settings say. Azure reads an unset
 * allowBlobPublicAccess as allowed, an unset allowSharedKeyAccess as
 * allowed, and an unset minimumTlsVersion as TLS 1.0. Anonymous access,
 * soft delete and versioning come from the calls after the listing.
 */
function storagePosture(
  row: JSONObject,
  readAt: string,
): DataStorePostureFacts {
  const network: { publicNetworkAccess: boolean; openToAllAddresses: boolean } =
    storageNetwork(row);
  const secondary: string = text(row["secondaryLocation"]);
  const fileStorage: boolean = isFileStorage(row);
  const posture: DataStorePostureFacts = {
    readAt,
    // A FileStorage account has no Blob service: nothing in it is anonymous.
    publicRead: fileStorage ? false : null,
    blockPublicAccess: flag(row["allowBlobPublicAccess"]) === false,
    publicNetworkAccess: network.publicNetworkAccess,
    openToAllAddresses: network.openToAllAddresses,
    // Azure Storage encrypts everything at rest; the account says with whose key.
    encryptedAtRest: flag(row["blobEncryptionEnabled"]) !== false,
    customerManagedKey:
      lower(text(row["encryptionKeySource"])) === "microsoft.keyvault",
    encryptionInTransitEnforced: flag(row["supportsHttpsTrafficOnly"]),
    minimumTlsVersion:
      normalizeAzureTlsVersion(text(row["minimumTlsVersion"])) || "1.0",
    sharedKeyAccess: flag(row["allowSharedKeyAccess"]) !== false,
    replicationRegions:
      GEO_REDUNDANT_SKUS.has(lower(text(row["skuName"]))) && secondary
        ? [secondary]
        : [],
  };

  if (!fileStorage) {
    posture.softDelete = null;
    posture.versioning = null;
  }

  return posture;
}

/*
 * A SQL database's network and TLS settings are its server's. Whether its
 * firewall lets every address in, and whether it is encrypted, are read
 * after the listing.
 */
function sqlDatabasePosture(
  server: JSONObject | undefined,
  readAt: string,
): DataStorePostureFacts {
  const access: boolean | null = server
    ? publicAccessSetting(text(server["publicNetworkAccess"]))
    : null;
  const tls: string = server ? text(server["minimalTlsVersion"]) : "";

  return {
    readAt,
    publicNetworkAccess: access,
    openToAllAddresses: access === false ? false : null,
    minimumTlsVersion: tls ? normalizeAzureTlsVersion(tls) : null,
    encryptedAtRest: null,
  };
}

// Days a Cosmos DB account's backups are kept, from its backup policy.
function cosmosBackupRetentionDays(policy: JSONObject): number | null {
  const type: string = lower(text(policy["type"]));

  if (type === "continuous") {
    const tier: string = lower(
      text(readObject(policy["continuousModeProperties"])["tier"]),
    );
    return tier === "continuous7days" ? 7 : 30;
  }

  if (type === "periodic") {
    const hours: number | null = numberOrNull(
      readObject(policy["periodicModeProperties"])[
        "backupRetentionIntervalInHours"
      ],
    );
    return hours === null ? null : Math.round((hours / 24) * 100) / 100;
  }

  return null;
}

/*
 * A Cosmos DB account: off the internet when public network access is
 * disabled, or when only virtual networks may reach it; open to every
 * address when it names no IP rule and filters no virtual network.
 */
function cosmosPosture(row: JSONObject, readAt: string): DataStorePostureFacts {
  const disabled: boolean =
    publicAccessSetting(text(row["publicNetworkAccess"])) === false;
  const ipRules: Array<string> = readArray(row["ipRules"])
    .map((rule: unknown): string => {
      return text(readObject(rule)["ipAddressOrRange"]);
    })
    .filter((value: string): boolean => {
      return Boolean(value);
    });
  const networkFiltered: boolean =
    flag(row["isVirtualNetworkFilterEnabled"]) === true;
  const policy: JSONObject = readObject(row["backupPolicy"]);
  const backupType: string = lower(text(policy["type"]));
  const location: string = normalizeLocation(text(row["location"]));
  const tls: string = text(row["minimalTlsVersion"]);
  const retention: number | null = cosmosBackupRetentionDays(policy);

  const posture: DataStorePostureFacts = {
    readAt,
    publicNetworkAccess: !disabled && (ipRules.length > 0 || !networkFiltered),
    openToAllAddresses:
      !disabled &&
      ((ipRules.length === 0 && !networkFiltered) ||
        ipRules.some(isAllAddressesCidr)),
    sharedKeyAccess: flag(row["disableLocalAuth"]) !== true,
    pointInTimeRecovery: backupType ? backupType === "continuous" : null,
    customerManagedKey: Boolean(text(row["keyVaultKeyUri"])),
    // Every region of the account holds a full copy: the others are where it is copied to.
    replicationRegions: unique(
      readArray(row["locations"])
        .map((raw: unknown): string => {
          return normalizeLocation(text(readObject(raw)["locationName"]));
        })
        .filter((region: string): boolean => {
          return Boolean(region) && region !== location;
        }),
    ),
  };

  if (retention !== null) {
    posture.backupRetentionDays = retention;
  }

  if (tls) {
    posture.minimumTlsVersion = normalizeAzureTlsVersion(tls);
  }

  return posture;
}

// A PostgreSQL or MySQL flexible server; its firewall is read after the listing.
function flexibleServerPosture(
  row: JSONObject,
  readAt: string,
): DataStorePostureFacts {
  const access: boolean | null = publicAccessSetting(
    text(row["serverPublicNetworkAccess"]),
  );

  return {
    readAt,
    publicNetworkAccess: access,
    openToAllAddresses: access === false ? false : null,
    backupRetentionDays: numberOrNull(row["backupRetentionDays"]),
    customerManagedKey:
      lower(text(row["dataEncryptionType"])) === "azurekeyvault",
  };
}

// The listing's rows as stores; a SQL server is its databases' settings, not a store.
function buildDrafts(
  rows: Array<JSONObject>,
  readAt: string,
): Array<AzureStoreDraft> {
  const servers: Map<string, JSONObject> = new Map();

  for (const row of rows) {
    if (lower(text(row["type"])) === SQL_SERVER_TYPE) {
      servers.set(lower(text(row["id"])), row);
    }
  }

  const drafts: Array<AzureStoreDraft> = [];

  for (const row of rows) {
    const draft: AzureStoreDraft | null = buildDraft(row, servers, readAt);

    if (draft) {
      drafts.push(draft);
    }
  }

  return drafts;
}

function buildDraft(
  row: JSONObject,
  servers: Map<string, JSONObject>,
  readAt: string,
): AzureStoreDraft | null {
  const armId: string = text(row["id"]);
  const type: string = lower(text(row["type"]));

  if (!armId) {
    return null;
  }

  const name: string = text(row["name"]) || lastSegment(armId);
  const base: {
    type: string;
    row: JSONObject;
    armId: string;
    idKey: string;
    subscriptionId: string;
  } = {
    type,
    row,
    armId,
    idKey: lower(armId),
    subscriptionId: text(row["subscriptionId"]) || subscriptionOf(armId),
  };

  switch (type) {
    case STORAGE_TYPE:
      return {
        ...base,
        read: newStore({
          kind: DataStoreKind.AzureStorageAccount,
          row,
          name,
          posture: storagePosture(row, readAt),
        }),
      };
    case SQL_DATABASE_TYPE: {
      const databaseName: string = lastSegment(armId);
      const serverIndex: number = lower(armId).lastIndexOf("/databases/");

      if (lower(databaseName) === "master" || serverIndex < 0) {
        return null;
      }

      const serverKey: string = lower(armId.slice(0, serverIndex));
      const server: JSONObject | undefined = servers.get(serverKey);
      const draft: AzureStoreDraft = {
        ...base,
        server,
        serverKey,
        read: newStore({
          kind: DataStoreKind.AzureSqlDatabase,
          row,
          name: `${lastSegment(armId.slice(0, serverIndex))}/${databaseName}`,
          posture: sqlDatabasePosture(server, readAt),
        }),
      };

      if (!server) {
        addReadWarning(draft, "Its server's settings were not listed.");
      }

      return draft;
    }
    case COSMOS_TYPE:
      return {
        ...base,
        read: newStore({
          kind: DataStoreKind.AzureCosmosDbAccount,
          row,
          name,
          posture: cosmosPosture(row, readAt),
        }),
      };
    case POSTGRES_TYPE:
    case MYSQL_TYPE:
      return {
        ...base,
        read: newStore({
          kind:
            type === POSTGRES_TYPE
              ? DataStoreKind.AzurePostgreSqlServer
              : DataStoreKind.AzureMySqlServer,
          row,
          name,
          posture: flexibleServerPosture(row, readAt),
        }),
      };
    default:
      return null;
  }
}

function managementUrl(
  arm: AzureArm,
  id: string,
  path: string,
  apiVersion: string,
): string {
  AzureMonitorClient.assertResourceId(id);

  return `${arm.getManagementBaseUrl()}${id}${path}?${buildQueryString([
    ["api-version", apiVersion],
  ])}`;
}

async function readContainers(
  arm: AzureArm,
  accountId: string,
): Promise<Array<AzureContainer>> {
  const listing: { items: Array<JSONObject>; complete: boolean } =
    await arm.listAll(
      managementUrl(
        arm,
        accountId,
        "/blobServices/default/containers",
        STORAGE_API_VERSION,
      ),
      "blob containers request",
    );

  return listing.items
    .map((item: JSONObject): AzureContainer => {
      return {
        name: text(item["name"]),
        publicAccess: text(readObject(item["properties"])["publicAccess"]),
      };
    })
    .filter((container: AzureContainer): boolean => {
      return Boolean(container.name);
    });
}

/*
 * Soft delete counts when both blobs and containers are kept after
 * deletion: deleting a container deletes every blob in it at once.
 */
async function readBlobService(
  arm: AzureArm,
  accountId: string,
): Promise<{ softDelete: boolean; versioning: boolean }> {
  const response: JSONObject = await arm.getJson(
    managementUrl(arm, accountId, "/blobServices/default", STORAGE_API_VERSION),
    "blob service request",
  );
  const properties: JSONObject = readObject(response["properties"]);

  return {
    softDelete:
      flag(readObject(properties["deleteRetentionPolicy"])["enabled"]) ===
        true &&
      flag(
        readObject(properties["containerDeleteRetentionPolicy"])["enabled"],
      ) === true,
    versioning: flag(properties["isVersioningEnabled"]) === true,
  };
}

/*
 * Whether a server's firewall lets every address in. The rule from 0.0.0.0
 * to 0.0.0.0 is Azure's "allow Azure services", not every address.
 */
async function readFirewallOpenToAll(data: {
  arm: AzureArm;
  serverId: string;
  apiVersion: string;
}): Promise<boolean> {
  const listing: { items: Array<JSONObject>; complete: boolean } =
    await data.arm.listAll(
      managementUrl(data.arm, data.serverId, "/firewallRules", data.apiVersion),
      "firewall rules request",
    );

  return listing.items.some((rule: JSONObject): boolean => {
    const properties: JSONObject = readObject(rule["properties"]);

    return isAllAddressesRange(
      text(properties["startIpAddress"]),
      text(properties["endIpAddress"]),
    );
  });
}

async function readTransparentDataEncryption(
  arm: AzureArm,
  databaseId: string,
): Promise<boolean> {
  const response: JSONObject = await arm.getJson(
    managementUrl(
      arm,
      databaseId,
      "/transparentDataEncryption/current",
      SQL_API_VERSION,
    ),
    "transparent data encryption request",
  );

  return lower(text(readObject(response["properties"])["state"])) === "enabled";
}

async function readCosmosRoleAssignments(
  arm: AzureArm,
  accountId: string,
): Promise<Array<AzureCosmosRoleAssignment>> {
  const listing: { items: Array<JSONObject>; complete: boolean } =
    await arm.listAll(
      managementUrl(arm, accountId, "/sqlRoleAssignments", COSMOS_API_VERSION),
      "Cosmos DB role assignments request",
    );

  return listing.items
    .map((item: JSONObject): AzureCosmosRoleAssignment => {
      const properties: JSONObject = readObject(item["properties"]);

      return {
        roleId: lower(lastSegment(text(properties["roleDefinitionId"]))),
        principalId: text(properties["principalId"]),
        scope: text(properties["scope"]),
      };
    })
    .filter((assignment: AzureCosmosRoleAssignment): boolean => {
      return Boolean(assignment.roleId) && Boolean(assignment.principalId);
    });
}

/*
 * Every role assignment that applies in a subscription: at it, above it (a
 * management group) and below it (resource groups, resources), in one
 * listing per subscription rather than one per store.
 */
async function readRoleAssignments(
  arm: AzureArm,
  subscriptionId: string,
): Promise<Array<AzureRoleAssignment>> {
  EntraTokenClient.validateGuid(subscriptionId, "Subscription ID");

  const listing: { items: Array<JSONObject>; complete: boolean } =
    await arm.listAll(
      `${arm.getManagementBaseUrl()}/subscriptions/${encodeURIComponent(
        subscriptionId.trim(),
      )}/providers/Microsoft.Authorization/roleAssignments?${buildQueryString([
        ["api-version", ROLE_ASSIGNMENTS_API_VERSION],
      ])}`,
      "role assignments request",
    );
  const assignments: Array<AzureRoleAssignment> = [];

  for (const item of listing.items) {
    const properties: JSONObject = readObject(item["properties"]);
    const roleId: string = lower(
      lastSegment(text(properties["roleDefinitionId"])),
    );
    const principalId: string = text(properties["principalId"]);
    const scope: string = text(properties["scope"]);

    if (roleId && principalId && scope) {
      assignments.push({
        roleId,
        principalId,
        principalType: text(properties["principalType"]),
        scope,
        scopeKey: scopeKeyOf(scope),
      });
    }
  }

  return assignments;
}

// A scope lowercased without trailing slashes, for comparing; the root scope stays "/".
function scopeKeyOf(scope: string): string {
  let end: number = scope.length;

  while (end > 1 && scope.charAt(end - 1) === "/") {
    end--;
  }

  return lower(scope.slice(0, end));
}

// Where a role assignment's scope sits relative to a store.
type ScopeRelation = "at" | "above" | "below";

function scopeRelation(
  storeKey: string,
  scopeKey: string,
): ScopeRelation | null {
  if (scopeKey === storeKey) {
    return "at";
  }

  if (
    scopeKey === "/" ||
    scopeKey.startsWith("/providers/microsoft.management/managementgroups/") ||
    storeKey.startsWith(`${scopeKey}/`)
  ) {
    return "above";
  }

  if (scopeKey.startsWith(`${storeKey}/`)) {
    return "below";
  }

  return null;
}

// A scope in words: "subscription ...", "resource group rg-data", "containers exports".
function describeScope(scope: string): string {
  const parts: Array<string> = scope.split("/").filter((part: string) => {
    return part.length > 0;
  });
  const lowered: Array<string> = parts.map(lower);

  if (parts.length === 0) {
    return "the root scope";
  }

  const groupIndex: number = lowered.indexOf("managementgroups");

  if (lowered[0] === "providers" && groupIndex >= 0) {
    return `management group ${parts[groupIndex + 1] || ""}`.trim();
  }

  if (lowered[0] === "subscriptions" && parts.length === 2) {
    return `subscription ${parts[1]}`;
  }

  if (
    lowered[0] === "subscriptions" &&
    lowered[2] === "resourcegroups" &&
    parts.length === 4
  ) {
    return `resource group ${parts[3]}`;
  }

  return `${parts[parts.length - 2] || ""} ${parts[parts.length - 1]}`.trim();
}

function principalTypeOf(value: string): DataStorePrincipalType {
  switch (lower(value)) {
    case "user":
      return DataStorePrincipalType.User;
    case "group":
    case "foreigngroup":
      return DataStorePrincipalType.Group;
    default:
      return DataStorePrincipalType.ServicePrincipal;
  }
}

function roleAssignmentEntries(data: {
  draft: AzureStoreDraft;
  assignments: Array<AzureRoleAssignment>;
  external: Array<string>;
}): Array<DataStoreAccessEntry> {
  const kind: DataStoreKind = data.draft.read.identity.kind;
  const keysUsable: boolean = data.draft.read.posture.sharedKeyAccess !== false;
  const entries: Array<DataStoreAccessEntry> = [];

  for (const assignment of data.assignments) {
    const role: AzureDataRole | undefined = AZURE_DATA_ROLES.get(
      assignment.roleId,
    );

    if (!role || role.kind !== kind || (role.throughKeys && !keysUsable)) {
      continue;
    }

    const relation: ScopeRelation | null = scopeRelation(
      data.draft.idKey,
      assignment.scopeKey,
    );

    if (!relation) {
      continue;
    }

    const where: string =
      relation === "at"
        ? ""
        : relation === "above"
          ? ` (inherited from ${describeScope(assignment.scope)})`
          : ` (on ${describeScope(assignment.scope)})`;
    // A group of another tenant: the one cross-tenant principal a role assignment names.
    const foreign: boolean = lower(assignment.principalType) === "foreigngroup";

    entries.push({
      principal: assignment.principalId,
      principalType: principalTypeOf(assignment.principalType),
      accessLevel: role.level,
      grantedVia: `Role assignment: ${role.name}${where}${
        role.throughKeys ? ", through the account keys" : ""
      }`,
      isExternal: foreign,
      isPublic: false,
    });

    if (foreign) {
      data.external.push(`group ${assignment.principalId} of another tenant`);
    }
  }

  return entries;
}

function isPublicContainerAccess(value: string): boolean {
  const access: string = lower(value);
  return access === "blob" || access === "container";
}

/*
 * Anonymous access: a container that allows it is readable by anyone -
 * unless the account turns anonymous access off, which wins over every
 * container's own setting.
 */
function composeStoragePublicAccess(
  draft: AzureStoreDraft,
  entries: Array<DataStoreAccessEntry>,
): void {
  const posture: DataStorePostureFacts = draft.read.posture;

  if (isFileStorage(draft.row) || posture.blockPublicAccess === true) {
    posture.publicRead = false;
    return;
  }

  if (!draft.containers) {
    posture.publicRead = null;
    return;
  }

  const open: Array<AzureContainer> = draft.containers.filter(
    (container: AzureContainer): boolean => {
      return isPublicContainerAccess(container.publicAccess);
    },
  );

  posture.publicRead = open.length > 0;

  if (open.length === 0) {
    return;
  }

  const named: Array<string> = open
    .slice(0, MAX_NAMED_CONTAINERS)
    .map((container: AzureContainer): string => {
      return `${container.name} (${container.publicAccess})`;
    });
  const more: number = open.length - named.length;

  posture.publicReason = `Anonymous read access is on for containers ${named.join(", ")}${
    more > 0 ? ` and ${more} more` : ""
  }.`;

  for (const container of open.slice(0, MAX_PUBLIC_CONTAINER_ENTRIES)) {
    entries.push({
      principal: "Anonymous",
      principalName: "Anyone on the internet",
      principalType: DataStorePrincipalType.Public,
      accessLevel: DataStoreAccessLevel.Read,
      grantedVia: `Anonymous access: container ${container.name} (${container.publicAccess})`,
      isExternal: true,
      isPublic: true,
    });
  }
}

function cosmosDataRoleEntries(data: {
  draft: AzureStoreDraft;
  principalTypes: Map<string, string>;
}): Array<DataStoreAccessEntry> {
  return (data.draft.cosmosRoles || []).map(
    (assignment: AzureCosmosRoleAssignment): DataStoreAccessEntry => {
      const known: { name: string; level: DataStoreAccessLevel } | undefined =
        COSMOS_DATA_ROLES.get(assignment.roleId);
      const scopeKey: string = lower(assignment.scope);
      const where: string = scopeKey.startsWith(`${data.draft.idKey}/`)
        ? ` (on ${assignment.scope.slice(data.draft.idKey.length + 1)})`
        : "";

      return {
        principal: assignment.principalId,
        principalType: principalTypeOf(
          data.principalTypes.get(lower(assignment.principalId)) || "",
        ),
        // A custom data role's actions are not read: it is taken to read.
        accessLevel: known ? known.level : DataStoreAccessLevel.Read,
        grantedVia: `Cosmos DB data role: ${
          known ? known.name : `custom role ${assignment.roleId}`
        }${where}`,
        isExternal: false,
        isPublic: false,
      };
    },
  );
}

function entraPrincipalType(value: string): DataStorePrincipalType {
  const type: string = lower(value);

  if (type === "group") {
    return DataStorePrincipalType.Group;
  }

  if (type === "application") {
    return DataStorePrincipalType.ServicePrincipal;
  }

  return DataStorePrincipalType.User;
}

/*
 * A SQL server's administrators reach every database on it: its Microsoft
 * Entra admin, and its SQL login unless the server takes Entra sign-ins
 * only. An Entra admin of another tenant is external.
 */
function sqlAdministratorEntries(data: {
  server: JSONObject;
  external: Array<string>;
}): Array<DataStoreAccessEntry> {
  const entries: Array<DataStoreAccessEntry> = [];
  const serverName: string =
    text(data.server["name"]) || lastSegment(text(data.server["id"]));
  const admin: JSONObject = readObject(data.server["administrators"]);
  const sid: string = text(admin["sid"]);
  const login: string = text(admin["login"]);

  if (sid || login) {
    const adminTenant: string = text(admin["tenantId"]);
    const ownTenant: string = text(data.server["tenantId"]);
    const foreign: boolean =
      isGuid(adminTenant) &&
      isGuid(ownTenant) &&
      lower(adminTenant) !== lower(ownTenant);

    entries.push({
      principal: sid || login,
      principalName: login || undefined,
      principalType: entraPrincipalType(text(admin["principalType"])),
      accessLevel: DataStoreAccessLevel.Admin,
      grantedVia: `Microsoft Entra admin of server ${serverName}`,
      isExternal: foreign,
      isPublic: false,
    });

    if (foreign) {
      data.external.push(`tenant ${lower(adminTenant)}`);
    }
  }

  const sqlLogin: string = text(data.server["administratorLogin"]);

  if (sqlLogin && flag(admin["azureADOnlyAuthentication"]) !== true) {
    entries.push({
      principal: sqlLogin,
      principalName: sqlLogin,
      principalType: DataStorePrincipalType.User,
      accessLevel: DataStoreAccessLevel.Admin,
      grantedVia: `SQL administrator login of server ${serverName}`,
      isExternal: false,
      isPublic: false,
    });
  }

  return entries;
}

// A flexible server's administrator login, unless the server takes no passwords.
function flexibleServerAdministratorEntries(
  row: JSONObject,
): Array<DataStoreAccessEntry> {
  const login: string = text(row["administratorLogin"]);

  if (!login || lower(text(row["passwordAuth"])) === "disabled") {
    return [];
  }

  return [
    {
      principal: login,
      principalName: login,
      principalType: DataStorePrincipalType.User,
      accessLevel: DataStoreAccessLevel.Admin,
      grantedVia: "Administrator login",
      isExternal: false,
      isPublic: false,
    },
  ];
}

/*
 * The subscriptions and tenants outside the connected ones a store's
 * network lets in: an approved private endpoint in another subscription,
 * and a storage account's resource instance rules.
 */
function externalNetworkPlaces(
  draft: AzureStoreDraft,
  ours: Set<string>,
): Array<string> {
  const places: Array<string> = [];
  const rows: Array<JSONObject> = draft.server
    ? [draft.row, draft.server]
    : [draft.row];

  for (const row of rows) {
    for (const raw of readArray(row["privateEndpointConnections"])) {
      const properties: JSONObject = readObject(readObject(raw)["properties"]);
      const status: string = lower(
        text(
          readObject(properties["privateLinkServiceConnectionState"])["status"],
        ),
      );
      const subscription: string = lower(
        subscriptionOf(text(readObject(properties["privateEndpoint"])["id"])),
      );

      if (
        status === "approved" &&
        isGuid(subscription) &&
        !ours.has(subscription)
      ) {
        places.push(`subscription ${subscription}`);
      }
    }
  }

  const ownTenant: string = lower(text(draft.row["tenantId"]));

  for (const raw of readArray(
    readObject(draft.row["networkAcls"])["resourceAccessRules"],
  )) {
    const rule: JSONObject = readObject(raw);
    const tenant: string = lower(text(rule["tenantId"]));

    if (isGuid(tenant) && isGuid(ownTenant) && tenant !== ownTenant) {
      places.push(`tenant ${tenant}`);
      continue;
    }

    const subscription: string = lower(
      subscriptionOf(text(rule["resourceId"])),
    );

    if (isGuid(subscription) && !ours.has(subscription)) {
      places.push(`subscription ${subscription}`);
    }
  }

  return places;
}

function keepEntries(
  entries: Array<DataStoreAccessEntry>,
): Array<DataStoreAccessEntry> {
  const seen: Set<string> = new Set();
  const kept: Array<DataStoreAccessEntry> = [];

  for (const entry of entries) {
    const key: string = getDataStoreAccessKey(entry);

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    kept.push(entry);

    if (kept.length >= MAX_ACCESS_ENTRIES) {
      break;
    }
  }

  return kept;
}

// A store's access and exposure, from everything read.
function composeStore(data: {
  draft: AzureStoreDraft;
  assignments: Map<string, Array<AzureRoleAssignment> | null>;
  principalTypes: Map<string, string>;
  ours: Set<string>;
}): void {
  const draft: AzureStoreDraft = data.draft;
  const entries: Array<DataStoreAccessEntry> = [];
  const external: Array<string> = externalNetworkPlaces(draft, data.ours);

  if (draft.type === STORAGE_TYPE) {
    composeStoragePublicAccess(draft, entries);
  }

  if (draft.type === STORAGE_TYPE || draft.type === COSMOS_TYPE) {
    const assignments: Array<AzureRoleAssignment> | null | undefined =
      data.assignments.get(lower(draft.subscriptionId));

    if (assignments) {
      entries.push(...roleAssignmentEntries({ draft, assignments, external }));
    } else if (assignments === null) {
      addReadWarning(draft, `Could not read its ${ROLE_ASSIGNMENTS_API.what}.`);
    }
  }

  if (draft.type === COSMOS_TYPE) {
    entries.push(
      ...cosmosDataRoleEntries({ draft, principalTypes: data.principalTypes }),
    );
  }

  if (draft.type === SQL_DATABASE_TYPE && draft.server) {
    entries.push(
      ...sqlAdministratorEntries({ server: draft.server, external }),
    );
  }

  if (draft.type === POSTGRES_TYPE || draft.type === MYSQL_TYPE) {
    entries.push(...flexibleServerAdministratorEntries(draft.row));
  }

  draft.read.access = keepEntries(entries);
  draft.read.posture.sharedWithExternal = unique(external);
}

/*
 * The calls one store needs after the listing. A setting that already
 * answers the question is not asked about again: an account that turns
 * anonymous access off has no container to list for it, a server that
 * takes no public traffic no firewall to read.
 */
function storeTasks(data: {
  draft: AzureStoreDraft;
  arm: AzureArm;
  issues: AzureReadIssues;
}): Array<() => Promise<void>> {
  const draft: AzureStoreDraft = data.draft;
  const posture: DataStorePostureFacts = draft.read.posture;
  const tasks: Array<() => Promise<void>> = [];

  if (draft.type === STORAGE_TYPE && !isFileStorage(draft.row)) {
    if (posture.blockPublicAccess !== true) {
      tasks.push(async (): Promise<void> => {
        const containers: Attempted<Array<AzureContainer>> = await attemptFor({
          issues: data.issues,
          api: CONTAINERS_API,
          draft,
          call: async (): Promise<Array<AzureContainer>> => {
            return await readContainers(data.arm, draft.armId);
          },
        });

        draft.containers = containers.ok ? containers.value : null;
      });
    }

    tasks.push(async (): Promise<void> => {
      const service: Attempted<{ softDelete: boolean; versioning: boolean }> =
        await attemptFor({
          issues: data.issues,
          api: BLOB_SERVICE_API,
          draft,
          call: async (): Promise<{
            softDelete: boolean;
            versioning: boolean;
          }> => {
            return await readBlobService(data.arm, draft.armId);
          },
        });

      if (service.ok) {
        posture.softDelete = service.value.softDelete;
        posture.versioning = service.value.versioning;
      }
    });
  }

  if (draft.type === SQL_DATABASE_TYPE) {
    tasks.push(async (): Promise<void> => {
      const encrypted: Attempted<boolean> = await attemptFor({
        issues: data.issues,
        api: SQL_ENCRYPTION_API,
        draft,
        call: async (): Promise<boolean> => {
          return await readTransparentDataEncryption(data.arm, draft.armId);
        },
      });

      if (encrypted.ok) {
        posture.encryptedAtRest = encrypted.value;
      }
    });
  }

  if (
    (draft.type === POSTGRES_TYPE || draft.type === MYSQL_TYPE) &&
    posture.publicNetworkAccess !== false
  ) {
    tasks.push(async (): Promise<void> => {
      const open: Attempted<boolean> = await attemptFor({
        issues: data.issues,
        api:
          draft.type === POSTGRES_TYPE
            ? POSTGRES_FIREWALL_API
            : MYSQL_FIREWALL_API,
        draft,
        call: async (): Promise<boolean> => {
          return await readFirewallOpenToAll({
            arm: data.arm,
            serverId: draft.armId,
            apiVersion:
              draft.type === POSTGRES_TYPE
                ? POSTGRES_API_VERSION
                : MYSQL_API_VERSION,
          });
        },
      });

      if (open.ok) {
        posture.openToAllAddresses = open.value;
      }
    });
  }

  if (draft.type === COSMOS_TYPE && hasCosmosDataRoles(draft.row)) {
    tasks.push(async (): Promise<void> => {
      const assignments: Attempted<Array<AzureCosmosRoleAssignment>> =
        await attemptFor({
          issues: data.issues,
          api: COSMOS_ROLES_API,
          draft,
          call: async (): Promise<Array<AzureCosmosRoleAssignment>> => {
            return await readCosmosRoleAssignments(data.arm, draft.armId);
          },
        });

      draft.cosmosRoles = assignments.ok ? assignments.value : null;
    });
  }

  return tasks;
}

// Only an account of the NoSQL API has Cosmos DB's own data roles.
function hasCosmosDataRoles(row: JSONObject): boolean {
  if (lower(text(row["kind"])) !== "globaldocumentdb") {
    return false;
  }

  return !readArray(row["capabilities"]).some((raw: unknown): boolean => {
    return COSMOS_NON_SQL_CAPABILITIES.has(
      lower(text(readObject(raw)["name"])),
    );
  });
}

/*
 * A SQL server's firewall, read once for all its databases - for a server
 * whose settings were listed and that takes public traffic.
 */
function sqlServerTasks(data: {
  drafts: Array<AzureStoreDraft>;
  arm: AzureArm;
  issues: AzureReadIssues;
}): Array<() => Promise<void>> {
  const byServer: Map<string, Array<AzureStoreDraft>> = new Map();

  for (const draft of data.drafts) {
    if (
      draft.type !== SQL_DATABASE_TYPE ||
      !draft.server ||
      !draft.serverKey ||
      draft.read.posture.publicNetworkAccess === false
    ) {
      continue;
    }

    const group: Array<AzureStoreDraft> = byServer.get(draft.serverKey) || [];
    group.push(draft);
    byServer.set(draft.serverKey, group);
  }

  return Array.from(byServer.values()).map(
    (group: Array<AzureStoreDraft>): (() => Promise<void>) => {
      return async (): Promise<void> => {
        const server: JSONObject = group[0]!.server!;
        const open: Attempted<boolean> = await attempt({
          issues: data.issues,
          api: SQL_FIREWALL_API,
          place: text(server["name"]) || lastSegment(text(server["id"])),
          call: async (): Promise<boolean> => {
            return await readFirewallOpenToAll({
              arm: data.arm,
              serverId: text(server["id"]),
              apiVersion: SQL_API_VERSION,
            });
          },
        });

        for (const draft of group) {
          if (open.ok) {
            draft.read.posture.openToAllAddresses = open.value;
          } else {
            addReadWarning(
              draft,
              `Could not read its ${SQL_FIREWALL_API.what}.`,
            );
          }
        }
      };
    },
  );
}

function roleAssignmentTasks(data: {
  subscriptionIds: Array<string>;
  arm: AzureArm;
  issues: AzureReadIssues;
  into: Map<string, Array<AzureRoleAssignment> | null>;
}): Array<() => Promise<void>> {
  return data.subscriptionIds.map(
    (subscriptionId: string): (() => Promise<void>) => {
      return async (): Promise<void> => {
        const assignments: Attempted<Array<AzureRoleAssignment>> =
          await attempt({
            issues: data.issues,
            api: ROLE_ASSIGNMENTS_API,
            place: `subscription ${subscriptionId}`,
            call: async (): Promise<Array<AzureRoleAssignment>> => {
              return await readRoleAssignments(data.arm, subscriptionId);
            },
          });

        data.into.set(
          lower(subscriptionId),
          assignments.ok ? assignments.value : null,
        );
      };
    },
  );
}

// Runs the calls a few at a time; a refused sign-in in any of them stops the read.
async function runTasks(tasks: Array<() => Promise<void>>): Promise<void> {
  const outcomes: Array<Settled<void>> = await mapWithConcurrency(
    tasks,
    CONCURRENCY,
    async (task: () => Promise<void>): Promise<void> => {
      await task();
    },
  );

  for (const outcome of outcomes) {
    if (!outcome.ok) {
      throw outcome.error;
    }
  }
}

/*
 * The connection's data stores: their posture facts, who can reach them
 * and their tags. Throws only when the app cannot sign in (or its settings
 * are not valid); everything else Azure refuses is a warning.
 */
export async function readAzureDataSecurity(
  settings: CloudConnectionSettings,
  options: AzureDataSecurityReadOptions,
): Promise<CloudDataSecurityReadResult> {
  try {
    return await readStores(settings, options);
  } catch (error) {
    throw explainExpiredAzureSecret(error);
  }
}

async function readStores(
  settings: CloudConnectionSettings,
  options: AzureDataSecurityReadOptions,
): Promise<CloudDataSecurityReadResult> {
  const connector: AzureCloudConnector = new AzureCloudConnector();
  connector.validateSettings(settings);

  const readAt: string = resolveNow(options.now).toISOString();
  const arm: AzureArm = createAzureArm(settings, options);
  const issues: AzureReadIssues = new AzureReadIssues();
  const warnings: Array<string> = [];
  let complete: boolean = true;

  // 1. The subscriptions the connection names, or every enabled one the app may read.
  let subscriptionIds: Array<string> = connector.getSubscriptionIds(settings);

  if (subscriptionIds.length === 0) {
    const listed: Attempted<Array<AzureSubscription>> = await attempt({
      issues,
      api: SUBSCRIPTIONS_API,
      place: "the tenant",
      call: async (): Promise<Array<AzureSubscription>> => {
        return await arm.listSubscriptions();
      },
    });

    if (listed.ok) {
      subscriptionIds = listed.value
        .filter((subscription: AzureSubscription): boolean => {
          const state: string = lower(subscription.state);
          return state !== "disabled" && state !== "deleted";
        })
        .map((subscription: AzureSubscription): string => {
          return subscription.subscriptionId;
        });
    } else {
      complete = false;
    }
  }

  if (subscriptionIds.length > AZURE_MAX_SUBSCRIPTIONS) {
    warnings.push(
      `The app may read ${subscriptionIds.length} subscriptions: the data stores of the first ${AZURE_MAX_SUBSCRIPTIONS} are read. Name the ones to read under Subscriptions.`,
    );
    subscriptionIds = subscriptionIds.slice(0, AZURE_MAX_SUBSCRIPTIONS);
    complete = false;
  }

  if (subscriptionIds.length === 0) {
    if (complete) {
      warnings.push(
        "The app may read no subscription. Give it the Monitoring Reader role on the subscriptions to read.",
      );
    }

    return {
      stores: [],
      warnings: [...warnings, ...issues.getWarnings()],
      complete: false,
    };
  }

  // 2. The stores and their own settings, from one Resource Graph query.
  const listing: Attempted<{ rows: Array<JSONObject>; complete: boolean }> =
    await attempt({
      issues,
      api: RESOURCE_GRAPH_API,
      place:
        subscriptionIds.length === 1
          ? `subscription ${subscriptionIds[0]}`
          : `${subscriptionIds.length} subscriptions`,
      call: async (): Promise<{
        rows: Array<JSONObject>;
        complete: boolean;
      }> => {
        return await arm.queryResourceGraph({
          subscriptionIds,
          query: AZURE_DATA_SECURITY_QUERY,
        });
      },
    });

  if (!listing.ok) {
    return {
      stores: [],
      warnings: [
        ...warnings,
        ...issues.getWarnings(),
        ...(issues.budgetSpent
          ? ["This read reached its limit before it listed the data stores."]
          : []),
      ],
      complete: false,
    };
  }

  if (!listing.value.complete) {
    complete = false;
    warnings.push(
      "The subscriptions have more data stores than one read lists: the rest are read next time.",
    );
  }

  const drafts: Array<AzureStoreDraft> = buildDrafts(
    listing.value.rows,
    readAt,
  );
  const detailed: Array<AzureStoreDraft> = drafts.slice(
    0,
    AZURE_MAX_DETAILED_STORES,
  );

  if (drafts.length > AZURE_MAX_DETAILED_STORES) {
    complete = false;
    warnings.push(
      `The subscriptions have ${drafts.length} data stores: the containers, firewall rules and encryption of the first ${AZURE_MAX_DETAILED_STORES} are read.`,
    );

    for (const draft of drafts.slice(AZURE_MAX_DETAILED_STORES)) {
      addReadWarning(
        draft,
        "Some of its settings were not read: the connection has more stores than one read details.",
      );
    }
  }

  // 3. What the listing does not hold: per store, per SQL server, per subscription.
  const assignments: Map<string, Array<AzureRoleAssignment> | null> = new Map();
  const tasks: Array<() => Promise<void>> = [];

  for (const draft of detailed) {
    tasks.push(...storeTasks({ draft, arm, issues }));
  }

  tasks.push(...sqlServerTasks({ drafts: detailed, arm, issues }));
  tasks.push(
    ...roleAssignmentTasks({ subscriptionIds, arm, issues, into: assignments }),
  );

  await runTasks(tasks);

  // 4. Access and exposure, from all of it.
  const principalTypes: Map<string, string> = new Map();

  for (const list of assignments.values()) {
    for (const assignment of list || []) {
      if (assignment.principalType) {
        principalTypes.set(
          lower(assignment.principalId),
          assignment.principalType,
        );
      }
    }
  }

  const ours: Set<string> = new Set(
    [...options.connectedSubscriptionIds, ...subscriptionIds].map(
      (subscriptionId: string): string => {
        return lower(subscriptionId.trim());
      },
    ),
  );

  for (const draft of drafts) {
    composeStore({ draft, assignments, principalTypes, ours });
  }

  if (issues.budgetSpent) {
    complete = false;
    warnings.push(
      "This read reached its limit: the settings it did not get to are read next time.",
    );
  }

  return {
    stores: drafts.map((draft: AzureStoreDraft): CloudDataStoreRead => {
      return draft.read;
    }),
    warnings: [...warnings, ...issues.getWarnings()],
    complete,
  };
}

/*
 * THE BLOB SERVICE'S DATA PLANE, FOR THE CONTENT SCANNER.
 *
 * Signed in as the same app with a token for Azure Storage, which a data
 * role authorizes (Storage Blob Data Reader). Every host is built from the
 * account's name alone - checked to be a storage account's name - and the
 * cloud's storage suffix: nothing a caller passes becomes a URL.
 */

function assertStorageAccountName(accountName: string): string {
  const name: string = (accountName || "").trim();

  if (!STORAGE_ACCOUNT_NAME_REGEX.test(name)) {
    throw new BadDataException(
      "A storage account's name is 3 to 24 lowercase letters and digits.",
    );
  }

  return name;
}

function assertContainerName(containerName: string): string {
  const name: string = (containerName || "").trim();

  if (!CONTAINER_NAME_REGEX.test(name)) {
    throw new BadDataException(
      "A container's name is 3 to 63 lowercase letters, digits and hyphens.",
    );
  }

  return name;
}

function blobServiceUrl(arm: AzureArm, accountName: string): string {
  return `https://${accountName}.blob.${arm.getStorageSuffix()}`;
}

/*
 * A blob's name as a URL path, each segment encoded. A "." or ".." segment
 * is refused: a URL resolves it away, which would read outside the
 * container.
 */
function encodeBlobPath(key: string): string {
  if (!key || key.length > MAX_BLOB_NAME_LENGTH) {
    throw new BadDataException(
      `A blob's name is 1 to ${MAX_BLOB_NAME_LENGTH} characters.`,
    );
  }

  const segments: Array<string> = key.split("/");

  for (const segment of segments) {
    if (segment === "." || segment === "..") {
      throw new BadDataException(
        "A blob whose name has a '.' or '..' segment is not read.",
      );
    }
  }

  return segments
    .map((segment: string): string => {
      return encodeURIComponent(segment);
    })
    .join("/");
}

interface XmlElement {
  // What the opening tag holds after its name: its attributes.
  attributes: string;
  content: string;
}

const XML_ENTITIES: ReadonlyMap<string, string> = new Map<string, string>([
  ["amp", "&"],
  ["lt", "<"],
  ["gt", ">"],
  ["quot", '"'],
  ["apos", "'"],
]);

function decodeXmlEntity(entity: string): string | null {
  const named: string | undefined = XML_ENTITIES.get(entity);

  if (named !== undefined) {
    return named;
  }

  let code: number = NaN;

  if (entity.startsWith("#x") || entity.startsWith("#X")) {
    code = parseInt(entity.slice(2), 16);
  } else if (entity.startsWith("#")) {
    code = parseInt(entity.slice(1), 10);
  }

  if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) {
    return null;
  }

  return String.fromCodePoint(code);
}

/*
 * XML text with its entities decoded, read with indexOf: a listing can be
 * megabytes long, too long for a regular expression to walk safely.
 */
function decodeXmlText(value: string): string {
  if (value.indexOf("&") < 0) {
    return value;
  }

  const parts: Array<string> = [];
  let from: number = 0;

  while (from < value.length) {
    const ampersand: number = value.indexOf("&", from);

    if (ampersand < 0) {
      break;
    }

    const semicolon: number = value.indexOf(";", ampersand + 1);
    const decoded: string | null =
      semicolon > ampersand && semicolon - ampersand <= MAX_XML_ENTITY_LENGTH
        ? decodeXmlEntity(value.slice(ampersand + 1, semicolon))
        : null;

    if (decoded === null) {
      parts.push(value.slice(from, ampersand + 1));
      from = ampersand + 1;
      continue;
    }

    parts.push(value.slice(from, ampersand), decoded);
    from = semicolon + 1;
  }

  parts.push(value.slice(from));

  return parts.join("");
}

// A character that may end an element's name in its opening tag.
function endsTagName(character: string): boolean {
  return (
    character === ">" ||
    character === "/" ||
    character === " " ||
    character === "\t" ||
    character === "\n" ||
    character === "\r"
  );
}

/*
 * The elements <tag ...>...</tag> of an XML text, in order, read with
 * indexOf. Elements of one name do not nest in the Blob service's
 * listings, which is all this reads.
 */
function readXmlElements(
  xml: string,
  tag: string,
  limit: number = MAX_XML_ELEMENTS,
): Array<XmlElement> {
  const elements: Array<XmlElement> = [];
  const open: string = `<${tag}`;
  const close: string = `</${tag}>`;
  let from: number = 0;

  while (elements.length < limit) {
    const start: number = xml.indexOf(open, from);

    if (start < 0) {
      break;
    }

    const nameEnd: number = start + open.length;

    // "<Blob" is not "<Blobs" or "<BlobPrefix".
    if (!endsTagName(xml.charAt(nameEnd))) {
      from = nameEnd;
      continue;
    }

    const tagEnd: number = xml.indexOf(">", nameEnd);

    if (tagEnd < 0) {
      break;
    }

    const attributes: string = xml.slice(nameEnd, tagEnd);

    if (attributes.endsWith("/")) {
      elements.push({ attributes: attributes.slice(0, -1), content: "" });
      from = tagEnd + 1;
      continue;
    }

    const end: number = xml.indexOf(close, tagEnd + 1);

    if (end < 0) {
      break;
    }

    elements.push({ attributes, content: xml.slice(tagEnd + 1, end) });
    from = end + close.length;
  }

  return elements;
}

function readXmlText(xml: string, tag: string): string {
  const element: XmlElement | undefined = readXmlElements(xml, tag, 1)[0];
  return element ? decodeXmlText(element.content).trim() : "";
}

/*
 * A blob's or container's name. A name with characters XML cannot carry
 * comes percent-encoded, marked Encoded="true".
 */
function readListedName(content: string): string {
  const element: XmlElement | undefined = readXmlElements(
    content,
    "Name",
    1,
  )[0];

  if (!element) {
    return "";
  }

  const name: string = decodeXmlText(element.content);

  if (lower(element.attributes).indexOf('encoded="true"') >= 0) {
    try {
      return decodeURIComponent(name);
    } catch {
      return name;
    }
  }

  return name;
}

function readDate(value: string): Date | undefined {
  const time: number = Date.parse(value);
  return Number.isFinite(time) ? new Date(time) : undefined;
}

// At most the size asked for, in case a server sent more than the range.
function firstBytes(bytes: Buffer, maxBytes: number): Uint8Array {
  return new Uint8Array(bytes.subarray(0, Math.max(0, maxBytes)));
}

function clampCount(value: number, max: number): number {
  const count: number = Math.floor(value);
  return Number.isFinite(count) ? Math.max(1, Math.min(count, max)) : 1;
}

class AzureBlobObjectStoreReader implements ObjectStoreReader {
  public readonly description: string;
  private arm: AzureArm;
  private containerUrl: string;

  public constructor(data: {
    arm: AzureArm;
    accountName: string;
    containerName: string;
  }) {
    this.arm = data.arm;
    this.containerUrl = `${blobServiceUrl(data.arm, data.accountName)}/${encodeURIComponent(
      data.containerName,
    )}`;
    this.description = `${blobServiceUrl(data.arm, data.accountName)}/${data.containerName}`;
  }

  // One page of List Blobs: names, sizes and when each last changed.
  public async listObjects(options: {
    prefix?: string | undefined;
    nextToken?: string | undefined;
    maxKeys: number;
  }): Promise<ObjectStoreListPage> {
    const xml: string = await this.arm.getStorageText({
      url: `${this.containerUrl}?${buildQueryString([
        ["restype", "container"],
        ["comp", "list"],
        ["prefix", options.prefix],
        ["marker", options.nextToken],
        ["maxresults", clampCount(options.maxKeys, BLOB_LIST_MAX_RESULTS)],
      ])}`,
      step: "list blobs request",
    });
    const objects: Array<ObjectStoreObject> = [];

    for (const element of readXmlElements(xml, "Blob")) {
      const key: string = readListedName(element.content);
      const properties: string =
        readXmlElements(element.content, "Properties", 1)[0]?.content || "";

      // An account with a hierarchical namespace lists its directories too.
      if (
        !key ||
        lower(readXmlText(properties, "ResourceType")) === "directory"
      ) {
        continue;
      }

      const size: number = Number(readXmlText(properties, "Content-Length"));

      objects.push({
        key,
        sizeInBytes: Number.isFinite(size) && size > 0 ? size : 0,
        lastModified: readDate(readXmlText(properties, "Last-Modified")),
        etag: readXmlText(properties, "Etag") || undefined,
      });
    }

    return {
      objects,
      nextToken: readXmlText(xml, "NextMarker") || undefined,
    };
  }

  /*
   * The first bytes of a blob (Get Blob with x-ms-range), never the whole
   * blob - as its bytes, so a gzip or a zip reaches the sampler intact.
   */
  public async readObjectStart(
    key: string,
    maxBytes: number,
  ): Promise<Uint8Array> {
    const length: number = Math.floor(maxBytes);
    const url: string = `${this.containerUrl}/${encodeBlobPath(key)}`;

    if (!Number.isFinite(length) || length <= 0) {
      return new Uint8Array(0);
    }

    try {
      const body: Buffer = await this.arm.getStorageBytes({
        url,
        step: "read blob request",
        headers: { "x-ms-range": `bytes=0-${length - 1}` },
      });

      return firstBytes(body, length);
    } catch (error) {
      // An empty blob has no first byte: the service answers 416.
      if (error instanceof LlmProviderError && error.statusCode === 416) {
        return new Uint8Array(0);
      }

      throw error;
    }
  }
}

/*
 * One container of a storage account, for the content scanner: a page of
 * its blobs, or the first bytes of one.
 */
export function createAzureBlobObjectStoreReader(
  settings: CloudConnectionSettings,
  options: {
    connectionId: string;
    accountName: string;
    containerName: string;
    transport?: CloudConnectorTransport | undefined;
    budget?: CloudReadBudget | undefined;
  },
): ObjectStoreReader {
  const accountName: string = assertStorageAccountName(options.accountName);
  const containerName: string = assertContainerName(options.containerName);

  return new AzureBlobObjectStoreReader({
    arm: createAzureArm(settings, options),
    accountName,
    containerName,
  });
}

/*
 * The containers of a storage account (List Containers on its data
 * plane): what the content scanner reads of it, at most
 * CONTAINER_LIST_MAX_PAGES pages of 5,000.
 */
export async function listAzureBlobContainers(
  settings: CloudConnectionSettings,
  options: {
    connectionId: string;
    accountName: string;
    transport?: CloudConnectorTransport | undefined;
    budget?: CloudReadBudget | undefined;
  },
): Promise<Array<string>> {
  const accountName: string = assertStorageAccountName(options.accountName);
  const arm: AzureArm = createAzureArm(settings, options);
  const names: Array<string> = [];
  let marker: string = "";

  for (let page: number = 0; page < CONTAINER_LIST_MAX_PAGES; page++) {
    const xml: string = await arm.getStorageText({
      url: `${blobServiceUrl(arm, accountName)}/?${buildQueryString([
        ["comp", "list"],
        ["maxresults", BLOB_LIST_MAX_RESULTS],
        ["marker", marker],
      ])}`,
      step: "list containers request",
    });

    for (const element of readXmlElements(xml, "Container")) {
      const name: string = readListedName(element.content);

      if (name) {
        names.push(name);
      }
    }

    const next: string = readXmlText(xml, "NextMarker");

    if (!next || next === marker) {
      break;
    }

    marker = next;
  }

  return names;
}
