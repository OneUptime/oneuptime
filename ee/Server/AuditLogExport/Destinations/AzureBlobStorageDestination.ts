import { createHmac } from "crypto";
import AuditLogExportSettingsUtil, {
  AuditLogExportSettings,
  getAuditLogExportFolder,
} from "Common/Server/Utils/AuditLog/Export/AuditLogExportSettings";
import { readXmlTag } from "Common/Server/Utils/CloudConnection/Aws/AwsApi";
import { DestinationAnswer } from "Common/Server/Utils/SecurityEvent/Destinations/BatchSender";
import {
  AuditLogExportAzureAuthentication,
  AuditLogExportAzureCloud,
} from "Common/Types/AuditLog/Export/AuditLogExportDestinationCatalog";
import Dictionary from "Common/Types/Dictionary";
import {
  AUDIT_LOG_EXPORT_FILE_CONTENT_TYPE,
  getAuditLogExportObjectKey,
  toAuditLogExportFile,
} from "../AuditLogExportFiles";
import {
  defaultAuditLogExportHttpTransport,
  sendDestinationRequest,
  toDeliveryError,
} from "./DestinationHttp";
import {
  AuditLogExportDelivery,
  AuditLogExportDeliveryReceipt,
  AuditLogExportDestination,
  AuditLogExportHttpTransport,
} from "./Types";

/*
 * Azure Blob Storage: one Put Blob (a block blob) per batch.
 *
 *   PUT https://<account>.blob.core.windows.net/<container>/<blob>
 *
 * Signed in one of two ways:
 *
 *   - a shared access signature (SAS) token, appended to the address: it
 *     can be limited to creating and writing blobs in this one container,
 *     which is what an export needs and all it should have;
 *   - an access key of the storage account, which signs each request
 *     (Shared Key: an HMAC-SHA256 of the request's canonical form) and
 *     opens the whole account.
 * https://learn.microsoft.com/rest/api/storageservices/authorize-with-shared-key
 */

// The Blob service version the requests speak (Shared Key signs it).
export const AZURE_BLOB_API_VERSION: string = "2021-12-02";

const SERVICE_TITLE: string = "Azure Blob Storage";

const BLOB_HOST_SUFFIXES: Record<string, string> = {
  [AuditLogExportAzureCloud.Public]: "blob.core.windows.net",
  [AuditLogExportAzureCloud.UsGovernment]: "blob.core.usgovcloudapi.net",
  [AuditLogExportAzureCloud.China]: "blob.core.chinacloudapi.cn",
};

export function getAzureBlobHost(data: {
  accountName: string;
  cloud: string;
}): string {
  const suffix: string =
    BLOB_HOST_SUFFIXES[data.cloud] ||
    BLOB_HOST_SUFFIXES[AuditLogExportAzureCloud.Public]!;

  return `${data.accountName}.${suffix}`;
}

// The blob's path, each part encoded, as the URL and the signature both name it.
export function getAzureBlobPath(data: {
  container: string;
  blobName: string;
}): string {
  return `/${encodeURIComponent(data.container)}/${data.blobName
    .split("/")
    .map((part: string): string => {
      return encodeURIComponent(part);
    })
    .join("/")}`;
}

/*
 * The Shared Key signature of a request: the string Azure signs, as its
 * documentation spells it (verb, the standard headers in their fixed
 * order, the x-ms- headers sorted, then the account and the path), and the
 * Authorization header made of it. Pure, so the tests check it against
 * the documented form and against a server that verifies it.
 */
export function signAzureSharedKey(data: {
  method: string;
  accountName: string;
  accountKey: string;
  path: string;
  headers: Dictionary<string>;
}): { stringToSign: string; authorization: string } {
  const lower: Dictionary<string> = {};

  for (const name of Object.keys(data.headers)) {
    lower[name.toLowerCase()] = String(data.headers[name] ?? "");
  }

  const contentLength: string =
    lower["content-length"] && lower["content-length"] !== "0"
      ? lower["content-length"]
      : "";

  const canonicalizedHeaders: string = Object.keys(lower)
    .filter((name: string): boolean => {
      return name.startsWith("x-ms-");
    })
    .sort()
    .map((name: string): string => {
      return `${name}:${(lower[name] || "").trim()}\n`;
    })
    .join("");

  const stringToSign: string = [
    data.method.toUpperCase(),
    lower["content-encoding"] || "",
    lower["content-language"] || "",
    contentLength,
    lower["content-md5"] || "",
    lower["content-type"] || "",
    // Date: empty, x-ms-date is signed instead.
    "",
    lower["if-modified-since"] || "",
    lower["if-match"] || "",
    lower["if-none-match"] || "",
    lower["if-unmodified-since"] || "",
    lower["range"] || "",
    `${canonicalizedHeaders}/${data.accountName}${data.path}`,
  ].join("\n");

  const signature: string = createHmac(
    "sha256",
    Buffer.from(data.accountKey, "base64"),
  )
    .update(stringToSign, "utf8")
    .digest("base64");

  return {
    stringToSign,
    authorization: `SharedKey ${data.accountName}:${signature}`,
  };
}

export function describeAzureBlobFailure(data: {
  answer: DestinationAnswer;
  accountName: string;
  container: string;
  usesSasToken: boolean;
}): string {
  const answer: DestinationAnswer = data.answer;
  const code: string = readXmlTag(answer.bodyText || "", "Code");
  const status: string = `HTTP ${answer.status}${code ? `, ${code}` : ""}`;
  const credential: string = data.usesSasToken ? "SAS token" : "access key";

  switch (code) {
    case "AuthenticationFailed":
      return data.usesSasToken
        ? `Azure refused the SAS token (${status}). It may have expired, or belong to another storage account. Create a new one for the container.`
        : `Azure refused the access key (${status}). Check that it is a current key of the storage account ${data.accountName}.`;
    case "AuthorizationPermissionMismatch":
    case "AuthorizationFailure":
    case "AuthorizationResourceTypeMismatch":
    case "AuthorizationServiceMismatch":
      return `The ${credential} may not write blobs in the container ${data.container} (${status}). Give it Create and Write permission on blobs in the container.`;
    case "ContainerNotFound":
      return `The container ${data.container} does not exist in the storage account ${data.accountName} (${status}). Create it, or check the container name.`;
    case "AccountIsDisabled":
      return `The storage account ${data.accountName} is disabled (${status}).`;
    case "ServerBusy":
    case "InternalError":
    case "OperationTimedOut":
      return `${SERVICE_TITLE} is busy (${status}). It is retried automatically.`;
    default:
      break;
  }

  if (answer.status === 401 || answer.status === 403) {
    return `Azure refused the ${credential} (${status}). Check it, and that it may write blobs in the container ${data.container}.`;
  }

  if (answer.status === 404) {
    return `The container ${data.container} was not found in the storage account ${data.accountName} (${status}).`;
  }

  if (answer.status === 429 || answer.status >= 500) {
    return `${SERVICE_TITLE} is busy (${status}). It is retried automatically.`;
  }

  const message: string = readXmlTag(answer.bodyText || "", "Message");

  return `${SERVICE_TITLE} did not accept the file (${status})${
    message ? `: ${message}` : "."
  }`;
}

export default class AzureBlobStorageDestination
  implements AuditLogExportDestination
{
  private readonly transport: AuditLogExportHttpTransport;
  private readonly now: () => Date;

  public constructor(
    options: {
      transport?: AuditLogExportHttpTransport | undefined;
      now?: (() => Date) | undefined;
    } = {},
  ) {
    this.transport = options.transport || defaultAuditLogExportHttpTransport;
    this.now =
      options.now ||
      ((): Date => {
        return new Date();
      });
  }

  public async deliver(
    delivery: AuditLogExportDelivery,
  ): Promise<AuditLogExportDeliveryReceipt> {
    const settings: AuditLogExportSettings = delivery.settings;
    const read: (key: string) => string = (key: string): string => {
      return AuditLogExportSettingsUtil.readConfigText(settings, key);
    };

    const accountName: string = read("accountName");
    const container: string = read("container");
    const usesSasToken: boolean =
      read("authentication") !== AuditLogExportAzureAuthentication.AccessKey;
    const blobName: string = getAuditLogExportObjectKey({
      folder: getAuditLogExportFolder(settings.config),
      batch: delivery.batch,
    });

    const host: string = getAzureBlobHost({
      accountName,
      cloud: read("cloud"),
    });
    const path: string = getAzureBlobPath({ container, blobName });
    const body: Buffer = toAuditLogExportFile(delivery.batch);

    const headers: Dictionary<string> = {
      "Content-Type": AUDIT_LOG_EXPORT_FILE_CONTENT_TYPE,
      "Content-Length": String(body.length),
      "x-ms-blob-type": "BlockBlob",
      "x-ms-date": this.now().toUTCString(),
      "x-ms-version": AZURE_BLOB_API_VERSION,
    };

    let url: string = `https://${host}${path}`;
    let secretValues: Array<string> = [];

    if (usesSasToken) {
      let sasToken: string = AuditLogExportSettingsUtil.readSecretText(
        settings,
        "sasToken",
      );

      if (sasToken.startsWith("?")) {
        sasToken = sasToken.slice(1);
      }

      url = `${url}?${sasToken}`;
      secretValues = [sasToken];
    } else {
      const accountKey: string = AuditLogExportSettingsUtil.readSecretText(
        settings,
        "accountKey",
      );

      headers["Authorization"] = signAzureSharedKey({
        method: "PUT",
        accountName,
        accountKey,
        path,
        headers,
      }).authorization;
      secretValues = [accountKey];
    }

    const answer: DestinationAnswer = await sendDestinationRequest({
      transport: this.transport,
      request: {
        method: "PUT",
        url,
        headers,
        body,
        egressOptions: delivery.egress,
      },
      serviceTitle: `${SERVICE_TITLE} at ${host}`,
      secretValues,
      unreachableHint: "Check the storage account name and the cloud.",
    });

    if (answer.ok) {
      return {
        location: `https://${host}${path}`,
      };
    }

    throw toDeliveryError({
      answer,
      message: describeAzureBlobFailure({
        answer,
        accountName,
        container,
        usesSasToken,
      }),
      secretValues,
    });
  }
}
