import { CLOUD_STREAM_PUBSUB_MAX_MESSAGE_BYTES } from "Common/Types/CloudConnection/CloudStream";
import { ExpressResponse } from "Common/Server/Utils/Express";
import { JSONObject, JSONValue } from "Common/Types/JSON";

/*
 * A PUB/SUB PUSH, AS PUB/SUB SENDS IT, AND THE ANSWER IT READS.
 *
 * ("Push subscriptions", Pub/Sub documentation.) A push subscription in
 * the wrapped format POSTs one message a request, as JSON:
 *
 *   { "message": { "attributes": { "logging.googleapis.com/timestamp": "..." },
 *                  "data": "<base64>", "messageId": "2070443601311540",
 *                  "message_id": "2070443601311540",
 *                  "publishTime": "2026-11-06T10:00:00.123Z",
 *                  "publish_time": "..." },
 *     "subscription": "projects/acme/subscriptions/oneuptime-stream-6f1c3a2e-push",
 *     "deliveryAttempt": 3 }
 *
 * with Authorization: Bearer <an OIDC token Google signed for the push
 * service account>. The message id is the same every time one message is
 * pushed again.
 *
 * Pub/Sub reads only the answer's status: 102, 200, 201, 202 and 204 are
 * delivered (PUBSUB_ACKNOWLEDGING_STATUSES); anything else is not, and the
 * message is pushed again later, backing off, until the subscription's
 * retention is up. So a refusal OneUptime wants pushed again - a wrong key,
 * a stream turned off, too many a minute - is a 4xx or a 5xx, and what it
 * takes, or has taken before, is 204. Every answer is under 1,000 bytes:
 * a refusal says why in a short JSON body, for whoever reads it with curl.
 */

// Pub/Sub's message ids are decimal; one longer than this is not read as one.
export const PUBSUB_MAX_MESSAGE_ID_LENGTH: number = 128;
export const PUBSUB_MAX_SUBSCRIPTION_LENGTH: number = 512;
// What an error is cut to, so the whole answer stays under 1,000 bytes.
export const PUBSUB_MAX_ERROR_LENGTH: number = 700;
// The attributes a message keeps, at most.
const MAX_ATTRIBUTES: number = 50;

export interface PubSubPush {
  messageId: string;
  // The message's data, decoded.
  data: Buffer;
  attributes: Record<string, string>;
  publishTime: string;
  // projects/<project>/subscriptions/<subscription>
  subscription: string;
  deliveryAttempt: number | null;
}

export type PubSubPushReading =
  | { push: PubSubPush }
  | { problem: string; isTooLarge: boolean };

function isMessageIdCharacter(code: number): boolean {
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    code === 45 ||
    code === 95 ||
    code === 46
  );
}

export function readPubSubMessageId(value: unknown): string {
  const text: string = typeof value === "string" ? value.trim() : "";

  if (!text || text.length > PUBSUB_MAX_MESSAGE_ID_LENGTH) {
    return "";
  }

  for (let index: number = 0; index < text.length; index++) {
    if (!isMessageIdCharacter(text.charCodeAt(index))) {
      return "";
    }
  }

  return text;
}

function isBase64Character(code: number): boolean {
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    code === 43 ||
    code === 47 ||
    code === 61 ||
    code === 45 ||
    code === 95
  );
}

// A subscription's name as Pub/Sub writes it: projects/<project>/subscriptions/<id>.
export function readSubscriptionProject(subscription: string): string {
  const parts: Array<string> = subscription.split("/");

  return parts.length === 4 &&
    parts[0] === "projects" &&
    parts[2] === "subscriptions" &&
    parts[1] &&
    parts[3]
    ? parts[1]
    : "";
}

/*
 * A request body as Pub/Sub writes a push - or what is wrong with it.
 * Never throws; the data is decoded only when it fits
 * CLOUD_STREAM_PUBSUB_MAX_MESSAGE_BYTES.
 */
export function readPubSubPush(body: Buffer): PubSubPushReading {
  let parsed: unknown;

  try {
    parsed = JSON.parse(body.toString("utf8"));
  } catch {
    return {
      problem:
        "The request body is not JSON. Send this endpoint the pushes of a Pub/Sub push subscription only.",
      isTooLarge: false,
    };
  }

  const document: JSONObject | null =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as JSONObject)
      : null;
  const message: JSONValue | undefined = document?.["message"];

  if (!document || !message || typeof message !== "object" || Array.isArray(message)) {
    return {
      problem: "The request body is not a Pub/Sub push: it has no message.",
      isTooLarge: false,
    };
  }

  const fields: JSONObject = message as JSONObject;
  const messageId: string = readPubSubMessageId(
    fields["messageId"] ?? fields["message_id"],
  );

  if (!messageId) {
    return {
      problem: "The push's message has no message id.",
      isTooLarge: false,
    };
  }

  const encoded: JSONValue | undefined = fields["data"];

  if (encoded !== undefined && typeof encoded !== "string") {
    return { problem: "A message's data must be base64 text.", isTooLarge: false };
  }

  const text: string = (encoded as string | undefined) || "";

  // Four characters of base64 are three bytes: too long is refused before decoding.
  if (Math.floor((text.length * 3) / 4) > CLOUD_STREAM_PUBSUB_MAX_MESSAGE_BYTES + 2) {
    return {
      problem: `A message's data is at most ${CLOUD_STREAM_PUBSUB_MAX_MESSAGE_BYTES} bytes.`,
      isTooLarge: true,
    };
  }

  for (let index: number = 0; index < text.length; index++) {
    if (!isBase64Character(text.charCodeAt(index))) {
      return { problem: "A message's data must be base64 text.", isTooLarge: false };
    }
  }

  const attributes: Record<string, string> = {};
  const rawAttributes: JSONValue | undefined = fields["attributes"];

  if (rawAttributes && typeof rawAttributes === "object" && !Array.isArray(rawAttributes)) {
    for (const key of Object.keys(rawAttributes).slice(0, MAX_ATTRIBUTES)) {
      const value: JSONValue | undefined = (rawAttributes as JSONObject)[key];

      if (typeof value === "string" && key.length <= 256 && key !== "__proto__") {
        attributes[key] = value.slice(0, 1024);
      }
    }
  }

  const subscription: string =
    typeof document["subscription"] === "string"
      ? (document["subscription"] as string).slice(0, PUBSUB_MAX_SUBSCRIPTION_LENGTH)
      : "";
  const attempt: JSONValue | undefined = document["deliveryAttempt"];

  return {
    push: {
      messageId,
      data: Buffer.from(text, "base64"),
      attributes,
      publishTime: typeof fields["publishTime"] === "string"
        ? (fields["publishTime"] as string).slice(0, 64)
        : "",
      subscription,
      deliveryAttempt:
        typeof attempt === "number" && Number.isFinite(attempt) ? attempt : null,
    },
  };
}

/*
 * Answers Pub/Sub: 204 with nothing for a push taken, else the status and
 * a short reason - never anything a cache or a proxy may change.
 */
export function sendPubSubResponse(data: {
  res: ExpressResponse;
  status: number;
  error?: string | undefined;
}): void {
  if (data.res.headersSent) {
    return;
  }

  data.res.status(data.status);
  data.res.setHeader("Cache-Control", "no-store, no-transform");

  if (data.status === 204 || !data.error) {
    data.res.setHeader("Content-Length", "0");
    data.res.end();
    return;
  }

  const body: Buffer = Buffer.from(
    JSON.stringify({ error: data.error.slice(0, PUBSUB_MAX_ERROR_LENGTH) }),
    "utf8",
  );

  data.res.setHeader("Content-Type", "application/json");
  data.res.setHeader("Content-Length", String(body.length));
  data.res.end(body);
}
