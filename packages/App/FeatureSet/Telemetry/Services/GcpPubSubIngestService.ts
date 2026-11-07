import TelemetryIngestionDisabled from "Common/Server/Middleware/TelemetryIngestionDisabled";
import CloudStreamActivity from "Common/Server/Utils/CloudConnection/CloudStreamActivity";
import CloudStreamAuthenticator, {
  CloudStreamAuthentication,
  CloudStreamSender,
  CloudStreamSenderVerdict,
} from "Common/Server/Utils/CloudConnection/CloudStreamAuthentication";
import GoogleOidcTokens, {
  GoogleOidcVerdict,
  UnverifiedJwt,
  readBearerToken,
  readUnverifiedJwt,
} from "Common/Server/Utils/CloudConnection/GoogleOidcTokens";
import {
  ExpressRequest,
  ExpressResponse,
  headerValueToString,
} from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import CaptureSpan from "Common/Server/Utils/Telemetry/CaptureSpan";
import TelemetryIngestionKeyRateLimiter, {
  TelemetryIngestionKeyLimitDecision,
  TelemetryIngestionKeyLimitOutcome,
} from "Common/Server/Utils/Telemetry/TelemetryIngestionKeyRateLimiter";
import { CloudProvider } from "Common/Types/Cloud/CloudPlatform";
import {
  CLOUD_STREAM_MAX_KEY_LENGTH,
  CLOUD_STREAM_PUBSUB_MAX_REQUEST_BYTES,
  CLOUD_STREAM_PUBSUB_REQUESTS_PER_MINUTE,
  CloudStreamRefusalReason,
  PUBSUB_AUTHORIZATION_HEADER,
} from "Common/Types/CloudConnection/CloudStream";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { PUBSUB_LEDGER } from "../Utils/AwsFirehose/FirehoseDeliveryLedger";
import {
  CloudStreamBodyTooLarge,
  drainCloudStreamBody,
  readCloudStreamBody,
} from "../Utils/CloudStreamBody";
import {
  CloudLoggingEntry,
  CloudLoggingFacts,
  buildCloudLoggingResourceLogs,
  readCloudLoggingEntry,
} from "../Utils/GcpPubSub/CloudLoggingEntries";
import {
  PubSubPush,
  PubSubPushReading,
  readPubSubPush,
  readSubscriptionProject,
  sendPubSubResponse,
} from "../Utils/GcpPubSub/PubSubContract";
import PubSubLogBatcher, {
  PubSubBatchFull,
} from "../Utils/GcpPubSub/PubSubLogBatcher";

/*
 * THE PUB/SUB PUSH ENDPOINT: A GOOGLE CLOUD PROJECT'S LOGS, STREAMED.
 *
 *   POST /gcp-pubsub/v1/logs   (and under /telemetry)
 *
 * Log sinks route Cloud Logging into a Pub/Sub topic whose push
 * subscription delivers here, one entry a request (CloudStreamGcp makes
 * them). One push is:
 *
 *   1. its sender, before a byte of the body is read: the OIDC token in
 *      Authorization, whose audience is a connection's stream key
 *      (CloudStreamAuthenticator) - the key names the project it is written
 *      to, and nothing the entry says does - and which Google must have
 *      signed for the push service account that key was made for
 *      (GoogleOidcTokens): the key alone, readable in the subscription's
 *      settings, is not enough;
 *   2. its rate: at most CLOUD_STREAM_PUBSUB_REQUESTS_PER_MINUTE pushes a
 *      minute for one connection, past which Pub/Sub is told 429, backs off
 *      and pushes again;
 *   3. its body, at most CLOUD_STREAM_PUBSUB_MAX_REQUEST_BYTES as sent and
 *      CLOUD_STREAM_PUBSUB_MAX_MESSAGE_BYTES of data (413);
 *   4. its envelope (PubSubContract): one that is not a push is 400;
 *   5. a message taken before, with the same message id, is answered 204
 *      and not queued again (PUBSUB_LEDGER);
 *   6. its entry (CloudLoggingEntries), as one OTLP log record filed under
 *      its project and the cloud resource its labels name. A message that is
 *      no log entry - something else published to the topic - is taken and
 *      left out, as Pub/Sub would only push it again;
 *   7. queued with the project's other pushes of the moment
 *      (PubSubLogBatcher) as an OTLP logs job, so drop filters, scrub
 *      rules, pipelines, retention and billing apply as to any logs; a
 *      queue that cannot take it is 503, which Pub/Sub pushes again;
 *   8. noted on the connection (CloudStreamActivity) and answered 204.
 *
 * A push that cannot be told apart - no token, a wrong key - is answered
 * alike, so the endpoint says nothing of which connections exist; one
 * whose key is right is noted on its connection, so the person setting the
 * stream up sees why it was refused. Every answer is under a kilobyte.
 */

export const PUBSUB_WRONG_KEY_MESSAGE: string =
  "This push's token does not hold a stream key of this OneUptime. Make a new key under Cloud > Connect and run the command again.";
export const PUBSUB_THROTTLED_MESSAGE: string =
  "This connection's subscription pushed more this minute than OneUptime takes. Pub/Sub pushes it again shortly.";
export const PUBSUB_TOO_LARGE_MESSAGE: string = `A push is at most ${CLOUD_STREAM_PUBSUB_MAX_REQUEST_BYTES / 1024 / 1024} MiB: a Cloud Logging entry is far smaller.`;
export const PUBSUB_UNSUPPORTED_ENCODING_MESSAGE: string =
  "Pub/Sub pushes are not compressed: send this endpoint Pub/Sub's pushes only.";
export const PUBSUB_QUEUE_UNAVAILABLE_MESSAGE: string =
  "OneUptime could not queue this push right now. Pub/Sub pushes it again.";

export default class GcpPubSubIngestService {
  @CaptureSpan()
  public static async ingest(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const now: Date = new Date();

    const answer: (status: number, error?: string | undefined) => void = (
      status: number,
      error?: string | undefined,
    ): void => {
      sendPubSubResponse({ res, status, error });
    };

    try {
      if (TelemetryIngestionDisabled.isDisabled()) {
        // Taken and dropped, as every ingest path does with ingestion off.
        drainCloudStreamBody(req);
        return answer(204);
      }

      const token: string = readBearerToken(
        req.headers[PUBSUB_AUTHORIZATION_HEADER],
      );
      const jwt: UnverifiedJwt | null = readUnverifiedJwt(token);
      const audience: unknown = jwt?.payload["aud"];

      if (
        !jwt ||
        typeof audience !== "string" ||
        audience.length > CLOUD_STREAM_MAX_KEY_LENGTH
      ) {
        drainCloudStreamBody(req);
        return answer(401, PUBSUB_WRONG_KEY_MESSAGE);
      }

      const authentication: CloudStreamAuthentication =
        await CloudStreamAuthenticator.authenticate({
          accessKey: audience,
          now,
          provider: CloudProvider.GCP,
          verifySender: async (
            sender: CloudStreamSender,
          ): Promise<CloudStreamSenderVerdict> => {
            return await GcpPubSubIngestService.verifySender({
              token,
              audience,
              sender,
              now,
            });
          },
        });

      if (!authentication.isAuthorized) {
        drainCloudStreamBody(req);

        if (authentication.connectionId) {
          CloudStreamActivity.noteRefusal({
            connectionId: authentication.connectionId,
            reason: authentication.reason,
            now,
          });
        }

        return answer(
          authentication.status,
          authentication.reason === CloudStreamRefusalReason.WrongKey
            ? PUBSUB_WRONG_KEY_MESSAGE
            : authentication.message,
        );
      }

      const connectionId: ObjectID = authentication.connectionId;

      const decision: TelemetryIngestionKeyLimitDecision =
        await TelemetryIngestionKeyRateLimiter.consume({
          ingestionKeyId: connectionId,
          limitPerMinute: CLOUD_STREAM_PUBSUB_REQUESTS_PER_MINUTE,
        });

      if (decision.outcome === TelemetryIngestionKeyLimitOutcome.RateLimited) {
        drainCloudStreamBody(req);

        if (decision.isFirstRejectionInWindow) {
          CloudStreamActivity.noteRefusal({
            connectionId,
            reason: CloudStreamRefusalReason.Throttled,
            now,
          });
        }

        if (decision.retryAfterSeconds) {
          res.setHeader("Retry-After", String(decision.retryAfterSeconds));
        }

        return answer(429, PUBSUB_THROTTLED_MESSAGE);
      }

      const encoding: string = (
        headerValueToString(req.headers["content-encoding"]) || ""
      )
        .trim()
        .toLowerCase();

      if (encoding && encoding !== "identity") {
        drainCloudStreamBody(req);
        return answer(400, PUBSUB_UNSUPPORTED_ENCODING_MESSAGE);
      }

      let body: Buffer;

      try {
        body = await readCloudStreamBody(
          req,
          CLOUD_STREAM_PUBSUB_MAX_REQUEST_BYTES,
        );
      } catch (error) {
        if (error instanceof CloudStreamBodyTooLarge) {
          CloudStreamActivity.noteRefusal({
            connectionId,
            reason: CloudStreamRefusalReason.TooLarge,
            now,
          });
          return answer(413, PUBSUB_TOO_LARGE_MESSAGE);
        }

        throw error;
      }

      const reading: PubSubPushReading = readPubSubPush(body);

      if ("problem" in reading) {
        CloudStreamActivity.noteRefusal({
          connectionId,
          reason: reading.isTooLarge
            ? CloudStreamRefusalReason.TooLarge
            : CloudStreamRefusalReason.Malformed,
          now,
        });
        return answer(reading.isTooLarge ? 413 : 400, reading.problem);
      }

      const push: PubSubPush = reading.push;

      if (
        await PUBSUB_LEDGER.wasTaken({
          connectionId,
          requestId: push.messageId,
        })
      ) {
        return answer(204);
      }

      const entry: CloudLoggingEntry | null =
        GcpPubSubIngestService.readEntry(push);

      if (!entry) {
        // Not a log entry: nothing to keep, and nothing Pub/Sub should push again.
        await PUBSUB_LEDGER.markTaken({
          connectionId,
          requestId: push.messageId,
        });
        return answer(204);
      }

      const built: {
        resourceLogs: JSONObject;
        facts: CloudLoggingFacts;
      } = buildCloudLoggingResourceLogs({
        entry,
        serviceName: authentication.serviceName,
        connectionId: connectionId.toString(),
        observedAtMs: now.getTime(),
      });

      try {
        await PubSubLogBatcher.add({
          projectId: authentication.projectId,
          resource: built.resourceLogs,
          records: 1,
        });
      } catch (error) {
        if (!(error instanceof PubSubBatchFull)) {
          logger.warn(
            `Cloud stream ${connectionId.toString()}: a push could not be queued: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }

        return answer(503, PUBSUB_QUEUE_UNAVAILABLE_MESSAGE);
      }

      await PUBSUB_LEDGER.markTaken({
        connectionId,
        requestId: push.messageId,
      });

      const project: string =
        built.facts.projectId || readSubscriptionProject(push.subscription);

      CloudStreamActivity.noteDelivery({
        connectionId,
        now,
        sightings: project
          ? [
              {
                accountId: project,
                region: built.facts.region,
                logGroups: built.facts.logId ? [built.facts.logId] : [],
              },
            ]
          : [],
      });

      return answer(204);
    } catch (error) {
      logger.error(
        `Cloud stream push failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );

      // Pub/Sub pushes a 500 again; the message says nothing of the server.
      return answer(
        500,
        "OneUptime could not take this push. Pub/Sub pushes it again.",
      );
    }
  }

  /*
   * Whether a push whose key is right came from the connection's push
   * subscription: a token Google signed, for the stream key as its
   * audience, for the push service account the key was made for.
   */
  public static async verifySender(data: {
    token: string;
    audience: string;
    sender: CloudStreamSender;
    now: Date;
  }): Promise<CloudStreamSenderVerdict> {
    if (!data.sender.pushServiceAccount) {
      return "not-sender";
    }

    const verdict: GoogleOidcVerdict = await GoogleOidcTokens.verify(
      data.token,
      data.now,
    );

    if (!verdict.isValid) {
      return verdict.isUnavailable ? "unavailable" : "not-sender";
    }

    return verdict.claims.audience === data.audience &&
      verdict.claims.isEmailVerified &&
      verdict.claims.email.toLowerCase() ===
        data.sender.pushServiceAccount.toLowerCase()
      ? "sender"
      : "not-sender";
  }

  // The message's data as a log entry, or null.
  private static readEntry(push: PubSubPush): CloudLoggingEntry | null {
    if (push.data.length === 0) {
      return null;
    }

    try {
      return readCloudLoggingEntry(JSON.parse(push.data.toString("utf8")));
    } catch {
      return null;
    }
  }
}
