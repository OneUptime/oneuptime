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
 * DATA SECURITY'S RESPONSE ACTIONS ON AZURE: what a playbook may change to
 * close an exposure Data Security found.
 *
 *   blockAzureStoragePublicAccess - a storage account's anonymous blob
 *   access turned off (allowBlobPublicAccess: false), which closes every
 *   one of its containers to anonymous readers at once, whatever each
 *   container says.
 *
 *     GET   {arm}{storage account id}?api-version=...  -> its settings
 *     PATCH {arm}{storage account id}?api-version=...
 *           { properties: { allowBlobPublicAccess: false } }
 *
 * Each action reads first and writes only what is not already so: run
 * twice, it changes nothing the second time, and says so. A PATCH changes
 * the one setting it names - a PUT would set every setting it left out
 * back to its default, a storage account's firewall among them.
 *
 * Azure lets the app write only once the connection's opt-in "Data
 * security response" setting is on and its updated setup command has
 * given the app a role with Microsoft.Storage/storageAccounts/write;
 * until then the write is refused, and the error says so.
 */

const STORAGE_API_VERSION: string = "2023-05-01";
const READ_PERMISSION: string = "Microsoft.Storage/storageAccounts/read";
const WRITE_PERMISSION: string = "Microsoft.Storage/storageAccounts/write";

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
 * What a refused or failed call means, for the person reading the
 * playbook run: which permission is missing and how the connection gets
 * it, a store that is gone, a lock that holds it. A refused sign-in stays
 * what it is.
 */
function explainFailure(
  error: unknown,
  data: { account: StorageAccountReference; writing: boolean },
): unknown {
  if (!(error instanceof LlmProviderError)) {
    return error;
  }

  if (error.kind === CloudConnectionFailureKind.Authentication) {
    return explainExpiredAzureSecret(error);
  }

  if (error.kind === CloudConnectionFailureKind.Permission) {
    return new LlmProviderError({
      message: `The app may not ${data.writing ? "change" : "read"} storage account ${data.account.name}: it needs ${
        data.writing ? WRITE_PERMISSION : READ_PERMISSION
      }. Turn on the connection's "Data security response" setting and run its updated setup command.`,
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
 * Turns a storage account's anonymous blob access off, unless it is off
 * already. Throws when the account cannot be read or changed, with what
 * to do.
 */
export async function blockAzureStoragePublicAccess(
  settings: CloudConnectionSettings,
  options: {
    connectionId: string;
    // The storage account's ARM id.
    resourceId: string;
    transport?: CloudConnectorTransport | undefined;
    // The clock, or the time itself; the system clock when absent.
    now?: (() => Date) | Date | undefined;
    budget?: CloudReadBudget | undefined;
  },
): Promise<DataSecurityResponseResult> {
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
  const url: string = `${arm.getManagementBaseUrl()}${account.resourceId}?${buildQueryString(
    [["api-version", STORAGE_API_VERSION]],
  )}`;

  let current: JSONObject;

  try {
    current = await arm.getJson(url, "storage account request");
  } catch (error) {
    throw explainFailure(error, { account, writing: false });
  }

  // Unset is allowed, as Azure reads it: only false is off.
  if (readObject(current["properties"])["allowBlobPublicAccess"] === false) {
    return {
      changed: false,
      summary: `Anonymous blob access is already off on storage account ${account.name}; nothing changed.`,
    };
  }

  try {
    await arm.patch(
      url,
      { properties: { allowBlobPublicAccess: false } },
      "storage account update",
    );
  } catch (error) {
    throw explainFailure(error, { account, writing: true });
  }

  return {
    changed: true,
    summary: `Turned off anonymous blob access on storage account ${account.name}: no container in it can be read anonymously now.`,
  };
}
