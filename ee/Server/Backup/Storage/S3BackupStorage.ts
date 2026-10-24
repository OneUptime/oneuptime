import { createHash } from "crypto";
import BackupSettingsUtil, {
  BackupDestinationSettings,
} from "Common/Server/Utils/Backup/BackupSettings";
import { readXmlTag } from "Common/Server/Utils/CloudConnection/Aws/AwsApi";
import AwsSecurityHubClient, {
  AwsSigV4SignResult,
} from "Common/Server/Utils/SecurityEvent/Connectors/AwsSecurityHub/AwsSecurityHubClient";
import BackupDestinationType from "Common/Types/Backup/BackupDestinationType";
import Dictionary from "Common/Types/Dictionary";
import { getS3Target, S3Target } from "../../AuditLogExport/Destinations/S3Destination";
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

/*
 * Backups on Amazon S3, on every storage with an S3 API (MinIO, Cloudflare
 * R2, Backblaze B2, Wasabi, Ceph...), and on Google Cloud Storage through
 * its S3-compatible XML API with an HMAC key. Every request is signed with
 * Signature Version 4 by the signer the audit log export and the AWS
 * connectors share, and addressed as the audit log export addresses one
 * (getS3Target): Amazon S3 by the bucket's own host, everything else in
 * the path.
 *
 * A large file goes up as a multipart upload of equal parts (PartUploader),
 * each signed by its SHA-256 so the storage refuses a part that arrives
 * changed; an upload that fails is aborted, so no half-file is left. A
 * listing uses ListObjects (version 1), the one every one of these storages
 * answers. Amazon S3 is asked to encrypt what it stores (SSE-S3), which it
 * also does on its own for every new object.
 *
 * The key needs s3:PutObject, s3:GetObject, s3:ListBucket, s3:DeleteObject
 * and s3:AbortMultipartUpload on the folder - nothing else.
 */

const S3_SERVICE: string = "s3";

// S3's limit on the parts of one upload.
export const S3_MAX_PARTS: number = 10000;

const EMPTY_SHA256: string = createHash("sha256").update("").digest("hex");

const MAX_ERROR_TEXT_IN_BYTES: number = 64 * 1024;

export function sha256Hex(body: Buffer): string {
  return createHash("sha256").update(body).digest("hex");
}

// Every block of a tag in an XML document, in order: <Contents>...</Contents>.
export function readXmlBlocks(xml: string, tag: string): Array<string> {
  const open: string = `<${tag}>`;
  const close: string = `</${tag}>`;
  const blocks: Array<string> = [];
  let from: number = 0;

  for (;;) {
    const start: number = xml.indexOf(open, from);

    if (start < 0) {
      return blocks;
    }

    const valueStart: number = start + open.length;
    const end: number = xml.indexOf(close, valueStart);

    if (end < 0) {
      return blocks;
    }

    blocks.push(xml.slice(valueStart, end));
    from = end + close.length;
  }
}

export function escapeXmlText(value: string): string {
  return value
    .split("&")
    .join("&amp;")
    .split("<")
    .join("&lt;")
    .split(">")
    .join("&gt;")
    .split('"')
    .join("&quot;");
}

export function getS3ServiceTitle(type: BackupDestinationType): string {
  switch (type) {
    case BackupDestinationType.AmazonS3:
      return "Amazon S3";
    case BackupDestinationType.GoogleCloudStorage:
      return "Google Cloud Storage";
    default:
      return "The S3-compatible storage";
  }
}

/*
 * What the storage refused, and what to change, from the XML error it
 * answers with - in a backup's words: the key may need to read, list and
 * delete as well as write.
 */
export function describeS3BackupFailure(data: {
  status: number;
  bodyText: string;
  type: BackupDestinationType;
  bucket: string;
  folder: string;
  operation: string;
}): string {
  const serviceTitle: string = getS3ServiceTitle(data.type);
  const code: string = readXmlTag(data.bodyText || "", "Code");
  const status: string = `HTTP ${data.status}${code ? `, ${code}` : ""}`;
  const checkBucket: string =
    data.type === BackupDestinationType.S3Compatible
      ? "Check the bucket name and the endpoint"
      : "Check the bucket name";

  switch (code) {
    case "InvalidAccessKeyId":
      return `${serviceTitle} does not know this access key (${status}). Check the Access key ID.`;
    case "SignatureDoesNotMatch":
      return `${serviceTitle} refused the signature (${status}): the secret does not belong to this access key. Check the secret.`;
    case "AccessDenied":
    case "AllAccessDisabled":
      return `${serviceTitle} did not let this key ${data.operation} (${status}). Allow it to read, write, list and delete objects in ${data.bucket}/${data.folder}.`;
    case "NoSuchBucket":
      return `The bucket ${data.bucket} does not exist (${status}). ${checkBucket}.`;
    case "InvalidBucketName":
      return `${serviceTitle} refused the bucket name ${data.bucket} (${status}).`;
    case "AuthorizationHeaderMalformed":
    case "PermanentRedirect":
    case "IllegalLocationConstraintException": {
      const region: string =
        readXmlTag(data.bodyText || "", "Region") ||
        readXmlTag(data.bodyText || "", "BucketRegion");

      return `The bucket ${data.bucket} is in another region${
        region ? ` (${region})` : ""
      } (${status}). Set Region to the bucket's region.`;
    }
    case "RequestTimeTooSkewed":
      return `${serviceTitle} refused the request because this server's clock is too far from its own (${status}). Check the server's time.`;
    case "EntityTooLarge":
      return `${serviceTitle} refused a part as too large (${status}).`;
    case "QuotaExceeded":
    case "StorageQuotaExceeded":
      return `${serviceTitle} has no room left for the backup (${status}). Free space or raise the quota.`;
    case "SlowDown":
    case "ServiceUnavailable":
    case "InternalError":
      return `${serviceTitle} is busy (${status}). Try again later.`;
    default:
      break;
  }

  if (data.status === 301 || data.status === 307) {
    return `The bucket ${data.bucket} is in another region (${status}). Set Region to the bucket's region.`;
  }

  if (data.status === 401 || data.status === 403) {
    return `${serviceTitle} refused the key (${status}). Check it, and that it may read, write, list and delete objects in the bucket.`;
  }

  if (data.status === 404) {
    return `${serviceTitle} did not find what was asked for in ${data.bucket} (${status}). ${checkBucket}.`;
  }

  if (data.status === 429 || data.status >= 500) {
    return `${serviceTitle} is busy (${status}). Try again later.`;
  }

  const detail: string = readXmlTag(data.bodyText || "", "Message");

  return `${serviceTitle} could not ${data.operation} (${status})${
    detail ? `: ${detail}` : "."
  }`;
}

interface S3Request {
  method: BackupHttpMethod;
  key: string | null;
  query?: Dictionary<string> | undefined;
  headers?: Dictionary<string> | undefined;
  body?: Buffer | undefined;
  // What the request does, for its error: "write the backup".
  operation: string;
  // Statuses that are an answer rather than an error (404 for a lookup).
  acceptStatuses?: Array<number> | undefined;
}

export default class S3BackupStorage implements BackupStorage {
  public readonly title: string;
  private readonly settings: BackupDestinationSettings;
  private readonly transport: BackupHttpTransport;
  private readonly now: () => Date;
  private readonly isAmazonS3: boolean;
  private readonly bucket: string;
  private readonly region: string;
  private readonly endpoint: string;
  private readonly accessKeyId: string;
  private readonly secretAccessKey: string;
  private readonly folder: string;

  public constructor(options: {
    settings: BackupDestinationSettings;
    transport: BackupHttpTransport;
    now?: (() => Date) | undefined;
  }) {
    this.settings = options.settings;
    this.transport = options.transport;
    this.now =
      options.now ||
      ((): Date => {
        return new Date();
      });
    this.isAmazonS3 = this.settings.type === BackupDestinationType.AmazonS3;
    this.title = getS3ServiceTitle(this.settings.type);
    this.bucket = BackupSettingsUtil.readConfigText(this.settings, "bucket");
    this.region = BackupSettingsUtil.getS3Region(this.settings);
    this.endpoint = BackupSettingsUtil.getS3Endpoint(this.settings) || "";
    this.accessKeyId = BackupSettingsUtil.readConfigText(
      this.settings,
      "accessKeyId",
    );
    this.secretAccessKey = BackupSettingsUtil.readSecretText(
      this.settings,
      "secretAccessKey",
    );
    this.folder = BackupSettingsUtil.getFolder(this.settings);
  }

  public describeKey(key: string): string {
    if (this.settings.type === BackupDestinationType.GoogleCloudStorage) {
      return `gs://${this.bucket}/${key}`;
    }

    return `s3://${this.bucket}/${key}`;
  }

  // The secret, and anything secret-looking, out of a sentence.
  private redact(message: string): string {
    return this.secretAccessKey
      ? message.split(this.secretAccessKey).join("[REDACTED]")
      : message;
  }

  /*
   * Where a request goes: an object's address (getS3Target, the audit log
   * export's), or the bucket's for a listing - "/" on Amazon S3's bucket
   * host, "/<bucket>" in the path otherwise.
   */
  private getTarget(key: string | null): S3Target {
    if (key !== null) {
      return getS3Target({
        isAmazonS3: this.isAmazonS3,
        endpoint: this.endpoint,
        bucket: this.bucket,
        region: this.region,
        key,
      });
    }

    const objectTarget: S3Target = getS3Target({
      isAmazonS3: this.isAmazonS3,
      endpoint: this.endpoint,
      bucket: this.bucket,
      region: this.region,
      key: "x",
    });
    // The object path without its last "/x": the bucket's own path.
    const signingPath: string = objectTarget.signingPath.slice(0, -2) || "/";
    const base: string = objectTarget.url.slice(
      0,
      objectTarget.url.length - objectTarget.signingPath.length,
    );

    return {
      host: objectTarget.host,
      signingPath,
      url: `${base}${signingPath
        .split("/")
        .map((segment: string): string => {
          return AwsSecurityHubClient.uriEncode(segment);
        })
        .join("/")}`,
      location: `s3://${this.bucket}/`,
    };
  }

  private async send(request: S3Request): Promise<BackupHttpResponse> {
    return await withRetries<BackupHttpResponse>({
      attempt: async (): Promise<BackupHttpResponse> => {
        const target: S3Target = this.getTarget(request.key);
        const payloadHash: string = request.body
          ? sha256Hex(request.body)
          : EMPTY_SHA256;
        const headers: Dictionary<string> = {
          ...(request.headers || {}),
          "x-amz-content-sha256": payloadHash,
        };

        const signed: AwsSigV4SignResult = AwsSecurityHubClient.signRequest({
          method: request.method,
          host: target.host,
          path: target.signingPath,
          query: request.query,
          headers,
          body: "",
          payloadHash,
          accessKeyId: this.accessKeyId,
          secretAccessKey: this.secretAccessKey,
          region: this.region,
          service: S3_SERVICE,
          date: this.now(),
        });

        const queryString: string = Object.keys(request.query || {})
          .map((name: string): string => {
            const value: string = (request.query || {})[name] || "";

            return value === ""
              ? AwsSecurityHubClient.uriEncode(name)
              : `${AwsSecurityHubClient.uriEncode(name)}=${AwsSecurityHubClient.uriEncode(value)}`;
          })
          .join("&");

        let response: BackupHttpResponse;

        try {
          response = await this.transport({
            method: request.method,
            url: queryString ? `${target.url}?${queryString}` : target.url,
            headers: signed.headers,
            body: request.body,
          });
        } catch (error) {
          const described: BackupStorageError = describeTransportError({
            error,
            serviceTitle: this.title,
            hint:
              this.settings.type === BackupDestinationType.S3Compatible
                ? "Check the endpoint."
                : undefined,
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
            describeS3BackupFailure({
              status: response.statusCode,
              bodyText,
              type: this.settings.type,
              bucket: this.bucket,
              folder: this.folder,
              operation: request.operation,
            }),
          ),
          {
            retryable: isRetryableStatus(response.statusCode),
            status: response.statusCode,
            code: readXmlTag(bodyText, "Code"),
          },
        );
      },
    });
  }

  private encryptionHeaders(): Dictionary<string> {
    // Amazon S3 only: MinIO without a KMS refuses the header outright.
    return this.isAmazonS3 ? { "x-amz-server-side-encryption": "AES256" } : {};
  }

  public async putObject(data: {
    key: string;
    body: Buffer;
    contentType: string;
  }): Promise<void> {
    const response: BackupHttpResponse = await this.send({
      method: "PUT",
      key: data.key,
      headers: {
        "Content-Type": data.contentType,
        ...this.encryptionHeaders(),
      },
      body: data.body,
      operation: "write the backup",
    });

    discardResponse(response);
  }

  public async upload(
    options: BackupUploadOptions,
  ): Promise<BackupUploadResult> {
    const partSizeInBytes: number = chooseBackupPartSize({
      expectedSizeInBytes: options.expectedSizeInBytes,
      maxParts: S3_MAX_PARTS,
    });

    let uploadId: string | null = null;

    const start: () => Promise<string> = async (): Promise<string> => {
      if (uploadId) {
        return uploadId;
      }

      const response: BackupHttpResponse = await this.send({
        method: "POST",
        key: options.key,
        query: { uploads: "" },
        headers: {
          "Content-Type": options.contentType,
          ...this.encryptionHeaders(),
        },
        operation: "start the upload",
      });
      const text: string = await readResponseText(response);
      const id: string = readXmlTag(text, "UploadId");

      if (!id) {
        throw new BackupStorageError(
          `${this.title} did not start the upload: its answer had no upload ID.`,
          { retryable: true },
        );
      }

      uploadId = id;

      return id;
    };

    let result: PartUploadResult;

    try {
      result = await uploadInParts({
        source: options.source,
        partSizeInBytes,
        maxParts: S3_MAX_PARTS,
        serviceTitle: this.title,
        signal: options.signal,
        onProgress: options.onProgress,
        putWhole: async (body: Buffer): Promise<void> => {
          await this.putObject({
            key: options.key,
            body,
            contentType: options.contentType,
          });
        },
        uploadPart: async (
          partNumber: number,
          body: Buffer,
        ): Promise<string> => {
          const id: string = await start();
          const response: BackupHttpResponse = await this.send({
            method: "PUT",
            key: options.key,
            query: { partNumber: String(partNumber), uploadId: id },
            body,
            operation: "write the backup",
          });
          discardResponse(response);

          const etag: string = response.headers["etag"] || "";

          if (!etag) {
            throw new BackupStorageError(
              `${this.title} took part ${partNumber} of the backup without an ETag.`,
              { retryable: true },
            );
          }

          return etag;
        },
      });
    } catch (error) {
      await this.abortUpload(options.key, uploadId);
      throw error;
    }

    if (!result.isSinglePut) {
      await this.completeUpload({
        key: options.key,
        uploadId: uploadId!,
        parts: result.parts,
      });
    }

    return { sizeInBytes: result.sizeInBytes, sha256: result.sha256 };
  }

  private async completeUpload(data: {
    key: string;
    uploadId: string;
    parts: Array<UploadedPart>;
  }): Promise<void> {
    const body: Buffer = Buffer.from(
      `<?xml version="1.0" encoding="UTF-8"?>\n<CompleteMultipartUpload>${data.parts
        .map((part: UploadedPart): string => {
          return `<Part><PartNumber>${part.partNumber}</PartNumber><ETag>${escapeXmlText(part.token)}</ETag></Part>`;
        })
        .join("")}</CompleteMultipartUpload>`,
      "utf8",
    );

    try {
      const response: BackupHttpResponse = await this.send({
        method: "POST",
        key: data.key,
        query: { uploadId: data.uploadId },
        headers: { "Content-Type": "application/xml" },
        body,
        operation: "finish the upload",
      });

      /*
       * S3 can answer 200 and still fail the upload: the error is in the
       * body. Read it, and treat an <Error> as the failure it is.
       */
      const text: string = await readResponseText(response, MAX_ERROR_TEXT_IN_BYTES);

      if (text.includes("<Error>")) {
        throw new BackupStorageError(
          this.redact(
            describeS3BackupFailure({
              status: 500,
              bodyText: text,
              type: this.settings.type,
              bucket: this.bucket,
              folder: this.folder,
              operation: "finish the upload",
            }),
          ),
          { retryable: true, status: 500, code: readXmlTag(text, "Code") },
        );
      }
    } catch (error) {
      await this.abortUpload(data.key, data.uploadId);
      throw error;
    }
  }

  // Abandons an upload's parts; a failure here leaves them to the bucket's lifecycle.
  private async abortUpload(key: string, uploadId: string | null): Promise<void> {
    if (!uploadId) {
      return;
    }

    try {
      const response: BackupHttpResponse = await this.send({
        method: "DELETE",
        key,
        query: { uploadId },
        operation: "abandon the upload",
        acceptStatuses: [404],
      });
      discardResponse(response);
    } catch {
      // The parts expire with the bucket's lifecycle rule for incomplete uploads.
    }
  }

  public async download(key: string): Promise<BackupDownload> {
    const response: BackupHttpResponse = await this.send({
      method: "GET",
      key,
      operation: "read the backup",
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
      key,
      operation: "read the backup",
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
      key,
      operation: "look up the backup",
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
        prefix: data.prefix,
        "max-keys": "1000",
      };

      if (data.delimiter) {
        query["delimiter"] = data.delimiter;
      }

      if (marker) {
        query["marker"] = marker;
      }

      const response: BackupHttpResponse = await this.send({
        method: "GET",
        key: null,
        query,
        operation: "list the backups",
      });
      const text: string = await readResponseText(response);
      let lastKey: string = "";

      for (const block of readXmlBlocks(text, "Contents")) {
        const key: string = readXmlTag(block, "Key");

        if (!key) {
          continue;
        }

        const size: number = Number(readXmlTag(block, "Size"));
        const modified: string = readXmlTag(block, "LastModified");

        listing.objects.push({
          key,
          sizeInBytes: Number.isFinite(size) ? size : 0,
          ...(modified ? { lastModified: new Date(modified) } : {}),
        });
        lastKey = key;
      }

      for (const block of readXmlBlocks(text, "CommonPrefixes")) {
        const prefix: string = readXmlTag(block, "Prefix");

        if (prefix) {
          listing.prefixes.push(prefix);
          lastKey = prefix > lastKey ? prefix : lastKey;
        }
      }

      const isTruncated: boolean =
        readXmlTag(text, "IsTruncated").toLowerCase() === "true";
      const nextMarker: string = readXmlTag(text, "NextMarker") || lastKey;

      if (!isTruncated || !nextMarker || nextMarker === marker) {
        return listing;
      }

      marker = nextMarker;
    }
  }

  public async deleteObject(key: string): Promise<void> {
    const response: BackupHttpResponse = await this.send({
      method: "DELETE",
      key,
      operation: "delete an old backup",
      acceptStatuses: [404],
    });
    discardResponse(response);
  }
}
