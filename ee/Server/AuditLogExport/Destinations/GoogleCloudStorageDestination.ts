import { createHash } from "crypto";
import AuditLogExportSettingsUtil, {
  AuditLogExportSettings,
  getAuditLogExportFolder,
} from "Common/Server/Utils/AuditLog/Export/AuditLogExportSettings";
import GoogleServiceAccountToken from "Common/Server/Utils/LlmObservability/Connectors/GoogleVertexAI/GoogleServiceAccountToken";
import LlmProviderError from "Common/Server/Utils/LlmObservability/LlmProviderError";
import { DestinationAnswer } from "Common/Server/Utils/SecurityEvent/Destinations/BatchSender";
import { JSONObject } from "Common/Types/JSON";
import { LlmConnectionFailureKind } from "Common/Types/LlmObservability/LlmConnectionTest";
import {
  AUDIT_LOG_EXPORT_FILE_CONTENT_TYPE,
  getAuditLogExportObjectKey,
  toAuditLogExportFile,
} from "../AuditLogExportFiles";
import {
  AUDIT_LOG_EXPORT_REQUEST_TIMEOUT_IN_MS,
  defaultAuditLogExportHttpTransport,
  redactDeliveryMessage,
  sendDestinationRequest,
  toDeliveryError,
} from "./DestinationHttp";
import {
  AuditLogExportDelivery,
  AuditLogExportDeliveryError,
  AuditLogExportDeliveryReceipt,
  AuditLogExportDestination,
  AuditLogExportHttpTransport,
} from "./Types";

/*
 * Google Cloud Storage: one upload per batch through the JSON API's simple
 * upload (uploadType=media), as the service account the key belongs to.
 *
 *   POST https://storage.googleapis.com/upload/storage/v1/b/<bucket>/o
 *        ?uploadType=media&name=<object name>
 *
 * The account signs in as itself (GoogleServiceAccountToken, the sign-in
 * the Vertex AI connection uses), whose token request goes only to a
 * Google host. The account needs the Storage Object Creator role on the
 * bucket and nothing more: an export never reads, lists or deletes.
 */

export const GOOGLE_CLOUD_STORAGE_UPLOAD_BASE_URL: string =
  "https://storage.googleapis.com/upload/storage/v1/b";

// Object creation: no narrower scope exists; IAM decides what the account may do.
export const GOOGLE_CLOUD_STORAGE_SCOPE: string =
  "https://www.googleapis.com/auth/devstorage.read_write";

const SERVICE_TITLE: string = "Google Cloud Storage";

// Tokens for at most this many service accounts are kept between batches.
const MAX_CACHED_TOKEN_CLIENTS: number = 100;

export function getGoogleCloudStorageUploadUrl(data: {
  bucket: string;
  objectName: string;
}): string {
  return `${GOOGLE_CLOUD_STORAGE_UPLOAD_BASE_URL}/${encodeURIComponent(
    data.bucket,
  )}/o?uploadType=media&name=${encodeURIComponent(data.objectName)}`;
}

function readGoogleErrorMessage(answer: DestinationAnswer): string {
  const json: unknown = answer.bodyJson;

  if (!json || typeof json !== "object" || Array.isArray(json)) {
    return "";
  }

  const error: unknown = (json as JSONObject)["error"];

  if (!error || typeof error !== "object" || Array.isArray(error)) {
    return "";
  }

  const message: unknown = (error as JSONObject)["message"];

  return typeof message === "string" ? message.trim() : "";
}

export function describeGoogleCloudStorageFailure(data: {
  answer: DestinationAnswer;
  bucket: string;
  clientEmail: string;
}): string {
  const status: number = data.answer.status;
  const said: string = readGoogleErrorMessage(data.answer);
  const reason: string = said ? ` Google said: ${said}` : "";

  if (status === 401) {
    return `${SERVICE_TITLE} refused the service account's sign-in (HTTP 401). Check the service account key.${reason}`;
  }

  if (status === 403) {
    return `The service account ${data.clientEmail} may not create files in the bucket ${data.bucket} (HTTP 403). Give it the Storage Object Creator role on the bucket.${reason}`;
  }

  if (status === 404) {
    return `The bucket ${data.bucket} does not exist (HTTP 404). Check the bucket name.${reason}`;
  }

  if (status === 429 || status >= 500) {
    return `${SERVICE_TITLE} is busy (HTTP ${status}). It is retried automatically.`;
  }

  return `${SERVICE_TITLE} did not accept the file (HTTP ${status}).${reason}`;
}

export default class GoogleCloudStorageDestination
  implements AuditLogExportDestination
{
  private readonly transport: AuditLogExportHttpTransport;
  private readonly tokens: Map<string, GoogleServiceAccountToken> = new Map<
    string,
    GoogleServiceAccountToken
  >();

  public constructor(
    options: { transport?: AuditLogExportHttpTransport | undefined } = {},
  ) {
    this.transport = options.transport || defaultAuditLogExportHttpTransport;
  }

  /*
   * One token client per service account key, so a batch a minute does not
   * sign in a minute: the client keeps its token until shortly before it
   * expires. Keyed by the key's hash, never by the key.
   */
  private static getCacheKey(serviceAccountJson: string): string {
    return createHash("sha256").update(serviceAccountJson).digest("hex");
  }

  private getTokenClient(serviceAccountJson: string): GoogleServiceAccountToken {
    const cacheKey: string =
      GoogleCloudStorageDestination.getCacheKey(serviceAccountJson);
    const cached: GoogleServiceAccountToken | undefined =
      this.tokens.get(cacheKey);

    if (cached) {
      return cached;
    }

    const client: GoogleServiceAccountToken = new GoogleServiceAccountToken({
      serviceAccountJson,
      scope: GOOGLE_CLOUD_STORAGE_SCOPE,
      transport: this.transport,
      providerTitle: SERVICE_TITLE,
      requestTimeoutInMs: AUDIT_LOG_EXPORT_REQUEST_TIMEOUT_IN_MS,
    });

    if (this.tokens.size >= MAX_CACHED_TOKEN_CLIENTS) {
      const oldest: string | undefined = this.tokens.keys().next().value;

      if (oldest !== undefined) {
        this.tokens.delete(oldest);
      }
    }

    this.tokens.set(cacheKey, client);

    return client;
  }

  private async getAccessToken(data: {
    client: GoogleServiceAccountToken;
    secretValues: Array<string>;
  }): Promise<string> {
    try {
      return await data.client.getAccessToken();
    } catch (error) {
      const message: string =
        error instanceof Error ? error.message : String(error);
      const isRefused: boolean =
        error instanceof LlmProviderError &&
        (error.kind === LlmConnectionFailureKind.Authentication ||
          error.kind === LlmConnectionFailureKind.Permission);

      throw new AuditLogExportDeliveryError(
        redactDeliveryMessage(
          isRefused
            ? `Google refused the service account key: ${message} Check that the key is current and not deleted.`
            : `Could not sign in to Google with the service account key: ${message}`,
          data.secretValues,
        ),
        { retryable: !isRefused },
      );
    }
  }

  public async deliver(
    delivery: AuditLogExportDelivery,
  ): Promise<AuditLogExportDeliveryReceipt> {
    const settings: AuditLogExportSettings = delivery.settings;
    const bucket: string = AuditLogExportSettingsUtil.readConfigText(
      settings,
      "bucket",
    );
    const serviceAccountJson: string = AuditLogExportSettingsUtil.readSecretText(
      settings,
      "serviceAccountJson",
    );
    const objectName: string = getAuditLogExportObjectKey({
      folder: getAuditLogExportFolder(settings.config),
      batch: delivery.batch,
    });

    let client: GoogleServiceAccountToken;

    try {
      client = this.getTokenClient(serviceAccountJson);
    } catch (error) {
      throw new AuditLogExportDeliveryError(
        error instanceof Error ? error.message : String(error),
        { retryable: false },
      );
    }

    const secretValues: Array<string> = [serviceAccountJson];
    const token: string = await this.getAccessToken({ client, secretValues });

    const answer: DestinationAnswer = await sendDestinationRequest({
      transport: this.transport,
      request: {
        method: "POST",
        url: getGoogleCloudStorageUploadUrl({ bucket, objectName }),
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": AUDIT_LOG_EXPORT_FILE_CONTENT_TYPE,
        },
        body: toAuditLogExportFile(delivery.batch),
        egressOptions: delivery.egress,
      },
      serviceTitle: SERVICE_TITLE,
      secretValues: [...secretValues, token],
    });

    if (answer.ok) {
      return { location: `gs://${bucket}/${objectName}` };
    }

    // A token Google no longer takes is never used again: the next batch signs in anew.
    if (answer.status === 401) {
      this.tokens.delete(
        GoogleCloudStorageDestination.getCacheKey(serviceAccountJson),
      );
    }

    throw toDeliveryError({
      answer,
      message: describeGoogleCloudStorageFailure({
        answer,
        bucket,
        clientEmail: client.getClientEmail(),
      }),
      secretValues: [...secretValues, token],
    });
  }
}
