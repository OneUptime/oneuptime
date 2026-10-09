import crypto from "crypto";

/*
 * SIGNED WEBHOOKS IN THE SVIX / STANDARD WEBHOOKS FORMAT.
 *
 * Huntress delivers its webhooks through Svix, which signs every request
 * the way the Standard Webhooks specification (standardwebhooks.com)
 * describes:
 *
 *   svix-id         the message id, the same on every retry of a message
 *   svix-timestamp  when this attempt was signed, in whole seconds
 *   svix-signature  "v1,<base64 HMAC-SHA256>", space separated when the
 *                   secret is being rotated and more than one is valid
 *
 * (Svix's white-label and the Standard Webhooks libraries send the same
 * three as webhook-id, webhook-timestamp and webhook-signature.)
 *
 * The signed content is `${id}.${timestamp}.${body}`, over the body exactly
 * as it was sent - never a re-serialized copy, which changes whitespace and
 * breaks the HMAC. The key is the endpoint's signing secret with its
 * "whsec_" prefix taken off, base64-decoded.
 *
 * A signature is only accepted for a timestamp within five minutes of now,
 * either way, so a captured request cannot be replayed later. Svix signs
 * each retry afresh, so a delivery Huntress retries hours later still
 * verifies.
 */

export const STANDARD_WEBHOOK_TOLERANCE_IN_SECONDS: number = 5 * 60;

const SECRET_PREFIX: string = "whsec_";
const SIGNATURE_VERSION: string = "v1";

// A base64 string, as a signing secret is once its prefix is off.
const BASE64_PATTERN: RegExp = /^[A-Za-z0-9+/]+={0,2}$/;
const TIMESTAMP_PATTERN: RegExp = /^[0-9]{1,15}$/;

// How long a secret may be: Svix secrets decode to 24-64 bytes.
const MIN_SECRET_BYTES: number = 16;
const MAX_SECRET_BYTES: number = 512;

// The longest header value read: a few rotated signatures fit many times over.
const MAX_HEADER_LENGTH: number = 4096;

export interface StandardWebhookHeaders {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
}

export enum StandardWebhookFailure {
  MissingHeaders = "MissingHeaders",
  InvalidTimestamp = "InvalidTimestamp",
  TimestampOutsideTolerance = "TimestampOutsideTolerance",
  InvalidSecret = "InvalidSecret",
  SignatureMismatch = "SignatureMismatch",
}

export type StandardWebhookVerification =
  | { verified: true; messageId: string; signedAt: Date }
  | { verified: false; failure: StandardWebhookFailure; message: string };

type HeaderValue = string | Array<string> | undefined;

function readHeader(
  headers: Record<string, HeaderValue>,
  names: Array<string>,
): string | null {
  for (const name of names) {
    let value: HeaderValue = headers[name];

    if (Array.isArray(value)) {
      value = value[0];
    }

    if (typeof value === "string") {
      const trimmed: string = value.trim();

      if (trimmed && trimmed.length <= MAX_HEADER_LENGTH) {
        return trimmed;
      }
    }
  }

  return null;
}

export default class StandardWebhookSignature {
  /*
   * The three signature headers of a request, from either family of names.
   * Node lower-cases incoming header names.
   */
  public static readHeaders(
    headers: Record<string, HeaderValue>,
  ): StandardWebhookHeaders {
    return {
      id: readHeader(headers, ["svix-id", "webhook-id"]),
      timestamp: readHeader(headers, ["svix-timestamp", "webhook-timestamp"]),
      signature: readHeader(headers, ["svix-signature", "webhook-signature"]),
    };
  }

  /*
   * The key a signing secret stands for, or null when the text cannot be
   * one: a secret is "whsec_" and base64 (the prefix may be left off).
   */
  public static decodeSecret(secret: string | null | undefined): Buffer | null {
    if (!secret) {
      return null;
    }

    let encoded: string = secret.trim();

    if (encoded.startsWith(SECRET_PREFIX)) {
      encoded = encoded.slice(SECRET_PREFIX.length);
    }

    if (
      !encoded ||
      encoded.length > MAX_SECRET_BYTES * 2 ||
      !BASE64_PATTERN.test(encoded)
    ) {
      return null;
    }

    const key: Buffer = Buffer.from(encoded, "base64");

    if (key.length < MIN_SECRET_BYTES || key.length > MAX_SECRET_BYTES) {
      return null;
    }

    return key;
  }

  public static isValidSecret(secret: string | null | undefined): boolean {
    return this.decodeSecret(secret) !== null;
  }

  /*
   * The signature header value a sender with `secret` writes for this
   * message: "v1,<base64>". What Svix computes; used to check a request,
   * and by tests to sign one.
   */
  public static sign(data: {
    secret: string;
    messageId: string;
    timestamp: string;
    body: string;
  }): string {
    const key: Buffer | null = this.decodeSecret(data.secret);

    if (!key) {
      throw new Error("The signing secret is not a valid webhook secret.");
    }

    return `${SIGNATURE_VERSION},${this.computeSignature(key, data)}`;
  }

  /*
   * Whether a request was signed with `secret`. The body is the request's
   * raw text. `now` is only for tests.
   */
  public static verify(data: {
    secret: string;
    headers: StandardWebhookHeaders;
    body: string;
    now?: Date | undefined;
  }): StandardWebhookVerification {
    const headers: StandardWebhookHeaders = data.headers;

    if (!headers.id || !headers.timestamp || !headers.signature) {
      return {
        verified: false,
        failure: StandardWebhookFailure.MissingHeaders,
        message:
          "The request has no webhook signature. Its svix-id, svix-timestamp and svix-signature headers are missing.",
      };
    }

    if (!TIMESTAMP_PATTERN.test(headers.timestamp)) {
      return {
        verified: false,
        failure: StandardWebhookFailure.InvalidTimestamp,
        message:
          "The request's signature timestamp is not a number of seconds.",
      };
    }

    const signedAtInSeconds: number = Number(headers.timestamp);
    const nowInSeconds: number = Math.floor(
      (data.now || new Date()).getTime() / 1000,
    );

    if (
      Math.abs(nowInSeconds - signedAtInSeconds) >
      STANDARD_WEBHOOK_TOLERANCE_IN_SECONDS
    ) {
      return {
        verified: false,
        failure: StandardWebhookFailure.TimestampOutsideTolerance,
        message:
          "The request was signed more than five minutes from now. Check that this server's clock is right; a replayed request is refused this way too.",
      };
    }

    const key: Buffer | null = this.decodeSecret(data.secret);

    if (!key) {
      return {
        verified: false,
        failure: StandardWebhookFailure.InvalidSecret,
        message: "The saved signing secret is not a valid webhook secret.",
      };
    }

    const expected: Buffer = Buffer.from(
      this.computeSignature(key, {
        messageId: headers.id,
        timestamp: headers.timestamp,
        body: data.body,
      }),
      "utf8",
    );

    for (const part of headers.signature.split(" ")) {
      const commaAt: number = part.indexOf(",");

      if (commaAt < 0 || part.slice(0, commaAt) !== SIGNATURE_VERSION) {
        continue;
      }

      const presented: Buffer = Buffer.from(part.slice(commaAt + 1), "utf8");

      if (
        presented.length === expected.length &&
        crypto.timingSafeEqual(presented, expected)
      ) {
        return {
          verified: true,
          messageId: headers.id,
          signedAt: new Date(signedAtInSeconds * 1000),
        };
      }
    }

    return {
      verified: false,
      failure: StandardWebhookFailure.SignatureMismatch,
      message:
        "The request's signature does not match the signing secret. Copy the endpoint's signing secret from Huntress again.",
    };
  }

  private static computeSignature(
    key: Buffer,
    data: { messageId: string; timestamp: string; body: string },
  ): string {
    return crypto
      .createHmac("sha256", key)
      .update(`${data.messageId}.${data.timestamp}.${data.body}`, "utf8")
      .digest("base64");
  }
}
