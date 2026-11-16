import GlobalCache from "../../Infrastructure/GlobalCache";
import { OneUptimeRequest } from "../Express";
import logger from "../Logger";
import { REDACTED } from "../LogRedaction";
import Dictionary from "../../../Types/Dictionary";
import {
  INCOMING_REQUEST_SIGNATURE_FORMATS,
  INCOMING_REQUEST_SIGNATURE_TOLERANCE_SECONDS,
  INCOMING_REQUEST_UNTIMED_SIGNATURE_MEMORY_SECONDS,
  IncomingRequestSignatureFormat,
  IncomingRequestSignatureScheme,
} from "../../../Types/Monitor/IncomingMonitor/IncomingRequestSecret";
import { createHash, createHmac, timingSafeEqual } from "crypto";

/*
 * A REQUEST SIGNED WITH ONE OF THE PROJECT'S INCOMING REQUEST SECRETS
 * (issue #8500), for a sender that cannot set a header of its own and signs
 * what it sends instead: GitHub's webhooks, Slack's and Stripe's, and a
 * sender of your own with X-OneUptime-Signature
 * (Types/Monitor/IncomingMonitor/IncomingRequestSecret says which header
 * holds what).
 *
 * Nothing secret travels: a signature is an HMAC-SHA256 of the request's body
 * as it came - and, for a signature with a time, of that time - made with the
 * secret. It is checked here, at the ingest endpoint, where the body is still
 * as the sender wrote it (getSignedBody), against every secret of the
 * project, in constant time for every pair, so how long the check takes says
 * nothing about how close a signature came. The secret that made it is then
 * "presented" like a secret sent in a header (its SHA-256 goes on with the
 * request), and decided on by the same rules: the monitor must accept it, the
 * worker decides again, its Last Used moves.
 *
 * A signature with a time is checked only while that time is within
 * INCOMING_REQUEST_SIGNATURE_TOLERANCE_SECONDS of OneUptime's clock - before
 * any HMAC is made, so an old request costs nothing to refuse - and an
 * accepted signature is remembered for as long as it could be accepted again
 * (rememberAccepted), so a request someone captured is accepted once.
 * GitHub's carries no time: it is remembered for a day. What is remembered is
 * a hash of the signature, in Redis, never the request.
 *
 * Only exact shapes are read: a header that is not one is no signature, and
 * the request is decided on whatever else it presented.
 */

// At most this many signatures are read from one header (Stripe sends one per secret it signs with).
export const MAX_DIGESTS_PER_SIGNATURE: number = 5;

// A signature's time: whole seconds since 1970.
const UNIX_SECONDS: RegExp = /^\d{1,12}$/;

// An HMAC-SHA256, as hex.
const SHA256_HEX: RegExp = /^[0-9a-f]{64}$/i;

const GITHUB_SIGNATURE: RegExp = /^sha256=([0-9a-f]{64})$/i;
const SLACK_SIGNATURE: RegExp = /^v0=([0-9a-f]{64})$/i;

/*
 * GitHub's older SHA-1 signature of the same body and secret: never checked,
 * but masked with the rest, as it is made with the secret too.
 */
const GITHUB_SHA1_SIGNATURE_HEADER: string = "x-hub-signature";

export interface PresentedSignature {
  scheme: IncomingRequestSignatureScheme;
  // The signature's time, in seconds since 1970, for a scheme that has one.
  timestampSeconds?: number | undefined;
  // The signatures presented, as lower-case hex: one for each secret signed with.
  digests: Array<string>;
}

export interface SigningSecret {
  secretId: string;
  value: string;
}

export enum SignatureProblem {
  // Its time is too far from OneUptime's clock: nothing was checked.
  Expired = "Expired",
  // No secret of the project made it.
  NoMatch = "NoMatch",
}

export interface SignatureVerification {
  // The secret that made one of the presented signatures.
  matchedSecretId?: string | undefined;
  // The signature it made: what rememberAccepted keeps.
  matchedSignature?:
    | {
        scheme: IncomingRequestSignatureScheme;
        digest: string;
        hasTimestamp: boolean;
      }
    | undefined;
  // Why none was accepted, when none was.
  problem?: SignatureProblem | undefined;
  // Every presented signature that no secret made: the wrong guesses.
  wrongDigests: Array<string>;
}

export default class IncomingRequestSignature {
  public static readonly SEEN_NAMESPACE: string =
    "incoming-request-signature-seen";

  // The signatures a request presents, in the shapes OneUptime checks.
  public static readPresentedSignatures(
    headers: Dictionary<string | Array<string> | undefined> | undefined | null,
  ): Array<PresentedSignature> {
    const byName: Dictionary<string> = {};

    for (const [name, rawValue] of Object.entries(headers || {})) {
      if (rawValue === undefined || rawValue === null) {
        continue;
      }

      byName[name.toLowerCase()] = Array.isArray(rawValue)
        ? rawValue.join(", ")
        : String(rawValue);
    }

    const signatures: Array<PresentedSignature> = [];

    for (const format of INCOMING_REQUEST_SIGNATURE_FORMATS) {
      const value: string | undefined = byName[format.header.toLowerCase()];

      if (value === undefined) {
        continue;
      }

      const signature: PresentedSignature | null = this.parse({
        format,
        value,
        timestamp: format.timestampHeader
          ? byName[format.timestampHeader.toLowerCase()]
          : undefined,
      });

      if (signature) {
        signatures.push(signature);
      }
    }

    return signatures;
  }

  /*
   * The bytes a signature is made over: the body as it came. The JSON and
   * form parsers keep it as text (StartServer's rawBody), the webhook body
   * reader keeps the bytes of a text and of any other body that is signed
   * (WebhookRequestBody), and a gzip body arrives inflated. A request with no
   * body is signed over nothing.
   */
  public static getSignedBody(req: {
    body?: unknown;
    rawBody?: string | undefined;
    rawBodyBytes?: Buffer | undefined;
  }): Buffer {
    if (Buffer.isBuffer(req.rawBodyBytes)) {
      return req.rawBodyBytes;
    }

    if (Buffer.isBuffer(req.body)) {
      return req.body;
    }

    if (typeof req.rawBody === "string") {
      return Buffer.from(req.rawBody, "utf8");
    }

    return Buffer.alloc(0);
  }

  // A request's signed body, from the request itself.
  public static getSignedBodyOf(req: OneUptimeRequest): Buffer {
    return this.getSignedBody(
      req as unknown as {
        body?: unknown;
        rawBody?: string | undefined;
        rawBodyBytes?: Buffer | undefined;
      },
    );
  }

  /*
   * Which of the secrets made one of the presented signatures. Every
   * signature is tried with every secret, and every digest compared in
   * constant time, whatever matched first.
   */
  public static verify(data: {
    signatures: ReadonlyArray<PresentedSignature>;
    body: Buffer;
    secrets: ReadonlyArray<SigningSecret>;
    now?: Date | undefined;
  }): SignatureVerification {
    const nowSeconds: number = Math.floor(
      (data.now || new Date()).getTime() / 1000,
    );

    let matched: SignatureVerification | undefined = undefined;
    let isAnyChecked: boolean = false;
    const wrongDigests: Array<string> = [];

    for (const signature of data.signatures) {
      const format: IncomingRequestSignatureFormat = this.formatOf(
        signature.scheme,
      );

      if (
        format.hasTimestamp &&
        (signature.timestampSeconds === undefined ||
          Math.abs(nowSeconds - signature.timestampSeconds) >
            INCOMING_REQUEST_SIGNATURE_TOLERANCE_SECONDS)
      ) {
        continue;
      }

      isAnyChecked = true;

      const payload: Buffer = this.getSignedPayload({
        signature,
        body: data.body,
      });

      const digestMatched: Array<boolean> = signature.digests.map(
        (): boolean => {
          return false;
        },
      );

      for (const secret of data.secrets) {
        if (!secret.value) {
          continue;
        }

        const expected: Buffer = createHmac("sha256", secret.value)
          .update(payload)
          .digest();

        for (let index: number = 0; index < signature.digests.length; index++) {
          const digest: string = signature.digests[index]!;
          const presented: Buffer = Buffer.from(digest, "hex");

          if (
            presented.length === expected.length &&
            timingSafeEqual(presented, expected)
          ) {
            digestMatched[index] = true;

            if (!matched) {
              matched = {
                matchedSecretId: secret.secretId,
                matchedSignature: {
                  scheme: signature.scheme,
                  digest: digest,
                  hasTimestamp: format.hasTimestamp,
                },
                wrongDigests: [],
              };
            }
          }
        }
      }

      for (let index: number = 0; index < signature.digests.length; index++) {
        if (!digestMatched[index]) {
          wrongDigests.push(signature.digests[index]!);
        }
      }
    }

    if (matched) {
      return matched;
    }

    if (data.signatures.length === 0) {
      return { wrongDigests: [] };
    }

    return {
      problem: isAnyChecked
        ? SignatureProblem.NoMatch
        : SignatureProblem.Expired,
      wrongDigests: wrongDigests,
    };
  }

  /*
   * Remembers a signature that was accepted, for as long as it could be
   * accepted again: true the first time, false for a request that sends it
   * again. A Redis that cannot be reached remembers nothing, and the
   * request is accepted: a signature with a time still expires on its own.
   */
  public static async rememberAccepted(signature: {
    scheme: IncomingRequestSignatureScheme;
    digest: string;
    hasTimestamp: boolean;
  }): Promise<boolean> {
    try {
      return await GlobalCache.setStringIfNotExists(
        this.SEEN_NAMESPACE,
        createHash("sha256")
          .update(`${signature.scheme}:${signature.digest.toLowerCase()}`)
          .digest("hex"),
        "1",
        {
          /*
           * A signature's time may be up to the tolerance either side of
           * the clock, so it can be accepted again for twice the tolerance.
           */
          expiresInSeconds: signature.hasTimestamp
            ? INCOMING_REQUEST_SIGNATURE_TOLERANCE_SECONDS * 2
            : INCOMING_REQUEST_UNTIMED_SIGNATURE_MEMORY_SECONDS,
        },
      );
    } catch (err) {
      logger.debug(
        "Could not remember an incoming request's signature. The request is accepted.",
      );
      logger.debug(err);
      return true;
    }
  }

  /*
   * The request's headers with every signature masked, for what is queued
   * and kept: X-OneUptime-Signature is OneUptime's own and is taken off, as
   * X-OneUptime-Secret is; a service's own signature header stays, its value
   * masked, so a request someone can read cannot be sent again with it.
   */
  public static withoutSignatures(
    headers: Dictionary<string>,
  ): Dictionary<string> {
    const masked: Dictionary<string> = {};

    for (const [name, value] of Object.entries(headers)) {
      const lowerCaseName: string = name.toLowerCase();

      if (
        lowerCaseName ===
        IncomingRequestSignature.formatOf(
          IncomingRequestSignatureScheme.OneUptime,
        ).header.toLowerCase()
      ) {
        continue;
      }

      const isSignature: boolean =
        lowerCaseName === GITHUB_SHA1_SIGNATURE_HEADER ||
        INCOMING_REQUEST_SIGNATURE_FORMATS.some(
          (format: IncomingRequestSignatureFormat): boolean => {
            return format.header.toLowerCase() === lowerCaseName;
          },
        );

      masked[name] = isSignature ? REDACTED : value;
    }

    return masked;
  }

  // What a signature of this scheme is made over.
  public static getSignedPayload(data: {
    signature: PresentedSignature;
    body: Buffer;
  }): Buffer {
    const timestamp: string = String(data.signature.timestampSeconds ?? "");

    switch (data.signature.scheme) {
      case IncomingRequestSignatureScheme.GitHub:
        return data.body;
      case IncomingRequestSignatureScheme.Slack:
        return Buffer.concat([
          Buffer.from(`v0:${timestamp}:`, "utf8"),
          data.body,
        ]);
      case IncomingRequestSignatureScheme.OneUptime:
      case IncomingRequestSignatureScheme.Stripe:
      default:
        return Buffer.concat([Buffer.from(`${timestamp}.`, "utf8"), data.body]);
    }
  }

  /*
   * A signature as a sender would make it: for the docs, the Dashboard's
   * example and the tests. `timestampSeconds` is needed for every scheme
   * but GitHub's.
   */
  public static sign(data: {
    scheme: IncomingRequestSignatureScheme;
    secret: string;
    body: Buffer | string;
    timestampSeconds?: number | undefined;
  }): string {
    const body: Buffer = Buffer.isBuffer(data.body)
      ? data.body
      : Buffer.from(data.body, "utf8");

    const digest: string = createHmac("sha256", data.secret)
      .update(
        this.getSignedPayload({
          signature: {
            scheme: data.scheme,
            timestampSeconds: data.timestampSeconds,
            digests: [],
          },
          body,
        }),
      )
      .digest("hex");

    switch (data.scheme) {
      case IncomingRequestSignatureScheme.GitHub:
        return `sha256=${digest}`;
      case IncomingRequestSignatureScheme.Slack:
        return `v0=${digest}`;
      case IncomingRequestSignatureScheme.OneUptime:
      case IncomingRequestSignatureScheme.Stripe:
      default:
        return `t=${data.timestampSeconds},v1=${digest}`;
    }
  }

  public static formatOf(
    scheme: IncomingRequestSignatureScheme,
  ): IncomingRequestSignatureFormat {
    return INCOMING_REQUEST_SIGNATURE_FORMATS.find(
      (format: IncomingRequestSignatureFormat): boolean => {
        return format.scheme === scheme;
      },
    )!;
  }

  private static parse(data: {
    format: IncomingRequestSignatureFormat;
    value: string;
    timestamp: string | undefined;
  }): PresentedSignature | null {
    const value: string = data.value.trim();

    switch (data.format.scheme) {
      case IncomingRequestSignatureScheme.GitHub: {
        const match: RegExpExecArray | null = GITHUB_SIGNATURE.exec(value);

        return match
          ? {
              scheme: data.format.scheme,
              digests: [match[1]!.toLowerCase()],
            }
          : null;
      }

      case IncomingRequestSignatureScheme.Slack: {
        const match: RegExpExecArray | null = SLACK_SIGNATURE.exec(value);
        const timestamp: string = (data.timestamp || "").trim();

        return match && UNIX_SECONDS.test(timestamp)
          ? {
              scheme: data.format.scheme,
              timestampSeconds: Number(timestamp),
              digests: [match[1]!.toLowerCase()],
            }
          : null;
      }

      case IncomingRequestSignatureScheme.OneUptime:
      case IncomingRequestSignatureScheme.Stripe:
      default:
        return this.parseTimedList(data.format.scheme, value);
    }
  }

  /*
   * "t=<seconds>,v1=<hex>[,v1=<hex>]": one time, and a signature for each
   * secret the sender signed with. Other keys (Stripe's v0, made with a test
   * mode secret) are not OneUptime's to check, and are left alone.
   */
  private static parseTimedList(
    scheme: IncomingRequestSignatureScheme,
    value: string,
  ): PresentedSignature | null {
    let timestampSeconds: number | undefined = undefined;
    const digests: Array<string> = [];

    for (const part of value.split(",")) {
      const separator: number = part.indexOf("=");

      if (separator < 1) {
        return null;
      }

      const key: string = part.slice(0, separator).trim();
      const partValue: string = part.slice(separator + 1).trim();

      if (key === "t") {
        if (timestampSeconds !== undefined || !UNIX_SECONDS.test(partValue)) {
          return null;
        }

        timestampSeconds = Number(partValue);
        continue;
      }

      if (key === "v1") {
        if (!SHA256_HEX.test(partValue)) {
          return null;
        }

        if (
          digests.length < MAX_DIGESTS_PER_SIGNATURE &&
          !digests.includes(partValue.toLowerCase())
        ) {
          digests.push(partValue.toLowerCase());
        }
      }
    }

    if (timestampSeconds === undefined || digests.length === 0) {
      return null;
    }

    return { scheme, timestampSeconds, digests };
  }
}
