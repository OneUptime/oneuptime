import { CloudConnectionFailureKind } from "../../../../../Types/CloudConnection/CloudConnectionTest";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../Types/JSON";
import AzureArm from "../../../CloudConnection/Azure/AzureArm";
import AzureCloudConnector, {
  explainExpiredAzureSecret,
} from "../../../CloudConnection/Azure/AzureCloudConnector";
import {
  CloudConnectionSettings,
  CloudConnectorTransport,
  CloudReadBudget,
  readCloudSetting,
} from "../../../CloudConnection/CloudConnectorTypes";
import DataSourceHttpFetch from "../../../DataSource/HttpFetch";
import AzureMonitorClient from "../../../LlmObservability/Connectors/AzureOpenAI/AzureMonitorClient";
import EntraTokenClient from "../../../LlmObservability/Connectors/Microsoft/EntraTokenClient";
import LlmProviderError from "../../../LlmObservability/LlmProviderError";
import {
  buildQueryString,
  readObject,
} from "../../../LlmObservability/LlmProviderHttp";
import { DataSecurityResponseOutcome } from "../DataSecurityCloudTypes";

/*
 * DATA SECURITY'S RESPONSE ACTIONS ON AZURE: what a person - or, for the
 * first, a playbook - may change on a storage account Data Security found.
 *
 *   blockAzureStoragePublicAccess - the account's anonymous blob access
 *   turned off (allowBlobPublicAccess: false), which closes every one of
 *   its containers to anonymous readers at once, whatever each says.
 *
 *     GET   {arm}{storage account id}?api-version=...  -> its settings
 *     PATCH {arm}{storage account id}?api-version=...
 *           { properties: { allowBlobPublicAccess: false } }
 *
 *   requireAzureSecureTransfer - HTTPS only (supportsHttpsTrafficOnly) and
 *   TLS 1.2 at least (minimumTlsVersion), each set only when it is not so.
 *
 *     PATCH (the same) { properties: { supportsHttpsTrafficOnly: true,
 *                                      minimumTlsVersion: "TLS1_2" } }
 *
 *   turnOnAzureBlobSoftDelete - deleted blobs and containers kept for 14
 *   days (deleteRetentionPolicy, containerDeleteRetentionPolicy).
 *
 *     GET   {arm}{id}/blobServices/default?api-version=...
 *     PUT   (the same) { properties: what was read, with the two policies on }
 *
 * Each reads first and writes only what is not already so: run twice, it
 * changes nothing the second time, and says so. The account's own
 * settings are changed with a PATCH, which changes only what it names - a
 * PUT would set every setting it left out back to its default, a storage
 * account's firewall among them. Its blob service Azure changes only
 * whole, so what was read is sent back with the one change, as the Azure
 * CLI does.
 *
 * Azure lets the app write only once the connection's opt-in "Data
 * security response" setting is on and its updated setup command has
 * given the app a role with Microsoft.Storage/storageAccounts/write (and
 * blobServices/write); until then the write is refused, and the error
 * says so.
 */

const STORAGE_API_VERSION: string = "2023-05-01";
const READ_PERMISSION: string = "Microsoft.Storage/storageAccounts/read";
const WRITE_PERMISSION: string = "Microsoft.Storage/storageAccounts/write";
const BLOB_SERVICE_READ_PERMISSION: string =
  "Microsoft.Storage/storageAccounts/blobServices/read";
const BLOB_SERVICE_WRITE_PERMISSION: string =
  "Microsoft.Storage/storageAccounts/blobServices/write";

// How long soft delete keeps a deleted blob or container.
export const AZURE_SOFT_DELETE_DAYS: number = 14;

// The minimum TLS versions Azure takes, oldest first; 1.2 and later are enough.
const SECURE_TLS_VERSIONS: ReadonlyArray<string> = ["TLS1_2", "TLS1_3"];

/*
 * A storage account's ARM id, and the subscription, resource group and
 * account it names. Bounded, and checked again by assertResourceId (no
 * "..", "//", "?" or "#"), since it becomes the request's path.
 */
const STORAGE_ACCOUNT_ID_REGEX: RegExp =
  /^\/subscriptions\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/resourceGroups\/([^/?#]{1,90})\/providers\/Microsoft\.Storage\/storageAccounts\/([a-z0-9]{3,24})$/i;

// What the action did: the outcome every cloud's response gives.
export type DataSecurityResponseResult = DataSecurityResponseOutcome;

interface StorageAccountReference {
  resourceId: string;
  subscriptionId: string;
  name: string;
}

interface StorageAccountOptions {
  connectionId: string;
  // The storage account's ARM id.
  resourceId: string;
  transport?: CloudConnectorTransport | undefined;
  // The clock, or the time itself; the system clock when absent.
  now?: (() => Date) | Date | undefined;
  budget?: CloudReadBudget | undefined;
}

interface OpenStorageAccount {
  arm: AzureArm;
  account: StorageAccountReference;
  // The account's own URL, with its api-version.
  url: string;
  // A URL under the account - its blob service - with the api-version.
  urlOf: (path: string) => string;
}

function parseStorageAccountId(resourceId: string): StorageAccountReference {
  const id: string = (resourceId || "").trim();
  const match: RegExpMatchArray | null = id.match(STORAGE_ACCOUNT_ID_REGEX);

  if (!match) {
    throw new BadDataException(
      "The resource is not a storage account: its id must look like /subscriptions/{id}/resourceGroups/{group}/providers/Microsoft.Storage/storageAccounts/{name}.",
    );
  }

  AzureMonitorClient.assertResourceId(id);

  return { resourceId: id, subscriptionId: match[1]!, name: match[3]! };
}

/*
 * What a refused or failed call means, for the person reading it: which
 * permission is missing and how the connection gets it, a store that is
 * gone, a lock that holds it. A refused sign-in stays what it is.
 */
function explainFailure(
  error: unknown,
  data: {
    account: StorageAccountReference;
    writing: boolean;
    permission: string;
  },
): unknown {
  if (!(error instanceof LlmProviderError)) {
    return error;
  }

  if (error.kind === CloudConnectionFailureKind.Authentication) {
    return explainExpiredAzureSecret(error);
  }

  if (error.kind === CloudConnectionFailureKind.Permission) {
    return new LlmProviderError({
      message: `The app may not ${data.writing ? "change" : "read"} storage account ${data.account.name}: it needs ${data.permission}. Turn on the connection's "Data security response" setting and run its updated setup command.`,
      kind: CloudConnectionFailureKind.Permission,
      statusCode: error.statusCode,
      responseBody: error.responseBody,
    });
  }

  if (error.statusCode === 404) {
    return new LlmProviderError({
      message: `Storage account ${data.account.name} was not found: it may have been deleted or moved.`,
      kind: CloudConnectionFailureKind.Settings,
      statusCode: error.statusCode,
      responseBody: error.responseBody,
    });
  }

  if (error.statusCode === 409) {
    return new LlmProviderError({
      message: `Azure would not change storage account ${data.account.name} now - a lock on it, or an operation in progress: ${error.message}`,
      kind: CloudConnectionFailureKind.Other,
      statusCode: error.statusCode,
      responseBody: error.responseBody,
    });
  }

  return error;
}

/*
 * The storage account a response action changes, in a subscription the
 * connection reads, and the Resource Manager client signed in as its app.
 */
function openStorageAccount(
  settings: CloudConnectionSettings,
  options: StorageAccountOptions,
): OpenStorageAccount {
  const connector: AzureCloudConnector = new AzureCloudConnector();
  connector.validateSettings(settings);

  const account: StorageAccountReference = parseStorageAccountId(
    options.resourceId,
  );
  const named: Array<string> = connector.getSubscriptionIds(settings);

  // A connection that names its subscriptions changes nothing outside them.
  if (
    named.length > 0 &&
    !named.some((subscriptionId: string): boolean => {
      return (
        subscriptionId.toLowerCase() === account.subscriptionId.toLowerCase()
      );
    })
  ) {
    throw new BadDataException(
      `Storage account ${account.name} is in subscription ${account.subscriptionId}, which this connection does not read.`,
    );
  }

  const arm: AzureArm = new AzureArm({
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
  const query: string = buildQueryString([
    ["api-version", STORAGE_API_VERSION],
  ]);
  const urlOf: (path: string) => string = (path: string): string => {
    return `${arm.getManagementBaseUrl()}${account.resourceId}${path}?${query}`;
  };

  return { arm, account, url: urlOf(""), urlOf };
}

// The account's own settings: what its properties say now.
async function readStorageAccount(
  open: OpenStorageAccount,
): Promise<JSONObject> {
  try {
    return readObject(
      (await open.arm.getJson(open.url, "storage account request"))[
        "properties"
      ],
    );
  } catch (error) {
    throw explainFailure(error, {
      account: open.account,
      writing: false,
      permission: READ_PERMISSION,
    });
  }
}

async function patchStorageAccount(
  open: OpenStorageAccount,
  properties: JSONObject,
): Promise<void> {
  try {
    await open.arm.patch(open.url, { properties }, "storage account update");
  } catch (error) {
    throw explainFailure(error, {
      account: open.account,
      writing: true,
      permission: WRITE_PERMISSION,
    });
  }
}

/*
 * Turns a storage account's anonymous blob access off, unless it is off
 * already. Throws when the account cannot be read or changed, with what
 * to do.
 */
export async function blockAzureStoragePublicAccess(
  settings: CloudConnectionSettings,
  options: StorageAccountOptions,
): Promise<DataSecurityResponseResult> {
  const open: OpenStorageAccount = openStorageAccount(settings, options);
  const properties: JSONObject = await readStorageAccount(open);

  // Unset is allowed, as Azure reads it: only false is off.
  if (properties["allowBlobPublicAccess"] === false) {
    return {
      changed: false,
      summary: `Anonymous blob access is already off on storage account ${open.account.name}; nothing changed.`,
    };
  }

  await patchStorageAccount(open, { allowBlobPublicAccess: false });

  return {
    changed: true,
    summary: `Turned off anonymous blob access on storage account ${open.account.name}: no container in it can be read anonymously now.`,
  };
}

/*
 * Makes a storage account take HTTPS only, with TLS 1.2 at least: each of
 * the two set only when it is not so already.
 */
export async function requireAzureSecureTransfer(
  settings: CloudConnectionSettings,
  options: StorageAccountOptions,
): Promise<DataSecurityResponseResult> {
  const open: OpenStorageAccount = openStorageAccount(settings, options);
  const properties: JSONObject = await readStorageAccount(open);
  const change: JSONObject = {};
  const changed: Array<string> = [];

  // Only what Azure says is on is on: an unset setting is set.
  if (!isOn(properties["supportsHttpsTrafficOnly"])) {
    change["supportsHttpsTrafficOnly"] = true;
    changed.push("turned on Secure transfer required");
  }

  const minimumTls: string = String(properties["minimumTlsVersion"] || "");

  if (!SECURE_TLS_VERSIONS.includes(minimumTls)) {
    change["minimumTlsVersion"] = "TLS1_2";
    changed.push(
      `set the minimum TLS version to 1.2${
        minimumTls ? ` (it was ${minimumTls.split("_").join(".")})` : ""
      }`,
    );
  }

  if (changed.length === 0) {
    return {
      changed: false,
      summary: `Storage account ${open.account.name} already takes HTTPS only, with TLS 1.2 or later; nothing changed.`,
    };
  }

  await patchStorageAccount(open, change);

  return {
    changed: true,
    summary: `On storage account ${open.account.name}, ${changed.join(
      " and ",
    )}: it takes HTTPS only, with TLS 1.2 or later, now.`,
  };
}

// Whether Azure says a setting is on: true, or "true" as some answers write it.
function isOn(value: unknown): boolean {
  return value === true || value === "true" || value === "True";
}

// Whether a retention policy of a blob service is on.
function isRetentionOn(policy: unknown): boolean {
  return isOn(readObject(policy)["enabled"]);
}

/*
 * Turns soft delete on for a storage account's blobs and containers, for
 * AZURE_SOFT_DELETE_DAYS, unless both are on already; a policy that is on
 * keeps its own number of days.
 */
export async function turnOnAzureBlobSoftDelete(
  settings: CloudConnectionSettings,
  options: StorageAccountOptions,
): Promise<DataSecurityResponseResult> {
  const open: OpenStorageAccount = openStorageAccount(settings, options);
  const url: string = open.urlOf("/blobServices/default");
  let properties: JSONObject;

  try {
    properties = readObject(
      (await open.arm.getJson(url, "blob service request"))["properties"],
    );
  } catch (error) {
    throw explainFailure(error, {
      account: open.account,
      writing: false,
      permission: BLOB_SERVICE_READ_PERMISSION,
    });
  }

  const blobs: boolean = isRetentionOn(properties["deleteRetentionPolicy"]);
  const containers: boolean = isRetentionOn(
    properties["containerDeleteRetentionPolicy"],
  );

  if (blobs && containers) {
    return {
      changed: false,
      summary: `Soft delete was already on for the blobs and containers of storage account ${open.account.name}; nothing changed.`,
    };
  }

  const on: JSONObject = { enabled: true, days: AZURE_SOFT_DELETE_DAYS };

  try {
    await open.arm.put(
      url,
      {
        properties: {
          ...properties,
          ...(blobs ? {} : { deleteRetentionPolicy: on }),
          ...(containers ? {} : { containerDeleteRetentionPolicy: on }),
        },
      },
      "blob service update",
    );
  } catch (error) {
    throw explainFailure(error, {
      account: open.account,
      writing: true,
      permission: BLOB_SERVICE_WRITE_PERMISSION,
    });
  }

  const what: string =
    !blobs && !containers
      ? "blobs and containers"
      : !blobs
        ? "blobs"
        : "containers";

  return {
    changed: true,
    summary: `Turned on soft delete for the ${what} of storage account ${open.account.name}: a deleted one can be restored for ${AZURE_SOFT_DELETE_DAYS} days.`,
  };
}
