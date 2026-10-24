import { createHash } from "crypto";
import AuditLogExportSettingsUtil, {
  AuditLogExportSettings,
  getAuditLogExportFolder,
} from "Common/Server/Utils/AuditLog/Export/AuditLogExportSettings";
import {
  getAwsHost,
  readXmlTag,
} from "Common/Server/Utils/CloudConnection/Aws/AwsApi";
import AwsSecurityHubClient, {
  AwsSigV4SignResult,
} from "Common/Server/Utils/SecurityEvent/Connectors/AwsSecurityHub/AwsSecurityHubClient";
import { DestinationAnswer } from "Common/Server/Utils/SecurityEvent/Destinations/BatchSender";
import AuditLogExportDestinationType from "Common/Types/AuditLog/Export/AuditLogExportDestinationType";
import {
  AUDIT_LOG_EXPORT_FILE_CONTENT_TYPE,
  getAuditLogExportObjectKey,
  toAuditLogExportFile,
} from "../AuditLogExportFiles";
import {
  defaultAuditLogExportHttpTransport,
  describeAnswer,
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
 * Amazon S3, and every storage with an S3 API (MinIO, Cloudflare R2,
 * Backblaze B2, Wasabi, Ceph...): one PutObject per batch, signed with
 * Signature Version 4 by the signer the AWS connectors already check
 * against AWS's published test vectors.
 *
 *   PUT https://<bucket>.s3.<region>.amazonaws.com/<key>        Amazon S3
 *   PUT https://s3.<region>.amazonaws.com/<bucket>/<key>        a bucket with dots
 *   PUT <endpoint>/<bucket>/<key>                               S3-compatible
 *
 * Amazon S3 is addressed by the bucket's own host name (the only form new
 * buckets take); a bucket name with a dot cannot be, because the wildcard
 * certificate does not cover it, so it goes in the path. Other storage is
 * addressed in the path, the one form all of them take.
 *
 * The body is signed by its SHA-256 (x-amz-content-sha256), so S3 refuses
 * an upload that arrives changed. The key needs s3:PutObject on the folder
 * and nothing else: an export never reads, lists or deletes.
 */

const S3_SERVICE: string = "s3";

// How the messages name the storage.
export function getS3ServiceTitle(isAmazonS3: boolean): string {
  return isAmazonS3 ? "Amazon S3" : "The S3-compatible storage";
}

export function sha256Hex(body: Buffer): string {
  return createHash("sha256").update(body).digest("hex");
}

export interface S3Target {
  // Host as signed and sent: with its port when it is not the default one.
  host: string;
  // The object's path as signed (unencoded: the signer encodes it).
  signingPath: string;
  // The request URL, its path encoded exactly as the signer encodes it.
  url: string;
  // Where it went, in words: s3://bucket/key.
  location: string;
}

// The path as the signer canonicalizes it, and as the request must send it.
function encodePath(path: string): string {
  return path
    .split("/")
    .map((segment: string): string => {
      return AwsSecurityHubClient.uriEncode(segment);
    })
    .join("/");
}

export function getS3Target(data: {
  isAmazonS3: boolean;
  endpoint: string;
  bucket: string;
  region: string;
  key: string;
}): S3Target {
  const location: string = `s3://${data.bucket}/${data.key}`;

  if (data.isAmazonS3) {
    const regionalHost: string = getAwsHost(S3_SERVICE, data.region);

    if (data.bucket.includes(".")) {
      const signingPath: string = `/${data.bucket}/${data.key}`;

      return {
        host: regionalHost,
        signingPath,
        url: `https://${regionalHost}${encodePath(signingPath)}`,
        location,
      };
    }

    const host: string = `${data.bucket}.${regionalHost}`;
    const signingPath: string = `/${data.key}`;

    return {
      host,
      signingPath,
      url: `https://${host}${encodePath(signingPath)}`,
      location,
    };
  }

  const endpoint: URL = new URL(data.endpoint);
  let basePath: string = endpoint.pathname;

  while (basePath.endsWith("/")) {
    basePath = basePath.slice(0, -1);
  }

  const signingPath: string = `${basePath}/${data.bucket}/${data.key}`;

  return {
    host: endpoint.host,
    signingPath,
    url: `${endpoint.protocol}//${endpoint.host}${encodePath(signingPath)}`,
    location,
  };
}

/*
 * What S3 (or the storage behind the S3 API) refused, and what to change.
 * S3 answers an error with an XML document whose <Code> names it.
 */
export function describeS3Failure(data: {
  answer: DestinationAnswer;
  isAmazonS3: boolean;
  bucket: string;
  folder: string;
}): string {
  const answer: DestinationAnswer = data.answer;
  const serviceTitle: string = getS3ServiceTitle(data.isAmazonS3);
  const checkBucket: string = data.isAmazonS3
    ? "Check the bucket name"
    : "Check the bucket name and the endpoint";
  const code: string = readXmlTag(answer.bodyText || "", "Code");
  const status: string = `HTTP ${answer.status}${code ? `, ${code}` : ""}`;

  switch (code) {
    case "InvalidAccessKeyId":
      return `${serviceTitle} does not know this access key (${status}). Check the Access key ID.`;
    case "SignatureDoesNotMatch":
      return `${serviceTitle} refused the signature (${status}): the secret access key does not belong to this access key ID. Check the Secret access key.`;
    case "AccessDenied":
      return `${serviceTitle} did not let this access key write to the bucket (${status}). Allow it s3:PutObject on ${data.bucket}/${data.folder}*.`;
    case "NoSuchBucket":
      return `The bucket ${data.bucket} does not exist (${status}). ${checkBucket}.`;
    case "InvalidBucketName":
      return `${serviceTitle} refused the bucket name ${data.bucket} (${status}).`;
    case "AuthorizationHeaderMalformed":
    case "PermanentRedirect":
    case "IllegalLocationConstraintException": {
      const region: string =
        readXmlTag(answer.bodyText || "", "Region") ||
        readXmlTag(answer.bodyText || "", "BucketRegion");

      return `The bucket ${data.bucket} is in another region${
        region ? ` (${region})` : ""
      } (${status}). Set Region to the bucket's region.`;
    }
    case "RequestTimeTooSkewed":
      return `${serviceTitle} refused the request because this server's clock is too far from its own (${status}). Check the server's time.`;
    case "SlowDown":
    case "ServiceUnavailable":
    case "InternalError":
      return `${serviceTitle} is busy (${status}). It is retried automatically.`;
    case "InvalidRequest":
    case "AccessControlListNotSupported":
    default:
      break;
  }

  if (answer.status === 301 || answer.status === 307) {
    return `The bucket ${data.bucket} is in another region (${status}). Set Region to the bucket's region.`;
  }

  if (answer.status === 401 || answer.status === 403) {
    return `${serviceTitle} refused the access key (${status}). Check the access key and that it may write objects to the bucket.`;
  }

  if (answer.status === 404) {
    return `${serviceTitle} did not find the bucket ${data.bucket} (${status}). ${checkBucket}.`;
  }

  if (answer.status === 429 || answer.status >= 500) {
    return `${serviceTitle} is busy (${status}). It is retried automatically.`;
  }

  const detail: string = code
    ? readXmlTag(answer.bodyText || "", "Message")
    : describeAnswer(answer);

  return `${serviceTitle} did not accept the file (${status})${
    detail ? `: ${detail}` : "."
  }`;
}

export default class S3Destination implements AuditLogExportDestination {
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
    const isAmazonS3: boolean =
      settings.type === AuditLogExportDestinationType.AmazonS3;
    const serviceTitle: string = getS3ServiceTitle(isAmazonS3);
    const bucket: string = AuditLogExportSettingsUtil.readConfigText(
      settings,
      "bucket",
    );
    const region: string = AuditLogExportSettingsUtil.readConfigText(
      settings,
      "region",
    );
    const accessKeyId: string = AuditLogExportSettingsUtil.readConfigText(
      settings,
      "accessKeyId",
    );
    const secretAccessKey: string = AuditLogExportSettingsUtil.readSecretText(
      settings,
      "secretAccessKey",
    );
    const folder: string = getAuditLogExportFolder(settings.config);
    const key: string = getAuditLogExportObjectKey({
      folder,
      batch: delivery.batch,
    });

    const target: S3Target = getS3Target({
      isAmazonS3,
      endpoint: isAmazonS3
        ? ""
        : AuditLogExportSettingsUtil.readConfigText(settings, "endpoint"),
      bucket,
      region,
      key,
    });

    const body: Buffer = toAuditLogExportFile(delivery.batch);
    const payloadHash: string = sha256Hex(body);

    const signed: AwsSigV4SignResult = AwsSecurityHubClient.signRequest({
      method: "PUT",
      host: target.host,
      path: target.signingPath,
      headers: {
        "Content-Type": AUDIT_LOG_EXPORT_FILE_CONTENT_TYPE,
        "x-amz-content-sha256": payloadHash,
      },
      body: "",
      payloadHash,
      accessKeyId,
      secretAccessKey,
      region,
      service: S3_SERVICE,
      date: this.now(),
    });

    const secretValues: Array<string> = [secretAccessKey];

    const answer: DestinationAnswer = await sendDestinationRequest({
      transport: this.transport,
      request: {
        method: "PUT",
        url: target.url,
        headers: signed.headers,
        body,
        egressOptions: delivery.egress,
      },
      serviceTitle,
      secretValues,
    });

    if (answer.ok) {
      return { location: target.location };
    }

    throw toDeliveryError({
      answer,
      message: describeS3Failure({ answer, isAmazonS3, bucket, folder }),
      secretValues,
    });
  }
}
