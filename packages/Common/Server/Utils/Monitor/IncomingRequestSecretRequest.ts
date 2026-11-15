import Dictionary from "../../../Types/Dictionary";
import {
  INCOMING_REQUEST_SECRET_AUTHORIZATION_SCHEME,
  INCOMING_REQUEST_SECRET_HEADER,
} from "../../../Types/Monitor/IncomingMonitor/IncomingRequestSecret";
import { REDACTED } from "../LogRedaction";
import { createHash, timingSafeEqual } from "crypto";

/*
 * The secrets an incoming request presents for its project's incoming request
 * secret requirement (Types/Monitor/IncomingMonitor/IncomingRequestSecret),
 * read off its headers.
 *
 * A request presents a secret in X-OneUptime-Secret, or as a bearer token in
 * its Authorization header. Neither is ever kept as it came:
 *
 *   - X-OneUptime-Secret is OneUptime's own header, there for nothing but
 *     this, so the endpoint takes it out of the request before the request is
 *     queued: no queue, no latest request, no log and no criteria ever sees
 *     it (takePresentedSecrets).
 *   - Authorization belongs to the sender, and a monitor's criteria may read
 *     it, so it stays - unless its bearer token is one of the project's
 *     secrets, which the worker masks before the request is kept
 *     (withoutSecretInAuthorization).
 *
 * What travels with the request instead is the SHA-256 of each secret it
 * presented: enough for the worker to decide again, and nothing a reader of
 * the queue could send. The project's secrets are compared as SHA-256 too
 * (IncomingRequestSecretPolicy), in constant time.
 */

// Header names arrive lower-cased from Node, but a job may carry any case.
const SECRET_HEADER_NAME: string = INCOMING_REQUEST_SECRET_HEADER.toLowerCase();
const AUTHORIZATION_HEADER_NAME: string = "authorization";

/*
 * At most this many secrets are read from one request. A header repeated by
 * a proxy arrives joined with commas, so a value is tried whole and split at
 * its commas; a header of thousands of commas must not cost thousands of
 * hashes.
 */
export const MAX_PRESENTED_SECRETS: number = 10;

// What separates an Authorization header's scheme from its credentials.
const WHITESPACE: RegExp = /\s/;

// A SHA-256 digest, as hex: what a presented or a project's secret is compared as.
const SHA256_HEX_DIGEST: RegExp = /^[0-9a-f]{64}$/i;

export interface PresentedIncomingRequestSecrets {
  // The request's headers, without X-OneUptime-Secret: what is queued and kept.
  requestHeaders: Dictionary<string>;
  // The SHA-256 (hex) of every secret the request presented, without repeats.
  secretHashes: Array<string>;
}

export default class IncomingRequestSecretRequest {
  // How a secret is compared: the SHA-256 of the value as it is sent, trimmed.
  public static hashSecret(secret: string): string {
    return createHash("sha256").update(secret.trim(), "utf8").digest("hex");
  }

  /*
   * The ingest endpoint: what the request presented, hashed, and its headers
   * without X-OneUptime-Secret. Header values are joined if a header came
   * more than once.
   */
  public static takePresentedSecrets(
    headers: Dictionary<string | Array<string> | undefined> | undefined | null,
  ): PresentedIncomingRequestSecrets {
    const requestHeaders: Dictionary<string> = {};
    const presented: Array<string> = [];

    for (const [name, rawValue] of Object.entries(headers || {})) {
      if (rawValue === undefined || rawValue === null) {
        continue;
      }

      const value: string = Array.isArray(rawValue)
        ? rawValue.join(", ")
        : String(rawValue);

      const lowerCaseName: string = name.toLowerCase();

      if (lowerCaseName === SECRET_HEADER_NAME) {
        presented.push(...this.getCandidates(value));
        continue;
      }

      if (lowerCaseName === AUTHORIZATION_HEADER_NAME) {
        const token: string | null = this.getBearerToken(value);

        if (token) {
          presented.push(token);
        }
      }

      requestHeaders[name] = value;
    }

    return {
      requestHeaders,
      secretHashes: this.hashAll(presented),
    };
  }

  /*
   * The token of an `Authorization: Bearer <token>` header, or null for any
   * other kind of Authorization (Basic, a bare token) or none. The scheme is
   * not case sensitive.
   */
  public static getBearerToken(
    value: string | undefined | null,
  ): string | null {
    if (!value) {
      return null;
    }

    const trimmed: string = value.trim();
    const scheme: string = INCOMING_REQUEST_SECRET_AUTHORIZATION_SCHEME;

    if (
      trimmed.length <= scheme.length ||
      trimmed.slice(0, scheme.length).toLowerCase() !== scheme.toLowerCase() ||
      !WHITESPACE.test(trimmed.charAt(scheme.length))
    ) {
      return null;
    }

    const token: string = trimmed.slice(scheme.length).trim();

    return token || null;
  }

  /*
   * Whether any presented hash is one of the project's - in constant time
   * for every pair, so how long the comparison took says nothing about how
   * close a guess came. Returns the project's hash that matched, or null.
   */
  public static findMatchingHash(data: {
    presentedSecretHashes: ReadonlyArray<string>;
    projectSecretHashes: ReadonlyArray<string>;
  }): string | null {
    let match: string | null = null;

    for (const presented of data.presentedSecretHashes) {
      const presentedBuffer: Buffer | null = this.toDigestBuffer(presented);

      if (!presentedBuffer) {
        continue;
      }

      for (const projectHash of data.projectSecretHashes) {
        const projectBuffer: Buffer | null = this.toDigestBuffer(projectHash);

        if (!projectBuffer) {
          continue;
        }

        if (timingSafeEqual(presentedBuffer, projectBuffer) && !match) {
          match = projectHash;
        }
      }
    }

    return match;
  }

  /*
   * The worker: the request's headers with the Authorization header masked
   * when its bearer token is one of the given hashes - the project's
   * secrets - so the copy kept for the heartbeat and for people never holds
   * one. Any other Authorization header is the sender's, and stays.
   */
  public static withoutSecretInAuthorization(data: {
    requestHeaders: Dictionary<string> | undefined;
    projectSecretHashes: ReadonlyArray<string>;
  }): Dictionary<string> | undefined {
    if (!data.requestHeaders) {
      return data.requestHeaders;
    }

    let masked: Dictionary<string> | undefined = undefined;

    for (const [name, value] of Object.entries(data.requestHeaders)) {
      if (name.toLowerCase() !== AUTHORIZATION_HEADER_NAME) {
        continue;
      }

      const token: string | null = this.getBearerToken(value);

      if (
        !token ||
        !this.findMatchingHash({
          presentedSecretHashes: [this.hashSecret(token)],
          projectSecretHashes: data.projectSecretHashes,
        })
      ) {
        continue;
      }

      masked = masked || { ...data.requestHeaders };
      masked[name] =
        `${INCOMING_REQUEST_SECRET_AUTHORIZATION_SCHEME} ${REDACTED}`;
    }

    return masked || data.requestHeaders;
  }

  // A header value as one secret, and as the secrets a proxy joined into it.
  private static getCandidates(value: string): Array<string> {
    const candidates: Array<string> = [value];

    if (value.includes(",")) {
      candidates.push(...value.split(","));
    }

    return candidates;
  }

  private static hashAll(secrets: Array<string>): Array<string> {
    const hashes: Array<string> = [];

    for (const secret of secrets) {
      if (hashes.length >= MAX_PRESENTED_SECRETS) {
        break;
      }

      if (!secret.trim()) {
        continue;
      }

      const hash: string = this.hashSecret(secret);

      if (!hashes.includes(hash)) {
        hashes.push(hash);
      }
    }

    return hashes;
  }

  // A SHA-256 hex digest as its 32 bytes, or null for anything else.
  private static toDigestBuffer(hash: string): Buffer | null {
    if (typeof hash !== "string" || !SHA256_HEX_DIGEST.test(hash)) {
      return null;
    }

    return Buffer.from(hash, "hex");
  }
}
