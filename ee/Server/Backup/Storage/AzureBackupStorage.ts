import BackupSettingsUtil, {
  BackupDestinationSettings,
} from "Common/Server/Utils/Backup/BackupSettings";
import { readXmlTag } from "Common/Server/Utils/CloudConnection/Aws/AwsApi";
import Dictionary from "Common/Types/Dictionary";
import {
  AZURE_BLOB_API_VERSION,
  getAzureBlobHost,
  getAzureBlobPath,
  signAzureSharedKey,
} from "../../AuditLogExport/Destinations/AzureBlobStorageDestination";
import {
  BackupHttpMethod,
  BackupHttpResponse,
  BackupHttpTransport,
  describeTransportError,
  discardResponse,
  isRetryableStatus,
  readResponseBytes,
  readResponseText,
  withRetries,
} from "./BackupHttp";
import {
  BackupDownload,
  BackupListing,
  BackupObject,
  BackupStorage,
  BackupStorageError,
  BackupUploadOptions,
  BackupUploadResult,
} from "./BackupStorage";
import {
  chooseBackupPartSize,
  PartUploadResult,
  UploadedPart,
  uploadInParts,
} from "./PartUploader";
import { escapeXmlText, readXmlBlocks } from "./S3BackupStorage";

/*
 * Backups on Azure Blob Storage, as block blobs: a small file in one Put
 * Blob, a large one as equal blocks (Put Block) committed by a block list
 * (Put Block List) - nothing is visible until the list commits, so a
 * backup that fails leaves no half-file, only uncommitted blocks Azure
 * drops after a week. Signed the audit log export's way (its host, path
 * and Shared Key signer, which also signs a request's query here), with a
 * SAS token or an access key.
 *
 * A SAS token needs Read, Add, Create, Write, Delete and List on the
 * container (sp=racwdl); an access key opens the whole account.
 */

const SERVICE_TITLE: string = "Azure Blob Storage";

// Azure's limit on the blocks of one blob.
export const AZURE_MAX_BLOCKS: number = 50000;

const MAX_ERROR_TEXT_IN_BYTES: number = 64 * 1024;

/*
 * A block's id: the same length for every block of a blob, as Azure
 * requires - the part number, zero-padded, in base64.
 */
export function getAzureBlockId(partNumber: number): string {
  return Buffer.from(
    `oneuptime-block-${String(partNumber).padStart(6, "0")}`,
    "utf8",
  ).toString("base64");
}

export function describeAzureBackupFailure(data: {
  status: number;
  bodyText: string;
  accountName: string;
  container: string;
  usesSasToken: boolean;
  operation: string;
}): string {
  const code: string = readXmlTag(data.bodyText || "", "Code");
  const status: string = `HTTP ${data.status}${code ? `, ${code}` : ""}`;
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
      return `The ${credential} may not ${data.operation} in the container ${data.container} (${status}). Give it Read, Add, Create, Write, Delete and List on the container.`;
    case "ContainerNotFound":
      return `The container ${data.container} does not exist in the storage account ${data.accountName} (${status}). Create it, or check the container name.`;
    case "AccountIsDisabled":
      return `The storage account ${data.accountName} is disabled (${status}).`;
    case "ServerBusy":
    case "InternalError":
    case "OperationTimedOut":
      return `${SERVICE_TITLE} is busy (${status}). Try again later.`;
    default:
      break;
  }

  if (data.status === 401 || data.status === 403) {
    return `Azure refused the ${credential} (${status}). Check it, and that it may read, write, list and delete blobs in the container ${data.container}.`;
  }

  if (data.status === 404) {
    return `${SERVICE_TITLE} did not find what was asked for in the container ${data.container} (${status}).`;
  }

  if (data.status === 429 || data.status >= 500) {
    return `${SERVICE_TITLE} is busy (${status}). Try again later.`;
  }

  const message: string = readXmlTag(data.bodyText || "", "Message");

  return `${SERVICE_TITLE} could not ${data.operation} (${status})${
    message ? `: ${message.split("\n")[0]}` : "."
  }`;
}

interface AzureRequest {
  method: BackupHttpMethod;
  // A blob's name, or null for the container (a listing).
  blobName: string | null;
  query?: Dictionary<string> | undefined;
  headers?: Dictionary<string> | undefined;
  body?: Buffer | undefined;
  operation: string;
  acceptStatuses?: Array<number> | undefined;
}

export default class AzureBackupStorage implements BackupStorage {
  public readonly title: string = SERVICE_TITLE;
  private readonly transport: BackupHttpTransport;
  private readonly now: () => Date;
  private readonly accountName: string;
  private readonly container: string;
  private readonly usesSasToken: boolean;
  private readonly sasToken: string;
  private readonly accountKey: string;
  // https://<account>.blob.core.windows.net, or a test's emulator address.
  private readonly baseUrl: string;
  // The base address's own path ("" on Azure, "/devstoreaccount1" on Azurite).
  private readonly basePath: string;

  public constructor(options: {
    settings: BackupDestinationSettings;
    transport: BackupHttpTransport;
    now?: (() => Date) | undefined;
    // A test seam: the blob service's address (Azurite's path-style one).
    blobEndpoint?: string | undefined;
  }) {
    const settings: BackupDestinationSettings = options.settings;

    this.transport = options.transport;
    this.now =
      options.now ||
      ((): Date => {
        return new Date();
      });
    this.accountName = BackupSettingsUtil.readConfigText(
      settings,
      "accountName",
    );
    this.container = BackupSettingsUtil.readConfigText(settings, "container");
    this.usesSasToken = BackupSettingsUtil.usesAzureSasToken(settings);

    let sasToken: string = BackupSettingsUtil.readSecretText(
      settings,
      "sasToken",
    );

    while (sasToken.startsWith("?")) {
      sasToken = sasToken.slice(1);
    }

    this.sasToken = sasToken;
    this.accountKey = BackupSettingsUtil.readSecretText(settings, "accountKey");

    const endpoint: string =
      options.blobEndpoint ||
      `https://${getAzureBlobHost({
        accountName: this.accountName,
        cloud: BackupSettingsUtil.readConfigText(settings, "cloud"),
      })}`;
    const url: URL = new URL(endpoint);
    let basePath: string = url.pathname;

    while (basePath.endsWith("/")) {
      basePath = basePath.slice(0, -1);
    }

    this.basePath = basePath;
    this.baseUrl = `${url.protocol}//${url.host}`;
  }

  // The blob service's address: what ClickHouse is pointed at too.
  public getServiceUrl(): string {
    return `${this.baseUrl}${this.basePath}`;
  }

  public describeKey(key: string): string {
    return `${this.getServiceUrl()}/${this.container}/${key}`;
  }

  private redact(message: string): string {
    let text: string = message;

    for (const secret of [this.sasToken, this.accountKey]) {
      if (secret) {
        text = text.split(secret).join("[REDACTED]");
      }
    }

    return text;
  }

  private getPath(blobName: string | null): string {
    if (blobName === null) {
      return `${this.basePath}/${encodeURIComponent(this.container)}`;
    }

    return `${this.basePath}${getAzureBlobPath({
      container: this.container,
      blobName,
    })}`;
  }

  private async send(request: AzureRequest): Promise<BackupHttpResponse> {
    return await withRetries<BackupHttpResponse>({
      attempt: async (): Promise<BackupHttpResponse> => {
        const path: string = this.getPath(request.blobName);
        const headers: Dictionary<string> = {
          ...(request.headers || {}),
          "x-ms-date": this.now().toUTCString(),
          "x-ms-version": AZURE_BLOB_API_VERSION,
        };

        if (request.body !== undefined) {
          headers["Content-Length"] = String(request.body.length);
        }

        const queryParts: Array<string> = Object.keys(request.query || {}).map(
          (name: string): string => {
            return `${encodeURIComponent(name)}=${encodeURIComponent(
              (request.query || {})[name] || "",
            )}`;
          },
        );

        if (this.usesSasToken) {
          queryParts.push(this.sasToken);
        } else {
          headers["Authorization"] = signAzureSharedKey({
            method: request.method,
            accountName: this.accountName,
            accountKey: this.accountKey,
            path,
            headers,
            query: request.query,
          }).authorization;
        }

        const url: string = `${this.baseUrl}${path}${
          queryParts.length > 0 ? `?${queryParts.join("&")}` : ""
        }`;

        let response: BackupHttpResponse;

        try {
          response = await this.transport({
            method: request.method,
            url,
            headers,
            body: request.body,
          });
        } catch (error) {
          const described: BackupStorageError = describeTransportError({
            error,
            serviceTitle: `${SERVICE_TITLE} at ${new URL(this.baseUrl).host}`,
            hint: "Check the storage account name and the cloud.",
          });

          throw new BackupStorageError(this.redact(described.message), {
            retryable: described.retryable,
          });
        }

        const isAccepted: boolean =
          (response.statusCode >= 200 && response.statusCode < 300) ||
          (request.acceptStatuses || []).includes(response.statusCode);

        if (isAccepted) {
          return response;
        }

        const bodyText: string =
          request.method === "HEAD"
            ? ""
            : await readResponseText(response, MAX_ERROR_TEXT_IN_BYTES).catch(
                (): string => {
                  return "";
                },
              );

        throw new BackupStorageError(
          this.redact(
            describeAzureBackupFailure({
              status: response.statusCode,
              bodyText,
              accountName: this.accountName,
              container: this.container,
              usesSasToken: this.usesSasToken,
              operation: request.operation,
            }),
          ),
          {
            retryable: isRetryableStatus(response.statusCode),
            status: response.statusCode,
            code:
              readXmlTag(bodyText, "Code") ||
              response.headers["x-ms-error-code"] ||
              "",
          },
        );
      },
    });
  }

  public async putObject(data: {
    key: string;
    body: Buffer;
    contentType: string;
  }): Promise<void> {
    const response: BackupHttpResponse = await this.send({
      method: "PUT",
      blobName: data.key,
      headers: {
        "Content-Type": data.contentType,
        "x-ms-blob-type": "BlockBlob",
      },
      body: data.body,
      operation: "write blobs",
    });

    discardResponse(response);
  }

  public async upload(
    options: BackupUploadOptions,
  ): Promise<BackupUploadResult> {
    const partSizeInBytes: number = chooseBackupPartSize({
      expectedSizeInBytes: options.expectedSizeInBytes,
      maxParts: AZURE_MAX_BLOCKS,
    });

    const result: PartUploadResult = await uploadInParts({
      source: options.source,
      partSizeInBytes,
      maxParts: AZURE_MAX_BLOCKS,
      serviceTitle: SERVICE_TITLE,
      signal: options.signal,
      onProgress: options.onProgress,
      putWhole: async (body: Buffer): Promise<void> => {
        await this.putObject({
          key: options.key,
          body,
          contentType: options.contentType,
        });
      },
      uploadPart: async (partNumber: number, body: Buffer): Promise<string> => {
        const blockId: string = getAzureBlockId(partNumber);
        const response: BackupHttpResponse = await this.send({
          method: "PUT",
          blobName: options.key,
          query: { comp: "block", blockid: blockId },
          body,
          operation: "write blobs",
        });
        discardResponse(response);

        return blockId;
      },
    });

    if (!result.isSinglePut) {
      const body: Buffer = Buffer.from(
        `<?xml version="1.0" encoding="utf-8"?>\n<BlockList>${result.parts
          .map((part: UploadedPart): string => {
            return `<Latest>${escapeXmlText(part.token)}</Latest>`;
          })
          .join("")}</BlockList>`,
        "utf8",
      );

      const response: BackupHttpResponse = await this.send({
        method: "PUT",
        blobName: options.key,
        query: { comp: "blocklist" },
        headers: {
          "Content-Type": "application/xml",
          "x-ms-blob-content-type": options.contentType,
        },
        body,
        operation: "write blobs",
      });
      discardResponse(response);
    }

    return { sizeInBytes: result.sizeInBytes, sha256: result.sha256 };
  }

  public async download(key: string): Promise<BackupDownload> {
    const response: BackupHttpResponse = await this.send({
      method: "GET",
      blobName: key,
      operation: "read blobs",
    });
    const length: number = Number(response.headers["content-length"]);

    return {
      stream: response.body,
      sizeInBytes: Number.isFinite(length) ? length : null,
    };
  }

  public async readSmallObject(
    key: string,
    maxBytes: number,
  ): Promise<Buffer | null> {
    const response: BackupHttpResponse = await this.send({
      method: "GET",
      blobName: key,
      operation: "read blobs",
      acceptStatuses: [404],
    });

    if (response.statusCode === 404) {
      discardResponse(response);
      return null;
    }

    return await readResponseBytes(response, maxBytes);
  }

  public async headObject(key: string): Promise<BackupObject | null> {
    const response: BackupHttpResponse = await this.send({
      method: "HEAD",
      blobName: key,
      operation: "read blobs",
      acceptStatuses: [404],
    });
    discardResponse(response);

    if (response.statusCode === 404) {
      return null;
    }

    const length: number = Number(response.headers["content-length"]);
    const modified: string | undefined = response.headers["last-modified"];

    return {
      key,
      sizeInBytes: Number.isFinite(length) ? length : 0,
      ...(modified ? { lastModified: new Date(modified) } : {}),
    };
  }

  public async list(data: {
    prefix: string;
    delimiter?: string | undefined;
  }): Promise<BackupListing> {
    const listing: BackupListing = { objects: [], prefixes: [] };
    let marker: string = "";

    for (;;) {
      const query: Dictionary<string> = {
        restype: "container",
        comp: "list",
        prefix: data.prefix,
        maxresults: "5000",
      };

      if (data.delimiter) {
        query["delimiter"] = data.delimiter;
      }

      if (marker) {
        query["marker"] = marker;
      }

      const response: BackupHttpResponse = await this.send({
        method: "GET",
        blobName: null,
        query,
        operation: "list blobs",
      });
      const text: string = await readResponseText(response);

      for (const block of readXmlBlocks(text, "Blob")) {
        const name: string = readXmlTag(block, "Name");

        if (!name) {
          continue;
        }

        const size: number = Number(readXmlTag(block, "Content-Length"));
        const modified: string = readXmlTag(block, "Last-Modified");

        listing.objects.push({
          key: name,
          sizeInBytes: Number.isFinite(size) ? size : 0,
          ...(modified ? { lastModified: new Date(modified) } : {}),
        });
      }

      for (const block of readXmlBlocks(text, "BlobPrefix")) {
        const name: string = readXmlTag(block, "Name");

        if (name) {
          listing.prefixes.push(name);
        }
      }

      const nextMarker: string = readXmlTag(text, "NextMarker");

      if (!nextMarker || nextMarker === marker) {
        return listing;
      }

      marker = nextMarker;
    }
  }

  public async deleteObject(key: string): Promise<void> {
    const response: BackupHttpResponse = await this.send({
      method: "DELETE",
      blobName: key,
      operation: "delete blobs",
      acceptStatuses: [404],
    });
    discardResponse(response);
  }
}
